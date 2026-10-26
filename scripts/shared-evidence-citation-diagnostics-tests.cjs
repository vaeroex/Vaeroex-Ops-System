/* eslint-disable @typescript-eslint/no-require-imports -- Offline diagnostic boundary tests; no credentials or network. */
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { setImmediate: nextTurn } = require('node:timers/promises');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { SharedCitationFailure, sharedCitationDiagnostic, sharedCitationRpcFailure } = require('../lib/ai/shared-evidence/citation-diagnostics.ts');
const { reopenSharedCitation } = require('../lib/ai/shared-evidence/citation-reopen.ts');
const { SharedCitationReadTrace } = require('../lib/supabase/citation-read-trace.ts');
const target = { workspaceId: '00000000-0000-4000-8000-000000000001', kind: 'vsi_exchange', id: '00000000-0000-4000-8000-000000000002' };
const marker = 'PRIVATE_SOURCE_TOKEN_SQL_AND_BODY_MUST_NEVER_LOG';
const keys = ['category', 'elapsedMs', 'httpStatus', 'reason', 'sqlCode', 'stage'];
let checks = 0;
let traceChecks = 0;
function inspectTrace(trace, outcome, phase) {
  const snapshot = trace.finish(outcome);
  assert.deepEqual(Object.keys(snapshot).sort(), ['elapsedMs', 'milestones', 'outcome', 'phase', 'refreshStatus', 'rpcStatus']);
  assert.equal(snapshot.outcome, outcome); assert.equal(snapshot.phase, phase);
  assert(Object.isFrozen(snapshot)); assert(Object.isFrozen(snapshot.milestones));
  for (const value of [snapshot.elapsedMs, ...Object.values(snapshot.milestones)]) {
    assert(Number.isSafeInteger(value) && value >= 0 && value <= 60000);
  }
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(`${marker}|${target.id}|${target.workspaceId}|Bearer|https?:|authorization|body_value|session_value`));
  traceChecks++;
  return snapshot;
}
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
  const origin='https://citation-fixture.invalid', endpoint=`${origin}/rest/v1/rpc/reopen_shared_evidence_target_v1`;
  const options={method:'POST',headers:{authorization:marker},body:marker,signal:new AbortController().signal};
  const trace=new SharedCitationReadTrace(); let fetches=0,reads=0;
  const response=new Response(marker,{status:200,headers:{'private-header':marker}});
  const originalText=response.text.bind(response); response.text=()=>{reads++;return originalText();};
  const transport=trace.wrapFetch(async(input,init)=>{fetches++;assert.equal(input,endpoint);assert.equal(init,options);return response;},origin);
  trace.begin();
  const observed=await transport(endpoint,options);
  assert.equal(fetches,1);assert.equal(reads,0,'observing response headers must not eagerly read the body');
  assert.equal(observed.status,200);assert.equal(observed.bodyUsed,false);
  assert.equal(await observed.text(),marker);assert.equal(observed.bodyUsed,true);assert.equal(reads,1);
  trace.clientComplete();
  const completed=inspectTrace(trace,'completed','client_complete');
  assert.deepEqual(Object.keys(completed.milestones),['read_entry','rpc_fetch_invoked','rpc_headers_received','rpc_body_read','rpc_body_complete','client_complete']);
  assert.equal(completed.rpcStatus,'2xx');assert.equal(completed.refreshStatus,'not_observed');
  assert.equal(trace.finish('failed'),completed,'a late settlement cannot replace the final snapshot');

  for(const disposition of ['resolve','reject']) {
    const sessionTrace=new SharedCitationReadTrace();let settle,calls=0;
    const pending=new Promise((resolve,reject)=>{settle=disposition==='resolve'?resolve:reject;});
    const wrapped=sessionTrace.wrapSession(()=>{calls++;return pending;});
    sessionTrace.begin();assert.equal(wrapped(),pending,'session observation returns the exact original promise');assert.equal(calls,1);
    const stopped=inspectTrace(sessionTrace,'deadline','session_call_pending');
    const untouched={get session_value(){throw new Error('session_result_must_not_be_inspected');}};
    settle(untouched);await pending.catch(()=>{});await nextTurn();
    assert.equal(sessionTrace.finish('failed'),stopped,'late session observers cannot rewrite a deadline');
  }
  for(const disposition of ['resolve','reject']) {
    const sessionTrace=new SharedCitationReadTrace();const original=disposition==='resolve'?Promise.resolve({session_value:marker}):Promise.reject(new Error(marker));
    sessionTrace.begin();const observed=sessionTrace.wrapSession(()=>original)();assert.equal(observed,original);
    await observed.catch(error=>{assert.equal(error.message,marker);});await nextTurn();
    inspectTrace(sessionTrace,disposition==='resolve'?'completed':'failed',disposition==='resolve'?'session_call_settled':'session_call_rejected');
  }
  // Operations invoked during guards stay unobserved even if they settle after begin().
  const inactive=new SharedCitationReadTrace();let releaseGuard;
  const guardPromise=new Promise(resolve=>{releaseGuard=resolve;});
  assert.equal(inactive.wrapSession(()=>guardPromise)(),guardPromise);
  const guardFetch=inactive.wrapFetch(()=>guardPromise,origin)(endpoint,options);
  inactive.begin();releaseGuard(new Response(marker));await guardFetch;await nextTurn();
  inspectTrace(inactive,'completed','read_entry');
  for(const input of [`https://foreign.invalid/rest/v1/rpc/reopen_shared_evidence_target_v1`,`${origin}/rest/v1/private/${marker}`]) {
    const unmatched=new SharedCitationReadTrace();unmatched.begin();const original=new Response(marker);
    const result=await unmatched.wrapFetch(async(value,init)=>{assert.equal(value,input);assert.equal(init,options);return original;},origin)(input,options);
    assert.equal(result,original);assert.equal(original.bodyUsed,false);inspectTrace(unmatched,'completed','read_entry');
  }
  for(const kind of ['rpc','refresh']) {
    const destination=kind==='rpc'?endpoint:`${origin}/auth/v1/token?grant_type=refresh_token`;
    const method=kind==='rpc'?'text':'json';const content=kind==='rpc'?marker:JSON.stringify({session_value:marker});
    const good=new SharedCitationReadTrace();good.begin();
    const observed=await good.wrapFetch(async()=>new Response(content,{status:200}),origin)(destination,options);
    const result=await observed[method]();assert.deepEqual(result,kind==='rpc'?marker:{session_value:marker});
    inspectTrace(good,'completed',`${kind}_body_complete`);
    const failure=new Error(marker),failed=new SharedCitationReadTrace();failed.begin();
    await assert.rejects(failed.wrapFetch(async()=>{throw failure;},origin)(destination,options),error=>error===failure);
    inspectTrace(failed,'failed',`${kind}_fetch_rejected`);
    const bodyFailed=new SharedCitationReadTrace();bodyFailed.begin();const broken=new Response(content,{status:403});
    broken[method]=async()=>{throw failure;};
    await assert.rejects((await bodyFailed.wrapFetch(async()=>broken,origin)(destination,options))[method](),error=>error===failure);
    const snapshot=inspectTrace(bodyFailed,'failed',`${kind}_body_rejected`);assert.equal(snapshot[`${kind}Status`],'4xx');
  }
  // Independent requests cannot overwrite each other's milestones or final status.
  const isolatedA=new SharedCitationReadTrace(),isolatedB=new SharedCitationReadTrace();isolatedA.begin();isolatedB.begin();
  const late=isolatedA.wrapFetch(async()=>new Response(marker),origin)(endpoint,options);
  const beforeLate=inspectTrace(isolatedA,'deadline','rpc_fetch_invoked');await late;
  assert.equal(isolatedA.finish('failed'),beforeLate);inspectTrace(isolatedB,'completed','read_entry');
  console.log(JSON.stringify({ passed: true, diagnosticBoundaries: checks, traceBoundaries:traceChecks, rawErrorRetained: false, acceptanceRelaxed: false, externalCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
