/* eslint-disable @typescript-eslint/no-require-imports -- Isolated bounded faults and real recovery evidence only. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {Client}=require('pg');
const KINDS=['provider_throttle','expired_authorization','partial_read','commit_ack_loss','worker_interruption','slow_workspace'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function recoveryHealthy(s,requirePostFaultSuccess=false){return s.queueDepth===0&&s.inFlight===0&&s.providerInFlight===0&&s.connected===true&&s.terminalAcceptedWork===true&&(s.postFaultSuccessfulSync===true||s.truthfullyFailedAcceptedWork===true)&&(!requirePostFaultSuccess||s.postFaultSuccessfulSync===true);}
const json=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const privateJson=f=>{assert.equal(fs.statSync(f).mode&0o077,0,'private_file_required');return json(f);};
function atomic(file,value){const temporary=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);}
const hash=v=>createHash('sha256').update(v).digest('hex');
const loadedHarnessSha256=hash(fs.readFileSync(__filename));
function local(raw){const u=new URL(raw);assert(['127.0.0.1','[::1]'].includes(u.hostname),'literal_loopback_required');return u;}
const eventCache=new Map();
function readEvents(file){
 let cache=eventCache.get(file);if(!cache){cache={offset:0,tail:'',line:0,events:[]};eventCache.set(file,cache);}
 const size=fs.statSync(file).size;assert(size>=cache.offset,'event_history_truncated');const added=size-cache.offset;
 if(added){assert(added<=64*1024*1024,'event_batch_bound');const fd=fs.openSync(file,'r'),bytes=Buffer.alloc(added);try{assert.equal(fs.readSync(fd,bytes,0,added,cache.offset),added);}finally{fs.closeSync(fd);}cache.offset=size;
  const lines=(cache.tail+bytes.toString('utf8')).split('\n');cache.tail=lines.pop();assert(cache.tail.length<=1048576,'event_line_bound');
  for(const line of lines){cache.line++;if(!line)continue;const e=JSON.parse(line);if(e.event==='fault_injected'||e.event==='worker_restarted'||e.event==='rpc_response'&&e.rpc==='claim_google_sheets_sync_v1')cache.events.push({...e,line:cache.line,eventSha256:hash(line)});}
  assert(cache.events.length<=100000,'accepted_event_inventory_bound');
 }
 return cache.events;
}
class FaultController{
 constructor(runtimeFile,output){
  this.cfg=privateJson(runtimeFile);this.config=privateJson(this.cfg.configFile);this.plan=privateJson(this.cfg.planFile);this.sessions=privateJson(path.join(this.cfg.out,'sessions.private.json'));
  assert(this.cfg.syntheticOnly&&this.cfg.paidCredentialsPresent===false&&this.config.mode==='disposable-native-local');assert.equal(this.plan.runId,this.cfg.runId);assert.equal(this.sessions.runId,this.cfg.runId);
  for(const u of[this.cfg.appOrigin,this.cfg.stubOrigin,this.config.apiUrl,this.config.dbUrl])local(u);
  assert.equal(process.env.NODE_EXTRA_CA_CERTS,this.cfg.cert,'local_ca_required');
  this.output=path.resolve(output);assert(this.output.startsWith(path.resolve(this.cfg.out)+'/'),'owned_output_required');fs.mkdirSync(this.output,{recursive:true,mode:0o700});
  this.db=new Client({connectionString:this.config.dbUrl,ssl:false,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:11000});
  this.processes=privateJson(path.join(this.cfg.out,'processes.json'));this.ids=this.plan.workspaces.map(w=>w.id);this.state={runId:this.cfg.runId,observedAt:new Date().toISOString(),phase:'starting',activeFault:null,recovery:{healthy:false,faultKind:null},faults:[]};this.stopped=false;this.timer=null;this.recovering=false;this.lastRecoveryPoll=0;this.active=null;this.requests=[];
 }
 status(){this.state.observedAt=new Date().toISOString();atomic(path.join(this.cfg.out,'fault-status.json'),this.state);}
 log(type,value={}){fs.appendFileSync(path.join(this.output,'controller-events.jsonl'),JSON.stringify({at:new Date().toISOString(),runId:this.cfg.runId,type,...value})+'\n',{mode:0o600});}
 async open(){
  await this.db.connect();const row=(await this.db.query("select current_database() db,current_setting('data_directory') directory")).rows[0];assert.equal(row.db,'postgres');assert(fs.realpathSync(row.directory).startsWith(fs.realpathSync(this.config.ownedSupabaseHome)+'/stacks/'));
  const net=require('node:net');const denial=await new Promise(resolve=>{const s=net.connect({host:'192.0.2.1',port:9});s.on('connect',()=>{s.destroy();resolve('connected');});s.on('error',e=>resolve(e.code));s.setTimeout(2000,()=>{s.destroy();resolve('timeout');});});assert.equal(denial,'EPERM','os_egress_denial_required');
  this.lock=path.join(this.cfg.out,'fault-controller.lock');fs.writeFileSync(this.lock,JSON.stringify({pid:process.pid,runId:this.cfg.runId,output:this.output}),{mode:0o600,flag:'wx'});
  this.state.phase='ready';this.status();this.timer=setInterval(()=>{this.status();if(Date.now()-this.lastRecoveryPoll>=15000&&!this.recovering)this.recover().catch(e=>this.log('recovery_poll_error',{code:e.code||e.name}));if(this.nextWallClockTick&&Date.now()>=this.nextWallClockTick&&!this.scheduledTick){const tick=this.nextWallClockTick;this.nextWallClockTick+=900000;this.scheduledTick=this.schedule(tick).catch(e=>this.log('scheduled_poll_error',{code:e.code||e.name})).finally(()=>{this.scheduledTick=null;});}},1000);
  await this.recover();return this;
 }
 enableQualificationCron(){assert(!this.nextWallClockTick);this.nextWallClockTick=(Math.floor(Date.now()/900000)+1)*900000;this.log('component_wall_clock_cron_enabled',{nextTickAt:new Date(this.nextWallClockTick).toISOString(),cadenceSeconds:900,primaryWorkloadTicksUnchanged:true});}
 async schedule(tick){const r=await this.http('/api/integrations/google-sheets/scheduled-sync',{headers:{authorization:'Bearer '+this.cfg.cronSecret},timeoutMs:300000,label:'component_wall_clock_scheduled_tick'});this.log('component_wall_clock_scheduled_tick',{scheduledAt:new Date(tick).toISOString(),status:r.status});assert.equal(r.status,200,'component_scheduled_tick_failed');}
 async http(route,{actor,method='GET',body,headers={},timeoutMs=15000,label=route}={}){
  assert(route.startsWith('/')&&!route.startsWith('//'));const url=new URL(route,this.cfg.appOrigin);assert.equal(url.origin,this.cfg.appOrigin);
  const start=Date.now();const h={...headers,'x-audit-run-id':this.cfg.runId,'x-audit-logical-id':'fault:'+randomUUID()};if(actor){assert(this.sessions.actors[actor.id]);h.cookie=this.sessions.actors[actor.id].cookie;h.origin=this.cfg.appOrigin;}
  let response,result;try{response=await fetch(url,{method,headers:h,body,redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});const raw=await response.text();assert(Buffer.byteLength(raw)<=1048576,'bounded_response_required');const redirect=response.headers.get('location');if(redirect)assert.equal(new URL(redirect,this.cfg.appOrigin).origin,this.cfg.appOrigin,'redirect_egress_denied');result={status:response.status,redirect:redirect?new URL(redirect,this.cfg.appOrigin).pathname+new URL(redirect,this.cfg.appOrigin).search:null,body:raw};return result;}finally{const evidence={label,startedAt:new Date(start).toISOString(),endedAt:new Date().toISOString(),method,path:url.pathname,status:response?.status||null,durationMs:Date.now()-start};this.requests.push(evidence);this.log('control_request',evidence);}
 }
 async recover(){if(this.recovering)return;this.recovering=true;this.lastRecoveryPoll=Date.now();try{const r=await this.http('/api/integrations/google-sheets/recover-syncs',{headers:{authorization:'Bearer '+this.cfg.cronSecret},timeoutMs:10000,label:'independent_recovery_poll'});let result;try{result=JSON.parse(r.body);}catch{result=null;}const counters=result&&['recovered','skipped','remainingExpired','oldestExpiredSeconds'].every(k=>Number.isFinite(result[k])&&result[k]>=0)?Object.fromEntries(['recovered','skipped','remainingExpired','oldestExpiredSeconds'].map(k=>[k,result[k]])):null;this.log('recovery_poll',{status:r.status,result:counters});assert(r.status!==401,'recovery_authorization_unavailable');return r;}finally{this.recovering=false;}}
 owner(w){const actor=this.plan.actors.find(a=>a.workspaceId===w.id&&a.role==='owner'&&a.active);assert(actor&&this.sessions.actors[actor.id]);return actor;}
 async sync(w,label){const r=await this.http('/api/integrations/google-sheets/sync',{actor:this.owner(w),method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({connectionId:w.sheetsConnectionId,confirmation:'sync'}),timeoutMs:300000,label});return{status:r.status,redirect:r.redirect};}
 async snapshot(fault){
  const acceptedIds=readEvents(this.cfg.transportEvents).filter(e=>e.runId===this.cfg.runId&&e.event==='rpc_response'&&e.rpc==='claim_google_sheets_sync_v1'&&e.status===200&&e.workspaceId===fault.workspaceId&&e.connectionId===fault.connectionId&&e.runIdAccepted&&Date.parse(e.at)>=Date.parse(fault.startedAt)).map(e=>e.runIdAccepted);
  const queued=(await this.db.query("select id,workspace_id,next_sync_at from public.google_sheets_connections where workspace_id=any($1::uuid[]) and status='connected' and automatic_refresh_enabled and active_approval_id is not null and next_sync_at<=clock_timestamp() and (sync_lease_expires_at is null or sync_lease_expires_at<=clock_timestamp()) order by next_sync_at,id",[this.ids])).rows;
  const running=(await this.db.query("select id,workspace_id from public.google_sheets_sync_runs where workspace_id=any($1::uuid[]) and status='running'",[this.ids])).rows;
  const connection=(await this.db.query('select id,workspace_id,status,generation,active_approval_id,automatic_refresh_enabled,sync_lease_run_id,sync_lease_expires_at from public.google_sheets_connections where workspace_id=$1 and id=$2',[fault.workspaceId,fault.connectionId])).rows[0];assert(connection,'owned_connection_missing');
  const work=(await this.db.query('select id,status,started_at,completed_at,error_code,row_count,fact_count from public.google_sheets_sync_runs where workspace_id=$1 and connection_id=$2 and started_at>=$3 order by started_at,id',[fault.workspaceId,fault.connectionId,fault.startedAt])).rows;
  assert(acceptedIds.every(id=>work.some(r=>r.id===id)),'accepted_claim_missing_durable_run');
  const provider=await fetch(new URL('/telemetry',this.cfg.stubOrigin),{redirect:'error',signal:AbortSignal.timeout(5000)});assert.equal(provider.status,200);const stats=await provider.json();assert.equal(stats.mode,'local_stubs_only');assert.equal(stats.paidCalls,0);assert(Number.isInteger(stats.inFlight)&&stats.inFlight>=0);
  const terminal=work.length>0&&work.every(r=>['succeeded','failed'].includes(r.status)&&r.completed_at&&(r.status!=='failed'||r.error_code));
  const succeeded=fault.endedAt?work.filter(r=>r.status==='succeeded'&&new Date(r.started_at).getTime()>=Date.parse(fault.endedAt)):[];
  return{acceptedRunIdsConfirmed:acceptedIds,queueDepth:queued.length,inFlight:running.length,providerInFlight:stats.inFlight,connected:connection.status==='connected',connection,acceptedWork:work,terminalAcceptedWork:terminal,postFaultSuccessfulSync:succeeded.length>0,postFaultSuccessfulRunIds:succeeded.map(r=>r.id),truthfullyFailedAcceptedWork:terminal&&work.every(r=>r.status==='failed'),queuedConnectionIds:queued.map(r=>r.id)};
 }
 events(fault){return[this.cfg.providerEvents,this.cfg.transportEvents].flatMap(file=>readEvents(file).filter(e=>e.runId===this.cfg.runId&&e.event==='fault_injected'&&e.actualInjection===true&&e.kind===fault.kind&&e.faultId===fault.id&&Date.parse(e.at)>=Date.parse(fault.startedAt)).map(e=>({file,line:e.line,eventSha256:e.eventSha256,at:e.at,pid:e.pid||null,workspaceId:e.workspaceId||null})));}
 evidence(fault){const actual=this.events(fault);fault.actualEvents=actual;const observation=actual.length?[{startedAt:fault.kind==='worker_interruption'?actual[0].at:fault.startedAt,endedAt:fault.endedAt||new Date(Math.min(Date.now(),fault.until)).toISOString(),actualInjection:true,workspaceId:fault.workspaceId,observedInjectionEvents:actual}]:[];
  atomic(fault.evidenceFile,{runId:this.cfg.runId,sourceCommit:this.processes.sourceCommit,buildId:this.processes.buildId,harnessSha256:loadedHarnessSha256,kind:fault.kind,localOnly:true,faultId:fault.id,mode:fault.mode,plannedStartSecond:fault.startSecond,plannedEndSecond:fault.endSecond,controlStartedAt:fault.startedAt,controlEndedAt:fault.controlEndedAt||null,acceptedDuringFault:fault.acceptedDuringFault||[],canonicalBaseline:fault.canonicalBaseline||null,canonicalBaselines:fault.canonicalBaselines||null,factsBeforeSha256:fault.factsBefore?hash(JSON.stringify(fault.factsBefore)):null,integrity:fault.integrity||null,workerRestart:fault.workerRestart||null,observations:observation,recovery:fault.recovery||null,requests:this.requests.filter(r=>Date.parse(r.startedAt)>=Date.parse(fault.startedAt))});return actual;
 }
 async reconnect(fault,w){
  const before=await this.snapshot(fault);assert.equal(before.connection.status,'reauthorization_required','actual_expired_authorization_required');
  const r=await this.http('/api/integrations/google-sheets/reconnect',{actor:this.owner(w),method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({connectionId:w.sheetsConnectionId}),label:'real_reconnect_begin'});assert.equal(r.status,200,'reconnect_begin_failed');const b=JSON.parse(r.body);assert.equal(b.ok,true);const google=new URL(b.authorizationUrl);assert.equal(google.origin,'https://accounts.google.com');const state=google.searchParams.get('state');assert(/^[A-Za-z0-9_-]{43}$/.test(state),'actual_oauth_state_required');assert.equal(google.searchParams.get('redirect_uri'),this.cfg.appOrigin+'/api/integrations/google-sheets/callback');
  // This substitutes only Google's consent/code issuer. The application's real
  // Auth, state/session binding, callback, token exchange and credential write run.
  const code='synthetic-reconnect:'+w.sheetsConnectionId+':'+randomUUID();
  const callback=await this.http('/api/integrations/google-sheets/callback?'+new URLSearchParams({state,code}),{actor:this.owner(w),label:'real_callback_simulated_code'});assert.equal(callback.status,303,'callback_failed');assert.equal(new URL(callback.redirect,this.cfg.appOrigin).searchParams.get('result'),'connected');
  const after=await this.snapshot(fault);assert.equal(after.connection.status,'connected');assert.equal(Number(after.connection.generation),Number(before.connection.generation)+1);assert.equal(after.connection.active_approval_id,before.connection.active_approval_id);
  this.log('real_reconnect_completed',{faultId:fault.id,connectionId:w.sheetsConnectionId,generationBefore:before.connection.generation,generationAfter:after.connection.generation,providerConsent:'explicit_local_simulation',customerConnection:false});
 }
 async facts(workspaceId,connectionId){return(await this.db.query('select f.kpi_id,f.source_row_id,f.metric_column,k.actual_value,k.metric_date from public.google_sheets_fact_links f left join public.kpis k on k.id=f.kpi_id and k.workspace_id=f.workspace_id where f.workspace_id=$1 and f.connection_id=$2 order by f.kpi_id',[workspaceId,connectionId])).rows;}
 async canonicalBaseline(w){const rows=(await this.db.query("select count(*)::int total,count(*) filter(where f.admission_state='accepted' and k.archived_at is null)::int active from public.google_sheets_fact_links f join public.kpis k on k.id=f.kpi_id and k.workspace_id=f.workspace_id where f.workspace_id=$1 and f.connection_id=$2",[w.id,w.sheetsConnectionId])).rows[0];assert.equal(rows.total,100,'baseline_requires_100_canonical_facts');assert.equal(rows.active,100,'baseline_requires_100_active_canonical_facts');this.log('nonvacuous_canonical_baseline',{connectionId:w.sheetsConnectionId,...rows});return rows;}
 async inject(spec,{mode='single_qualification',trigger=true}={}){
  assert(!this.active,'one_fault_at_a_time');assert(KINDS.includes(spec.kind));assert(spec.endSecond>spec.startSecond&&spec.endSecond-spec.startSecond<=30);if(mode==='primary')assert(spec.startSecond>=120);
  const w=this.plan.workspaces.find(w=>w.id===spec.workspaceId);assert(w?.sheetsConnectionId,'owned_fixture_required');const now=Date.now();const fault={...spec,id:randomUUID(),connectionId:w.sheetsConnectionId,startedAt:new Date(now).toISOString(),until:now+(spec.endSecond-spec.startSecond)*1000,mode};
  fault.canonicalBaselines=await Promise.all(this.plan.workspaces.map(async tenant=>({workspaceId:tenant.id,...await this.canonicalBaseline(tenant)})));fault.canonicalBaseline=fault.canonicalBaselines.find(tenant=>tenant.workspaceId===w.id);fault.factsBefore=await this.facts(w.id,w.sheetsConnectionId);
  assert(path.resolve(fault.evidenceFile).startsWith(this.output+'/'),'owned_evidence_required');
  const current=privateJson(this.cfg.faultControl);assert(!current.kind||current.until<Date.now(),'existing_fault_active');assert(!privateJson(this.cfg.runtimeControl).stop,'runtime_stop_requested');
  this.active=fault;this.state.phase='injecting';this.state.activeFault={kind:fault.kind,id:fault.id,workspaceId:w.id,startedAt:fault.startedAt,plannedEndAt:new Date(fault.until).toISOString()};this.state.recovery={healthy:false,faultKind:fault.kind};this.status();
  atomic(this.cfg.faultControl,{runId:this.cfg.runId,id:fault.id,workspaceId:w.id,kind:fault.kind==='worker_interruption'?'slow_workspace':fault.kind,until:fault.until,delayMs:fault.kind==='worker_interruption'?5000:1500});this.evidence(fault);
  const initialWorker=privateJson(path.join(this.cfg.out,'processes.json')).worker.pid;let probe=null;
  if(trigger)probe=this.sync(w,'fault_trigger_'+fault.kind).catch(e=>({transportError:e.code||e.name}));
  if(fault.kind==='worker_interruption'){
   const deadline=fault.until;let accepted=false;while(Date.now()<deadline){const s=await this.snapshot(fault);const delayed=readEvents(this.cfg.providerEvents).some(e=>e.faultId===fault.id&&e.kind==='slow_workspace'&&e.actualInjection);if(s.acceptedWork.some(r=>r.status==='running')&&delayed){accepted=true;break;}await sleep(100);}assert(accepted,'accepted_provider_work_not_observed_before_kill');
   atomic(this.cfg.runtimeControl,{runId:this.cfg.runId,id:fault.id,kind:'worker_interruption'});
  }
  while(Date.now()<fault.until&&!this.stopped){this.evidence(fault);await sleep(200);}
  const live=privateJson(this.cfg.faultControl);if(live.id===fault.id)atomic(this.cfg.faultControl,{});fault.controlEndedAt=new Date().toISOString();fault.endedAt=fault.controlEndedAt;
  if(fault.kind==='worker_interruption'){
   const actual=this.events(fault);assert(actual.length,'worker_kill_not_observed');let ready;const observeUntil=Date.parse(actual[0].at)+10000;do{ready=readEvents(this.cfg.transportEvents).find(e=>e.event==='worker_restarted'&&e.faultId===fault.id&&e.runId===this.cfg.runId);if(ready||Date.now()>=observeUntil)break;await sleep(50);}while(!this.stopped);assert(ready,'worker_ready_event_missing');const p=privateJson(path.join(this.cfg.out,'processes.json'));assert.notEqual(p.worker.pid,initialWorker,'worker_not_restarted');assert.equal(ready.pid,p.worker.pid);assert.equal(p.sourceCommit,this.processes.sourceCommit);assert.equal(p.instanceNonce,this.processes.instanceNonce);fault.endedAt=ready.at;assert(Date.parse(fault.endedAt)>=Date.parse(actual[0].at));
   if(privateJson(this.cfg.runtimeControl).id===fault.id)atomic(this.cfg.runtimeControl,{});
   const profile=this.cfg.workerRestartProfile||'forced_three_second_outage_v1';assert(['forced_three_second_outage_v1','immediate_supervisor_recovery_v1'].includes(profile),'worker_restart_profile_unknown');fault.workerRestart={profile,oldPid:initialWorker,newPid:p.worker.pid,configuredKillPauseMs:profile==='immediate_supervisor_recovery_v1'?0:3000,manifestSpawnDelayMs:Date.parse(p.observedAt)-Date.parse(actual[0].at),actualUnavailableMs:Date.parse(ready.at)-Date.parse(actual[0].at),maximumUnavailableMs:3000,measuredTo:'worker_restarted event after actual /login readiness'};fault.workerRestart.withinThreshold=fault.workerRestart.actualUnavailableMs<=fault.workerRestart.maximumUnavailableMs;this.log('worker_restart_observed',{faultId:fault.id,...fault.workerRestart});
  }
  if(probe)fault.triggerResult=await probe;
  fault.acceptedDuringFault=(await this.snapshot(fault)).acceptedWork.filter(r=>new Date(r.started_at).getTime()<=Date.parse(fault.controlEndedAt));
  if(trigger){
   assert(fault.acceptedDuringFault.length>0,'fault_did_not_exercise_accepted_work');
   if(['provider_throttle','expired_authorization','partial_read','worker_interruption'].includes(fault.kind))assert.deepEqual(await this.facts(w.id,w.sheetsConnectionId),fault.factsBefore,'failed_read_changed_canonical_facts');
   if(fault.kind==='commit_ack_loss')assert(fault.acceptedDuringFault.every(r=>r.status==='succeeded'&&r.completed_at),'lost_commit_ack_overwrote_saved_success');
   if(['provider_throttle','expired_authorization','partial_read'].includes(fault.kind))assert(fault.acceptedDuringFault.some(r=>r.status==='failed'&&r.error_code&&r.completed_at),'provider_failure_not_truthfully_persisted');
   if(fault.kind==='worker_interruption')assert(fault.acceptedDuringFault.some(r=>r.status==='running'),'worker_did_not_leave_recoverable_accepted_work');
  }
  assert(this.evidence(fault).length>0,'fault_not_actually_injected');
  this.state.phase='recovering';this.state.activeFault=null;this.status();
  if(fault.kind==='expired_authorization')await this.reconnect(fault,w);
  let postFaultProbe=false;const end=Date.parse(fault.endedAt)+300000;
  for(;;){
   const s=await this.snapshot(fault);const checkedAt=new Date().toISOString();
   if(trigger&&!postFaultProbe&&s.inFlight===0&&s.providerInFlight===0&&s.connected){postFaultProbe=true;fault.postFaultProbe=await this.sync(w,'post_fault_recovery_probe_'+fault.kind);continue;}
   const healthy=recoveryHealthy(s,trigger);
   fault.recovery={healthy,faultKind:fault.kind,endedAt:fault.endedAt,checkedAt,recoveryMs:Date.parse(checkedAt)-Date.parse(fault.endedAt),queueDepth:s.queueDepth,inFlight:s.inFlight,providerInFlight:s.providerInFlight,connected:s.connected,postFaultSuccessfulSync:s.postFaultSuccessfulSync,terminalAcceptedWork:s.terminalAcceptedWork,acceptedRunIdsConfirmed:s.acceptedRunIdsConfirmed,truthfullyFailedAcceptedWork:s.truthfullyFailedAcceptedWork,acceptedWork:s.acceptedWork,postFaultSuccessfulRunIds:s.postFaultSuccessfulRunIds};
   this.state.recovery=fault.recovery;this.status();this.evidence(fault);
   if(healthy){
    const duplicates=(await this.db.query('select count(*)::int n from (select connection_id,source_row_id,metric_column from public.google_sheets_fact_links where workspace_id=any($1::uuid[]) group by connection_id,source_row_id,metric_column having count(*)>1) d',[this.ids])).rows[0].n;
    assert.equal(duplicates,0,'duplicate_canonical_sheet_facts');
    if(fault.kind==='worker_interruption'){const interrupted=new Set(fault.acceptedDuringFault.filter(r=>r.status==='running').map(r=>r.id));assert(s.acceptedWork.filter(r=>interrupted.has(r.id)).every(r=>r.status==='failed'&&r.error_code==='lease_expired'&&r.completed_at),'interrupted_work_not_truthfully_reconciled');}
    fault.integrity={duplicateCanonicalFacts:duplicates,acceptedWorkTerminal:true,acceptedClaimsHaveDurableRuns:true,interruptedRunsTruthfullyFailed:fault.kind==='worker_interruption'?true:null};this.evidence(fault);break;
   }assert(Date.now()<=end,'fault_recovery_exceeded_300_seconds');assert(!this.stopped,'fault_controller_stopped');await sleep(1000);
  }
  if(fault.kind==='worker_interruption')assert(fault.workerRestart.withinThreshold,'worker_restart_exceeded_3_seconds');
  this.state.faults.push({kind:fault.kind,faultId:fault.id,evidenceFile:fault.evidenceFile,actualInjection:true,recovery:fault.recovery});this.state.phase='ready';this.active=null;this.status();this.log('fault_qualified',{kind:fault.kind,recoveryMs:fault.recovery.recoveryMs,acceptedWork:fault.recovery.acceptedWork.map(r=>({id:r.id,status:r.status,error_code:r.error_code}))});return fault;
 }
 async close(){this.stopped=true;clearInterval(this.timer);if(this.scheduledTick)await this.scheduledTick;if(this.active){const control=privateJson(this.cfg.faultControl);if(control.id===this.active.id)atomic(this.cfg.faultControl,{});if(privateJson(this.cfg.runtimeControl).id===this.active.id)atomic(this.cfg.runtimeControl,{});this.state.recovery={healthy:false,faultKind:this.active.kind};this.state.phase='failed_or_interrupted';this.active.controlEndedAt=new Date().toISOString();this.active.endedAt ||= this.active.controlEndedAt;this.evidence(this.active);}else this.state.phase='stopped';this.status();await this.db.end();if(this.lock&&fs.existsSync(this.lock)&&json(this.lock).pid===process.pid)fs.unlinkSync(this.lock);}
}
async function alignedFaults(plan,output){
 const {createWorkloadSelector,validatePlan}=await import('../docs/security/audit-evidence/stage-3/http/core.mjs');const scale=validatePlan(plan),actors=plan.actors.filter(a=>a.active),select=createWorkloadSelector(actors.length),arrivals=[];let budget=0,index=0;
 // Reproduce the unchanged runner's100ms token bucket and exact imported MIX
 // selector offline. No additional user actions or provider calls are generated.
 for(let tick=1;tick<13200;tick++){const second=tick/10;budget+=.1*scale.rps*Math.min(1,second/120);while(budget>=1){budget--;const choice=select(index++);if(choice.kind==='manualSync')arrivals.push({second,actionIndex:index-1,actorIndex:choice.actorIndex,workspaceId:actors[choice.actorIndex].workspaceId});}}
 const starts={provider_throttle:140,slow_workspace:240,expired_authorization:360,partial_read:620,commit_ack_loss:840,worker_interruption:1080};
 return Object.entries(starts).map(([kind,startSecond])=>{const candidates=arrivals.filter(a=>a.second>=startSecond+1&&a.second<startSecond+19);assert(candidates.length,'no_existing_manual_arrival_for_fault');const arrival=candidates[0],workspaceId=arrival.workspaceId;return{kind,workspaceId,startSecond,endSecond:startSecond+20,evidenceFile:path.join(output,kind+'.json'),actions:['manualSync','scheduled'],statuses:kind==='worker_interruption'?[503]:[303],errorCodes:kind==='worker_interruption'?['request_failed','request_timeout']:[],offlineExistingArrivals:candidates.filter(a=>a.workspaceId===workspaceId),extraUserActions:0};});
}
async function manifest(cfg,output){fs.mkdirSync(output,{recursive:true,mode:0o700});const plan=privateJson(cfg.planFile),faults=await alignedFaults(plan,output);return{runId:cfg.runId,kind:'bounded_capacity_fault_plan',activeUsers:plan.activeUsers,primaryScheduledTicks:[0,900],independentRecoveryPollMs:15000,maximumRecoveryMs:300000,maximumWorkerUnavailableMs:3000,workerRestartProfile:cfg.workerRestartProfile||'forced_three_second_outage_v1',alignment:{method:'exact imported workload selector with100ms ramp token bucket',extraUserActions:0,actualInjectionStillRequired:true},sourceOfHealth:'actual SQL queue, provider in-flight, connection status and durable terminal outcomes',faults};}
module.exports={FaultController,manifest,alignedFaults,atomic,recoveryHealthy,readEvents};
if(require.main===module)(async()=>{
 const[op,runtimeFile,output,arg]=process.argv.slice(2);assert(['plan','qualify','serve','recover'].includes(op)&&runtimeFile&&output,'usage_plan_qualify_serve_recover_runtime_output_argument');const cfg=privateJson(runtimeFile);
 if(op==='plan'){assert(!fs.existsSync(output),'fresh_fault_plan_output_required');const m=await manifest(cfg,output);atomic(path.join(output,'plan.json'),m);console.log(JSON.stringify({faultPlan:path.join(output,'plan.json'),faults:m.faults.length,executed:false}));return;}
 if(op!=='serve')assert(!fs.existsSync(output),'fresh_fault_evidence_output_required');
 const c=new FaultController(runtimeFile,output);process.once('SIGTERM',()=>{c.stopped=true;});process.once('SIGINT',()=>{c.stopped=true;});
 try{
  await c.open();
  if(op==='qualify'){c.enableQualificationCron();assert(KINDS.includes(arg));const target=c.plan.workspaces.at(-1);const baseline=await c.sync(target,'pre_fault_baseline_sync');assert.equal(baseline.status,303,'baseline_sync_http_failed');assert.equal(new URL(baseline.redirect,c.cfg.appOrigin).searchParams.get('result'),'synced','baseline_sync_must_succeed_before_fault');const fault=await c.inject({kind:arg,workspaceId:c.plan.workspaces.at(-1).id,startSecond:0,endSecond:10,evidenceFile:path.join(c.output,arg+'.json')});console.log(JSON.stringify({kind:arg,qualified:true,recoveryMs:fault.recovery.recoveryMs,evidence:fault.evidenceFile,capacityClaim:false}));}
  else if(op==='recover'){const seconds=Number(arg);assert(Number.isInteger(seconds)&&seconds>0&&seconds<=7200);const until=Date.now()+seconds*1000;while(Date.now()<until&&!c.stopped)await sleep(1000);}
  else{const m=privateJson(path.join(output,'plan.json'));assert.equal(m.runId,c.cfg.runId);assert(arg,'workload_start_signal_required');let signal;for(let i=0;i<600&&!c.stopped;i++){if(fs.existsSync(arg)){signal=privateJson(arg);break;}await sleep(1000);}assert(signal?.runId===c.cfg.runId&&Number.isFinite(Date.parse(signal.startedAt)),'actual_workload_epoch_required');for(const spec of [...m.faults].sort((a,b)=>a.startSecond-b.startSecond)){while(Date.now()<Date.parse(signal.startedAt)+spec.startSecond*1000&&!c.stopped)await sleep(100);assert(Date.now()-Date.parse(signal.startedAt)-spec.startSecond*1000<1000,'fault_schedule_missed');await c.inject(spec,{mode:'primary',trigger:false});}while(Date.now()<Date.parse(signal.startedAt)+1500000&&!c.stopped)await sleep(1000);}
 }finally{await c.close();}
})().catch(error=>{console.error(JSON.stringify({faultControllerFailed:true,reason:/^[a-z_]+$/.test(error.message)?error.message:(error.code||error.name)}));process.exitCode=1;});
