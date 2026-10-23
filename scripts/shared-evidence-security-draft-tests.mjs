import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, draft1, draft2, draft3, deployed, definition, uuid, w, other, owner, member, owner2, session, memberSession, secondSession, entity, otherEntity, conn, sourceTables, login, admin, setup, map, capture, reopen, manifestSetup, seal, settlement, settle, newRequest, newBrief, finishedVsi, saveVsi, typedSetup, typedRead, typedSeal, sheetsFixture } from './shared-evidence-sql-fixture.mjs';


test('closed reader requires actual live owner JWT, no role grants or tenant substitution',async()=>{
 const db=await setup();try {
 const binding=await map(db); const result=await capture(db,binding);
 assert.equal(result.stage,'unadmitted'); assert.deepEqual(result.data.original_keys,[['harvest',conn,'entry-1']]);
 await assert.rejects(capture(db,binding,other),/square_production_customer_owner_denied/);
 await assert.rejects(map(db,'harvest',conn,otherEntity),/evidence_entity_unavailable/);
 await login(db,member,memberSession);await assert.rejects(map(db),/square_production_customer_owner_denied/);
 await login(db,owner,memberSession);await assert.rejects(map(db),/square_production_customer_owner_denied/);
 await login(db,owner,null);await assert.rejects(map(db),/evidence_live_session_required/);
 for(const role of ['anon','service_role']) {await login(db,owner,session,role);await assert.rejects(map(db),/permission denied/);}
 await admin(db);
 const roles=(await db.query("select has_function_privilege('authenticated','public.capture_legacy_evidence_v1(uuid,uuid,date,date)','EXECUTE') as a,has_function_privilege('service_role','public.capture_legacy_evidence_v1(uuid,uuid,date,date)','EXECUTE') as s,has_function_privilege('anon','public.capture_legacy_evidence_v1(uuid,uuid,date,date)','EXECUTE') as n,has_table_privilege('authenticated','private.legacy_evidence_references','SELECT') as t")).rows[0];
 assert.deepEqual(roles,{a:true,s:false,n:false,t:false});
 }finally{await db.close();}
});

test('reference is immutable, exact source edits detected, revocation survives reconnect',async()=>{
 const db=await setup();try {
 const binding=await map(db);const result=await capture(db,binding);assert.equal((await reopen(db,result.reference_id)).status,'current');
 await admin(db);await assert.rejects(db.query('update private.legacy_evidence_references set source_hash=$1',['a'.repeat(64)]),/evidence_reference_immutable/);
 await db.query("update reporting_history_facts set metrics='[{\"key\":\"hours\",\"value\":9}]'");await login(db);
 assert.deepEqual(await reopen(db,result.reference_id),{status:'changed',reference_id:result.reference_id});
 await admin(db);await db.query("update reporting_connections set status='disconnected' where id=$1",[conn]);
 await db.query("update reporting_connections set status='connected' where id=$1",[conn]);await login(db);
 await assert.rejects(reopen(db,result.reference_id),/evidence_binding_unavailable/);
 assert.notEqual(await map(db),binding);
 }finally{await db.close();}
});

test('mapping cannot infer entity, reuse stale review or survive owner/session/entity removal',async()=>{
 const db=await setup();try {
 await assert.rejects(db.query("select confirm_legacy_evidence_mapping_v1($1,'harvest',$2,$3,null)",[w,conn,entity]),/evidence_connection_changed/);
 const binding=await map(db);assert.equal(await map(db),binding);
 await admin(db);await db.query("update business_entities set status='inactive' where id=$1",[entity]);await login(db);
 await assert.rejects(capture(db,binding),/evidence_entity_unavailable/);
 await admin(db);await db.query("update business_entities set status='active' where id=$1",[entity]);await db.query("update auth.sessions set not_after='2000-01-01' where id=$1",[session]);await login(db);
 await assert.rejects(capture(db,binding),/square_production_customer_owner_denied/);
 await login(db,owner2,secondSession);assert.equal((await capture(db,binding)).stage,'unadmitted');
 }finally{await db.close();}
});

test('all nine fixed dispatch paths execute; safe numeric projection rejects extra fields',async()=>{
 const db=await setup();try {
 await admin(db);
 for(const [i,p] of ['xero','clockify','toggl','zoho-inventory','katana'].entries()) {
   const key=p==='xero'?'invoices':p==='clockify'||p==='toggl'?'hours':p==='katana'?'stock_rows':'items';
   const metrics=[{key,value:1,...(p==='xero'?{currency:'USD'}:{})}];
   await db.query("insert into reporting_connections(id,workspace_id,provider,created_by,status,account,snapshot,last_sync_at) values($1,$2,$3,$4,'connected',$5,$6,'2026-10-02')",[uuid(50+i),w,p,owner,JSON.stringify({id:'account-1',name:'Label'}),JSON.stringify({start:'2026-10-01',end:'2026-10-02',metrics})]);
   if(['xero','clockify'].includes(p)) await db.query("insert into reporting_history_facts values($1,$2,$3,'record-1','2026-10-01',$4)",[w,p,uuid(50+i),JSON.stringify(metrics)]);
 }
 await db.query("insert into loyverse_connections(id,workspace_id,created_by,status,merchant_id,currency_code) values($1,$2,$3,'connected',$4,'USD')",[uuid(60),w,owner,uuid(70)]);
 await db.query("insert into zoho_books_connections(id,workspace_id,created_by,status,organization_id,currency_code) values($1,$2,$3,'connected','12345','USD')",[uuid(61),w,owner]);
 await db.query("insert into wix_order_connections(id,workspace_id,created_by,status,instance_hash,site_id) values($1,$2,$3,'connected',$4,$5)",[uuid(62),w,owner,'a'.repeat(64),uuid(71)]);
 for(const [p,c] of [['xero',uuid(50)],['clockify',uuid(51)],['toggl',uuid(52)],['zoho-inventory',uuid(53)],['katana',uuid(54)],['loyverse',uuid(60)],['zoho-books',uuid(61)],['wix-orders',uuid(62)]]) {
   await login(db);const binding=await map(db,p,c);assert.equal((await capture(db,binding)).data.provider,p);
   await admin(db);const table=p==='loyverse'?'loyverse_connections':p==='zoho-books'?'zoho_books_connections':p==='wix-orders'?'wix_order_connections':'reporting_connections';
   await db.query(`update ${table} set status='disconnected' where id=$1`,[c]);await login(db);
   await assert.rejects(capture(db,binding),/evidence_binding_unavailable/);
 }
 await login(db);const binding=await map(db);await admin(db);
 await db.query("update reporting_history_facts set metrics='[{\"key\":\"hours\",\"value\":1,\"note\":\"not allowed\"}]' where provider='harvest'");await login(db);
 await assert.rejects(capture(db,binding),/evidence_metrics_invalid/);
 }finally{await db.close();}
});

