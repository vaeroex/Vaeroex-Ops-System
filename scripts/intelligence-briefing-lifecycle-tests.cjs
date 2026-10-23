/* eslint-disable @typescript-eslint/no-require-imports -- Isolated lifecycle tests; no database or provider. */
const assert = require('node:assert/strict');
const { loadSource } = require('./integrations-ui-test-support');
const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const readTicketId = '55555555-5555-4555-8555-555555555555';
const contractId = 'intelligence_briefing_v1';
const authority = { workspaceId, userId, sessionId, readTicketId };
const artifact = { contractId, workspaceId, briefingType: 'monthly', generationKey: 'a'.repeat(64), measuredValue: 12.5 };
const inputJson = { workflow: contractId, google_sheets_read_ticket_id: readTicketId, generation_key: artifact.generationKey, briefing_type: 'monthly' };
const lifecycle = loadSource('lib/ai/intelligence-briefing/run-lifecycle.ts', {
  './storage': { parseIntelligenceBriefingArtifact: value => value?.contractId === contractId ? value : null }
});
global.fetch = async () => { throw Error('Network forbidden in lifecycle tests'); };

function lifecycleHarness(options = {}) {
  const calls = [], queries = [];
  const admin = { from() { throw Error('Direct lifecycle DML forbidden'); }, async rpc(name, args) {
    calls.push(name);
    assert.deepEqual(args, { p_workspace_id: workspaceId, p_actor_id: userId, p_session_id: sessionId,
      p_run_id: runId, p_read_ticket_id: readTicketId, p_agent_type: contractId,
      ...(name.startsWith('complete_') ? { p_output_json: artifact } : {}) });
    if (name.startsWith('complete_') && options.completeThrows) throw Error('PRIVATE transport detail');
    return { data: options.returnWrongId ? workspaceId : runId, error: name.startsWith('complete_') && options.completeDenied || name.startsWith('fail_') && options.failDenied ? { code: '42501' } : null };
  } };
  const reader = { from(table) {
    assert.equal(table, 'ai_agent_runs');
    const filters = [];
    const builder = { select() { return builder; }, eq(key, value) { filters.push([key, value]); return builder; }, async maybeSingle() {
      queries.push(filters);
      assert.deepEqual(filters, [['id',runId],['workspace_id',workspaceId],['created_by',userId],['agent_type',contractId]]);
      return { data: options.missing ? null : { id: runId, workspace_id: workspaceId, created_by: userId, agent_type: contractId,
        input_json: inputJson, output_json: artifact, status: options.runStatus || 'processing', archived_at: null, deleted_at: null, ...options.row },
      error: options.readDenied ? { code: '42501' } : null };
    } };
    return builder;
  } };
  return { calls, queries, run: () => lifecycle.completeIntelligenceBriefingRun({ admin, reader, authority, runId, artifact }) };
}

class ProviderError extends Error { constructor() { super('PRIVATE provider detail'); this.attempts = []; } }
const observedUsage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, model: 'synthetic-model',
  metadata: { estimated_cost_cents: 2, provider_attempts: [{ inputTokens: 100, outputTokens: 20 }] } };
function actionHarness(options = {}) {
  const calls = [], usages = [];
  const reader = { auth: { getUser: async () => ({ data: { user: { id: userId } } }), getClaims: async () => ({
    data: { claims: { sub: options.wrongSubject ? workspaceId : userId, session_id: options.badSession ? 'invalid' : sessionId } }, error: null
  }) } };
  const state = { status: 'ready', eligibility: 'limited', artifact: null };
  const mocks = {
    'next/cache': { revalidatePath: () => calls.push('revalidate') },
    '@/lib/integrations/google-sheets/read-authority': { beginGoogleSheetsRead: async () => { calls.push('ticket'); return { ticketId: readTicketId }; },
      bindGoogleSheetsRead: async (_reader, ticket) => { assert.equal(ticket,readTicketId); calls.push('bind'); }, googleSheetsReadTicketFields: ticket => ({ google_sheets_read_ticket_id: ticket }) },
    '@/lib/ai/intelligence-briefing/run-lifecycle': { verifiedBriefingSession: lifecycle.verifiedBriefingSession,
      completeIntelligenceBriefingRun: async ({ authority: actual, artifact: result }) => { calls.push('complete'); assert.deepEqual(actual,authority); assert.equal(result,artifact); return { status: options.completion || 'completed', artifact }; },
      failIntelligenceBriefingRun: async (_admin, actual, id) => { calls.push('fail'); assert.deepEqual(actual,authority); assert.equal(id,runId); return !options.failureUnconfirmed; } },
    '@/lib/ai/intelligence-briefing/generation-claim': { claimIntelligenceBriefingGeneration: async input => { calls.push('claim'); assert.equal(input.sessionId,sessionId); assert.equal(input.userId,userId); assert.equal(input.inputJson.google_sheets_read_ticket_id,readTicketId); return { status: options.claim || 'claimed', runId }; } },
    '@/lib/ai/intelligence-briefing/service': { intelligenceBriefingProviderAttemptTelemetry: value => value,
      generateIntelligenceBriefing: async () => { calls.push('generate'); if(options.providerFailure)throw new ProviderError(); return { artifact, usage: observedUsage }; } },
    '@/lib/ai/intelligence-briefing/storage': { loadCurrentIntelligenceBriefing: async () => null, briefingStateFromPackage: () => state },
    '@/lib/ai/intelligence-briefing/workspace-context': { buildWorkspaceIntelligenceBriefingPackage: async () => ({ briefingPackage: {
      ...artifact, period: { start: '2026-09-23', end: '2026-10-22', cutoff: '2026-10-22T23:59:59Z' } } }) },
    '@/lib/ai/provider-guardrails': { enforceAIProviderRateLimits: async () => undefined },
    '@/lib/ai/providers/provider-manager': { AIProviderExecutionError: ProviderError },
    '@/lib/ai/providers/workflow-provider-policy': { isIntelligenceBriefingEnabled: () => true },
    '@/lib/ai/usage': { recordVaeroexAiUsage: async ({ usage }) => { calls.push('usage'); usages.push(usage); } },
    '@/lib/billing/usage-limits': { isUsageLimitReached: async () => ({ subscription: { allowed: true }, reached: false }) },
    '@/lib/security/rate-limit': { enforceRateLimit: async () => ({ allowed: true }) },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from() { throw Error('Direct lifecycle DML forbidden'); } }) },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => reader },
    '@/lib/workspaces/current': { getWorkspaceContext: async () => ({ activeWorkspace: { id: workspaceId }, membership: {
      status: 'active', user_id: userId, workspace_id: options.foreignMembership ? userId : workspaceId } }) }
  };
  const { generateIntelligenceBriefingAction } = loadSource('app/app/intelligence/briefings/actions.ts', mocks);
  return { calls, usages, run: () => generateIntelligenceBriefingAction({ briefingType: 'monthly' }) };
}

