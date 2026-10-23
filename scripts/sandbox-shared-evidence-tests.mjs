// LOCAL SYNTHETIC TESTS. No credential, external database, provider or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setupSandboxFixture,sandboxLogin,enabledPolicy,ids} from './sandbox-shared-evidence-fixture.mjs';
import {admin,uuid,newBrief,settle,saveVsi} from './shared-evidence-sql-fixture.mjs';
const sql=readFileSync(new URL('../docs/security-drafts/sandbox/admission.sql',import.meta.url),'utf8');
const read=async(f,identity=f.qboIdentity,installation=ids.installation)=>(await f.db.query('select read_sandbox_shared_evidence_v1($1,$2,$3) v',[ids.workspace,JSON.stringify(identity),installation])).rows[0].v.resolved;
const seal=async(f,{kind='vsi_request',id=ids.request,sources,installation=ids.installation,parents=[]}={})=>(await f.db.query('select seal_sandbox_shared_evidence_v1($1,$2,$3,1,$4,$5,$6,$7) v',[ids.workspace,kind,id,ids.ticket,JSON.stringify(sources??[(await read(f)).identity,(await read(f,f.squareIdentity)).identity]),parents,installation])).rows[0].v;
async function scoped(run){const f=await setupSandboxFixture();try{await run(f);}finally{await f.db.close();}}