test('bounded reads never silently truncate and unsupported providers fail closed',async()=>{
 const db=await setup();try {
 const binding=await map(db);
 await assert.rejects(db.query("select capture_legacy_evidence_v1($1,$2,'2025-01-01','2026-10-01')",[w,binding]),/evidence_period_invalid/);
 await assert.rejects(map(db,'qbo'),/evidence_provider_unsupported/);
 await admin(db);await db.query("insert into reporting_history_facts select $1,'harvest',$2,'generated-'||i,'2026-10-01','[]'::jsonb from generate_series(1,2000) i",[w,conn]);await login(db);
 await assert.rejects(capture(db,binding),/evidence_read_budget_exceeded/);
 }finally{await db.close();}
});

test('historical brief and recursive copies remain restricted; nonowners retain unrelated reports',async()=>{
 const db=await setup({boundary:true,historical:true});try {
 await admin(db);await db.query("insert into reports(id,workspace_id,report_type,created_by) values($1,$2,'Ordinary',$3)",[uuid(35),w,owner]);
 const rows=(await db.query("select artifact_id as id,lineage_state from private.derived_evidence_audiences where artifact_kind='reports' order by artifact_id")).rows;
 assert.equal(rows.filter(r=>r.lineage_state==='legacy_unverified').length,2);
 await login(db,member,memberSession);assert.deepEqual((await db.query('select id from reports')).rows,[{id:uuid(35)}]);
 assert.equal((await db.query('select id from ai_agent_runs')).rows.length,0);
 await login(db);await assert.rejects(db.query("update private.derived_evidence_audiences set lineage_state='source_verified'"),/permission denied/);
 await assert.rejects(db.query("update reports set source_data_json='{}' where id=$1",[uuid(33)]),/evidence_saved_copy_immutable/);
 await assert.rejects(db.query('update reports set workspace_id=$1 where id=$2',[other,uuid(33)]),/evidence_saved_copy_immutable/);
 }finally{await db.close();}
});

test('new brief/VSI copies require real same-workspace source and preserve private VSI access',async()=>{
 const db=await setup({boundary:true});try {
 const insert=async(id,json,workspace=w)=>db.query("insert into reports(id,workspace_id,report_type,title,source_data_json,body_markdown,created_by) values($1,$2,'Saved Analysis','Title',$3,E'# Title\\n\\nExisting answer',$4)",[id,workspace,JSON.stringify(json),owner]);
 const brief={analysis_type:'weekly_briefing',source_artifact:{id:uuid(30),workflow:'intelligence_briefing_v1'},artifact:{contractId:'intelligence_briefing_v1',fixture:true}};
 await insert(uuid(40),brief);
 await assert.rejects(insert(uuid(41),{...brief,artifact:{forged:true}}),/evidence_saved_source_unavailable/);
 await assert.rejects(insert(uuid(41),brief,other),/square_production_customer_owner_denied/);
 await assert.rejects(insert(uuid(41),{...brief,source_artifact:{id:uuid(30),workflow:'ordinary'}}),/evidence_saved_source_required/);
 const vsi={analysis_type:'vsi',source_artifact:{id:uuid(32),workflow:'vsi'},artifact:{exchangeId:uuid(32),citations:[]},display:{summary:'Existing question',sections:[{body:'Existing answer'}]}};
 await assert.rejects(insert(uuid(41),{...vsi,artifact:{forged:true}}),/evidence_saved_source_unavailable/);
 await assert.rejects(insert(uuid(41),{...vsi,display:{summary:'Existing question',sections:[{body:'Forged'}]}}),/evidence_saved_source_unavailable/);
 await insert(uuid(42),vsi);
 await insert(uuid(43),{source_artifact:{id:uuid(42),workflow:'saved_report'}});
 await login(db,owner2,secondSession);assert.equal((await db.query('select id from vsi_exchanges')).rows.length,0);
 assert.deepEqual((await db.query('select id from reports')).rows,[{id:uuid(40)}]);
 await login(db,member,memberSession);assert.equal((await db.query('select id from reports')).rows.length,0);
 await assert.rejects(db.query("insert into ai_agent_runs(id,workspace_id,agent_type,status,created_by) values($1,$2,'intelligence_briefing_v1','processing',$3)",[uuid(44),w,member]),/evidence_creator_owner_required/);
 }finally{await db.close();}
});

test('review regressions: unverified ancestry, owner lifecycle, anonymous restriction and source removal',async()=>{
 const db=await setup({boundary:true,historical:true});try {
 await db.query("insert into reports(id,workspace_id,report_type,body_markdown,source_data_json,created_by) values($1,$2,'Saved Analysis','Historical text',$3,$4)",[uuid(81),w,JSON.stringify({source_artifact:{id:uuid(33),workflow:'saved_report'}}),owner]);
 await admin(db);assert.equal((await db.query("select lineage_state from private.derived_evidence_audiences where artifact_kind='reports' and artifact_id=$1",[uuid(81)])).rows[0].lineage_state,'legacy_unverified');
 await admin(db);await db.query("update workspace_members set role='admin' where user_id=$1",[owner]);await login(db,owner2,secondSession);
 await db.query("update ai_agent_runs set archived_at='2026-10-23T01:00:00Z' where id=$1",[uuid(30)]);
 assert.ok((await db.query('select archived_at from ai_agent_runs where id=$1',[uuid(30)])).rows[0].archived_at);
 await admin(db);await db.query('delete from reports where id=$1',[uuid(33)]);
 assert.equal((await db.query("select count(*)::int as n from private.derived_evidence_audiences where artifact_kind='reports' and artifact_id=$1",[uuid(81)])).rows[0].n,1);
 // Synthetic permissive anon policy proves the new restriction composes with
 // additional permissive policies; not a claim about production anonymous access.
 await db.exec('grant select on reports to anon;create policy synthetic_anon_reports on reports for select to anon using(true);');
 await login(db,owner,session,'anon');
 assert.equal((await db.query('select id from reports')).rows.length,0);
 }finally{await db.close();}
});

