const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
    esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  }, fileName: filename }).outputText, filename);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
  return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const square = require("../lib/integrations/providers/square/index.ts");
const catalog = require("../lib/integrations/providers/square/catalog-response-validation.ts");
const legacy = require("../lib/integrations/providers/square/catalog-responses.ts");
const validation = require("../lib/integrations/providers/square/response-validation.ts");
const fixtures = require("../lib/integrations/providers/square/fixtures/catalog-response-validation.ts");
const old1 = require("../lib/integrations/providers/square/fixtures/phase-2b1b1.ts");
const old2 = require("../lib/integrations/providers/square/fixtures/phase-2b1b2.ts");
const fixture = fixtures.squareCatalogValidationFixture;
const input = fixtures.squareCatalogValidationParserInput;
const clone = value => JSON.parse(JSON.stringify(value));
const canaries = [fixtures.SQUARE_CATALOG_VALIDATION_CANARY, "fault-sensitive-canary"];
let assertions = 0, scenarios = 0;
const equal = (a,b,m) => { assertions++; assert.equal(a,b,m); };
const deepEqual = (a,b,m) => { assertions++; assert.deepEqual(a,b,m); };
const ok = (v,m) => { assertions++; assert.ok(v,m); };
const throws = (f,m) => { assertions++; assert.throws(f,undefined,m); };
function patch(object,key,value,action) { const before=object[key]; try {object[key]=value;return action();} finally {object[key]=before;} }
function count(value, containers=false) { return value && typeof value === "object" ? 1+Object.values(value).reduce((n,v)=>n+count(v,containers),0) : containers?0:1; }
function freeze(value,seen=new Set()) { if(!value||typeof value!=="object"||seen.has(value))return value;seen.add(value);for(const d of Object.values(Object.getOwnPropertyDescriptors(value)))if("value" in d)freeze(d.value,seen);return Object.freeze(value); }
function deeplyFrozen(value,seen=new Set()) { if(!value||typeof value!=="object"||seen.has(value))return;seen.add(value);ok(Object.isFrozen(value));Object.values(value).forEach(v=>deeplyFrozen(v,seen)); }
function parse(value) {
  scenarios++;let result;let logs=0;
  patch(console,"log",()=>logs++,()=>patch(console,"warn",()=>logs++,()=>patch(console,"error",()=>logs++,()=>{assert.doesNotThrow(()=>{result=catalog.parseSquareCatalogValidatedResponse(value);});})));
  equal(logs,0);deeplyFrozen(result);
  for(const d of result.diagnostics)ok(d.field==="$input"||d.field==="$response");
  for(const c of canaries)ok(!JSON.stringify(result).includes(c));
  return result;
}
const accepted = result => { equal(result.outcome,"accepted",JSON.stringify(result.diagnostics));return result.value; };
const rejected = result => equal(result.outcome,"rejected",JSON.stringify(result.diagnostics));
const internal = result => {rejected(result);deepEqual(result.diagnostics,[{code:"square_response_internal_rejection",field:"$response"}]);};
const get = (object=fixture(), extras={}, context={objectId:object.id,query:{}}) => parse(input({object,...extras},"retrieve_catalog_object",{requestContext:context}));
const search = (objects, body={}, extras={}) => parse(input({objects,...extras},"catalog_search",{requestContext:{body:{object_types:["CATEGORY","ITEM","ITEM_VARIATION","MODIFIER_LIST","MODIFIER","DISCOUNT","TAX"],limit:1000,...body}}}));

