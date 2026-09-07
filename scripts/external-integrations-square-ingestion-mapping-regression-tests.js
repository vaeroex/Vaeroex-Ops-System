const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = function(module, filename) {
  let source = fs.readFileSync(filename, "utf8");
  // Exercise the private structural guard without exporting a production bypass.
  if (filename.endsWith("/ingestion-mapping.ts")) source += "\nexport const mappingInspectForTests = inspect;";
  module._compile(ts.transpileModule(source, { compilerOptions: {
    esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  }, fileName: filename }).outputText, filename);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
  return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const mapping = require("../lib/integrations/providers/square/ingestion-mapping.ts");
const order = require("../lib/integrations/providers/square/order-responses.ts");
const payment = require("../lib/integrations/providers/square/payment-responses.ts");
const refund = require("../lib/integrations/providers/square/refund-responses.ts");
const inventory = require("../lib/integrations/providers/square/inventory-responses.ts");
const catalog = require("../lib/integrations/providers/square/catalog-response-validation.ts");
const of = require("../lib/integrations/providers/square/fixtures/phase-2b2b3.ts");
const ob = require("../lib/integrations/providers/square/fixtures/phase-2b2a.ts");
const pf = require("../lib/integrations/providers/square/fixtures/payment-responses.ts");
const rf = require("../lib/integrations/providers/square/fixtures/refund-responses.ts");
const inf = require("../lib/integrations/providers/square/fixtures/inventory-responses.ts");
const cf = require("../lib/integrations/providers/square/fixtures/catalog-response-validation.ts");
const oldCatalog = require("../lib/integrations/providers/square/fixtures/phase-2b1b1.ts");
const generic = require("../lib/integrations/contracts/source-facts.ts");
const canonical = require("../lib/integrations/contracts/canonical.ts");
const identity = require("../lib/integrations/persistence/identity.ts");
const serializer = require("../lib/integrations/persistence/serializers.ts");
let assertions = 0;
const equal = (a,b,m) => { assertions++; assert.equal(a,b,m); };
const ok = (v,m) => { assertions++; assert.ok(v,m); };
const throws = (f,m) => { assertions++; assert.throws(f,undefined,m); };
const clone = v => JSON.parse(JSON.stringify(v));
const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001", businessEntityId: "30000000-0000-4000-8000-000000000001",
  connectionId: "20000000-0000-4000-8000-000000000001", sellerId: "MERCHANT_SYNTHETIC_1", environment: "sandbox",
  authorizedLocationIds: ["LOC_SYNTHETIC_1", "LOC_SYNTHETIC_2"], generation: 1
};
const orderScope = { ...scope, connectionId: ob.SQUARE_PHASE_2B2A_SYNTHETIC_CONNECTION_ID,
  sellerId: ob.SQUARE_PHASE_2B2A_SYNTHETIC_MERCHANT_ID,
  authorizedLocationIds: [ob.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID, ob.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_LOCATION_ID] };
const observedAt = "2026-09-06T23:00:00Z";
function accepted(result) { equal(result.outcome, "accepted", JSON.stringify(result.diagnostics)); return result.value; }
function count(value, containersOnly = true) {
  if (!value || typeof value !== "object") return containersOnly ? 0 : 1;
  return 1 + Object.values(value).reduce((sum, child) => sum + count(child, containersOnly), 0);
}
function frozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value); ok(Object.isFrozen(value), "deep immutability"); Object.values(value).forEach(child => frozen(child,seen));
}
const map = (stream, value, s=scope, at=observedAt) => mapping.mapSquareParsedPage(s, stream, value, at, value.pagination.cursorPresent);
const makePayment = (raw=pf.squarePaymentFixture(), operation="retrieve_payment", extra={}) => accepted(payment.parseSquarePaymentResponse(pf.squarePaymentParserInput(operation === "retrieve_payment" ? {payment:raw} : {payments:Array.isArray(raw)?raw:[raw]},operation,extra)));
const makeRefund = (raw=rf.squareRefundFixture(), operation="retrieve_payment_refund", extra={}) => accepted(refund.parseSquareRefundResponse(rf.squareRefundParserInput(operation === "retrieve_payment_refund" ? {refund:raw} : {refunds:Array.isArray(raw)?raw:[raw]},operation,extra)));
const makeCatalog = (raw=cf.squareCatalogValidationFixture(), extras={}, context={objectId:raw.id,query:{}}) => accepted(catalog.parseSquareCatalogValidatedResponse(cf.squareCatalogValidationParserInput({object:raw,...extras},"retrieve_catalog_object",{requestContext:context})));
const orderParsers = [
  ["order_core", order.parseSquareOrderCoreResponse], ["order_line_items", order.parseSquareOrderLineItemResponse],
  ["order_adjustments", order.parseSquareOrderAdjustmentResponse], ["order_tenders", order.parseSquareOrderTenderResponse]
];

