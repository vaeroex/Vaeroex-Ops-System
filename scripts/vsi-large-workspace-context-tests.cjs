/* eslint-disable @typescript-eslint/no-require-imports -- Offline synthetic TS harness; every provider and authority transport is mocked. */
const assert=require('node:assert/strict');
const ActualDate=Date;global.Date=class extends ActualDate{constructor(...args){super(...(args.length?args:['2026-10-24T00:00:00.000Z']));}static now(){return new ActualDate('2026-10-24T00:00:00.000Z').getTime();}};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const workspace=id(1),actor=id(2),session=id(3),request=id(4),ticket=id(5),manifest=id(6);
let revoked=false,foreign=false,revokeAfterPlanner=false,providerCalls=0,answerCalls=0;
const events=[];
const sheets=(n,wanted)=>({provider:'google_sheets',identity:{kind:'sheets_ticket_source',source_id:id(100+n),version_id:id(200+n),authority_hash:(n+20).toString(16).padStart(64,'0')},hash:(n+20).toString(16).padStart(64,'0'),data:{provider:'google_sheets',workspace_id:workspace,entity_id:id(wanted?30:90),connection_id:id(wanted?31:91),date:n%2?'2026-10-14':'2026-10-15',metrics:wanted?[{metric:'Synthetic scenario dispatches - hypothetical operations canary',value:'6',unit:'count'},{metric:'Synthetic scenario end-of-day backlog - hypothetical operations canary',value:'4',unit:'count'}]:Array.from({length:4},(_,m)=>({metric:`Legacy warehouse review metric ${m} - prior worksheet operational checklist verification`,value:String(m+1),unit:'count'})),read_sources:[]}});
const raw=[sheets(0,true),{provider:'xero',identity:{kind:'legacy_binding',binding_id:id(32),start:'2026-10-01',end:'2026-10-30'},hash:'b'.repeat(64),data:{provider:'xero',workspace_id:workspace,entity_id:id(30),connection_id:id(33),scope:'stored invoice observations',records:Array.from({length:8},(_,n)=>({day:'2026-10-14',metrics:[{key:'outstanding',value:String(n+1),currency:'USD'}]})),read_sources:[]}},sheets(1,true),...Array.from({length:12},(_,n)=>sheets(n+2,false))];

