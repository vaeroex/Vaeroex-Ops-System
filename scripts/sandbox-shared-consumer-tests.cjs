/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS fixture installs the repository TS test loader before loading actual consumer modules. */
/* Actual shared VSI/brief services + protected SQL save/reopen. Synthetic inputs,
 * mocked provider responses/auth transport; no external transport or paid calls. */
const assert=require('node:assert/strict');
const interpretation=sources=>({premises:sources.map(s=>({ref:s.ref,binding:s.binding,quote:s.facts[0]})),hypothesis:'Payment status may warrant reviewing accrual basis.',missing_information:'Whether payment status and accrual basis concern comparable periods.',next_check:'Review payment status alongside accrual basis.'});
(async()=>{
 const {setupSandboxFixture}=await import('./sandbox-shared-evidence-fixture.mjs');
 const {admin,uuid}=await import('./shared-evidence-sql-fixture.mjs');
 const f=await setupSandboxFixture(),{db,ids}=f;
 const {workspace:w,owner,session,ticket,request,conversation,installation}=ids;
 const runId=uuid(960);let activeTicket=ticket,open=false,qualitativeOpen=true,vsiCalls=0,briefCalls=0;
 const client=(role,actor=owner,sid=session)=>({auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),getClaims:async()=>({data:{claims:{sub:actor,session_id:sid}},error:null})},from:table=>{assert(['vsi_requests','vsi_exchanges','ai_agent_runs'].includes(table));const filters=[];const q={select:()=>q,eq:(k,v)=>{assert(/^[a-z_]+$/.test(k));filters.push([k,v]);return q;},maybeSingle:async()=>{await f.login(actor,sid,role);try{return{data:(await db.query(`select * from public.${table} where ${filters.map(([k],i)=>`${k}=$${i+1}`).join(' and ')}`,filters.map(([,v])=>v))).rows[0]||null,error:null};}catch(e){return{data:null,error:{code:e.code}};}}};return q;},rpc:async(name,args)=>{
  assert(/^[a-z][a-z0-9_]+$/.test(name));await f.login(actor,sid,role);const entries=Object.entries(args);entries.forEach(([k])=>assert(/^p_[a-z_]+$/.test(k)));
  try{return{data:(await db.query(`select public.${name}(${entries.map(([k],i)=>`${k}=>$${i+1}`).join(',')}) v`,entries.map(([k,v])=>k==='p_sources'||v&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):v))).rows[0].v,error:null};}catch(e){return{data:null,error:{code:e.code,message:e.message}};}
 }});
 const reader=client('authenticated'),service=client('service_role');
 require('./qbo-customer-test-support.cjs').installLoader({
  'server-only':{},'@/lib/ai/shared-evidence/runtime-gate':{sharedEvidenceRuntimeEnabled:()=>false},
  '@/lib/ai/shared-evidence/qualitative-policy':{qualitativeSynthesisEnabled:()=>qualitativeOpen},
  '@/lib/ai/shared-evidence/sandbox-policy':{sandboxSharedEvidenceInstallation:()=>open?installation:null,sandboxDescriptiveModelUseEnabled:()=>open},
  './sandbox-policy':{sandboxSharedEvidenceInstallation:()=>open?installation:null,sandboxDescriptiveModelUseEnabled:()=>open},
  './retrieval':{authorizeVsiRead:async()=>({supabase:reader,workspaceId:w,user:{id:owner},membership:{role:'owner'}}),retrieveVsiEvidence:async()=>{throw Error('Legacy fallback forbidden');}},
  './product-context':{loadVsiProductContext:async()=>({authoritative:{},sources:[],limitations:[]})},
  '@/lib/integrations/google-sheets/read-authority':{bindGoogleSheetsRead:async(_r,id,roots)=>{assert.equal(id,activeTicket);assert.deepEqual(roots,[]);return{ticketId:id};}},
  '@/lib/ai/providers/google-data-policy':{googleSheetsOpenAIHeaders:async()=>({Authorization:'Bearer synthetic-offline'})},
  '@/lib/supabase/admin':{createSupabaseAdminClient:()=>service},
  '@/lib/ai/providers/workflow-provider-policy':{BUSINESS_HEALTH_GPT56_TERRA_MODEL:'synthetic',resolveIntelligenceBriefingGenerationPolicy:()=>({providerPolicy:{id:'synthetic',steps:[{provider:'openai',model:'synthetic'}]},requestMaxOutputTokens:4000,requestTimeoutMs:1000,executionBudget:{}})},
  '@/lib/ai/trust/logging':{logTrustShadowTelemetryV1:()=>{},trustShadowTelemetryV1:()=>null,trustShadowFailureTelemetryV1:()=>null},
  '@/lib/ai/usage':{assertWorkspaceTokenBudget:async()=>{},estimateTokenCount:s=>Math.ceil(s.length/4)},
  '@/lib/ai/providers/provider-manager':{runStructuredAI:async options=>{
   briefCalls++;const p=JSON.parse(options.userContent[0].text);const rel=p.sections.flatMap(s=>s.signals).find(s=>s.ref.startsWith('SHARED-R-'));assert.match(rel.fact,/Sandbox/);
   const sections=p.sections.map(s=>({section_id:s.section_id,summary:s.signals[0].fact,support_refs:[s.signals[0].ref],claims:s.signals.map(r=>({text:r.fact,support_refs:[r.ref]})).slice(0,5)}));
   const synthesis=interpretation(p.qualitative_sources);
   const output={executive_summary:{text:rel.fact,support_refs:[rel.ref]},sections,leadership_considerations:[{text:rel.allowed_review_text,support_refs:[rel.ref]}],limitation_refs:p.limitations.map(l=>l.ref),interpretations:[synthesis]};
   for(const patch of [{hypothesis:'Payment status may cause net income.'},{next_check:'Review payment status and $500 of revenue.'},{premises:[{...synthesis.premises[0],binding:'c'.repeat(64)},synthesis.premises[1]]}]) {
    const rejected=options.validate({...output,interpretations:[{...synthesis,...patch}]});assert.equal(rejected.ok,true);assert.equal(rejected.value.acceptance.rejectedClaimCount,1);assert(!rejected.value.analysis.sections.some(s=>s.claims.some(c=>c.interpretation)));
   }
   const accepted=options.validate(output);assert.equal(accepted.ok,true,JSON.stringify(accepted));assert.equal(accepted.value.acceptance.rejectedClaimCount,0,JSON.stringify(accepted.value.acceptance.rejectionCategories));
   const factualOnly=options.validate({...output,interpretations:[]});assert.equal(factualOnly.ok,true);assert.equal(accepted.value.acceptance.acceptedMeasuredClaimCount,factualOnly.value.acceptance.acceptedMeasuredClaimCount);assert.equal(accepted.value.acceptance.acceptedClaimCount,factualOnly.value.acceptance.acceptedClaimCount+1);
   qualitativeOpen=false;const disabled=options.validate(output);qualitativeOpen=true;assert.equal(disabled.ok,true);assert.equal(disabled.value.acceptance.rejectedClaimCount,1);assert(!disabled.value.analysis.sections.some(s=>s.claims.some(c=>c.interpretation)));
   return{output:accepted.value,provider:'openai',model:'gpt-6-sol',requestId:'offline',latencyMs:1,inputTokens:100,outputTokens:100,totalTokens:200,estimatedCostCents:0,fallbackUsed:false,providerPolicyId:'synthetic',acceptedAttemptOrdinal:1,attempts:[]};
  }}
 });
 const {runVsiAnswer}=require('../lib/vsi/engine.ts'),{settleGeneratedVsi}=require('../lib/vsi/storage.ts');
 const {prepareSharedGeneration,prepareSandboxSharedGeneration,sealSharedGeneration}=require('../lib/ai/shared-evidence/generation.ts');
 const {sharedRow}=require('../lib/ai/shared-evidence/generation.ts');
 const {extendSharedBriefingPackage,bindSharedBriefingCitationTarget,isolatedSandboxBriefingBase}=require('../lib/ai/shared-evidence/briefing.ts');
 const {generateIntelligenceBriefing}=require('../lib/ai/intelligence-briefing/service.ts');
 const {completeIntelligenceBriefingRun}=require('../lib/ai/intelligence-briefing/run-lifecycle.ts');
 const {parseIntelligenceBriefingArtifact}=require('../lib/ai/intelligence-briefing/storage.ts');
 const {reopenSharedCitation}=require('../lib/ai/shared-evidence/citation-reopen.ts');
 const C=require('../lib/ai/intelligence-briefing/contracts.ts');
 // Keep the same real clock as the SQL retention/lease checks; only transports
 // are mocked. Shifting JS time after fixture creation invalidates authority.
 const originalFetch=global.fetch,now=new Date(),end=now.toISOString().slice(0,10),start=new Date(now.getTime()-29*86400000).toISOString().slice(0,10);
 global.fetch=async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');vsiCalls++;const b=JSON.parse(options.body),p=JSON.parse(b.input[1].content);
  const value=b.text.format.name==='vsi_research_plan_v1'?{mode:'answer',businessEvidence:true,tier:'simple',clarification:'',publicTargets:[],objectives:[]}:(()=>{
   assert.equal(p.businessSources.length,2);assert.equal(p.sharedRelationships.length,1);const rel=p.sharedRelationships[0];assert.match(rel.fact,/Square Sandbox/);
   return{content:rel.fact+' '+rel.inputSourceIds.map(id=>`[${p.businessSources.find(s=>s.sourceId===id).id}]`).join(' '),citationIds:p.businessSources.map(s=>s.id),interpretations:[interpretation(p.qualitative_sources)]};
  })();
  return new Response(JSON.stringify({model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:100},output_text:JSON.stringify(value)}),{status:200});
 };
 try{
  await assert.rejects(prepareSandboxSharedGeneration(reader,w,f.day,f.day,installation),/disabled/);assert.equal(vsiCalls,0);
  open=true;await f.enabledPolicy();
  const prepared=await prepareSandboxSharedGeneration(reader,w,start,end,installation);assert.equal(prepared.rows.length,2);assert.equal(prepared.relationships.length,1);assert.equal(prepared.relationships[0].kind,'sandbox_observation_boundary');
  assert.throws(()=>sharedRow(prepared.rows[0],w),/production_admission_denied/);
  const answer=await runVsiAnswer({supabase:reader,workspaceId:w,actorUserId:owner,readTicket:{ticketId:ticket},question:'Question',recentMessages:[],requestId:uuid(104),reservedRequest:{id:request,attempt:1}});
  assert.equal(answer.citations.length,2);assert.match(answer.content,/Sandbox/);
  assert.match(answer.content,/Interpretation \(unverified hypothesis\): Payment status may warrant reviewing accrual basis/);
  await settleGeneratedVsi({supabase:reader,workspaceId:w,userId:owner,sessionId:session},{id:request,conversationId:conversation,attempt:1,readTicketId:ticket,question:'Question',answer:answer.content,summary:'Private fixture context',citations:answer.citations,usage:answer.usage},answer.sharedManifestId);
  const reopened=await reopenSharedCitation(reader,{workspaceId:w,kind:'vsi_exchange',id:request});assert.equal(reopened.length,2);assert(reopened.every(r=>r.identity.environment==='sandbox'));
  await admin(db);const storedAnswer=(await db.query('select answer from vsi_exchanges where id=$1',[request])).rows[0].answer;assert.equal(storedAnswer,answer.content);assert.match(storedAnswer,/unverified hypothesis/);
  // A separate brief ticket never imports the private VSI conversation.
  activeTicket=uuid(961);await admin(db);await db.query("insert into private.google_sheets_read_tickets(id,workspace_id,actor_id,expires_at,epoch,bound,sources) values($1,$2,$3,clock_timestamp()+interval '1 hour',1,true,'[]')",[activeTicket,w,owner]);
  const h='a'.repeat(64),snapshotHash=`sha256:${h}`;
  const base={contractId:C.INTELLIGENCE_BRIEFING_CONTRACT_ID,contractVersion:C.INTELLIGENCE_BRIEFING_CONTRACT_VERSION,schemaVersion:C.INTELLIGENCE_BRIEFING_SCHEMA_VERSION,validatorVersion:C.INTELLIGENCE_BRIEFING_VALIDATOR_VERSION,promptVersion:C.INTELLIGENCE_BRIEFING_PROMPT_VERSION,generationPolicyVersion:C.INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION,materialityVersion:C.INTELLIGENCE_BRIEFING_MATERIALITY_VERSION,language:{locale:C.INTELLIGENCE_BRIEFING_DEFAULT_LOCALE,standardVersion:C.INTELLIGENCE_BRIEFING_PLAIN_LANGUAGE_VERSION},workspaceId:w,briefingType:'monthly',period:{start:prepared.start,end:prepared.end,cutoff:`${end}T23:59:59Z`,dayCount:30,timeZone:'UTC'},eligibility:'no_eligible_evidence',confidence:'Low',evidenceCoverage:{supportingRecordCount:0,independentSourceCount:0,freshness:'unavailable',latestEvidenceAt:null,overallCoverage:null,coverageLabel:'Limited',includedDomains:[],missingOrWeakDomains:[]},evidenceFingerprint:h,effectiveEvidenceFingerprint:h,materialStateFingerprint:h,generationKey:h,snapshotFingerprint:snapshotHash,businessHealth:{available:false,score:null,status:'Unavailable',trajectory:null,confidence:'Low'},signals:[],sections:[],contextReferences:[],limitations:[],manifest:{manifestId:h,workspaceId:w,generatedAt:now.toISOString(),evidence:[],sourceRegistry:{version:'source_registry_v1',workspaceId:w,entries:[],candidateToSourceOrdinal:{},independentOriginalSourceCount:0}},citations:[],requiredSignalRefs:[],previousBriefing:null,trustBinding:{snapshotFingerprint:snapshotHash,projectionFingerprint:h}};
  const contaminated={...base,signals:[{ref:'unbound-business-fact'}],citations:[{citationId:99}],businessHealth:{available:true,score:80}};
  assert.throws(()=>extendSharedBriefingPackage(contaminated,prepared),/base_evidence_unbound/);
  const clean=isolatedSandboxBriefingBase(contaminated,prepared);assert.equal(clean.businessHealth.available,false);assert.equal(clean.signals.length,0);assert.equal(clean.citations.length,0);
  const briefingPackage=bindSharedBriefingCitationTarget(extendSharedBriefingPackage(clean,prepared),runId);
  await db.query("insert into ai_agent_runs(id,workspace_id,agent_type,input_json,status,created_by,google_sheets_read_ticket_id) values($1,$2,'intelligence_briefing_v1',$3,'processing',$4,$5)",[runId,w,JSON.stringify({workflow:'intelligence_briefing_v1',google_sheets_read_ticket_id:activeTicket,shared_evidence_contract:'shared_evidence_v1',generation_key:briefingPackage.generationKey,briefing_type:'monthly',evidence_fingerprint:briefingPackage.evidenceFingerprint,effective_evidence_fingerprint:briefingPackage.effectiveEvidenceFingerprint,material_state_fingerprint:briefingPackage.materialStateFingerprint,schema_version:briefingPackage.schemaVersion,validator_version:briefingPackage.validatorVersion,prompt_version:briefingPackage.promptVersion,generation_policy_version:briefingPackage.generationPolicyVersion}),owner,activeTicket]);
  const m=await sealSharedGeneration(reader,prepared,{kind:'briefing_run',id:runId,attempt:1,ticketId:activeTicket});
  const generated=await generateIntelligenceBriefing({supabase:reader,workspaceId:w,readTicketId:activeTicket,briefingPackage,sharedExecution:{prepared,manifestId:m,runId}});
  assert(parseIntelligenceBriefingArtifact(generated.artifact));assert.equal(generated.artifact.citations.length,2);
  const qualitative=generated.artifact.analysis.sections.flatMap(s=>s.claims).find(c=>c.interpretation);assert(qualitative);assert.equal(qualitative.support_refs.length,2);assert.match(qualitative.text,/unverified hypothesis/);
  const corrupted=structuredClone(generated.artifact);const changed=corrupted.analysis.sections.flatMap(s=>s.claims).find(c=>c.interpretation);changed.interpretation.premises[0].binding='d'.repeat(64);assert.equal(parseIntelligenceBriefingArtifact(corrupted),null);
  assert.equal((await completeIntelligenceBriefingRun({admin:service,reader,authority:{workspaceId:w,userId:owner,sessionId:session,readTicketId:activeTicket},runId,artifact:generated.artifact,sharedManifestId:m})).status,'completed');
  assert.equal((await reopenSharedCitation(reader,{workspaceId:w,kind:'briefing_run',id:runId})).length,2);
  await admin(db);const storedBrief=parseIntelligenceBriefingArtifact((await db.query('select output_json from ai_agent_runs where id=$1',[runId])).rows[0].output_json);assert(storedBrief);assert(storedBrief.analysis.sections.some(s=>s.claims.some(c=>c.interpretation)));
  await assert.rejects(reopenSharedCitation(client('authenticated',ids.otherOwner,ids.otherSession),{workspaceId:w,kind:'vsi_exchange',id:request}),/unavailable/);
  open=false;await assert.rejects(reopenSharedCitation(reader,{workspaceId:w,kind:'briefing_run',id:runId}),/disabled/);
  // Production preparation remains on its own RPC path; Sandbox identity cannot be relabelled.
  assert.equal(typeof prepareSharedGeneration,'function');assert.equal(vsiCalls,2);assert.equal(briefCalls,1);
  console.log(JSON.stringify({actualVsi:true,actualBrief:true,novelQualifiedSynthesis:true,protectedSqlSaveReopen:true,storedInterpretationIntegrity:true,plugins:2,mockedVsiResponses:vsiCalls,mockedBriefResponses:briefCalls,paidCalls:0,defaultClosed:true,limitations:f.limitations}));
 }finally{global.fetch=originalFetch;await db.close();}
})().catch(e=>{console.error(JSON.stringify({name:e.name,message:e.message,code:e.code,stack:e.stack?.split('\n').slice(0,5)}));process.exitCode=1;});
