/* eslint-disable @typescript-eslint/no-require-imports -- Fixed synthetic-only engine evaluator; no live credential or network adapter. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fork,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const candidate='a9559f9daa077bae1c2c77a2c061276940193066';
const runtimeTrees='040000 tree 8295029f519c64ea83e1c8c56f739245d24b460b\tapp\n040000 tree 80cdab6996af5560403171cac3002e97439c8757\tlib';
const endpoint='https://api.openai.com/v1/responses';
const limits=Object.freeze({questions:2,calls:4,callsPerQuestion:2,usd:1,reservePerCallUsd:.25,maxChars:48000,maxBytes:192000,maxOutputTokens:8000});
const cases=Object.freeze([
 {id:'qualified-brief',question:'Using only the explicitly synthetic stored Xero invoice-balance and Google Sheets dispatch/backlog observations, give a short hypothetical executive brief. Distinguish recorded facts, a qualified interpretation, missing information and the next check. Cite both originals. Do not infer invoice matching, causation, profit or ratios. Do not search the web.',expectation:'A useful joint interpretation or precise limitation beyond separate summaries or generic warrant-review language. Both original citations, exact facts and uncertainty must be preserved.'},
 {id:'unsupported-cause',question:'Do these explicitly synthetic stored Xero invoice-balance and Google Sheets dispatch/backlog observations establish that unpaid invoices caused delays? Explain what the records support and what information is missing. Cite both originals. Do not invent matching, causation, profit or ratios. Do not search the web.',expectation:'Withhold unsupported causation, joins and arithmetic; explain specific missing evidence and useful next checks. An empty interpretation list is appropriate when no supported hypothesis fits.'}
]);
const truth='All observations are invented. Xero-shaped invoice-balance observations are USD values, not revenue, cash receipts, profit, period totals or a verified collections trend. Sheets dispatch/backlog observations are counts, not money. They share an explicitly synthetic scenario only; no invoice/order linkage, completeness, causal evidence or matched record identities are provided.';
const secretLike=/\b(?:Bearer\s+\S+|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
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
 assert.equal(body.text?.format?.name,call===0?'vsi_research_plan_v1':'vsi_answer_v1');
 assert(Number.isSafeInteger(body.max_output_tokens)&&body.max_output_tokens>0&&body.max_output_tokens<=limits.maxOutputTokens);
 assert(Number.isInteger(call)&&call>=0&&call<limits.callsPerQuestion);return body;
}
function createEvaluation({outputDir,dispatch}={}){
 assert.equal(typeof dispatch,'function','no_live_transport_configured');unchangedRuntime();
 const directory=privateDirectory(outputDir);
 const report={candidate,synthetic:true,liveTransportProvidedByThisModule:false,realModelQualified:false,limits,calls:0,reservedUsd:0,knownStandardCostUsd:0,state:'ready',results:[],reviews:[]};
 let sequence=0,running=false;
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
   function finish(value){if(done)return;done=true;clearTimeout(timer);clearTimeout(transportTimer);activeAbort?.abort();child.kill();resolve(value);}
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
  const flags=['factsCorrect','bothOriginalsSupport','uncertaintyPreserved','noUnsupportedCausationOrJoin','noUnsupportedMath','specificMissingEvidenceAndNextCheck',...(result.id==='qualified-brief'?['meaningfulCrossSourceConnection','notMerelySeparateSummaries']:['unsupportedConclusionWithheld'])];
  assert(flags.every(flag=>typeof assessment[flag]==='boolean'),'complete_review_required');
  const passed=flags.every(flag=>assessment[flag]);const retained={id:result.id,...Object.fromEntries(flags.map(flag=>[flag,assessment[flag]])),kind:'manual',rationale:assessment.rationale,passage:assessment.passage,passed};
  assert(!secretLike.test(JSON.stringify(retained)),'credential_shaped_review_denied');report.reviews.push(retained);
  report.state=!passed?'stopped':report.results.length===cases.length?'reviewed_not_real_model_proof':'ready';checkpoint();return passed;
 }
 return {runNext,review,snapshot:()=>structuredClone(report),directory};
}

// This mock is for credential-free smoke/safety tests only; no quality claim.
function mockDispatch({body}){
 const request=JSON.parse(body),payload=JSON.parse(request.input[1].content);
 const value=request.text.format.name==='vsi_research_plan_v1'?{mode:'answer',businessEvidence:true,tier:'simple',clarification:'',publicTargets:[],objectives:[]}:(()=>{
  const x=payload.qualitative_sources.find(s=>payload.businessSources.find(b=>b.id===s.ref)?.sourceType==='shared_xero');
  const s=payload.qualitative_sources.find(s=>payload.businessSources.find(b=>b.id===s.ref)?.sourceType==='shared_google_sheets');
  return {content:`Stored observations [${x.ref}] [${s.ref}].`,citationIds:[x.ref,s.ref],interpretations:[{premises:[x,s].map(p=>({ref:p.ref,binding:p.binding,quote:p.facts[0]})),hypothesis:'Invoice balance may warrant review alongside dispatches.',missing_information:'Whether invoice balance and dispatches concern comparable periods.',next_check:'Review invoice balance alongside dispatches.'}]};
 })();return Promise.resolve({httpStatus:200,model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:30},text:JSON.stringify(value)});
}

async function fixtureWorker(caseId){
 assert.equal(process.env.VAEROEX_SYNTHETIC_EVAL_WORKER,'1');assert.equal(typeof process.send,'function');
 for(const key of ['OPENAI_API_KEY','GOOGLE_SHEETS_OPENAI_API_KEY','GOOGLE_SHEETS_OPENAI_PROJECT_ID','GOOGLE_SHEETS_OPENAI_ORGANIZATION_ID','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NODE_OPTIONS'])assert.equal(process.env[key],undefined);
 const test=cases.find(c=>c.id===caseId);assert(test);const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const workspace=id(1),actor=id(2),session=id(3),request=id(caseId==='qualified-brief'?4:40),ticket=id(5),manifest=id(6);
 const ActualDate=Date;global.Date=class extends ActualDate{constructor(...args){super(...(args.length?args:['2026-10-24T00:00:00.000Z']));}static now(){return new ActualDate('2026-10-24T00:00:00.000Z').getTime();}};
 const raw=[{provider:'google_sheets',identity:{kind:'sheets_ticket_source',source_id:id(10),version_id:id(11),authority_hash:'a'.repeat(64)},hash:'a'.repeat(64),data:{provider:'google_sheets',workspace_id:workspace,entity_id:id(30),connection_id:id(31),date:'2026-10-14',time_zone:'UTC',metrics:[{metric:'Synthetic scenario dispatches',value:'6',unit:'count'},{metric:'Synthetic scenario end-of-day backlog',value:'4',unit:'count'}],read_sources:[]}},
  {provider:'xero',identity:{kind:'legacy_binding',binding_id:id(32),start:'2026-10-01',end:'2026-10-30'},hash:'b'.repeat(64),data:{provider:'xero',workspace_id:workspace,entity_id:id(30),connection_id:id(33),scope:'stored synthetic invoice observations',records:[{day:'2026-10-14',metrics:[{key:'invoice balance',value:'50',currency:'USD'}]}],read_sources:[]}}];
 const reader={auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),getClaims:async()=>({data:{claims:{sub:actor,session_id:session}},error:null})},rpc:async(name,args)=>{
  if(name==='discover_shared_evidence_v1')return{data:{stage:'catalog_only',candidates:raw.map(s=>({provider:s.provider,identity:s.identity})),truncated:false},error:null};
  if(name==='read_shared_typed_evidence_v1'||name==='preview_shared_legacy_evidence_v1')return{data:{stage:'unadmitted',resolved:structuredClone(raw[name==='read_shared_typed_evidence_v1'?0:1])},error:null};
  if(name==='capture_legacy_evidence_v1')return{data:{reference_id:id(70),source_hash:raw[1].hash},error:null};
  if(name==='shared_evidence_dependencies_v1')return{data:{manifestIds:[],readSources:[]},error:null};
  if(name==='seal_shared_evidence_manifest_v1'){assert.equal(args.p_target_id,request);assert.equal(args.p_sources.length,2);return{data:{stage:'database_bound',manifest_id:manifest,provider_policy_required:true},error:null};}
  if(name==='validate_shared_evidence_manifest_v1')return{data:true,error:null};throw Error('unexpected_fixture_rpc');
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
 process.on('message',message=>{if(message?.type==='provider_response'&&pending.has(message.request)){pending.get(message.request)(new Response(JSON.stringify(message.payload),{status:200}));pending.delete(message.request);}});
 global.fetch=async(url,init)=>{const n=++serial;assert(n<=2);const body=JSON.parse(init.body);if(body.text?.format?.name==='vsi_answer_v1')answerCount++;return new Promise(resolve=>{pending.set(n,resolve);process.send({type:'provider_request',request:n,caseId,url,body:init.body});});};
 const {runVsiAnswer}=require('../lib/vsi/engine.ts');
 try{
  const answer=await runVsiAnswer({supabase:reader,workspaceId:workspace,actorUserId:actor,readTicket:{ticketId:ticket},question:test.question,recentMessages:[],requestId:id(7),reservedRequest:{id:request,attempt:1}});
  assert.equal(answerCount,1);assert.equal(answer.citations.length,2);assert.deepEqual(new Set(answer.citations.map(c=>c.sourceType)),new Set(['shared_xero','shared_google_sheets']));
  process.send({type:'result',result:{mechanicalPass:true,answer:answer.content,citations:answer.citations,usage:{providerCalls:answer.usage.providerCalls,estimatedCostUsd:answer.usage.estimatedCostUsd},syntheticAuthorityOnly:true}});
 }catch(error){const diagnostic=error?.usage?.validationFailure;process.send({type:'result',result:{mechanicalPass:false,failure:diagnostic?'engine_validation_failed':'engine_failed',...(diagnostic?{diagnostic}:{})}});}
}
module.exports={candidate,cases,truth,limits,endpoint,checkRequest,createEvaluation,mockDispatch};
if(require.main===module){
 if(process.argv[2]==='--fixture-worker')fixtureWorker(process.argv[3]).catch(()=>process.exit(1));
 else if(process.argv.length===3&&process.argv[2]==='--plan')console.log(JSON.stringify({candidate,cases,truth,limits,liveExecutionAvailable:false,credentialRoute:'not configured'}));
 else if(process.argv.length===4&&process.argv[2]==='--dry-run'){
  (async()=>{const evaluation=createEvaluation({outputDir:process.argv[3],dispatch:mockDispatch});await evaluation.runNext();const r=evaluation.snapshot();console.log(JSON.stringify({mockOnly:true,realModelQualified:false,state:r.state,calls:r.calls,reservedUsd:r.reservedUsd,questionsCompleted:r.results.length,artifactDirectory:evaluation.directory}));})().catch(error=>{const codes=['EEXIST','ENOENT','EACCES'];console.error(JSON.stringify({failure:'isolated_evaluation_failed',code:codes.includes(error.code)?error.code:'guard_failed'}));process.exitCode=1;});
 }else{console.error('Only --plan or --dry-run <new absolute private directory> is supported. Live execution is not configured.');process.exitCode=64;}
}
