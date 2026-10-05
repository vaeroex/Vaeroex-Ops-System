import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const SCALES = {100:{workspaces:20,rps:10},250:{workspaces:50,rps:25},500:{workspaces:100,rps:50}};
export const MIX = [['pages',30],['search',20],['filters',20],['upload',8],['create',8],['repeat',4],['ai',5],['manualSync',5]];
export const FORBIDDEN = ['vaeroex.com','supabase.co','mdiianhfrojmxqpwrflh','zfpnhvcmuuvtswttmnjd'];
export function assert(condition, code) { if (!condition) throw new Error(code); }
export function json(path) { return JSON.parse(readFileSync(path,'utf8')); }
export function privateJson(path) { assert((statSync(path).mode & 0o077) === 0,'private_file_permissions_required'); return json(path); }
export function sha(value) { return createHash('sha256').update(value).digest('hex'); }
export function localUrl(value, protocols=['http:']) {
  const u = new URL(value); assert(protocols.includes(u.protocol),'protocol_denied');
  assert(['127.0.0.1','[::1]'].includes(u.hostname),'non_loopback_denied');
  assert(!u.username && !u.password && !u.hash,'url_authority_denied');
  assert(!FORBIDDEN.some(word => value.toLowerCase().includes(word)),'production_reference_denied'); return u;
}
export function sameOriginPath(origin,path) {
  assert(path.startsWith('/') && !path.startsWith('//'),'path_denied'); const u=localUrl(new URL(path,origin).href);
  assert(u.origin===origin,'origin_denied'); return u;
}
export function quantile(values,q) { if(!values.length)return null; const a=[...values].sort((a,b)=>a-b); return a[Math.ceil(q*a.length)-1]; }
export function mixAt(index) { let n=index%100; for(const [kind,weight] of MIX){if(n<weight)return kind;n-=weight;} }
export function uuid(value){return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);}
export function validatePlan(plan) {
 assert(plan.kind==='vaeroex-isolated-workload-v1' && SCALES[plan.activeUsers],'invalid_plan');
 const scale=SCALES[plan.activeUsers]; assert(plan.actors.length===scale.workspaces*10 && plan.workspaces.length===scale.workspaces,'fixture_counts');
 assert(new Set(plan.actors.map(a=>a.id)).size===plan.actors.length && new Set(plan.workspaces.map(w=>w.id)).size===plan.workspaces.length,'fixture_duplicate_ids');
 for(const w of plan.workspaces){assert(uuid(w.id),'workspace_uuid');const actors=plan.actors.filter(a=>a.workspaceId===w.id);assert(actors.length===10 && actors.filter(a=>a.active).length===5 && actors.filter(a=>a.role==='owner').length===1,'workspace_actor_distribution');}
 for(const a of plan.actors)assert(uuid(a.id)&&a.email.endsWith('@example.invalid')&&plan.workspaces.some(w=>w.id===a.workspaceId),'synthetic_actor_contract');
 assert(Number.isFinite(Date.parse(plan.asOf))&&Number.isInteger(plan.corpus?.archivedFilesPerWorkspace)&&plan.corpus.archivedFilesPerWorkspace>=0&&plan.corpus.archivedFilesPerWorkspace<=1500,'corpus_date_archive_contract');
 assert(Number.isInteger(plan.corpus?.activeFilesPerWorkspace)&&plan.corpus?.activeFilesPerWorkspace>=200&&plan.corpus.activeFilesPerWorkspace<=500&&plan.corpus.kpiObservationsPerWorkspace===10000&&plan.corpus.historyMonths===24,'corpus_contract');
 assert(plan.durationSeconds===1500 && plan.rampSeconds===120 && plan.steadySeconds===1200 && plan.drainSeconds===180,'fixed_primary_duration'); return scale;
}
export function validateEnvironment(env,plan,now=Date.now()) {
 assert(env.kind==='vaeroex-disposable-environment-v1'&&env.ready===true,'environment_not_ready');
 assert(env.runId===plan.runId&&env.syntheticOnly===true&&env.productionDataCopied===false,'fixture_provenance');
 for(const key of ['appOrigin','authOrigin','storageOrigin','stubOrigin']){const u=localUrl(env[key]);assert(u.href===u.origin+'/','origin_only_required');}
 localUrl(env.databaseOrigin,['postgresql:']);
 assert(/^[a-f0-9]{40}$/.test(env.sourceCommit)&&/^[a-f0-9]{64}$/.test(env.schemaFingerprint),'revision_provenance');
 assert(Number.isInteger(env.maxInFlight)&&env.maxInFlight>0&&env.maxInFlight<=500,'max_inflight_bound');
 assert(['nominal','chaos','growth'].includes(env.scenario),'scenario_required');
 assert(env.buildMode==='production'&&env.instanceNonce?.length>=24,'production_like_instance_required');
 assert(env.networkIsolation?.enforced===true&&env.networkIsolation?.evidenceFile&&env.providerMode==='local_stubs_only'&&env.paidCredentialsPresent===false,'network_stub_attestation_required');
 assert(now-Date.parse(env.provisionedAt)<86400000&&now>=Date.parse(env.provisionedAt),'stale_provisioning');
 const evidence=json(env.networkIsolation.evidenceFile);assert(evidence.runId===plan.runId&&evidence.syntheticOnly===true&&evidence.egressDenyAllExternal===true&&evidence.paidCredentialsPresent===false,'egress_evidence_required');
 assert(Object.keys(env.sourceFiles??{}).length>=5,'source_fingerprints_required');
 for(const [file,digest]of Object.entries(env.sourceFiles))assert(sha(readFileSync(file))===digest,'source_fingerprint_mismatch');
 return env;
}
export function checkTelemetry(t,env,plan,now=Date.now()) {
 assert(t.runId===plan.runId && now-Date.parse(t.observedAt)<=10000 && now>=Date.parse(t.observedAt)-1000,'telemetry_missing_or_stale');
 assert(t.app?.sourceCommit===env.sourceCommit&&t.app?.instanceNonce===env.instanceNonce&&t.app?.buildMode==='production'&&t.app.pid>0,'running_app_provenance');
 assert(t.db?.schemaFingerprint===env.schemaFingerprint&&t.db?.origin===env.databaseOrigin,'database_provenance');
 assert(t.fixtures?.runId===plan.runId&&t.fixtures.syntheticOnly===true&&t.fixtures.registeredUsers===plan.actors.length&&t.fixtures.workspaces===plan.workspaces.length,'seed_provenance');
 assert(t.egress?.enforced===true&&t.egress.violations===0&&t.providers?.paidCalls===0&&t.providers?.mode==='local_stubs_only','egress_or_paid_provider_violation');
 assert(Array.isArray(t.integrity?.violations),'integrity_collector_missing');assert(t.integrity.violations.length===0,'integrity_violation');
 for(const n of [t.app.rssBytes,t.app.allocationBytes,t.db.connections,t.db.maxConnections,t.queue?.depth,t.queue?.oldestAgeMs])assert(Number.isFinite(n)&&n>=0,'telemetry_metric_missing');
 assert(t.app.allocationBytes>0&&t.db.maxConnections>0&&Array.isArray(t.queue.completed),'telemetry_metric_missing');
 assert(t.fixtures.activeFilesPerWorkspace>=plan.corpus.activeFilesPerWorkspace&&t.fixtures.archivedFilesPerWorkspace>=plan.corpus.archivedFilesPerWorkspace&&t.fixtures.kpiObservationsPerWorkspace>=10000&&t.fixtures.historyMonths>=24&&t.fixtures.providerFixturesReady===true&&t.fixtures.legalAcceptanceReady===true,'complete_fixture_corpus_required');
 assert(Array.isArray(t.fixtures.corpus)&&t.fixtures.corpus.length===plan.workspaces.length,'per_workspace_corpus_required');
 for(const w of plan.workspaces){const entries=t.fixtures.corpus.filter(c=>c.workspaceId===w.id);assert(entries.length===1&&entries[0].activeFiles>=plan.corpus.activeFilesPerWorkspace&&entries[0].activeFiles<=500&&entries[0].archivedFiles>=plan.corpus.archivedFilesPerWorkspace&&entries[0].kpiObservations>=10000&&entries[0].confirmedMetricDefinitions>=20&&entries[0].historyDays>=730&&entries[0].verifiedStorageObjects>=entries[0].activeFiles+entries[0].archivedFiles,'per_workspace_corpus_incomplete');}
 assert(Number.isFinite(t.storageBytesWritten)&&t.storageBytesWritten<=8*1024**3,'storage_budget_exceeded');
 if(t.queue.depth>0)assert(Number.isFinite(Date.parse(t.queue.oldestEligibleAt))&&Math.abs(t.queue.oldestAgeMs-(now-Date.parse(t.queue.oldestEligibleAt)))<=11000,'queue_original_eligibility_required');
 for(const j of t.queue.completed)assert(j.id&&Number.isFinite(Date.parse(j.eligibleAt))&&Number.isFinite(Date.parse(j.startedAt))&&Date.parse(j.startedAt)>=Date.parse(j.eligibleAt),'queue_completion_timestamp_invalid');return t;
}
// Redirects are never followed, even when same-origin. Raw response bodies/cookies are never logged.
export async function guardedFetch(origin,path,options={},fetchImpl=fetch) {
 const target=sameOriginPath(origin,path); const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),options.timeoutMs??15000);
 try{
  const res=await fetchImpl(target,{...options,timeoutMs:undefined,redirect:'manual',signal:options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal});
  const location=res.headers.get('location');if(location){const next=localUrl(new URL(location,target).href);assert(next.origin===origin,'redirect_egress_denied');}
  const reader=res.body?.getReader();let size=0;const chunks=[];
  if(reader)for(;;){const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>4*1024*1024){await reader.cancel();throw new Error('response_size_limit');}chunks.push(Buffer.from(value.value));}
  return {status:res.status,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')};
 } finally {clearTimeout(timer);}
}
export function accepted(res,contract){
 if(!contract?.statuses?.includes(res.status))return false;
 if(contract.location){const raw=res.headers.get('location');if(!raw)return false;const u=new URL(raw,'http://127.0.0.1');if(u.pathname!==contract.location.pathname)return false;for(const[k,v]of Object.entries(contract.location.query??{}))if(u.searchParams.get(k)!==v)return false;}
 if(contract.includes&&!res.body.includes(contract.includes))return false;
 if(contract.json){let body;try{body=JSON.parse(res.body)}catch{return false}for(const[k,v]of Object.entries(contract.json))if(body[k]!==v)return false;}
 return Boolean(contract.location||contract.includes||contract.json);
}
export function summarize(rows){const reads=rows.filter(r=>r.kind==='read'&&r.accepted);const mutations=rows.filter(r=>r.kind==='mutation'&&r.accepted&&r.expectedDenial!==true);const failures=rows.filter(r=>!r.accepted&&!r.plannedFault);return{requests:rows.length,readP95Ms:quantile(reads.map(r=>r.ms),.95),readP99Ms:quantile(reads.map(r=>r.ms),.99),mutationAckP95Ms:quantile(mutations.map(r=>r.ms),.95),unplannedFailureRate:rows.filter(r=>!r.plannedFault).length?failures.length/rows.filter(r=>!r.plannedFault).length:null,unplannedFailureRateAllRequests:rows.length?failures.length/rows.length:null,eligibleUnplannedRequests:rows.filter(r=>!r.plannedFault).length,plannedFaultFailures:rows.filter(r=>!r.accepted&&r.plannedFault).length};}

export function uploadTargetBytes(sequence){const bucket=sequence%20;return bucket<16?40960:bucket<19?419430:2202009;}
