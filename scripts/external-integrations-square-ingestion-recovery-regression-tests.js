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
const { contractSha256 } = require("../lib/integrations/contracts/canonical.ts");
const { squareIngestionScopeFingerprint } = require("../lib/integrations/providers/square/ingestion-contracts.ts");
const { SQUARE_SOURCE_MAPPING_VERSION, assertSquarePendingSource } = require("../lib/integrations/providers/square/ingestion-mapping.ts");
const { createSquareSyntheticPageRepository, SQUARE_SYNTHETIC_REPOSITORY_LIMITS: limits } = require("../lib/integrations/providers/square/ingestion-page-repository.ts");
let assertions = 0, scenarios = 0;
const equal = (a,b,m) => { assertions++; assert.equal(a,b,m); };
const deepEqual = (a,b,m) => { assertions++; assert.deepEqual(a,b,m); };
const ok = (a,m) => { assertions++; assert.ok(a,m); };
const throws = (f,m) => { assertions++; assert.throws(f, undefined, m); };
const rejects = async (f,m) => { assertions++; await assert.rejects(f, undefined, m); };
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => contractSha256({ synthetic: value });
const now = 1_788_739_200_000;
const scope = Object.freeze({ workspaceId: "10000000-0000-4000-8000-000000000001", businessEntityId: "20000000-0000-4000-8000-000000000001", connectionId: "30000000-0000-4000-8000-000000000001", sellerId: "MERCHANT_1", environment: "sandbox", authorizedLocationIds: Object.freeze(["LOC_1"]), generation: 1 });
const scopeFingerprint = squareIngestionScopeFingerprint(scope);
const binding = (scan = "scan1", overrides = {}) => ({ scanKey: hash(scan), scopeFingerprint, queryFingerprint: hash("query"), cursorBindingFingerprint: hash("cursor-binding"), generation: 1, ...overrides });
const completeness = continuation => ({ pageSequence: continuation ? "partial" : "finished", historical: "unknown", economic: "blocked", reasons: ["history_unknown", "economic_fields_omitted", "references_unresolved", ...(continuation ? ["partial_page_sequence"] : [])] });
const cursor = (value = "PRIVATE_CURSOR_CANARY", expiresAt = now + 100_000) => ({ value, responseFingerprint: hash(value), expiresAt });
function model(options = {}) { return createSquareSyntheticPageRepository({ currentGenerations: [{ scopeFingerprint, generation: 1 }], ...options }); }
async function lease(model, key = binding(), time = now) { const result = await model.repository.acquire(key,time); equal(result.outcome,"leased"); return result.lease; }
async function commit(model, input) {
  const result=await model.repository.commitPage(input);
  deepEqual(Object.keys(result).sort(),["completeness","continuation","outcome"]);
  equal(typeof result.continuation,"boolean");deeplyFrozen(result);
  if(result.outcome==="conflict")equal(result.continuation,false);
  return result.outcome;
}
function command(lease, sources = [], nextCursor = null, time = now, page = "page1") { return { lease, pageId: hash(page), sources, completeness: completeness(nextCursor !== null), nextCursor, now: time }; }
// Explicit synthetic integrity fixtures, not trusted invocation/registry grants.
function pending(id = "CAT_1", revision = { version: "1", updatedAt: "2026-09-01T00:00:00Z" }, data = { label: "Fixture" }, overrides = {}) {
  const selectedScope = overrides.scope ?? scope;
  const stream = overrides.stream ?? "catalog", providerRecordType = overrides.providerRecordType ?? "square_catalog_primary_category";
  const stableScope = { workspaceId: selectedScope.workspaceId, businessEntityId: selectedScope.businessEntityId, connectionId: selectedScope.connectionId, sellerId: selectedScope.sellerId, environment: selectedScope.environment };
  const resourceKey = contractSha256({ purpose: "square_source_resource_identity_v1", scope: stableScope, stream, providerRecordType, providerRecordId: id });
  const projection = overrides.deleted === true ? null : { mappingVersion: SQUARE_SOURCE_MAPPING_VERSION, stream, role: "primary", authority: "pending_provider_observation_not_economic_authority", data: stream === "catalog" ? { id, catalogObjectType: "CATEGORY", isDeleted: false, ...data } : data };
  const source = { resourceKey, scope: selectedScope, stream, providerRecordId: id, providerRecordType, providerRevision: revision, observedAt: "2026-09-06T00:00:00Z", deleted: false, projection, ...overrides };
  source.versionKey = contractSha256({ purpose: "square_source_observed_version_v1", mappingVersion: SQUARE_SOURCE_MAPPING_VERSION, resourceKey, providerRevision: source.providerRevision, deleted: source.deleted, projection: source.projection });
  assertSquarePendingSource(source);
  return source;
}
function deeplyFrozen(value, seen = new Set()) { if (!value || typeof value !== "object" || seen.has(value)) return; seen.add(value); ok(Object.isFrozen(value)); for (const child of Object.values(value)) deeplyFrozen(child, seen); }

