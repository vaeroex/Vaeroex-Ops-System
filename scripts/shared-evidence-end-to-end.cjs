/* Offline application + PGlite contract integration. Deterministic providers only.
 * Database fixture limitations remain explicit: not a browser, real PostgreSQL
 * concurrency, or full Supabase/document-provider trigger composition. */
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
module.exports=async function run({db,uuid,w,owner,session,entity,login,admin,map,read,newRequest,pluginCount=5}) {
 const OriginalDate=Date;const fixedNow=OriginalDate.parse('2026-10-23T12:00:00Z');
 global.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:[fixedNow]));}static now(){return fixedNow;}};
 try {
 const sourceCount=pluginCount+2;let expectedRelationships;
 const ticket=uuid(101),request=uuid(103),conversation=uuid(102),runId=uuid(800);
 let providerCalls=0,briefCalls=0,activeTicket=ticket,answerMode='valid';
 const rpcNames=new Set(['discover_shared_evidence_v1','preview_shared_legacy_evidence_v1','read_shared_typed_evidence_v1','capture_legacy_evidence_v1','certify_shared_memory_semantics_v1','shared_evidence_dependencies_v1','seal_shared_evidence_manifest_v1','validate_shared_evidence_manifest_v1','vsi_mutate_v3','vsi_mutate_v2','complete_trusted_derived_run_v2','fail_trusted_derived_run_v1','reopen_shared_evidence_target_v1','reopen_shared_evidence_artifact_v1']);
 function client(role,actor=owner,sid=session){return {from:table=>{assert(['vsi_exchanges','vsi_requests','ai_agent_runs'].includes(table));const filters=[];const q={select:()=>q,eq:(key,value)=>{assert(/^[a-z_]+$/.test(key));filters.push([key,value]);return q;},maybeSingle:async()=>{await login(db,actor,sid,role);try{return{data:(await db.query(`select * from public.${table} where ${filters.map(([key],i)=>`${key}=$${i+1}`).join(' and ')}`,filters.map(([,value])=>value))).rows[0]||null,error:null};}catch(error){return{data:null,error:{code:error.code}};}}};return q;},auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),getClaims:async()=>({data:{claims:{sub:actor,session_id:sid}},error:null})},rpc:async(name,args)=>{
  assert(rpcNames.has(name),name);const entries=Object.entries(args);entries.forEach(([key])=>assert(/^p_[a-z_]+$/.test(key)));
  await login(db,actor,sid,role);try{return{data:(await db.query(`select public.${name}(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(',')}) v`,entries.map(([,value])=>value&&typeof value==='object'&&!Array.isArray(value)?JSON.stringify(value):Array.isArray(value)&&name==='seal_shared_evidence_manifest_v1'&&Array.isArray(value)&&entries.find(([key,v])=>v===value)?.[0]==='p_sources'?JSON.stringify(value):value))).rows[0].v,error:null};}catch(error){console.error('synthetic RPC failed',name,error.code,error.message);return{data:null,error:{code:error.code,message:error.message}};}
 }};}
 const reader=client('authenticated'),service=client('service_role');
 async function bind(_reader,id,roots){assert.equal(id,activeTicket);await admin(db);const current=(await db.query('select sources from private.google_sheets_read_tickets where id=$1',[id])).rows[0].sources;
 const unique=[...new Map([...current,...roots].map(root=>[JSON.stringify(root),root])).values()];await db.query('update private.google_sheets_read_tickets set sources=$1 where id=$2',[JSON.stringify(unique),id]);await login(db);return{ticketId:id};}
 let packageForProvider;
 // Each fixture owns fresh application modules and database-backed dependency mocks.
 for(const path of Object.keys(require.cache)) if(path.includes('/lib/')) delete require.cache[path];
 require('./qbo-customer-test-support.cjs').installLoader({
  'server-only':{},'@/lib/ai/business-notes/release-channel':{businessNoteReleaseChannel:()=> 'production'},'@/lib/ai/shared-evidence/runtime-gate':{sharedEvidenceRuntimeEnabled:()=>true},
  './retrieval':{authorizeVsiRead:async()=>({supabase:reader,workspaceId:w,user:{id:owner},membership:{role:'owner'}}),retrieveVsiEvidence:async()=>{throw Error('No legacy fallback');}},
  './product-context':{loadVsiProductContext:async()=>({authoritative:{},sources:[],limitations:[]})},
  '@/lib/integrations/google-sheets/read-authority':{bindGoogleSheetsRead:bind},
  '@/lib/ai/providers/google-data-policy':{googleSheetsOpenAIHeaders:async()=>({Authorization:'Bearer synthetic-offline'})},
  '@/lib/supabase/admin':{createSupabaseAdminClient:()=>service},
  '@/lib/ai/providers/workflow-provider-policy':{BUSINESS_HEALTH_GPT56_TERRA_MODEL:'synthetic',resolveIntelligenceBriefingGenerationPolicy:()=>({providerPolicy:{id:'synthetic',steps:[{provider:'openai',model:'synthetic'}]},requestMaxOutputTokens:4000,requestTimeoutMs:1000,executionBudget:{}})},
  '@/lib/ai/trust/logging':{logTrustShadowTelemetryV1:()=>{},trustShadowTelemetryV1:()=>null,trustShadowFailureTelemetryV1:()=>null},
  '@/lib/ai/usage':{assertWorkspaceTokenBudget:async()=>{},estimateTokenCount:s=>Math.ceil(s.length/4)},
  '@/lib/ai/providers/provider-manager':{runStructuredAI:async options=>{
   briefCalls++;const p=JSON.parse(options.userContent[0].text);assert(p.sections.some(s=>s.signals.some(r=>r.ref.startsWith('SHARED-R-'))));
   const sections=p.sections.map(s=>{const ordered=[...s.signals.filter(r=>r.ref.startsWith('SHARED-R-')),...s.signals.filter(r=>!r.ref.startsWith('SHARED-R-'))];return{section_id:s.section_id,summary:ordered[0].fact,support_refs:[ordered[0].ref],claims:ordered.map(r=>({text:r.fact,support_refs:[r.ref]})).slice(0,5)};});
   const rel=p.sections.find(s=>s.section_id==='financial_performance').signals.find(r=>r.ref.startsWith('SHARED-R-'));
   // Put joint signal first so bounded per-section output never drops it.
   const financial=sections.find(s=>s.section_id==='financial_performance');financial.summary=rel.fact;financial.support_refs=[rel.ref];financial.claims=[{text:rel.fact,support_refs:[rel.ref]},...financial.claims].slice(0,5);
   const output={executive_summary:{text:rel.fact,support_refs:[rel.ref]},sections,leadership_considerations:[{text:rel.allowed_review_text,support_refs:[rel.ref]}],limitation_refs:p.limitations.map(l=>l.ref)};
   const invalidRelationship=structuredClone(output);invalidRelationship.executive_summary.text='These records establish a matched transaction.';
   const negative=options.validate(invalidRelationship);assert(!negative.ok||negative.value.acceptance.rejectedClaimCount>0);
   const fileSignal=p.sections.flatMap(s=>s.signals).find(r=>r.fact.includes('reviewed file reports'));
   const wrongFile=structuredClone(output);const update=wrongFile.sections.find(s=>s.section_id==='business_updates_context');
   update.claims=update.claims.map(c=>c.support_refs[0]===fileSignal.ref?{...c,text:c.text.replace('reviewed file reports','approved Business Note reports')}:c);
   const wrongKind=options.validate(wrongFile);assert(!wrongKind.ok||wrongKind.value.acceptance.rejectedClaimCount>0);
   const accepted=options.validate(output);assert.equal(accepted.ok,true,JSON.stringify(accepted));assert.equal(accepted.value.acceptance.rejectedClaimCount,0,JSON.stringify(accepted.value.acceptance));for(const r of p.sections.flatMap(s=>s.signals).filter(r=>r.ref.startsWith('SHARED-R-'))){assert(accepted.value.acceptedSignalRefs.includes(r.ref));assert(accepted.value.analysis.sections.some(s=>s.claims.some(c=>c.text===r.fact&&c.support_refs.includes(r.ref))));}
   return{output:accepted.value,provider:'openai',model:'gpt-6-sol',requestId:'offline',latencyMs:1,inputTokens:100,outputTokens:100,totalTokens:200,estimatedCostCents:0,fallbackUsed:false,providerPolicyId:'synthetic',acceptedAttemptOrdinal:1,attempts:[]};
  }}
 });
 const {validateBusinessNoteExtraction}=require('../lib/ai/business-notes/validation.ts');
 const {approvedContextText}=require('../lib/ai/business-notes/approved-context-text.ts');
 const {chunkEvidenceText}=require('../lib/ai/evidence-index.ts');
 const original='The supplier changed its delivery schedule.';
 const extraction={schemaVersion:'business_note_extraction_v1',extractionDisposition:'extractable',title:'Supplier update',summary:original,noteType:'observation',sourceClassification:'manager_observation',departments:['Operations'],topics:['Delivery'],peopleMentioned:[],customersMentioned:[],vendorsMentioned:[],projectsMentioned:[],explicitFacts:[{statement:original,sourceQuote:original,confidence:0.9}],opinionsOrAssumptions:[],risks:[],opportunities:[],decisions:[],mentionedMetrics:[],reportingPeriod:{start:null,end:null,inferred:false,sourceQuote:null},evidenceTreatment:'potentially_supporting',extractionConfidence:0.9,missingContext:[]};
 const checkedNote=validateBusinessNoteExtraction(extraction,original);assert.equal(checkedNote.ok,true);const noteText=chunkEvidenceText(approvedContextText(checkedNote.value,[]))[0];const hash=s=>createHash('sha256').update(s).digest('hex');
 await admin(db);
 await db.query("update private.google_sheets_read_tickets set expires_at=clock_timestamp()+interval '1 hour' where id=$1",[ticket]);
 await db.query("update vsi_requests set lease_until=clock_timestamp()+interval '1 hour' where id=$1",[request]);
 await db.query("insert into reporting_connections(id,workspace_id,provider,created_by,status,account,snapshot,last_sync_at) values($1,$2,'zoho-inventory',$3,'connected',$4,$5,'2026-10-01')",[uuid(700),w,owner,JSON.stringify({id:'synthetic-inventory'}),JSON.stringify({start:'2026-10-01',end:'2026-10-01',metrics:[{key:'items',value:20},{key:'low_stock',value:4}]})]);
 const projection={contractVersion:'qbo_source_record_minimized_v1',provider:{providerKey:'quickbooks_online',sourceEnvironment:'production'},recordType:'Invoice',id:'invoice1',minimizationVersion:'qbo_minimizer_v1',status:'active',temporal:{postingDate:'2026-10-01'},accounting:{basis:'accrual',sourceCurrency:'USD'},amounts:{total:{amount:'100',currency:'USD'}}};
 await db.query("insert into private.integration_connections values($1,$2,$3,'quickbooks_online','production','active',1)",[uuid(720),w,entity]);
 await db.query("insert into private.provider_entity_mappings values($1,$2,$3,$4,'quickbooks_online','production','active',now(),1)",[uuid(721),w,entity,uuid(720)]);
 await db.query("insert into private.external_source_records values($1,$2,$3,$4,$5,'quickbooks_online','provider','active',$6,'Invoice','invoice1')",[uuid(722),w,entity,uuid(720),uuid(721),uuid(723)]);
 await db.query("insert into private.external_source_record_versions(id,workspace_id,business_entity_id,connection_id,source_record_id,provider_key,source_kind,provider_record_type,provider_record_id,validation_state,normalized_projection,accounting_currency,accounting_basis,posting_date) values($1,$2,$3,$4,$5,'quickbooks_online','provider','Invoice','invoice1','valid',$6,'USD','accrual','2026-10-01')",[uuid(723),w,entity,uuid(720),uuid(722),JSON.stringify(projection)]);
 await db.query("insert into private.qbo_production_source_validation_work values($1,$2,$3,$4,$5,$6,null,'valid')",[w,entity,uuid(720),uuid(721),uuid(722),uuid(723)]);
 const added=[];
 if(pluginCount>=6) {
  for(const [i,provider] of (pluginCount===12?['xero','clockify','toggl','katana']:['xero']).entries()) {
   const metrics=provider==='xero'?[{key:'billed',value:100,currency:'USD'},{key:'invoices',value:1,currency:'USD'},{key:'bills',value:0,currency:'USD'}]:[{key:provider==='katana'?'stock_rows':'hours',value:provider==='katana'?30:2}];
   const connection=uuid(730+i);added.push([provider,connection]);
   await db.query("insert into reporting_connections(id,workspace_id,provider,created_by,status,account,snapshot,last_sync_at) values($1,$2,$3,$4,'connected',$5,$6,'2026-10-01')",[connection,w,provider,owner,JSON.stringify({id:`synthetic-${provider}`}),JSON.stringify({start:'2026-10-01',end:'2026-10-01',metrics})]);
   if(['xero','clockify'].includes(provider)) await db.query("insert into reporting_history_facts values($1,$2,$3,'record-1','2026-10-01',$4)",[w,provider,connection,JSON.stringify(metrics)]);
  }
 }
 if(pluginCount===12) {
  await db.query("insert into loyverse_connections(id,workspace_id,created_by,status,merchant_id,currency_code) values($1,$2,$3,'connected',$4,'USD')",[uuid(740),w,owner,uuid(750)]);
  await db.query("insert into loyverse_receipt_facts(workspace_id,connection_id,receipt_number,store_id,receipt_date,created_at,updated_at,receipt_type,total_money,total_tax,total_discount,cancelled) values($1,$2,'receipt-1','store-1','2026-10-01','2026-10-01','2026-10-01','SALE',100,0,0,false)",[w,uuid(740)]);
  await db.query("insert into zoho_books_connections(id,workspace_id,created_by,status,organization_id,currency_code) values($1,$2,$3,'connected','12345','USD')",[uuid(741),w,owner]);
  await db.query("insert into zoho_books_history_facts values($1,$2,'invoice','123','2026-10-01',true,'USD',80,0)",[w,uuid(741)]);
  await db.query("insert into wix_order_connections(id,workspace_id,created_by,status,instance_hash,site_id) values($1,$2,$3,'connected',$4,$5)",[uuid(742),w,owner,'a'.repeat(64),uuid(752)]);
  await db.query("insert into wix_order_facts values($1,$2,$3,'2026-10-01T10:00:00Z',120,'USD','PAID')",[w,uuid(742),uuid(753)]);
  added.push(['loyverse',uuid(740)],['zoho-books',uuid(741)],['wix-orders',uuid(742)]);
 }
 await db.query("insert into ai_agent_runs(id,workspace_id,agent_type,status,created_by,input_json,output_json) values($1,$2,'file_analysis','completed',$3,'{}','{\"evidence_classification\":\"business_evidence\"}')",[uuid(715),w,owner]);
 await db.query('insert into file_uploads(id,workspace_id) values($1,$2)',[uuid(710),w]);
 await db.query('insert into private.fixture_document_authority values($1,$2,$3)',[uuid(710),w,JSON.stringify({eligible:true,mode:'existing_native_file_analysis'})]);
 await db.query("insert into business_memory_chunks values($1,$2,$3,'file_analysis',$3,true,null,null,$4,$5,'The weekly stock review uses the supplier delivery schedule.','Store schedule',0)",[uuid(711),w,uuid(710),JSON.stringify({evidence_classification:'business_evidence',review_status:'approved',run_id:uuid(715)}),hash('synthetic-file')]);
 await db.query("insert into business_notes(id,workspace_id,status,evidence_lifecycle_status,trusted_approval,lifecycle_provenance_id,release_channel,approved_at,source_version,source_text_hash,original_note_text,reviewed_extraction_json,source_spans_json,user_corrections_json,approved_by,extraction_json) values($1,$2,'approved','active',true,$3,'production',now(),1,$4,$5,$6,'[]','{}',$7,$6)",[uuid(712),w,uuid(713),hash(original),original,JSON.stringify(extraction),owner]);
 await db.query("insert into business_memory_chunks values($1,$2,$3,'business_note',null,true,null,null,$4,$5,$6,'Supplier update',0)",[uuid(714),w,uuid(712),JSON.stringify({source_version:1,release_channel:'production',review_status:'approved'}),hash(`${uuid(712)}:1:0:${noteText}`),noteText]);
 await login(db);await map(db,'zoho-inventory',uuid(700));for(const [provider,connection] of added)await map(db,provider,connection);
 const {runVsiAnswer}=require('../lib/vsi/engine.ts');const {settleGeneratedVsi}=require('../lib/vsi/storage.ts');
 const {prepareSharedGeneration,sealSharedGeneration}=require('../lib/ai/shared-evidence/generation.ts');
 const {extendSharedBriefingPackage,bindSharedBriefingCitationTarget}=require('../lib/ai/shared-evidence/briefing.ts');
 const {generateIntelligenceBriefing}=require('../lib/ai/intelligence-briefing/service.ts');
 const {completeIntelligenceBriefingRun}=require('../lib/ai/intelligence-briefing/run-lifecycle.ts');
 const {parseIntelligenceBriefingArtifact}=require('../lib/ai/intelligence-briefing/storage.ts');
 const {reopenSharedCitation}=require('../lib/ai/shared-evidence/citation-reopen.ts');
 const C=require('../lib/ai/intelligence-briefing/contracts.ts');
 const originalFetch=global.fetch;
 global.fetch=async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');providerCalls++;const body=JSON.parse(options.body),p=JSON.parse(body.input[1].content);let value;
  if(body.text.format.name==='vsi_research_plan_v1')value={mode:'answer',businessEvidence:true,tier:'simple',clarification:'',publicTargets:[],objectives:[]};
  else {assert.equal(p.businessSources.length,sourceCount);assert.equal(p.sharedRelationships.length,expectedRelationships);const rel=p.sharedRelationships[0];assert.equal(rel.inputSourceIds.length,2);
   const refs=rel.inputSourceIds.map(id=>p.businessSources.find(s=>s.sourceId===id).id);value={content:p.sharedRelationships.map(r=>`${r.fact} ${r.inputSourceIds.map(id=>`[${p.businessSources.find(s=>s.sourceId===id).id}]`).join(' ')}`).join('\n')+'\n'+p.businessSources.filter(s=>!p.sharedRelationships.some(r=>r.inputSourceIds.includes(s.sourceId))).map(s=>`${JSON.parse(s.text).observations[0]} [${s.id}]`).join('\n'),citationIds:p.businessSources.map(s=>s.id)};
   if(answerMode==='missing-citation')value={content:`${rel.fact} [${refs[0]}]`,citationIds:[refs[0]]};
   if(answerMode==='invented-ratio')value={content:`Sales per hour are 15.43 USD. [${refs[0]}] [${refs[1]}]`,citationIds:refs};
   if(answerMode==='invented-profit')value={content:`POS payments establish profit of 123.45 USD. [${refs[0]}] [${refs[1]}]`,citationIds:refs};
   if(answerMode==='invented-cause')value={content:`Stock changed because of the supplier schedule. [${refs[0]}] [${refs[1]}]`,citationIds:refs};
   if(answerMode==='reversed-boundary')value={content:`These records establish a matched transaction. [${refs[0]}] [${refs[1]}]`,citationIds:refs};
  }
  return new Response(JSON.stringify({model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:100},output_text:JSON.stringify(value)}),{status:200});
 };
 try {
  expectedRelationships=(await prepareSharedGeneration(reader,w,new Date(Date.now()-29*86400000).toISOString().slice(0,10),new Date().toISOString().slice(0,10))).relationships.length;assert(expectedRelationships>=3);
  const answer=await runVsiAnswer({supabase:reader,workspaceId:w,actorUserId:owner,readTicket:{ticketId:ticket},question:'Question',recentMessages:[],requestId:uuid(104),reservedRequest:{id:request,attempt:1}});
  assert.equal(answer.citations.length,sourceCount);assert.equal(new Set(answer.citations.map(c=>c.url)).size,sourceCount);
  for(const [index,mode] of ['missing-citation','reversed-boundary','invented-ratio','invented-profit','invented-cause'].entries()) {
   answerMode=mode;const rejectedId=await newRequest(db,850+index*2);
   await assert.rejects(runVsiAnswer({supabase:reader,workspaceId:w,actorUserId:owner,readTicket:{ticketId:ticket},question:'Question',recentMessages:[],requestId:uuid(851+index*2),reservedRequest:{id:rejectedId,attempt:1}}),e=>e.usage?.outcomeFailure==='citation_validation');
  }
  answerMode='valid';await settleGeneratedVsi({supabase:reader,workspaceId:w,userId:owner,sessionId:session},{id:request,conversationId:conversation,attempt:1,readTicketId:ticket,question:'Question',answer:answer.content,summary:'User asked Question',citations:answer.citations,usage:answer.usage},answer.sharedManifestId);
  const reopened=await reopenSharedCitation(reader,{workspaceId:w,kind:'vsi_exchange',id:request});assert.equal(reopened.length,sourceCount);assert.equal(new Set(reopened.map(r=>r.provider).filter(p=>!['file','business_note'].includes(p))).size,pluginCount);
  await admin(db);const saved=(await db.query('select answer,citations from vsi_exchanges where id=$1',[request])).rows[0];assert.equal(saved.answer,answer.content);assert.equal(saved.citations.length,sourceCount);
  // A fresh owner-wide brief ticket never inherits actor-private VSI output.
  activeTicket=uuid(801);await db.query("insert into private.google_sheets_read_tickets(id,workspace_id,actor_id,expires_at,epoch,bound,sources) values($1,$2,$3,clock_timestamp()+interval '1 hour',1,true,'[]')",[activeTicket,w,owner]);
  const prepared=await prepareSharedGeneration(reader,w,'2026-09-24','2026-10-23');assert.equal(prepared.rows.length,sourceCount);assert.equal(prepared.relationships.length,expectedRelationships);
  const h='a'.repeat(64),snapshotHash=`sha256:${h}`;
  const base={contractId:C.INTELLIGENCE_BRIEFING_CONTRACT_ID,contractVersion:C.INTELLIGENCE_BRIEFING_CONTRACT_VERSION,schemaVersion:C.INTELLIGENCE_BRIEFING_SCHEMA_VERSION,validatorVersion:C.INTELLIGENCE_BRIEFING_VALIDATOR_VERSION,promptVersion:C.INTELLIGENCE_BRIEFING_PROMPT_VERSION,generationPolicyVersion:C.INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION,materialityVersion:C.INTELLIGENCE_BRIEFING_MATERIALITY_VERSION,language:{locale:C.INTELLIGENCE_BRIEFING_DEFAULT_LOCALE,standardVersion:C.INTELLIGENCE_BRIEFING_PLAIN_LANGUAGE_VERSION},workspaceId:w,briefingType:'monthly',period:{start:prepared.start,end:prepared.end,cutoff:'2026-10-23T23:59:59Z',dayCount:30,timeZone:'UTC'},eligibility:'no_eligible_evidence',confidence:'Low',evidenceCoverage:{supportingRecordCount:0,independentSourceCount:0,freshness:'unavailable',latestEvidenceAt:null,overallCoverage:null,coverageLabel:'Limited',includedDomains:[],missingOrWeakDomains:[]},evidenceFingerprint:h,effectiveEvidenceFingerprint:h,materialStateFingerprint:h,generationKey:h,snapshotFingerprint:snapshotHash,businessHealth:{available:false,score:null,status:'Unavailable',trajectory:null,confidence:'Low'},signals:[],sections:[],contextReferences:[],limitations:[],manifest:{manifestId:h,workspaceId:w,generatedAt:'2026-10-23T00:00:00Z',evidence:[],sourceRegistry:{entries:[],candidateToSourceOrdinal:{}}},citations:[],requiredSignalRefs:[],previousBriefing:null,trustBinding:{snapshotFingerprint:snapshotHash,projectionFingerprint:h}};
  packageForProvider=bindSharedBriefingCitationTarget(extendSharedBriefingPackage(base,prepared),runId);
  await admin(db);await db.query("insert into ai_agent_runs(id,workspace_id,agent_type,input_json,status,created_by,google_sheets_read_ticket_id) values($1,$2,'intelligence_briefing_v1',$3,'processing',$4,$5)",[runId,w,JSON.stringify({workflow:'intelligence_briefing_v1',google_sheets_read_ticket_id:activeTicket,shared_evidence_contract:'shared_evidence_v1',generation_key:packageForProvider.generationKey,briefing_type:'monthly',evidence_fingerprint:packageForProvider.evidenceFingerprint,effective_evidence_fingerprint:packageForProvider.effectiveEvidenceFingerprint,material_state_fingerprint:packageForProvider.materialStateFingerprint,schema_version:packageForProvider.schemaVersion,validator_version:packageForProvider.validatorVersion,prompt_version:packageForProvider.promptVersion,generation_policy_version:packageForProvider.generationPolicyVersion}),owner,activeTicket]);
  const manifestId=await sealSharedGeneration(reader,prepared,{kind:'briefing_run',id:runId,attempt:1,ticketId:activeTicket});
  const generated=await generateIntelligenceBriefing({supabase:reader,workspaceId:w,readTicketId:activeTicket,briefingPackage:packageForProvider,sharedExecution:{prepared,manifestId,runId}});
  assert(generated.artifact.citations.length<=sourceCount);assert.equal(generated.artifact.citations.length,pluginCount===12?11:sourceCount);for(const signal of generated.artifact.signals.filter(s=>s.sharedRelationship))for(const id of signal.citationIds)assert(generated.artifact.citations.some(c=>c.citationId===id),'Every accepted joint claim keeps all original citations');assert.equal(generated.artifact.contextReferences.length,2);assert(generated.artifact.contextReferences.some(r=>r.sourceKind==='reviewed_file'));assert.equal(generated.artifact.signals.filter(r=>r.ref.startsWith('SHARED-R-')).length,expectedRelationships);assert(generated.artifact.signals.some(r=>r.sharedRelationship==='inventory_context_boundary_v1'&&r.citationIds.length===3));
  assert(parseIntelligenceBriefingArtifact(generated.artifact),'actual artifact parser accepts file context and scope');
  assert.equal((await completeIntelligenceBriefingRun({admin:service,reader,authority:{workspaceId:w,userId:owner,sessionId:session,readTicketId:activeTicket},runId,artifact:generated.artifact,sharedManifestId:manifestId})).status,'completed');
  const briefSources=await reopenSharedCitation(reader,{workspaceId:w,kind:'briefing_run',id:runId});assert.equal(briefSources.length,sourceCount);assert.equal(new Set(briefSources.map(r=>r.provider).filter(p=>!['file','business_note'].includes(p))).size,pluginCount);
  await admin(db);const output=(await db.query('select output_json from ai_agent_runs where id=$1',[runId])).rows[0].output_json;assert(parseIntelligenceBriefingArtifact(output));assert.deepEqual(output.citations,generated.artifact.citations);for(const signal of generated.artifact.signals.filter(s=>s.sharedRelationship)){assert(output.analysis.sections.some(section=>section.claims.some(claim=>claim.text===signal.fact&&claim.support_refs.includes(signal.ref))));}
  // Protected reopen rejects foreign workspace and another owner's private VSI.
  await assert.rejects(reopenSharedCitation(reader,{workspaceId:uuid(2),kind:'vsi_exchange',id:request}),/unavailable/);
  await assert.rejects(reopenSharedCitation(reader,{workspaceId:uuid(2),kind:'briefing_run',id:runId}),/unavailable/);
  await assert.rejects(reopenSharedCitation(client('authenticated',uuid(5),uuid(8)),{workspaceId:w,kind:'vsi_exchange',id:request}),/unavailable/);
  await admin(db);
  // Revocation invalidates both exact saved citations; no model call follows.
  await db.query("update reporting_connections set status='disconnected' where id=$1",[uuid(700)]);
  await assert.rejects(reopenSharedCitation(reader,{workspaceId:w,kind:'vsi_exchange',id:request}),/unavailable/);
  await assert.rejects(reopenSharedCitation(reader,{workspaceId:w,kind:'briefing_run',id:runId}),/unavailable/);
  assert.equal(providerCalls,12);assert.equal(briefCalls,1);
  return {plugins:pluginCount,savedManifestSources:sourceCount,reopenedSources:briefSources.length,vsiInlineCitations:answer.citations.length,briefInlineCitations:generated.artifact.citations.length,briefClaimBudgetOmittedIndividualSources:sourceCount-generated.artifact.citations.length,processedFile:true,approvedNote:true,actualVsiEngine:true,actualBriefService:true,actualSqlSaveReopen:true,deterministicProviderCalls:13,negativeVsiCases:5,paidCalls:0,relationships:['sales-versus-profit non-additivity','hours comparison missing-input explanation','inventory/file/note missing relevance limitation'],numericRatioSupported:false,operationalExplanationSupported:false};
 } finally {global.fetch=originalFetch;}
 } finally {global.Date=OriginalDate;}
};
