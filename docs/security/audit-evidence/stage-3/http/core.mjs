import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const SCALES = {10:{workspaces:2,rps:1},100:{workspaces:20,rps:10},250:{workspaces:50,rps:25},500:{workspaces:100,rps:50}};
export const MIX = [['pages',30],['search',20],['filters',20],['upload',8],['create',8],['repeat',4],['ai',5],['manualSync',5]];
export const FORBIDDEN = ['vaeroex.com','supabase.co','mdiianhfrojmxqpwrflh','zfpnhvcmuuvtswttmnjd'];
export function assert(condition, code) { if (!condition) throw new Error(code); }
export function json(path) { return JSON.parse(readFileSync(path,'utf8')); }
export function privateJson(path) { assert((statSync(path).mode & 0o077) === 0,'private_file_permissions_required'); return json(path); }
export function sha(value) { return createHash('sha256').update(value).digest('hex'); }
export function localUrl(value, protocols=['http:','https:']) {
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
export const PAGE_ROUTES=['/app','/app/intelligence','/app/kpis','/app/sources','/app/reports'];
// Actor cadence and global action mix stay unchanged. Route/filter variation
// must use actor-local occurrence counts: n%actors and n%5 pin each actor to
// one page whenever the actor cohort is a multiple of five.
export function createWorkloadSelector(actorCount){
 assert(Number.isInteger(actorCount)&&actorCount>0,'actor_count_required');
 const counts=Array.from({length:actorCount},()=>({pages:0,filters:0}));
 return index=>{assert(Number.isInteger(index)&&index>=0,'action_index_required');const actorIndex=index%actorCount,kind=mixAt((index*37+Math.floor(index/100)*13)%100);const variant=kind==='pages'||kind==='filters'?actorIndex+counts[actorIndex][kind]++:index;return{actorIndex,kind,variant};};
}
export function quietBaselineQualified(baseline,ids){return ids.every(id=>PAGE_ROUTES.every(route=>{const r=baseline?.byWorkspace?.[id]?.routes?.[route];return Number.isInteger(r?.count)&&r.count>=30&&Number.isFinite(r.p95Ms)&&r.p95Ms>0;}));}
export function eligibleRequests(rows){return rows.filter(r=>!r.plannedFault&&!(r.expectedDenial===true&&r.accepted));}
export function recordQueueDelays(samples,completed,startEpoch){
 const fresh=[];for(const job of completed){const began=Date.parse(job.startedAt),eligible=Date.parse(job.eligibleAt);assert(job.id&&Number.isFinite(began)&&Number.isFinite(eligible)&&began>=eligible,'queue_completion_timestamp_invalid');if(began<startEpoch)continue;const delay=began-eligible;if(samples.has(job.id)){assert(samples.get(job.id)===delay,'queue_eligibility_changed');continue;}assert(samples.size<100000,'queue_evidence_budget_exceeded');samples.set(job.id,delay);fresh.push(job);}return fresh;
}

// HTTP scheduling acknowledgement and durable job admission are different
// observations. Empty/deferred ticks need actual due-query/denial evidence;
// full-workspace burst coverage remains a separate capacity requirement.
export function verifyDispatchAccounting(plan,requests,jobs,dispatchRows){
 const blocked=[],violations=[],jobsById=new Map(jobs.map(j=>[j.id,j])),dispatches=new Map(dispatchRows.map(d=>[d.requestLogicalId,d])),scope=new Set(plan.workspaces.map(w=>w.id)),covered=new Set();let scheduledRequests=0;
 if(jobsById.size!==jobs.length||dispatches.size!==dispatchRows.length)violations.push({code:'duplicate_job_or_dispatch_identity'});
 for(const req of requests.filter(r=>r.accepted&&['manualSync','scheduled'].includes(r.action))){
  const dispatch=dispatches.get(req.logicalId),ids=dispatch?.jobIds;
  if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!jobsById.has(id))){blocked.push('accepted_dispatch_mapping_missing');continue;}
  const admitted=ids.map(id=>jobsById.get(id));
  for(const j of admitted){if(j.accepted!==true||!['completed','failed_explicitly','cancelled_explicitly'].includes(j.status))violations.push({code:'dispatch_job_unaccounted',id:j.id});if(!scope.has(j.workspaceId)||req.action==='manualSync'&&j.workspaceId!==req.workspaceId)violations.push({code:'cross_workspace_dispatch',id:j.id});}
  if(req.action==='manualSync'){if(!ids.length)blocked.push('accepted_dispatch_mapping_missing');continue;}
  scheduledRequests++;const evidence=dispatch.scheduling,response=evidence?.response,due=evidence?.dueQueries,denials=evidence?.claimDenials??[];
  const fields=['attempted','succeeded','failed','deferred','backoffFailed','peakActive','admissionRpcAttempts','admissionRetries','admissionWaitMs'];
  if(response?.enabled!==true||fields.some(k=>!Number.isSafeInteger(response[k])||response[k]<0)||response.attempted!==response.succeeded+response.failed+response.deferred||response.backoffFailed!==0||!Array.isArray(due)||!due.length||!Array.isArray(denials)){blocked.push('scheduled_dispatch_evidence_missing');continue;}
  const duePairs=new Set();let valid=true;
  for(const query of due){if(!Number.isFinite(Date.parse(query.at))||!Number.isFinite(Date.parse(query.tickAt))||!Number.isInteger(query.limit)||query.limit<1||query.limit>50||!Array.isArray(query.connections)||query.connections.length>query.limit){valid=false;continue;}for(const c of query.connections){if(!uuid(c.id)||!scope.has(c.workspaceId)||!Number.isFinite(Date.parse(c.eligibleAt))||Date.parse(c.eligibleAt)>Date.parse(query.tickAt))valid=false;duePairs.add(c.workspaceId+':'+c.id);}}
  const admittedPairs=new Set(admitted.map(j=>j.workspaceId+':'+j.connectionId));if(admittedPairs.size!==admitted.length||admitted.some(j=>!duePairs.has(j.workspaceId+':'+j.connectionId)))valid=false;
  const busy=new Set(),rejected=new Set();
  for(const d of denials){const pair=d.workspaceId+':'+d.connectionId;if(!Number.isFinite(Date.parse(d.at))||!duePairs.has(pair)||!/^google_sheets_[a-z_]+$/.test(d.errorCode||'')){valid=false;continue;}if(admittedPairs.has(pair))continue;if(/^google_sheets_(?:capacity|workspace|sync)_busy$/.test(d.errorCode))busy.add(pair);else rejected.add(pair);}
  for(const pair of rejected)busy.delete(pair);
  const losses=evidence.acknowledgementLossRunIds??[];if(!Array.isArray(losses)||new Set(losses).size!==losses.length||losses.some(id=>!admitted.some(j=>j.id===id&&j.status==='completed')))valid=false;
  const lossIds=new Set(Array.isArray(losses)?losses:[]),lostCompletionAcks=admitted.filter(j=>j.status==='completed'&&lossIds.has(j.id)).length;
  const completed=admitted.filter(j=>j.status==='completed').length,failed=admitted.filter(j=>['failed_explicitly','cancelled_explicitly'].includes(j.status)).length;
  if(response.succeeded!==completed-lostCompletionAcks||response.failed!==failed+rejected.size+lostCompletionAcks||response.deferred!==busy.size||response.attempted!==admitted.length+rejected.size+busy.size||response.attempted===0&&duePairs.size!==0)valid=false;
  if(!valid){blocked.push('scheduled_dispatch_evidence_mismatch');continue;}for(const j of admitted)covered.add(j.workspaceId);
 }
 const missingWorkspaceIds=plan.workspaces.map(w=>w.id).filter(id=>!covered.has(id));
 return{blocked,violations,scheduledCoverage:{requiredForCapacity:true,scheduledRequests,coveredWorkspaceIds:[...covered].sort(),missingWorkspaceIds,complete:scheduledRequests>0&&missingWorkspaceIds.length===0,scope:'Aggregate actual admitted scheduled jobs across the measured burst; truthful empty or deferred ticks do not establish workspace coverage.'}};
}
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
 assert(['agreed_large_rows_v1','supported_rows_v1'].includes(env.uploadProfile||'agreed_large_rows_v1'),'upload_profile_invalid');
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
 assert(t.integrity?.ready===true&&Array.isArray(t.integrity?.violations),'integrity_collector_missing');assert(t.integrity.violations.length===0,'integrity_violation');
 for(const n of [t.app.rssBytes,t.app.allocationBytes,t.db.connections,t.db.maxConnections,t.queue?.depth,t.queue?.inFlight,t.queue?.oldestAgeMs,t.resources?.totalRssBytes,t.resources?.allocationBytes,t.resources?.cpuCores,t.resources?.cpuAllocationCores])assert(Number.isFinite(n)&&n>=0,'telemetry_metric_missing');
 assert(Array.isArray(t.resources?.processes)&&t.resources.processes.length>0&&t.resources.cpuCoverageComplete===true&&t.resources.allocationBytes>0&&t.resources.cpuAllocationCores>0,'aggregate_resource_collector_missing');
 const pids=new Set();let processRss=0,processCpu=0;for(const p of t.resources.processes){assert(Number.isInteger(p.pid)&&p.pid>0&&!pids.has(p.pid)&&Number.isFinite(p.rssBytes)&&p.rssBytes>=0&&Number.isFinite(p.cpuPercentOneCore)&&p.cpuPercentOneCore>=0,'process_metric_invalid');pids.add(p.pid);processRss+=p.rssBytes;processCpu+=p.cpuPercentOneCore/100;if(p.allocationBytes!==undefined)assert(Number.isFinite(p.allocationBytes)&&p.allocationBytes>0,'process_allocation_invalid');}assert(pids.has(t.app.pid)&&processRss===t.resources.totalRssBytes&&Math.abs(processCpu-t.resources.cpuCores)<.00001,'process_aggregate_mismatch');
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
  for(const location of [res.headers.get('location'),res.headers.get('x-action-redirect')?.split(';')[0]])if(location){const next=localUrl(new URL(location,target).href);assert(next.origin===origin,'redirect_egress_denied');}
  const reader=res.body?.getReader();let size=0;const chunks=[];
  if(reader)for(;;){const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>4*1024*1024){await reader.cancel();throw new Error('response_size_limit');}chunks.push(Buffer.from(value.value));}
  return {status:res.status,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')};
 } finally {clearTimeout(timer);}
}
export function accepted(res,contract){
 if(!contract?.statuses?.includes(res.status))return false;
 if(contract.location){const raw=res.headers.get('location');if(!raw)return false;const u=new URL(raw,'http://127.0.0.1');if(u.pathname!==contract.location.pathname)return false;for(const[k,v]of Object.entries(contract.location.query??{}))if(u.searchParams.get(k)!==v)return false;}
 if(contract.actionRedirect){const raw=res.headers.get('x-action-redirect');if(!raw)return false;const u=new URL(raw.split(';')[0],'http://127.0.0.1');const rule=contract.actionRedirect;if(rule.pathname&&u.pathname!==rule.pathname)return false;if(rule.pathnameUuidPrefix&&(!u.pathname.startsWith(rule.pathnameUuidPrefix)||!uuid(u.pathname.slice(rule.pathnameUuidPrefix.length))))return false;if(u.searchParams.has('error'))return false;for(const[k,values]of Object.entries(rule.queryAny??{}))if(!values.includes(u.searchParams.get(k)))return false;if(rule.messagePrefix&&!u.searchParams.get('message')?.startsWith(rule.messagePrefix))return false;}
 if(contract.includes&&!res.body.includes(contract.includes))return false;
 if(contract.json){let body;try{body=JSON.parse(res.body)}catch{return false}for(const[k,v]of Object.entries(contract.json))if(body[k]!==v)return false;}
 return Boolean(contract.location||contract.actionRedirect||contract.includes||contract.json);
}
export function summarize(rows){const reads=rows.filter(r=>r.kind==='read'&&r.accepted);const mutations=rows.filter(r=>r.kind==='mutation'&&r.accepted&&r.expectedDenial!==true);const eligible=eligibleRequests(rows),failures=eligible.filter(r=>!r.accepted);return{requests:rows.length,readP95Ms:quantile(reads.map(r=>r.ms),.95),readP99Ms:quantile(reads.map(r=>r.ms),.99),mutationAckP95Ms:quantile(mutations.map(r=>r.ms),.95),unplannedFailureRate:eligible.length?failures.length/eligible.length:null,unplannedFailureRateAllRequests:rows.length?failures.length/rows.length:null,eligibleUnplannedRequests:eligible.length,expectedDenialAcknowledgments:rows.filter(r=>r.expectedDenial===true&&r.accepted).length,plannedFaultFailures:rows.filter(r=>!r.accepted&&r.plannedFault).length};}