async function authorityAndLease() {
  scenarios++;
  const empty = createSquareSyntheticPageRepository();
  equal((await empty.repository.acquire(binding(),now)).outcome,"conflict","generation is never self-authorized");
  empty.setCurrentGeneration(scopeFingerprint,1);
  const first = await lease(empty);
  equal(first.attempt,1); equal(first.pageNumber,1); equal(first.checkpointVersion,0); equal(first.cursor,null);
  deeplyFrozen(first);
  for (const [key,value] of Object.entries({ scanKey: hash("other"), scopeFingerprint: hash("other"), queryFingerprint: hash("other"), cursorBindingFingerprint: hash("other"), generation: 2 })) {
    if (key === "scanKey") continue; // A new authorized scan is intentionally possible.
    equal((await empty.repository.acquire({...binding(),[key]:value},now)).outcome,"conflict",key);
    equal(await commit(empty,command({...first,binding:{...first.binding,[key]:value}},[pending()])),"conflict",key);
  }
  for (const field of ["leaseId","expiresAt","checkpointVersion","attempt","pageNumber","cursor"]) {
    const altered = clone(first); altered[field] = field === "leaseId" ? hash("forged") : field === "cursor" ? cursor() : altered[field] + 1;
    equal(await commit(empty,command(altered,[pending()])),"conflict",field);
  }
  equal((await empty.repository.acquire(binding(),now - 1)).outcome,"conflict");
  equal((await empty.repository.acquire(binding(),now)).outcome,"conflict");
  const before = JSON.stringify(empty.inspect());
  empty.setCurrentGeneration(scopeFingerprint,2);
  equal(await commit(empty,command(first,[pending()])) ,"conflict","reconnect fences old lease");
  equal((await empty.repository.acquire(binding(),now)).outcome,"conflict");
  equal((await empty.repository.acquire(binding("scan1",{generation:2}),now)).outcome,"conflict","existing scan cannot change generations");
  throws(()=>empty.setCurrentGeneration(scopeFingerprint,1));
  throws(()=>empty.setCurrentGeneration(scopeFingerprint,0));
  equal(JSON.stringify(empty.inspect()),before,"generation state is private and source/checkpoint unaffected");
  const newLease = await lease(empty,binding("new-scan",{generation:2}));
  equal(await commit(empty,command(newLease,[pending("CAT_1",undefined,undefined,{scope:{...scope,generation:2}})])),"committed");
  const simultaneous = model();
  const acquired = await Promise.all(Array.from({length:20},()=>simultaneous.repository.acquire(binding(),now)));
  equal(acquired.filter(result=>result.outcome==="leased").length,1,"exclusive lease publication");
  equal(acquired.filter(result=>result.outcome==="conflict").length,19);
}