function streamCoverage() {
  const seen = new Set();
  for (const [stream, parser] of orderParsers) {
    const value = accepted(parser(of.squarePhase2B2B3ParserInput({order:of.squarePhase2B2B3Order()})));
    const page = map(stream,value,orderScope); seen.add(stream); frozen(page);
    equal(page.sources.length,1); equal(page.completeness.historical,"unknown"); equal(page.completeness.economic,"blocked");
    ok(page.completeness.reasons.includes("returns_unknown")); ok(page.completeness.reasons.includes("overlapping_representations"));
    const serialized = JSON.stringify(page.sources[0].projection);
    ok(!serialized.includes("requestAuthorityFingerprint")); ok(!serialized.includes('"operation"'));
    for (const canary of Object.values(of.SQUARE_PHASE_2B2B3_SYNTHETIC_CANARIES)) ok(!serialized.includes(canary), "no raw Tender metadata");
    const source = mapping.materializeSquarePendingSource(page.sources[0],1,null);
    equal(source.validation.state,"pending"); equal(source.trust,"untrusted_external_input"); equal(source.accounting.basis,"unknown");
    generic.ExternalSourceRecordVersionSchema.parse(source); frozen(source);
    equal(source.sourceFingerprint,canonical.externalSourceFingerprint(source));
    equal(serializer.prepareExternalSourceVersionCommit(source).sourceFingerprint,source.sourceFingerprint);
    equal(source.source.providerRecordId,page.sources[0].resourceKey);
  }
  const orderKeys = orderParsers.map(([stream,parser]) => map(stream, accepted(parser(of.squarePhase2B2B3ParserInput({order:of.squarePhase2B2B3Order()}))),orderScope).sources[0].resourceKey);
  equal(new Set(orderKeys).size,4,"overlapping Order projections remain four identities");
  for (const [stream,value] of [["payments",makePayment()],["refunds",makeRefund()],["catalog",makeCatalog()]]) {
    seen.add(stream); const page=map(stream,value); frozen(page); equal(page.sources.length,1);
    mapping.assertSquarePendingSource(page.sources[0]); mapping.materializeSquarePendingSource(page.sources[0],1,null);
    ok(page.completeness.reasons.includes("references_unresolved"));
  }
  for (const [raw,op] of [
    [{counts:[inf.squareInventoryCountFixture()]},"inventory_counts_batch_retrieve"],
    [{counts:[inf.squareInventoryCountFixture()]},"retrieve_inventory_count"],
    [{adjustment:inf.squareInventoryAdjustmentFixture()},"retrieve_inventory_adjustment"],
    [{count:inf.squareInventoryPhysicalCountFixture()},"retrieve_inventory_physical_count"],
    [{changes:[inf.squareInventoryChangeFixture(),inf.squareInventoryChangeFixture("PHYSICAL_COUNT")]},"inventory_changes_batch_retrieve"]
  ]) {
    const value=accepted(inventory.parseSquareInventoryResponse(inf.squareInventoryParserInput(raw,op)));
    const page=map("inventory",value); seen.add("inventory"); frozen(page);
    ok(page.completeness.reasons.includes("inventory_optional"));
    for(const pending of page.sources) { mapping.assertSquarePendingSource(pending); mapping.materializeSquarePendingSource(pending,1,null); }
    if(op.includes("count") && !op.includes("physical")) equal(page.sources[0].projection.data.quantity,"0012.34000","exact lexical quantity retained");
  }
  equal(seen.size,8,"all existing stream families mapped");
  const negativeCost=inventory.parseSquareInventoryResponse(inf.squareInventoryParserInput({adjustment:inf.squareInventoryAdjustmentFixture({cost_money:{amount:-1,currency:"USD"}})}));
  equal(negativeCost.outcome,"rejected","reviewed unsigned cost rule remains intact");
  for (const raw of [
    inf.squareInventoryAdjustmentFixture({from_state:"SUPPORTED_BY_NEWER_VERSION"}),
    inf.squareInventoryAdjustmentFixture({to_state:"SUPPORTED_BY_NEWER_VERSION"}),
    inf.squareInventoryAdjustmentFixture({adjustment_group:{from_state:"SUPPORTED_BY_NEWER_VERSION"}}),
    inf.squareInventoryAdjustmentFixture({adjustment_group:{to_state:"SUPPORTED_BY_NEWER_VERSION"}})
  ]) {
    const page=map("inventory",accepted(inventory.parseSquareInventoryResponse(inf.squareInventoryParserInput({adjustment:raw}))));
    equal(page.sources.length,0);equal(page.completeness.pageSequence,"blocked");ok(page.completeness.reasons.includes("unsupported_page"));
  }
  const unsupportedCount=accepted(inventory.parseSquareInventoryResponse(inf.squareInventoryParserInput({counts:[inf.squareInventoryCountFixture(),inf.squareInventoryCountFixture({catalog_object_id:"OTHER",state:"SUPPORTED_BY_NEWER_VERSION"})]},"inventory_counts_batch_retrieve")));
  equal(map("inventory",unsupportedCount).sources.length,0,"one unsupported sentinel blocks the whole mixed page");
  const untracked=accepted(inventory.parseSquareInventoryResponse(inf.squareInventoryParserInput({counts:[inf.squareInventoryCountFixture({state:"UNTRACKED"})]},"inventory_counts_batch_retrieve")));
  equal(map("inventory",untracked).sources[0].projection.data.state,"UNTRACKED","known UNTRACKED is preserved without stock authority");
}

