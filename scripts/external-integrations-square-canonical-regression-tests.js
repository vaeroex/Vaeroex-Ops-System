const assert = require("node:assert/strict");
const {payment,refund,catalog,order,inventory,context,scope} = require("./square-canonical-test-support.js");
const {interpretSquareObservation:interpret,reconcileSquareInterpretations:reconcile} = require("../lib/integrations/providers/square/canonical-interpretation.ts");
const p = payment();
const result = interpret(p,context);
assert.equal(result.outcome,"interpreted");
assert.equal(result.money.total.amountMinor,"1200");
assert.equal(result.economic,"blocked");
for(const scan of ["partial","exhausted","interrupted","unavailable","unknown"]) for(const freshness of ["observed","stale","unknown"]) {
  const next=interpret(p,{...context,scan,freshness});
  assert.equal(next.fact.id,result.fact.id);
  assert.equal(next.fact.factFingerprint,result.fact.factFingerprint);
  assert.equal(next.historical,"unknown");
}
assert.deepEqual(reconcile([result,result]),reconcile([result]));
assert.throws(()=>reconcile([{...result}]));
assert.equal(interpret(p,{...context,authority:"revoked"}).outcome,"excluded");
assert.throws(()=>interpret(p,{...context,workspaceId:"10000000-0000-4000-8000-000000000002"}));
assert.equal(interpret({...p,currentAuthority:{...p.currentAuthority,ordering:"older"}},context).reason,"stale");
const r=interpret(refund(),context);
assert.equal(r.kind,"refund");
assert.ok(reconcile([r,result]).links.some(x=>x.state==="observed_id_match"));
console.log("Square canonical interpretation initial focused assertions passed");
const all=[result,r,interpret(catalog(),context),interpret(order(),context),...['count','physical','adjustment'].map(k=>interpret(inventory(k),context))];
assert.equal(all[2].money.listedPrice.amountMinor,"450");
assert.equal(all[2].timestamps.updatedAt,"2026-08-19T15:05:00.000Z");
assert.deepEqual(all[2].applicableLocationIds,["LOC_SYNTHETIC_1"]);
assert.equal(all[4].quantity,"0012.34000");
assert.equal(all[6].quantity,"1.25000");
assert.equal(all[6].units.resolution,"unverified");
for(const i of all) {
  assert.ok(i.fact.sources[0].sourceRecordVersionId);
  assert.equal(i.fact.accounting.basis,"not_applicable");
  assert.equal(i.fact.value.value.economic,"blocked");
  assert.ok(Object.isFrozen(i.fact));
}
const engine=require("../lib/integrations/deterministic/engine.ts");
const inc=require("../lib/integrations/providers/square/canonical-incremental.ts");
let state=engine.emptyDeterministicStateSnapshot(scope), before=[];
for(const next of [all,all,[...all.slice(1)],all,[...all].reverse(),[]]) {
  const actual=inc.updateSquareDescriptiveState(state,before,next,"2026-09-11");
  const oracle=engine.cleanFullRecompute({workspaceId:scope.workspaceId,businessEntityId:scope.businessEntityId,contributions:next.map(inc.squareDescriptiveControl),registry:inc.SQUARE_DESCRIPTIVE_REGISTRY,asOfDate:"2026-09-11",scopeHints:state.states});
  assert.equal(actual.snapshot.watermark.stateFingerprint,oracle.snapshot.watermark.stateFingerprint);
  if(before===next) assert.equal(actual.metrics.nodesRecalculated,0);
  state=actual.snapshot;before=next;
}
console.log("Square canonical all-resource and incremental oracle checks passed");
const stale=interpret(p,{...context,freshness:"stale"});
for(const pair of [[result,stale],[stale,result]]) assert.throws(()=>reconcile([...pair,r]));
for(const status of ["APPROVED","PENDING","COMPLETED","CANCELED","FAILED",null]) {
  const changed=interpret(payment({status,updated_at:"2026-09-02T12:01:00Z"}),context);
  assert.equal(changed.status,status); assert.equal(changed.fact.factKey,result.fact.factKey);
  assert.notEqual(changed.fact.id,result.fact.id); assert.equal(changed.economic,"blocked");
  const a=inc.updateSquareDescriptiveState(engine.emptyDeterministicStateSnapshot(scope),[],[result],"2026-09-11");
  const b=inc.updateSquareDescriptiveState(a.snapshot,[result],[changed],"2026-09-11");
  const oracle=engine.cleanFullRecompute({workspaceId:scope.workspaceId,businessEntityId:scope.businessEntityId,contributions:[changed].map(inc.squareDescriptiveControl),registry:inc.SQUARE_DESCRIPTIVE_REGISTRY,asOfDate:"2026-09-11",scopeHints:a.snapshot.states});
  assert.equal(b.snapshot.watermark.stateFingerprint,oracle.snapshot.watermark.stateFingerprint);
  assert.ok(b.metrics.nodesRecalculated<=2,"only old/new status buckets change");
}
const linkState=(a,b)=>reconcile([a,b]).links.find(l=>l.targetKind==="payment")?.state;
assert.equal(linkState(r,stale),"stale_or_unknown");
assert.equal(linkState(interpret(refund({location_id:"LOC_SYNTHETIC_2"}),context),result),"location_mismatch");
assert.equal(linkState(interpret(refund({amount_money:{amount:100,currency:"CAD"}}),context),result),"currency_mismatch");
assert.equal(linkState(interpret(refund({order_id:"DIFFERENT_ORDER"}),context),result),"reference_conflict");
assert.equal(linkState(interpret(refund({unlinked:true}),context),result),"explicitly_unlinked");
assert.ok(reconcile([r]).links.every(l=>l.state==="target_unobserved"));
assert.equal(interpret(payment({order_id:null}),context).references.length,0);
assert.equal(interpret(inventory("adjustment",{cost_money:{amount:999,currency:"USD"}}),context).money.cost.amountMinor,"999");
assert.equal(interpret(payment({amount_money:{amount:-999,currency:"USD"}}),context).money.amount.amountMinor,"-999");
for(let turn=0;turn<20;turn++) {
  const permutation=[...all].sort((a,b)=>((a.providerId.length+turn)%7)-((b.providerId.length+turn)%7));
  assert.equal(reconcile(permutation).fingerprint,reconcile(all).fingerprint);
}
const explain=require("../lib/integrations/providers/square/canonical-explanation.ts");
const id=n=>`80000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const snapshot=explain.squareVerifiedIntelligenceSnapshot(all,context.asOf);
assert.ok(!JSON.stringify(snapshot.assessment).includes("PAY_SYNTHETIC"));
assert.ok(!JSON.stringify(snapshot.assessment).includes("amountMinor"));
let ledger=explain.emptySquareExplanationLedger("2026-09-11");
const first=explain.reserveSquareExplanation(snapshot,{kind:"user_request",requestId:id(1)},ledger,context.asOf);
assert.equal(first.outcome,"reserved");ledger=first.ledger;
assert.equal(explain.reserveSquareExplanation(snapshot,{kind:"user_request",requestId:id(1)},ledger,context.asOf).reason,"duplicate_request");
assert.equal(explain.reserveSquareExplanation(snapshot,{kind:"user_request",requestId:id(2)},ledger,context.asOf).reason,"cooldown");
for(let n=2;n<=3;n++) {
  const at=`2026-09-11T${15+n}:00:00Z`,s=explain.squareVerifiedIntelligenceSnapshot(all,at);
  const claim=explain.reserveSquareExplanation(s,{kind:"scheduled_brief",cadence:"daily",requestId:id(n)},ledger,at);
  assert.equal(claim.outcome,"reserved");ledger=claim.ledger;
}
let at="2026-09-11T19:00:00Z",s=explain.squareVerifiedIntelligenceSnapshot(all,at);
assert.equal(explain.reserveSquareExplanation(s,{kind:"user_request",requestId:id(4)},ledger,at).reason,"daily_budget");
at="2026-09-12T16:00:00Z";s=explain.squareVerifiedIntelligenceSnapshot(all,at);
assert.equal(explain.reserveSquareExplanation(s,{kind:"user_request",requestId:id(1)},ledger,at).reason,"duplicate_request");
assert.throws(()=>explain.reserveSquareExplanation({...s},{kind:"user_request",requestId:id(4)},ledger,at));
assert.throws(()=>explain.reserveSquareExplanation(s,{kind:"transaction",requestId:id(4)},ledger,at));
const trigger={kind:"material_change",requestId:id(5),firstChangedAt:"2026-09-12T15:59:00Z",previousAggregateFingerprint:"sha256:"+"0".repeat(64)};
assert.equal(explain.reserveSquareExplanation(s,trigger,ledger,at).reason,"coalescing");
assert.equal(explain.reserveSquareExplanation(s,{...trigger,firstChangedAt:"2026-09-12T15:00:00Z",previousAggregateFingerprint:s.aggregateFingerprint},ledger,at).reason,"no_new_material_aggregate");
const claim=explain.reserveSquareExplanation(s,{...trigger,firstChangedAt:"2026-09-12T15:00:00Z"},ledger,at);
assert.equal(claim.outcome,"reserved");
at="2026-09-13T16:00:00Z";s=explain.squareVerifiedIntelligenceSnapshot(all,at);
assert.equal(explain.reserveSquareExplanation(s,{...trigger,requestId:id(6)},claim.ledger,at).reason,"no_new_material_aggregate");
console.log("Square canonical adversarial sequences, isolation, exact values and explanation limits passed");