test('draft defaults closed, no validation grants, repository authority/preview derivation remains exact',async()=>{
 const manifest=JSON.parse(readFileSync(new URL('../docs/security-drafts/sandbox/source-manifest.json',import.meta.url),'utf8'));
 const source=readFileSync(new URL('../'+manifest.squareAuthoritySource,import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(source).digest('hex'),manifest.squareAuthoritySha256);
 let clone=source.slice(source.indexOf('create function private.square_workspace_evidence_v1'),source.indexOf('revoke all on function private.square_workspace_evidence_v1'));
 clone=clone.replace('private.square_workspace_evidence_v1(p_workspace_id uuid)','private.sandbox_square_authority_v1(p_workspace_id uuid,p_actor_id uuid,p_session_id uuid)');
 const start=clone.indexOf('  actor:=auth.uid();'),end=clone.indexOf('  select m.role,s.not_after',start);
 clone=clone.slice(0,start)+"  actor:=p_actor_id; sid:=p_session_id;\n  perform private.require_shared_evidence_actor_v1(p_workspace_id,actor,sid);\n"+clone.slice(end);
 clone=clone.replace("role_name not in ('owner','admin','manager')","role_name<>'owner'");
 assert(sql.includes(clone.trim()));
 const audit=JSON.parse(readFileSync(new URL('../'+manifest.qboPreviewSource,import.meta.url),'utf8'));
 const preview=audit.functions.find(f=>f.proname==='qbo_customer_preview_v1').definition;
 assert.equal(createHash('sha256').update(preview).digest('hex'),manifest.qboPreviewDefinitionSha256);
 assert(sql.includes(preview.replace('private.qbo_customer_preview_v1(','private.sandbox_qbo_preview_v1(').replace("'production'","'sandbox'").trim()+';'));
 assert(!/grant[^;]*integration_provider_validation_authority/i.test(sql));
 assert(!/insert into private\.sandbox_shared_evidence_policies/i.test(sql));
 await scoped(async f=>{
  await assert.rejects(read(f),/sandbox_model_use_disabled/);
  await enabledPolicy(f.db,{enabled:false});await assert.rejects(read(f),/sandbox_model_use_disabled/);
  await admin(f.db);await assert.rejects(f.db.exec('update private.sandbox_shared_evidence_policies set enabled=true'),/sandbox_policy_immutable/);
 });
});

test('genuine repository Sandbox projections: exact versions, owner/session/issuer/installation and production rejection',()=>scoped(async f=>{
 await f.enabledPolicy();
 const qbo=await read(f),square=await read(f,f.squareIdentity);
 assert.equal(qbo.data.environment,'sandbox');assert.equal(square.data.environment,'sandbox');
 assert.equal(qbo.data.preview.kind,'report');assert.equal(square.data.economic,'blocked');
 assert.equal(square.data.observation.kind,'payment');assert.equal(qbo.identity.version_id,ids.qboVersion);
 assert.equal((await read(f)).hash,qbo.hash,'no volatile authority timestamp enters saved identity');
 await assert.rejects(f.db.query('select read_shared_typed_evidence_v1($1,$2)',[ids.workspace,JSON.stringify(f.qboIdentity)]),/denied|unimplemented/);
 await assert.rejects(f.db.query('select seal_shared_evidence_manifest_v1($1,$2,$3,1,$4,$5,$6)',[ids.workspace,'vsi_request',ids.request,ids.ticket,JSON.stringify([f.qboIdentity]),[]]),/source_kind_denied/);
 for(const [actor,sid,patch] of [[ids.member,ids.memberSession,{}],[ids.owner,ids.otherSession,{}],[ids.owner,ids.session,{iss:'https://production.invalid/auth/v1'}],[ids.owner,ids.session,{is_anonymous:true}]]){
  await sandboxLogin(f.db,actor,sid,'authenticated',patch);await assert.rejects(read(f),/denied/);
 }
 await f.login();await assert.rejects(read(f,{...f.qboIdentity,environment:'production'}),/denied/);
 await assert.rejects(read(f,{...f.qboIdentity,installation_id:uuid(998)}),/denied|disabled/);
 await assert.rejects(read(f,{...f.qboIdentity,version_id:uuid(997)}),/denied/);
 await assert.rejects(f.db.query('select read_sandbox_shared_evidence_v1($1,$2,$3)',[ids.otherWorkspace,JSON.stringify(f.qboIdentity),ids.installation]),/denied/);
 await admin(f.db);
 const grants=(await f.db.query("select has_function_privilege('authenticated','private.sandbox_qbo_preview_v1(jsonb,text,text)','execute') helper,has_table_privilege('service_role','private.sandbox_shared_resolution_claims','select') claims")).rows[0];
 assert.deepEqual(grants,{helper:false,claims:false});
 // Preview-to-seal authority drift cannot bind a new mapping to old model input.
 await f.db.query('update private.provider_entity_mappings set row_version=row_version+1 where id=$1',[ids.qboMapping]);await f.login();
 await assert.rejects(seal(f,{sources:[qbo.identity,square.identity]}),/identity_changed/);await admin(f.db);
 // Actual production preview still rejects Sandbox input.
 assert.equal((await f.db.query('select private.qbo_customer_preview_v1($1,$2,$3) v',[JSON.stringify(f.projection),'ProfitAndLoss','sandbox-report'])).rows[0].v.state,'unsupported');
}));

test('same manifest/terminal/reopen paths preserve original actor, source change denial and once-only cost',()=>scoped(async f=>{
 await f.enabledPolicy();await admin(f.db);await f.db.exec("grant select,insert on public.reports to authenticated");await f.login();const m=await seal(f);
 await f.login(ids.owner,ids.session,'service_role');
 assert.equal((await settle(f.db,m.manifest_id)).state,'settled');
 await assert.rejects(settle(f.db,m.manifest_id),/stale_attempt/); // terminal wrapper rejects resettlement; API reconciliation precedes retries
 await f.login();
 const reopen=async(kind,id)=>(await f.db.query('select reopen_shared_evidence_target_v1($1,$2,$3) v',[ids.workspace,kind,id])).rows[0].v;
 assert.equal((await reopen('vsi_exchange',ids.request)).projections.filter(r=>r.identity.kind!=='inherited_artifact').length,2);
 const report=await saveVsi(f.db,930);await f.login();
 await admin(f.db);const rev=(await f.db.query('select private.evidence_digest_v1(jsonb_build_array(body_markdown,source_data_json)) rev from public.reports where id=$1',[report])).rows[0].rev;await f.login();
 assert.equal((await f.db.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4) v',[ids.workspace,'report',report,rev])).rows[0].v.projections.filter(r=>r.identity.kind!=='inherited_artifact').length,2);
 await f.login(ids.otherOwner,ids.otherSession);await assert.rejects(reopen('vsi_exchange',ids.request),/denied/);
 await assert.rejects(f.db.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4)',[ids.workspace,'report',report,rev]),/denied/);
 await admin(f.db);assert.equal((await f.db.query('select count(*) n from vsi_cost_events where workspace_id=$1',[ids.workspace])).rows[0].n,1);
 assert.equal((await f.db.query('select count(*) n from private.sandbox_shared_resolution_claims')).rows[0].n,0);
 await f.db.query('update private.provider_entity_mappings set row_version=row_version+1 where id=$1',[ids.qboMapping]);
 await f.login();await assert.rejects(reopen('vsi_exchange',ids.request),/changed/);
}));

test('brief completion uses the same server claim and rejects private or cross-installation inheritance',()=>scoped(async f=>{
 await f.enabledPolicy();const run=await newBrief(f.db,940);await f.login();
 const m=await seal(f,{kind:'briefing_run',id:run});
 const output={contractId:'intelligence_briefing_v1',workspaceId:ids.workspace,briefingType:'weekly',generationKey:'fixture-key'};
 await f.login(ids.owner,ids.session,'service_role');
 await f.db.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8)',[ids.workspace,run,ids.owner,ids.session,ids.ticket,'intelligence_briefing_v1',JSON.stringify(output),m.manifest_id]);
 await f.login();assert.equal((await f.db.query('select reopen_shared_evidence_target_v1($1,$2,$3) v',[ids.workspace,'briefing_run',run])).rows[0].v.projections.filter(r=>r.identity.kind!=='inherited_artifact').length,2);
 // No-fresh-source inheritance cannot launder Sandbox into production or another installation.
 await assert.rejects(f.db.query('select seal_shared_evidence_manifest_v1($1,$2,$3,1,$4,$5,$6)',[ids.workspace,'vsi_request',ids.request,ids.ticket,'[]',[m.manifest_id]]),/environment_denied/);
 const second=uuid(950);await f.enabledPolicy({installation:second});
 await assert.rejects(seal(f,{sources:[],installation:second,parents:[m.manifest_id]}),/inherited_environment_denied/);
 // Disabled policy fails at the actual terminal/reopen contract, never restores evidence.
 await admin(f.db);await f.db.query('update private.sandbox_shared_evidence_policies set enabled=false where installation_id=$1',[ids.installation]);await f.login();
 await assert.rejects(f.db.query('select reopen_shared_evidence_target_v1($1,$2,$3)',[ids.workspace,'briefing_run',run]),/disabled/);
}));

test('first-use reviewed file/note preview needs no receipt; seal still requires canonical semantic certification',()=>scoped(async f=>{
 await f.enabledPolicy();await admin(f.db);
 const file=uuid(970),fileChunk=uuid(971),run=uuid(972),note=uuid(973),noteChunk=uuid(974),provenance=uuid(975);
 await f.db.query("insert into ai_agent_runs(id,workspace_id,agent_type,status,created_by,input_json,output_json) values($1,$2,'file_analysis','completed',$3,'{}','{\"evidence_classification\":\"business_evidence\"}')",[run,ids.workspace,ids.owner]);
 await f.db.query('insert into file_uploads(id,workspace_id) values($1,$2)',[file,ids.workspace]);
 await f.db.query('insert into private.fixture_document_authority values($1,$2,$3)',[file,ids.workspace,JSON.stringify({eligible:true,mode:'existing_native_file_analysis'})]);
 await f.db.query("insert into business_memory_chunks values($1,$2,$3,'file_analysis',$3,true,null,null,$4,$5,'Supplier delivery schedule was reviewed.','Reviewed schedule',0)",[fileChunk,ids.workspace,file,JSON.stringify({evidence_classification:'business_evidence',review_status:'approved',run_id:run}),'a'.repeat(64)]);
 await f.db.query("insert into business_notes(id,workspace_id,status,evidence_lifecycle_status,trusted_approval,lifecycle_provenance_id,release_channel,approved_at,source_version,source_text_hash,original_note_text,reviewed_extraction_json,source_spans_json,user_corrections_json,approved_by) values($1,$2,'approved','active',true,$3,'production',now(),1,$4,'Supplier changed','{}','[]','{}',$5)",[note,ids.workspace,provenance,'d'.repeat(64),ids.owner]);
 const excerpt='The business reported a supplier change';
 await f.db.query("insert into business_memory_chunks values($1,$2,$3,'business_note',null,true,null,null,$4,$5,$6,'Supplier note',0)",[noteChunk,ids.workspace,note,JSON.stringify({source_version:1,release_channel:'production',review_status:'approved'}),createHash('sha256').update(`${note}:1:0:${excerpt}`).digest('hex'),excerpt]);
 assert.equal((await f.db.query('select count(*) n from private.shared_memory_semantic_receipts')).rows[0].n,0);
 await f.login();
 for(const identity of [{kind:'approved_file_fact',chunk_id:fileChunk},{kind:'approved_note',chunk_id:noteChunk}]){
  const preview=await read(f,identity);assert.match(preview.identity.authority_hash,/^[a-f0-9]{64}$/);
  await assert.rejects(seal(f,{sources:[preview.identity]}),/semantic_receipt_required/);
 }
 await admin(f.db);assert.equal((await f.db.query('select count(*) n from private.shared_memory_semantic_receipts')).rows[0].n,0);
}));
