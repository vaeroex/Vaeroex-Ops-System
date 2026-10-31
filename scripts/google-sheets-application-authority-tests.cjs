/* eslint-disable @typescript-eslint/no-require-imports -- Isolated application boundary tests use the actual TypeScript helper and HTTP implementation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { z } = require('zod');
const root = path.resolve(__dirname, '..');
function load(file, deps) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', 'module', code)(loaded.exports, name => {
    if (name === 'server-only') return {};
    assert(Object.hasOwn(deps, name), 'Unexpected dependency: ' + name);
    return deps[name];
  }, loaded);
  return loaded.exports;
}
const preparationDiagnostics = load('lib/ai/shared-evidence/preparation-diagnostics.ts', { zod: { z } });
const authority = load('lib/integrations/google-sheets/read-authority.ts', { zod: { z },
  '@/lib/ai/shared-evidence/preparation-diagnostics': preparationDiagnostics });
const workspaceId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const exchangeId = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
const uncitedId = '66666666-6666-4666-8666-666666666666';
let epoch = 1, blocked = false, minted = 0, trace = [], accepted = [], tickets = new Map();
const supabase = { rpc: async (name, args) => {
  trace.push(name);
  if (name === 'begin_google_sheets_read_v1') {
    assert.equal(args.p_workspace_id, workspaceId);
    if (blocked) return { error: new Error('blocked'), data: null };
    const ticket = { ticketId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++minted).padStart(12, '0')}`, epoch, expiresAt: '2099-01-01T00:00:00Z' };
    tickets.set(ticket.ticketId, { ...ticket, sources: [] }); return { data: ticket, error: null };
  }
  assert.equal(name, 'bind_google_sheets_read_v1');
  const ticket = tickets.get(args.p_ticket_id);
  if (!ticket || blocked || ticket.epoch !== epoch) return { error: new Error('stale'), data: null };
  ticket.sources = [...new Map([...ticket.sources, ...args.p_sources].map(x => [x.table + ':' + x.id, x])).values()];
  return { data: ticket, error: null };
} };
class VsiHttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
class VsiEngineError extends Error {}
let staleDuringProvider = false, providerTicket;
const deps = {
  '@/lib/vsi/qualification': load('lib/vsi/qualification.ts', { zod: { z }, 'node:crypto': require('node:crypto') }),
  'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } }, zod: { z },
  '@/lib/integrations/google-sheets/read-authority': authority,
  '@/lib/security/rate-limit': { enforceRateLimit: async () => ({ allowed: true }) },
  '@/lib/vsi/request-boundary': { readVsiJson: r => r.json() },
  '@/lib/vsi/sensitive-input': { hasProhibitedVsiIdentifiers: () => false },
  '@/lib/vsi/config': { getVsiConfig: () => ({ maxQuestionChars: 8000, requestReserveUsd: 0.25, workspaceMonthlyBudgetUsd: 50 }) },
  '@/lib/vsi/engine': { VsiEngineError, runVsiAnswer: async input => {
    trace.push('provider'); providerTicket = input.readTicket.ticketId;
    // Simulate real retrieval binding an actually consumed source omitted from citations.
    await authority.bindGoogleSheetsRead(supabase, providerTicket, [{ table: 'kpis', id: uncitedId }]);
    if (staleDuringProvider) { blocked = true; epoch++; await Promise.resolve(); blocked = false; }
    return { content: 'Synthetic answer', citations: [], usage: { estimatedCostUsd: 0.01 } };
  } },
  '@/lib/vsi/storage': {
    VsiHttpError, vsiUuid: z.string().uuid(), questionHash: () => 'synthetic', updateVsiSummary: () => 'summary',
    requireVsiAccess: async () => ({ supabase, workspaceId, userId: actorId, canEditBusinessNotes: true }),
    loadVsiConversation: async () => {
      trace.push('transcript');
      return { row: { context_summary: '', parent_conversation_id: null }, conversation: { id: conversationId }, exchanges: [{ id: exchangeId, userMessage: 'Prior question', answer: 'Prior answer', citations: [] }] };
    },
    mutateVsi: async (_access, action, input) => {
      if (action === 'reserve') return { state: 'reserved', request: { id: requestId, attempt: 1 } };
      assert.equal(action, 'settle'); trace.push('commit');
      assert.equal(input.readTicketId, providerTicket, 'completion must retain the pre-read ticket');
      await authority.bindGoogleSheetsRead(supabase, input.readTicketId, []);
      accepted.push(input); return {};
    }
  }
};
// The HTTP layer now delegates settlement through named wrappers. Keep this
// authority fixture's existing commit checks; shared settlement is qualified by
// its separate application/SQL fixtures, not substituted here.
deps['@/lib/vsi/storage'].settleGeneratedVsi = async (access, input, manifestId) => {
  assert.equal(manifestId, undefined, 'this legacy-path fixture supplies no shared manifest');
  return deps['@/lib/vsi/storage'].mutateVsi(access, 'settle', input);
};
deps['@/lib/vsi/storage'].settleFailedVsi = async (access, input) =>
  deps['@/lib/vsi/storage'].mutateVsi(access, 'settle', { ...input, usage: { ...input.usage, failed: true } });
const { vsiRoute } = load('lib/vsi/http.ts', deps);
function request() { return new Request('https://synthetic.test/api/vsi/conversations/' + conversationId + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedWorkspaceId: workspaceId, message: 'Review our aggregate operations', requestId }) }); }
(async () => {
  const ticket = await authority.beginGoogleSheetsRead(supabase, workspaceId, actorId);
  await authority.bindGoogleSheetsRead(supabase, ticket.ticketId, [{ table: 'kpis', id: uncitedId }, { table: 'kpis', id: uncitedId }]);
  assert.equal(tickets.get(ticket.ticketId).sources.length, 1);
  for (const sources of [[{ table: 'kpis', id: 'not-uuid' }], [{ table: 'untrusted.table', id: uncitedId }]]) await assert.rejects(authority.bindGoogleSheetsRead(supabase, ticket.ticketId, sources), /Workspace data changed/);
  const count = trace.length;
  await assert.rejects(authority.bindGoogleSheetsRead(supabase, 'invalid', [])); assert.equal(trace.length, count, 'invalid authority never reaches RPC');
  for (const data of [null, {}, { ...ticket, epoch: -1 }, { ...ticket, expiresAt: 'invalid' }]) await assert.rejects(authority.beginGoogleSheetsRead({ rpc: async () => ({ data, error: null }) }, workspaceId));
  await assert.rejects(authority.bindGoogleSheetsRead({ rpc: async () => ({ data: { ...ticket, ticketId: requestId }, error: null }) }, ticket.ticketId, []));
  blocked = true; await assert.rejects(authority.beginGoogleSheetsRead(supabase, workspaceId)); blocked = false;
  epoch++; await assert.rejects(authority.bindGoogleSheetsRead(supabase, ticket.ticketId, []), /Workspace data changed/, 'unblocking does not revive old ticket');
  trace = []; minted = 0; tickets = new Map();
  const success = await vsiRoute(request(), 'messages', conversationId);
  assert.equal(success.status, 200); assert.equal(accepted.length, 1); assert.equal(minted, 1);
  assert(trace.indexOf('begin_google_sheets_read_v1') < trace.indexOf('transcript'), 'authority starts before private context reads');
  assert(trace.indexOf('bind_google_sheets_read_v1') < trace.indexOf('provider'));
  const consumed = tickets.get(providerTicket).sources;
  for (const [table, id] of [['vsi_conversations', conversationId], ['vsi_exchanges', exchangeId], ['kpis', uncitedId]]) assert(consumed.some(x => x.table === table && x.id === id), 'all consumed roots survive even without citations');
  trace = []; staleDuringProvider = true; accepted = []; const before = minted;
  const log = console.error; console.error = () => {};
  let denied; try { denied = await vsiRoute(request(), 'messages', conversationId); } finally { console.error = log; }
  assert.equal(denied.status, 503); assert.equal(accepted.length, 0); assert.equal(minted - before, 1, 'no remint after asynchronous stale-epoch rejection');
  // Execute the actual reviewed-note indexing function. Provider inputs retain
  // the original ticket; a completion after an epoch change cannot publish memory.
  let embeddingMarker, changeDuringEmbedding = false, published = 0;
  const { indexApprovedBusinessNote } = load('lib/ai/business-notes/indexing.ts', {
    crypto: require('node:crypto'),
    '@/lib/integrations/google-sheets/read-authority': authority,
    '@/lib/ai/business-notes/approved-context-text': load('lib/ai/business-notes/approved-context-text.ts', {
      './review-context': { businessNoteUserAddedContextText: () => [] }
    }),
    '@/lib/ai/evidence-index': { chunkEvidenceText: text => [text] },
    '@/lib/ai/usage': { estimateTokenCount: () => 20 },
    '@/lib/ai/providers/provider-manager': { createAIEmbeddings: async (_chunks, _timeout, options) => {
      embeddingMarker = options.googleSheetsReadTicketId;
      if (changeDuringEmbedding) { epoch++; await Promise.resolve(); }
      return { embeddings: [[0.1]], model: 'synthetic-embedding', error: null };
    } }
  });
  const note = { id: uncitedId, workspace_id: workspaceId, status: 'review_required', source_version: 1, original_file_id: null, release_channel: 'production' };
  const extraction = { title: 'Aggregate reported context', noteType: 'meeting', sourceClassification: 'reported', departments: [], topics: [], summary: 'Synthetic context', reportingPeriod: { start: null, end: null }, explicitFacts: [], opinionsOrAssumptions: [], risks: [], opportunities: [], decisions: [], peopleMentioned: [], customersMentioned: [], vendorsMentioned: [], projectsMentioned: [], mentionedMetrics: [], extractionDisposition: 'extractable', evidenceTreatment: 'contextual', extractionConfidence: 0.9 };
  const memoryClient = { from: table => { assert.equal(table, 'business_memory_chunks'); return { upsert: async rows => {
    const ticketId = rows[0].google_sheets_read_ticket_id;
    assert.equal(rows[0].source_metadata.google_sheets_read_ticket_id, ticketId);
    assert.equal(embeddingMarker, ticketId);
    try { await authority.bindGoogleSheetsRead(supabase, ticketId, []); published += rows.length; return { error: null }; }
    catch { return { error: { message: 'stale authority' } }; }
  } }; } };
  let indexTicket = await authority.beginGoogleSheetsRead(supabase, workspaceId, actorId);
  const indexInput = () => ({ supabase: memoryClient, authoritySupabase: supabase, readTicketId: indexTicket.ticketId, workspaceId, note, extraction, userAddedContext: [], approvedBy: actorId });
  assert.equal((await indexApprovedBusinessNote(indexInput())).indexedChunks, 1);
  assert(tickets.get(indexTicket.ticketId).sources.some(source => source.table === 'business_notes' && source.id === note.id));
  indexTicket = await authority.beginGoogleSheetsRead(supabase, workspaceId, actorId); changeDuringEmbedding = true;
  const deniedMemory = await indexApprovedBusinessNote(indexInput());
  assert.equal(deniedMemory.indexedChunks, 0); assert.equal(published, 1);
  console.log(JSON.stringify({ passed: true, suite: 'Google Sheets application read authority, paused VSI commit and approved-memory embedding fences', checks: 27, paidProviderCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
