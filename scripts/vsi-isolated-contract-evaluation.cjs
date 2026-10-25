/* eslint-disable @typescript-eslint/no-require-imports -- Fixed synthetic-only engine evaluator; no live credential or network adapter. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fork,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const candidate='16970f71b237149afb5d0911e8526e9b47e8ed29';
const runtimeTrees="040000 tree 8295029f519c64ea83e1c8c56f739245d24b460b\tapp\n040000 tree 21c84a578a38c84a8a6f662be589f60c0241447f\tlib";
const endpoint='https://api.openai.com/v1/responses';
const limits=Object.freeze({questions:2,calls:4,callsPerQuestion:2,usd:1,reservePerCallUsd:.25,maxChars:48000,maxBytes:192000,maxOutputTokens:8000});
const cases=Object.freeze([
 {id:'qualified-brief',question:'Using only the supplied explicitly synthetic Xero and Google Sheets observations, give a short hypothetical executive brief and a supported follow-up, if any. Distinguish recorded facts, qualified interpretation, missing information and the next check. Cite both originals and preserve their dates, units, observation scope and uncertainty. Do not invent record matching, causation, balance allocation, ratios, profit, cash loss or trends. Do not search the web.',expectation:'Identify a specific qualified payment-hold and receivables follow-up supported by both originals. Explicitly state that invoice/order linkage is missing and check it before assigning any balance to an order. Separate USD outstanding as of import from operational status counts; partial supplied coverage proves no cause, allocation, ratio, profit, cash loss or trend. Separate summaries or generic warrant-review language are insufficient.'},
 {id:'unsupported-cause',question:'Do these explicitly synthetic stored Xero invoice-balance and Google Sheets dispatch/backlog observations establish that unpaid invoices caused delays? Explain what the records support and what information is missing. Cite both originals. Do not invent matching, causation, profit or ratios. Do not search the web.',expectation:'Withhold unsupported causation, joins and arithmetic; explain specific missing evidence and useful next checks. An empty interpretation list is appropriate when no supported hypothesis fits.'}
]);
const truth='All observations are invented, not imported provider records. The first case uses a Xero-shaped USD 1200 outstanding balance as of import and a separate Sheets-shaped count of 3 orders explicitly recorded on payment hold for one fictional entity at 14 Oct 2026 17:00 UTC, with partial supplied coverage. This supports a qualified targeted follow-up, not invoice/order matching, causation, balance allocation, ratios, profit, cash loss or trends. The second case retains the original single-day USD 50 invoice balance, 6 dispatches and 4 end-of-day backlog items, with unknown coverage and no supported billing-to-operations relationship. Neither case provides invoice/order linkage, completeness, causal evidence or matched record identities.';
const secretLike=/\b(?:Bearer\s+\S+|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// Fresh case-local objects; the sparse regression retains its original data and identities.
function fixtureForCase(caseId){
 assert(cases.some(test=>test.id===caseId),'unknown_fixture_case');
 const workspace=id(1);
 if(caseId==='unsupported-cause')return {captureReferenceId:id(70),raw:[
  {provider:'google_sheets',identity:{kind:'sheets_ticket_source',source_id:id(10),version_id:id(11),authority_hash:'a'.repeat(64)},hash:'a'.repeat(64),data:{provider:'google_sheets',workspace_id:workspace,entity_id:id(30),connection_id:id(31),date:'2026-10-14',time_zone:'UTC',metrics:[{metric:'Synthetic scenario dispatches',value:'6',unit:'count'},{metric:'Synthetic scenario end-of-day backlog',value:'4',unit:'count'}],read_sources:[]}},
  {provider:'xero',identity:{kind:'legacy_binding',binding_id:id(32),start:'2026-10-01',end:'2026-10-30'},hash:'b'.repeat(64),data:{provider:'xero',workspace_id:workspace,entity_id:id(30),connection_id:id(33),scope:'stored synthetic invoice observations',records:[{day:'2026-10-14',metrics:[{key:'invoice balance',value:'50',currency:'USD'}]}],read_sources:[]}}
 ]};
 const raw=[
  {provider:'google_sheets',identity:{kind:'sheets_ticket_source',source_id:id(210),version_id:id(211)},data:{provider:'google_sheets',workspace_id:workspace,entity_id:id(30),connection_id:id(231),date:'2026-10-14',time_zone:'UTC',coverage:'partial',scope:'Invented Sheets-shaped operational status recorded at 14 Oct 2026 17:00 UTC; partial supplied observation only',metrics:[{metric:'orders recorded on payment hold',value:'3',unit:'count'}],read_sources:[]}},
  {provider:'xero',identity:{kind:'legacy_binding',binding_id:id(232),start:'2026-10-14',end:'2026-10-14'},data:{provider:'xero',workspace_id:workspace,entity_id:id(30),connection_id:id(233),date:'2026-10-14',time_zone:'UTC',currency:'USD',coverage:'partial',scope:'Invented Xero-shaped outstanding invoice balance as of import at 14 Oct 2026 17:00 UTC; partial supplied observation only',records:[{day:'2026-10-14',metrics:[{key:'outstanding',value:'1200',currency:'USD'}]}],read_sources:[]}}
 ];
 for(const source of raw){source.hash=hash(JSON.stringify({caseId,provider:source.provider,data:source.data}));if(source.provider==='google_sheets')source.identity.authority_hash=source.hash;}
 return {captureReferenceId:id(270),raw};
}
function privateDirectory(output){
 assert(path.isAbsolute(output),'absolute_private_output_required');
 const parent=fs.realpathSync(path.dirname(output)),repo=fs.realpathSync(root),dir=path.join(parent,path.basename(output));
 assert(dir!==repo&&!dir.startsWith(repo+path.sep),'repository_artifacts_denied');
 fs.mkdirSync(dir,{mode:0o700});assert.equal(fs.statSync(dir).mode&0o777,0o700);return dir;
}
function unchangedRuntime(){
 // Tree identities survive a sanitized publication without private local ancestry.
 const trees=execFileSync('git',['ls-tree','HEAD','--','app','lib'],{cwd:root,encoding:'utf8'}).trim();
 const changed=execFileSync('git',['status','--porcelain','--untracked-files=all','--','app','lib'],{cwd:root,encoding:'utf8'}).trim();
 assert.equal(trees,runtimeTrees,'candidate_runtime_changed');assert(!changed,'candidate_runtime_changed');
}
function checkRequest(message,call){
 assert.equal(message.url,endpoint);assert.equal(typeof message.body,'string');
 assert(message.body.length<=limits.maxChars&&Buffer.byteLength(message.body,'utf8')<=limits.maxBytes);
 assert(!secretLike.test(message.body),'secret_shaped_request');
 const body=JSON.parse(message.body);assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);
 for(const key of ['tools','tool_choice','previous_response_id','conversation','background','service_tier'])assert.equal(body[key],undefined);
 assert.equal(body.stream,false);
 assert.equal(body.text?.format?.name,call===0?'vsi_research_plan_v1':'vsi_shared_answer_v2');
 assert(Number.isSafeInteger(body.max_output_tokens)&&body.max_output_tokens>0&&body.max_output_tokens<=limits.maxOutputTokens);
 assert(Number.isInteger(call)&&call>=0&&call<limits.callsPerQuestion);return body;
}
function createEvaluation({outputDir,dispatch}={}){
 assert.equal(typeof dispatch,'function','no_live_transport_configured');unchangedRuntime();
 const directory=privateDirectory(outputDir);
 const report={candidate,synthetic:true,liveTransportProvidedByThisModule:false,realModelQualified:false,limits,calls:0,reservedUsd:0,knownStandardCostUsd:0,state:'ready',results:[],reviews:[]};
 let sequence=0,running=false,cancelActive;
 const write=(name,value)=>{const text=JSON.stringify(value,null,2)+'\n';assert(!secretLike.test(text),'credential_shaped_artifact_denied');fs.writeFileSync(path.join(directory,name),text,{mode:0o600,flag:'wx'});};
 const checkpoint=()=>write(`checkpoint-${String(++sequence).padStart(3,'0')}.json`,report);
 write('plan.json',{candidate,cases,truth,limits,credentialRoute:'not configured',meaningfulReasoningRequiresManualReview:true,productionSaveAndIngestionProved:false});checkpoint();
 async function runNext(){
  assert(!running,'parallel_evaluation_denied');assert.equal(report.state,'ready','review_or_stop_required');
  assert(report.results.length<limits.questions,'question_limit');unchangedRuntime();
  const test=cases[report.results.length];running=true;report.state='running';checkpoint();
  let call=0,done=false,child,activeAbort,transportTimer;
  const outcome=await new Promise(resolve=>{
   child=fork(__filename,['--fixture-worker',test.id],{cwd:root,env:{VAEROEX_SYNTHETIC_EVAL_WORKER:'1'},execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
   const timer=setTimeout(()=>finish({mechanicalPass:false,failure:'engine_timeout'}),200000);
   function finish(value){if(done)return;done=true;cancelActive=undefined;clearTimeout(timer);clearTimeout(transportTimer);activeAbort?.abort();child.kill();resolve(value);}
   cancelActive=()=>finish({mechanicalPass:false,failure:'evaluation_stopped'});
   child.on('error',()=>finish({mechanicalPass:false,failure:'worker_failed'}));
   child.on('exit',()=>{if(!done)finish({mechanicalPass:false,failure:'worker_exited'});});
   child.on('message',async message=>{
    if(done)return;
    if(message?.type==='result'){finish(message.result);return;}
    if(message?.type!=='provider_request'){finish({mechanicalPass:false,failure:'unexpected_worker_message'});return;}
    let failure='request_guard';
    try{
     assert.equal(message.caseId,test.id);checkRequest(message,call);
     assert(call<limits.callsPerQuestion&&report.calls<limits.calls&&report.reservedUsd+limits.reservePerCallUsd<=limits.usd);
     assert(!runningDispatch,'parallel_dispatch_denied');runningDispatch=true;call++;report.calls++;report.reservedUsd+=limits.reservePerCallUsd;
     const prefix=`${test.id}-call-${call}`;
     write(prefix+'-request.json',{endpoint,body:JSON.parse(message.body),requestHash:hash(message.body),chars:message.body.length,bytes:Buffer.byteLength(message.body,'utf8')});checkpoint();
     failure='transport_failed';const abort=new AbortController();activeAbort=abort;let timeout;
     const reply=await Promise.race([dispatch({endpoint,body:message.body,caseId:test.id,call,signal:abort.signal}),new Promise((_,reject)=>{timeout=setTimeout(()=>{abort.abort();reject(Error('timeout'));},90000);transportTimer=timeout;})]).finally(()=>clearTimeout(timeout));
     if(done)return;failure='response_guard';assert.equal(reply.httpStatus,200);assert(/^gpt-6-luna(?:-|$)/.test(reply.model));assert.equal(reply.status,'completed');
     assert.equal(typeof reply.text,'string');assert(reply.text.length<=200000&&!secretLike.test(reply.text));
     assert(Number.isSafeInteger(reply.usage?.input_tokens)&&reply.usage.input_tokens>=0&&reply.usage.input_tokens<=limits.maxBytes);
     assert(Number.isSafeInteger(reply.usage?.output_tokens)&&reply.usage.output_tokens>=0&&reply.usage.output_tokens<=limits.maxOutputTokens);
     const retained={model:reply.model,status:reply.status,text:reply.text,usage:{input_tokens:reply.usage.input_tokens,output_tokens:reply.usage.output_tokens}};
     if(reply.transport){assert.equal(reply.transport.serviceTier,'default');assert(Number.isSafeInteger(reply.transport.wireChars)&&reply.transport.wireChars<=limits.maxChars);assert(Number.isSafeInteger(reply.transport.wireBytes)&&reply.transport.wireBytes<=limits.maxBytes);assert(Number.isFinite(reply.transport.costUpperBoundUsd)&&reply.transport.costUpperBoundUsd<=report.reservedUsd);retained.transport={serviceTier:'default',wireChars:reply.transport.wireChars,wireBytes:reply.transport.wireBytes,costUpperBoundUsd:reply.transport.costUpperBoundUsd};}
     // Write generated synthetic text BEFORE the engine parses or validates it.
     write(prefix+'-generated.json',retained);
     report.knownStandardCostUsd+=(retained.usage.input_tokens*.1+retained.usage.output_tokens*.5)/1000000;
     assert(report.knownStandardCostUsd<=report.reservedUsd&&report.knownStandardCostUsd<=limits.usd);
     const payload={...retained,output_text:retained.text};delete payload.text;
     child.send({type:'provider_response',request:message.request,payload});runningDispatch=false;
    }catch{finish({mechanicalPass:false,failure});}
   });
   let runningDispatch=false;
  });
  running=false;const result={id:test.id,...outcome,calls:call};
  // Useful synthesis is a separate judgment, never inferred from validator pass.
  report.results.push(result);report.state=result.mechanicalPass?'awaiting_manual_review':'stopped';checkpoint();return structuredClone(result);
 }
 function review(assessment){
  assert.equal(report.state,'awaiting_manual_review','no_reviewable_result');const result=report.results.at(-1);
  assert(assessment&&assessment.kind==='manual','manual_review_required');
  assert.equal(typeof assessment.rationale,'string');assert(assessment.rationale.trim().length>=80&&assessment.rationale.length<=2000);
  assert.equal(typeof assessment.passage,'string');assert(assessment.passage.length>=20&&result.answer.includes(assessment.passage));
  const flags=['factsCorrect','bothOriginalsSupport','uncertaintyPreserved','noUnsupportedCausationOrJoin','noUnsupportedMath','specificMissingEvidenceAndNextCheck',...(result.id==='qualified-brief'?['meaningfulCrossSourceConnection','notMerelySeparateSummaries','specificQualifiedFollowUp','missingInvoiceOrderLinkageExplicit','noBalanceAllocationOrRatio','noProfitCashLossOrTrend']:['unsupportedConclusionWithheld'])];
  assert(flags.every(flag=>typeof assessment[flag]==='boolean'),'complete_review_required');
  const passed=flags.every(flag=>assessment[flag]);const retained={id:result.id,...Object.fromEntries(flags.map(flag=>[flag,assessment[flag]])),kind:'manual',rationale:assessment.rationale,passage:assessment.passage,passed};
  assert(!secretLike.test(JSON.stringify(retained)),'credential_shaped_review_denied');report.reviews.push(retained);
  report.state=!passed?'stopped':report.results.length===cases.length?'reviewed_not_real_model_proof':'ready';checkpoint();return passed;
 }
 function stop(){cancelActive?.();report.state='stopped';checkpoint();}
 return {runNext,review,stop,snapshot:()=>structuredClone(report),directory};
}

// This mock is for credential-free smoke/safety tests only; no quality claim.
function mockDispatch({body,caseId='qualified-brief'}){
 assert(cases.some(test=>test.id===caseId),'unknown_fixture_case');
 const request=JSON.parse(body),payload=JSON.parse(request.input[1].content);
 const value=request.text.format.name==='vsi_research_plan_v1'?(()=>{
  const d=payload.sourceDiscovery,available=d?.status==='available'&&d.sourceGroups>=2&&['google_sheets','xero'].every(type=>d.sourceTypes?.includes(type));
  return {mode:available?'answer':'clarify',businessEvidence:available,tier:'simple',clarification:available?'':'No eligible observations are established in this selected context. Which source, entity or period should be checked?',publicTargets:[],objectives:[]};
 })():(()=>{
  const {sharedReply}=require('./vsi-shared-answer-test-support.cjs');
  const answer=sharedReply(payload);
  answer.missing_information=[{premises:answer.observations,text:'Whether the source observations have adequate coverage for a useful review remains unclear.'}];
  answer.next_checks=[{premises:answer.observations,text:'Review these observations and their scope alongside each other.'}];
  return answer;
 })();return Promise.resolve({httpStatus:200,model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:30},text:JSON.stringify(value)});
}

async function fixtureWorker(caseId,variant='present'){
 process.on('disconnect',()=>process.exit(1));
 assert.equal(process.env.VAEROEX_SYNTHETIC_EVAL_WORKER,'1');assert.equal(typeof process.send,'function');
 for(const key of ['OPENAI_API_KEY','GOOGLE_SHEETS_OPENAI_API_KEY','GOOGLE_SHEETS_OPENAI_PROJECT_ID','GOOGLE_SHEETS_OPENAI_ORGANIZATION_ID','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NODE_OPTIONS'])assert.equal(process.env[key],undefined);
 const test=cases.find(c=>c.id===caseId);assert(test);
 // Offline worker variants cannot be selected by createEvaluation or the paid CLI.
 assert(['present','no_sources','missing_named_source','authority_denied','wrong_workspace','revoked_after_plan','ambiguous_scope','mixed_public','closed_plan'].includes(variant));
 const workspace=id(1),actor=id(2),session=id(3),request=id(caseId==='qualified-brief'?4:40),ticket=id(5),manifest=id(6);
 const ActualDate=Date;global.Date=class extends ActualDate{constructor(...args){super(...(args.length?args:['2026-10-24T00:00:00.000Z']));}static now(){return new ActualDate('2026-10-24T00:00:00.000Z').getTime();}};
 const fixture=fixtureForCase(caseId),captureReferenceId=fixture.captureReferenceId;
 const raw=variant==='no_sources'?[]:variant==='missing_named_source'?fixture.raw.filter(s=>s.provider==='xero'):fixture.raw;
 if(variant==='wrong_workspace')raw[0].data.workspace_id=id(999);
 const question=variant==='no_sources'?'Give a short executive brief using the stored workspace observations.':variant==='ambiguous_scope'?'Compare results for the other business and period.':variant==='mixed_public'?'Research Synthetic Public Co and compare it with stored Xero and synthetic Google Sheets observations.':variant==='closed_plan'?'Use only stored Xero and Google Sheets evidence for a brief.':test.question;
 let plannerReturned=false;
 const reader={auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),getClaims:async()=>({data:{claims:{sub:actor,session_id:session}},error:null})},rpc:async(name,args)=>{
  assert.equal(args.p_workspace_id,workspace);
  if(name==='discover_shared_evidence_v1')return variant==='authority_denied'?{data:null,error:{message:'synthetic_authority_denied'}}:{data:{stage:'catalog_only',candidates:raw.map(s=>({provider:s.provider,identity:structuredClone(s.identity)})),truncated:false},error:null};
  if(name==='read_shared_typed_evidence_v1'){const source=raw.find(s=>s.provider==='google_sheets');assert(source);assert.deepEqual(args.p_identity,source.identity);return{data:{stage:'unadmitted',resolved:structuredClone(source)},error:null};}
  if(name==='preview_shared_legacy_evidence_v1'||name==='capture_legacy_evidence_v1'){
   const source=raw.find(s=>s.provider==='xero');assert(source);assert.equal(args.p_binding_id,source.identity.binding_id);assert.equal(args.p_start,source.identity.start);assert.equal(args.p_end,source.identity.end);
   return name==='capture_legacy_evidence_v1'?{data:{reference_id:captureReferenceId,source_hash:source.hash},error:null}:{data:{stage:'unadmitted',resolved:structuredClone(source)},error:null};
  }
  if(name==='shared_evidence_dependencies_v1')return{data:{manifestIds:[],readSources:[]},error:null};
  if(name==='seal_shared_evidence_manifest_v1'){assert.equal(args.p_target_id,request);assert.equal(args.p_sources.length,raw.length);return{data:{stage:'database_bound',manifest_id:manifest,provider_policy_required:true},error:null};}
  if(name==='validate_shared_evidence_manifest_v1')return{data:!(variant==='revoked_after_plan'&&plannerReturned),error:null};throw Error('unexpected_fixture_rpc');
 }};
 require('./qbo-customer-test-support.cjs').installLoader({'server-only':{},'@supabase/supabase-js':{createClient:()=>{throw Error('database_client_denied');}},
  '@/lib/ai/shared-evidence/runtime-gate':{sharedEvidenceRuntimeEnabled:()=>true},'@/lib/ai/shared-evidence/qualitative-policy':{qualitativeSynthesisEnabled:()=>true},
  './retrieval':{authorizeVsiRead:async()=>({supabase:reader,workspaceId:workspace,user:{id:actor},membership:{role:'owner'},workspace:{id:workspace,name:'Synthetic evaluation workspace',industry:'Synthetic operations'}}),retrieveVsiEvidence:async()=>{throw Error('legacy_fallback_denied');}},
  './product-context':{loadVsiProductContext:async(access,t)=>require('../lib/vsi/product-context.ts').loadVsiProductContext(access,t)},
  '@/lib/billing/get-subscription-status':{getSubscriptionStatus:async()=>({allowed:true,status:'active',source:'subscription',plan_slug:'vaeroex'})},
  '@/lib/integrations/dashboard/server':{loadIntegrationDashboard:async()=>({loadFailed:false,googleSheetsConnectionIds:[],dashboard:{workspaceId:workspace,observedAt:'2026-10-24T00:00:00Z',timeZone:'UTC',timeZoneConfirmed:true,preferencesAvailable:true,unavailable:[],entries:[]}})},
  '@/lib/integrations/google-sheets/read-authority':{bindGoogleSheetsRead:async()=>({ticketId:ticket})},'@/lib/ai/providers/google-data-policy':{googleSheetsOpenAIHeaders:async()=>({Authorization:'Bearer synthetic-evaluation-no-access'})},
  '@/lib/supabase/admin':{createSupabaseAdminClient:()=>{throw Error('database_client_denied');}}
 });
 const pending=new Map();let serial=0,answerCount=0;console.info=()=>{};console.error=()=>{};
 process.on('message',message=>{if(message?.type==='provider_response'&&pending.has(message.request)){if(message.request===1)plannerReturned=true;pending.get(message.request)(new Response(JSON.stringify(message.payload),{status:200}));pending.delete(message.request);}});
 global.fetch=async(url,init)=>{const n=++serial;assert(n<=(variant==='mixed_public'?4:2));const body=JSON.parse(init.body);if(body.text?.format?.name==='vsi_shared_answer_v2')answerCount++;return new Promise(resolve=>{pending.set(n,resolve);process.send({type:'provider_request',request:n,caseId,url,body:init.body});});};
 const {runVsiAnswer}=require('../lib/vsi/engine.ts');
 try{
  const answer=await runVsiAnswer({supabase:reader,workspaceId:workspace,actorUserId:actor,readTicket:{ticketId:ticket},question,recentMessages:[],requestId:id(7),reservedRequest:{id:request,attempt:1}});
  if(answerCount===0&&answer.usage.providerCalls===1&&!answer.noteDraft){process.send({type:'result',result:{mechanicalPass:false,failure:'planner_clarification',clarification:answer.content,citations:answer.citations,answerGenerationCalls:0,usage:{providerCalls:answer.usage.providerCalls,estimatedCostUsd:answer.usage.estimatedCostUsd},syntheticAuthorityOnly:true}});return;}
  assert.equal(answerCount,1);assert.equal(answer.citations.length,variant==='mixed_public'?3:2);assert.deepEqual(new Set(answer.citations.map(c=>c.sourceType)),new Set(variant==='mixed_public'?['shared_xero','shared_google_sheets','web']:['shared_xero','shared_google_sheets']));
  process.send({type:'result',result:{mechanicalPass:true,answer:answer.content,citations:answer.citations,usage:{providerCalls:answer.usage.providerCalls,estimatedCostUsd:answer.usage.estimatedCostUsd},syntheticAuthorityOnly:true}});
 }catch(error){const diagnostic=error?.usage?.validationFailure,category=error?.usage?.outcomeFailure;process.send({type:'result',result:{mechanicalPass:false,failure:diagnostic?'engine_validation_failed':'engine_failed',...(diagnostic?{diagnostic}:{}),...(['application','evidence_unavailable','context_block','budget_block','provider','timeout','output_validation','citation_validation'].includes(category)?{engineCategory:category}:{})}});}
}
module.exports={candidate,cases,truth,limits,endpoint,checkRequest,createEvaluation,mockDispatch,fixtureForCase};
if(require.main===module){
 if(process.argv[2]==='--fixture-worker')fixtureWorker(process.argv[3],process.argv[4]).catch(()=>process.exit(1));
 else if(process.argv.length===3&&process.argv[2]==='--plan')console.log(JSON.stringify({candidate,cases,truth,limits,liveExecutionAvailable:false,credentialRoute:'not configured'}));
 else if(process.argv.length===4&&process.argv[2]==='--dry-run'){
  (async()=>{const evaluation=createEvaluation({outputDir:process.argv[3],dispatch:mockDispatch});await evaluation.runNext();const r=evaluation.snapshot();console.log(JSON.stringify({mockOnly:true,realModelQualified:false,state:r.state,calls:r.calls,reservedUsd:r.reservedUsd,questionsCompleted:r.results.length,artifactDirectory:evaluation.directory}));})().catch(error=>{const codes=['EEXIST','ENOENT','EACCES'];console.error(JSON.stringify({failure:'isolated_evaluation_failed',code:codes.includes(error.code)?error.code:'guard_failed'}));process.exitCode=1;});
 }else{console.error('Only --plan or --dry-run <new absolute private directory> is supported. Live execution is not configured.');process.exitCode=64;}
}
