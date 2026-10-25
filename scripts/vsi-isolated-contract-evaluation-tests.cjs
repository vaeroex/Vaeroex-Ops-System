/* eslint-disable @typescript-eslint/no-require-imports -- Offline evaluator safety tests; all model replies are synthetic. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {candidate,cases,limits,endpoint,checkRequest,createEvaluation,mockDispatch}=require('./vsi-isolated-contract-evaluation.cjs');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'vsi-isolated-evaluator-tests-'));fs.chmodSync(temporary,0o700);
let sequence=0,dispatches=0,negativeCases=0;
const output=()=>path.join(temporary,`run-${++sequence}`);
const dispatch=async request=>{dispatches++;return mockDispatch(request);};
const files=dir=>fs.readdirSync(dir).map(name=>({name,value:fs.readFileSync(path.join(dir,name),'utf8')}));
function review(result,meaningful=true){return{kind:'manual',rationale:'Synthetic test review: the explanation distinguishes billing amounts from dispatch counts and identifies the missing comparable population and record linkage; this is not a real-model quality assessment.',passage:result.answer.slice(0,90),factsCorrect:true,bothOriginalsSupport:true,uncertaintyPreserved:true,noUnsupportedCausationOrJoin:true,noUnsupportedMath:true,specificMissingEvidenceAndNextCheck:true,meaningfulCrossSourceConnection:meaningful,notMerelySeparateSummaries:meaningful,unsupportedConclusionWithheld:true};}
async function rejectedReply(change){
 let calls=0;const evaluation=createEvaluation({outputDir:output(),dispatch:async request=>{calls++;const reply=await mockDispatch(request);return change(reply,request);}});
 const result=await evaluation.runNext();assert.equal(result.mechanicalPass,false);assert.equal(evaluation.snapshot().state,'stopped');
 await assert.rejects(evaluation.runNext(),/review_or_stop_required/);negativeCases++;return{evaluation,result,calls};
}
(async()=>{
 assert.equal(candidate,'a9559f9daa077bae1c2c77a2c061276940193066');assert.equal(cases.length,2);assert.equal(limits.calls,4);assert.equal(limits.usd,1);
 const first=createEvaluation({outputDir:output(),dispatch});const result=await first.runNext();
 assert.equal(dispatches,2);
 assert(result.mechanicalPass);assert.equal(result.calls,2);assert.equal(first.snapshot().state,'awaiting_manual_review');assert.equal(first.snapshot().realModelQualified,false);
 await assert.rejects(first.runNext(),/review_or_stop_required/);negativeCases++;
 assert.throws(()=>first.review({kind:'model',rationale:'Not a manual review.'}),/manual_review_required/);negativeCases++;
 assert.throws(()=>first.review({kind:'manual',rationale:'x'.repeat(100),passage:result.answer.slice(0,50)}),/complete_review_required/);negativeCases++;
 assert.equal(first.review(review(result,false)),false,'generic warrant-review wording is insufficient when assessed honestly');
 assert.equal(first.snapshot().state,'stopped');await assert.rejects(first.runNext());negativeCases++;
 const all=files(first.directory);for(const file of all)assert.equal(fs.statSync(path.join(first.directory,file.name)).mode&0o777,0o600);
 const request=JSON.parse(all.find(f=>f.name==='qualified-brief-call-2-request.json').value);
 assert(request.body.input[0].content.length>10000,'actual full engine prompt, not a tiny test substitute');
 assert.match(request.body.input[0].content,/even in questions or negations/);
 assert.match(request.body.text.format.schema.properties.interpretations.items.description,/exact premise business words/);
 assert.equal(request.body.store,false);assert.equal(request.body.stream,false);assert(request.chars<=48000&&request.bytes<=192000);
 const payload=JSON.parse(request.body.input[1].content);assert.equal(payload.productSources.length,6);
 assert.equal(payload.businessSources.length,2);assert.equal(payload.qualitative_sources.length,2);
 assert.deepEqual(new Set(payload.businessSources.map(s=>s.sourceType)),new Set(['shared_xero','shared_google_sheets']));
 assert(payload.businessSources.every(s=>JSON.parse(s.text).scope.entityId.startsWith('00000000-')));
 assert(!all.some(file=>/Authorization|synthetic-evaluation-no-access/.test(file.value)),'headers are not artifacts');
 assert.throws(()=>createEvaluation({outputDir:output()}),/no_live_transport_configured/);negativeCases++;
 assert.throws(()=>createEvaluation({outputDir:first.directory,dispatch}),/EEXIST/);negativeCases++;
 const repo=path.resolve(__dirname,'..');assert.throws(()=>createEvaluation({outputDir:path.join(repo,'never-create-eval-artifacts'),dispatch}),/repository_artifacts_denied/);negativeCases++;
 const symlink=path.join(temporary,'repository-link');fs.symlinkSync(repo,symlink);assert.throws(()=>createEvaluation({outputDir:path.join(symlink,'never-create'),dispatch}),/repository_artifacts_denied/);negativeCases++;
 for(const patch of [{model:'other-model'},{store:true},{stream:true},{tools:[{type:'web_search'}]},{tool_choice:'auto'},{previous_response_id:'other-response'},{background:true},{service_tier:'priority'},{conversation:'hosted'},{max_output_tokens:8001}]){
  assert.throws(()=>checkRequest({url:endpoint,body:JSON.stringify({...request.body,...patch})},1));negativeCases++;
 }
 assert.throws(()=>checkRequest({url:'https://unapproved.invalid/v1/responses',body:JSON.stringify(request.body)},1));negativeCases++;
 assert.throws(()=>checkRequest({url:endpoint,body:JSON.stringify({...request.body,input:[{role:'system',content:'x'.repeat(48001)}]})},1));negativeCases++;
 assert.throws(()=>checkRequest({url:endpoint,body:JSON.stringify(request.body)},2));negativeCases++;
 const syntax=await rejectedReply((reply,request)=>JSON.parse(request.body).text.format.name==='vsi_answer_v1'?{...reply,text:'Synthetic retained response: not valid answer JSON.'}:reply);
 assert.equal(syntax.result.diagnostic.stage,'answer_json');assert.equal(syntax.calls,2);
 assert.equal(JSON.parse(files(syntax.evaluation.directory).find(f=>f.name.endsWith('call-2-generated.json')).value).text,'Synthetic retained response: not valid answer JSON.','retain generated text before validation fails');
 const cause=await rejectedReply((reply,request)=>{if(JSON.parse(request.body).text.format.name!=='vsi_answer_v1')return reply;const value=JSON.parse(reply.text);value.interpretations[0].hypothesis='Invoice balance may cause dispatches.';return{...reply,text:JSON.stringify(value)};});
 assert.equal(cause.result.diagnostic.assertionRule,'causal_language');assert.equal(cause.result.diagnostic.authoredField,'hypothesis');assert.equal(cause.calls,2);
 const citation=await rejectedReply((reply,request)=>{if(JSON.parse(request.body).text.format.name!=='vsi_answer_v1')return reply;const value=JSON.parse(reply.text);value.citationIds.push('B999');return{...reply,text:JSON.stringify(value)};});
 assert.equal(citation.result.diagnostic.reason,'unknown_citation');
 const unsafeKey=['sk','proj','synthetictrap'.repeat(5)].join('-');
 const secretReply=await rejectedReply(reply=>({...reply,text:'Bearer '+unsafeKey}));assert.equal(secretReply.result.failure,'response_guard');assert.equal(secretReply.calls,1);
 assert(!files(secretReply.evaluation.directory).some(f=>f.value.includes(unsafeKey)));
 const broken=createEvaluation({outputDir:output(),dispatch:()=>{throw Error(unsafeKey);}});const failed=await broken.runNext();assert.equal(failed.failure,'transport_failed');assert.equal(broken.snapshot().calls,1);assert.equal(broken.snapshot().reservedUsd,.25);assert(!files(broken.directory).some(f=>f.value.includes(unsafeKey)));negativeCases++;
 const usage=await rejectedReply(reply=>({...reply,usage:{input_tokens:undefined,output_tokens:1}}));assert.equal(usage.result.failure,'response_guard');
 const wrongModel=await rejectedReply(reply=>({...reply,model:'other-model'}));assert.equal(wrongModel.calls,1);
 const rateLimited=await rejectedReply(reply=>({...reply,httpStatus:429}));assert.equal(rateLimited.calls,1);assert.equal(rateLimited.evaluation.snapshot().reservedUsd,.25);
 // A richer synthetic reply exercises the review gate and total budget, not model quality.
 const rich=createEvaluation({outputDir:output(),dispatch:async request=>{const reply=await mockDispatch(request);if(JSON.parse(request.body).text.format.name==='vsi_answer_v1'){
  const value=JSON.parse(reply.text);value.content='Invoice balance observations describe an amount owing, not cash receipts. Dispatch and backlog counts do not identify which invoices they concern. Check the observation window and invoice population against dispatch records before drawing a relationship; the supplied records lack matching and completeness evidence. '+value.content;return{...reply,text:JSON.stringify(value),ignoredHeaders:{Authorization:unsafeKey}};
 }return reply;}});
 const richFirst=await rich.runNext();assert(richFirst.mechanicalPass);assert(rich.review(review(richFirst)));
 const richSecond=await rich.runNext();assert(richSecond.mechanicalPass);assert(rich.review(review(richSecond)));
 assert.equal(rich.snapshot().calls,4);assert.equal(rich.snapshot().reservedUsd,1);assert.equal(rich.snapshot().state,'reviewed_not_real_model_proof');assert.equal(rich.snapshot().realModelQualified,false);
 await assert.rejects(rich.runNext());negativeCases++;assert(!files(rich.directory).some(f=>f.value.includes(unsafeKey)));
 const plan=spawnSync(process.execPath,[path.join(__dirname,'vsi-isolated-contract-evaluation.cjs'),'--plan'],{encoding:'utf8',env:{}});assert.equal(plan.status,0);assert.equal(JSON.parse(plan.stdout).liveExecutionAvailable,false);
 const live=spawnSync(process.execPath,[path.join(__dirname,'vsi-isolated-contract-evaluation.cjs'),'--execute'],{encoding:'utf8',env:{GOOGLE_SHEETS_OPENAI_API_KEY:unsafeKey}});assert.equal(live.status,64);assert(!live.stdout.includes(unsafeKey)&&!live.stderr.includes(unsafeKey));negativeCases++;
 const strippedPath=output(),stripped=spawnSync(process.execPath,[path.join(__dirname,'vsi-isolated-contract-evaluation.cjs'),'--dry-run',strippedPath],{encoding:'utf8',env:{OPENAI_API_KEY:unsafeKey,GOOGLE_SHEETS_OPENAI_API_KEY:unsafeKey,GOOGLE_SHEETS_OPENAI_PROJECT_ID:'must-not-inherit',GOOGLE_SHEETS_OPENAI_ORGANIZATION_ID:'must-not-inherit',DATABASE_URL:'postgresql://must-not-connect.invalid/db',SUPABASE_SERVICE_ROLE_KEY:unsafeKey,NODE_OPTIONS:'--no-warnings'}});
 assert.equal(stripped.status,0);assert.equal(JSON.parse(stripped.stdout).state,'awaiting_manual_review');assert(!files(strippedPath).some(f=>f.value.includes(unsafeKey)||f.value.includes('must-not-inherit')||f.value.includes('must-not-connect')));negativeCases++;
 const parallel=createEvaluation({outputDir:output(),dispatch});const pending=parallel.runNext();await assert.rejects(parallel.runNext(),/parallel_evaluation_denied/);negativeCases++;assert((await pending).mechanicalPass);
 console.log(JSON.stringify({passed:true,syntheticOnly:true,actualEnginePromptSchemaAndValidators:true,privatePreValidationOutputRetention:true,qualityRequiresSeparateManualAssessment:true,genericReviewNotQualityPass:true,twoQuestionsFourCallsOneDollar:true,noLiveCLI:true,noProductionClients:true,noRealModelProof:true,negativeCases,externalCalls:0,artifactDirectory:temporary}));
})().catch(()=>{console.error('isolated_evaluator_safety_test_failed');process.exitCode=1;});