async function cursorCustodyAndRetries() {
  scenarios++;
  const m = model(); const first = await lease(m);
  const page1 = command(first,[pending()],cursor());
  equal(await commit(m,page1),"committed");
  equal(m.inspect().scans[0].checkpointVersion,1);
  ok(!JSON.stringify(m.inspect()).includes("PRIVATE_CURSOR_CANARY"),"normal inspection redacts private cursor");
  equal(m.inspect({includePrivateCursors:true}).scans[0].cursor.value,"PRIVATE_CURSOR_CANARY");
  const next = await lease(m,binding(),now+1);
  deepEqual(next.cursor,cursor()); equal(next.pageNumber,2); equal(next.attempt,1);
  for (const field of ["value","responseFingerprint","expiresAt"]) {
    const altered=clone(next); altered.cursor[field] = field === "value" ? "SWAPPED" : field === "responseFingerprint" ? hash("swapped") : now+200_000;
    equal(await commit(m,command(altered,[pending("CAT_2")],null,now+1,"page2")),"conflict",field);
  }
  equal(await commit(m,command(next,[pending("CAT_2")],cursor(),now+1,"page2")),"conflict","non-progressing cursor denied");
  equal(await commit(m,command(next,[pending("CAT_2")],cursor("NEXT",now+1),now+1,"page2")),"conflict","expired next cursor");
  equal(await commit(m,command(next,[pending("CAT_2")],cursor("NEXT",now+1+limits.cursorTtlMs+1),now+1,"page2")),"conflict","cursor TTL bounded");
  for (const value of ["x".repeat(4097),"bad cursor","x".repeat(4095)+"=="]) equal(await commit(m,command(next,[],cursor(value),now+1,"invalid")),"conflict");
  equal(await commit(m,command(next,[pending("CAT_2")],cursor("x".repeat(4094)+"=="),now+1,"page2")),"committed","Square 4096-character private cursor accepted");
  equal((await m.repository.acquire(binding(),now+100_000)).outcome,"expired");
  equal(m.inspect().scans[0].checkpointVersion,2);
  equal(m.inspect().scans[0].completeness.pageSequence,"blocked");
  ok(m.inspect().scans[0].completeness.reasons.includes("interrupted_scan"));
  equal(await commit(m,page1),"replayed","receipt survives cursor expiry without eviction");
  const retry = model({leaseMs:10}); let attempt = await lease(retry);
  for(let i=1;i<=3;i++) {
    equal(attempt.attempt,i);
    equal(await commit(retry,command(attempt,[pending()],null,attempt.expiresAt)),"conflict","expiry is exclusive");
    const result = await retry.repository.acquire(binding(),attempt.expiresAt);
    equal(result.outcome,i===3?"blocked":"leased"); if(result.outcome==="leased") attempt=result.lease;
  }
  equal(retry.inspect().sourceVersionCount,0); equal(retry.inspect().scans[0].checkpointVersion,0);
  const released = model(); let active = await lease(released);
  await released.repository.release(active,{now,retryAfterMs:1_000_000,blocked:false});
  equal(released.inspect().scans[0].notBefore,now+60_000);
  equal((await released.repository.acquire(binding(),now+59_999)).outcome,"deferred");
  const deferred=await released.repository.acquire(binding(),now+59_999);
  equal(deferred.retryAfterMs,1);equal(deferred.completeness.pageSequence,"partial");
  ok(deferred.completeness.reasons.includes("interrupted_scan"));deeplyFrozen(deferred);
  active = await lease(released,binding(),now+60_000);
  await released.repository.release(active,{now:now+60_000,retryAfterMs:null,blocked:false});
  equal(released.inspect().scans[0].notBefore,now+62_000);
  active = await lease(released,binding(),now+62_000);
  await released.repository.release(active,{now:now+62_000,retryAfterMs:0,blocked:false});
  equal((await released.repository.acquire(binding(),now+62_000)).outcome,"blocked");
  const blocked = model(); const blockedLease=await lease(blocked);
  await blocked.repository.release(blockedLease,{now,retryAfterMs:null,blocked:true,completeness:{...completeness(false),pageSequence:"blocked",reasons:[...completeness(false).reasons,"unsupported_page"]}});
  equal((await blocked.repository.acquire(binding(),now+100_000)).outcome,"blocked");
  const restartedBlocked=await blocked.repository.acquire(binding(),now+100_000);
  equal(restartedBlocked.completeness.pageSequence,"blocked");
  ok(restartedBlocked.completeness.reasons.includes("unsupported_page"),"unsupported page reason persists on restart");
  ok(restartedBlocked.completeness.reasons.includes("interrupted_scan"));
  equal(blocked.inspect().sourceVersionCount,0);equal(blocked.inspect().scans[0].checkpointVersion,0);
}

