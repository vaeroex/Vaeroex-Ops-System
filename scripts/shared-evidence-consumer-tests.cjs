const assert=require('node:assert/strict');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let events=[],denyValidation=false,gate=true,planBusiness=true,rootVersion=0,sealedVersion=0,emptyCatalog=false;
const workspace=id(1),actor=id(2),session=id(3),request=id(4),ticket=id(5),manifest=id(6);
const sources=[
 {provider:'google_sheets',identity:{kind:'sheets_ticket_source',source_id:id(10),authority_hash:'a'.repeat(64)},hash:'a'.repeat(64),data:{provider:'google_sheets',workspace_id:workspace,entity_id:id(30),connection_id:id(31),date:'2026-10-01',time_zone:'UTC',metrics:[{metric:'Orders',value:'17',unit:'count'}],read_sources:[]}},
 {provider:'square',identity:{kind:'square_payment',connection_id:id(32),payment_id:'one',authority_hash:'b'.repeat(64)},hash:'b'.repeat(64),data:{provider:'square',workspace_id:workspace,entity_id:id(30),connection_id:id(32),created_at:'2026-10-01T12:00:00Z',amount_minor:'1200',currency:'USD',time_zone:'UTC',coverage:'unknown'}}
];
const reader={auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),getClaims:async()=>({data:{claims:{sub:actor,session_id:session}},error:null})},rpc:async(name,args)=>{
 events.push(name);
 if(name==='discover_shared_evidence_v1')return {data:{stage:'catalog_only',candidates:(emptyCatalog?[]:sources).map(s=>({provider:s.provider,identity:s.identity})),truncated:false},error:null};
 if(name==='read_shared_typed_evidence_v1')return {data:{stage:'unadmitted',resolved:sources.find(s=>s.identity.kind===args.p_identity.kind)},error:null};
 if(name==='shared_evidence_dependencies_v1')return {data:{manifestIds:[],readSources:[]},error:null};
 if(name==='seal_shared_evidence_manifest_v1'){sealedVersion=rootVersion;assert.equal(args.p_target_id,request);assert.equal(args.p_attempt,2);return{data:{stage:'database_bound',manifest_id:manifest,provider_policy_required:true},error:null};}
 if(name==='validate_shared_evidence_manifest_v1')return{data:!denyValidation&&sealedVersion===rootVersion,error:denyValidation||sealedVersion!==rootVersion?{code:'42501'}:null};
 throw Error(`unexpected RPC ${name}`);
}};
require('./qbo-customer-test-support.cjs').installLoader({
 'server-only':{},
 '@/lib/ai/shared-evidence/runtime-gate':{sharedEvidenceRuntimeEnabled:()=>gate},
 './retrieval':{authorizeVsiRead:async()=>({supabase:reader,workspaceId:workspace,user:{id:actor},membership:{role:'owner'},workspace:{id:workspace,name:'Synthetic',industry:'test'}}),retrieveVsiEvidence:async()=>{throw Error('legacy fallback forbidden');}},
 '@/lib/billing/get-subscription-status':{getSubscriptionStatus:async()=>({allowed:true,status:'active',source:'synthetic'})},
 '@/lib/integrations/dashboard/server':{loadIntegrationDashboard:async()=>({dashboard:{},loadFailed:false,googleSheetsConnectionIds:[id(90)]})},
 '@/lib/integrations/dashboard/model':{IntegrationDashboardSchema:{safeParse:()=>({success:true,data:{workspaceId:workspace,entries:[],unavailable:[]}})},integrationDashboardStatus:()=>({label:'stored'})},
 '@/lib/integrations/google-sheets/read-authority':{bindGoogleSheetsRead:async(_reader,_ticket,roots)=>{if(roots.some(r=>r.id===id(90)))rootVersion++;events.push('bind');return{ticketId:ticket};}},
 '@/lib/ai/providers/google-data-policy':{googleSheetsOpenAIHeaders:async()=>({Authorization:'Bearer synthetic-offline'})},
 '@/lib/supabase/admin':{createSupabaseAdminClient:()=>{throw Error('No memory receipt expected for these fixture sources');}}
});
const {runVsiAnswer,VsiEngineError}=require('../lib/vsi/engine.ts');
const {prepareSharedGeneration,assertSharedPrepared}=require('../lib/ai/shared-evidence/generation.ts');
const {extendSharedBriefingPackage,bindSharedBriefingCitationTarget}=require('../lib/ai/shared-evidence/briefing.ts');
const {generateIntelligenceBriefing,intelligenceBriefingProviderPayload}=require('../lib/ai/intelligence-briefing/service.ts');
let payload;
global.fetch=async(url,init)=>{
 assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init.body);events.push('provider');
 assert.ok(events.indexOf('seal_shared_evidence_manifest_v1')<events.indexOf('provider'));
 assert.equal(events.at(-2),'validate_shared_evidence_manifest_v1');
 const p=JSON.parse(body.input[1].content);
 const value=body.text.format.name==='vsi_research_plan_v1'
 ?{mode:'answer',businessEvidence:planBusiness,tier:'simple',clarification:'',publicTargets:[],objectives:[]}
 :(()=>{payload=p;const s=p.businessSources[0];return{content:s?`Stored observation [${s.id}].`:'General response.',citationIds:s?[s.id]:[]};})();
 return new Response(JSON.stringify({model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:20},output_text:JSON.stringify(value)}),{status:200});
};
const input={supabase:reader,workspaceId:workspace,actorUserId:actor,readTicket:{ticketId:ticket},question:'Review our business sources',recentMessages:[],requestId:id(7),reservedRequest:{id:request,attempt:2}};
(async()=>{
 let result=await runVsiAnswer(input);assert.equal(result.sharedManifestId,manifest);assert.equal(result.usage.providerCalls,2);
 const scoped=JSON.parse(payload.businessSources[0].text);assert.equal(scoped.scope.entityId,id(30));assert.equal(scoped.scope.additive,false);assert.equal(payload.businessSources.length,2);
 assert.match(result.citations[0].url,/\/vsi_exchange\//);assert.equal(events.filter(e=>e==='provider').length,2);
 events=[];denyValidation=true;await assert.rejects(runVsiAnswer(input),e=>e instanceof VsiEngineError&&e.usage.inputTokens===0);assert.equal(events.includes('provider'),false);
 denyValidation=false;events=[];planBusiness=false;result=await runVsiAnswer({...input,question:'Explain arithmetic'});assert.equal(result.sharedManifestId,manifest);assert.equal(payload.businessSources.length,0);
 const prepared=await prepareSharedGeneration(reader,workspace,'2026-10-01','2026-10-07');
 const base={workspaceId:workspace,briefingType:'weekly',period:{start:'2026-10-01',end:'2026-10-07'},eligibility:'no_eligible_evidence',signals:[],sections:[],citations:[],contextReferences:[],limitations:[],requiredSignalRefs:[],manifest:{manifestId:'base',generatedAt:'2026-10-08T00:00:00Z',evidence:[],sourceRegistry:{entries:[],candidateToSourceOrdinal:{}}},evidenceFingerprint:'e',effectiveEvidenceFingerprint:'f',materialStateFingerprint:'m',generationKey:'g',trustBinding:{snapshotFingerprint:'s'},snapshotFingerprint:'s'};
 const extended=extendSharedBriefingPackage(base,prepared),bound=bindSharedBriefingCitationTarget(extended,request);
 assert.notEqual(bound.generationKey,base.generationKey);assert.equal(bound.generationKey,extended.generationKey);assert.equal(bound.signals.length,2);assert.equal(bound.signals[0].periodContext,'briefing_period');assert.equal(bound.signals[0].sourceScope.entityId,id(30));assert.match(bound.citations[0].href,/briefing_run/);
 assert.throws(()=>extendSharedBriefingPackage({...base,workspaceId:id(99)},prepared),/scope_changed/);
 const calls=events.filter(e=>e==='provider').length;
 await assert.rejects(generateIntelligenceBriefing({supabase:reader,workspaceId:workspace,readTicketId:ticket,briefingPackage:bound}),/admission_missing/);
 denyValidation=true;await assert.rejects(generateIntelligenceBriefing({supabase:reader,workspaceId:workspace,readTicketId:ticket,briefingPackage:bound,sharedExecution:{prepared,manifestId:manifest,runId:request}}),/authority_unavailable/);
 assert.equal(events.filter(e=>e==='provider').length,calls);
 emptyCatalog=true;denyValidation=false;events=[];planBusiness=false;
 result=await runVsiAnswer({...input,question:'Explain arithmetic'});assert.equal(result.sharedManifestId,manifest);assert.equal(payload.businessSources.length,0);
 const emptyPrepared=await prepareSharedGeneration(reader,workspace,'2026-10-01','2026-10-07');
 const emptyBrief=extendSharedBriefingPackage(base,emptyPrepared);assert.equal(emptyBrief.sharedEvidenceFingerprint,emptyPrepared.fingerprint);assert.equal(emptyBrief.eligibility,base.eligibility);
 for(const mutate of [p=>p.workspaceId=id(99),p=>p.start='2026-09-01',p=>p.limitations.push('Changed'),p=>p.rows[0].roots.push({table:'reports',id:id(95)}),p=>p.rows[0].data.currency='EUR']) {
 emptyCatalog=false;const packet=await prepareSharedGeneration(reader,workspace,'2026-10-01','2026-10-07');mutate(packet);assert.throws(()=>assertSharedPrepared(packet),/preparation_changed/);}
 console.log('Actual VSI prepare/seal/pre-provider path and brief fingerprint/admission guards passed offline. No live calls. Mixed-source generation/save/reopen is qualified separately by the SQL/application fixture.');
})().catch(e=>{console.error(e);process.exitCode=1;});
