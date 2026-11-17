/* eslint-disable @typescript-eslint/no-require-imports -- Controlled signed-client/RPC replies; no network or credentials. */
const test = require('node:test');
const assert = require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { qualificationHash, qualificationCitationScope, qualificationSlot, assertQualificationSources } = require('../lib/vsi/qualification.ts');
const { reopenQualificationCitation } = require('../lib/vsi/qualification-citations.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const question = 'What changed in tracked hours and stock availability?';
const hashes = ['a'.repeat(64), 'b'.repeat(64)], now = Date.now();
const campaign = { campaignId: id(1), startsAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 600000).toISOString(), inspectCitations: true,
  slots: ['owner_private', 'demo_private', 'business_brief'].map((caseId, i) => ({ caseId, actorUserId: id(10 + i), workspaceId: id(20 + i),
    conversationId: id(30 + i), requestId: id(40 + i), questionHash: qualificationHash(question), approvedSourceHashes: i === 2 ? hashes : [],
    ...(i === 2 ? { approvedProviders: ['clockify', 'katana'] } : {}) })) };
const scope = { actorUserId: id(12), workspaceId: id(22), conversationId: id(32), question };
const target = { workspaceId: id(22), kind: 'vsi_exchange', id: id(52) };
const rows = [{ hash: hashes[0], provider: 'clockify' }, { hash: hashes[1], provider: 'katana' }];
function set(value = campaign) { process.env.VERCEL_ENV = 'preview'; process.env.VAEROEX_VSI_QUALIFICATION = JSON.stringify(value); }
function reader({ message = question, conversation = id(32), sources = rows, error = null, afterRead } = {}) {
  const calls = [], filters = [];
  const q = { select(value) { assert.equal(value, 'id,conversation_id,user_message'); return q; },
    eq(k, v) { filters.push([k, v]); return q; }, abortSignal(signal) { assert.equal(signal.aborted, false); return q; },
    async single() { calls.push('exchange'); afterRead?.(); return { data: { id: target.id, conversation_id: conversation, user_message: message }, error }; } };
  return { calls, filters, from(table) { assert.equal(table, 'vsi_exchanges'); return q; }, rpc(name, args) {
    calls.push(name); assert.equal(name, 'reopen_shared_evidence_target_v1');
    assert.deepEqual(args, { p_workspace_id: target.workspaceId, p_artifact_kind: target.kind, p_artifact_id: target.id });
    return Promise.resolve({ error, data: { stage: 'revalidated_saved_evidence', artifact_kind: target.kind, artifact_id: target.id,
      artifact_revision: 'c'.repeat(64), projections: sources.map(row => ({ identity: { kind: 'legacy_reference', reference_id: id(70) },
        hash: row.hash, data: { workspace_id: scope.workspaceId, provider: row.provider, facts: 'synthetic numeric source' } })) } });
  } };
}

test('new qualification provider pair is explicit, exact, unique and private slots cannot broaden source access', () => {
  set(); assertQualificationSources(scope, rows);
  assert.throws(() => assertQualificationSources(scope, [rows[0]]), /context/);
  assert.throws(() => assertQualificationSources(scope, [{ ...rows[0], provider: 'xero' }, rows[1]]), /context/);
  for (const providers of [['clockify', 'clockify'], ['clockify'], ['clockify', 'unknown']]) {
    set({ ...campaign, slots: campaign.slots.map(s => s.caseId === 'business_brief' ? { ...s, approvedProviders: providers } : s) });
    assert.throws(() => qualificationSlot(scope), /configuration/);
  }
  set({ ...campaign, slots: campaign.slots.map(s => ({ ...s, approvedProviders: ['clockify', 'katana'] })) });
  assert.throws(() => qualificationSlot(scope), /configuration/);
  const legacy = { ...campaign, slots: campaign.slots.map(({ approvedProviders, ...s }) => s) };
  set(legacy); assertQualificationSources(scope, [{ ...rows[0], provider: 'xero' }, { ...rows[1], provider: 'google_sheets' }]);
  assert.throws(() => assertQualificationSources(scope, rows), /context/);
});
test('inspection requires an opted-in live Preview business slot and retains ordinary closed gates', () => {
  set(); assert(qualificationCitationScope(scope));
  assert.equal(qualificationCitationScope({ ...scope, actorUserId: id(99) }), null);
  assert.equal(qualificationCitationScope({ ...scope, workspaceId: id(99) }), null);
  assert.equal(qualificationCitationScope(campaign.slots[0]), null);
  set({ ...campaign, inspectCitations: false }); assert.equal(qualificationCitationScope(scope), null);
  set({ ...campaign, expiresAt: new Date(now - 1).toISOString() }); assert.equal(qualificationCitationScope(scope), null);
  set(); process.env.VERCEL_ENV = 'production'; assert.equal(qualificationCitationScope(scope), null);
  for (const [path, name] of [['shared-evidence/runtime-gate', 'sharedEvidenceRuntimeEnabled'], ['shared-evidence/qualitative-policy', 'qualitativeSynthesisEnabled']])
    assert.equal(require(`../lib/ai/${path}.ts`)[name](), false);
});
test('signed-client exchange scope and exact normal source RPC are checked before rendering', async () => {
  set(); const r = reader();
  assert.equal((await reopenQualificationCitation(r, { ...scope, target })).length, 2);
  assert.deepEqual(r.calls, ['exchange', 'reopen_shared_evidence_target_v1']);
  assert.deepEqual(r.filters, [['id', target.id], ['workspace_id', scope.workspaceId], ['actor_user_id', scope.actorUserId], ['conversation_id', scope.conversationId]]);
  for (const changed of [{ target: { ...target, kind: 'report', revision: 'd'.repeat(64) } }, { actorUserId: id(99) }, { workspaceId: id(99) }]) {
    const denied = reader(); await assert.rejects(reopenQualificationCitation(denied, { ...scope, target, ...changed }), /scope/); assert.equal(denied.calls.length, 0);
  }
  for (const fixture of [{ message: 'different question' }, { conversation: id(99) }, { error: { code: '42501' } }]) {
    const denied = reader(fixture); await assert.rejects(reopenQualificationCitation(denied, { ...scope, target }), /exchange/); assert.deepEqual(denied.calls, ['exchange']);
  }
  await assert.rejects(reopenQualificationCitation(reader({ sources: [{ ...rows[0], hash: 'f'.repeat(64) }, rows[1]] }), { ...scope, target }), /context/);
  await assert.rejects(reopenQualificationCitation(reader({ afterRead: () => set({ ...campaign, expiresAt: new Date(now - 1).toISOString() }) }), { ...scope, target }), /scope/);
});