async function atomicFaultsAndReplay() {
  scenarios++;
  for(const point of ["before_stage","during_stage"]) {
    const m=model(), active=await lease(m), page=command(active,[pending("ONE"),pending("TWO")],cursor());
    const before=JSON.stringify(m.inspect({includePrivateCursors:true}));
    m.injectFault(point); await rejects(()=>commit(m,page),point);
    equal(JSON.stringify(m.inspect({includePrivateCursors:true})),before,"no partial publication "+point);
    equal(await commit(m,page),"committed");
    equal(m.inspect().sourceVersionCount,2); equal(m.inspect().scans[0].checkpointVersion,1);
    equal(await commit(m,page),"replayed");
    equal(m.inspect().sourceVersionCount,2);
  }
  const m=model(), active=await lease(m), page=command(active,[pending()],cursor());
  m.injectFault("after_commit"); await rejects(()=>commit(m,page));
  equal(m.inspect().sourceVersionCount,1); equal(m.inspect().scans[0].checkpointVersion,1);
  equal(await commit(m,{...page,now:now+limits.leaseMs+1}),"replayed","lost ACK returns committed receipt after lease expiry");
  const unchanged=JSON.stringify(m.inspect());
  equal(await commit(m,{...page,sources:[pending("CHANGED")]}),"conflict","page identity cannot authorize another payload");
  equal(await commit(m,{...page,nextCursor:cursor("OTHER")}),"conflict");
  equal(JSON.stringify(m.inspect()),unchanged);
  const resumed=await lease(m,binding(),now+limits.leaseMs+1);
  deepEqual(resumed.cursor,page.nextCursor);
  equal(await commit(m,command(resumed,[pending()],null,now+limits.leaseMs+1,"page2")),"committed");
  equal(m.inspect().sourceVersionCount,1,"duplicate version across pages deduplicated");
  equal(m.inspect().scans[0].checkpointVersion,2);
  equal((await m.repository.acquire(binding(),now+limits.leaseMs+2)).outcome,"finished");
  const finished=await m.repository.acquire(binding(),now+limits.leaseMs+2);
  equal(finished.completeness.pageSequence,"finished");equal(finished.completeness.historical,"unknown");equal(finished.completeness.economic,"blocked");equal(finished.retryAfterMs,null);
  const replayFinished=await m.repository.commitPage(page);
  equal(replayFinished.outcome,"replayed");equal(replayFinished.continuation,false);deepEqual(replayFinished.completeness,finished.completeness,"replay returns latest persisted policy, not stale page-local continuation");
  const concurrent=model(), concurrentLease=await lease(concurrent), concurrentPage=command(concurrentLease,[pending()]);
  const results=await Promise.all(Array.from({length:20},()=>commit(concurrent,concurrentPage)));
  equal(results.filter(result=>result==="committed").length,1);
  equal(results.filter(result=>result==="replayed").length,19);
  equal(concurrent.inspect().sourceVersionCount,1);equal(concurrent.inspect().scans[0].checkpointVersion,1);
  const expiredReplay=model(), expiringLease=await lease(expiredReplay), expiringPage=command(expiringLease,[],cursor("SHORT",now+1));
  equal(await commit(expiredReplay,expiringPage),"committed");
  const noContinuation=await expiredReplay.repository.commitPage({...expiringPage,now:now+1});
  equal(noContinuation.outcome,"replayed");equal(noContinuation.continuation,false,"a receipt cannot advertise an already expired cursor");
  equal((await expiredReplay.repository.acquire(binding(),now+1)).outcome,"expired");
}

