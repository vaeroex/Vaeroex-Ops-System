/* eslint-disable @typescript-eslint/no-require-imports -- Actual authenticated health route, synthetic keys and no network. */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { installLoader } = require("./qbo-customer-test-support.cjs");
let configured = true, user = { id: "synthetic-admin" }, admin = true, runtimeCalls = 0, networkCalls = 0;
const runtime = {
  activeProvider: "openai", configurationValid: true, openaiApiKeyConfigured: true,
  openaiConfigured: true, nvidiaConfigured: false, nvidiaModel: "synthetic-nvidia",
  embeddingProvider: "openai", keySource: "OPENAI_API_KEY", keyFingerprint: "global123456",
  legacyEnvPresence: {}, openaiModel: "synthetic-global-model", openaiEmbeddingModel: "synthetic-embedding",
  maxEvidenceChunks: 8, openaiApiMode: "responses", openaiEndpoint: "/v1/responses",
  responseFormat: "synthetic", serverOnly: true
};
installLoader({
  "@/lib/supabase/server": { createSupabaseServerClient: async () => configured ? { auth: { getUser: async () => ({ data: { user } }) } } : null },
  "@/lib/admin/admin-emails": { isVaeroexAdminUser: () => admin },
  "@/lib/ai/vaeroex-client": { getVaeroexAIRuntimeStatus: () => { runtimeCalls++; return runtime; } }
});
const { GET } = require("../app/api/health/openai/route.ts");
const originalFetch = global.fetch, originalLog = console.log;
const originalKey = process.env.GOOGLE_SHEETS_OPENAI_API_KEY;
const logs = [];
console.log = value => logs.push(value);
global.fetch = async () => { networkCalls++; throw Error("Health must not call a provider"); };
(async () => {
  let checks = 0;
  const synthetic = "synthetic-sheets-key-not-a-credential";
  process.env.GOOGLE_SHEETS_OPENAI_API_KEY = `  ${synthetic} \n`;
  for (const [available, actor, permitted, status] of [
    [false, { id: "synthetic-admin" }, true, 500],
    [true, null, true, 401],
    [true, { id: "synthetic-member" }, false, 403]
  ]) {
    configured = available; user = actor; admin = permitted;
    const response = await GET(); const body = await response.json();
    assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.checks, undefined); assert.equal(runtimeCalls, 0); assert.equal(logs.length, 0);
    assert.equal(JSON.stringify(body).includes(synthetic), false); checks++;
  }
  configured = true; user = { id: "synthetic-admin" }; admin = true;
  const response = await GET(); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.ok, true); assert.equal(body.checks.googleSheetsOpenaiApiKeyConfigured, true);
  assert.equal(body.checks.googleSheetsOpenaiKeyFingerprint, createHash("sha256").update(synthetic).digest("hex").slice(0, 12));
  for (const name of ["activeProvider", "configurationValid", "openaiApiKeyConfigured", "nvidiaConfigured", "nvidiaModel", "embeddingProvider", "keySource", "keyFingerprint", "legacyEnvPresence", "openaiModel", "openaiEmbeddingModel", "maxEvidenceChunks", "openaiApiMode", "openaiEndpoint", "responseFormat", "serverOnly"]) {
    assert.deepEqual(body.checks[name], runtime[name]);
  }
  assert.equal(JSON.stringify(body).includes(synthetic), false); assert.equal(logs.join("").includes(synthetic), false); checks++;
  for (const value of [undefined, "", " \n\t "]) {
    if (value === undefined) delete process.env.GOOGLE_SHEETS_OPENAI_API_KEY;
    else process.env.GOOGLE_SHEETS_OPENAI_API_KEY = value;
    const missing = await (await GET()).json();
    assert.equal(missing.checks.googleSheetsOpenaiApiKeyConfigured, false);
    assert.equal(missing.checks.googleSheetsOpenaiKeyFingerprint, null); assert.equal(missing.ok, true); checks++;
  }
  process.env.GOOGLE_SHEETS_OPENAI_API_KEY = synthetic;
  runtime.openaiConfigured = false; runtime.openaiApiKeyConfigured = false;
  const sheetsOnly = await (await GET()).json();
  assert.equal(sheetsOnly.ok, false); assert.equal(sheetsOnly.checks.googleSheetsOpenaiApiKeyConfigured, true);
  assert.equal(sheetsOnly.checks.openaiApiKeyConfigured, false); checks++;
  runtime.activeProvider = "nvidia"; runtime.nvidiaConfigured = true;
  assert.equal((await (await GET()).json()).ok, false); checks++;
  runtime.openaiConfigured = true;
  assert.equal((await (await GET()).json()).ok, true); checks++;
  assert.equal(networkCalls, 0); assert.equal(logs.join("").includes(synthetic), false); checks++;
  process.stdout.write(JSON.stringify({ suite: "google_sheets_provider_health", checks, remoteRequests: 0 }) + "\n");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch; console.log = originalLog;
  if (originalKey === undefined) delete process.env.GOOGLE_SHEETS_OPENAI_API_KEY;
  else process.env.GOOGLE_SHEETS_OPENAI_API_KEY = originalKey;
});
