import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

// Read ELF64 DT_NEEDED entries without invoking tools absent from Distroless.
function elfDependencies(file) {
  const data = readFileSync(file);
  assert.equal(data.subarray(0, 6).toString("hex"), "7f454c460201");
  const offset = Number(data.readBigUInt64LE(32));
  const size = data.readUInt16LE(54), count = data.readUInt16LE(56);
  const segments = Array.from({ length: count }, (_, index) => {
    const start = offset + index * size;
    return { type: data.readUInt32LE(start), offset: Number(data.readBigUInt64LE(start + 8)),
      address: Number(data.readBigUInt64LE(start + 16)), size: Number(data.readBigUInt64LE(start + 32)) };
  });
  const dynamic = segments.find(segment => segment.type === 2);
  if (!dynamic) return [];
  let strings; const needed = [];
  for (let entry = dynamic.offset; entry < dynamic.offset + dynamic.size; entry += 16) {
    const tag = data.readBigUInt64LE(entry), value = Number(data.readBigUInt64LE(entry + 8));
    if (tag === 0n) break;
    if (tag === 1n) needed.push(value);
    if (tag === 5n) strings = value;
  }
  if (needed.length === 0) return [];
  const segment = segments.find(part => part.type === 1 && strings >= part.address && strings < part.address + part.size);
  assert.ok(segment);
  return needed.map(index => {
    const start = segment.offset + strings - segment.address + index;
    const end = data.indexOf(0, start);
    assert.ok(end >= start && end < data.length);
    return data.toString("utf8", start, end);
  });
}

let stage = "platform";
// Run only inside the built image with Docker --network=none and no credentials.
async function main() {
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.equal(process.getuid(), 65532);
  assert.match(process.versions.node, /^22\./);
  stage = "openssl_linkage";
  assert.equal(process.config.variables.node_shared_openssl, false);
  assert.doesNotThrow(() => createHash("sha256").update("qbo-image-smoke").digest());
  await assert.rejects(import("node:quic"), { code: "ERR_UNKNOWN_BUILTIN_MODULE" });
  const sharedObjects = process.report.getReport().sharedObjects;
  assert.ok(!sharedObjects.some((path) => /lib(?:ssl|crypto)\.so/.test(path)));
  const elfNeeded = [...new Set([process.execPath, ...sharedObjects]
    .flatMap(elfDependencies))].sort();
  assert.ok(!elfNeeded.some(name => /lib(?:ssl|crypto)\.so/.test(name)));
  stage = "packaged_modules";
  const assets = readdirSync("/app", { recursive: true });
  assert.ok(!assets.some((path) => /(?:\.node|\.so(?:\.|$)|\.map$)/.test(path)));
  assert.throws(() => createRequire("/app/index.js").resolve("pg-native"), { code: "MODULE_NOT_FOUND" });
  assert.ok(!process.env.NODE_OPTIONS && !process.env.NODE_PG_FORCE_NATIVE && !process.env.LD_PRELOAD);
  const bundleSha256 = createHash("sha256").update(readFileSync("/app/index.js")).digest("hex");
  assert.ok(!process.env.DATABASE_URL && !process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const sourceCommit = process.argv[2];
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  const cases = ["bootstrap", "oauth_ingress", "credential_broker", "task_scheduler", "task_dispatcher", "provider_runtime"];
  for (const [index, mode] of cases.entries()) {
    stage = mode;
    const port = 8890 + index;
    const child = spawn(process.execPath, ["--conditions=react-server", "/app/index.js"], {
      env: { NODE_ENV: "production", PORT: String(port), QBO_SOURCE_COMMIT: sourceCommit,
        QBO_SERVICE_MODE: mode === "bootstrap" ? "oauth_ingress" : mode,
        ...(mode === "bootstrap" ? { QBO_INGRESS_BOOTSTRAP_ONLY: "true" } : {
          DATABASE_URL: "postgresql://qbo_image_fixture@127.0.0.1:1/postgres",
        }) }, stdio: ["ignore", "pipe", "pipe"]
    });
    let logs = "";
    child.stdout.on("data", (bytes) => { logs += bytes; });
    child.stderr.on("data", (bytes) => { logs += bytes; });
    child.on("error", () => {});
    try {
      let response;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`image_${mode}_startup_failed`);
        try { response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }); break; }
        catch { await delay(100); }
      }
      assert.ok(response, `image_${mode}_health_timeout`);
      assert.equal(response.status, 200);
      const health = await response.json();
      assert.equal(health.ok, true);
      assert.equal(health.sourceCommit, sourceCommit);
      assert.equal(health.providerEnvironment, "production");
      assert.equal(health.promotionAuthorized, false);
      assert.equal(health.modelCallCount, 0);
      if (mode === "bootstrap") {
        assert.equal(health.bootstrapOnly, true);
        assert.equal(health.oauthProcessingEnabled, false);
        assert.equal(health.webhookProcessingEnabled, false);
        const denied = await fetch(`http://127.0.0.1:${port}/webhooks/qbo`, { method: "POST", body: "{}" });
        assert.equal(denied.status, 503);
      } else if (mode !== "oauth_ingress") {
        const denied = await fetch(`http://127.0.0.1:${port}/tasks/execute`, { method: "POST", body: "{}" });
        assert.equal(denied.status, 403);
      }
      assert.ok(!/request_failed|startup_failed/i.test(logs));
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([once(child, "exit"), delay(2000).then(() => child.kill("SIGKILL"))]);
      }
    }
  }
  console.log(JSON.stringify({ imageSmoke: "passed", modes: cases.length, network: "none", databaseConnections: 0,
    providerCalls: 0, node: process.versions.node, openssl: process.versions.openssl,
    systemOpenSslLinked: false, nativeAddons: 0, pgNativeAvailable: false,
    quicBuiltinAvailable: false, elfNeeded, bundleSha256, uid: process.getuid() }));
}
main().catch(() => { console.error(JSON.stringify({ error: "qbo_image_smoke_failed", stage })); process.exitCode = 1; });