function identityAndRevisions() {
  const value=makePayment(); const first=map("payments",value).sources[0];
  const replay=map("payments",value,{...scope,generation:99,authorizedLocationIds:[...scope.authorizedLocationIds].reverse()},"2026-09-07T23:00:00Z").sources[0];
  equal(first.resourceKey,replay.resourceKey); equal(first.versionKey,replay.versionKey,"observation/generation are not version identity");
  const firstEnvelope=mapping.materializeSquarePendingSource(first,1,null), replayEnvelope=mapping.materializeSquarePendingSource(replay,1,null);
  equal(first.resourceKey,"sha256:629f928b5e8cf8e6c1d4e55b951552cf81a7ad3b377bd2b75eb1f5c044006f47","new source resource golden");
  equal(first.versionKey,"sha256:b77cc84f6b5559addef9bfb63f91b448aa920c18eb751a13a9f00c5dd712d85f","new observed-version golden");
  equal(firstEnvelope.sourceFingerprint,"sha256:11bbad7cc48cbf96a141d3c17a25906f2926ef17022c28487143235df49bd3ec","generic pending envelope golden");
  equal(firstEnvelope.id,replayEnvelope.id); ok(firstEnvelope.sourceFingerprint!==replayEnvelope.sourceFingerprint,"generic source fingerprint includes first observation: repository must dedup before materialization");
  const correction=map("payments",makePayment(pf.squarePaymentFixture({amount_money:{amount:1001,currency:"USD"}}))).sources[0];
  equal(correction.resourceKey,first.resourceKey); ok(correction.versionKey!==first.versionKey); equal(mapping.compareSquareProviderRevision(first.providerRevision,correction.providerRevision),"same","repository combines equal revision + changed content into conflict");
  const newer=map("payments",makePayment(pf.squarePaymentFixture({updated_at:"2026-09-02T12:01:00Z"}))).sources[0];
  equal(mapping.compareSquareProviderRevision(first.providerRevision,newer.providerRevision),"newer");
  equal(mapping.compareSquareProviderRevision(newer.providerRevision,first.providerRevision),"older");
  const r=(version=null,updatedAt=null)=>({version,updatedAt});
  equal(mapping.compareSquareProviderRevision(r("17"),r("18")),"newer");
  equal(mapping.compareSquareProviderRevision(r("17"),r("16")),"older");
  equal(mapping.compareSquareProviderRevision(r("17"),r(null,"2030-01-01T00:00:00Z")),"unordered");
  equal(mapping.compareSquareProviderRevision(r(),r()),"unordered");
  equal(mapping.compareSquareProviderRevision(r(null,"2026-09-01T12:00:00.000001Z"),r(null,"2026-09-01T12:00:00.000002Z")),"newer","no millisecond truncation");
  equal(mapping.compareSquareProviderRevision(r(null,"2026-09-01T12:00:00.000002Z"),r(null,"2026-09-01T05:00:00.000002-07:00")),"same","same instant with different timezone");
  throws(()=>mapping.compareSquareProviderRevision(r("opaque-token"),r("17")),"opaque token never gets numeric ordering");
  const idless=map("payments",makePayment([pf.squarePaymentFixture(),pf.squarePaymentFixture({id:null})],"list_payments"));
  equal(idless.sources.length,0); equal(idless.completeness.pageSequence,"blocked"); ok(idless.completeness.reasons.includes("unsupported_page"));
  const longRefund=map("refunds",makeRefund(rf.squareRefundFixture({id:"R".repeat(255)}),"list_payment_refunds")).sources[0];
  equal(longRefund.providerRecordId.length,255); equal(mapping.materializeSquarePendingSource(longRefund,1,null).source.providerRecordId.length,71,"generic identifier bound satisfied without truncation");
  const negativeOrder=accepted(order.parseSquareOrderCoreResponse(ob.squarePhase2B2AParserInput({order:ob.squarePhase2B2AOrder({version:-1})})));
  const negativePending=map("order_core",negativeOrder,orderScope).sources[0];
  equal(mapping.materializeSquarePendingSource(negativePending,1,null).source.providerVersionReference,"square_version/-1","negative supported provider revision fits generic identifier contract");
  for(const key of ["workspaceId","businessEntityId","connectionId","sellerId","environment"]) {
    const changedScope={...scope,[key]:key==="environment"?"production":key==="sellerId"?"OTHER":"40000000-0000-4000-8000-000000000001"};
    if(key==="businessEntityId") {
      const p=map("payments",value,changedScope).sources[0]; ok(p.resourceKey!==first.resourceKey); ok(identity.externalSourceIdentityFingerprint(mapping.materializeSquarePendingSource(p,1,null))!==identity.externalSourceIdentityFingerprint(firstEnvelope));
    } else throws(()=>map("payments",value,changedScope),"existing accepted value bound to original parser scope");
  }
  throws(()=>map("payments",value,{...scope,authorizedLocationIds:["FOREIGN"]}));
  throws(()=>map("payments",value,{...scope,generation:0}));
  throws(()=>map("refunds",value));
  throws(()=>mapping.mapSquareParsedPage(scope,"payments",value,observedAt,true));
}