async function immutableVersions() {
  scenarios++;
  const m=model(), original=pending(); let active=await lease(m);
  equal(await commit(m,command(active,[original,clone(original)],cursor("C1"))),"committed");
  equal(m.inspect().sourceVersionCount,1,"same-page duplicates deduplicate");
  const originalStored=JSON.stringify(m.inspect().sources[0]);
  original.projection.data.label="mutated caller";
  equal(JSON.stringify(m.inspect().sources[0]),originalStored,"input tree is copied before custody");
  const observations = [
    pending("CAT_1",{version:"3",updatedAt:"2026-09-01T00:00:00Z"},{label:"new"}),
    pending("CAT_1",{version:"2",updatedAt:"2026-09-02T00:00:00Z"},{label:"late old"}),
    pending("CAT_1",{version:"3",updatedAt:"2026-09-03T00:00:00Z"},{label:"equal changed"}),
    pending("CAT_1",{version:null,updatedAt:"2026-09-04T00:00:00Z"},{label:"unknown"}),
    pending("CAT_1",{version:"4",updatedAt:null},undefined,{deleted:true})
  ];
  for(let i=0;i<observations.length;i++) {
    active=await lease(m,binding(),now+i+1);
    equal(await commit(m,command(active,[observations[i]],cursor("C"+(i+2)),now+i+1,"version"+i)),"committed");
  }
  const state=m.inspect(); deepEqual(state.sources.map(source=>source.ordering),["newer","newer","older","conflict","unordered","newer"]);
  ok(state.scans[0].completeness.reasons.includes("unordered_provider_revision"),"later correction does not erase prior scan limitations");
  equal(state.resources[0].currentVersionKey,observations[4].versionKey,"only provably newer replaces current candidate");
  equal(state.resources[0].versionCount,6);
  for(let i=0;i<state.sources.length;i++) {
    const version=state.sources[i].version;
    equal(version.immutableVersion,i+1); equal(version.priorVersionId,i===0?null:state.sources[i-1].version.id);
    equal(version.validation.state,"pending"); equal(version.trust,"untrusted_external_input");
  }
  equal(state.sources[5].version.changeKind,"deleted");equal(state.sources[5].version.normalizedProjection,null);
  equal(JSON.stringify(state.sources[0]),originalStored);
  // A different observation time / reconnect generation does not create another version.
  m.setCurrentGeneration(scopeFingerprint,2);
  active=await lease(m,binding("reconnect",{generation:2}),now+20);
  const duplicate=pending("CAT_1",{version:"4",updatedAt:null},undefined,{deleted:true,observedAt:"2026-09-07T00:00:00Z",scope:{...scope,generation:2}});
  equal(duplicate.versionKey,observations[4].versionKey);
  equal(await commit(m,command(active,[duplicate],null,now+20,"reconnect-page")),"committed");
  equal(m.inspect().sourceVersionCount,6);equal(JSON.stringify(m.inspect().sources),JSON.stringify(state.sources));
  deeplyFrozen(m.inspect());
  throws(()=>m.inspect().sources.push({}));
  // Missing records on a terminal empty scan never imply deletion.
  active=await lease(m,binding("empty",{generation:2}),now+21);
  equal(await commit(m,command(active,[],null,now+21,"empty")),"committed");
  equal(m.inspect().sourceVersionCount,6);
  // Timestamp-only revisions preserve sub-millisecond ordering; absent clocks remain unordered.
  const timestamps=model();
  const revisions=[{version:null,updatedAt:"2026-09-01T00:00:00.000001Z"},{version:null,updatedAt:"2026-09-01T00:00:00.000002Z"},{version:null,updatedAt:null}];
  for(let i=0;i<3;i++) {
    const t=await lease(timestamps,binding("time"+i),now+i);
    equal(await commit(timestamps,command(t,[pending("TIME",revisions[i],{n:i})],null,now+i,"time"+i)),"committed");
  }
  deepEqual(timestamps.inspect().sources.map(source=>source.ordering),["newer","newer","unordered"]);
  equal(timestamps.inspect().resources[0].currentVersionKey,timestamps.inspect().sources[1].pending.versionKey);
}

