/* eslint-disable @typescript-eslint/no-require-imports -- Offline diagnostic boundary tests; no credentials or network. */
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { setImmediate: nextTurn } = require('node:timers/promises');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { SharedCitationFailure, sharedCitationDiagnostic, sharedCitationRpcFailure } = require('../lib/ai/shared-evidence/citation-diagnostics.ts');
const { reopenSharedCitation } = require('../lib/ai/shared-evidence/citation-reopen.ts');
const target = { workspaceId: '00000000-0000-4000-8000-000000000001', kind: 'vsi_exchange', id: '00000000-0000-4000-8000-000000000002' };
const marker = 'PRIVATE_SOURCE_TOKEN_SQL_AND_BODY_MUST_NEVER_LOG';
const keys = ['category', 'elapsedMs', 'httpStatus', 'reason', 'sqlCode', 'stage'];
let checks = 0;
function inspect(error, stage, category, reason) {
  const diagnostic = sharedCitationDiagnostic(error);
  assert.deepEqual(Object.keys(diagnostic).sort(), keys);
  assert.equal(diagnostic.stage, stage); assert.equal(diagnostic.category, category); assert.equal(diagnostic.reason, reason);
  assert(Number.isInteger(diagnostic.elapsedMs) && diagnostic.elapsedMs >= 0 && diagnostic.elapsedMs <= 60_000);
  assert(Object.isFrozen(diagnostic));
  assert.doesNotMatch(JSON.stringify(diagnostic), new RegExp(`${marker}|${target.id}|${target.workspaceId}|cause|stack|details|hint`));
  checks++;
  return diagnostic;
}
const cases = [
  ['42501', 'evidence_owner_required', 403, 'authorization', 'owner_required'],
  ['42501', 'evidence_live_session_required', 403, 'authorization', 'live_session_required'],
  ['42501', 'shared_evidence_inherited_actor_denied', 403, 'authorization', 'actor_denied'],
  ['42501', 'shared_target_unavailable', 403, 'lookup', 'artifact_lookup_unavailable'],
  ['42501', 'shared_reopen_unavailable', 403, 'lookup', 'artifact_lookup_unavailable'],
  ['42501', 'shared_evidence_reference_denied', 403, 'lookup', 'source_lookup_unavailable'],
  ['40001', 'shared_evidence_source_changed', 409, 'stale_binding', 'source_binding_changed'],
  ['40001', 'evidence_binding_changed', 409, 'stale_binding', 'source_binding_changed'],
  ['40001', 'shared_typed_identity_changed', 409, 'stale_binding', 'source_binding_changed'],
  ['42501', 'shared_typed_worksheet_head_denied', 403, 'eligibility', 'source_unavailable'],
  ['42501', 'evidence_connection_unavailable', 403, 'eligibility', 'source_unavailable'],
  ['42501', 'shared_evidence_inherited_artifact_changed', 403, 'rpc_failure', 'artifact_revalidation_failed'],
  ['54000', 'shared_reopen_budget_exceeded', 500, 'budget', 'reconstruction_budget_exceeded'],
  ['57014', marker, 500, 'cancellation', 'database_query_canceled'],
  ['', marker, 504, 'timeout', 'gateway_timeout'],
  ['PGRST202', marker, 404, 'rpc_contract', 'rpc_contract_unavailable'],
  ['42883', marker, 404, 'rpc_contract', 'rpc_contract_unavailable'],
  ['PGRST301', marker, 401, 'authorization', 'permission_denied'],
  ['42501', marker, 403, 'authorization', 'permission_denied'],
  ['', marker, 0, 'transport', 'request_failed'],
  ['40001', `shared_evidence_source_changed ${marker}`, 409, 'rpc_failure', 'database_error'],
  [marker, marker, 599, 'rpc_failure', 'database_error'],
  [marker, '__proto__', 500, 'rpc_failure', 'database_error'],
  [marker, 'constructor', 500, 'rpc_failure', 'database_error']
];
(async () => {
  for (const [code, message, status, category, reason] of cases) {
    const error = { code, message, details: marker, hint: marker, body: marker, request: target };
    const failure = sharedCitationRpcFailure(error, status, performance.now());
    assert.match(failure.message, /^shared_citation_unavailable:/);
    assert.doesNotMatch(JSON.stringify(failure), new RegExp(marker));
    inspect(failure, 'rpc_read', category, reason);
    await assert.rejects(reopenSharedCitation({ rpc: async () => ({ data: { private: marker }, error, status }) }, target), caught => {
      inspect(caught, 'rpc_read', category, reason); return true;
    });
  }
  inspect(new SharedCitationFailure('rpc_read', 'read_deadline_exceeded', performance.now() - 90_000), 'rpc_read', 'timeout', 'read_deadline_exceeded');
  for (const error of [new Error(marker), { diagnostic: { stage: marker }, message: marker }, marker, null]) {
    inspect(error, 'unexpected', 'unexpected', 'unexpected_failure');
  }
  const forged=Object.create(SharedCitationFailure.prototype);
  forged.diagnostic={stage:marker,extra:marker};
  inspect(forged,'unexpected','unexpected','unexpected_failure');
  const altered=new SharedCitationFailure('rpc_read','request_failed',performance.now());
  altered.diagnostic={stage:marker,extra:marker};
  inspect(altered,'rpc_read','transport','request_failed');
  inspect(new SharedCitationFailure(marker,marker,NaN,marker,599),'unexpected','unexpected','unexpected_failure');
  for (const reason of [{toString:()=> 'owner_required', private:marker}, Object.assign(new String('owner_required'),{private:marker})]) {
    const failure=new SharedCitationFailure('rpc_read',reason,performance.now());
    assert.equal(failure.message,'shared_citation_unavailable:unexpected_failure');
    inspect(failure,'unexpected','unexpected','unexpected_failure');
  }
  for (const abortMode of ['reject','resolve_error']) {
    mock.timers.enable({apis:['setTimeout']});
    let aborted=0;
    try {
      let rejectRead,resolveRead;
      const read=new Promise((resolve,reject)=>{resolveRead=resolve;rejectRead=reject;});
      read.abortSignal=signal=>{signal.addEventListener('abort',()=>{
        aborted++;
        if(abortMode==='reject') rejectRead(new Error(marker));
        else resolveRead({data:null,error:{message:marker},status:0});
      },{once:true});return read;};
      const result=reopenSharedCitation({rpc:()=>read},target).catch(error=>error);
      await nextTurn();mock.timers.tick(10_000);
      inspect(await result,'rpc_read','timeout','read_deadline_exceeded');
      assert.equal(aborted,1,'local deadline is identified even if abort settles the native promise synchronously');
    } finally {mock.timers.reset();}
  }
  await assert.rejects(reopenSharedCitation({ rpc() { throw new Error(marker); } }, target), error => {
    inspect(error, 'rpc_start', 'rpc_failure', 'request_creation_failed'); return true;
  });
  await assert.rejects(reopenSharedCitation({ rpc: async () => { throw new TypeError(marker); } }, target), error => {
    inspect(error, 'rpc_read', 'transport', 'request_failed'); return true;
  });
  for (const result of [undefined, null, { data: { stage: marker }, error: null, status: 200 }]) {
    await assert.rejects(reopenSharedCitation({ rpc: async () => result }, target), error => {
      inspect(error, 'envelope', 'response_validation', 'response_shape_invalid'); return true;
    });
  }
  const packet = { stage: 'revalidated_saved_evidence', artifact_kind: target.kind, artifact_id: target.id,
    artifact_revision: 'a'.repeat(64), projections: [] };
  for (const [projection, reason] of [
    [{ identity: { kind: 'inherited_artifact' }, hash: 'b'.repeat(64), data: { private: marker } }, 'ancestor_shape_invalid'],
    [{ identity: { kind: 'legacy_reference' }, hash: 'b'.repeat(64), data: { provider: 'xero', workspace_id: '00000000-0000-4000-8000-000000000099', private: marker } }, 'workspace_mismatch'],
    [{ identity: { kind: 'approved_note' }, hash: 'b'.repeat(64), data: { provider: 'business_note', workspace_id: target.workspaceId, private: marker } }, 'memory_projection_invalid']
  ]) {
    await assert.rejects(reopenSharedCitation({ rpc: async () => ({ data: { ...packet, projections: [projection] }, error: null }) }, target), error => {
      inspect(error, 'projection', 'projection_validation', reason); return true;
    });
  }
  console.log(JSON.stringify({ passed: true, diagnosticBoundaries: checks, rawErrorRetained: false, acceptanceRelaxed: false, externalCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