function contracts() {
  equal(square.parseSquareCatalogValidatedResponse,catalog.parseSquareCatalogValidatedResponse,"barrel uses trusted facade");
  const variants=[fixture(),old1.squarePhase2B1B1Item(),old1.squarePhase2B1B1ItemVariation(),old2.squarePhase2B1B2ModifierList(),old2.squarePhase2B1B2Modifier(),old2.squarePhase2B1B2FixedPercentageDiscount(),old2.squarePhase2B1B2Tax()];
  for(const raw of variants) {
    const value=accepted(get(raw));equal(value.items[0].catalogObjectType,raw.type);
    const item=value.items[0];
    const children=item.variations??item.modifiers??[];
    const extra=(item.categoryReferences?.length??0)+(item.parentCategory?1:0)+(item.price?1:0)+(item.amount?1:0)+(item.maximumAmount?1:0);
    const fixed=count(item,true)-children.reduce((n,child)=>n+count(child,true),0)-extra;
    equal(fixed,{CATEGORY:4,ITEM:7,ITEM_VARIATION:5,MODIFIER_LIST:6,MODIFIER:5,DISCOUNT:5,TAX:5}[item.catalogObjectType],"field-level own fixed container charge");
    const old=legacy.parseSquareCatalogResponse(old1.squarePhase2B1B1ParserInput({object:raw},"retrieve_catalog_object"));
    deepEqual(value.items,old.value.items,"existing entity projections exact");
    const tombstone={type:raw.type,id:raw.id,version:1,updated_at:"2026-08-19T00:00:00Z",is_deleted:true};
    const deleted=accepted(get(tombstone)).items[0];ok(deleted.isDeleted);equal(deleted.displayName,null);
    equal(count(tombstone),6,"minimum raw entity cost includes tombstones");
    ok(count(deleted,true)<=7,"all fixed branch maxima");
    rejected(parse(input({objects:[tombstone]},"list_catalog")));
    rejected(search([tombstone]));accepted(search([tombstone],{include_deleted_objects:true}));
    const privacy=clone(raw);privacy.custom_attribute_values={secret:canaries[0]};privacy.future={contact:canaries[1]};
    equal(catalog.squareCatalogValidatedResponseFingerprint(accepted(get(privacy))),catalog.squareCatalogValidatedResponseFingerprint(value));
    for(const field of ["version","updated_at","is_deleted"]) { const invalid=clone(raw);delete invalid[field];rejected(get(invalid)); }
  }
  const nested=old1.squarePhase2B1B1Item();nested.item_data.variations=[fixture()];rejected(get(nested));
  const inherited=fixture({present_at_all_locations:true});accepted(get(inherited));
  const unknown=fixture({type:"IMAGE",category_data:undefined});delete unknown.category_data;
  equal(get(unknown).outcome,"unsupported");
  const conflicting=fixture({item_data:{}});rejected(get(conflicting));
  rejected(get(fixture({version:Number.MAX_SAFE_INTEGER+1})));accepted(get(fixture({version:Number.MAX_SAFE_INTEGER})));
  rejected(get(fixture({id:"#temporary"})));
  const item=old1.squarePhase2B1B1Item();item.item_data.variations[0].item_variation_data.pricing_type="FIXED_PRICING";item.item_data.variations[0].item_variation_data.price_money={amount:9007199254740991,currency:"USD"};
  equal(accepted(get(item)).items[0].variations.find(v=>v.id===item.item_data.variations[0].id).price.amountMinor,"9007199254740991");
  const prior=accepted(get());const snapshot=JSON.stringify(prior);const mutable=input({object:fixture()});const frozen=accepted(parse(mutable));mutable.response.object.category_data.name="changed";equal(JSON.stringify(frozen),snapshot);throws(()=>frozen.items.push({}));
}

