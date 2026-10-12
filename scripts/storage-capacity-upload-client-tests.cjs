/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic direct-upload transport tests, no network. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, "..", relative);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename }).outputText;
  const loaded = { exports: {} };
  Function("require", "module", "exports", output)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), loaded, loaded.exports);
  return loaded.exports;
}
const policy = load("lib/storage-capacity/policy.ts");
const { uploadSourceDirect } = load("lib/storage-capacity/upload-client.ts", { "@/lib/storage-capacity/policy": policy });
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reservation = { reservationId: "reservation-a", fileId: "file-a", signedUrl: `https://synthetic.supabase.co/storage/v1/object/upload/sign/workspace-files/${workspaceId}/file-a/source.csv?token=synthetic`, mimeType: "text/csv" };
function payload(size = 42) {
  const data = new FormData();
  data.set("file", new File([new Uint8Array(size)], "source.csv", { type: "text/csv" }));
  data.set("display_name", "Synthetic data"); data.set("folder_id", "folder-a"); data.set("allow_duplicate", "on");
  return data;
}
async function harness(options, run) {
  const prior = global.fetch;
  const calls = [], prepared = [];
  global.fetch = async (url, request) => {
    const stage = url.endsWith("reserve") ? "reserve" : url.endsWith("complete") ? "complete" : "upload";
    calls.push({ url, request, stage });
    if (options.throwAt === stage) throw new TypeError("Interrupted response");
    if (options.failAt === stage) return { ok: false, json: async () => ({ error: "Synthetic known rejection" }) };
    return { ok: true, json: async () => stage === "reserve" ? options.reservation ?? reservation : { fileId: options.completedFileId ?? "file-a" } };
  };
  const prepare = async (previous, metadata) => { prepared.push({ previous, metadata }); return { error: null }; };
  try { await run({ calls, prepared, prepare }); } finally { global.fetch = prior; }
}

test("a full 25 MiB original bypasses the server-action body ceiling, with small metadata calls bound to its workspace", () => harness({}, async ({ calls, prepared, prepare }) => {
  const data = payload(policy.MAX_UPLOAD_BYTES);
  const file = data.get("file");
  assert.deepEqual(await uploadSourceDirect(workspaceId, data, prepare), { error: null });
  assert.deepEqual(calls.map(call => call.stage), ["reserve", "upload", "complete"]);
  const reserveBody = JSON.parse(calls[0].request.body);
  assert.equal(reserveBody.workspaceId, workspaceId);
  assert.equal(reserveBody.bytes, 26214400);
  assert.equal(reserveBody.allowDuplicate, true);
  assert.match(reserveBody.requestId, /^[a-f0-9-]{36}$/);
  assert.ok(calls[0].request.body.length < 1000);
  assert.equal(calls[1].request.body, file, "only object storage receives binary bytes");
  assert.equal(calls[1].request.method, "PUT");
  assert.equal(calls[1].request.headers["x-upsert"], "false");
  assert.deepEqual(JSON.parse(calls[2].request.body), { workspaceId, reservationId: "reservation-a" });
  assert.equal(prepared.length, 1);
  assert.deepEqual([...prepared[0].metadata.entries()], [["file_id", "file-a"], ["expectedWorkspaceId", workspaceId]]);
  assert.equal(data.get("file"), file, "manual form data is never reset");
}));

test("oversize and absent files are recoverable local errors with no admission or object request", () => harness({}, async ({ calls, prepare }) => {
  assert.match((await uploadSourceDirect(workspaceId, payload(policy.MAX_UPLOAD_BYTES + 1), prepare)).error, /25 MiB/);
  assert.match((await uploadSourceDirect(workspaceId, new FormData(), prepare)).error, /Choose a file/);
  assert.equal(calls.length, 0);
}));

test("known admission rejection retains retryable form state and never transfers bytes", () => harness({ failAt: "reserve" }, async ({ calls, prepared, prepare }) => {
  const result = await uploadSourceDirect(workspaceId, payload(), prepare);
  assert.equal(result.error, "Synthetic known rejection");
  assert.equal(result.blocked, undefined);
  assert.equal(calls.length, 1);
  assert.equal(prepared.length, 0);
}));

test("lost acknowledgments never retry and cannot prepare or silently duplicate the original", async () => {
  for (const throwAt of ["reserve", "upload", "complete"]) await harness({ throwAt }, async ({ calls, prepared, prepare }) => {
    const result = await uploadSourceDirect(workspaceId, payload(), prepare);
    assert.equal(result.blocked, true, throwAt);
    assert.equal(calls.length, ["reserve", "upload", "complete"].indexOf(throwAt) + 1);
    assert.equal(prepared.length, 0);
  });
  for (const failAt of ["upload", "complete"]) await harness({ failAt }, async ({ prepared, prepare }) => {
    assert.equal((await uploadSourceDirect(workspaceId, payload(), prepare)).blocked, true);
    assert.equal(prepared.length, 0);
  });
});

test("a mismatched completed identity or wrong-workspace destination cannot proceed to preparation", async () => {
  await harness({ completedFileId: "another-file" }, async ({ prepared, prepare }) => {
    assert.equal((await uploadSourceDirect(workspaceId, payload(), prepare)).blocked, true);
    assert.equal(prepared.length, 0);
  });
  await harness({ reservation: { ...reservation, signedUrl: reservation.signedUrl.replace(workspaceId, "other-workspace") } }, async ({ calls, prepare }) => {
    assert.equal((await uploadSourceDirect(workspaceId, payload(), prepare)).blocked, true);
    assert.equal(calls.length, 1, "no private file is sent to a different workspace path");
  });
});

test("metadata preparation preserves authentication and source-detail navigation control flow", () => harness({}, async () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/app/sources/file-a;307;" });
  await assert.rejects(uploadSourceDirect(workspaceId, payload(), async () => { throw redirect; }), error => error === redirect);
}));

test("mutation Origin uses the public Host authority when Next binds internally and rejects foreign or malformed origins", () => {
  const { assertStorageOrigin, StorageAccessError } = load("lib/storage-capacity/access.ts", {
    "server-only": {}, "@/lib/billing/get-subscription-status": {}, "@/lib/supabase/server": {}, "@/lib/workspaces/current": {},
  });
  assert.doesNotThrow(() => assertStorageOrigin(new Request("http://0.0.0.0:3000/api/storage-capacity/reserve", {
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
  })));
  assert.doesNotThrow(() => assertStorageOrigin(new Request("http://internal:3000/api/storage-capacity/reserve", {
    headers: { host: "workspace.example.invalid", origin: "https://workspace.example.invalid" },
  })));
  for (const origin of ["https://attacker.invalid", "null", "https://workspace.example.invalid/path", "https://workspace.example.invalid:444", "ftp://workspace.example.invalid", ""]) {
    assert.throws(() => assertStorageOrigin(new Request("http://internal:3000/api/storage-capacity/reserve", {
      headers: { host: "workspace.example.invalid", origin, "x-forwarded-host": "attacker.invalid" },
    })), error => error instanceof StorageAccessError && error.status === 403);
  }
});
