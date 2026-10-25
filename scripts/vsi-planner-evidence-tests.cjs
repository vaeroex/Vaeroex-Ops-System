/* eslint-disable @typescript-eslint/no-require-imports -- Real engine, fixed synthetic authority and mocked model responses only. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {fork}=require('node:child_process');
const {cases,mockDispatch,createEvaluation,limits}=require('./vsi-isolated-contract-evaluation.cjs');
require('node:https').request=()=>{throw Error('real_network_denied');};
const retainedClarification={mode:'clarify',businessEvidence:false,tier:'simple',clarification:'Please provide the two explicitly synthetic Xero and Google Sheets observations (including their original dates and units); they are not included here, so I can’t produce a supported brief or follow-up.',publicTargets:[],objectives:[]};
let scenarios=0;
function checkDiscovery(body,empty=false){
 const input=JSON.parse(body.input[1].content),d=input.sourceDiscovery;
 assert.match(body.input[0].content,/Observation values are deliberately omitted from planning/);
 assert.match(body.input[0].content,/Preserve genuine clarification needs/);
 assert.equal(d.status,empty?'none_in_selected_context':'available');assert.equal(d.sourceGroups,empty?0:2);
 assert.deepEqual(new Set(d.sourceTypes),new Set(empty?[]:['google_sheets','xero']));
 assert.equal(d.observationsIncluded,false);assert.equal(d.coverageComplete,false);
 assert(d.window.start<='2026-10-14'&&d.window.end>='2026-10-14');
 assert.equal(input.runtimeCapabilities.privateBusinessEvidence,d.status);
 assert.equal(input.businessSources,undefined);assert.equal(input.qualitative_sources,undefined);
 assert.deepEqual(Object.keys(d).sort(),['coverageComplete','observationsIncluded','sourceGroups','sourceTypes','status','window']);
 assert(!/1200|payment hold|dispatches|invoice balance|outstanding|00000000-/.test(JSON.stringify(d)),'planning gets only discovery metadata, no values, identities or raw scope labels');
}
async function usefulMock(request){
 const reply=await mockDispatch(request),body=JSON.parse(request.body);
 if(body.text.format.name!=='vsi_shared_answer_v2')return reply;
 const {usefulSharedReply}=require('./vsi-shared-answer-test-support.cjs');
 return {...reply,text:JSON.stringify(usefulSharedReply(JSON.parse(body.input[1].content),request.caseId))};
}
function runCase(caseId,variant='present',planner){return new Promise((resolve,reject)=>{
 const requests=[],child=fork(path.join(__dirname,'vsi-isolated-contract-evaluation.cjs'),['--fixture-worker',caseId,variant],{env:{VAEROEX_SYNTHETIC_EVAL_WORKER:'1'},execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
 let done=false;const timer=setTimeout(()=>finish(Error('planner_fixture_timeout')),15000);
 function finish(error,result){if(done)return;done=true;clearTimeout(timer);child.kill();if(error)reject(error);else{scenarios++;resolve({result,requests});}}
 child.on('error',error=>finish(error));child.on('exit',()=>{if(!done)finish(Error('planner_fixture_exited'));});
 child.on('message',async message=>{try{
  if(message.type==='result'){finish(null,message.result);return;}
  assert.equal(message.type,'provider_request');assert.equal(message.url,'https://api.openai.com/v1/responses');requests.push(JSON.parse(message.body));assert(requests.length<=2);
  const body=requests.at(-1);assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.equal(body.tools,undefined);
  const planning=body.text.format.name==='vsi_research_plan_v1';
  if(planning)checkDiscovery(body,variant==='no_sources');
  const reply=planning&&planner?{httpStatus:200,model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:30},text:JSON.stringify(planner)}:await usefulMock({body:message.body,caseId});
  child.send({type:'provider_response',request:message.request,payload:{model:reply.model,status:reply.status,usage:reply.usage,output_text:reply.text}});
 }catch(error){finish(error);}});
});}
(async()=>{
 const answers=[];
 for(const test of cases){
  const {result,requests}=await runCase(test.id);assert(result.mechanicalPass);assert.equal(requests.length,2);assert.equal(result.citations.length,2);
  const payload=JSON.parse(requests[1].input[1].content);assert.equal(payload.businessSources.length,2);assert.equal(payload.qualitative_sources.length,2);
  const facts=JSON.stringify(payload.qualitative_sources);
  if(test.id==='qualified-brief'){assert.match(facts,/1200 USD/);assert.match(facts,/payment hold: 3 count/);assert.match(result.answer,/existing invoice references/);assert(!/outstanding: 50 USD|dispatches: 6 count/.test(facts));}
  else{assert.match(facts,/outstanding: 50 USD/);assert.match(facts,/dispatches: 6 count/);assert.match(facts,/backlog: 4 count/);assert.match(result.answer,/do not establish a billing-to-operations relationship/);assert(!/1200 USD|payment hold/.test(facts));}
  answers.push(result);
 }
 assert(answers[0].citations.every(a=>answers[1].citations.every(b=>a.sourceId!==b.sourceId)));
 const absent=await runCase('qualified-brief','no_sources');assert.equal(absent.requests.length,1);assert.equal(absent.result.failure,'planner_clarification');assert.match(absent.result.clarification,/No eligible observations/);assert.equal(absent.result.answerGenerationCalls,0);assert.deepEqual(absent.result.citations,[]);
 const ambiguous=await runCase('qualified-brief','ambiguous_scope',{...retainedClarification,clarification:'Which business and period should I compare?'});assert.equal(ambiguous.requests.length,1);assert.equal(ambiguous.result.failure,'planner_clarification');assert(ambiguous.result.clarification.includes('Which business and period should I compare?'));assert.match(ambiguous.result.clarification,/^Clarification requested \(model draft\):/);
 for(const variant of ['missing_named_source','authority_denied','wrong_workspace']){const denied=await runCase('qualified-brief',variant);assert.equal(denied.requests.length,0);assert.equal(denied.result.mechanicalPass,false);assert.equal(denied.result.engineCategory,'evidence_unavailable');}
 const revoked=await runCase('qualified-brief','revoked_after_plan');assert.equal(revoked.requests.length,1);assert.equal(revoked.result.engineCategory,'evidence_unavailable','source revocation stops before the answer request');
 const malformed=await runCase('qualified-brief','present',{...retainedClarification,mode:'invented'});assert.equal(malformed.requests.length,1);assert.equal(malformed.result.engineCategory,'output_validation');
 const publicDenied=await runCase('qualified-brief','present',{mode:'research',businessEvidence:true,tier:'simple',clarification:'',publicTargets:[{text:'Xero',origin:'question'}],objectives:['overview']});assert.equal(publicDenied.requests.length,1);assert.equal(publicDenied.result.failure,'planner_clarification','private discovery does not authorize web export');
 // Replay the retained 03 response: even with discovery, the engine must not
 // override an explicit clarification or label it as an unexpected crash.
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'vsi-planner-replay-'));fs.chmodSync(temporary,0o700);
 const replay=createEvaluation({outputDir:path.join(temporary,'run'),dispatch:async request=>{assert.equal(JSON.parse(request.body).text.format.name,'vsi_research_plan_v1');checkDiscovery(JSON.parse(request.body));return {httpStatus:200,model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:30},text:JSON.stringify(retainedClarification)};}});
 const replayed=await replay.runNext();scenarios++;assert.equal(replayed.failure,'planner_clarification');assert(replayed.clarification.includes(retainedClarification.clarification));assert.match(replayed.clarification,/^Clarification requested \(model draft\):/);assert.equal(replay.snapshot().calls,1);assert.equal(replay.snapshot().state,'stopped');await assert.rejects(replay.runNext(),/review_or_stop_required/);assert.equal(replay.snapshot().reservedUsd,.25);
 assert.equal(cases.length,2);assert.equal(limits.calls,4);assert.equal(limits.usd,1);
 console.log(JSON.stringify({passed:true,scenarios,actualEnginePlannerInputAndAnswer:true,availableCompatibleAndSparseCases:true,emptyEvidenceClarifies:true,ambiguousScopeClarifies:true,requestedMissingAndUnauthorizedSourcesDenyBeforeModel:true,revokedSourceStopsBeforeAnswer:true,retained03ClarificationReplayedWithoutOverride:true,manualUsefulnessStillRequired:true,paidQuestionsUnchanged:2,externalCalls:0}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