function requestAndEnvelopes() {
  for(const operation of ["list_catalog","catalog_search","catalog_batch_retrieve"])accepted(parse(input({objects:[fixture()]},operation)));
  accepted(get(fixture(),{related_objects:null}));accepted(parse(input({objects:null,cursor:null},"list_catalog")));
  for(const operation of ["list_catalog","catalog_search","catalog_batch_retrieve"])rejected(parse(input({objects:[fixture(),fixture()]},operation)));
  rejected(get(fixture(),{}, {objectId:"OTHER",query:{}}));
  rejected(parse(input({objects:[fixture({id:"OTHER"})]},"catalog_batch_retrieve")));
  accepted(parse(input({objects:[]},"catalog_batch_retrieve")));
  rejected(search([fixture()],{object_types:["ITEM"]}));
  accepted(search([fixture(),fixture({id:"SECOND"})],{limit:1}));
  accepted(parse(input({objects:Array.from({length:101},(_,i)=>fixture({id:"CAT"+i}))},"catalog_search",{requestContext:{body:{object_types:["CATEGORY"]}}})));
  rejected(parse(input({objects:Array.from({length:101},(_,i)=>fixture({id:"CAT"+i}))},"list_catalog")));
  rejected(get(fixture(),{objects:[]}));rejected(parse(input({objects:[],object:null},"list_catalog")));
  const inventoryAdjustment={id:"ADJUSTMENT_1",catalog_object_id:"VARIATION_1",catalog_object_type:"ITEM_VARIATION",from_state:"IN_STOCK",to_state:"SOLD",from_location_id:"LOC_1",to_location_id:"LOC_1",quantity:"1",occurred_at:"2026-09-01T12:00:00Z"};
  for(const operation of ["list_catalog","catalog_search","catalog_batch_retrieve","retrieve_catalog_object"]) {
    const validEnvelope=operation==="retrieve_catalog_object"?{object:fixture()}:{objects:[fixture()]};
    for(const wrong of ["order","orders","payment","payments","refund","refunds","merchant","merchants","location","locations","count","counts","adjustment","transfer","changes"]) {
      for(const value of [null,[],{},inventoryAdjustment]) {
        const result=parse(input({...validEnvelope,[wrong]:value},operation));
        rejected(result);
        deepEqual(result.diagnostics,[{code:"square_catalog_envelope_mismatch",field:"$response"}],"recognized foreign envelope rejects by presence, including null/empty/populated forms");
      }
    }
  }
  const foreignOnly=parse(input({adjustment:inventoryAdjustment},"catalog_search"));
  rejected(foreignOnly);equal(foreignOnly.diagnostics[0].code,"square_catalog_envelope_mismatch","foreign Inventory response cannot become an empty terminal Catalog page");
  rejected(get(fixture(),{cursor:"cursor"}));rejected(parse(input({objects:[],cursor:"cursor"},"catalog_batch_retrieve")));
  for(const cursor of [0,{},"bad cursor","x".repeat(4097)])rejected(search([],{},{cursor}));
  rejected(get(fixture(),{related_objects:[fixture({id:"RELATED"})]}));
  accepted(get(fixture(),{related_objects:[fixture({id:"RELATED"})]},{objectId:fixture().id,query:{include_related_objects:"true"}}));
  accepted(search([fixture()],{include_related_objects:true},{related_objects:[fixture()]}));
  rejected(search([fixture()],{include_related_objects:true},{related_objects:[fixture({version:2})]}));
  rejected(search([fixture(),old2.squarePhase2B1B2Tax({id:fixture().id})]));
  rejected(search([fixture()],{include_related_objects:true},{related_objects:[old2.squarePhase2B1B2Tax({id:fixture().id})]}));
  const mods=old2.squarePhase2B1B2ModifierList();
  rejected(search([],{},{included_resources:{nested_modifiers:[mods]}}));
  accepted(search([],{include_options:{include:["INCLUDE_NESTED_MODIFIERS"]}},{included_resources:{nested_modifiers:[mods]}}));
  rejected(search([],{include_options:{include:["INCLUDE_NESTED_MODIFIERS"]}},{included_resources:{ancestor_modifiers:[mods]}}));
  const old=fixture({version:1});accepted(get(old,{}, {objectId:old.id,query:{catalog_version:"2"}}));rejected(get(fixture({version:3}),{}, {objectId:old.id,query:{catalog_version:"2"}}));
  for(const operation of ["list_catalog","catalog_search"]) {
    const firstInput=input({objects:[],cursor:"CURSOR001=="},operation);
    const first=accepted(parse(firstInput));
    const context=clone(firstInput.requestContext),key=operation==="list_catalog"?"query":"body";
    context[key].cursor="CURSOR001==";context.expectedCursorBindingFingerprint=first.cursorBindingFingerprint;context.expectedResponseCursorFingerprint=first.pagination.cursorFingerprint;
    accepted(parse(input({objects:[]},operation,{requestContext:context})));
    for(const field of ["workspaceId","connectionId","providerEntityId"]) {
      const moved=input({objects:[]},operation,{requestContext:context});moved.connectionAuthority[field]=field==="providerEntityId"?"OTHER_MERCHANT":"30000000-0000-4000-8000-000000000001";rejected(parse(moved));
    }
    const changed=clone(context);if(key==="query")changed.query.types="ITEM";else changed.body.query={prefix_query:{attribute_name:"name",attribute_prefix:"Other"}};rejected(parse(input({objects:[]},operation,{requestContext:changed})));
    for(const field of ["expectedResponseCursorFingerprint","expectedCursorBindingFingerprint"]){const bad=clone(context);delete bad[field];rejected(parse(input({objects:[]},operation,{requestContext:bad})));}
  }
  for(const query of [{types:"CATEGORY&cursor=bad"},{types:"CATEGORY",location_id:"OTHER"},{types:"IMAGE"},{types:"CATEGORY",catalog_version:"-1"}])rejected(parse(input({objects:[]},"list_catalog",{requestContext:{query}})));
  equal(get(fixture(),{errors:[{category:"API_ERROR",code:"INTERNAL_SERVER_ERROR",detail:canaries[0]}]}).outcome,"unsupported");
  rejected(get(fixture(),{errors:"bad"}));
}

