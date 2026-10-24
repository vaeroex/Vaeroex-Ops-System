/* eslint-disable @typescript-eslint/no-require-imports -- Offline boundary tests with synthetic state only. */
const assert = require('node:assert/strict');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadSource, React } = require('./integrations-ui-test-support');
const { VSI_SUGGESTED_PROMPTS: prompts, suggestedPromptDraft } = loadSource('lib/vsi/suggested-prompts.ts');
const retirement = loadSource('lib/ai/intelligence-briefing/retirement.ts');
let forbiddenCalls = 0;
const denied = () => { forbiddenCalls++; throw Error('External or mutation call forbidden'); };
global.fetch = denied;
const workspaceId = '10000000-0000-4000-8000-000000000001';

(async () => {
  assert.equal(prompts.length, 5);
  assert.equal(new Set(prompts.map(prompt => prompt.id)).size, 5);
  assert.match(prompts.find(prompt => prompt.id === 'weekly-brief').prompt, /last 7 days/);
  assert.match(prompts.find(prompt => prompt.id === 'executive-brief').prompt, /last 30 days/);
  assert.match(prompts.find(prompt => prompt.id === 'finding-plan').prompt, /ask me to choose it first; do not invent/);
  assert.match(prompts.find(prompt => prompt.id === 'explain-change').prompt, /ask me which one/);
  assert(!prompts.some(prompt => /opportunit|risk|priorit|attention/i.test(prompt.label)));
  for (const prompt of prompts) {
    assert.equal(suggestedPromptDraft('', prompt.id).draft, prompt.prompt);
    const draft = '  My existing question\nwith its details.  ';
    assert.equal(suggestedPromptDraft(draft, prompt.id).draft, `${draft}\n\n${prompt.prompt}`);
    assert.deepEqual(suggestedPromptDraft('x'.repeat(8000), prompt.id), { draft: 'x'.repeat(8000), added: false });
  }
  assert.deepEqual(suggestedPromptDraft('Keep me', 'unknown'), { draft: 'Keep me', added: false });
  assert.equal(retirement.separateBriefingGenerationRetired(), true);

  const action = loadSource('app/app/intelligence/briefings/actions.ts', {
    'next/cache': { revalidatePath: denied },
    '@/lib/supabase/admin': { createSupabaseAdminClient: denied },
    '@/lib/supabase/server': { createSupabaseServerClient: denied }
  }).generateIntelligenceBriefingAction;
  for (const briefingType of ['weekly', 'monthly', 'invalid']) {
    const result = await action({ briefingType });
    assert.equal(result.status, 'unavailable');
    assert.match(result.message, /Request a business brief in VSI/);
  }
  const claim = loadSource('lib/ai/intelligence-briefing/generation-claim.ts').claimIntelligenceBriefingGeneration;
  assert.deepEqual(await claim({ admin: { rpc: denied }, reader: {}, workspaceId, userId: workspaceId, sessionId: workspaceId,
    briefingType: 'weekly', generationKey: 'a'.repeat(64), inputJson: {} }), { status: 'failed_closed' });
  const service = loadSource('lib/ai/intelligence-briefing/service.ts');
  await assert.rejects(service.generateIntelligenceBriefing({ supabase: {}, workspaceId,
    briefingPackage: { workspaceId, eligibility: 'limited' }, readTicketId: workspaceId }), /separate_briefing_generation_retired/);
  const policy = loadSource('lib/ai/providers/workflow-provider-policy.ts');
  const previous = process.env.VAEROEX_INTELLIGENCE_BRIEFING_POLICY;
  process.env.VAEROEX_INTELLIGENCE_BRIEFING_POLICY = 'gpt56_sol_terra_v1';
  try { assert.equal(policy.isIntelligenceBriefingEnabled(), false); }
  finally { if (previous === undefined) delete process.env.VAEROEX_INTELLIGENCE_BRIEFING_POLICY; else process.env.VAEROEX_INTELLIGENCE_BRIEFING_POLICY = previous; }

  const reads = [];
  const History = loadSource('app/app/intelligence/briefings/page.tsx', {
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/workspaces/page-context': { requireWorkspacePage: async () => ({ supabase: {}, workspaceId }) },
    '@/lib/ai/intelligence-briefing/storage': { loadCurrentIntelligenceBriefing: async input => {
      reads.push(input); assert.equal(input.workspaceId, workspaceId);
      return input.briefingType === 'weekly' ? { artifact: { period: { start: '2026-10-01', end: '2026-10-07' } } } : null;
    } }
  }).default;
  const html = renderToStaticMarkup(await History());
  assert.equal(reads.length, 2);
  assert.match(html, /Saved briefs/); assert.match(html, /2026-10-01 through 2026-10-07/);
  assert.match(html, /\/app\/intelligence\/briefings\/weekly/); assert.match(html, /\/app\/reports/);
  assert.doesNotMatch(html, /<button|Generate|Refresh briefing/);
  assert.equal(forbiddenCalls, 0);
  console.log(JSON.stringify({ promptChoices: 5, draftPreserved: true, noAutoSubmit: true, retiredActionClaimProviderBlocked: true,
    formerEnvironmentFlagCannotEnable: true, savedHistoryRead: true, externalOrMutationCalls: forbiddenCalls }));
})().catch(error => { console.error(error); process.exitCode = 1; });
