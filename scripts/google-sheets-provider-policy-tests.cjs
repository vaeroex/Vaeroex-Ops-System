/* CommonJS harness intercepts server-only dependencies for isolated tests. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const ticketId = "cc26b01e-30a9-4f65-8d13-96a820fb38ad";
let context = { ticketId, containsGoogleSheets: true, hasUnattributedDerivedSources: false };
let databaseError = null;
let readCount = 0;
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, ...args); };
const load = Module._load;
Module._load = function(request, ...args) {
  if (request === "server-only") return {};
  if (request === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => ({ rpc: async (name, args) => {
    assert.equal(name, "get_google_sheets_read_context_v1"); assert.equal(args.p_ticket_id, ticketId); readCount++;
    return { data: context, error: databaseError };
  } }) };
  return load.call(this, request, ...args);
};
const settings = { timeoutMs: 2000, maxRetries: 0, retryBaseDelayMs: 1, circuitFailureThreshold: 50, circuitOpenMs: 1000 };
(async () => {
  const { assertGoogleSheetsProviderPolicy, googleSheetsOpenAIHeaders } = require("../lib/ai/providers/google-data-policy.ts");
  const { OpenAIProvider } = require("../lib/ai/providers/openai-provider.ts");
  const { runStructuredAI } = require("../lib/ai/providers/provider-manager.ts");
  process.env.OPENAI_API_KEY = "synthetic-not-a-real-key";
  delete process.env.GOOGLE_SHEETS_OPENAI_ORGANIZATION_ID;
  delete process.env.GOOGLE_SHEETS_OPENAI_PROJECT_ID;
  assert.deepEqual(await googleSheetsOpenAIHeaders(undefined), {}); assert.equal(readCount, 0);
  await assert.rejects(assertGoogleSheetsProviderPolicy("not-a-ticket", "openai"), /Reload/);
  await assert.rejects(assertGoogleSheetsProviderPolicy(ticketId, "openai"), /verified/);
  process.env.GOOGLE_SHEETS_OPENAI_ORGANIZATION_ID = "org-synthetic";
  process.env.GOOGLE_SHEETS_OPENAI_PROJECT_ID = "proj_synthetic";
  await assert.rejects(assertGoogleSheetsProviderPolicy(ticketId, "nvidia"), /limited/);
  assert.deepEqual(await googleSheetsOpenAIHeaders(ticketId), { "OpenAI-Organization": "org-synthetic", "OpenAI-Project": "proj_synthetic" });
  databaseError = { message: "expired" };
  await assert.rejects(googleSheetsOpenAIHeaders(ticketId), /changed or expired/);
  databaseError = null;
  context = { ...context, hasUnattributedDerivedSources: true };
  await assert.rejects(googleSheetsOpenAIHeaders(ticketId), /source review/);
  context = { ...context, hasUnattributedDerivedSources: false };
  const transports = [];
  global.fetch = async (url, init) => {
    transports.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(url.endsWith("/embeddings") ? { data: [{ embedding: [0.1] }] } : { output_text: '{"ok":true}', status: "completed" }), { status: 200 });
  };
  const provider = new OpenAIProvider();
  const request = { model: "synthetic-model", systemPrompt: "Synthetic", userContent: [{ type: "text", text: "Synthetic" }], settings, store: true, googleSheetsReadTicketId: ticketId };
  await provider.generate(request);
  assert.equal(transports.at(-1).body.store, false);
  assert.equal(transports.at(-1).headers["OpenAI-Project"], "proj_synthetic");
  await provider.createEmbeddings(["Synthetic"], "synthetic-embedding", settings, ticketId);
  assert.equal(transports.at(-1).headers["OpenAI-Organization"], "org-synthetic");
  const before = transports.length;
  databaseError = { message: "deletion fence" };
  await assert.rejects(provider.generate(request), /changed or expired/);
  await assert.rejects(provider.createEmbeddings(["Synthetic"], "synthetic-embedding", settings, ticketId), /changed or expired/);
  assert.equal(transports.length, before);
  databaseError = null;
  let nvidiaCalls = 0, openaiCalls = 0;
  const openai = { ...provider, generate: async req => { openaiCalls++; assert.equal(req.store, false); return { content: '{"ok":true}', latencyMs: 0, requestId: null, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }; } };
  const nvidia = { generate: async () => { nvidiaCalls++; throw new Error("Forbidden transport"); } };
  await runStructuredAI({ ...request, primaryProvider: "nvidia", primaryModel: "synthetic-nvidia", fallbackModel: "synthetic-openai", providers: { openai, nvidia }, validate: value => ({ ok: true, value }) });
  assert.equal(nvidiaCalls, 0); assert.equal(openaiCalls, 1);
  context = { ...context, containsGoogleSheets: false };
  delete process.env.GOOGLE_SHEETS_OPENAI_PROJECT_ID;
  assert.deepEqual(await googleSheetsOpenAIHeaders(ticketId), {});
  await provider.generate({ ...request, store: true });
  assert.equal(transports.at(-1).body.store, true);
  assert.equal(transports.at(-1).headers["OpenAI-Project"], undefined);
  process.stdout.write("Google-derived provider policy: authority, provenance, fallback exclusion, store:false, embedding pins, expired-ticket denial, and unrelated-data controls passed. No remote requests.\n");
})().catch(error => { console.error(error); process.exitCode = 1; });