function rawSafety() {
  let traps=0,getters=0;const proxy=new Proxy({}, {getPrototypeOf(){traps++;throw Error(canaries[0]);},ownKeys(){traps++;return[];}});
  const revoked=Proxy.revocable({},{});revoked.revoke();const accessor={};Object.defineProperty(accessor,"secret",{enumerable:true,get(){getters++;return canaries[0];}});
  const cycle={};cycle.self=cycle;const sparse=Array(2);sparse[1]=1;const custom=[];custom.extra=1;
  for(const attack of [proxy,revoked.proxy,accessor,cycle,sparse,custom,{[Symbol("x")]:1},{value:undefined},NaN,Infinity,-0,1n,()=>1,Object.create({a:1}),Array(1001).fill(0),"x".repeat(4097)])rejected(get(fixture({future:attack})));
  for(const field of ["response","connectionAuthority","requestContext","operation"]) {const raw=input({object:fixture()});raw[field]=proxy;rejected(parse(raw));}
  const operationRevoked=input({object:fixture()});operationRevoked.operation=revoked.proxy;rejected(parse(operationRevoked));
  equal(traps,0);equal(getters,0);
  const incompatible=input({object:fixture()});incompatible.apiVersion="2025-01-01";equal(parse(incompatible).outcome,"incompatible-version");
  accepted(get(Object.assign(Object.create(null),fixture())));
}