(async () => {
  for(const claims of [{sub:userId,session_id:sessionId},{sub:workspaceId,session_id:sessionId},{sub:userId,session_id:'bad'}]) {
    const result = await lifecycle.verifiedBriefingSession({ auth: { getClaims: async () => ({ data: { claims }, error: null }) } },userId);
    assert.equal(result,claims.sub===userId&&claims.session_id===sessionId?sessionId:null);
  }
  assert.equal(await lifecycle.verifiedBriefingSession({ auth: { getClaims: async () => { throw Error('PRIVATE'); } } },userId),null);
  const direct=lifecycleHarness();assert.equal((await direct.run()).status,'completed');assert.equal(direct.calls.length,1);assert.equal(direct.queries.length,0);
  const recovered=lifecycleHarness({completeThrows:true,runStatus:'completed'});assert.equal((await recovered.run()).status,'completed');assert.equal(recovered.calls.length,1);
  const rejected=lifecycleHarness({completeDenied:true});assert.equal((await rejected.run()).status,'failed');assert.deepEqual(rejected.calls,['complete_trusted_derived_run_v1','fail_trusted_derived_run_v1']);
  for(const options of [{readDenied:true},{missing:true},{row:{created_by:workspaceId}},{row:{workspace_id:userId}},
    {row:{input_json:{...inputJson,google_sheets_read_ticket_id:sessionId}}},{row:{deleted_at:'2026-10-22'}},
    {runStatus:'completed',row:{output_json:{...artifact,measuredValue:13.5}}}]) {
    const h=lifecycleHarness({completeThrows:true,...options});assert.equal((await h.run()).status,'unavailable');assert.equal(h.calls.length,1,'uncertain or mismatched state cannot authorize failure mutation');
  }
  const failed=lifecycleHarness({completeThrows:true,runStatus:'failed'});assert.equal((await failed.run()).status,'failed');assert.equal(failed.calls.length,1);
  const deniedFailure=lifecycleHarness({completeDenied:true,failDenied:true});assert.equal((await deniedFailure.run()).status,'unavailable');assert.equal(deniedFailure.calls.length,2);
  for(const options of [{wrongSubject:true},{badSession:true},{foreignMembership:true}]) {
    const h=actionHarness(options);assert.equal((await h.run()).status,'unavailable');assert.equal(h.calls.length,0);
  }
  const claimDenied=actionHarness({claim:'failed_closed'});assert.equal((await claimDenied.run()).status,'failed');assert(!claimDenied.calls.includes('generate'));
  for(const completion of ['completed','failed','unavailable']) {
    const h=actionHarness({completion});assert.equal((await h.run()).status,completion==='completed'?'current':completion);
    assert.equal(h.calls.filter(value=>value==='generate').length,1);assert.equal(h.usages.length,1);assert(!h.calls.includes('fail'));
    assert.equal(h.usages[0].totalTokens,120);assert.equal(h.usages[0].metadata.estimated_cost_cents,2);
    if(completion!=='completed')assert.equal(h.usages[0].metadata.failure_stage,'artifact_persistence');
  }
  for(const failureUnconfirmed of [false,true]) {
    const h=actionHarness({providerFailure:true,failureUnconfirmed});const result=await h.run();
    assert.equal(result.status,failureUnconfirmed?'unavailable':'failed');assert(h.calls.includes('fail'));assert(!h.calls.includes('complete'));assert.equal(h.usages.length,1);
    assert(!JSON.stringify(result).includes('PRIVATE'));
  }
  console.log(JSON.stringify({passed:true,suite:'Briefing session, trusted terminal transitions, uncertain completion and observed cost preservation',databaseCalls:0,paidProviderCalls:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