const reader={auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),getClaims:async()=>({data:{claims:{sub:actor,session_id:session}},error:null})},rpc:async(name,args)=>{
 events.push(name);
 if(name==='discover_shared_evidence_v1')return {data:{stage:'catalog_only',candidates:raw.map(s=>({provider:s.provider,identity:s.identity})),truncated:false},error:null};
 if(name==='read_shared_typed_evidence_v1'||name==='preview_shared_legacy_evidence_v1'){
  const source=structuredClone(name==='read_shared_typed_evidence_v1'?raw.find(row=>row.identity.source_id===args.p_identity.source_id):raw[1]);if(foreign)source.data.workspace_id=id(99);
  return {data:{stage:'unadmitted',resolved:source},error:null};
 }
 if(name==='capture_legacy_evidence_v1')return {data:{reference_id:id(70),source_hash:raw[1].hash},error:null};
 if(name==='shared_evidence_dependencies_v1')return {data:{manifestIds:[],readSources:[]},error:null};
 if(name==='seal_shared_evidence_manifest_v1'){
  assert.equal(args.p_target_id,request);assert.equal(args.p_sources.length,15);
  assert.equal(args.p_sources[1].kind,'legacy_reference');
  return {data:{stage:'database_bound',manifest_id:manifest,provider_policy_required:true},error:null};
 }
 if(name==='validate_shared_evidence_manifest_v1')return {data:!revoked,error:revoked?{code:'42501'}:null};
 throw Error(`unexpected RPC ${name}`);
}};
require('./qbo-customer-test-support.cjs').installLoader({
 'server-only':{},
 '@/lib/ai/shared-evidence/runtime-gate':{sharedEvidenceRuntimeEnabled:()=>true},
 '@/lib/ai/shared-evidence/qualitative-policy':{qualitativeSynthesisEnabled:()=>true},
 './retrieval':{authorizeVsiRead:async()=>({supabase:reader,workspaceId:workspace,user:{id:actor},membership:{role:'owner'},workspace:{id:workspace,name:'Synthetic canary workspace',industry:'Synthetic operations'}}),retrieveVsiEvidence:async()=>{throw Error('legacy fallback forbidden');}},
 './product-context':{loadVsiProductContext:async(access,t)=>require('../lib/vsi/product-context.ts').loadVsiProductContext(access,t)},
 '@/lib/billing/get-subscription-status':{getSubscriptionStatus:async()=>({allowed:true,status:'active',source:'subscription',plan_slug:'vaeroex'})},
 '@/lib/integrations/dashboard/server':{loadIntegrationDashboard:async()=>({loadFailed:false,googleSheetsConnectionIds:[],dashboard:{workspaceId:workspace,observedAt:'2026-10-24T00:00:00Z',timeZone:'UTC',timeZoneConfirmed:true,preferencesAvailable:true,unavailable:[],entries:Array.from({length:4},(_,n)=>({key:`google_sheets:${String(n+1).repeat(64)}`,provider:'Google Sheets',name:`Synthetic saved connection ${n}`,href:'/app/integrations',connectionState:'connected',lastSuccessfulRefreshAt:'2026-10-14T00:00:00Z',currentUntil:'2026-10-24T00:00:00Z',freshness:'current',unchangedCheck:false,cadence:'Manual',results:[],hidden:false}))}})},
 '@/lib/integrations/google-sheets/read-authority':{bindGoogleSheetsRead:async()=>({ticketId:ticket})},
 '@/lib/ai/providers/google-data-policy':{googleSheetsOpenAIHeaders:async()=>({Authorization:'Bearer synthetic-dedicated-key'})},
 '@/lib/supabase/admin':{createSupabaseAdminClient:()=>{throw Error('No memory receipt expected');}}
});
const packing=require('../lib/vsi/answer-context.ts');
const measured=[];
const pack=packing.packVsiAnswerContext;
packing.packVsiAnswerContext=(payload,...args)=>{const result=pack(payload,...args);measured.push({initial:result.initialMetrics,final:result.metrics,canonical:structuredClone(payload.businessSources),canonicalPayload:structuredClone(payload),selected:result.sourceIds});return result;};
const {runVsiAnswer}=require('../lib/vsi/engine.ts');

