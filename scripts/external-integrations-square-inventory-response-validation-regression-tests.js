const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request === "server-only") {
    return path.join(root, "scripts/test-stubs/server-only.js");
  }
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(
      this,
      path.join(root, request.slice(2)),
      parent,
      isMain,
      options
    );
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const square = {
  ...require("../lib/integrations/providers/square/inventory-responses.ts"),
  ...require("../lib/integrations/providers/square/fixtures/inventory-responses.ts")
};

const validation = require("../lib/integrations/providers/square/response-validation.ts");
const clone = (value) => JSON.parse(JSON.stringify(value));
const fixture = square.squareInventoryAdjustmentFixture;
const input = square.squareInventoryParserInput;
const canaries = square.SQUARE_INVENTORY_SYNTHETIC_CANARIES;
let assertions = 0, scenarios = 0;
const equal = (a,b,m) => { assertions++; assert.equal(a,b,m); };
const deepEqual = (a,b,m) => { assertions++; assert.deepEqual(a,b,m); };
const ok = (v,m) => { assertions++; assert.ok(v,m); };
const throws = (fn,m) => { assertions++; assert.throws(fn,undefined,m); };
function patch(object,key,value,fn) { const original=object[key]; try { object[key]=value; return fn(); } finally { object[key]=original; } }
function count(value, containersOnly=false) {
  if (value === null || typeof value !== "object") return containersOnly ? 0 : 1;
  return 1+Object.values(value).reduce((sum,item)=>sum+count(item,containersOnly),0);
}
function freeze(value,seen=new Set()) {
  if (value===null || typeof value!=="object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if (descriptor && "value" in descriptor) freeze(descriptor.value,seen);
  }
  return Object.freeze(value);
}
function deeplyFrozen(value,seen=new Set()) {
  if (value===null || typeof value!=="object" || seen.has(value)) return;
  ok(Object.isFrozen(value),"deeply frozen");
  seen.add(value); Object.values(value).forEach(item=>deeplyFrozen(item,seen));
}
function parse(value) {
  scenarios++;
  let result,logs=0;
  patch(console,"log",()=>logs++,()=>patch(console,"warn",()=>logs++,()=>patch(console,"error",()=>logs++,()=> {
    assert.doesNotThrow(()=>{result=square.parseSquareInventoryResponse(value);});
  })));
  equal(logs,0,"silent parser");
  for(const diagnostic of result.diagnostics) ok(["$input","$response"].includes(diagnostic.field),"root-only");
  for(const canary of canaries) ok(!JSON.stringify(result).includes(canary),"no sensitive canary");
  deeplyFrozen(result);
  return result;
}
const accepted=(r,m="accepted")=>{equal(r.outcome,"accepted",m+": "+JSON.stringify(r.diagnostics));return r.value;};
const rejected=(r,m)=>equal(r.outcome,"rejected",m);
const unsupported=(r,m)=>equal(r.outcome,"unsupported",m);
const get=(adjustment=fixture())=>parse(input({adjustment}));
const internal=r=>{rejected(r);deepEqual(r.diagnostics,[{code:"square_response_internal_rejection",field:"$response"}]);};
const counts=(records=[square.squareInventoryCountFixture()],operation="inventory_counts_batch_retrieve",overrides={})=>parse(input({counts:records},operation,overrides));
const changes=(records=[square.squareInventoryChangeFixture()],overrides={})=>parse(input({changes:records},"inventory_changes_batch_retrieve",overrides));
function testContract() {
  const adjustment=accepted(get()).items[0];
  equal(adjustment.entityType,"inventory_adjustment");
  equal(adjustment.quantity,"1.25000");
  equal(adjustment.totalPriceMoney.amountMinor,"999");
  equal(adjustment.refundReference.entityType,"legacy_refund");
  equal(adjustment.transactionReference.entityType,"legacy_transaction");
  for(const ref of ["catalogReference","refundReference","transactionReference","purchaseOrderReference","goodsReceiptReference","physicalCountReference"]) {
    equal(adjustment[ref].referenceType,"unverified_inventory_relationship");
    ok(!("workspaceId" in adjustment[ref])); ok(!("authority" in adjustment[ref]));
  }
  const snapshot=accepted(counts()).items[0];
  equal(snapshot.id,null); equal(snapshot.authority.identityState,"provider_snapshot_composite");
  equal(snapshot.quantity,"0012.34000"); equal(snapshot.isEstimated,false);
  const physical=accepted(parse(input({count:square.squareInventoryPhysicalCountFixture()},"retrieve_inventory_physical_count"))).items[0];
  equal(physical.entityType,"inventory_physical_count"); equal(physical.adjustmentReference.entityType,"inventory_adjustment");
  accepted(counts(undefined,"retrieve_inventory_count"));
  for(const type of ["ADJUSTMENT","PHYSICAL_COUNT"]) equal(accepted(changes([square.squareInventoryChangeFixture(type)])).items.length,1);
  for(const state of square.SQUARE_INVENTORY_RESPONSE_STATES) {
    equal(accepted(counts([square.squareInventoryCountFixture({state})])).items[0].state,state);
    equal(accepted(get(fixture({from_state:state,to_state:state}))).items[0].fromState,state);
  }
  for(const type of square.SQUARE_INVENTORY_REASON_TYPES) {
    const reason_id={type,...(type==="CUSTOM"?{custom_reason_id:"REASON"}:{})};
    equal(accepted(get(fixture({reason_id}))).items[0].reason.type,type);
  }
  for(const reason_id of [{type:"CUSTOM"},{type:"CUSTOM",custom_reason_id:null}]) {
    equal(accepted(get(fixture({reason_id}))).items[0].reason.customReasonReference,null);
  }
  rejected(get(fixture({reason_id:{type:"SALE",custom_reason_id:"CUSTOM"}})));
  rejected(get(fixture({reason_id:{}})));
  for(const key of Object.keys(fixture())) {
    for(const mode of ["missing","null"]) {
      const raw=fixture(); if(mode==="missing") delete raw[key]; else raw[key]=null;
      if(key==="id") rejected(get(raw)); else accepted(get(raw),key+" "+mode);
    }
  }
  for(const key of Object.keys(square.squareInventoryCountFixture())) {
    const raw=square.squareInventoryCountFixture(); delete raw[key];
    if(["catalog_object_id","location_id","state"].includes(key)) rejected(counts([raw])); else accepted(counts([raw]));
  }
  for(const key of Object.keys(square.squareInventoryPhysicalCountFixture())) {
    for(const mode of ["missing","null"]) {
      const raw=square.squareInventoryPhysicalCountFixture(); if(mode==="missing") delete raw[key]; else raw[key]=null;
      const result=parse(input({count:raw},"retrieve_inventory_physical_count"));
      if(key==="id") rejected(result); else accepted(result);
    }
  }
  for(const entity of ["ITEM","ITEM_VARIATION"]) equal(accepted(counts([square.squareInventoryCountFixture({catalog_object_type:entity})])).items[0].catalogObjectType,entity);
  unsupported(counts([square.squareInventoryCountFixture({catalog_object_type:"CUSTOMER"})]));
  unsupported(changes([{type:"TRANSFER",transfer:{id:"TRANSFER"}}]));
  unsupported(changes([{type:"FUTURE"}]));
  rejected(changes([{type:"ADJUSTMENT",adjustment:fixture(),physical_count:{id:"OTHER"}}]));
  rejected(changes([{type:"PHYSICAL_COUNT"}]));
  accepted(changes([{type:"ADJUSTMENT",adjustment:{id:"A"},physical_count:null}]));
  for(const key of ["counts","count","changes","cursor","transfer"]) rejected(parse(input({adjustment:fixture(),[key]:null})));
  const operationEnvelopes = [
    ["retrieve_inventory_count", { counts: [square.squareInventoryCountFixture()] }],
    ["inventory_counts_batch_retrieve", { counts: [square.squareInventoryCountFixture()] }],
    ["inventory_changes_batch_retrieve", { changes: [square.squareInventoryChangeFixture()] }],
    ["retrieve_inventory_adjustment", { adjustment: fixture() }],
    ["retrieve_inventory_physical_count", { count: square.squareInventoryPhysicalCountFixture() }]
  ];
  const foreignEnvelopes = [
    "object", "objects", "related_objects", "included_resources", "latest_time",
    "order", "orders", "payment", "payments", "refund", "refunds",
    "merchant", "merchants", "location", "locations"
  ];
  for(const [operation, envelope] of operationEnvelopes) {
    for(const key of foreignEnvelopes) for(const value of [null, [], {id:"FOREIGN"}]) {
      rejected(parse(input({[key]:value},operation)),"foreign-only envelope: "+operation+"/"+key);
      rejected(parse(input({...envelope,[key]:value},operation)),"mixed envelope: "+operation+"/"+key);
    }
    accepted(parse(input({...envelope,future_extension:{version:1}},operation)),"unrelated metadata stays supported");
  }
  const catalogObject = {type:"CATEGORY",id:"CATALOG",version:1,updated_at:"2026-08-19T00:00:00Z",is_deleted:false,category_data:{name:"Category"}};
  for(const [operation] of operationEnvelopes.slice(0,3)) rejected(parse(input({objects:[catalogObject]},operation)),"valid Catalog page cannot become empty Inventory");
  for(const errors of [[{}],[{detail:canaries[0]}]]) unsupported(parse(input({adjustment:fixture(),errors})));
  for(const errors of [42,["error"],{},[null]]) rejected(parse(input({adjustment:fixture(),errors})));
  accepted(parse(input({adjustment:fixture(),errors:[]})));
  for(const response of [{},{counts:null},{counts:[]},{counts:[],cursor:null}]) accepted(parse(input(response,"inventory_counts_batch_retrieve")));
  rejected(parse(input({})));
  for(const quantity of ["0","-0","-9999999999999999999.99999","0000.00100","99999999999999999999999999"]) {
    equal(accepted(get(fixture({quantity}))).items[0].quantity,quantity);
  }
  for(const quantity of ["1e2","+1","1.",".1"," 1","1.000001","1".repeat(27),1]) rejected(get(fixture({quantity})));
  for(const amount of [0,Number.MAX_SAFE_INTEGER]) equal(accepted(get(fixture({total_price_money:{amount}}))).items[0].totalPriceMoney.amountMinor,String(amount));
  for(const amount of [-1,Number.MAX_SAFE_INTEGER+1,1.1,"123"]) rejected(get(fixture({total_price_money:{amount}})));
  for(const key of ["total_price_money","cost_money"]) {
    for(const amount of [-1,-3,-Number.MAX_SAFE_INTEGER]) {
      rejected(get(fixture({[key]:{amount,currency:"CAD"}})),key+" inherits unsigned Money");
      const change=square.squareInventoryChangeFixture();change.adjustment[key]={amount,currency:"CAD"};
      rejected(changes([change]),key+" unsigned in change envelope");
    }
    for(const money of [{},{amount:null,currency:null},{amount:0,currency:"CAD"},{amount:Number.MAX_SAFE_INTEGER}]) accepted(get(fixture({[key]:money})));
  }
  for(const amountMinor of ["-1","-9007199254740991"]) equal(square.SquareInventoryMoneySchema.safeParse({amountMinor,currency:"CAD"}).success,false,"public minimized Money schema stays unsigned");
  for(const currency of ["ZZZ","usd",123]) rejected(get(fixture({cost_money:{amount:1,currency}})));
  for(const length of [100,101,255,256]) {
    const result=get(fixture({transaction_id:"T".repeat(length),refund_id:"R".repeat(length)}));
    if(length<=255) accepted(result); else rejected(result);
  }
  for(const key of ["created_at","occurred_at"]) {
    rejected(get(fixture({[key]:"2026-02-30T12:00:00Z"})));
    equal(accepted(get(fixture({[key]:"2026-09-01T05:00:00-07:00"}))).items[0][key==="created_at"?"createdAt":"occurredAt"],"2026-09-01T05:00:00-07:00");
  }
}
function testUnitsAndQueries() {
  const order=require("../lib/integrations/providers/square/order-responses.ts");
  const branches=[
    ["area",order.SQUARE_ORDER_MEASUREMENT_AREA_UNITS],["length",order.SQUARE_ORDER_MEASUREMENT_LENGTH_UNITS],
    ["volume",order.SQUARE_ORDER_MEASUREMENT_VOLUME_UNITS],["weight",order.SQUARE_ORDER_MEASUREMENT_WEIGHT_UNITS],
    ["generic",["UNIT"]],["time",order.SQUARE_ORDER_MEASUREMENT_TIME_UNITS]
  ];
  for(const [kind,values] of branches) for(const value of values) {
    const raw=square.squareInventoryChangeFixture();
    raw.measurement_unit={precision:5,measurement_unit:{[kind+"_unit"]:value,...(kind==="time"?{}:{type:"TYPE_"+kind.toUpperCase()})}};
    equal(accepted(changes([raw])).items[0].measurement.measurementUnit.unit,value);
  }
  for(const unit of [{}, {precision:null}, {measurement_unit:null}]) {
    const raw=square.squareInventoryChangeFixture(); raw.measurement_unit=unit; accepted(changes([raw]));
  }
  for(const measurement_unit of [{precision:6},{precision:-1},{precision:1.5},{precision:"2"},{measurement_unit:{generic_unit:"UNIT",weight_unit:"METRIC_GRAM"}}]) {
    const raw=square.squareInventoryChangeFixture(); raw.measurement_unit=measurement_unit; rejected(changes([raw]));
  }
  const mismatch=square.squareInventoryChangeFixture(); mismatch.measurement_unit.precision=0; rejected(changes([mismatch]));
  const trailing=square.squareInventoryChangeFixture(); trailing.adjustment.quantity="1.00000"; trailing.measurement_unit.precision=0; accepted(changes([trailing]));
  for(const location of ["from_location_id","to_location_id"]) rejected(get(fixture({[location]:"OUTSIDE_SCOPE"})));
  rejected(counts([square.squareInventoryCountFixture({location_id:"OUTSIDE_SCOPE"})]));
  rejected(get(fixture({id:"OTHER"})));
  rejected(counts([square.squareInventoryCountFixture({catalog_object_id:"OTHER"})],"retrieve_inventory_count"));
  const base=input({changes:[]},"inventory_changes_batch_retrieve");
  base.requestContext.body={limit:1000,catalog_object_ids:["CATALOG_SYNTHETIC_1"],location_ids:["LOC_SYNTHETIC_1"],types:["ADJUSTMENT"],states:["IN_STOCK"],sort:{field:"OCCURRED_AT",order:"ASC"}};
  accepted(parse({...base,response:{changes:[square.squareInventoryChangeFixture()]}}));
  const badCatalog=square.squareInventoryChangeFixture(); badCatalog.adjustment.catalog_object_id="OTHER";
  rejected(parse({...base,response:{changes:[badCatalog]}}));
  rejected(parse({...base,response:{changes:[square.squareInventoryChangeFixture("PHYSICAL_COUNT")]}}));
  const badLocation=square.squareInventoryChangeFixture(); badLocation.adjustment.from_location_id="LOC_SYNTHETIC_2";badLocation.adjustment.to_location_id="LOC_SYNTHETIC_2";
  rejected(parse({...base,response:{changes:[badLocation]}}));
  const sourceCount=input({counts:[square.squareInventoryCountFixture()]},"inventory_counts_batch_retrieve");
  sourceCount.requestContext.body={limit:1000,states:["NONE","SOLD","UNLINKED_RETURN"]};
  accepted(parse(sourceCount),"ignored provider state filters are not invented postconditions");
  const physical=square.squareInventoryChangeFixture("PHYSICAL_COUNT");
  accepted(changes([physical],{requestContext:{authorizedLocationIds:["LOC_SYNTHETIC_1"],body:{limit:1000,states:["SOLD"]}}}),"states only filters adjustments, not physical counts");
  for(const changesToBody of [{limit:0},{limit:1001},{reason_ids:[]},{write:true},{states:["UNTRACKED"]},{location_ids:["OUTSIDE_SCOPE"]},{catalog_object_ids:["A","A"]}]) {
    rejected(changes([],{requestContext:{authorizedLocationIds:["LOC_SYNTHETIC_1"],body:changesToBody}}));
  }
  const a=square.squareInventoryChangeFixture(); const b=square.squareInventoryChangeFixture("PHYSICAL_COUNT");
  equal(square.squareInventoryResponseFingerprint(accepted(changes([a,b]))),square.squareInventoryResponseFingerprint(accepted(changes([b,a]))),"provider order neutral");
  rejected(changes([a,a])); rejected(counts([square.squareInventoryCountFixture(),square.squareInventoryCountFixture()]));
  accepted(changes([a,b]),"different record kinds remain distinct");
  const first=accepted(parse({...base,response:{changes:[],cursor:"NEXT_1=="}}));
  const continuation=clone(base);
  continuation.requestContext.body.cursor="NEXT_1==";
  continuation.requestContext.expectedCursorBindingFingerprint=first.cursorBindingFingerprint;
  continuation.requestContext.expectedResponseCursorFingerprint=first.pagination.cursorFingerprint;
  accepted(parse(continuation));
  for(const mutate of [
    r=>r.requestContext.body.sort.order="DESC",
    r=>r.requestContext.body.states=["SOLD"],
    r=>r.requestContext.body.limit=10,
    r=>r.requestContext.body.updated_after="2026-01-01T00:00:00Z",
    r=>r.requestContext.authorizedLocationIds=["LOC_SYNTHETIC_1"],
    r=>r.connectionAuthority.providerEntityId="OTHER_MERCHANT",
    r=>r.connectionAuthority.workspaceId="30000000-0000-4000-8000-000000000001",
    r=>r.connectionAuthority.connectionId="30000000-0000-4000-8000-000000000001",
    r=>r.providerEnvironment="production",
    r=>r.requestContext.expectedResponseCursorFingerprint=null,
    r=>r.requestContext.expectedCursorBindingFingerprint=null
  ]) {const changed=clone(continuation);mutate(changed);rejected(parse(changed),"changed cursor authority fails");}
  for(const operation of ["retrieve_inventory_count","inventory_counts_batch_retrieve"]) {
    const start=input({counts:[],cursor:"NEXT"},operation),result=accepted(parse(start)),next=clone(start);
    next.response={counts:[]};
    next.requestContext[operation==="retrieve_inventory_count"?"query":"body"].cursor="NEXT";
    next.requestContext.expectedCursorBindingFingerprint=result.cursorBindingFingerprint;
    next.requestContext.expectedResponseCursorFingerprint=result.pagination.cursorFingerprint;
    accepted(parse(next));
  }
  rejected(changes([a,b],{requestContext:{authorizedLocationIds:["LOC_SYNTHETIC_1"],body:{limit:1}}}));
}
function testPrivacyAndRawSafety() {
  const baseline=square.squareInventoryResponseFingerprint(accepted(get()));
  for(const key of ["reference_id","source","employee_id","team_member_id","vendor_id","note","metadata","location_id"]) {
    equal(square.squareInventoryResponseFingerprint(accepted(get(fixture({[key]:{private:canaries[0]}})))),baseline,key+" excluded");
  }
  let traps=0,getters=0;
  const proxy=new Proxy({}, {getPrototypeOf(){traps++;throw Error("trap");},ownKeys(){traps++;return [];}});
  const revoked=Proxy.revocable({},{});revoked.revoke();
  const accessor={}; Object.defineProperty(accessor,"secret",{enumerable:true,get(){getters++;return "private";}});
  const cycle={};cycle.self=cycle;
  const sparse=new Array(2);sparse[1]=1;
  const custom=[];custom.extra=1;
  let deep={};for(let i=0;i<13;i++)deep={deep};
  for(const value of [proxy,revoked.proxy,accessor,cycle,sparse,custom,deep,()=>0,1n,Symbol("secret"),NaN,Infinity,-0,undefined,
    {own:undefined},{[Symbol("x")]:1},Object.create({inherited:1}),JSON.parse('{"__proto__":{"polluted":true}}'),
    Array.from({length:1001},()=>0),Object.fromEntries(Array.from({length:65},(_,i)=>["k"+i,1])),{["x".repeat(129)]:0}
  ]) {
    rejected(get(fixture({excluded:value})));
  }
  equal(traps,0);equal(getters,0);
  for(const value of [proxy,revoked.proxy,accessor,null,1,[],{}]) rejected(parse(value));
  for(const field of ["connectionAuthority","requestContext","response","operation"]) {
    rejected(parse({...input({adjustment:fixture()}),[field]:proxy}));
    rejected(parse({...input({adjustment:fixture()}),[field]:revoked.proxy}));
  }
  equal(traps,0);
  accepted(get(Object.assign(Object.create(null),fixture())));
  const version=input({adjustment:fixture()});version.apiVersion="2025-01-01";equal(parse(version).outcome,"incompatible-version");
  const original=input({adjustment:fixture()});const result=parse(original);const serialized=JSON.stringify(result);
  original.response.adjustment.quantity="0";equal(JSON.stringify(result),serialized);
  throws(()=>result.value.items.push({}));
  let transport=0;
  patch(global,"fetch",()=>{transport++;throw Error("transport");},()=>accepted(get()));
  equal(transport,0);
}
function testDerivedBounds() {
  // Enumerate every optional productive shape in each supported record branch.
  // The same raw record cannot have both physical/adjustment payloads. Null or
  // omitted fields only remove cells; raw scalar additions never increase C.
  const fields=[1,1,1,1,1,1,1,1,1,2,2,3]; // catalog,5causal,2Money,unitRef,group,reason,measurement
  let adjustmentMaximum=0;
  for(let mask=0;mask<(1<<fields.length);mask++) {
    const containers=3+fields.reduce((sum,c,i)=>sum+((mask>>i)&1?c:0),0);
    adjustmentMaximum=Math.max(adjustmentMaximum,containers);
  }
  equal(adjustmentMaximum,19);
  equal(square.SQUARE_INVENTORY_MAXIMUM_RESULT_CONTAINERS,7+1000*Math.max(4,9,adjustmentMaximum));
  const fullyPopulated=square.squareInventoryChangeFixture();
  equal(count(accepted(changes([fullyPopulated])).items[0],true),19,"all schema container cells exercised");
  const fullPhysical=square.squareInventoryChangeFixture("PHYSICAL_COUNT");
  equal(count(accepted(changes([fullPhysical])).items[0],true),9);
  equal(count(accepted(counts()).items[0],true),4);
  const witnesses=[];
  for(const mixed of [false,true]) {
    const envelope=square.squareInventoryProductiveChangesEnvelope(mixed);
    equal(count(envelope),20000,"productive page reaches expanded raw boundary");
    const result=parse(input(envelope,"inventory_changes_batch_retrieve"));
    accepted(result);equal(result.value.itemCount,1000);
    ok(count(result,true)<=19007);witnesses.push({mixed,raw:count(envelope),containers:count(result,true)});
    const aliased=clone(envelope),sharedMoney={},sharedGroup={root_adjustment_id:"ROOT"};
    for(const change of aliased.changes) if(change.adjustment) {
      change.adjustment.total_price_money=sharedMoney;change.adjustment.cost_money=sharedMoney;change.adjustment.adjustment_group=sharedGroup;
    }
    equal(count(aliased),20000);
    const shared=parse(input(aliased,"inventory_changes_batch_retrieve"));accepted(shared);
    equal(square.squareInventoryResponseFingerprint(shared.value),square.squareInventoryResponseFingerprint(result.value));
    envelope.extra=null;equal(count(envelope),20001);rejected(parse(input(envelope,"inventory_changes_batch_retrieve")));
  }
  for(const operation of ["retrieve_inventory_count","inventory_counts_batch_retrieve","retrieve_inventory_adjustment","retrieve_inventory_physical_count"]) {
    let response;
    if(operation.includes("count")&&!operation.includes("physical")) {
      const counts=Array.from({length:1000},(_,i)=>square.squareInventoryCountFixture({catalog_object_id:operation==="retrieve_inventory_count"?"CATALOG_SYNTHETIC_1":"CATALOG_"+i,location_id:"LOCATION_"+i}));
      response={counts};
    } else response=operation==="retrieve_inventory_adjustment"?{adjustment:fixture()}:{count:square.squareInventoryPhysicalCountFixture()};
    const envelope=square.squareInventoryPadRawBoundary(response);
    equal(count(envelope),20000);
    const invocation=input(envelope,operation);
    if(response.counts) invocation.requestContext.authorizedLocationIds=Array.from({length:1000},(_,i)=>"LOCATION_"+i);
    const result=parse(invocation);accepted(result);
    equal(count(result,true),response.counts?4007:operation==="retrieve_inventory_adjustment"?22:12);
    envelope.extra=0;rejected(parse(invocation));
  }
  console.log("Inventory derived-bound witnesses:",JSON.stringify(witnesses));
}
function repeatedGraph(containers) {
  // At most 1,000 aliases; each shared branch contains 30 containers.
  const branch = [ ...Array.from({ length: 29 }, () => ({})) ];
  const copies = Math.floor((containers - 1) / 30);
  const remainder = (containers - 1) % 30;
  return [ ...Array.from({ length: copies }, () => branch), ...Array.from({ length: remainder }, () => ({})) ];
}
function testResultBoundaryFaults() {
  const originalAccepted = validation.squareAcceptedResult;
  const originalFailure = validation.squareFailureResult;
  const originalHash = validation.squareMinimizedProjectionFingerprint;
  const originalSafeParse = square.SquareInventoryResponseSchema.safeParse;
  const replay = parse(input({ adjustment: fixture() }));
  accepted(replay);
  for (const factory of [
    () => replay,
    () => freeze({ outcome: "accepted", diagnostics: [], value: clone(replay.value) }),
    () => ({ outcome: "accepted", diagnostics: [], value: {} }),
    (value) => ({ outcome: "accepted", value, diagnostics: [] }),
    (value) => freeze({ outcome: "accepted", value, diagnostics: [{}] }),
    (value) => { value.items[0].id = "FORGED"; return originalAccepted(value); }
  ]) patch(validation, "squareAcceptedResult", factory, () => internal(get()));
  let factoryResult;
  patch(validation, "squareAcceptedResult", (value) => factoryResult = originalAccepted(value), () => equal(get(), factoryResult, "legitimate accepted identity"));
  let trapCalls = 0, getterCalls = 0;
  const proxy = (value) => new Proxy(value, { getPrototypeOf() { trapCalls++; throw new Error(canaries[0]); }, ownKeys() { trapCalls++; return []; } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const factory of [
    (value) => proxy(originalAccepted(value)),
    () => revoked.proxy,
    (value) => { value.provider = revoked.proxy; return { outcome: "accepted", value, diagnostics: [] }; },
    (value) => { Object.defineProperty(value.items[0], "id", { enumerable: true, get() { getterCalls++; throw new Error(canaries[0]); } }); return originalAccepted(value); },
    (value) => { value.provider = value; return originalAccepted(value); },
    (value) => { value.items.length += 1; return originalAccepted(value); },
    (value) => { value.items.extra = 1; return originalAccepted(value); }
  ]) patch(validation, "squareAcceptedResult", factory, () => internal(get()));
  // Isolate the boundary from test helpers: never reflect the injected Proxy.
  patch(validation, "squareAcceptedResult", (value) => {
    value.provider = proxy({});
    Object.freeze(value);
    return Object.freeze({ outcome: "accepted", value, diagnostics: Object.freeze([]) });
  }, () => internal(get()));
  equal(trapCalls, 0, "boundary never reflects Proxy"); equal(getterCalls, 0);

  for (const target of [19_007, 19_008]) {
    let returned = false, postSchema = 0, postHash = 0, actualCount = 0;
    try {
      square.SquareInventoryResponseSchema.safeParse = (...args) => {
        if (returned) { postSchema++; return { success: true, data: args[0] }; }
        return originalSafeParse(...args);
      };
      validation.squareMinimizedProjectionFingerprint = (...args) => {
        if (returned) postHash++;
        return originalHash(...args);
      };
      validation.squareAcceptedResult = (value) => {
        value.provider = repeatedGraph(target - count(value, true) - 1);
        const result = originalAccepted(value);
        actualCount = count(result, true);
        returned = true;
        return result;
      };
      internal(get());
      equal(actualCount, target, "expanded repeated-container count exact");
      equal(postSchema, target === 19_007 ? 1 : 0, "inclusive boundary before schema");
      equal(postHash, target === 19_007 ? 1 : 0, "above cap rejects before fingerprint");
    } finally {
      validation.squareAcceptedResult = originalAccepted;
      validation.squareMinimizedProjectionFingerprint = originalHash;
      square.SquareInventoryResponseSchema.safeParse = originalSafeParse;
    }
  }
  // Inject into the initial schema result: wrapper-inclusive preflight must reject
  // before the accepted factory or its fingerprint work.
  const originalParse = square.SquareInventoryResponseSchema.parse;
  let injected = false, factoryCalls = 0, hashesAfterInjection = 0;
  try {
    square.SquareInventoryResponseSchema.parse = (...args) => {
      const value = originalParse(...args);
      value.provider = repeatedGraph(19_008 - count(value, true) - 1);
      injected = true; return value;
    };
    validation.squareAcceptedResult = (value) => { factoryCalls++; return originalAccepted(value); };
    validation.squareMinimizedProjectionFingerprint = (...args) => {
      if (injected) hashesAfterInjection++;
      return originalHash(...args);
    };
    internal(get());
    equal(factoryCalls, 0); equal(hashesAfterInjection, 0);
  } finally {
    square.SquareInventoryResponseSchema.parse = originalParse;
    validation.squareAcceptedResult = originalAccepted;
    validation.squareMinimizedProjectionFingerprint = originalHash;
  }
  for (const failure of [
    () => { throw new Error(canaries[0]); },
    () => proxy({}),
    () => revoked.proxy,
    () => ({ outcome: "rejected", diagnostics: [{ code: canaries[0], field: "$response" }] }),
    () => ({ outcome: "accepted", value: replay.value, diagnostics: [] }),
    () => ({ outcome: "unknown", diagnostics: [] }),
    () => ({ outcome: "rejected", diagnostics: new Array(2) })
  ]) patch(validation, "squareFailureResult", failure, () => internal(get(fixture({ id: 1 }))));
  patch(validation, "squareAcceptedResult", () => { throw new Error(canaries[0]); }, () => {
    internal(get());
    patch(validation, "squareFailureResult", () => { throw new Error(canaries[1]); }, () => internal(get()));
  });
  for (const sanitizer of [
    () => { throw new Error(canaries[0]); },
    () => { throw revoked.proxy; },
    () => proxy({}), () => revoked.proxy
  ]) patch(validation, "squareSafeJsonObject", sanitizer, () => {
    rejected(get());
    patch(validation, "squareFailureResult", () => { throw new Error(canaries[1]); }, () => internal(get()));
  });
  // Fault output can use only whitelisted static diagnostics, reduced to a root.
  patch(validation, "squareFailureResult", () => ({ outcome: "rejected", diagnostics: [{ code: "square_identifier_invalid", field: "$input.nested" }] }), () => {
    deepEqual(get(fixture({ id: 1 })).diagnostics, [{ code: "square_identifier_invalid", field: "$input" }]);
  });
  validation.squareFailureResult = originalFailure;

  // Public fingerprint helpers have the same pre-schema guard, including aliases.
  for (const [schema, fingerprint] of [
    [square.SquareMinimizedInventoryRecordSchema, square.squareInventoryFingerprint],
    [square.SquareInventoryResponseSchema, square.squareInventoryResponseFingerprint]
  ]) {
    let schemaCalls = 0, hashCalls = 0;
    patch(schema, "parse", () => { schemaCalls++; throw new Error("schema should not run"); }, () =>
      patch(validation, "squareMinimizedProjectionFingerprint", () => { hashCalls++; return "unexpected"; }, () => {
        throws(() => fingerprint(repeatedGraph(19_008)));
        throws(() => fingerprint(revoked.proxy));
      }));
    equal(schemaCalls, 0); equal(hashCalls, 0);
  }
}

function testScopeAndFingerprints() {
  const source=read("lib/integrations/providers/square/inventory-responses.ts");
  ok(source.startsWith('import "server-only";'));
  assert.doesNotMatch(source,/\bfetch\s*\(|axios|node:https|node:http|process\.env|@supabase|generateText|streamText/);
  const baseline=accepted(get());
  const fingerprints={entity:square.squareInventoryFingerprint(baseline.items[0]),response:square.squareInventoryResponseFingerprint(baseline),
    request:baseline.requestFingerprint,cursor:baseline.cursorBindingFingerprint};
  deepEqual(fingerprints,{
    entity:"sha256:137735a1396a5e0764f7ed5ba3850f009407a72ed72ffbf395de23de3228f3bc",
    response:"sha256:33d4d4c1fe57abb03165405c654a822731f259daed0a8b2240271242ef87c863",
    request:"sha256:893235a0a42993ebe9d290605731701abfcece343e758aa67304591550af6809",
    cursor:"sha256:6db698d298c7d0836e79f2fe539e70bdd713be0937f28b5dcbca4f785c4aa947"
  },"versioned new projections and unchanged existing GET request/cursor goldens");
  console.log("Inventory fingerprints:",JSON.stringify(fingerprints));
}
testContract(); testUnitsAndQueries(); testPrivacyAndRawSafety(); testDerivedBounds(); testResultBoundaryFaults(); testScopeAndFingerprints();
console.log("Inventory response validation passed:",assertions,"assertions /",scenarios,"scenarios");
