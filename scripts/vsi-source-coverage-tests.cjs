/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic-only hosted-shape regression; no external transport or database. */
const assert=require('node:assert/strict');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const workspace=id(1),actor=id(2),session=id(3),request=id(4),manifest=id(6);
const sheet=(n,kind)=>({provider:'google_sheets',identity:{kind:'sheets_ticket_source',source_id:id(100+n),version_id:id(200+n)},hash:(n+20).toString(16).padStart(64,'0'),data:{provider:'google_sheets',workspace_id:workspace,entity_id:id(kind==='wanted'?30:90),connection_id:id(kind==='wanted'?31:kind==='large'?91:300+n),date:n%2?'2026-10-14':'2026-10-15',time_zone:'UTC',metrics:kind==='wanted'?[{metric:'Explicitly synthetic dispatch/backlog operations canary dispatches',value:'6',unit:'count'},{metric:'Explicitly synthetic end-of-day backlog',value:'4',unit:'count'}]:kind==='large'?Array.from({length:6},(_,m)=>({metric:`Unrelated archived worksheet ${m} ${'synthetic warehouse context '.repeat(4)}`,value:String(m+1),unit:'count'})):[{metric:'Unrelated optional worksheet observation',value:'2',unit:'count'}],read_sources:[]}});
const raw=[sheet(0,'wanted'),{provider:'xero',identity:{kind:'legacy_binding',binding_id:id(32),start:'2026-10-01',end:'2026-10-30'},hash:'b'.repeat(64),data:{provider:'xero',workspace_id:workspace,entity_id:id(30),connection_id:id(33),scope:'Synthetic stored invoice observations',records:[{day:'2026-10-14',metrics:[{key:'invoice balance',value:'50',currency:'USD'}]}],read_sources:[]}},sheet(1,'wanted'),...Array.from({length:4},(_,n)=>sheet(n+2,'optional')),...Array.from({length:8},(_,n)=>sheet(n+6,'large'))];
let mode='subset',revoked=false,foreign=false,revokeAfterPlanner=false,calls=0,answerCalls=0;
const reader={auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),getClaims:async()=>({data:{claims:{sub:actor,session_id:session}},error:null})},rpc:async(name,args)=>{
 assert.equal(args.p_workspace_id,workspace);
 if(name==='discover_shared_evidence_v1')return{data:{stage:'catalog_only',candidates:raw.map(s=>({provider:s.provider,identity:s.identity})),truncated:false},error:null};
 if(name==='read_shared_typed_evidence_v1'||name==='preview_shared_legacy_evidence_v1'){const source=structuredClone(name==='read_shared_typed_evidence_v1'?raw.find(s=>s.identity.source_id===args.p_identity.source_id):raw[1]);if(foreign)source.data.workspace_id=id(999);return{data:{stage:'unadmitted',resolved:source},error:null};}
 if(name==='capture_legacy_evidence_v1')return{data:{reference_id:id(70),source_hash:raw[1].hash},error:null};
 if(name==='shared_evidence_dependencies_v1')return{data:{manifestIds:[],readSources:[]},error:null};
 if(name==='seal_shared_evidence_manifest_v1'){assert.equal(args.p_target_id,request);assert.equal(args.p_sources.length,15);return{data:{stage:'database_bound',manifest_id:manifest,provider_policy_required:true},error:null};}
 if(name==='validate_shared_evidence_manifest_v1')return{data:!revoked,error:null};
 throw Error('unexpected_mock_rpc');
}};
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{},
 '@/lib/ai/shared-evidence/runtime-gate':{sharedEvidenceRuntimeEnabled:()=>true},'@/lib/ai/shared-evidence/qualitative-policy':{qualitativeSynthesisEnabled:()=>true},
 './retrieval':{authorizeVsiRead:async()=>({supabase:reader,workspaceId:workspace,user:{id:actor},membership:{role:'owner'},workspace:{id:workspace,name:'Synthetic workspace',industry:'Synthetic operations'}}),retrieveVsiEvidence:async()=>{throw Error('legacy_fallback_denied');}},
 '@/lib/billing/get-subscription-status':{getSubscriptionStatus:async()=>({allowed:true,status:'active',source:'subscription',plan_slug:'vaeroex'})},
 '@/lib/integrations/dashboard/server':{loadIntegrationDashboard:async()=>({loadFailed:false,googleSheetsConnectionIds:[],dashboard:{workspaceId:workspace,observedAt:'2026-10-24T00:00:00Z',timeZone:'UTC',timeZoneConfirmed:true,preferencesAvailable:true,unavailable:[],entries:[]}})},
 '@/lib/integrations/google-sheets/read-authority':{bindGoogleSheetsRead:async()=>({ticketId:id(5)})},
 '@/lib/ai/providers/google-data-policy':{googleSheetsOpenAIHeaders:async()=>({Authorization:'Bearer synthetic-no-access'})},
 '@/lib/supabase/admin':{createSupabaseAdminClient:()=>{throw Error('production_client_denied');}}
});
const packing=require('../lib/vsi/answer-context.ts'),contract=require('../lib/ai/shared-evidence/answer-contract.ts');
const {renderSharedAnswer,issueAnswerResults}=contract,pack=packing.packVsiAnswerContext;
const packRecords=[],renderRecords=[];
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};
packing.packVsiAnswerContext=(payload,...args)=>{
 const before=JSON.stringify(payload),result=pack(payload,...args);
 assert.equal(JSON.stringify(payload),before,'packing must not change canonical refs, bindings, facts or snapshots');
 packRecords.push(freeze({canonical:JSON.parse(before),packed:JSON.parse(result.json),sourceIds:[...result.sourceIds]}));return result;
};
contract.renderSharedAnswer=(value,context)=>{renderRecords.push({value:structuredClone(value),context:structuredClone(context)});return renderSharedAnswer(value,context);};
const {runVsiAnswer}=require('../lib/vsi/engine.ts');
const {vsiAnswerCoverageGroups}=require('../lib/vsi/context-selection.ts');
const ActualDate=Date;global.Date=class extends ActualDate{constructor(...args){super(...(args.length?args:['2026-10-24T00:00:00Z']));}static now(){return new ActualDate('2026-10-24T00:00:00Z').getTime();}};
process.env.VAEROEX_VSI_MAX_INPUT_CHARS='48000';process.env.VAEROEX_VSI_MAX_OUTPUT_TOKENS='6000';
const budgets=[],diagnostics=[];console.info=(tag,value)=>{if(tag==='[vsi-context-budget]')budgets.push(value);};console.error=(tag,value)=>{if(tag==='[vsi-validation]')diagnostics.push(value);};
let captured,fullReply,selectedSources,expectedPacked=7;
global.fetch=async(url,init)=>{
 calls++;assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init.body),payload=JSON.parse(body.input[1].content);assert.equal(body.store,false);assert.equal(body.model,'gpt-6-luna');assert.equal(body.tools,undefined);assert(init.body.length<=48000);assert(Buffer.byteLength(init.body,'utf8')<=192000);
 if(body.text.format.name==='vsi_research_plan_v1'){if(revokeAfterPlanner)revoked=true;return new Response(JSON.stringify({model:body.model,status:'completed',usage:{input_tokens:10,output_tokens:10},output_text:JSON.stringify({mode:'answer',businessEvidence:true,tier:'simple',clarification:'',publicTargets:[],objectives:[]})}),{status:200});}
 answerCalls++;captured=payload;assert.equal(payload.businessSources.length,expectedPacked);assert.equal(payload.qualitative_sources.length,expectedPacked);assert.equal(payload.productSources.length,6);assert.equal(payload.answerSourceRequirements.groups.length,2);
 assert.match(body.input[0].content,/Historical conversation and source snapshots provide dialogue context only/);
 assert.match(body.input[0].content,/currently issued in qualitative_sources or contextFactSources/);
 assert.doesNotMatch(body.input[0].content,/You may explain prior research using the attached historical web source snapshots/);
 const sources=payload.qualitative_sources,sourceFor=hash=>sources.find(s=>s.binding===hash);
 const pick=(source,pattern)=>({ref:source.ref,binding:source.binding,factIndex:Math.max(0,source.facts.findIndex(f=>pattern.test(f)))});
 const xero=pick(sourceFor(raw[1].hash),/invoice balance/),sheetA=pick(sourceFor(raw[0].hash),/dispatches/),sheetB=pick(sourceFor(raw[2].hash),/dispatches/),other=pick(sourceFor(raw[3].hash),/worksheet/);
 const observations=mode==='missing_xero'?[sheetA]:mode==='wrong_sheet'?[xero,other]:mode==='second_date'?[xero,sheetB]:mode==='all'?sources.map(s=>pick(s,/.*/)):[xero,sheetA];
 const answer={observations,results:[],hypotheses:[],missing_information:[{premises:observations,text:'These observations have limited supplied coverage and do not establish invoice/order correspondence or a billing-to-operations relationship.'}],next_checks:[{premises:observations,text:'Check a common observation window, population coverage and existing invoice/order references before making a comparison.'}]};
 fullReply=structuredClone(answer);selectedSources=structuredClone(sources);
 if(mode==='bad_binding')answer.observations[0].binding='f'.repeat(64);
 if(mode==='wrong_binding')answer.observations[0].binding=answer.observations[1].binding;
 if(mode==='snapshot_binding')answer.observations[0].binding=payload.businessSources.find(s=>s.id===answer.observations[0].ref).snapshotHash;
 if(mode==='prefixed_binding')answer.observations[0].binding=`sha256:${answer.observations[0].binding}`;
 if(mode==='bad_index')answer.observations[0].factIndex=sources.find(s=>s.ref===answer.observations[0].ref).facts.length;
 if(mode==='unknown_ref')answer.observations[0].ref='B999';
 if(mode==='omitted_ref'){const omitted=packRecords.at(-1).canonical.qualitative_sources.find(s=>!sources.some(selected=>selected.ref===s.ref));assert(omitted);answer.observations.push({ref:omitted.ref,binding:omitted.binding,factIndex:0});}
 if(mode==='historical_ref'){const historical=payload.historicalSources.find(s=>s.sourceType==='web');assert(historical);assert(!payload.contextFactSources.some(s=>s.ref===historical.id));answer.observations.push({ref:historical.id,binding:'a'.repeat(64),factIndex:0});}
 if(mode==='unobserved_premise')answer.next_checks[0].premises=[other];
 return new Response(JSON.stringify({model:body.model,status:'completed',usage:{input_tokens:100,output_tokens:30},output_text:JSON.stringify(answer)}),{status:200});
};
const input={supabase:reader,workspaceId:workspace,actorUserId:actor,readTicket:{ticketId:id(5)},question:'Use stored Xero and explicitly synthetic Google Sheets dispatch/backlog operations canary observations for a hypothetical executive brief. No web research.',recentMessages:[],requestId:id(7),reservedRequest:{id:request,attempt:1}};
(async()=>{
 const canonical=JSON.stringify(raw),answer=await runVsiAnswer(input);assert.equal(calls,2);assert.equal(answerCalls,1);assert.equal(answer.citations.length,2);assert.match(answer.content,/^Coverage: This is a partial review/);assert.match(answer.content,/invoice.balance.*50 USD/);assert.match(answer.content,/dispatches.*6 count/);assert.match(answer.content,/not establish invoice\/order correspondence/);assert.equal(JSON.stringify(raw),canonical);
 const measurement=budgets.at(-1);assert.equal(measurement.initial.sourceGroups,15);assert.equal(measurement.final.selectedSourceGroups,7);assert(measurement.initial.requestChars>48000);assert(measurement.final.requestChars<=48000);
 const groups=captured.answerSourceRequirements.groups;assert.deepEqual(groups.map(g=>g.length).sort(),[1,2]);
 // Use the actual engine's prepack payload, transmitted JSON and renderer context.
 // Every selectable fact must retain the same source-local position throughout.
 const trace=packRecords.at(-1),renderContext=renderRecords.at(-1).context,baselineObservations=structuredClone(fullReply.observations);
 assert.deepEqual(trace.packed,captured);assert.equal(trace.canonical.businessSources.length,15);assert.equal(renderContext.sources.length,13);
 assert.deepEqual(renderContext.requiredSourceGroups,captured.answerSourceRequirements.groups);
 assert.deepEqual(trace.sourceIds,captured.businessSources.map(s=>s.id));
 assert.deepEqual(trace.canonical.productSources,captured.productSources);
 assert.deepEqual(trace.canonical.contextFactSources,captured.contextFactSources);
 const key=selection=>JSON.stringify([selection.ref,selection.binding,selection.factIndex]);
 const probeAnswer=selection=>({observations:[...baselineObservations.filter(s=>key(s)!==key(selection)),selection],results:[],hypotheses:[],missing_information:[],next_checks:[]});
 let businessFactsProbed=0,productFactsProbed=0,referenceRejections=0;
 const rejectSelection=(selection,reason,bindingMatchesOtherSource)=>{
  assert.throws(()=>renderSharedAnswer(probeAnswer(selection),renderContext),error=>{
   assert.equal(error.rule,'fact_reference');assert.deepEqual(error.factReference,{reason,...(reason==='binding_mismatch'?{bindingMatchesOtherSource}:{})});return true;
  });referenceRejections++;
 };
 for(const source of captured.qualitative_sources){
  const canonicalSource=trace.canonical.qualitative_sources.find(s=>s.ref===source.ref),canonicalCitation=trace.canonical.businessSources.find(s=>s.id===source.ref),transportCitation=captured.businessSources.find(s=>s.id===source.ref),renderSource=renderContext.sources.find(s=>s.ref===source.ref);
  assert(canonicalSource&&canonicalCitation&&transportCitation&&renderSource);
  assert.deepEqual(source,canonicalSource);assert.deepEqual(renderSource,canonicalSource);
  assert.equal(source.binding,canonicalCitation.sourceId);assert.deepEqual(source.facts,JSON.parse(canonicalCitation.text).observations);
  for(const field of ['id','sourceId','snapshotHash','url'])assert.equal(transportCitation[field],canonicalCitation[field]);
  const record=JSON.parse(transportCitation.text);if(record.observationsRef)assert.equal(record.observationsRef,source.ref);else assert.deepEqual(record.observations,source.facts);
  for(let factIndex=0;factIndex<source.facts.length;factIndex++){
   const selection={ref:source.ref,binding:source.binding,factIndex};assert(renderSharedAnswer(probeAnswer(selection),renderContext).citationIds.includes(source.ref));businessFactsProbed++;
  }
 }
 assert.equal(captured.contextFactSources.length,6);
 for(const issued of captured.contextFactSources){
  const product=captured.productSources.find(s=>s.id===issued.ref),renderSource=renderContext.sources.find(s=>s.ref===issued.ref);assert(product&&renderSource);
  assert.equal(issued.factCount,1);assert.equal(renderSource.binding,issued.binding);assert.deepEqual(renderSource.facts,[product.text]);assert.equal(renderSource.supportOnly,true);
  assert(renderSharedAnswer(probeAnswer({ref:issued.ref,binding:issued.binding,factIndex:0}),renderContext).citationIds.includes(issued.ref));productFactsProbed++;
 }
 const omitted=trace.canonical.qualitative_sources.filter(s=>!captured.qualitative_sources.some(selected=>selected.ref===s.ref));assert.equal(omitted.length,8);
 for(const source of omitted)rejectSelection({ref:source.ref,binding:source.binding,factIndex:0},'unknown_ref');
 for(const source of renderContext.sources){
  const citation=[...captured.businessSources,...captured.productSources].find(s=>s.id===source.ref),other=renderContext.sources.find(s=>s.binding!==source.binding);assert(citation&&other);assert.match(citation.snapshotHash,/^[a-f0-9]{64}$/);assert.notEqual(citation.snapshotHash,source.binding);
  rejectSelection({ref:source.ref,binding:citation.snapshotHash,factIndex:0},'binding_mismatch',renderContext.sources.some(s=>s!==source&&s.binding===citation.snapshotHash));
  rejectSelection({ref:source.ref,binding:other.binding,factIndex:0},'binding_mismatch',true);
  rejectSelection({ref:source.ref,binding:source.binding,factIndex:source.facts.length},'fact_index_out_of_bounds');
 }
 // Reproduce the old contract with exactly the same valid, selectively cited answer.
 assert.throws(()=>renderSharedAnswer(fullReply,{sources:selectedSources,results:[],hypothesesEnabled:true,requiredRefs:selectedSources.map(s=>s.ref)}),e=>e.rule==='source_coverage');
 for(const [variant,rule] of [['missing_xero','source_coverage'],['wrong_sheet','source_coverage'],['unobserved_premise','draft_support']]){mode=variant;await assert.rejects(runVsiAnswer(input),e=>e.usage.validationFailure.contractRule===rule);}
 const coverage=diagnostics.filter(d=>d.contractRule==='source_coverage');assert.equal(coverage.length,2);for(const d of coverage){assert.equal(d.coverage.requiredGroups,2);assert.equal(d.coverage.missingGroups,1);assert.equal(d.coverage.availableReferences,13);assert(!JSON.stringify(d).includes('source_id'));}
 let engineReferenceCases=0;
 for(const [variant,reason,bindingMatchesOtherSource]of [['bad_binding','binding_mismatch',false],['wrong_binding','binding_mismatch',true],['snapshot_binding','binding_mismatch',false],['bad_index','fact_index_out_of_bounds'],['unknown_ref','unknown_ref'],['omitted_ref','unknown_ref'],['historical_ref','unknown_ref']]){
  mode=variant;const beforeCalls=calls,beforeDiagnostics=diagnostics.length;
  const runInput=variant==='historical_ref'?{...input,recentMessages:[{role:'assistant',content:'Earlier public context [W1].',citations:[{id:'W1',title:'Earlier public source',url:'https://example.org/prior-research',sourceType:'web',sourceId:null,evidenceDate:null,retrievedAt:'2026-10-01T00:00:00Z'}]}]}:input;
  await assert.rejects(runVsiAnswer(runInput),error=>{
   assert.equal(error.usage.validationFailure.stage,'shared_answer_contract');assert.equal(error.usage.validationFailure.contractRule,'fact_reference');
   assert.deepEqual(error.usage.validationFailure.factReference,{reason,...(reason==='binding_mismatch'?{bindingMatchesOtherSource}:{})});return true;
  });assert.equal(calls-beforeCalls,2);assert.equal(diagnostics.length-beforeDiagnostics,1);assert.doesNotMatch(JSON.stringify(diagnostics.at(-1)),/https:|[a-f0-9]{64}|"ref"|"binding"/);engineReferenceCases++;
 }
 mode='prefixed_binding';const beforePrefixCalls=calls,beforePrefixRenders=renderRecords.length;
 await assert.rejects(runVsiAnswer(input),error=>{assert.equal(error.usage.validationFailure.stage,'answer_schema');assert.equal(error.usage.validationFailure.reason,'schema_invalid');assert.equal(error.usage.validationFailure.factReference,undefined);return true;});
 assert.equal(calls-beforePrefixCalls,2);assert.equal(renderRecords.length,beforePrefixRenders,'prefixed bindings must be rejected before shared rendering');
 mode='second_date';assert.equal((await runVsiAnswer(input)).citations.length,2);mode='all';assert.equal((await runVsiAnswer(input)).citations.length,7);
 // Source-group intent is distinct from joined packing dependencies and optional context.
 const business=captured.businessSources,hashes=business.map(s=>s.sourceId),joined=vsiAnswerCoverageGroups(business,[{inputSourceIds:hashes}],input.question);assert(joined.length>=2);assert(joined.every(g=>new Set(g.map(ref=>business.find(s=>s.id===ref).sourceType)).size===1));
 const ambiguous=vsiAnswerCoverageGroups(business,[],'Use stored Xero and Google Sheets evidence.');assert(ambiguous.length>2,'tied unrelated scopes cannot silently stand in for a requested scope');
 const exact=captured.qualitative_sources.map(s=>({...s,ref:s.ref}));const observations=exact.map(s=>({ref:s.ref,binding:s.binding,factIndex:0}));
 for(const group of [[],['B_NOT_ISSUED']])assert.throws(()=>renderSharedAnswer({observations,results:[],hypotheses:[],missing_information:[],next_checks:[]},{sources:exact,results:[],hypothesesEnabled:true,requiredSourceGroups:[group]}),e=>e.rule==='context_reference');
 assert.throws(()=>renderSharedAnswer({observations:observations.slice(0,1),results:[],hypotheses:[],missing_information:[],next_checks:[]},{sources:exact,results:[],hypothesesEnabled:true,requiredSourceGroups:[[exact[0].ref]],requiredRefs:[exact[1].ref]}),e=>e.rule==='source_coverage','group coverage cannot override an explicit exact-reference requirement');
 const issued=issueAnswerResults([{fact:'Synthetic issued result.',inputSourceIds:[exact[0].binding,exact[1].binding]}])[0];
 assert.throws(()=>renderSharedAnswer({observations:observations.slice(0,1),results:[issued.id],hypotheses:[],missing_information:[],next_checks:[]},{sources:exact,results:[issued],hypothesesEnabled:true,requiredSourceGroups:[[exact[0].ref]]}),e=>e.rule==='result_dependencies');
 // An answer is still partial when every available original fits in the input,
 // but only the relevant observations are actually selected for the answer.
 for(const source of raw.slice(7)){source.data.metrics=[{metric:'Unrelated archived worksheet',value:'1',unit:'count'}];source.hash=require('node:crypto').createHash('sha256').update(JSON.stringify({identity:source.identity,data:source.data})).digest('hex');}
 expectedPacked=15;mode='subset';const allAvailable=await runVsiAnswer(input);assert.equal(allAvailable.citations.length,2);assert.equal(captured.contextCoverage,undefined);assert.match(allAvailable.content,/^Coverage: This is a partial review/);
 for(const condition of ['foreign','revoked','revoked_after_plan']){mode='subset';foreign=condition==='foreign';revoked=condition==='revoked';revokeAfterPlanner=condition==='revoked_after_plan';calls=0;await assert.rejects(runVsiAnswer(input));assert.equal(calls,condition==='revoked_after_plan'?1:0);}foreign=false;revoked=false;revokeAfterPlanner=false;
 console.log(JSON.stringify({passed:true,canonicalOriginals:15,packedOriginals:7,intendedCoverageGroups:2,sheetsRowsInRequiredScope:2,subsetCitations:2,businessFactsProbed,productFactsProbed,referenceRejections,engineReferenceCases,prefixedBindingsRejectedAtSchema:true,canonicalTransportRendererMappingPreserved:true,historicalOnlyReferenceDenied:true,oldRuleFailureReproduced:true,secondRowAndOptionalSourcesNeedNotBecomeClaims:true,wrongConnectionCannotSatisfyIntent:true,missingProviderAndFabricatedBindingDenied:true,unobservedPremiseAndMissingCalculationInputDenied:true,tiesAndDependencyJoinsPreserveRequirements:true,allAvailableButSubsetAnswerStillPartial:true,authorityAndRevocationPreserved:true,fullWireChars:measurement.final.requestChars,externalCalls:0,semanticUsefulnessProved:false}));
})().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