process.env.VAEROEX_VSI_WORKSPACE_MONTHLY_BUDGET_USD='50';process.env.VAEROEX_VSI_MAX_OUTPUT_TOKENS='6000';process.env.VAEROEX_VSI_REQUEST_RESERVE_USD='0.25';process.env.OPENAI_API_KEY='synthetic-global-unused';process.env.VAEROEX_VSI_MAX_INPUT_CHARS='32000';
let hiddenCitation=false,answerTemplate,answerVariant='valid';
const validationEvents=[];
const budgetEvents=[];
const originalConsoleError=console.error;
const originalConsoleInfo=console.info;
console.error=(...args)=>{if(args[0]==='[vsi-validation]')validationEvents.push(args[1]);else if(args[0]==='[vsi-context-budget]')budgetEvents.push(args[1]);else originalConsoleError(...args);};
console.info=(...args)=>{if(args[0]==='[vsi-context-budget]')budgetEvents.push(args[1]);else originalConsoleInfo(...args);};
global.fetch=async(url,init)=>{
 providerCalls++; const body=JSON.parse(init.body),payload=JSON.parse(body.input[1].content);
 assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(body.store,false);assert.equal(body.model,'gpt-6-luna');assert.equal(body.tools,undefined);assert(init.body.length<=32000,'entire serialized request including schema/envelope/escaping fits');
 assert.equal(init.headers.Authorization,'Bearer synthetic-dedicated-key');
 let output;
 if(body.text.format.name==='vsi_research_plan_v1') {output={mode:'answer',businessEvidence:true,tier:'simple',clarification:'',publicTargets:[],objectives:[]};if(revokeAfterPlanner)revoked=true;}
 else {
  answerCalls++; answerTemplate=structuredClone(body); assert.equal(init.body.length,measured.at(-1).final.requestChars);assert.equal(Buffer.byteLength(init.body,'utf8'),measured.at(-1).final.requestBytes);assert.equal(payload.productSources.length,6,'use actual product producer, not tiny one-source placeholder');
  assert.match(body.input[0].content,/No business-word whitelist applies/);
  assert.equal(body.text.format.name,'vsi_shared_answer_v2');assert.equal(body.text.format.schema.properties.content,undefined);
  assert.equal(payload.contextCoverage.complete,false);assert.equal(payload.businessSources.length,3);
  assert.equal(payload.qualitative_sources.length,3);assert.equal(payload.contextCoverage.omittedSourceGroups,12);
  const rows=payload.businessSources;
  assert.equal(rows.filter(row=>row.sourceType==='shared_xero').length,1);
  assert.equal(rows.filter(row=>row.sourceType==='shared_google_sheets').length,2);
  const relevant=rows.filter(row=>row.sourceType==='shared_xero'||JSON.parse(row.text).scope.entityId===id(30));assert.equal(relevant.length,3);
  const {sharedReply,observationsFor}=require('./vsi-shared-answer-test-support.cjs');
  output=sharedReply(payload);
  if(hiddenCitation){const omitted=measured.at(-1).canonical.find(row=>!measured.at(-1).selected.includes(row.id));output.observations.push({ref:omitted.id,binding:omitted.sourceId,factIndex:0});}
  if(answerVariant==='schema')output.content='Unrestricted factual prose is denied.';
  if(answerVariant==='citation')output.observations[0].ref='B999';
  if(answerVariant==='url')output.next_checks=[{premises:output.observations,text:'Review https://not-issued.invalid/DO_NOT_LOG_SECRET.'}];
  if(answerVariant==='quote')output.observations[0].quote='DO_NOT_LOG_SECRET';
  if(answerVariant==='number')output.hypotheses=[{premises:observationsFor(payload).slice(0,2),text:'These observations explain 123 cases.'}];
  if(answerVariant==='calculation')output.results=['f'.repeat(64)];
  if(answerVariant==='quantitative')output.next_checks=[{premises:output.observations,text:'Review a 50% ratio.'}];
  if(answerVariant==='formatting')output.next_checks=[{premises:output.observations,text:'Review <b>verified findings</b>.'}];
  if(answerVariant==='unobserved_premise')output.next_checks=[{premises:[{...output.observations[0],factIndex:1999}],text:'Inspect the relevant source record.'}];
  if(answerVariant==='source_label')output.observations[0].provider='UNAUTHORIZED_OVERRIDE';
  if(['cause','certainty','record_linkage','negated_certainty'].includes(answerVariant)){
   const text={cause:'These observations may cause changes.',certainty:'These observations prove a conclusion.',record_linkage:'Whether these observations are linked.',negated_certainty:'These observations are not a proven conclusion.'}[answerVariant];
   // Natural prose is rendered only as unverified draft, never a finding.
   output.missing_information=[{premises:output.observations,text}];
  }
  if(['multi_fact','duplicate_premise','same_original','invented_multi_quote'].includes(answerVariant)){
   const xero=payload.qualitative_sources.find(p=>p.ref===rows.find(row=>row.sourceType==='shared_xero').id);
   const sheets=payload.qualitative_sources.find(p=>p.ref===rows.find(row=>row.sourceType==='shared_google_sheets').id);
   const premise=(source,n)=>({ref:source.ref,binding:source.binding,factIndex:n});
   output=sharedReply(payload,{observations:observationsFor(payload)});
   output.observations.push(premise(xero,1),premise(sheets,1));
   output.hypotheses=[{premises:[premise(xero,0),premise(xero,1),premise(sheets,0),premise(sheets,1)],text:'Invoice balance may warrant review alongside dispatches and backlog; shared dates do not establish matched transactions.'}];
   if(answerVariant==='duplicate_premise')output.hypotheses[0].premises[1]=premise(xero,0);
   if(answerVariant==='same_original')output.hypotheses[0].premises=[premise(xero,0),premise(xero,1)];
   if(answerVariant==='invented_multi_quote')output.observations[0].factIndex=1999;
  }

 }
 return new Response(JSON.stringify({model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:20},output_text:answerVariant==='json'&&body.text.format.name==='vsi_shared_answer_v2'?'DO_NOT_LOG_SECRET invalid JSON':JSON.stringify(output)}),{status:200});
};
const input={supabase:reader,workspaceId:workspace,actorUserId:actor,readTicket:{ticketId:ticket},question:'Using only stored Xero evidence and synthetic Google Sheets dispatch and backlog operations canary observations, give a hypothetical executive brief. Do not search the web.',recentMessages:[],requestId:id(7),reservedRequest:{id:request,attempt:1}};
(async()=>{
 const result=await runVsiAnswer(input);assert.equal(result.citations.length,3);assert.equal(providerCalls,2);assert.equal(answerCalls,1);
 const metrics=measured.at(-1);assert(metrics.initial.requestChars>32000);assert(metrics.final.requestChars<=32000);for(const m of [metrics.initial,metrics.final])assert.equal(m.contextChars+m.systemChars+m.inputFramingAndEscapingChars+m.schemaAndOutputFormatChars+m.otherRequestEnvelopeChars,m.requestChars);
 assert.match(result.content,/^Coverage: This is a partial review/);
 assert(budgetEvents.length>=2);for(const diagnostic of budgetEvents){assert.equal(diagnostic.maxChars,32000);assert.equal(diagnostic.maxBytes,192000);assert.equal(diagnostic.charUnit,'javascript_utf16_code_units');assert.equal(diagnostic.byteUnit,'utf8');}
 answerVariant='multi_fact';const beforeMultiCalls=providerCalls,beforeMultiErrors=validationEvents.length;
 const multiFactAnswer=await runVsiAnswer(input);
 assert.equal(providerCalls-beforeMultiCalls,2);assert.equal(validationEvents.length,beforeMultiErrors);
 assert.equal(multiFactAnswer.citations.length,3,'all selected originals remain cited; the hypothesis uses two independent originals');
 assert.deepEqual(new Set(multiFactAnswer.citations.map(c=>c.sourceType)),new Set(['shared_xero','shared_google_sheets']));
 for(const citation of multiFactAnswer.citations){const original=metrics.canonical.find(source=>source.sourceId===citation.sourceId);assert(original);assert.equal(citation.url,original.url);assert.equal(citation.snapshotHash,original.snapshotHash);}
 assert.match(multiFactAnswer.content,/Hypothesis \(unverified model draft\)/);
 assert.equal((multiFactAnswer.content.match(/Stored observation —/g)||[]).length,5);
 for(const [variant,stage,reason,contractRule]of[
  ['json','answer_json','malformed_json'],['schema','answer_schema','schema_invalid'],
  ['citation','shared_answer_contract','shared_answer_contract_denied','fact_reference'],
  ['url','shared_answer_contract','shared_answer_contract_denied','draft_format'],
  ['quote','answer_schema','schema_invalid'],
  ['number','shared_answer_contract','shared_answer_contract_denied','numeric_draft'],
  ['calculation','shared_answer_contract','shared_answer_contract_denied','result_reference'],
  ['quantitative','shared_answer_contract','shared_answer_contract_denied','numeric_draft'],
  ['formatting','shared_answer_contract','shared_answer_contract_denied','draft_format'],
  ['unobserved_premise','shared_answer_contract','shared_answer_contract_denied','draft_support'],
  ['source_label','answer_schema','schema_invalid'],
  ['duplicate_premise','shared_answer_contract','shared_answer_contract_denied','draft_support'],
  ['same_original','shared_answer_contract','shared_answer_contract_denied','independent_sources'],
  ['invented_multi_quote','shared_answer_contract','shared_answer_contract_denied','fact_reference']]){
  answerVariant=variant;const before=validationEvents.length,calls=providerCalls;
  await assert.rejects(runVsiAnswer(input),error=>{
   assert.equal(error.usage.validationFailure.stage,stage);assert.equal(error.usage.validationFailure.reason,reason);
   assert.equal(error.usage.validationFailure.contractRule,contractRule);
   assert.equal(error.usage.outcomeFailure,stage.startsWith('answer_')?'output_validation':'citation_validation');return true;
  });
  assert.equal(providerCalls-calls,2,'one planner and answer, no generation retry');assert.equal(validationEvents.length,before+1);
  assert.doesNotMatch(JSON.stringify(validationEvents.at(-1)),/DO_NOT_LOG_SECRET|https:|00000000|[a-f0-9]{64}/);
 }
 for(const variant of ['cause','certainty','record_linkage','negated_certainty']){
  answerVariant=variant;const draftAnswer=await runVsiAnswer(input);assert.match(draftAnswer.content,/Missing information \/ limitation \(model assessment\)/);
  assert(!draftAnswer.content.includes('Verified finding:'));const manualSemanticApproval=false;assert.equal(manualSemanticApproval,false,'mechanical prose acceptance is not usefulness or grounding proof');
 }
 answerVariant='valid';
 const {pluginProviders}=require('../lib/ai/shared-evidence/contracts.ts');
 const wire=json=>packing.serializeVsiProviderRequest({...answerTemplate,input:[answerTemplate.input[0],{role:'user',content:json}]},6000);
 const options={selectRelevant:true,requestJSON:wire,maxBytes:192000};
 const original=JSON.stringify(metrics.canonicalPayload);
 const required=structuredClone(metrics.canonicalPayload);required.sharedRelationships.push({fact:'Issued dependency boundary.',inputSourceIds:[required.businessSources.find(s=>s.sourceType==='shared_xero').sourceId,required.businessSources.find(s=>JSON.parse(s.text).scope.entityId===id(90)).sourceId]});
 assert.throws(()=>packing.packVsiAnswerContext(required,answerTemplate.input[0].content,32000,options),packing.VsiAnswerContextLimit,'dependency closure cannot be split to fit');
 assert.equal(JSON.stringify(metrics.canonicalPayload),original,'selection never changes canonical payload');
 const historyDependency=structuredClone(metrics.canonicalPayload);historyDependency.historicalSources=[historyDependency.businessSources.find(s=>JSON.parse(s.text).scope.entityId===id(90))];assert.throws(()=>packing.packVsiAnswerContext(historyDependency,answerTemplate.input[0].content,32000,options),packing.VsiAnswerContextLimit,'retained historical citation requires its whole original scope; cannot evade selection by a history alias');
 const all={...metrics.canonicalPayload,question:'Review stored observations.',sharedRelationships:[],businessSources:[],qualitative_sources:[]};
 for(const [n,provider] of pluginProviders.entries()){
  const binding=(n+100).toString(16).padStart(64,'0'),facts=[`Complete ${provider} source observation; coverage is unknown.`],source={...metrics.canonical[0],id:`B${n+100}`,sourceType:`shared_${provider}`,sourceId:binding,text:JSON.stringify({scope:{entityId:id(30),entityBinding:'protected',connectionId:id(n+500)},observations:facts})};
  all.businessSources.push(source);all.qualitative_sources.push({ref:source.id,binding,dependencies:[binding],facts,reported:false,environment:'production'});
 }
 const allPacked=packing.packVsiAnswerContext(all,answerTemplate.input[0].content,48000,options);assert.equal(allPacked.sourceIds.length,12);assert.equal(allPacked.metrics.omittedSourceGroups,0,'no five/ten-provider cap');
 const unicode=structuredClone(all);unicode.businessSources[0].text=unicode.businessSources[0].text.replace('Complete','😀 Complete');unicode.qualitative_sources[0].facts[0]='😀 '+unicode.qualitative_sources[0].facts[0];
 const unicodePacked=packing.packVsiAnswerContext(unicode,answerTemplate.input[0].content,48000,options);assert(unicodePacked.metrics.requestBytes>unicodePacked.metrics.requestChars);
 assert.throws(()=>packing.packVsiAnswerContext(unicode,answerTemplate.input[0].content,48000,{...options,maxBytes:unicodePacked.metrics.requestChars}),packing.VsiAnswerContextLimit,'UTF8 wire byte budget enforced separately');

 for(const source of metrics.canonical.filter(row=>metrics.selected.includes(row.id))){const saved=result.citations.find(row=>row.sourceId===source.sourceId);assert(saved);assert.equal(saved.url,source.url);assert.equal(saved.snapshotHash,source.snapshotHash);}
 hiddenCitation=true;await assert.rejects(runVsiAnswer(input),e=>e.usage.outcomeFailure==='citation_validation');hiddenCitation=false;
 providerCalls=0;await assert.rejects(runVsiAnswer({...input,question:'Using stored Xero and Google Sheets evidence, give an executive brief.'}),e=>e.usage.outcomeFailure==='context_block');assert.equal(providerCalls,0,'tied unidentified source scopes cannot be chosen arbitrarily');
 providerCalls=0;await assert.rejects(runVsiAnswer({...input,question:input.question+' Also include stored QuickBooks evidence.'}),e=>e.usage.outcomeFailure==='evidence_unavailable');assert.equal(providerCalls,0,'required missing provider stops before planner');
 for(const kind of ['revoked','foreign']){providerCalls=0;revoked=kind==='revoked';foreign=kind==='foreign';await assert.rejects(runVsiAnswer(input));assert.equal(providerCalls,0);}revoked=false;foreign=false;
 providerCalls=0;revokeAfterPlanner=true;await assert.rejects(runVsiAnswer(input),e=>e.usage.outcomeFailure==='evidence_unavailable');assert.equal(providerCalls,1);revokeAfterPlanner=false;revoked=false;
 providerCalls=0;await assert.rejects(runVsiAnswer({...input,contextSummary:'Required private conversation context. '.repeat(300),recentMessages:Array.from({length:8},(_,n)=>({role:n%2?'assistant':'user',content:'Earlier business context. '.repeat(220)}))}),e=>e.usage.outcomeFailure==='context_block');assert.equal(providerCalls,0,'unfit required context denied before any paid planner');
 console.log(JSON.stringify({passed:true,fixture:'synthetic mixed-source workspace with full product producer and request envelope',synthetic:true,initial:metrics.initial,final:metrics.final,requiredOriginalsRetained:true,canonicalManifestSourceCount:15,omittedCitationRejected:true,wrongWorkspaceAndRevocationDenied:true,unfitBeforeAnyProvider:true,allTwelveRetained:true,dependencyClosureAndAmbiguityDenials:true,historicalDependencyRequired:true,fullWireBytesChecked:true,coverageDisclosed:true,multiFactTwoOriginalInterpretation:true,validationStageCases:14,semanticDraftBoundaryCases:4,authoredContractInPromptAndSchema:true,contentFreeDiagnostics:true,externalCalls:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