function catalogAndCompleteness() {
  const raw=cf.squareCatalogValidationFixture();
  const initial=map("catalog",makeCatalog(raw)).sources[0];
  const deletedRaw={type:raw.type,id:raw.id,version:raw.version+1,updated_at:"2026-09-02T12:00:00Z",is_deleted:true};
  const tombstone=map("catalog",makeCatalog(deletedRaw)).sources[0];
  equal(tombstone.resourceKey,initial.resourceKey); ok(tombstone.versionKey!==initial.versionKey); equal(tombstone.projection,null);
  const prior=mapping.materializeSquarePendingSource(initial,1,null);
  const tomb=mapping.materializeSquarePendingSource(tombstone,2,prior.id);
  equal(tomb.changeKind,"deleted"); equal(tomb.normalizedProjection,null); equal(tomb.priorVersionId,prior.id);
  const withRelated=map("catalog",makeCatalog(raw,{related_objects:[{...raw,id:"RELATED"}]},{objectId:raw.id,query:{include_related_objects:"true"}}));
  equal(withRelated.sources.length,2); ok(withRelated.sources.some(s=>s.providerRecordType==="square_catalog_related_category"));
  equal(withRelated.sources.find(s=>s.providerRecordId===raw.id).versionKey,initial.versionKey,"query/related response metadata does not version primary object");
  const item=oldCatalog.squarePhase2B1B1Item();
  const nested=map("catalog",makeCatalog(item)); equal(nested.sources.length,1,"nested variants retained once, not flattened into authority"); ok(nested.sources[0].projection.data.variations.length>0);
  const count1=accepted(inventory.parseSquareInventoryResponse(inf.squareInventoryParserInput({counts:[inf.squareInventoryCountFixture() ]},"inventory_counts_batch_retrieve")));
  const count2=accepted(inventory.parseSquareInventoryResponse(inf.squareInventoryParserInput({counts:[inf.squareInventoryCountFixture({quantity:"9.00000",calculated_at:"2026-09-02T12:00:00Z"})]},"inventory_counts_batch_retrieve")));
  const a=map("inventory",count1).sources[0], b=map("inventory",count2).sources[0];
  equal(a.resourceKey,b.resourceKey,"snapshot composite excludes quantity/calculation time"); ok(a.versionKey!==b.versionKey);
  equal(mapping.compareSquareProviderRevision(a.providerRevision,b.providerRevision),"newer");
  const paged=accepted(refund.parseSquareRefundResponse(rf.squareRefundParserInput({refunds:[rf.squareRefundFixture()],cursor:"NEXT=="},"list_payment_refunds")));
  const partial=map("refunds",paged); equal(partial.completeness.pageSequence,"partial"); ok(partial.completeness.reasons.includes("partial_page_sequence"));
  const empty=accepted(refund.parseSquareRefundResponse(rf.squareRefundParserInput({refunds:[]},"list_payment_refunds")));
  const emptyPage=map("refunds",empty); equal(emptyPage.sources.length,0); equal(emptyPage.completeness.historical,"unknown"); equal(emptyPage.completeness.economic,"blocked");
  for(const [stream,parser] of orderParsers) {
    const ordinary={id:ob.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID,location_id:ob.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID};
    const noSignal=map(stream,accepted(parser(ob.squarePhase2B2AParserInput({order:ordinary}))),orderScope);
    const returns=map(stream,accepted(parser(ob.squarePhase2B2AParserInput({order:{...ordinary,returns:[{sensitive:"return-canary"}]}}))),orderScope);
    equal(noSignal.sources[0].versionKey,returns.sources[0].versionKey); ok(returns.completeness.reasons.includes("returns_unknown"));
    ok(noSignal.completeness.reasons.includes("returns_unknown"),"absence in minimizer does not prove no returns");
  }
}

