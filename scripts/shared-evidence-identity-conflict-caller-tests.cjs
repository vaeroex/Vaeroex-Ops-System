/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual-caller error-contract tests; no credentials or transport. */
const assert = require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({
  'server-only': {},
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => { throw Error('admin_client_forbidden'); } }
});
const { sharedRpc } = require('../lib/ai/shared-evidence/generation.ts');
const { reopenSharedCitation } = require('../lib/ai/shared-evidence/citation-reopen.ts');
const { sharedCitationDiagnostic } = require('../lib/ai/shared-evidence/citation-diagnostics.ts');
const target = { workspaceId: '00000000-0000-4000-8000-000000000001', kind: 'vsi_exchange', id: '00000000-0000-4000-8000-000000000002' };
const marker = 'PRIVATE_BODY_ARGUMENT_DETAIL_MUST_NOT_ESCAPE';
let cases = 0, rpcCalls = 0;

(async () => {
  for (const [code, message, expectedCategory, expectedReason] of [
    ['PT409', 'shared_typed_identity_changed', 'stale_binding', 'source_binding_changed'],
    ['PT409', `shared_typed_identity_changed ${marker}`, 'rpc_failure', 'database_error'],
    ['40001', 'shared_typed_identity_changed', 'stale_binding', 'source_binding_changed'],
    ['42501', 'evidence_owner_required', 'authorization', 'owner_required'],
    ['PT409', marker, 'rpc_failure', 'database_error']
  ]) {
    let attempts = 0;
    const reader = { rpc: async () => {
      attempts++; rpcCalls++;
      return { data: { stage: 'must_not_be_accepted', private: marker }, error: { code, message, details: marker, hint: marker }, status: code === '42501' ? 403 : 409 };
    } };
    await assert.rejects(sharedRpc(reader, 'seal_shared_evidence_manifest_v1', {}), error => {
      assert.equal(error.message, 'shared_evidence_authority_unavailable');
      assert.doesNotMatch(JSON.stringify(error), new RegExp(marker));
      return true;
    });
    assert.equal(attempts, 1, 'generation rejects after exactly one application RPC attempt');
    attempts = 0;
    await assert.rejects(reopenSharedCitation(reader, target), error => {
      const diagnostic = sharedCitationDiagnostic(error);
      assert.equal(diagnostic.category, expectedCategory);
      assert.equal(diagnostic.reason, expectedReason);
      assert.equal(diagnostic.httpStatus, code === '42501' ? 403 : 409);
      // Existing deployed diagnostic allowlist is deliberately unchanged.
      assert.equal(diagnostic.sqlCode, code === 'PT409' ? null : code);
      assert.doesNotMatch(JSON.stringify(diagnostic), new RegExp(`${marker}|${target.id}|${target.workspaceId}`));
      return true;
    });
    assert.equal(attempts, 1, 'read rejects after exactly one application RPC attempt');
    cases++;
  }
  let successCalls = 0;
  const valid = { stage: 'database_bound', manifest_id: 'synthetic' };
  assert.equal(await sharedRpc({ rpc: async () => { successCalls++; return { data: valid, error: null }; } }, 'seal_shared_evidence_manifest_v1', {}), valid);
  assert.equal(successCalls, 1); cases++;
  console.log(JSON.stringify({ passed: true, cases, errorRpcCalls: rpcCalls, actualApplicationCallers: true, rejectionAndRedactionPreserved: true,
    applicationRetries: 0, runtimeChanged: false, actualPostgrest14Executed: false, externalCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
