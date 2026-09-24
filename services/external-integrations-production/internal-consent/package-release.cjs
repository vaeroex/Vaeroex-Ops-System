// Package the exact existing server-only dependency; no replacement shim,
// downloaded guest package, or ancestor node_modules is used at runtime.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const output = path.join(__dirname, "dist");
const source = path.dirname(require.resolve("server-only"));
const manifest = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
assert.equal(manifest.name, "server-only");
assert.equal(manifest.version, "0.0.1");
assert.equal(manifest.exports["."]["react-server"], "./empty.js");
assert.equal(manifest.exports["."].default, "./index.js");
const destination = path.join(output, "node_modules/server-only");
fs.mkdirSync(destination, { recursive: true });
for (const name of ["package.json", "empty.js", "index.js"]) fs.copyFileSync(path.join(source, name), path.join(destination, name));
assert.equal(fs.existsSync(path.join(output, "index.js.map")), false);
assert.doesNotMatch(fs.readFileSync(path.join(output, "index.js"), "utf8"), /["']@\/lib\//);

// Execute the release away from repository dependency resolution. Its ordinary
// unconfigured entrypoint must be genuinely executable and dormant.
async function main() {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "square-internal-consent-release-"));
  fs.cpSync(output, owned, { recursive: true });
  let child, timer;
  try {
    const http = require("node:http");
    const listener = http.createServer();
    await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    child = spawn(process.execPath, ["--conditions=react-server", path.join(owned, "index.js")], {
      cwd: owned, env: { NODE_ENV: "production", PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
    });
    let outputBytes = 0;
    child.stdout.on("data", chunk => { outputBytes += chunk.length; });
    child.stderr.on("data", chunk => { outputBytes += chunk.length; });
    timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    let response;
    for (let attempt = 0; attempt < 30 && child.exitCode === null; attempt++) {
      try { response = await fetch(`http://127.0.0.1:${port}/healthz`); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(response, "standalone_dormant_listener_available");
    assert.deepEqual(await response.json(), { status: "disabled" });
    const denied = await fetch(`http://127.0.0.1:${port}/api/integrations/square/connect`, { method: "POST" });
    assert.equal(denied.status, 404);
    assert.equal(outputBytes, 0, "standalone_dormant_release_has_no_request_logs");
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
    assert.equal(child.exitCode, 0);
    console.log("square_internal_standalone_dormant_release_passed");
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null) child.kill("SIGKILL");
    fs.rmSync(owned, { recursive: true, force: true });
  }
}
main().catch(() => { console.error("square_internal_standalone_release_failed"); process.exitCode = 1; });
