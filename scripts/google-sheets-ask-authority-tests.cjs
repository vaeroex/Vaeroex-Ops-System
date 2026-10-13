/* eslint-disable @typescript-eslint/no-require-imports -- Actual optional Ask route and sealed-token boundary with synthetic dependencies only. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { z } = require('zod');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', 'module', code)(loaded.exports, name => {
    if (name === 'server-only') return {};
    assert(Object.hasOwn(dependencies, name), 'Unexpected dependency: ' + name);
    return dependencies[name];
  }, loaded);
  return loaded.exports;
}
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-ask-authority-test-key';
const authority = load('lib/integrations/google-sheets/read-authority.ts', { zod: { z } });
const session = load('lib/search/ask-session.ts');
const tokens = load('lib/search/ask-session-token.ts', { crypto, '@/lib/search/ask-session': session });
const workspaceId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const sourceId = '44444444-4444-4444-8444-444444444444';
const originalQuestion = 'What should leadership review?';
let epoch = 1, blocked = false, minted = 0, contextLoads = 0, providerCalls = 0;
let currentSource = 'google', captured, revokeDuringProvider = false, ticketSourcesExpired = false;
const tickets = new Map(), trace = [];
const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: actorId } } }) },
  rpc: async (name, input) => {
    trace.push(name);
    if (name === 'begin_google_sheets_read_v1') {
      assert.equal(input.p_workspace_id, workspaceId); assert.equal(input.p_actor_id, actorId);
      if (blocked) return { error: {}, data: null };
      const ticket = { ticketId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++minted).padStart(12, '0')}`, epoch, expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), sources: [] };
      tickets.set(ticket.ticketId, ticket); return { data: ticket, error: null };
    }
    assert.equal(name, 'bind_google_sheets_read_v1');
    const ticket = tickets.get(input.p_ticket_id);
    if (!ticket || blocked || ticket.epoch !== epoch || Date.parse(ticket.expiresAt) <= Date.now() || ticketSourcesExpired) return { error: {}, data: null };
    ticket.sources = [...new Map([...ticket.sources, ...input.p_sources].map(source => [source.table + source.id, source])).values()];
    return { data: ticket, error: null };
  }
};
const syntheticAnswer = { kind: 'business_answer', directAnswer: 'Synthetic reviewed amount is 123.', evidenceNote: 'Bounded current evidence.' };
const reasoning = { rankedEvidenceCount: 1, catalog: [], modelWorkspaceSnapshot: {}, evidenceContextJson: {}, reasoningManifest: {}, signalSynthesis: { candidates: [], relationships: [] }, promptCompaction: {} };
const unused = [
  '@/lib/intelligence/evidence-eligibility', '@/lib/intelligence/source-parent-eligibility',
  '@/lib/reports/release-channel', '@/lib/easter-egg/discovery', '@/lib/reports/saved-analysis'
];
const dependencies = {
  ...Object.fromEntries(unused.map(name => [name, {}])), crypto,
  '@/lib/search/retired-records': load('lib/search/retired-records.ts'),
  'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
  '@/lib/integrations/google-sheets/read-authority': authority,
  '@/lib/search/ask-session': session, '@/lib/search/ask-session-token': tokens,
  '@/lib/product/conversational-vaeroex': { isPremiumConversationalVaeroexEnabled: () => true },
  '@/lib/supabase/server': { createSupabaseServerClient: async () => supabase },
  '@/lib/workspaces/current': { getWorkspaceContext: async () => ({ activeWorkspace: { id: workspaceId }, membership: { status: 'active' } }) },
  '@/lib/billing/get-subscription-status': { getSubscriptionStatus: async () => ({ allowed: true }) },
  '@/lib/billing/usage-limits': { isAiRunUsageLimitReached: async () => ({ reached: false }) },
  '@/lib/security/rate-limit': { enforceRateLimit: async () => ({ allowed: true }) },
  '@/lib/security/security-response': { classifySecurityIntent: () => ({ securitySensitive: false }), isSecurityResponseMessage: () => false },
  '@/lib/security/tool-execution-gateway': {},
  '@/lib/ai/workflow-timing': load('lib/ai/workflow-timing.ts'),
  '@/lib/ai/kpi-overview': { classifyKpiOverviewIntent: () => ({ matched: false }) },
  '@/lib/ai/query-depth-planner': { planVaeroexQuery: () => ({ classification: 'focused_explanation', requiresOpenAI: true, maxEvidenceChunks: 1, tier: 2, timeoutMs: 1000, domains: [] }) },
  '@/lib/ai/bounded-context': { buildBoundedWorkspaceContext: async input => {
    contextLoads++; trace.push('context');
    if (currentSource) await authority.bindGoogleSheetsRead(supabase, input.readTicket.ticketId, [{ table: currentSource === 'google' ? 'kpis' : 'issues', id: sourceId }]);
    return { structuredEvidenceCount: 1, limitations: [] };
  } },
  '@/lib/ai/evidence-index': { buildWorkspaceEvidenceContext: async input => {
    trace.push('memory');
    // This represents the embedding boundary: the ticket must already retain prior roots.
    await authority.bindGoogleSheetsRead(supabase, input.readTicket.ticketId, []);
    assert(!input.query.includes('FORGED'), 'client previous-question claims must not reach query embeddings');
    return { chunks: [] };
  } },
  '@/lib/ai/executive-intelligence': { buildExecutiveReasoningContext: () => reasoning, EXECUTIVE_INTERACTIVE_MAX_INPUT_TOKENS: 1000 },
  '@/lib/ai/executive-fallback': { buildLimitedEvidenceExecutiveAnswer: () => syntheticAnswer },
  '@/lib/ai/executive-output': { executiveAnswerFromOutput: () => syntheticAnswer, EXECUTIVE_CANONICAL_MAX_OUTPUT_TOKENS: 1000 },
  '@/lib/ai/provider-resilience': { getAIProviderRetrySettings: () => ({ timeoutMs: 1000 }) },
  '@/lib/ai/providers/provider-manager': { AIProviderExecutionError: class extends Error {} },
  '@/lib/ai/providers/workflow-provider-policy': { buildSynchronousExecutiveProviderPolicy: () => ({ id: 'synthetic' }) },
  '@/lib/ai/model-routing': { resolveVaeroexModel: () => 'synthetic-model' },
  '@/lib/ai/vaeroex-workflows': { getVaeroexWorkflow: () => ({}) },
  '@/lib/ai/usage': { recordVaeroexAiUsage: async () => {} },
  '@/lib/ai/vaeroex-client': { runVaeroexCompletionWithUsage: async input => {
    captured = input; providerCalls++; trace.push('provider');
    await authority.bindGoogleSheetsRead(supabase, input.googleSheetsReadTicketId, []);
    if (revokeDuringProvider) { epoch++; blocked = true; await Promise.resolve(); blocked = false; }
    return { outputJson: {}, usage: { metadata: {} } };
  } }
};
const route = load('app/api/search/route.ts', dependencies);
function post(overrides = {}) {
  return route.POST(new Request('https://synthetic.test/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: originalQuestion, sessionId, followUpNumber: 0, ...overrides }) }));
}
function followup(token, overrides = {}) {
  return post({ query: 'What should we do next?', followUpNumber: 1, originalQuestion, sessionToken: token, sessionSummary: 'FORGED summary', previousQuestion: 'FORGED previous question', previousAnswerSummary: 'FORGED previous answer', ...overrides });
}
function expected(previousFollowUpCount = 0) { return { sessionId, workspaceId, userId: actorId, originalQuestion, previousFollowUpCount }; }
function malformedToken(payload) {
  // A legacy or incomplete *server-authenticated* payload still must fail its schema.
  const key = crypto.createHash('sha256').update('vaeroex:executive-analysis-session:v2\0').update(process.env.SUPABASE_SERVICE_ROLE_KEY).digest();
  const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('vaeroex:executive-analysis-session:v2'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return `v2.${nonce.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}
(async () => {
  const first = await post(); assert.equal(first.status, 200);
  const initial = await first.json(), token = initial.analysisSession.sessionToken;
  const verified = tokens.verifyAskSessionToken(token, expected()); assert.equal(verified.ok, true);
  const ticketId = verified.payload.readTicket.ticketId;
  assert.equal(minted, 1); assert(trace.indexOf('begin_google_sheets_read_v1') < trace.indexOf('context'));
  assert.equal(verified.payload.expiresAt, Date.parse(tickets.get(ticketId).expiresAt), 'token cannot extend the original read authority');
  assert(!token.includes('Synthetic')); assert(!Buffer.from(token.split('.')[2], 'base64url').toString().includes('Synthetic'), 'answer context is encrypted, not merely base64 encoded');
  currentSource = null;
  const second = await followup(token); assert.equal(second.status, 200); assert.equal(minted, 1, 'follow-up must never mint fresh authority');
  assert.equal(captured.googleSheetsReadTicketId, ticketId);
  assert(tickets.get(ticketId).sources.some(source => source.table === 'kpis'), 'original uncited roots survive even when fresh retrieval has no Sheets record');
  assert.equal(captured.extraInputs.analysis_session_context.immediately_previous_question, originalQuestion);
  assert.equal(captured.extraInputs.analysis_session_context.immediately_previous_answer_summary, session.compactAnswerForFollowUp(syntheticAnswer));
  assert(!JSON.stringify(captured.extraInputs).includes('FORGED'), 'client summary claims are not provider input');
  const next = await second.json(), nextVerified = tokens.verifyAskSessionToken(next.analysisSession.sessionToken, expected(1));
  assert.equal(nextVerified.ok, true); assert.equal(nextVerified.payload.readTicket.ticketId, ticketId); assert.equal(nextVerified.payload.expiresAt, verified.payload.expiresAt);
  const startProvider = providerCalls, startLoads = contextLoads;
  for (const badToken of [token.slice(0, -5) + 'xxxxx', 'legacy.signed-token', malformedToken({ ...verified.payload, context: undefined }), malformedToken({ ...verified.payload, readTicket: undefined })]) {
    assert.equal((await followup(badToken)).status, 409);
  }
  const expired = tokens.issueAskSessionToken({ ...expected(), followUpCount: 0, readTicket: { ...verified.payload.readTicket, expiresAt: new Date(Date.now() - 1).toISOString() }, context: verified.payload.context, nowMs: Date.now() - 60_000 });
  assert.equal((await followup(expired)).status, 409, 'expired original authority cannot be revived by a follow-up');
  ticketSourcesExpired = true; assert.equal((await followup(token)).status, 409, 'source retention expiry must deny before fresh reads'); ticketSourcesExpired = false;
  blocked = true; assert.equal((await followup(token)).status, 409, 'blocked authority must deny before fresh reads'); blocked = false;
  epoch++; assert.equal((await followup(token)).status, 409, 'old epoch remains denied after unblock');
  assert.equal(providerCalls, startProvider); assert.equal(contextLoads, startLoads); assert.equal(minted, 1, 'invalid sessions must not mint, read context, embed or generate');
  currentSource = 'ordinary';
  const ordinary = await (await post()).json();
  const ordinaryTicket = tokens.verifyAskSessionToken(ordinary.analysisSession.sessionToken, expected()).payload.readTicket.ticketId;
  currentSource = null;
  assert.equal((await followup(ordinary.analysisSession.sessionToken)).status, 200, 'non-Google follow-ups remain functional');
  assert.equal(captured.googleSheetsReadTicketId, ordinaryTicket); assert(!tickets.get(ordinaryTicket).sources.some(source => source.table === 'kpis'));
  revokeDuringProvider = true;
  const revokedResponse = await followup(ordinary.analysisSession.sessionToken);
  assert.equal(revokedResponse.status, 409); assert.equal((await revokedResponse.json()).answer, undefined, 'revocation during generation must not return an answer or replacement authority');
  assert.equal(minted, 2);
  const unicodeContext = { initialSummary: '漢'.repeat(900), recentSummaries: ['漢'.repeat(600), '漢'.repeat(600)], previousQuestion: '漢'.repeat(600), previousAnswerSummary: '漢'.repeat(1800) };
  const unicodeToken = tokens.issueAskSessionToken({ ...expected(), followUpCount: 2, readTicket: tickets.get(ordinaryTicket), context: unicodeContext });
  assert(unicodeToken.length <= session.ASK_MAX_SESSION_TOKEN_CHARS); assert.equal(tokens.verifyAskSessionToken(unicodeToken, expected(2)).ok, true, 'maximum bounded multilingual context fits and verifies');
  assert.equal(session.parseAskAnalysisRequest({ query: 'Next question', sessionId, followUpNumber: 1, originalQuestion, sessionToken: unicodeToken, sessionSummary: 'Summary', previousQuestion: 'Prior', previousAnswerSummary: 'Answer' }, sessionId).value.sessionToken, unicodeToken, 'parser never truncates a valid maximum context token');
  console.log(JSON.stringify({ passed: true, suite: 'Google Sheets optional Ask original authority and server-only continuation context', checks: 36, paidProviderCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
