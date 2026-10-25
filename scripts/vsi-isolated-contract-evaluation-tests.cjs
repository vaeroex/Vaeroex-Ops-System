/* eslint-disable @typescript-eslint/no-require-imports -- Offline evaluator safety tests; all model replies are synthetic. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {candidate,cases,limits,endpoint,checkRequest,createEvaluation,mockDispatch,fixtureForCase}=require('./vsi-isolated-contract-evaluation.cjs');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'vsi-isolated-evaluator-tests-'));fs.chmodSync(temporary,0o700);
let sequence=0,dispatches=0,negativeCases=0;
const output=()=>path.join(temporary,`run-${++sequence}`);
const dispatch=async request=>{dispatches++;return mockDispatch(request);};
const files=dir=>fs.readdirSync(dir).map(name=>({name,value:fs.readFileSync(path.join(dir,name),'utf8')}));
function review(result,meaningful=true){return{kind:'manual',rationale:result.id==='qualified-brief'?'Synthetic test review: the recorded payment-hold status supports a qualified receivables follow-up; the answer must explicitly require invoice/order linkage before allocation. These mocked replies do not prove model usefulness.':'Synthetic test review: the sparse single-day invoice balance and dispatch/backlog counts do not establish a relationship; the answer identifies missing linkage and coverage and withholds causation. This is not model-quality proof.',passage:result.answer.slice(0,90),factsCorrect:true,bothOriginalsSupport:true,uncertaintyPreserved:true,noUnsupportedCausationOrJoin:true,noUnsupportedMath:true,specificMissingEvidenceAndNextCheck:true,meaningfulCrossSourceConnection:meaningful,notMerelySeparateSummaries:meaningful,specificQualifiedFollowUp:meaningful,missingInvoiceOrderLinkageExplicit:meaningful,noBalanceAllocationOrRatio:true,noProfitCashLossOrTrend:true,unsupportedConclusionWithheld:true};}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function checkFixtures(){
 const positive=fixtureForCase('qualified-brief'),sparse=fixtureForCase('unsupported-cause');
 assert.deepEqual(sparse,{captureReferenceId:id(70),raw:[
  {provider:'google_sheets',identity:{kind:'sheets_ticket_source',source_id:id(10),version_id:id(11),authority_hash:'a'.repeat(64)},hash:'a'.repeat(64),data:{provider:'google_sheets',workspace_id:id(1),entity_id:id(30),connection_id:id(31),date:'2026-10-14',time_zone:'UTC',metrics:[{metric:'Synthetic scenario dispatches',value:'6',unit:'count'},{metric:'Synthetic scenario end-of-day backlog',value:'4',unit:'count'}],read_sources:[]}},
  {provider:'xero',identity:{kind:'legacy_binding',binding_id:id(32),start:'2026-10-01',end:'2026-10-30'},hash:'b'.repeat(64),data:{provider:'xero',workspace_id:id(1),entity_id:id(30),connection_id:id(33),scope:'stored synthetic invoice observations',records:[{day:'2026-10-14',metrics:[{key:'outstanding',value:'50',currency:'USD'}]}],read_sources:[]}}
 ]},'sparse values, coverage and original identities are unchanged; key matches stored reporting contract');
 assert.equal(cases[1].question,'Do these explicitly synthetic stored Xero invoice-balance and Google Sheets dispatch/backlog observations establish that unpaid invoices caused delays? Explain what the records support and what information is missing. Cite both originals. Do not invent matching, causation, profit or ratios. Do not search the web.');
 assert.equal(cases[1].expectation,'Withhold unsupported causation, joins and arithmetic; explain specific missing evidence and useful next checks. An empty interpretation list is appropriate when no supported hypothesis fits.');
 assert(!/1200|payment.hold|receivables/i.test(cases[0].question),'neutral question does not supply the expected conclusion');
 assert(positive.raw.every(s=>s.data.entity_id===id(30)&&s.data.workspace_id===id(1)&&s.data.date==='2026-10-14'&&s.data.time_zone==='UTC'&&s.data.coverage==='partial'));
 assert(positive.raw.every(s=>/Invented .*shaped.*14 Oct 2026 17:00 UTC.*partial/.test(s.data.scope)));
 assert.deepEqual(positive.raw[0].data.metrics,[{metric:'orders recorded on payment hold',value:'3',unit:'count'}]);
 assert.deepEqual(positive.raw[1].data.records,[{day:'2026-10-14',metrics:[{key:'outstanding',value:'1200',currency:'USD'}]}]);assert.match(positive.raw[1].data.scope,/as of import/);
 const identities=f=>new Set([f.captureReferenceId,...f.raw.flatMap(s=>[s.identity.source_id,s.identity.version_id,s.identity.binding_id,s.data.connection_id,s.hash].filter(Boolean))]);
 const other=identities(sparse);assert([...identities(positive)].every(value=>!other.has(value)),'case-specific originals, versions, connections and hashes');
 positive.raw[0].data.metrics[0].value='999';positive.raw[1].data.records[0].metrics[0].value='999';sparse.raw[0].data.metrics[0].value='999';
 assert.equal(fixtureForCase('qualified-brief').raw[0].data.metrics[0].value,'3');assert.equal(fixtureForCase('qualified-brief').raw[1].data.records[0].metrics[0].value,'1200');assert.equal(fixtureForCase('unsupported-cause').raw[0].data.metrics[0].value,'6');
 assert.throws(()=>fixtureForCase('unknown-case'),/unknown_fixture_case/);
}
function checkPayloadIsolation(request){
 const body=JSON.parse(request.body),payload=JSON.parse(body.input[1].content),test=cases.find(c=>c.id===request.caseId);assert.equal(payload.question,test.question);
 assert(!request.body.includes(cases.find(c=>c.id!==test.id).question));
 if(body.text.format.name==='vsi_research_plan_v1'){assert.equal(payload.businessSources,undefined);return;}
 const positive=request.caseId==='qualified-brief',sources=payload.businessSources;assert.equal(sources.length,2);assert.equal(payload.qualitative_sources.length,2);
 assert.equal(payload.answerSourceRequirements.groups.length,2);assert.deepEqual(new Set(payload.answerSourceRequirements.groups.flat()),new Set(sources.map(s=>s.id)));assert(payload.answerSourceRequirements.groups.every(group=>group.length===1));
 const text=JSON.stringify([sources,payload.qualitative_sources]);
 if(positive){assert.match(text,/1200 USD/);assert.match(text,/payment hold: 3 count/);assert(!/50 USD|dispatches: 6 count|backlog: 4 count/.test(text));}
 else{assert.match(text,/outstanding: 50 USD/);assert.match(text,/dispatches: 6 count/);assert.match(text,/backlog: 4 count/);assert(!/1200 USD|payment hold/.test(text));}
 const fixture=fixtureForCase(test.id);for(const source of sources){const raw=fixture.raw.find(s=>source.sourceType==='shared_'+s.provider),scope=JSON.parse(source.text).scope;assert.equal(scope.connectionId,raw.data.connection_id);assert.equal(scope.coverage,positive?'partial':'unknown');if(positive){assert.equal(scope.start,'2026-10-14');assert.equal(scope.end,'2026-10-14');assert.equal(scope.timeZone,'UTC');}}
}
async function rejectedReply(change){
 let calls=0;const evaluation=createEvaluation({outputDir:output(),dispatch:async request=>{calls++;const reply=await mockDispatch(request);return change(reply,request);}});
 const result=await evaluation.runNext();assert.equal(result.mechanicalPass,false);assert.equal(evaluation.snapshot().state,'stopped');
 await assert.rejects(evaluation.runNext(),/review_or_stop_required/);negativeCases++;return{evaluation,result,calls};
}
(async()=>{
 assert.equal(candidate,'237068fea3c160cf5ebc90b27c1275aa28cfc4bd');assert.equal(cases.length,2);assert.equal(limits.calls,4);assert.equal(limits.usd,1);
 checkFixtures();
 const first=createEvaluation({outputDir:output(),dispatch});const result=await first.runNext();
 assert.equal(dispatches,2);
 assert(result.mechanicalPass);assert.equal(result.calls,2);assert.equal(first.snapshot().state,'awaiting_manual_review');assert.equal(first.snapshot().realModelQualified,false);
 await assert.rejects(first.runNext(),/review_or_stop_required/);negativeCases++;
 assert.throws(()=>first.review({kind:'model',rationale:'Not a manual review.'}),/manual_review_required/);negativeCases++;
 assert.throws(()=>first.review({kind:'manual',rationale:'x'.repeat(100),passage:result.answer.slice(0,50)}),/complete_review_required/);negativeCases++;
 for(const flag of ['specificQualifiedFollowUp','missingInvoiceOrderLinkageExplicit','noBalanceAllocationOrRatio','noProfitCashLossOrTrend']){const incomplete=review(result);delete incomplete[flag];assert.throws(()=>first.review(incomplete),/complete_review_required/);negativeCases++;}
 assert.equal(first.review(review(result,false)),false,'generic warrant-review wording is insufficient when assessed honestly');
 assert.equal(first.snapshot().state,'stopped');await assert.rejects(first.runNext());negativeCases++;
 const all=files(first.directory);for(const file of all)assert.equal(fs.statSync(path.join(first.directory,file.name)).mode&0o777,0o600);
 const request=JSON.parse(all.find(f=>f.name==='qualified-brief-call-2-request.json').value);
 assert(request.body.input[0].content.length>10000,'actual full engine prompt, not a tiny test substitute');
 assert.match(request.body.input[0].content,/No business-word whitelist applies/);
 assert.equal(request.body.text.format.schema.properties.content,undefined);assert.equal(request.body.text.format.schema.properties.observations.items.properties.factIndex.type,'integer');
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
 const syntax=await rejectedReply((reply,request)=>JSON.parse(request.body).text.format.name==='vsi_shared_answer_v2'?{...reply,text:'Synthetic retained response: not valid answer JSON.'}:reply);
 assert.equal(syntax.result.diagnostic.stage,'answer_json');assert.equal(syntax.calls,2);
 assert.equal(JSON.parse(files(syntax.evaluation.directory).find(f=>f.name.endsWith('call-2-generated.json')).value).text,'Synthetic retained response: not valid answer JSON.','retain generated text before validation fails');
 const cause=await rejectedReply((reply,request)=>{if(JSON.parse(request.body).text.format.name!=='vsi_shared_answer_v2')return reply;const value=JSON.parse(reply.text);value.content='Invoice balance caused dispatches.';return{...reply,text:JSON.stringify(value)};});
 assert.equal(cause.result.diagnostic.stage,'answer_schema');assert.equal(cause.result.diagnostic.reason,'schema_invalid');assert.equal(cause.calls,2);
 const citation=await rejectedReply((reply,request)=>{if(JSON.parse(request.body).text.format.name!=='vsi_shared_answer_v2')return reply;const value=JSON.parse(reply.text);value.observations[0].ref='B999';return{...reply,text:JSON.stringify(value)};});
 assert.equal(citation.result.diagnostic.contractRule,'fact_reference');
 const leakedPremise=await rejectedReply((reply,request)=>{if(JSON.parse(request.body).text.format.name!=='vsi_shared_answer_v2')return reply;const value=JSON.parse(reply.text);value.observations[0].binding=fixtureForCase('unsupported-cause').raw[0].hash;return{...reply,text:JSON.stringify(value)};});
 assert.equal(leakedPremise.result.diagnostic.contractRule,'fact_reference','sparse-case premise is not evidence in the positive case');
 const unsafeKey=['sk','proj','synthetictrap'.repeat(5)].join('-');
 const secretReply=await rejectedReply(reply=>({...reply,text:'Bearer '+unsafeKey}));assert.equal(secretReply.result.failure,'response_guard');assert.equal(secretReply.calls,1);
 assert(!files(secretReply.evaluation.directory).some(f=>f.value.includes(unsafeKey)));
 const broken=createEvaluation({outputDir:output(),dispatch:()=>{throw Error(unsafeKey);}});const failed=await broken.runNext();assert.equal(failed.failure,'transport_failed');assert.equal(broken.snapshot().calls,1);assert.equal(broken.snapshot().reservedUsd,.25);assert(!files(broken.directory).some(f=>f.value.includes(unsafeKey)));negativeCases++;
 const usage=await rejectedReply(reply=>({...reply,usage:{input_tokens:undefined,output_tokens:1}}));assert.equal(usage.result.failure,'response_guard');
 const wrongModel=await rejectedReply(reply=>({...reply,model:'other-model'}));assert.equal(wrongModel.calls,1);
 const rateLimited=await rejectedReply(reply=>({...reply,httpStatus:429}));assert.equal(rateLimited.calls,1);assert.equal(rateLimited.evaluation.snapshot().reservedUsd,.25);
 // A richer synthetic reply exercises the review gate and total budget, not model quality.
 const rich=createEvaluation({outputDir:output(),dispatch:async request=>{checkPayloadIsolation(request);const reply=await mockDispatch(request);if(JSON.parse(request.body).text.format.name==='vsi_shared_answer_v2'){
  const {usefulSharedReply}=require('./vsi-shared-answer-test-support.cjs');const value=usefulSharedReply(JSON.parse(JSON.parse(request.body).input[1].content),request.caseId);return{...reply,text:JSON.stringify(value),ignoredHeaders:{Authorization:unsafeKey}};
 }return reply;}});
 const richFirst=await rich.runNext();assert(richFirst.mechanicalPass);assert(rich.review(review(richFirst)));
 const richSecond=await rich.runNext();assert(richSecond.mechanicalPass);assert(rich.review(review(richSecond)));
 assert(richFirst.citations.every(c=>!richSecond.citations.some(other=>other.sourceId===c.sourceId)),'case citations bind distinct originals');
 assert(!richSecond.answer.includes('payment hold')&&!richSecond.answer.includes('1200'),'no positive-case conclusion leaked into sparse answer');
 assert.equal(rich.snapshot().calls,4);assert.equal(rich.snapshot().reservedUsd,1);assert.equal(rich.snapshot().state,'reviewed_not_real_model_proof');assert.equal(rich.snapshot().realModelQualified,false);
 await assert.rejects(rich.runNext());negativeCases++;assert(!files(rich.directory).some(f=>f.value.includes(unsafeKey)));
 const plan=spawnSync(process.execPath,[path.join(__dirname,'vsi-isolated-contract-evaluation.cjs'),'--plan'],{encoding:'utf8',env:{}});assert.equal(plan.status,0);assert.equal(JSON.parse(plan.stdout).liveExecutionAvailable,false);
 const live=spawnSync(process.execPath,[path.join(__dirname,'vsi-isolated-contract-evaluation.cjs'),'--execute'],{encoding:'utf8',env:{GOOGLE_SHEETS_OPENAI_API_KEY:unsafeKey}});assert.equal(live.status,64);assert(!live.stdout.includes(unsafeKey)&&!live.stderr.includes(unsafeKey));negativeCases++;
 const strippedPath=output(),stripped=spawnSync(process.execPath,[path.join(__dirname,'vsi-isolated-contract-evaluation.cjs'),'--dry-run',strippedPath],{encoding:'utf8',env:{OPENAI_API_KEY:unsafeKey,GOOGLE_SHEETS_OPENAI_API_KEY:unsafeKey,GOOGLE_SHEETS_OPENAI_PROJECT_ID:'must-not-inherit',GOOGLE_SHEETS_OPENAI_ORGANIZATION_ID:'must-not-inherit',DATABASE_URL:'postgresql://must-not-connect.invalid/db',SUPABASE_SERVICE_ROLE_KEY:unsafeKey,NODE_OPTIONS:'--no-warnings'}});
 assert.equal(stripped.status,0);assert.equal(JSON.parse(stripped.stdout).state,'awaiting_manual_review');assert(!files(strippedPath).some(f=>f.value.includes(unsafeKey)||f.value.includes('must-not-inherit')||f.value.includes('must-not-connect')));negativeCases++;
 const parallel=createEvaluation({outputDir:output(),dispatch});const pending=parallel.runNext();await assert.rejects(parallel.runNext(),/parallel_evaluation_denied/);negativeCases++;assert((await pending).mechanicalPass);
 console.log(JSON.stringify({passed:true,syntheticOnly:true,actualEnginePromptSchemaAndValidators:true,caseSpecificFixturesAndCitations:true,sparseValuesQuestionAndLimitationsPreserved:true,storedMetricKeyCorrected:true,positiveFollowUpAndMissingLinkageReviewRequired:true,crossCasePremiseRejected:true,privatePreValidationOutputRetention:true,qualityRequiresSeparateManualAssessment:true,genericReviewNotQualityPass:true,twoQuestionsFourCallsOneDollar:true,noLiveCLI:true,noProductionClients:true,noRealModelProof:true,negativeCases,externalCalls:0,artifactDirectory:temporary}));
})().catch(()=>{console.error('isolated_evaluator_safety_test_failed');process.exitCode=1;});