async function capacityAndNoEviction() {
  scenarios++;
  equal(limits.commandContainers,66_000);equal(limits.commandValues,7_200_000);
  equal(limits.sourceVersions,10_000);equal(limits.retainedBytes,64*1024*1024);
  const versions=model({maximumSourceVersions:1}); let active=await lease(versions);
  equal(await commit(versions,command(active,[pending("ONE"),pending("TWO")],cursor())),"conflict");
  equal(versions.inspect().sourceVersionCount,0);equal(versions.inspect().scans[0].checkpointVersion,0);equal(versions.inspect().scans[0].cursor,null);
  equal((await versions.repository.acquire(binding(),now)).outcome,"blocked","capacity failure blocks whole page, never skips a record");
  const scans=model({maximumScans:1}); active=await lease(scans);
  const first=command(active,[pending()]);equal(await commit(scans,first),"committed");
  equal((await scans.repository.acquire(binding("extra"),now)).outcome,"blocked");
  equal(await commit(scans,first),"replayed","scan capacity never evicts replay receipts");
  const pages=model({maximumPagesPerScan:1});active=await lease(pages);
  equal(await commit(pages,command(active,[pending()],cursor())),"committed");
  equal((await pages.repository.acquire(binding(),now+1)).outcome,"blocked");
  equal(pages.inspect().scans[0].completeness.pageSequence,"blocked");
  const pageLimitReplay=await pages.repository.commitPage(command(active,[pending()],cursor()));
  equal(pageLimitReplay.outcome,"replayed");equal(pageLimitReplay.continuation,false);equal(pageLimitReplay.completeness.pageSequence,"blocked");
  ok(pageLimitReplay.completeness.reasons.includes("interrupted_scan"));
  const sources=model({maximumSourcesPerPage:1});active=await lease(sources);
  equal(await commit(sources,command(active,[pending("ONE"),pending("TWO")])),"conflict");equal(sources.inspect().scans[0].checkpointVersion,0);
  // Exact logical-retention budget boundaries; no heap-size/exactly-once claim.
  const baseline=model();active=await lease(baseline);equal(await commit(baseline,command(active,[pending()])),"committed");
  const footprint=baseline.inspect();
  for(const [optionName,metric] of [["maximumRetainedBytes","retainedBytes"],["maximumRetainedContainers","retainedContainers"]]) {
    for(const delta of [0,-1]) {
      const bounded=model({[optionName]:footprint[metric]+delta});const boundedLease=await lease(bounded);
      equal(await commit(bounded,command(boundedLease,[pending()])),delta===0?"committed":"conflict",optionName);
      equal(bounded.inspect().sourceVersionCount,delta===0?1:0);
      equal(bounded.inspect().scans[0].checkpointVersion,delta===0?1:0);
    }
  }
  for(const config of [{maximumScans:33},{maximumPagesPerScan:101},{maximumSourceVersions:10001},{maximumSourcesPerPage:3001},{maximumRetainedBytes:limits.retainedBytes+1},{maximumRetainedContainers:limits.retainedContainers+1},{leaseMs:30001},{maximumScans:0},{unexpected:true}]) throws(()=>model(config));
  throws(()=>createSquareSyntheticPageRepository({maximumRetainedBytes:1}),"initial state must fit configured logical capacity");
  throws(()=>createSquareSyntheticPageRepository({maximumRetainedContainers:1}));
}

