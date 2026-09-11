const assert = require("node:assert/strict");
require("./square-account-browser-test-support.js").loadSquareBrowserModules();
const policy = require("../lib/integrations/providers/square/observation-admission.ts");
const { contractSha256 } = require("../lib/integrations/contracts/canonical.ts");
const mapping = require("../lib/integrations/providers/square/ingestion-mapping.ts");
const scope = { workspaceId:"10000000-0000-4000-8000-000000000001",businessEntityId:"30000000-0000-4000-8000-000000000001",
  connectionId:"20000000-0000-4000-8000-000000000001",sellerId:"SELLER_SYNTHETIC",environment:"sandbox",authorizedLocationIds:["LOC_SYNTHETIC"],generation:4 };
function fixture(type, revision="1") {
  const stream=type.startsWith("square_catalog")?"catalog":type.startsWith("square_inventory")?"inventory":type==="square_payment"?"payments":type==="square_refund"?"refunds":"order_tenders";
  const data=stream==="catalog"?{id:"SYNTHETIC",catalogObjectType:"ITEM_VARIATION",isDeleted:false,availability:{kind:"all_locations_except",absentLocationIds:[]}}:{id:"SYNTHETIC",locationId:"LOC_SYNTHETIC",exactValue:"-1.25"};
  const stableScope={...scope};delete stableScope.authorizedLocationIds;delete stableScope.generation;
  const pending={resourceKey:contractSha256({purpose:"square_source_resource_identity_v1",scope:stableScope,stream,providerRecordType:type,providerRecordId:"SYNTHETIC"}),scope,stream,providerRecordId:"SYNTHETIC",providerRecordType:type,providerRevision:{version:revision,updatedAt:null},observedAt:"2026-09-11T15:00:00Z",deleted:false,
    projection:{mappingVersion:mapping.SQUARE_SOURCE_MAPPING_VERSION,stream,role:"primary",authority:"pending_provider_observation_not_economic_authority",data}};
  pending.versionKey=contractSha256({purpose:"square_source_observed_version_v1",mappingVersion:mapping.SQUARE_SOURCE_MAPPING_VERSION,resourceKey:pending.resourceKey,providerRevision:pending.providerRevision,deleted:false,projection:pending.projection});
  const sourceVersion=mapping.materializeSquarePendingSource(pending,1,null);
  return {pending,sourceVersion,currentAuthority:{scopeFingerprint:contractSha256(scope),resourceKey:pending.resourceKey,currentVersionKey:pending.versionKey,sourceFingerprint:sourceVersion.sourceFingerprint,ordering:"newer",admittedAt:"2026-09-11T16:00:00Z"}};
}
let n=0;function check(fn){fn();n++;}
const inputs=policy.SQUARE_OBSERVATION_RECORD_TYPES.map(type=>fixture(type));
for(const input of inputs) check(()=>{const before=JSON.stringify(input.sourceVersion);const r=policy.prepareSquareObservationAdmission(input);assert.equal(r.outcome,"admitted");assert.equal(r.fact.value.kind,"structured");assert.equal(r.fact.value.value.economic,"blocked");assert.equal(r.fact.sources[0].contributionWeight,null);assert.equal(r.fact.accounting.basis,"not_applicable");assert.equal(JSON.stringify(input.sourceVersion),before);assert.equal(input.sourceVersion.validation.state,"pending");assert.ok(Object.isFrozen(r.fact.value.value));});
check(()=>assert.equal(new Set(inputs.map(x=>policy.prepareSquareObservationAdmission(x).fact.factKey)).size,7));
check(()=>assert.deepEqual(policy.reconcileSquareObservationAdmissions(inputs),policy.reconcileSquareObservationAdmissions([...inputs].reverse())));
check(()=>assert.deepEqual(policy.reconcileSquareObservationAdmissions(inputs),policy.reconcileSquareObservationAdmissions([...inputs,...inputs])));
check(()=>{const r=policy.prepareSquareObservationAdmission(inputs[3]);assert.equal(r.fact.value.value.applicability,"seller_scoped");assert.deepEqual(r.fact.value.value.projection.availability,inputs[3].pending.projection.data.availability);});
for(const [ordering,reason] of [["conflict","conflict"],["unordered","conflict"],["older","stale"]])check(()=>assert.equal(policy.prepareSquareObservationAdmission({...inputs[0],currentAuthority:{...inputs[0].currentAuthority,ordering}}).reason,reason));
check(()=>assert.equal(policy.prepareSquareObservationAdmission({...inputs[0],currentAuthority:{...inputs[0].currentAuthority,currentVersionKey:"sha256:"+"0".repeat(64)}}).reason,"stale"));
for(const change of [{sourceFingerprint:"sha256:"+"0".repeat(64)},{scopeFingerprint:"sha256:"+"0".repeat(64)},{resourceKey:"sha256:"+"0".repeat(64)},{extra:true}])check(()=>assert.throws(()=>policy.prepareSquareObservationAdmission({...inputs[0],currentAuthority:{...inputs[0].currentAuthority,...change}})));
for(const admittedAt of [undefined,"not-a-timestamp"])check(()=>assert.throws(()=>policy.prepareSquareObservationAdmission({...inputs[0],currentAuthority:{...inputs[0].currentAuthority,admittedAt}})));
check(()=>assert.throws(()=>policy.prepareSquareObservationAdmission({...inputs[0],pending:{...inputs[0].pending,providerRecordId:"FORGED"}})));
check(()=>assert.throws(()=>policy.prepareSquareObservationAdmission({...inputs[0],sourceVersion:{...inputs[0].sourceVersion,validation:{...inputs[0].sourceVersion.validation,state:"valid"}}})));
check(()=>{const a=policy.prepareSquareObservationAdmission(inputs[0]),b=policy.prepareSquareObservationAdmission(fixture("square_payment","2"));assert.equal(a.fact.factKey,b.fact.factKey);assert.notEqual(a.fact.id,b.fact.id);});
check(()=>{const a=policy.prepareSquareObservationAdmission(inputs[0]),b=policy.prepareSquareObservationAdmission({...inputs[0],currentAuthority:{...inputs[0].currentAuthority,admittedAt:"2026-09-11T17:00:00Z"}});assert.equal(a.fact.factFingerprint,b.fact.factFingerprint);assert.equal(a.fact.id,b.fact.id);assert.notEqual(a.fact.createdAt,b.fact.createdAt);assert.equal(b.fact.decision.decidedAt,b.fact.createdAt);assert.equal(b.fact.sourceObservedAt,inputs[0].pending.observedAt);});
check(()=>assert.throws(()=>policy.reconcileSquareObservationAdmissions(Array(101).fill(inputs[0]))));
check(()=>{const entries=[inputs[0],fixture("square_payment","2")];const r=policy.reconcileSquareObservationAdmissions(entries);assert.equal(r.observations.length,0);assert.deepEqual(r.excluded,["conflict"]);assert.deepEqual(r,policy.reconcileSquareObservationAdmissions(entries.reverse()));});
check(()=>{const x=[...inputs,{...inputs[0],currentAuthority:{...inputs[0].currentAuthority,ordering:"conflict"}}];const s=policy.summarizeSquareObservations(x);assert.equal(s.admitted,6);assert.equal(s.conflicted,1);assert.deepEqual(s,policy.summarizeSquareObservations([...x,...x].reverse()));assert.equal(s.counts.square_payment,0);});
console.log(`Square observation admission: ${n} focused assertions passed`);
console.log(`Policy fingerprint: ${policy.SQUARE_OBSERVATION_POLICY_FINGERPRINT}`);