test('workspace/entity erasure removes references while direct reference mutation stays denied',async()=>{
 const db=await setup();try {
 let binding=await map(db);await capture(db,binding);await admin(db);
 await db.query('delete from business_entities where workspace_id=$1 and id=$2',[w,entity]);
 assert.equal((await db.query('select count(*)::int as n from private.legacy_evidence_references')).rows[0].n,0);
 await db.query("insert into business_entities values($1,$2,'active')",[w,entity]);await login(db);
 binding=await map(db);await capture(db,binding);await admin(db);
 await db.query("insert into private.shared_evidence_manifests(id,workspace_id,actor_id,session_id,target_kind,target_id,attempt,google_sheets_read_ticket_id,input_hash,manifest_hash,parser_contract) values($1,$2,$3,$4,'vsi_request',$5,1,$6,$7,$7,'shared_evidence_v1')",[uuid(90),w,owner,session,uuid(91),uuid(92),'a'.repeat(64)]);
 await db.query("insert into private.shared_evidence_manifest_sources values($1,$2,0,'legacy_reference','{}',$3)",[w,uuid(90),'a'.repeat(64)]);
 await assert.rejects(db.query('delete from private.shared_evidence_manifests'),/evidence_manifest_immutable/);
 await db.query('delete from workspaces where id=$1',[w]);
 for(const table of ['legacy_evidence_bindings','legacy_evidence_references','shared_evidence_manifests','shared_evidence_manifest_sources']) assert.equal((await db.query(`select count(*)::int as n from private.${table}`)).rows[0].n,0);
 }finally{await db.close();}
});
test('sealed VSI request composes with deployed mutation/accounting bodies and denies old completion',async()=>{
 const {db,ref}=await manifestSetup();try {
 const sealed=await seal(db,ref);assert.equal(sealed.stage,'database_bound');
 assert.equal((await db.query('select validate_shared_evidence_manifest_v1($1,$2,$3,$4,1) as ok',[w,sealed.manifest_id,'vsi_request',uuid(103)])).rows[0].ok,true);
 await login(db,owner,session,'service_role');
 await assert.rejects(settle(db,sealed.manifest_id,settlement(),2),/shared_evidence_commit_required/);
 await assert.rejects(settle(db,sealed.manifest_id,settlement({question:'Substituted question'})),/shared_evidence_question_changed/);
 assert.equal((await settle(db,sealed.manifest_id)).state,'settled');await admin(db);
 assert.equal((await db.query('select answer from vsi_exchanges where id=$1',[uuid(103)])).rows[0].answer,'Supported fixture answer');
 assert.equal((await db.query('select count(*)::int as n from private.shared_evidence_artifact_manifests')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int as n from private.shared_evidence_commit_claims')).rows[0].n,0);
 assert.equal(Number((await db.query('select cost_usd from vsi_requests where id=$1',[uuid(103)])).rows[0].cost_usd),0.03);
 await assert.rejects(db.query("update vsi_conversations set context_summary='Stripped lineage' where id=$1",[uuid(102)]),/shared_evidence_context_changed/);
 }finally{await db.close();}
});
test('revocation between validation and commit prevents saving; actual failed cost settles once',async()=>{
 const {db,ref}=await manifestSetup();try {
 const sealed=await seal(db,ref);
 await db.query('select validate_shared_evidence_manifest_v1($1,$2,$3,$4,1)',[w,sealed.manifest_id,'vsi_request',uuid(103)]);
 await admin(db);await db.query("update reporting_history_facts set metrics='[{\"key\":\"hours\",\"value\":12}]'");await login(db,owner,session,'service_role');
 await assert.rejects(settle(db,sealed.manifest_id),/shared_evidence_source_changed/);
 assert.equal((await settle(db,sealed.manifest_id,settlement({answer:''}))).state,'settled');
 assert.equal((await settle(db,sealed.manifest_id,settlement({answer:''}))).error,'stale_attempt');
 await admin(db);assert.equal((await db.query('select count(*)::int as n from vsi_exchanges')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int as n from vsi_cost_events')).rows[0].n,1);
 assert.equal(Number((await db.query('select cost_usd from vsi_requests where id=$1',[uuid(103)])).rows[0].cost_usd),0.03);
 }finally{await db.close();}
});
test('manifest rejects other session/attempt, duplicate seals, changed ticket and unsupported identities',async()=>{
 const {db,ref}=await manifestSetup();try {
 await assert.rejects(db.query('select seal_shared_evidence_manifest_v1($1,$2,$3,1,$4,$5,$6)',[w,'vsi_request',uuid(103),uuid(101),JSON.stringify([{kind:'qbo_version',source_id:uuid(200)}]),[]]),/source_kind_unimplemented/);
 const sealed=await seal(db,ref);await assert.rejects(seal(db,ref),/unique constraint/);
 await assert.rejects(db.query('select validate_shared_evidence_manifest_v1($1,$2,$3,$4,2)',[w,sealed.manifest_id,'vsi_request',uuid(103)]),/manifest_denied/);
 await login(db,owner2,secondSession);await assert.rejects(db.query('select validate_shared_evidence_manifest_v1($1,$2,$3,$4,1)',[w,sealed.manifest_id,'vsi_request',uuid(103)]),/manifest_denied/);
 await admin(db);await db.query('update private.google_sheets_read_tickets set unattributed=true where id=$1',[uuid(101)]);await login(db,owner,session,'service_role');
 await assert.rejects(settle(db,sealed.manifest_id),/unattributed_source/);
 }finally{await db.close();}
});
test('marked briefing completes only through the new claim plus existing trusted completion guard',async()=>{
 const {db,ref}=await manifestSetup();try {
 const input={workflow:'intelligence_briefing_v1',google_sheets_read_ticket_id:uuid(101),shared_evidence_contract:'shared_evidence_v1',generation_key:'fixture-key',briefing_type:'weekly'};
 await admin(db);await login(db,owner,session,'service_role');
 // Fixture run creation precedes admission, as the existing trusted create RPC does.
 await admin(db);await db.query("insert into ai_agent_runs(id,workspace_id,agent_type,input_json,status,created_by,trusted_source) values($1,$2,'intelligence_briefing_v1',$3,'processing',$4,true)",[uuid(110),w,JSON.stringify(input),owner]);await login(db);
 const sealed=await seal(db,ref,{kind:'briefing_run',id:uuid(110)});
 const output={contractId:'intelligence_briefing_v1',workspaceId:w,briefingType:'weekly',generationKey:'fixture-key'};
 const args=[w,uuid(110),owner,session,uuid(101),'intelligence_briefing_v1',JSON.stringify(output)];await login(db,owner,session,'service_role');
 await assert.rejects(db.query('select complete_trusted_derived_run_v1($1,$2,$3,$4,$5,$6,$7)',args),/shared_evidence_output_changed/);
 await db.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8)',[...args,sealed.manifest_id]);await admin(db);
 assert.equal((await db.query('select status from ai_agent_runs where id=$1',[uuid(110)])).rows[0].status,'completed');
 assert.equal((await db.query('select count(*)::int as n from private.trusted_derived_run_commits')).rows[0].n,0);
 await login(db);await admin(db);await db.query("update ai_agent_runs set archived_at=clock_timestamp() where id=$1",[uuid(110)]);
 }finally{await db.close();}
});
test('review: later turn cannot use old settlement; inheritance retains exact source and actor audience',async()=>{
 const {db,ref}=await manifestSetup();try {
 const parent=await finishedVsi(db,ref);const id=await newRequest(db);
 await login(db,owner,session,'service_role');await assert.rejects(settle(db,null,settlement({id,summary:'Fixture summary'}),2),/shared_evidence_commit_required/);await login(db);
 await assert.rejects(seal(db,ref,{id}),/inherited_dependency_missing/);
 const sealed=await seal(db,ref,{id,inherited:[parent]});assert.equal(sealed.stage,'database_bound');
 await admin(db);assert.equal((await db.query("select count(*)::int n from private.shared_evidence_manifest_sources where manifest_id=$1 and source_kind='inherited_artifact'",[sealed.manifest_id])).rows[0].n,1);
 await login(db,owner,session,'service_role');await settle(db,sealed.manifest_id,settlement({id,summary:'Second supported summary'}));
 // The parent exchange, not an obsolete mutable summary revision, remains valid.
 const third=await newRequest(db,122);await seal(db,ref,{id:third,inherited:[parent,sealed.manifest_id]});
 const brief=await newBrief(db);await assert.rejects(seal(db,ref,{kind:'briefing_run',id:brief,inherited:[parent]}),/private_brief_input_denied/);
 }finally{await db.close();}
});
test('review: inherited artifact removal is detected even when original metrics remain unchanged',async()=>{
 const {db,ref}=await manifestSetup();try {
 const parent=await finishedVsi(db,ref);const id=await newRequest(db);const sealed=await seal(db,ref,{id,inherited:[parent]});
 await admin(db);await db.query('delete from vsi_exchanges where id=$1',[uuid(103)]);await login(db);
 await assert.rejects(db.query('select validate_shared_evidence_manifest_v1($1,$2,$3,$4,1)',[w,sealed.manifest_id,'vsi_request',id]),/inherited_artifact_changed/);
 }finally{await db.close();}
});
test('review: saved copies propagate lineage; report removal and private actor substitution deny inheritance',async()=>{
 const {db,ref}=await manifestSetup();try {
 await admin(db);await db.exec('grant select,insert on reports to authenticated;');await login(db);
 const parent=await finishedVsi(db,ref);const report=await saveVsi(db);
 await db.query("insert into reports(id,workspace_id,report_type,body_markdown,source_data_json,created_by) values($1,$2,'Saved Analysis',E'# Title\\n\\nSupported fixture answer',$3,$4)",[uuid(131),w,JSON.stringify({source_artifact:{id:report,workflow:'saved_report'}}),owner]);
 await admin(db);assert.equal((await db.query("select count(*)::int n from private.shared_evidence_artifact_manifests where artifact_kind='report'")).rows[0].n,2);
 await login(db,owner2,secondSession);await assert.rejects(db.query("insert into reports(id,workspace_id,report_type,body_markdown,source_data_json,created_by) values($1,$2,'Saved Analysis',E'# Title\\n\\nSupported fixture answer',$3,$4)",[uuid(132),w,JSON.stringify({source_artifact:{id:report,workflow:'saved_report'}}),owner2]),/saved_copy_denied/);
 await admin(db);await db.query('update private.google_sheets_read_tickets set sources=$1 where id=$2',[JSON.stringify([{table:'reports',id:report}]),uuid(101)]);
 const id=await newRequest(db);const sealed=await seal(db,ref,{id,inherited:[parent]});
 await admin(db);await db.query('delete from reports where id=$1',[report]);await login(db);
 await assert.rejects(db.query('select validate_shared_evidence_manifest_v1($1,$2,$3,$4,1)',[w,sealed.manifest_id,'vsi_request',id]),/inherited_artifact_changed/);
 }finally{await db.close();}
});
test('review: creator demotion permits trusted failure cleanup without allowing output changes',async()=>{
 const {db,ref}=await manifestSetup();try {
 const id=await newBrief(db);await seal(db,ref,{kind:'briefing_run',id});
 await admin(db);await db.query("update workspace_members set role='admin' where user_id=$1",[owner]);
 await assert.rejects(db.query("update ai_agent_runs set status='failed' where id=$1",[id]),/trusted_derived_run_commit_required/);
 await login(db,owner,session,'service_role');await db.query('select fail_trusted_derived_run_v1($1,$2,$3,$4,$5,$6)',[w,id,owner,session,uuid(101),'intelligence_briefing_v1']);
 await admin(db);assert.equal((await db.query('select status from ai_agent_runs where id=$1',[id])).rows[0].status,'failed');
 }finally{await db.close();}
});

test('review: copy of copy cannot hide deleted parent; sealed exchange identity cannot be rewritten',async()=>{
 const {db,ref}=await manifestSetup();try {
 await admin(db);await db.exec('grant select,insert on reports to authenticated;');await login(db);
 const parent=await finishedVsi(db,ref);const report=await saveVsi(db);
 await db.query("insert into reports(id,workspace_id,report_type,body_markdown,source_data_json,created_by) values($1,$2,'Saved Analysis',E'# Title\\n\\nSupported fixture answer',$3,$4)",[uuid(131),w,JSON.stringify({source_artifact:{id:report,workflow:'saved_report'}}),owner]);
 await admin(db);await assert.rejects(db.query('update vsi_exchanges set id=$1 where id=$2',[uuid(190),uuid(103)]),/exchange_immutable/);
 await db.query('update private.google_sheets_read_tickets set sources=$1 where id=$2',[JSON.stringify([{table:'reports',id:uuid(131)}]),uuid(101)]);
 const id=await newRequest(db);const sealed=await seal(db,ref,{id,inherited:[parent]});
 await admin(db);await db.query('delete from reports where id=$1',[report]);await login(db);
 await assert.rejects(db.query('select validate_shared_evidence_manifest_v1($1,$2,$3,$4,1)',[w,sealed.manifest_id,'vsi_request',id]),/inherited_artifact_changed/);
 }finally{await db.close();}
});

test('review: normal conversation deletion preserves billed request and makes inherited output unavailable',async()=>{
 const {db,ref}=await manifestSetup();try {
 await finishedVsi(db,ref);await login(db,owner,session,'service_role');
 const out=(await db.query('select vsi_mutate_v2($1,$2,$3,$4,$5) v',[w,owner,'delete',JSON.stringify({conversationId:uuid(102)}),session])).rows[0].v;
 await admin(db);assert.equal((await db.query('select count(*)::int n from vsi_conversations')).rows[0].n,0);
 const row=(await db.query('select conversation_id,cost_usd from vsi_requests where id=$1',[uuid(103)])).rows[0];assert.equal(row.conversation_id,null);assert.equal(Number(row.cost_usd),0.03);
 await db.query('delete from workspaces where id=$1',[w]);assert.equal((await db.query('select count(*)::int n from private.shared_evidence_artifact_manifests')).rows[0].n,0);
 }finally{await db.close();}
});

test('review: old wrappers cannot omit opt-in marker when bound ticket reads sealed report',async()=>{
 const {db,ref}=await manifestSetup();try {
 await admin(db);await db.exec('grant select,insert on reports to authenticated;');await login(db);
 await finishedVsi(db,ref);const report=await saveVsi(db);
 await admin(db);await db.query('update private.google_sheets_read_tickets set sources=$1 where id=$2',[JSON.stringify([{table:'reports',id:report}]),uuid(101)]);
 const input={workflow:'intelligence_briefing_v1',google_sheets_read_ticket_id:uuid(101),generation_key:'fixture-key',briefing_type:'weekly'};
 await db.query("insert into ai_agent_runs(id,workspace_id,agent_type,input_json,status,created_by,trusted_source) values($1,$2,'intelligence_briefing_v1',$3,'processing',$4,true)",[uuid(150),w,JSON.stringify(input),owner]);
 const output={contractId:'intelligence_briefing_v1',workspaceId:w,briefingType:'weekly',generationKey:'fixture-key'};
 await login(db,owner,session,'service_role');await assert.rejects(db.query('select complete_trusted_derived_run_v1($1,$2,$3,$4,$5,$6,$7)',[w,uuid(150),owner,session,uuid(101),'intelligence_briefing_v1',JSON.stringify(output)]),/shared_evidence_output_changed/);
 await admin(db);await db.query("insert into vsi_conversations(id,workspace_id,actor_user_id,actor_role) values($1,$2,$3,'owner')",[uuid(151),w,owner]);
 await db.query("insert into vsi_requests(id,workspace_id,actor_user_id,conversation_id,request_id,question_hash,status,reservation_usd,lease_until) values($1,$2,$3,$4,$5,encode(sha256(convert_to('Question','UTF8')),'hex'),'pending',0.1,clock_timestamp()+interval '1 hour')",[uuid(152),w,owner,uuid(151),uuid(153)]);
 await login(db,owner,session,'service_role');await assert.rejects(settle(db,null,settlement({id:uuid(152),conversationId:uuid(151)}),2),/shared_evidence_commit_required/);
 }finally{await db.close();}
});
test('typed Square admission binds equal-timestamp edits, lifecycle, exact payment and tenant',async()=>{
 const {db}=await typedSetup();try{
 const selected={kind:'square_payment',connection_id:uuid(210),payment_id:'payment:1'};const r=await typedRead(db,selected);
 assert.equal(r.data.amount_minor,'12345');assert.equal(r.data.coverage,'unknown');
 await assert.rejects(typedRead(db,selected,other),/owner_denied/);await assert.rejects(typedRead(db,{...selected,table:'arbitrary'}),/identity_invalid/);
 const sealed=await typedSeal(db,[r.identity]);await login(db,owner,session,'service_role');await settle(db,sealed.manifest_id);await admin(db);
 assert.equal((await db.query('select count(*)::int n from vsi_exchanges')).rows[0].n,1);
 await db.query("update square_customer_private.payments set amount_minor=12346 where payment_id='payment:1'");await login(db);
 assert.notEqual((await typedRead(db,selected)).hash,r.hash);
 await admin(db);await db.query("update square_customer_private.connections set state='disconnected'");await login(db);await assert.rejects(typedRead(db,selected),/square_denied/);
 await login(db,owner,session,'service_role');await assert.rejects(typedRead(db,selected),/permission denied/);
 }finally{await db.close();}
});
test('typed QBO requires exact valid current canonical version, mapping and validation work',async()=>{
 const {db}=await typedSetup();try{
 const projection={contractVersion:'qbo_source_record_minimized_v1',provider:{providerKey:'quickbooks_online',sourceEnvironment:'production'},recordType:'Invoice',id:'invoice1',minimizationVersion:'qbo_minimizer_v1',status:'active',temporal:{postingDate:'2026-10-01'},accounting:{basis:'accrual',sourceCurrency:'USD'},amounts:{total:{amount:'100',currency:'USD'}}};
 await admin(db);await db.exec(`insert into private.integration_connections values('${uuid(220)}','${w}','${entity}','quickbooks_online','production','active',1);
 insert into private.provider_entity_mappings values('${uuid(221)}','${w}','${entity}','${uuid(220)}','quickbooks_online','production','active',now(),1);
 insert into private.external_source_records values('${uuid(222)}','${w}','${entity}','${uuid(220)}','${uuid(221)}','quickbooks_online','provider','active','${uuid(223)}','Invoice','invoice1');`);
 await db.query("insert into private.external_source_record_versions(id,workspace_id,business_entity_id,connection_id,source_record_id,provider_key,source_kind,provider_record_type,provider_record_id,validation_state,normalized_projection) values($1,$2,$3,$4,$5,'quickbooks_online','provider','Invoice','invoice1','valid',$6)",[uuid(223),w,entity,uuid(220),uuid(222),JSON.stringify(projection)]);
 await db.exec("update private.external_source_record_versions set accounting_currency='USD',accounting_basis='accrual',posting_date='2026-10-01'");
 await db.query("insert into private.qbo_production_source_validation_work values($1,$2,$3,$4,$5,$6,null,'valid')",[w,entity,uuid(220),uuid(221),uuid(222),uuid(223)]);await login(db);
 const r=await typedRead(db,{kind:'qbo_version',source_id:uuid(222)});assert.equal(r.identity.version_id,uuid(223));assert.equal(r.data.additive,false);assert.equal(r.data.preview.amounts.total.amount,'100');
 await admin(db);await db.exec("update private.external_source_record_versions set accounting_currency='EUR'");await login(db);
 await assert.rejects(typedRead(db,{kind:'qbo_version',source_id:uuid(222)}),/qbo_scope_mismatch/);
 await admin(db);await db.exec("update private.external_source_record_versions set accounting_currency='USD'");await login(db);
 const sealed=await typedSeal(db,[r.identity]);await admin(db);await db.query("update private.qbo_production_source_validation_work set state='quarantined'");await login(db,owner,session,'service_role');await assert.rejects(settle(db,sealed.manifest_id),/qbo_denied/);
 await admin(db);await db.exec("update private.qbo_production_source_validation_work set state='valid';update private.provider_entity_mappings set status='inactive'");await login(db);await assert.rejects(typedRead(db,{kind:'qbo_version',source_id:uuid(222)}),/qbo_denied/);
 }finally{await db.close();}
});
test('file/note provenance preview preserves authority and revocation; semantic admission remains blocked',async()=>{
 const {db}=await typedSetup();try{
 const authority={eligible:true,mode:'reviewed_document_extraction',reason:'eligible',job_id:uuid(230),review_id:uuid(231),artifact_fingerprint:'a'.repeat(64),classification_fingerprint:'b'.repeat(64),review_version:3};
 const envelope={...authority};delete envelope.eligible;delete envelope.mode;delete envelope.reason;
 await admin(db);await db.query('insert into file_uploads(id,workspace_id) values($1,$2)',[uuid(232),w]);await db.query('insert into private.fixture_document_authority values($1,$2,$3)',[uuid(232),w,JSON.stringify(authority)]);
 await db.query("insert into business_memory_chunks values($1,$2,$3,'file_analysis',$3,true,null,null,$4,$5,'Reviewed 10kg','Reviewed fact',0)",[uuid(233),w,uuid(232),JSON.stringify({document_extraction_authority:envelope,evidence_classification:'business_evidence'}),'c'.repeat(64)]);
 await db.query("insert into business_notes(id,workspace_id,status,evidence_lifecycle_status,trusted_approval,lifecycle_provenance_id,release_channel,approved_at,source_version,source_text_hash,original_note_text,reviewed_extraction_json,source_spans_json,user_corrections_json,approved_by) values($1,$2,'approved','active',true,$3,'production',now(),1,$4,'Supplier changed','{}','[]','{}',$5)",[uuid(234),w,uuid(235),'d'.repeat(64),owner]);
 await db.query("insert into business_memory_chunks values($1,$2,$3,'business_note',null,true,null,null,$4,encode(sha256(convert_to(($3::uuid)::text||':1:0:The business reported a supplier change','UTF8')),'hex'),'The business reported a supplier change','Context',0)",[uuid(236),w,uuid(234),JSON.stringify({source_version:1,release_channel:'production',review_status:'approved'})]);
 await login(db);const f=await typedRead(db,{kind:'approved_file_fact',chunk_id:uuid(233)});const n=await typedRead(db,{kind:'approved_note',chunk_id:uuid(236)});assert.equal(f.data.entity_id,null);assert.equal(n.data.treatment,'supporting_context');assert.equal(n.data.excerpt,undefined);
 await assert.rejects(typedSeal(db,[f.identity,n.identity]),/semantic_admission_unqualified/);
 await admin(db);await db.query('update private.google_sheets_read_tickets set sources=$1 where id=$2',[JSON.stringify([...f.data.read_sources,...n.data.read_sources]),uuid(101)]);await login(db);
 await assert.rejects(typedSeal(db,[f.identity,n.identity]),/semantic_admission_unqualified/);
 await admin(db);await db.query("update business_memory_chunks set source_metadata=source_metadata||jsonb_build_object('source_run_id',$1::text) where id=$2",[uuid(237),uuid(233)]);await login(db);
 await assert.rejects(typedRead(db,{kind:'approved_file_fact',chunk_id:uuid(233)}),/parent_run_denied/);
 await admin(db);await db.query("update business_memory_chunks set source_metadata=source_metadata-'source_run_id' where id=$1",[uuid(233)]);
 await db.query("update business_notes set status='archived'");await login(db);await assert.rejects(typedRead(db,{kind:'approved_note',chunk_id:uuid(236)}),/note_denied/);
 await admin(db);await db.exec("update business_notes set status='approved';update business_memory_chunks set source_metadata=source_metadata||'{\"source_version\":2}' where source_type='business_note'");await login(db);await assert.rejects(typedRead(db,{kind:'approved_note',chunk_id:uuid(236)}),/note_denied/);
 await admin(db);await db.exec("update private.fixture_document_authority set authority=authority||'{\"eligible\":false}'");await login(db);await assert.rejects(typedRead(db,{kind:'approved_file_fact',chunk_id:uuid(233)}),/file_authority_denied/);
 }finally{await db.close();}
});

test('typed leaf admission cannot smuggle private inherited artifact into owner-wide brief',async()=>{
 const {db,ref}=await typedSetup();try{
 const parent=await finishedVsi(db,ref);const id=await newBrief(db);await admin(db);
 const link=(await db.query("select * from private.shared_evidence_artifact_manifests where manifest_id=$1 and artifact_kind='vsi_exchange'",[parent])).rows[0];await login(db);
 const identity={kind:'inherited_artifact',parent_manifest_id:parent,artifact_kind:'vsi_exchange',artifact_id:link.artifact_id,artifact_revision:link.artifact_revision};
 await assert.rejects(db.query('select seal_shared_evidence_manifest_v1($1,$2,$3,1,$4,$5,$6)',[w,'briefing_run',id,uuid(101),JSON.stringify([identity]),[]]),/direct_source_kind_denied/);
 }finally{await db.close();}
});

test('unqualified file/note originals cannot reenter through saved manifest inheritance or reopening',async()=>{
 for(const kind of ['approved_file_fact','approved_note']) {
 const {db,ref}=await typedSetup();try{
 const parent=await finishedVsi(db,ref);await admin(db);
 await db.exec(read('docs/security-drafts/07-reopen-shared-artifact.sql'));
 // Privileged synthetic historical fixture, never an application write path.
 // A pre-existing source cannot become eligible merely by being inherited.
 await db.query('insert into private.shared_evidence_manifest_sources values($1,$2,1,$3,$4,$5)',
  [w,parent,kind,JSON.stringify({kind,chunk_id:uuid(299),authority_hash:'a'.repeat(64)}),'a'.repeat(64)]);
 const revision=(await db.query("select artifact_revision from private.shared_evidence_artifact_manifests where manifest_id=$1 and artifact_kind='vsi_exchange'",[parent])).rows[0].artifact_revision;
 await login(db);await assert.rejects(db.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4)',[w,'vsi_exchange',uuid(103),revision]),/semantic_admission_unqualified/);
 const id=await newRequest(db);await assert.rejects(seal(db,ref,{id,inherited:[parent]}),/semantic_admission_unqualified/);
 }finally{await db.close();}
 }
});

test('Sheets shared projection preserves accepted current metric/version/mapping and ticket roots',async()=>{
 const {db}=await typedSetup();try {
 await admin(db);await sheetsFixture(db);await db.exec(read('docs/security-drafts/08-sheets-projection.sql'));await login(db);
 const source=await typedRead(db,{kind:'sheets_ticket_source',source_id:uuid(302)});assert.equal(source.data.metrics[0].value,'17');assert.equal(source.data.coverage,'unknown');
 await admin(db);await db.exec(`create or replace function public.google_sheets_record_readable_v1(w uuid,t text,i uuid) returns boolean language sql as $$select t<>'google_sheets_source_rows'$$;`);await login(db);
 await assert.rejects(typedRead(db,{kind:'sheets_ticket_source',source_id:uuid(302)}),/typed_sheets_denied/);
 await admin(db);await db.exec(`create or replace function public.google_sheets_record_readable_v1(w uuid,t text,i uuid) returns boolean language sql as $$select true$$;`);await login(db);
 await assert.rejects(typedSeal(db,[source.identity]),/ticket_dependency_missing/);
 await admin(db);await db.query('update private.google_sheets_read_tickets set sources=$1 where id=$2',[JSON.stringify(source.data.read_sources),uuid(101)]);await login(db);
 const sealed=await typedSeal(db,[source.identity]);await admin(db);await db.exec("update google_sheets_fact_links set admission_state='review_required'");await login(db,owner,session,'service_role');
 await assert.rejects(settle(db,sealed.manifest_id),/no_admitted_metrics/);
 }finally{await db.close();}
});

test('Katana installation never replaces connected credential identity under an existing reference',async()=>{
 const db=await setup();try {
 await admin(db);await db.exec('create table reporting_credentials(workspace_id uuid,provider text,connection_id uuid,ciphertext text);');
 await db.exec(read('docs/security-drafts/09-katana-installation-boundary.sql'));
 await db.query("insert into reporting_connections(id,workspace_id,provider,created_by,status,account) values($1,$2,'katana',$3,'pending',$4)",[uuid(310),w,owner,JSON.stringify({id:'key-account',name:'Katana'})]);
 await db.query("insert into reporting_credentials values($1,'katana',$2,'synthetic fixture')",[w,uuid(310)]);
 const before=(await db.query('select nonce from private.katana_evidence_installations where connection_id=$1',[uuid(310)])).rows[0].nonce;
 await db.query("update reporting_connections set status='choose_account' where id=$1",[uuid(310)]);
 await db.query("update reporting_credentials set ciphertext='synthetic selected fixture' where connection_id=$1",[uuid(310)]);
 assert.notEqual((await db.query('select nonce from private.katana_evidence_installations where connection_id=$1',[uuid(310)])).rows[0].nonce,before);
 await db.query("update reporting_connections set status='connected' where id=$1",[uuid(310)]);
 await assert.rejects(db.query("update reporting_credentials set ciphertext='synthetic replacement' where connection_id=$1",[uuid(310)]),/new_installation_required/);
 await assert.rejects(db.query("update reporting_connections set status='choose_account' where id=$1",[uuid(310)]),/new_installation_required/);
 await db.query("update reporting_connections set status='reauthorization_required' where id=$1",[uuid(310)]);
 await assert.rejects(db.query("update reporting_credentials set ciphertext='synthetic replacement' where connection_id=$1",[uuid(310)]),/new_installation_required/);
 await assert.rejects(db.query("update reporting_connections set status='choose_account' where id=$1",[uuid(310)]),/new_installation_required/);
 await assert.rejects(db.query("update reporting_connections set status='connected' where id=$1",[uuid(310)]),/new_installation_required/);
 await db.query("update reporting_connections set status='disconnected' where id=$1",[uuid(310)]);await db.query('delete from reporting_credentials where connection_id=$1',[uuid(310)]);
 await assert.rejects(db.query("update reporting_connections set status='pending' where id=$1",[uuid(310)]),/new_installation_required/);
 await assert.rejects(db.query("update reporting_connections set status='connected' where id=$1",[uuid(310)]),/new_installation_required/);
 assert.equal((await db.query('select count(*)::int n from private.katana_evidence_installations where connection_id=$1',[uuid(310)])).rows[0].n,0);
 }finally{await db.close();}
});

test('typed deterministic VSI and brief save/reopen exact citation identities; mutation blocks reopening',async()=>{
 const {db}=await typedSetup();try{
 await admin(db);await db.exec(read('docs/security-drafts/07-reopen-shared-artifact.sql'));await login(db);
 const source=await typedRead(db,{kind:'square_payment',connection_id:uuid(210),payment_id:'payment:1'});
 const vsi=await typedSeal(db,[source.identity]);await login(db,owner,session,'service_role');await settle(db,vsi.manifest_id);
 await admin(db);const revision=(await db.query("select artifact_revision from private.shared_evidence_artifact_manifests where manifest_id=$1 and artifact_kind='vsi_exchange'",[vsi.manifest_id])).rows[0].artifact_revision;
 await login(db);const reopen=async(kind,id,hash)=>(await db.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4) v',[w,kind,id,hash])).rows[0].v;
 assert.deepEqual((await reopen('vsi_exchange',uuid(103),revision)).projections[0].identity,source.identity);
 await login(db,owner2,secondSession);await assert.rejects(reopen('vsi_exchange',uuid(103),revision),/inherited_actor_denied/);await login(db);
 const id=await newBrief(db);const brief=(await db.query('select seal_shared_evidence_manifest_v1($1,$2,$3,1,$4,$5,$6) v',[w,'briefing_run',id,uuid(101),JSON.stringify([source.identity]),[]])).rows[0].v;
 const output={contractId:'intelligence_briefing_v1',workspaceId:w,briefingType:'weekly',generationKey:'fixture-key'};
 await login(db,owner,session,'service_role');await db.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8)',[w,id,owner,session,uuid(101),'intelligence_briefing_v1',JSON.stringify(output),brief.manifest_id]);
 await admin(db);const briefRevision=(await db.query("select artifact_revision from private.shared_evidence_artifact_manifests where manifest_id=$1 and artifact_kind='briefing_run'",[brief.manifest_id])).rows[0].artifact_revision;
 await login(db,owner2,secondSession);assert.deepEqual((await reopen('briefing_run',id,briefRevision)).projections[0].identity,source.identity);
 await admin(db);await db.query("update square_customer_private.payments set amount_minor=amount_minor+1");await login(db);
 await assert.rejects(reopen('vsi_exchange',uuid(103),revision),/typed_identity_changed/);await assert.rejects(reopen('briefing_run',id,briefRevision),/typed_identity_changed/);
 await assert.rejects(typedRead(db,source.identity),/typed_identity_changed/);
 }finally{await db.close();}
});


test('semantic receipt requires exact service attestation; immutable proof cannot survive source changes',async()=>{
 const {db}=await typedSetup();try {
 await admin(db);await db.exec(read('docs/security-drafts/10-memory-semantic-receipts.sql'));
 await db.query('insert into file_uploads(id,workspace_id) values($1,$2)',[uuid(332),w]);
 await db.query('insert into private.fixture_document_authority values($1,$2,$3)',[uuid(332),w,JSON.stringify({eligible:true,mode:'existing_native_file_analysis'})]);
 await db.query("insert into business_memory_chunks values($1,$2,$3,'file_analysis',$3,true,null,null,$4,$5,'Reviewed record','Reviewed record',0)",[uuid(333),w,uuid(332),JSON.stringify({evidence_classification:'business_evidence',review_status:'approved'}),'e'.repeat(64)]);
 await login(db);const f=await typedRead(db,{kind:'approved_file_fact',chunk_id:uuid(333)});
 await admin(db);await db.query('update private.google_sheets_read_tickets set sources=$1 where id=$2',[JSON.stringify(f.data.read_sources),uuid(101)]);await login(db);
 await assert.rejects(typedSeal(db,[f.identity]),/semantic_receipt_required/);
 const certify=(actor=owner,sid=session,identity=f.identity)=>db.query('select certify_shared_memory_semantics_v1($1,$2,$3,$4) v',[w,actor,sid,JSON.stringify(identity)]);
 await assert.rejects(certify(),/permission denied/);await login(db,owner,session,'service_role');
 await assert.rejects(certify(member,memberSession));await assert.rejects(certify(owner,secondSession));
 await assert.rejects(certify(owner,session,{...f.identity,authority_hash:'f'.repeat(64)}),/identity_changed/);
 assert.equal((await certify()).rows[0].v,true);assert.equal((await certify()).rows[0].v,true);
 await assert.rejects(db.query('select * from private.shared_memory_semantic_receipts'),/permission denied/);
 await admin(db);await assert.rejects(db.query("update private.shared_memory_semantic_receipts set certified_by=$1",[owner2]),/immutable/);
 await login(db);const manifest=await typedSeal(db,[f.identity]);
 await admin(db);await db.query("update business_memory_chunks set summary='Changed' where id=$1",[uuid(333)]);await login(db,owner,session,'service_role');
 await assert.rejects(settle(db,manifest.manifest_id),/identity_changed/);
 }finally{await db.close();}
});

test('protected discovery, preview and stable target reopening preserve owner and ancestor checks',async()=>{
 const {db,ref}=await typedSetup();try {
 await admin(db);await sheetsFixture(db);await db.exec(read('docs/security-drafts/08-sheets-projection.sql'));await db.exec(read('docs/security-drafts/07-reopen-shared-artifact.sql'));await db.exec(read('docs/security-drafts/11-generation-discovery.sql'));await login(db);
 const discover=async(workspace=w)=>(await db.query("select discover_shared_evidence_v1($1,'2026-10-01','2026-10-07') v",[workspace])).rows[0].v;
 const catalog=await discover();assert.equal(catalog.stage,'catalog_only');assert.ok(catalog.candidates.some(c=>c.provider==='square'));assert.ok(catalog.candidates.some(c=>c.provider==='google_sheets'));assert.equal(JSON.stringify(catalog).includes('12345'),false);
 await assert.rejects(discover(other));await login(db,member,memberSession);await assert.rejects(discover());await login(db);
 const legacy=catalog.candidates.find(c=>c.identity.kind==='legacy_binding').identity;
 const preview=(await db.query('select preview_shared_legacy_evidence_v1($1,$2,$3,$4) v',[w,legacy.binding_id,legacy.start,legacy.end])).rows[0].v;assert.equal(preview.stage,'unadmitted');
 await finishedVsi(db,ref);
 const reopened=(await db.query("select reopen_shared_evidence_target_v1($1,'vsi_exchange',$2) v",[w,uuid(103)])).rows[0].v;assert.equal(reopened.artifact_id,uuid(103));
 await login(db,owner2,secondSession);await assert.rejects(db.query("select reopen_shared_evidence_target_v1($1,'vsi_exchange',$2)",[w,uuid(103)]),/actor_denied/);
 }finally{await db.close();}
});


test('empty manifest preserves general-answer accounting and cannot omit inherited evidence',async()=>{
 const {db,ref}=await manifestSetup();try {
 const empty=(id)=>db.query('select seal_shared_evidence_manifest_v1($1,$2,$3,1,$4,$5,$6) v',[w,'vsi_request',id,uuid(101),'[]',[]]);
 const sealed=(await empty(uuid(103))).rows[0].v;
 assert.equal((await db.query('select validate_shared_evidence_manifest_v1($1,$2,$3,$4,1) ok',[w,sealed.manifest_id,'vsi_request',uuid(103)])).rows[0].ok,true);
 await login(db,owner,session,'service_role');assert.equal((await settle(db,sealed.manifest_id)).state,'settled');
 await login(db);const next=await newRequest(db,170);
 await assert.rejects(empty(next),/inherited_dependency_missing/);
 }finally{await db.close();}
});

for(const pluginCount of [5,6,12]) test(`actual ${pluginCount}-plugin file/note VSI and brief generation, SQL save and exact citation reopening`,async()=>{
 const {db}=await typedSetup();try {
 await admin(db);await sheetsFixture(db);
 for(const draft of ['07-reopen-shared-artifact.sql','08-sheets-projection.sql','10-memory-semantic-receipts.sql','11-generation-discovery.sql']) await db.exec(read(`docs/security-drafts/${draft}`));
 const {default:run}=await import('./shared-evidence-end-to-end.cjs');
 const result=await run({db,uuid,w,owner,session,entity,login,admin,map,read,newRequest,pluginCount});assert.equal(result.paidCalls,0);console.log(JSON.stringify(result));
 }finally{await db.close();}
});