export function uploadTargetBytes(sequence){const bucket=sequence%20;return bucket<16?40960:bucket<19?419430:2202009;}

// Match the persistent stage-3 dataset contract exactly. Correlation belongs to
// the captured display name/original filename; repeating a UUID in every CSV
// row changed the agreed row counts and is unnecessary for the inventory.
export function uploadRecordCount(sequence){const bucket=sequence%20;return bucket<16?1000:bucket<19?10000:50000;}
export function uploadCsv(sequence,profile='agreed_large_rows_v1'){assert(['agreed_large_rows_v1','supported_rows_v1'].includes(profile),'upload_profile_invalid');const bytes=uploadTargetBytes(sequence),count=profile==='supported_rows_v1'?1000:uploadRecordCount(sequence),header='date,Revenue,Marker\n';const available=bytes-Buffer.byteLength(header),width=Math.floor(available/count),extra=available%count;const rows=[];for(let i=0;i<count;i++){const prefix=`2026-09-01,100,r${String(i).padStart(6,'0')}`;const size=width+(i<extra?1:0);assert(size>prefix.length,'upload_shape_invalid');rows.push(prefix+'x'.repeat(size-prefix.length-1)+'\n');}const csv=header+rows.join('');assert(Buffer.byteLength(csv)===bytes,'upload_bytes_mismatch');return csv;}