async function structuralAndScopeFailures() {
  scenarios++;
  const m=model(), active=await lease(m), valid=command(active,[pending()]);
  const before=JSON.stringify(m.inspect()); let traps=0;
  const proxy=new Proxy(valid,{get(){traps++;throw new Error("sensitive trap");},ownKeys(){traps++;throw new Error("sensitive trap");},getPrototypeOf(){traps++;throw new Error("sensitive trap");}});
  const revocable=Proxy.revocable({},{});revocable.revoke();
  const accessor={...valid};Object.defineProperty(accessor,"sources",{enumerable:true,get(){traps++;throw new Error("sensitive getter");}});
  const cyclic={...valid};cyclic.sources=[cyclic];
  const sparse={...valid,sources:Array(1)};
  const inherited=Object.create(valid);
  const symbol={...valid,[Symbol("secret")]:"sensitive"};
  const hidden={...valid};Object.defineProperty(hidden,"hidden",{value:"sensitive"});
  const nullProto=Object.assign(Object.create(null),valid);
  for(const input of [proxy,revocable.proxy,accessor,cyclic,sparse,inherited,symbol,hidden,nullProto,{...valid,sources:Array(3001).fill(pending())},{...valid,now:-0},{...valid,now:Infinity},{...valid,extra:"sensitive"}]) equal(await commit(m,input),"conflict");
  equal(traps,0,"Proxy/accessor rejection does not execute untrusted code");
  for(const field of ["workspaceId","businessEntityId","connectionId","sellerId","environment","authorizedLocationIds","generation"]) {
    const badScope={...scope,[field]:field==="sellerId"?"OTHER":field==="environment"?"production":field==="authorizedLocationIds"?["OTHER"]:field==="generation"?2:"90000000-0000-4000-8000-000000000001"};
    equal(await commit(m,{...valid,sources:[pending("CAT_1",undefined,undefined,{scope:badScope})]}),"conflict",field);
  }
  for(const changed of [{resourceKey:hash("forged")},{versionKey:hash("forged")},{projection:null},{observedAt:"invalid"},{providerRevision:{version:"opaque",updatedAt:null}}]) equal(await commit(m,{...valid,sources:[{...pending(),...changed}]}),"conflict");
  const payment=pending("PAYMENT",{version:null,updatedAt:null},{},{stream:"payments",providerRecordType:"square_payment"});
  equal(await commit(m,{...valid,sources:[pending(),payment]}),"conflict","mixed projection scopes cannot share page");
  equal(await commit(m,{...valid,completeness:{...valid.completeness,pageSequence:"blocked"}}),"conflict");
  equal(await commit(m,{...valid,completeness:completeness(true)}),"conflict");
  equal(await commit(m,{...valid,completeness:{...valid.completeness,economic:"complete"}}),"conflict");
  await m.repository.release({...active,leaseId:hash("forged")},{now,retryAfterMs:0,blocked:true});
  await m.repository.release(active,{now,retryAfterMs:-1,blocked:true});
  await m.repository.release(active,{now,retryAfterMs:0,blocked:true,completeness:{...completeness(false),economic:"complete"}});
  equal(JSON.stringify(m.inspect()),before,"all malformed/scope failures preserve custody atomically");
  // Shared references are charged at each occurrence, not unique-object counted.
  let branch={};for(let i=0;i<16;i++)branch={a:branch,b:branch};
  equal(await commit(m,{...valid,sources:[{...pending(),projection:branch}]}),"conflict","expanded container tree bounded");
  let depth={};for(let i=0;i<65;i++)depth={child:depth};
  equal(await commit(m,{...valid,sources:[{...pending(),projection:depth}]}),"conflict");
  equal(await commit(m,valid),"committed","invalid attempts never consume source/checkpoint state");
}