function boundsAndFailures() {
  const lengths=[1000,1000,1000,1000,1000,664];
  const raw={orders:Array.from({length:1000},(_,i)=>({id:`ORDER_${i}`,location_id:orderScope.authorizedLocationIds[0],
    ...(i<lengths.length?{line_items:Array.from({length:lengths[i]},(_,j)=>({uid:`L${i}_${j}`,quantity:"1"}))}:{})}))};
  equal(count(raw,false),20000,"derivation-backed current maximum reaches raw budget");
  const value=accepted(order.parseSquareOrderTenderResponse(ob.squarePhase2B2AParserInput(raw,"orders_search")));
  const mapped=map("order_tenders",value,orderScope); equal(mapped.sources.length,1000);
  ok(count(mapped)<=60000+5*1000+4,"every root copied once within proven output bound");
  const catalogRaw=cf.squareCatalogValidationMaximumEnvelope();
  const catalogMax=accepted(catalog.parseSquareCatalogValidatedResponse(cf.squareCatalogValidationParserInput(catalogRaw,"catalog_search",{requestContext:{body:{object_types:["ITEM","MODIFIER_LIST"],include_deleted_objects:true,include_related_objects:true,include_options:{include:["INCLUDE_NESTED_MODIFIERS"]}}}})));
  const all=map("catalog",catalogMax); equal(all.sources.length,3000); ok(count(all)<=23341+5*3000+4);
  const authorizedLocations=Array.from({length:1000},(_,i)=>"LOCATION_"+i);
  const sharedScopeMaximum=map("catalog",catalogMax,{...scope,authorizedLocationIds:authorizedLocations});
  ok(count(sharedScopeMaximum,false)>3_000_000,"shared trusted location set expands per source; no scalar-count alias discount");
  ok(count(sharedScopeMaximum)<=23341+5*3000+4,"scope occurrence containers are already included in derivation");
  for(const s of [mapped.sources[0],all.sources[0]]) mapping.assertSquarePendingSource(s);
  const paymentRaw=pf.squarePaymentMaximumListEnvelope();
  paymentRaw.payments.forEach((item,i)=>{item.id="MAX_PAYMENT_"+i;});
  paymentRaw.payments[0].processing_fee.splice(0,50); //100 ID values paid for by50 two-value fee/Money entries.
  equal(count(paymentRaw,false),20000,"identity-bearing Payment source maximum allocation reaches raw boundary");
  const paymentMax=accepted(payment.parseSquarePaymentResponse(pf.squarePaymentParserInput(paymentRaw,"list_payments")));
  const paymentMapped=map("payments",paymentMax);equal(paymentMapped.sources.length,100);ok(count(paymentMapped)<=20295+5*100+4);
  const refundRaw=rf.squareRefundMaximumListEnvelope();equal(count(refundRaw,false),20000);
  const refundMax=accepted(refund.parseSquareRefundResponse(rf.squareRefundParserInput(refundRaw,"list_payment_refunds")));
  const refundMapped=map("refunds",refundMax);equal(refundMapped.sources.length,100);ok(count(refundMapped)<=20195+5*100+4);
  const inventoryMax=accepted(inventory.parseSquareInventoryResponse(inf.squareInventoryParserInput(inf.squareInventoryProductiveChangesEnvelope(),"inventory_changes_batch_retrieve")));
  const inventoryMapped=map("inventory",inventoryMax); equal(inventoryMapped.sources.length,1000); ok(count(inventoryMapped)<=19007+5*1000+4);
  const limit=mapping.SQUARE_MAXIMUM_MAPPED_PAGE_CONTAINERS;
  // root plus65 arrays, each holding <=1000 repeated references. Expanded count,
  // not allocation count, reaches exactly65,004; then one additional occurrence.
  const shared=Object.freeze({});
  const graph=[]; let needed=limit-1;
  while(needed>0){const children=Math.min(1000,needed-1);graph.push(Array(children).fill(shared));needed-=children+1;}
  equal(count(graph),limit); mapping.mappingInspectForTests(graph,limit,3000);
  graph[graph.length-1].push(shared); equal(count(graph),limit+1); throws(()=>mapping.mappingInspectForTests(graph,limit,3000));
  const first=map("payments",makePayment()).sources[0];
  for(const update of [{resourceKey:"sha256:"+"0".repeat(64)},{versionKey:"sha256:"+"0".repeat(64)},{providerRecordId:"OTHER"},{deleted:true}]) throws(()=>mapping.assertSquarePendingSource({...first,...update}));
  const wrong=clone(first); wrong.projection.data.amountMoney.amountMinor="999"; throws(()=>mapping.assertSquarePendingSource(wrong));
  const cyc={};cyc.self=cyc;throws(()=>mapping.mappingInspectForTests(cyc,limit));
  const sparse=Array(1);throws(()=>mapping.mappingInspectForTests(sparse,limit));
  let traps=0;const proxy=new Proxy({}, {ownKeys(){traps++;throw Error("private");},getPrototypeOf(){traps++;throw Error("private");}});
  throws(()=>mapping.mappingInspectForTests(proxy,limit)); equal(traps,0);
  const revoked=Proxy.revocable({},{});revoked.revoke();throws(()=>mapping.mappingInspectForTests(revoked.proxy,limit));
  let getters=0;const accessor={get dangerous(){getters++;return "private";}};throws(()=>mapping.mappingInspectForTests(accessor,limit));equal(getters,0);
  throws(()=>mapping.materializeSquarePendingSource(first,2,null)); throws(()=>mapping.materializeSquarePendingSource(first,1,"40000000-0000-4000-8000-000000000001"));
  frozen(mapped);frozen(all);frozen(inventoryMapped);
}
streamCoverage(); identityAndRevisions(); catalogAndCompleteness(); boundsAndFailures();
console.log(`Square ingestion mapping regression tests passed (${assertions} assertions).`);
