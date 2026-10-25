/* eslint-disable @typescript-eslint/no-require-imports -- Actual engine with synthetic authority and mocked provider IPC only. */
const assert=require('node:assert/strict'),path=require('node:path'),{fork}=require('node:child_process');
const {usefulSharedReply}=require('./vsi-shared-answer-test-support.cjs');
const {fixtureForCase}=require('./vsi-isolated-contract-evaluation.cjs');
let scenarios=0;
function run(caseId,change=answer=>answer,variant='present',planChange){return new Promise((resolve,reject)=>{
 let calls=0,done=false;const child=fork(path.join(__dirname,'vsi-isolated-contract-evaluation.cjs'),['--fixture-worker',caseId,variant],{env:{VAEROEX_SYNTHETIC_EVAL_WORKER:'1'},execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
 const timer=setTimeout(()=>finish(Error('offline_engine_timeout')),20000);
 function finish(error,result){if(done)return;done=true;clearTimeout(timer);child.kill();if(error)reject(error);else{scenarios++;resolve({...result,mockedCalls:calls});}}
 child.on('error',e=>finish(e));child.on('exit',()=>{if(!done)finish(Error('offline_worker_exited'));});
 child.on('message',message=>{try{
  if(message.type==='result'){finish(null,message.result);return;}
  assert.equal(message.type,'provider_request');assert(++calls<=(variant==='mixed_public'?4:2));assert.equal(message.url,'https://api.openai.com/v1/responses');
  const body=JSON.parse(message.body),payload=JSON.parse(body.input[1].content);assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);
  let response;
  if(body.text.format.name==='vsi_research_plan_v1'){
   const plan={mode:variant==='mixed_public'?'research':'answer',businessEvidence:true,tier:'simple',clarification:'',publicTargets:variant==='mixed_public'?[{text:'Synthetic Public Co',origin:'question'}]:[],objectives:variant==='mixed_public'?['overview']:[]};
   response={output_text:JSON.stringify(planChange?planChange(plan):plan)};
  }else if(body.text.format.name==='vsi_public_research_v1'){
   assert.equal(variant,'mixed_public');assert.doesNotMatch(JSON.stringify(payload),/Xero|Google Sheets|payment hold|outstanding|00000000-/i,'no private discovery, values, identities or user question enter public research');
   const url='https://synthetic.example/about';response={output_text:JSON.stringify({claims:[{text:'Synthetic Public Co describes a hypothetical public operations offering.',urls:[url],evidenceDate:null,dateProvenance:{kind:'unknown',sourceUrl:null,sourceText:null}}],limitations:['Synthetic public fixture only.'],needsMoreResearch:false}),output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{type:'url',url,title:'Synthetic public source'}]}}]};
  }else{
   assert.equal(body.text.format.name,'vsi_shared_answer_v2');assert.equal(body.text.format.schema.properties.content,undefined);assert.equal(body.text.format.schema.properties.citationIds,undefined);
   assert.match(body.input[0].content,/Draft prose has no factual or calculation authority/);assert.doesNotMatch(body.input[0].content,/exact premise business words|words remain forbidden even in questions/);
   const expected=usefulSharedReply(payload,caseId);
   if(variant==='mixed_public'){const source=payload.contextFactSources.find(s=>s.ref.startsWith('W'));assert(source);expected.observations.push({ref:source.ref,binding:source.binding,factIndex:0});}
   response={output_text:JSON.stringify(change(expected,payload))};
  }
  child.send({type:'provider_response',request:message.request,payload:{model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:30},...response}});
 }catch(e){finish(e);}});
});}
async function rejected(change,{stage='shared_answer_contract',rule,variant='present'}={}){const result=await run('qualified-brief',change,variant);assert(!result.mechanicalPass);assert.equal(result.diagnostic.stage,stage);if(rule)assert.equal(result.diagnostic.contractRule,rule);assert.equal(result.mockedCalls,2);return result;}
(async()=>{
 for(const caseId of ['qualified-brief','unsupported-cause']){const result=await run(caseId);assert(result.mechanicalPass);assert.equal(result.mockedCalls,2);assert.equal(result.citations.length,2);assert.match(result.answer,/Stored observations \(source-reported/);assert.match(result.answer,/Recommended check \(model draft; not performed\)/);if(caseId==='qualified-brief'){assert.match(result.answer,/is linked to each payment-held order/);assert.match(result.answer,/existing invoice references/);assert.match(result.answer,/1200 USD/);}else{assert.match(result.answer,/do not establish a billing-to-operations relationship/);assert(!result.answer.includes('payment hold'));}}
 // Exact legacy retained response shape cannot smuggle arbitrary factual text.
 await rejected(()=>({content:'The retained Evaluation04 factual prose.',citationIds:['B1','B2'],interpretations:[]}),{stage:'answer_schema'});
 const retained=await run('qualified-brief',(answer)=>({...answer,hypotheses:[{premises:answer.observations,text:'The Google Sheets orders on payment hold and the Xero outstanding invoice balance may each merit follow-up.'}],missing_information:[{premises:answer.observations,text:'Whether the partial supplied observations have sufficient coverage to assess the status of the Google Sheets orders on payment hold and the Xero outstanding invoice balance.'}],next_checks:[{premises:answer.observations,text:'Review the source records for the Google Sheets orders on payment hold and the Xero outstanding invoice balance, including their scope and coverage.'}]}));assert(retained.mechanicalPass);assert.match(retained.answer,/Hypothesis \(unverified model draft\)/);const manualRetainedUseful=false;assert.equal(manualRetainedUseful,false);
 await rejected(answer=>({...answer,content:'Invented facts.'}),{stage:'answer_schema'});
 await rejected(answer=>({...answer,observations:[{...answer.observations[0],provider:'xero'},...answer.observations.slice(1)]}),{stage:'answer_schema'});
 await rejected(answer=>({...answer,observations:[{...answer.observations[0],quote:'Invented support.'},...answer.observations.slice(1)]}),{stage:'answer_schema'});
 await rejected(answer=>({...answer,observations:answer.observations.map((s,i)=>i? s:{...s,binding:answer.observations[1].binding})}),{rule:'fact_reference'});
 await rejected(answer=>({...answer,observations:answer.observations.map((s,i)=>i? s:{...s,ref:'B999'})}),{rule:'fact_reference'});
 await rejected(answer=>({...answer,results:['f'.repeat(64)]}),{rule:'result_reference'});
 await rejected(answer=>({...answer,next_checks:[{premises:answer.observations,text:'The balance caused 50% of delays.'}]}),{rule:'numeric_draft'});
 await rejected(answer=>({...answer,observations:answer.observations.slice(0,1)}),{rule:'source_coverage'});
 await rejected(answer=>({...answer,observations:[{...answer.observations[0],binding:fixtureForCase('unsupported-cause').raw[0].hash},...answer.observations.slice(1)]}),{rule:'fact_reference'});
 await rejected(answer=>({...answer,missing_information:[{premises:answer.observations,text:'See https://not-issued.invalid/private'}]}),{rule:'draft_format'});
 await rejected(answer=>({...answer,hypotheses:[{premises:[answer.observations[0]],text:'This invoice caused the operational issue.'}]}),{rule:'independent_sources'});
 const revoked=await run('qualified-brief',answer=>answer,'revoked_after_plan');assert(!revoked.mechanicalPass);assert.equal(revoked.engineCategory,'evidence_unavailable');assert.equal(revoked.mockedCalls,1);
 const wrong=await run('qualified-brief',answer=>answer,'wrong_workspace');assert(!wrong.mechanicalPass);assert.equal(wrong.engineCategory,'evidence_unavailable');assert.equal(wrong.mockedCalls,0);
 const closed=await run('qualified-brief',answer=>answer,'closed_plan',plan=>({...plan,businessEvidence:false}));assert(!closed.mechanicalPass);assert.equal(closed.engineCategory,'evidence_unavailable');assert.equal(closed.mockedCalls,1,'no fallback free-form answer to an explicit stored-data question');
 for(const clarification of ['The invoice balance is 999 USD.','See https://not-issued.invalid']){const denied=await run('qualified-brief',answer=>answer,'present',plan=>({...plan,mode:'clarify',businessEvidence:false,clarification}));assert(!denied.mechanicalPass);assert.equal(denied.engineCategory,'output_validation');assert.equal(denied.diagnostic.stage,'planner_clarification');assert.equal(denied.mockedCalls,1);}
 const mixed=await run('qualified-brief',answer=>answer,'mixed_public');assert(mixed.mechanicalPass);assert.equal(mixed.mockedCalls,3);assert.equal(mixed.citations.length,3);assert(mixed.citations.some(s=>s.sourceType==='web'));assert.match(mixed.answer,/Source date: not established/);
 const falseDraft=await run('qualified-brief',answer=>({...answer,hypotheses:[{premises:answer.observations,text:'Google Sheets records the invoice balance and Xero reports the held orders.'}]}));assert(falseDraft.mechanicalPass);assert.match(falseDraft.answer,/Hypothesis \(unverified model draft\)/);const manualAttributionApproved=false;assert.equal(manualAttributionApproved,false,'a false prose attribution is not semantically verified by valid premises');
 console.log(JSON.stringify({passed:true,scenarios,actualEngineFullPromptAndSchema:true,compatibleAndSparseNaturalAnswers:true,retained04NoVocabularyExceptions:true,legacyContentBypassRejected:true,canonicalFactAttributionOwnedByApp:true,falseProseStillRequiresManualRejection:true,noUnissuedCalculation:true,wrongWorkspaceAndRevocationDeny:true,noPrivateWebExport:true,mixedPublicCitationsPreserved:true,semanticEntailmentProved:false,realModelUsefulnessProved:false,externalCalls:0}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
