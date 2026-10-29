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
let readCount = 0, addSheetsDuringRetrieval = false;
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, ...args); };
const load = Module._load;
Module._load = function(request, ...args) {
  if (request === "server-only") return {};
  // Keep provider-routing negatives on their explicit legacy path; shared admission has dedicated tests.
  if (request === "@/lib/ai/shared-evidence/runtime-gate") return { sharedEvidenceRuntimeEnabled: () => false };
  if (request === "@/lib/ai/shared-evidence/qualitative-policy") return { qualitativeSynthesisEnabled: () => false };
  if (args[0]?.filename === path.join(root, "lib/vsi/engine.ts") && request === "./retrieval") return {
    authorizeVsiRead: async () => ({}),
    retrieveVsiEvidence: async () => {
      if (addSheetsDuringRetrieval) context = { ...context, containsGoogleSheets: true };
      return { sources: [], limitations: [] };
    }
  };
  if (args[0]?.filename === path.join(root, "lib/vsi/engine.ts") && request === "./product-context") return {
    loadVsiProductContext: async () => ({ authoritative: {}, sources: [], limitations: [] })
  };
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
  const globalKey = "synthetic-global-key", sheetsKey = "synthetic-sheets-key";
  process.env.OPENAI_API_KEY = globalKey;
  delete process.env.GOOGLE_SHEETS_OPENAI_API_KEY;
  delete process.env.GOOGLE_SHEETS_OPENAI_ORGANIZATION_ID;
  delete process.env.GOOGLE_SHEETS_OPENAI_PROJECT_ID;
  assert.deepEqual(await googleSheetsOpenAIHeaders(undefined), {}); assert.equal(readCount, 0);
  await assert.rejects(assertGoogleSheetsProviderPolicy("not-a-ticket", "openai"), /Reload/);
  await assert.rejects(assertGoogleSheetsProviderPolicy(ticketId, "openai"), /verified/);
  process.env.GOOGLE_SHEETS_OPENAI_ORGANIZATION_ID = "org-synthetic";
  process.env.GOOGLE_SHEETS_OPENAI_PROJECT_ID = "proj_synthetic";
  await assert.rejects(assertGoogleSheetsProviderPolicy(ticketId, "openai"), /provider connection is verified/,
    "project pins and a global key cannot replace the dedicated credential");
  process.env.GOOGLE_SHEETS_OPENAI_API_KEY = ` ${sheetsKey} `;
  await assert.rejects(assertGoogleSheetsProviderPolicy(ticketId, "nvidia"), /limited/);
  const googleHeaders = { Authorization: `Bearer ${sheetsKey}`, "OpenAI-Organization": "org-synthetic", "OpenAI-Project": "proj_synthetic" };
  assert.deepEqual(await googleSheetsOpenAIHeaders(ticketId), googleHeaders);
  databaseError = { code: "40001", message: "synthetic private detail must not escape" };
  await assert.rejects(googleSheetsOpenAIHeaders(ticketId), error => error.reason === "source_changed" && /changed or expired/.test(error.message));
  databaseError = { code: "42501", message: "synthetic private detail must not escape" };
  await assert.rejects(googleSheetsOpenAIHeaders(ticketId), error => error.reason === "source_access_denied" && !/private detail/.test(error.message));
  databaseError = { code: "XX000", message: "synthetic private detail must not escape" };
  await assert.rejects(googleSheetsOpenAIHeaders(ticketId), error => error.reason === "source_authority_unavailable" && !/private detail/.test(error.message));
  databaseError = null;
  context = { ...context, hasUnattributedDerivedSources: true };
  await assert.rejects(googleSheetsOpenAIHeaders(ticketId), error => error.reason === "source_attribution" && /source review/.test(error.message));
  context = { ...context, hasUnattributedDerivedSources: false };
  const transports = [];
  let failTransport = false;
  global.fetch = async (url, init) => {
    assert(["https://api.openai.com/v1/responses", "https://api.openai.com/v1/embeddings"].includes(url));
    transports.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(url.endsWith("/embeddings") ? { data: [{ embedding: [0.1] }] } : { output_text: '{"ok":true}', status: "completed" }), { status: failTransport ? 503 : 200 });
  };
  const provider = new OpenAIProvider();
  const request = { model: "synthetic-model", systemPrompt: "Synthetic", userContent: [{ type: "text", text: "Synthetic" }], settings, store: true, googleSheetsReadTicketId: ticketId };
  const assertDedicated = () => {
    assert.equal(transports.at(-1).headers.Authorization, `Bearer ${sheetsKey}`);
    assert.equal(transports.at(-1).headers["OpenAI-Project"], "proj_synthetic");
    assert.equal(transports.at(-1).headers["OpenAI-Organization"], "org-synthetic");
    assert(!JSON.stringify(transports.at(-1)).includes(globalKey), "Google transport never includes the global credential");
  };
  await provider.generate(request); assertDedicated(); assert.equal(transports.at(-1).body.store, false);
  await provider.createEmbeddings(["Synthetic"], "synthetic-embedding", settings, ticketId); assertDedicated();
  delete process.env.OPENAI_API_KEY;
  assert.equal(provider.isConfigured(), false, "global provider readiness remains independent of the Sheets key");
  await provider.generate(request); assertDedicated();
  await provider.createEmbeddings(["Synthetic"], "synthetic-embedding", settings, ticketId); assertDedicated();
  process.env.OPENAI_API_KEY = globalKey;
  const before = transports.length;
  databaseError = { code: "40001", message: "deletion fence" };
  await assert.rejects(provider.generate(request), /changed or expired/);
  await assert.rejects(provider.createEmbeddings(["Synthetic"], "synthetic-embedding", settings, ticketId), /changed or expired/);
  assert.equal(transports.length, before);
  databaseError = null;
  let nvidiaCalls = 0, openaiCalls = 0;
  const result = { content: '{"ok":true}', latencyMs: 0, requestId: null, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
  const openai = { generate: async req => { openaiCalls++; assert.equal(req.store, false); return result; } };
  const nvidia = { generate: async () => { nvidiaCalls++; return result; } };
  const managed = { ...request, primaryProvider: "nvidia", primaryModel: "synthetic-nvidia", fallbackModel: "synthetic-openai", providers: { openai, nvidia }, validate: value => ({ ok: true, value }) };
  await runStructuredAI(managed);
  assert.equal(nvidiaCalls, 0); assert.equal(openaiCalls, 1);
  for (const missing of [undefined, "", "   "]) {
    if (missing === undefined) delete process.env.GOOGLE_SHEETS_OPENAI_API_KEY;
    else process.env.GOOGLE_SHEETS_OPENAI_API_KEY = missing;
    await assert.rejects(provider.generate(request), /provider connection is verified/);
    await assert.rejects(provider.createEmbeddings(["Synthetic"], "synthetic-embedding", settings, ticketId), /provider connection is verified/);
    await assert.rejects(runStructuredAI(managed), /provider connection is verified/);
  }
  assert.equal(transports.length, before, "a global key never rescues missing dedicated configuration");
  assert.equal(nvidiaCalls, 0); assert.equal(openaiCalls, 1);
  process.env.GOOGLE_SHEETS_OPENAI_API_KEY = sheetsKey;
  failTransport = true;
  await assert.rejects(runStructuredAI({ ...managed, providers: { openai: provider, nvidia }, providerPolicy: {
    id: "synthetic-explicit-fallback", steps: [{ provider: "openai", model: "synthetic-model" }, { provider: "nvidia", model: "synthetic-nvidia" }]
  } }));
  assertDedicated(); assert.equal(nvidiaCalls, 0, "Google provider failures cannot reach NVIDIA");
  failTransport = false;

  context = { ...context, containsGoogleSheets: false };
  delete process.env.GOOGLE_SHEETS_OPENAI_PROJECT_ID;
  delete process.env.GOOGLE_SHEETS_OPENAI_API_KEY;
  assert.deepEqual(await googleSheetsOpenAIHeaders(ticketId), {});
  for (const marker of [ticketId, undefined]) {
    const readsBefore = readCount;
    await provider.generate({ ...request, googleSheetsReadTicketId: marker });
    assert.equal(transports.at(-1).body.store, true);
    assert.equal(transports.at(-1).headers.Authorization, `Bearer ${globalKey}`);
    assert.equal(transports.at(-1).headers["OpenAI-Project"], undefined);
    await provider.createEmbeddings(["Synthetic"], "synthetic-embedding", settings, marker);
    assert.equal(transports.at(-1).headers.Authorization, `Bearer ${globalKey}`);
    if (marker === undefined) assert.equal(readCount, readsBefore, "unmarked ordinary calls do not introduce authority reads");
  }
  await runStructuredAI(managed);
  assert.equal(nvidiaCalls, 1, "ordinary marked data retains its configured NVIDIA route");
  assert.equal(openaiCalls, 1);
  process.env.GOOGLE_SHEETS_OPENAI_API_KEY = sheetsKey;
  delete process.env.OPENAI_API_KEY;
  const ordinaryBefore = transports.length;
  await assert.rejects(provider.generate({ ...request, googleSheetsReadTicketId: undefined }), /OpenAI API key is not configured/);
  const missingEmbedding = await provider.createEmbeddings(["Synthetic"], "synthetic-embedding", settings);
  assert.deepEqual(missingEmbedding.embeddings, [null]);
  assert.equal(missingEmbedding.error, "OpenAI embedding key is not configured.");
  assert.equal(transports.length, ordinaryBefore, "ordinary requests never use the Sheets-only key");

  // Exercise the actual VSI transport with actual policy resolution. The only
  // substituted dependencies are local context loaders and fake database RPCs.
  const { runVsiAnswer } = require("../lib/vsi/engine.ts");
  const vsiInput = { readTicket: { ticketId }, supabase: { rpc: async (name, args) => {
    assert.equal(name, "bind_google_sheets_read_v1"); assert.equal(args.p_ticket_id, ticketId);
    return { data: { ticketId, epoch: 0, expiresAt: "2099-01-01T00:00:00.000Z" }, error: null };
  } }, workspaceId: "synthetic-workspace", actorUserId: "synthetic-actor", requestId: "synthetic-request",
    question: "Summarize the supplied context.", recentMessages: [] };
  let removeKeyAfterPlanner = false;
  global.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body); transports.push({ url, headers: init.headers, body });
    assert.equal(body.store, false);
    const planner = body.text.format.name === "vsi_research_plan_v1";
    if (planner && removeKeyAfterPlanner) delete process.env.GOOGLE_SHEETS_OPENAI_API_KEY;
    const output = planner ? { mode: "answer", businessEvidence: addSheetsDuringRetrieval, tier: "simple", clarification: "", publicTargets: [], objectives: [] }
      : { content: "Synthetic answer.", citationIds: [] };
    return new Response(JSON.stringify({ model: body.model, status: "completed", output_text: JSON.stringify(output), usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 });
  };
  process.env.GOOGLE_SHEETS_OPENAI_PROJECT_ID = "proj_synthetic";
  context = { ...context, containsGoogleSheets: true };
  for (const configuredGlobal of [undefined, globalKey]) {
    if (configuredGlobal === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = configuredGlobal;
    const offset = transports.length;
    await runVsiAnswer(vsiInput);
    assert.equal(transports.length - offset, 2);
    for (const transport of transports.slice(offset)) assert.equal(transport.headers.Authorization, `Bearer ${sheetsKey}`);
  }
  delete process.env.GOOGLE_SHEETS_OPENAI_API_KEY;
  const blockedOffset = transports.length;
  await assert.rejects(runVsiAnswer(vsiInput), error => error.usage.sourcePolicyFailure === "provider_configuration" && /provider connection is verified/.test(error.message));
  assert.equal(transports.length, blockedOffset, "VSI cannot fall back to the configured global key");
  process.env.GOOGLE_SHEETS_OPENAI_API_KEY = sheetsKey;
  removeKeyAfterPlanner = true;
  await assert.rejects(runVsiAnswer(vsiInput), error => error.usage.sourcePolicyFailure === "provider_configuration" && error.usage.providerCalls === 1);
  assert.equal(transports.length, blockedOffset + 1, "every VSI round rechecks dedicated configuration");
  removeKeyAfterPlanner = false;
  process.env.GOOGLE_SHEETS_OPENAI_API_KEY = sheetsKey;
  context = { ...context, containsGoogleSheets: false };
  const ordinaryVsiOffset = transports.length;
  await runVsiAnswer(vsiInput);
  for (const transport of transports.slice(ordinaryVsiOffset)) {
    assert.equal(transport.headers.Authorization, `Bearer ${globalKey}`);
    assert.equal(transport.headers["OpenAI-Project"], undefined);
  }
  addSheetsDuringRetrieval = true;
  const changingOffset = transports.length;
  await runVsiAnswer(vsiInput);
  assert.equal(transports[changingOffset].headers.Authorization, `Bearer ${globalKey}`);
  assert.equal(transports[changingOffset + 1].headers.Authorization, `Bearer ${sheetsKey}`,
    "VSI switches only after consumed Google sources are bound, including uncited context");
  assert.equal(process.env.OPENAI_API_KEY, globalKey, "policy never changes the existing global credential");
  // All denials stop before transport, preserve the paid-call count, and have
  // separate operational categories without storing raw DB messages.
  const deniedOffset = transports.length;
  context = { ...context, hasUnattributedDerivedSources: true };
  await assert.rejects(runVsiAnswer(vsiInput), error => error.usage.sourcePolicyFailure === "source_attribution" && /source review/.test(error.message));
  context = { ...context, hasUnattributedDerivedSources: false };
  databaseError = { code: "42501", message: "synthetic private detail must not escape" };
  await assert.rejects(runVsiAnswer(vsiInput), error => error.usage.sourcePolicyFailure === "source_access_denied" && !/private detail/.test(JSON.stringify(error.usage) + error.message));
  databaseError = null;
  const originalContext = context; context = { ...context, ticketId: "00000000-0000-4000-8000-000000000000" };
  await assert.rejects(runVsiAnswer(vsiInput), error => error.usage.sourcePolicyFailure === "source_authority_unavailable");
  context = originalContext;
  await assert.rejects(runVsiAnswer({ ...vsiInput, supabase: { rpc: async () => ({ data: null, error: { code: "40001" } }) } }), error => error.usage.sourcePolicyFailure === "read_ticket_unavailable");
  assert.equal(transports.length, deniedOffset, "no denial retries, fallback, or paid transport");
  process.stdout.write("Google-derived provider policy passed: dedicated Responses/embeddings/VSI credentials, missing-key and stale-ticket denial, no global/NVIDIA fallback, per-call source classification, and unchanged ordinary routing. No remote requests.\n");
})().catch(error => { console.error(error); process.exitCode = 1; });