async function expandedBoundaryAccounting() {
  scenarios++;
  const count = value => value !== null && typeof value === "object" ? 1 + Object.values(value).reduce((sum,child)=>sum+count(child),0) : 0;
  // Synthetic pending data exercises the repository guard independently of the
  // existing provider parser bounds. No production acceptance token is minted.
  const dataWithContainers = (id,containers) => {
    const groups=Math.ceil((containers-2)/1001), items=[];let remaining=containers-2-groups;
    for(let i=0;i<groups;i++) {const size=Math.min(1000,remaining);items.push(Array.from({length:size},()=>({})));remaining-=size;}
    const data={id,catalogObjectType:"CATEGORY",isDeleted:false,items};equal(count(data),containers);return data;
  };
  const m=model(), active=await lease(m);
  const left=pending("BOUND_LEFT",undefined,dataWithContainers("BOUND_LEFT",55_000));
  const right=pending("BOUND_RIGHT",undefined,dataWithContainers("BOUND_RIGHT",10_984));
  const exact=command(active,[left,right]);
  equal(count(exact),limits.commandContainers,"complete command includes every lease/page/source wrapper");
  equal(await commit(m,exact),"committed","exact container boundary accepted");
  equal(m.inspect().sourceVersionCount,2);
  const excess=model(), excessLease=await lease(excess);
  const over=command(excessLease,[left,pending("BOUND_RIGHT",undefined,dataWithContainers("BOUND_RIGHT",10_985))]);
  equal(count(over),limits.commandContainers+1);
  equal(await commit(excess,over),"conflict","one expanded container above boundary rejected");
  equal(excess.inspect().sourceVersionCount,0);equal(excess.inspect().scans[0].checkpointVersion,0);
  // Repeated references still expand to three million authorized-location values.
  const largeScope={...scope,authorizedLocationIds:Array.from({length:1000},(_,i)=>"L"+i)};
  const fp=squareIngestionScopeFingerprint(largeScope);
  const shared=model({currentGenerations:[{scopeFingerprint:fp,generation:1}]});
  const sharedLease=await lease(shared,binding("locations",{scopeFingerprint:fp}));
  const source=pending("LOCATION_BOUND",undefined,undefined,{scope:largeScope});
  equal(await commit(shared,command(sharedLease,Array(3000).fill(source))),"committed","expanded scalar bound covers legal 3000x1000 location scopes");
  equal(shared.inspect().sourceVersionCount,1,"shared fixture represents one immutable version");
  const byteScope={...scope,authorizedLocationIds:Array.from({length:1000},(_,i)=>"L"+i+"x".repeat(60))};
  const byteFp=squareIngestionScopeFingerprint(byteScope);
  const bytes=model({currentGenerations:[{scopeFingerprint:byteFp,generation:1}]});
  const byteLease=await lease(bytes,binding("bytes",{scopeFingerprint:byteFp}));
  const repeated=pending("BYTE_BOUND",undefined,undefined,{scope:byteScope});
  equal(await commit(bytes,command(byteLease,Array(3000).fill(repeated))),"conflict","independent 64MiB byte guard charges aliases per occurrence");
  equal(bytes.inspect().sourceVersionCount,0);equal(bytes.inspect().scans[0].checkpointVersion,0);
}

async function main() {
  const originalFetch=global.fetch;global.fetch=()=>{throw new Error("repository must never perform transport");};
  try {
    await authorityAndLease();await cursorCustodyAndRetries();await atomicFaultsAndReplay();
    await immutableVersions();await capacityAndNoEviction();await structuralAndScopeFailures();await expandedBoundaryAccounting();
  } finally {global.fetch=originalFetch;}
  console.log(`Square ingestion recovery regressions passed: ${assertions} assertions; ${scenarios} scenario groups.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
