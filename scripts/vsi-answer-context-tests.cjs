/* eslint-disable @typescript-eslint/no-require-imports -- Offline synthetic TS harness; every provider and authority transport is mocked. */
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const workspace=id(1),actor=id(2),session=id(3),request=id(4),ticket=id(5),manifest=id(6);
let revoked=false,foreign=false,revokeAfterPlanner=false,answerMode='valid',providerCalls=0,answerCalls=0;
const events=[];
const raw=[
 {provider:'google_sheets',identity:{kind:'sheets_ticket_source',source_id:id(10),authority_hash:'a'.repeat(64)},hash:'a'.repeat(64),data:{provider:'google_sheets',workspace_id:workspace,entity_id:id(30),connection_id:id(31),date:'2026-10-14',time_zone:'UTC',metrics:Array.from({length:36},(_,n)=>({metric:`dispatch observation ${n} ${'synthetic operational review '.repeat(4)}`,value:String(n+1),unit:'count'})),read_sources:[]}},
 {provider:'xero',identity:{kind:'legacy_binding',binding_id:id(32),start:'2026-10-01',end:'2026-10-30'},hash:'b'.repeat(64),data:{provider:'xero',workspace_id:workspace,entity_id:id(30),connection_id:id(33),scope:'stored invoice observations',records:Array.from({length:18},(_,n)=>({day:'2026-10-14',metrics:[{key:`invoice balance ${n} ${'synthetic billing review '.repeat(4)}`,value:String(n+1),currency:'USD'}]})),read_sources:[]}}
];
const reader={auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),getClaims:async()=>({data:{claims:{sub:actor,session_id:session}},error:null})},rpc:async(name,args)=>{
 events.push(name);
 if(name==='discover_shared_evidence_v1')return {data:{stage:'catalog_only',candidates:raw.map(s=>({provider:s.provider,identity:s.identity})),truncated:false},error:null};
 if(name==='read_shared_typed_evidence_v1'||name==='preview_shared_legacy_evidence_v1'){
  const source=structuredClone(raw[name==='read_shared_typed_evidence_v1'?0:1]);if(foreign)source.data.workspace_id=id(99);
  return {data:{stage:'unadmitted',resolved:source},error:null};
 }
 if(name==='capture_legacy_evidence_v1')return {data:{reference_id:id(70),source_hash:raw[1].hash},error:null};
 if(name==='shared_evidence_dependencies_v1')return {data:{manifestIds:[],readSources:[]},error:null};
 if(name==='seal_shared_evidence_manifest_v1'){
  assert.equal(args.p_target_id,request);assert.equal(args.p_sources.length,2);
  assert.equal(args.p_sources[1].kind,'legacy_reference');
  return {data:{stage:'database_bound',manifest_id:manifest,provider_policy_required:true},error:null};
 }
 if(name==='validate_shared_evidence_manifest_v1')return {data:!revoked,error:revoked?{code:'42501'}:null};
 throw Error(`unexpected RPC ${name}`);
}};
const product={assistant:{name:'Vaeroex'},connections:{stored:'synthetic connection statuses'},catalog:'Maintained product facts. '.repeat(190)};
const productSource={id:'P1',title:'Maintained product context',url:'/app/help',sourceType:'product_context',sourceId:null,evidenceDate:null,retrievedAt:'2026-10-01T00:00:00Z',snapshotHash:crypto.createHash('sha256').update(JSON.stringify(product)).digest('hex'),text:'Maintained product facts.',treatment:'record'};
require('./qbo-customer-test-support.cjs').installLoader({
 'server-only':{},
 '@/lib/ai/shared-evidence/runtime-gate':{sharedEvidenceRuntimeEnabled:()=>true},
 '@/lib/ai/shared-evidence/qualitative-policy':{qualitativeSynthesisEnabled:()=>true},
 './retrieval':{authorizeVsiRead:async()=>({supabase:reader,workspaceId:workspace,user:{id:actor},membership:{role:'owner'},workspace:{id:workspace}}),retrieveVsiEvidence:async()=>{throw Error('legacy fallback forbidden');}},
 './product-context':{loadVsiProductContext:async()=>({authoritative:product,sources:[productSource],limitations:['Product facts are not business evidence.']})},
 '@/lib/integrations/google-sheets/read-authority':{bindGoogleSheetsRead:async()=>({ticketId:ticket})},
 '@/lib/ai/providers/google-data-policy':{googleSheetsOpenAIHeaders:async()=>({Authorization:'Bearer synthetic-dedicated-key'})},
 '@/lib/supabase/admin':{createSupabaseAdminClient:()=>{throw Error('No memory receipt expected');}}
});
const {packVsiAnswerContext,serializeVsiAnswerContext,VsiAnswerContextLimit}=require('../lib/vsi/answer-context.ts');
const {sharedRow}=require('../lib/ai/shared-evidence/generation.ts');
const {withVsiSourceSnapshot,stableVsiCitationId}=require('../lib/vsi/research.ts');
const {runVsiAnswer,VsiEngineError}=require('../lib/vsi/engine.ts');
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};
const synth=(ref,binding,facts)=>({ref,binding,dependencies:[binding],facts,reported:false,environment:'production'});
const source=(ref,binding,facts)=>withVsiSourceSnapshot({id:ref,title:ref,url:`/app/sources/evidence/vsi_exchange/${request}#source-${binding}`,sourceType:`shared_${ref==='B1'?'xero':'google_sheets'}`,sourceId:binding,evidenceDate:'2026-10-14',retrievedAt:'2026-10-24T00:00:00Z',treatment:'record',text:JSON.stringify({scope:{entityId:id(30),currency:ref==='B1'?'USD':null,additive:false},observations:facts})});
const pureFacts=[['Invoice balance observations. '.repeat(100)],['Dispatch backlog observations. '.repeat(100)]];
const pure=freeze({businessSources:pureFacts.map((facts,n)=>source(`B${n+1}`,String(n+1).repeat(64),facts)),qualitative_sources:pureFacts.map((facts,n)=>synth(`B${n+1}`,String(n+1).repeat(64),facts)),authoritativeProductContext:{connections:product.connections},productSources:[productSource],sharedRelationships:[{fact:'Preserve both supporting originals.',inputSourceIds:['1'.repeat(64),'2'.repeat(64)]}],recentConversation:[{role:'user',content:'Earlier context.'}],historicalSources:[productSource]});
const before=JSON.stringify(pure),small=serializeVsiAnswerContext(pure),view=JSON.parse(small.json);
assert.equal(small.compactedSources,2);assert(small.json.length<before.length);assert.equal(JSON.stringify(pure),before);
assert.deepEqual(view.qualitative_sources,pure.qualitative_sources);assert.deepEqual(view.sharedRelationships,pure.sharedRelationships);assert.deepEqual(view.authoritativeProductContext,pure.authoritativeProductContext);assert.deepEqual(view.productSources,pure.productSources);assert.deepEqual(view.recentConversation,pure.recentConversation);assert.deepEqual(view.historicalSources,pure.historicalSources);
for(let n=0;n<2;n++){
 const original=pure.businessSources[n],transport=view.businessSources[n],record=JSON.parse(transport.text),issued=view.qualitative_sources.find(s=>s.ref===record.observationsRef);
 assert.equal(issued.binding,original.sourceId);assert.deepEqual(issued.facts,JSON.parse(original.text).observations);
 assert.equal(transport.snapshotHash,original.snapshotHash);assert.equal(transport.url,original.url);assert.equal(transport.id,original.id);assert.equal(transport.evidenceDate,original.evidenceDate);
 assert.deepEqual(record.scope,JSON.parse(original.text).scope);
}
assert.throws(()=>packVsiAnswerContext(pure,'system',small.json.length),VsiAnswerContextLimit);
assert.throws(()=>packVsiAnswerContext(pure,'',0),RangeError);
for(const change of [p=>p.qualitative_sources[0].facts[0]+=' Changed',p=>p.qualitative_sources[0].binding='f'.repeat(64),p=>p.qualitative_sources[0].ref='fabricated']){
 const changed=structuredClone(pure);change(changed);const result=JSON.parse(serializeVsiAnswerContext(changed).json);assert.equal(result.businessSources[0].text,changed.businessSources[0].text,'a mismatch cannot replace original facts with a reference');
}
const financial=structuredClone(pure);financial.businessSources.push({...source('B3','3'.repeat(64),['Application-issued result.']),sourceType:'financial_calculation',inputSourceIds:['input-a','input-b'],comparisons:[{kind:'synthetic preserved comparison'}]});
assert.deepEqual(JSON.parse(serializeVsiAnswerContext(financial).json).businessSources[2],financial.businessSources[2]);
const duplicate=structuredClone(pure);duplicate.qualitative_sources.push(duplicate.qualitative_sources[0]);assert.equal(serializeVsiAnswerContext(duplicate).compactedSources,0);
const many=structuredClone(pure);for(let n=3;n<=17;n++){const binding=n.toString(16).padStart(64,'0'),facts=[`Complete source group ${n}. `.repeat(20)];many.businessSources.push(source(`B${n}`,binding,facts));many.qualitative_sources.push(synth(`B${n}`,binding,facts));}
many.businessSources.reverse();many.qualitative_sources.reverse();
const manyPacked=JSON.parse(packVsiAnswerContext(many,'system',48000).json);assert.equal(manyPacked.businessSources.length,17);assert.deepEqual(manyPacked.businessSources.map(s=>s.id),many.businessSources.map(s=>s.id));assert.equal(new Set(manyPacked.businessSources.map(s=>s.sourceType)).size,2);
let transport,originalChars=0,packedChars=0;
process.env.OPENAI_API_KEY='synthetic-global-unused';process.env.VAEROEX_VSI_MAX_INPUT_CHARS='32000';
global.fetch=async(url,init)=>{
 providerCalls++;events.push('provider');assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(init.headers.Authorization,'Bearer synthetic-dedicated-key');
 const body=JSON.parse(init.body),payload=JSON.parse(body.input[1].content);assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(body.model,'gpt-6-luna');
 assert(events.indexOf('seal_shared_evidence_manifest_v1')<events.indexOf('provider'));assert.equal(events.at(-2),'validate_shared_evidence_manifest_v1');
 let output;
 if(body.text.format.name==='vsi_research_plan_v1'){output={mode:'answer',businessEvidence:true,tier:'simple',clarification:'',publicTargets:[],objectives:[]};if(revokeAfterPlanner)revoked=true;}
 else {
  answerCalls++;transport=payload;packedChars=body.input[0].content.length+body.input[1].content.length;assert(packedChars<=32000);assert.equal(payload.businessSources.length,2);assert.equal(payload.qualitative_sources.length,2);assert.deepEqual(payload.authoritativeProductContext,product);
  const expanded=structuredClone(payload);delete expanded.sharedObservationLayout;
  for(const source of expanded.businessSources){const record=JSON.parse(source.text);assert(record.observationsRef,'fixture must exercise compaction');const issued=payload.qualitative_sources.find(s=>s.ref===record.observationsRef);delete record.observationsRef;record.observations=issued.facts;source.text=JSON.stringify(record);}
  originalChars=JSON.stringify(expanded).length+body.input[0].content.length;assert(originalChars>32000,'reproduce the former post-premise context failure');
  const premises=payload.qualitative_sources.map(s=>({ref:s.ref,binding:s.binding,quote:s.facts[0]}));
  output={content:payload.businessSources.map(s=>`Stored observations [${s.id}].`).join('\n'),citationIds:payload.businessSources.map(s=>s.id),interpretations:[{premises,hypothesis:'Invoice balance may warrant dispatch review.',missing_information:'Whether invoice balance and dispatch concern comparable periods.',next_check:'Review invoice balance alongside dispatch.'}]};
  if(answerMode==='unknown-citation')output.citationIds.push('B999');
  if(answerMode==='unsupported-cause')output.interpretations[0].hypothesis='Invoice balance caused dispatch.';
 }
 return new Response(JSON.stringify({model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:20},output_text:JSON.stringify(output)}),{status:200});
};
const input={supabase:reader,workspaceId:workspace,actorUserId:actor,readTicket:{ticketId:ticket},question:'Use stored Xero and synthetic Google Sheets evidence. Do not search the web.',recentMessages:[],requestId:id(7),reservedRequest:{id:request,attempt:1}};
(async()=>{
 const answer=await runVsiAnswer(input);assert.equal(answer.sharedManifestId,manifest);assert.equal(answer.usage.providerCalls,2);assert.equal(answer.citations.length,2);assert.match(answer.content,/Interpretation \(unverified hypothesis\)/);
 for(const original of raw){const row=sharedRow(original,workspace),canonical=withVsiSourceSnapshot({id:row.hash,title:row.provider.replace(/[_-]/g,' '),url:`/app/sources/evidence/vsi_exchange/${request}?workspace=${workspace}#source-${row.hash}`,sourceType:`shared_${row.provider}`,sourceId:row.hash,evidenceDate:null,retrievedAt:transport.businessSources.find(s=>s.sourceId===row.hash).retrievedAt,text:JSON.stringify({scope:row.scope,observations:row.facts}),treatment:'record'});const saved=answer.citations.find(c=>c.sourceId===row.hash);assert(saved);assert.equal(saved.snapshotHash,canonical.snapshotHash);assert.equal(saved.url,canonical.url);assert.equal(transport.businessSources.find(s=>s.sourceId===row.hash).id,stableVsiCitationId(canonical));}
 const measured={originalChars,packedChars};
 for(const mode of ['unknown-citation','unsupported-cause']){answerMode=mode;await assert.rejects(runVsiAnswer(input),e=>e instanceof VsiEngineError&&e.usage.outcomeFailure==='citation_validation');}answerMode='valid';
 for(const kind of ['revoked','foreign']){providerCalls=0;answerCalls=0;revoked=kind==='revoked';foreign=kind==='foreign';await assert.rejects(runVsiAnswer(input),e=>e instanceof VsiEngineError&&e.usage.inputTokens===0);assert.equal(providerCalls,0);assert.equal(answerCalls,0);}revoked=false;foreign=false;
 providerCalls=0;answerCalls=0;revokeAfterPlanner=true;await assert.rejects(runVsiAnswer(input),e=>e instanceof VsiEngineError&&e.usage.providerCalls===1&&e.usage.outcomeFailure==='evidence_unavailable');assert.equal(providerCalls,1);assert.equal(answerCalls,0);revokeAfterPlanner=false;revoked=false;
 providerCalls=0;answerCalls=0;await assert.rejects(runVsiAnswer({...input,recentMessages:[{role:'user',content:'Historical conversation context. '.repeat(250)},{role:'assistant',content:'Prior explanation with no business citations. '.repeat(180)}]}),e=>e instanceof VsiEngineError&&e.usage.outcomeFailure==='context_block'&&/No additional source groups were dropped/.test(e.message));assert.equal(providerCalls,1);assert.equal(answerCalls,0);
 console.log(JSON.stringify({passed:true,fixture:'synthetic two-plugin full engine packing',...measured,sourceGroupsRetained:2,largerFixtureGroupsRetained:17,canonicalCitationsPreserved:true,revocationAndWrongWorkspaceDeniedBeforeProvider:true,unknownCitationAndCausalClaimDenied:true,revocationAfterPlanningStopsAnswer:true,unfitContextStopsBeforeAnswerCall:true,mockedRuntime:true,paidCalls:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