function bounds() {
  equal(catalog.SQUARE_CATALOG_MAXIMUM_RESULT_CONTAINERS,8+20_000+Math.floor(19_999/6));
  // Enumerate all allocations in the relaxed proof, not hand-selected payloads.
  let maximum=0;for(let n=0;n<=3333;n++) {const extras=19999-6*n;maximum=Math.max(maximum,9+7*n+extras);}equal(maximum,23341);
  const raw=fixtures.squareCatalogValidationMaximumEnvelope();equal(count(raw),20000);
  const context={body:{object_types:["ITEM"],limit:1000,include_deleted_objects:true,include_related_objects:true,include_options:{include:["INCLUDE_NESTED_MODIFIERS"]}}};
  const started=performance.now();const result=parse(input(raw,"catalog_search",{requestContext:context}));accepted(result);equal(count(result,true),20009);ok(count(result,true)<=maximum);
  raw.related_objects=raw.objects;equal(count(raw),20000,"productive primary/related aliases count per occurrence");
  const sharedResult=accepted(parse(input(raw,"catalog_search",{requestContext:context})));
  equal(catalog.squareCatalogValidatedResponseFingerprint(sharedResult),catalog.squareCatalogValidatedResponseFingerprint(accepted(parse(input(clone(raw),"catalog_search",{requestContext:context})))),"shared and expanded equivalent graphs produce identical fingerprints");
  const alias=Array(996).fill(0);raw.future=[alias,alias];equal(count(raw),20000);accepted(parse(input(raw,"catalog_search",{requestContext:context})));alias.push(0);rejected(parse(input(raw,"catalog_search",{requestContext:context})));
  const tooLarge=fixtures.squareCatalogValidationMaximumEnvelope();tooLarge.extra=0;equal(count(tooLarge),20001);
  let hashes=0;patch(validation,"squareMinimizedProjectionFingerprint",()=>{hashes++;throw Error("hash should not run");},()=>rejected(parse(input(tooLarge,"catalog_search",{requestContext:context}))));equal(hashes,0);
  // Every operation can consume the full raw boundary without discarded data
  // changing its projection. All seven live branches retain their own maxima.
  for(const operation of ["list_catalog","catalog_search","catalog_batch_retrieve","retrieve_catalog_object"]) {
    const envelope=operation==="retrieve_catalog_object"?{object:fixture()}:{objects:[fixture()]};
    let remaining=20000-count(envelope)-1;envelope.future=[];
    while(remaining>0){const size=Math.min(1000,remaining-1);if(size<0)break;envelope.future.push(Array(size).fill(0));remaining-=size+1;}
    equal(count(envelope),20000);accepted(parse(input(envelope,operation)));envelope.extra=0;rejected(parse(input(envelope,operation)));
  }
  console.log("Catalog bound witnesses:",JSON.stringify({provenConservativeCap:maximum,raw:20000,observedContainers:20009,elapsedMs:Math.round(performance.now()-started)}));
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
  const originalSafeParse = catalog.SquareCatalogValidatedResponseSchema.safeParse;
  const replay = parse(input({ object: fixture() }));
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

  for (const target of [23_341, 23_342]) {
    let returned = false, postSchema = 0, postHash = 0, actualCount = 0;
    try {
      catalog.SquareCatalogValidatedResponseSchema.safeParse = (...args) => {
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
      equal(postSchema, target === 23_341 ? 1 : 0, "inclusive boundary before schema");
      equal(postHash, target === 23_341 ? 1 : 0, "above cap rejects before fingerprint");
    } finally {
      validation.squareAcceptedResult = originalAccepted;
      validation.squareMinimizedProjectionFingerprint = originalHash;
      catalog.SquareCatalogValidatedResponseSchema.safeParse = originalSafeParse;
    }
  }
  // Inject into the initial schema result: wrapper-inclusive preflight must reject
  // before the accepted factory or its fingerprint work.
  const originalParse = legacy.SquareCatalogResponseSchema.parse;
  let injected = false, factoryCalls = 0, hashesAfterInjection = 0;
  try {
    legacy.SquareCatalogResponseSchema.parse = (...args) => {
      const value = originalParse(...args);
      value.provider = repeatedGraph(23_342 - count(value, true) - 1);
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
    legacy.SquareCatalogResponseSchema.parse = originalParse;
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
    () => { throw proxy({}); },
    () => { throw revoked.proxy; },
    () => proxy({}), () => revoked.proxy
  ]) patch(validation, "squareSafeJsonObject", sanitizer, () => {
    rejected(get());
    patch(validation, "squareFailureResult", () => { throw new Error(canaries[1]); }, () => internal(get()));
  });
  for(const fault of [proxy({}),revoked.proxy]) {
    patch(legacy.SquareCatalogResponseSchema,"parse",()=>{throw fault;},()=>internal(get()));
    patch(validation,"squareAcceptedResult",()=>{throw fault;},()=>internal(get()));
  }
  equal(trapCalls,0,"thrown Proxy/revoked Proxy never reflected by legacy or facade catches");
  // Fault output can use only whitelisted static diagnostics, reduced to a root.
  patch(validation, "squareFailureResult", () => ({ outcome: "rejected", diagnostics: [{ code: "square_identifier_invalid", field: "$input.nested" }] }), () => {
    deepEqual(get(fixture({ id: 1 })).diagnostics, [{ code: "square_identifier_invalid", field: "$input" }]);
  });
  validation.squareFailureResult = originalFailure;

  // Public fingerprint helpers have the same pre-schema guard, including aliases.
  for (const [schema, fingerprint] of [
    [catalog.SquareCatalogValidatedResponseSchema, catalog.squareCatalogValidatedResponseFingerprint]
  ]) {
    let schemaCalls = 0, hashCalls = 0;
    patch(schema, "parse", () => { schemaCalls++; throw new Error("schema should not run"); }, () =>
      patch(validation, "squareMinimizedProjectionFingerprint", () => { hashCalls++; return "unexpected"; }, () => {
        throws(() => fingerprint(repeatedGraph(23_342)));
        throws(() => fingerprint(revoked.proxy));
      }));
    equal(schemaCalls, 0); equal(hashCalls, 0);
  }
}

contracts();
requestAndEnvelopes();
rawSafety();
bounds();
testResultBoundaryFaults();
const baseline=accepted(get());
const legacyBaseline=legacy.parseSquareCatalogResponse(old1.squarePhase2B1B1ParserInput({object:fixture()},"retrieve_catalog_object"));
equal(legacy.squareCatalogResponseFingerprint(legacyBaseline.value),"sha256:45b9eae3c566ed321a56e52c807c8b8f8825e5f4da359397cb0fe4ae238b503a","legacy response golden preserved");
let networkCalls=0;patch(global,"fetch",()=>{networkCalls++;throw Error("no transport");},()=>accepted(get()));equal(networkCalls,0);
const source=fs.readFileSync(path.join(root,"lib/integrations/providers/square/catalog-response-validation.ts"),"utf8");
assert.doesNotMatch(source,/\bfetch\s*\(|axios|node:https|node:http|process\.env|@supabase|generateText|streamText/);
const goldens={response:catalog.squareCatalogValidatedResponseFingerprint(baseline),requestAuthority:baseline.requestAuthorityFingerprint,request:baseline.requestFingerprint,cursor:baseline.cursorBindingFingerprint,legacyEntity:legacy.squareCatalogObjectFingerprint(baseline.items[0])};
deepEqual(goldens,{
  response:"sha256:e0e64ecba46bc02c0b763c6b5a7e0c96b6a499ab551eaa27bc29e31c9efce1f0",
  requestAuthority:"sha256:8821d687adc2db492abc59516060ecff846282a7f42c324cff657cd3d66a6bcd",
  request:"sha256:390c21eedbcf4c9cf633da9ab6f805760948605b0696194d320260c718544634",
  cursor:"sha256:f858235b1de3542ba703d1e7e1e8b6e65df6cedd700eadceb44c0476e877a5ce",
  legacyEntity:"sha256:a3c1e278ad2651889bb10dbfc2e2d87116176cbe12f7c58c534eb3023123c61c"
});
console.log("Catalog validation fingerprints:",JSON.stringify(goldens));
console.log(`Catalog validation: ${assertions} assertions across ${scenarios} parser scenarios.`);
