// Synthetic contract fixture only: partial platform helpers, not deployed trigger parity.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';


const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const draft1 = read('docs/security-drafts/01-legacy-evidence.sql');
const draft2 = read('docs/security-drafts/02-owner-artifact-boundary.sql');
const draft3 = read('docs/security-drafts/03-generation-manifest-schema.sql');
// Local captured contracts are deliberately not shipped in the candidate.
// No network fallback, credential lookup, or automatic metadata retrieval.
const privateFixtureDir=process.env.SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR;
assert(privateFixtureDir && isAbsolute(privateFixtureDir),'Set SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR to the existing local screened captures; never upload them to CI.');
const readCapture=name=>JSON.parse(readFileSync(join(privateFixtureDir,name),'utf8'));
const deployed = readCapture('deployed-contracts.json');
const definition = name => deployed.functions.find(f => f.proname === name).definition;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const w=uuid(1), other=uuid(2), owner=uuid(3), member=uuid(4), owner2=uuid(5), session=uuid(6), memberSession=uuid(7), secondSession=uuid(8), entity=uuid(9), otherEntity=uuid(10), conn=uuid(11);
const sourceTables = [
 ['20261019001207_ready_account_reporting_connectors.sql',['reporting_connections']],
 ['20261019070945_reporting_import_history.sql',['reporting_history_facts','reporting_history_days']],
 ['20261017013603_loyverse_read_only_connection.sql',['loyverse_connections','loyverse_receipt_facts']],
 ['20261019070953_loyverse_import_history.sql',['loyverse_import_days']],
 ['20261017023221_zoho_books_read_only_connection.sql',['zoho_books_connections']],
 ['20261019070949_zoho_books_import_history.sql',['zoho_books_history_facts','zoho_books_history_coverage']],
 ['20261017051502_wix_orders_read_only_connection.sql',['wix_order_connections','wix_order_facts']],
 ['20261019071008_wix_orders_import_history.sql',['wix_order_import_days']],
];

async function login(db, actor=owner, sid=session, role='authenticated') {
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,session_id:sid,role})]);
 await db.exec(`set role ${role}`);
}
async function admin(db) { await db.exec('reset role'); }
async function setup({boundary=false, historical=false, createDatabase=async()=>new PGlite()}={}) {
 const db=await createDatabase();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema private;
 create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
 create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid not null,revoked boolean not null default false,not_after timestamptz);
 create table public.workspaces(id uuid primary key);create table public.profiles(id uuid primary key);
 create table public.workspace_members(workspace_id uuid,user_id uuid,status text,role text);
 create table public.business_entities(workspace_id uuid,id uuid,status text,primary key(workspace_id,id));
 grant usage on schema public,auth to authenticated,anon,service_role;
 grant select on public.workspace_members to authenticated;
 insert into public.workspaces values('${w}'),('${other}');
 insert into public.profiles values('${owner}'),('${member}'),('${owner2}');
 insert into auth.sessions(id,user_id,revoked) values('${session}','${owner}',false),('${memberSession}','${member}',false),('${secondSession}','${owner2}',false);
 insert into public.workspace_members values('${w}','${owner}','active','owner'),('${w}','${member}','active','admin'),('${w}','${owner2}','active','owner');
 insert into public.business_entities values('${w}','${entity}','active'),('${other}','${otherEntity}','active');`);
 await db.query('insert into auth.users(id) values($1),($2),($3)',[owner,member,owner2]);
 await db.exec(definition('square_production_customer_require_owner_v1'));
 await db.exec(definition('require_live_actor_session_v1'));
 for (const [file,tables] of sourceTables) for (const table of tables) {
   const ddl=read(`supabase/migrations/${file}`).match(new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`,'i'))?.[0];
   assert.ok(ddl,table); await db.exec(ddl);
 }
 await db.exec('alter table public.loyverse_receipt_facts add column created_at timestamptz;');
 await db.query("insert into reporting_connections(id,workspace_id,provider,created_by,status,account) values($1,$2,'harvest',$3,'connected',$4)",[conn,w,owner,JSON.stringify({id:'account-1',name:'Display name'})]);
 await db.query("insert into reporting_history_facts values($1,'harvest',$2,'entry-1','2026-10-01',$3)",[w,conn,JSON.stringify([{key:'hours',value:8}])]);
 await db.query("insert into reporting_history_days values($1,'harvest',$2,'2026-10-01','{}','2026-10-02T00:00:00Z','2026-10-02T01:00:00Z')",[w,conn]);
 await db.exec(draft1); await db.exec(draft3);
 if(boundary) {
   await db.exec(`create table private.trusted_derived_run_commits(run_id uuid primary key,workspace_id uuid,actor_id uuid,read_ticket_id uuid,transition text,transaction_id bigint);
   create table ai_agent_runs(id uuid primary key,workspace_id uuid,agent_type text,input_json jsonb,output_json jsonb,status text,created_by uuid,archived_at timestamptz,deleted_at timestamptz,google_sheets_read_ticket_id uuid);
   create table reports(id uuid primary key,workspace_id uuid,report_type text,title text,source_data_json jsonb,body_markdown text,created_by uuid,archived_at timestamptz,deleted_at timestamptz);
   create table vsi_conversations(id uuid primary key,workspace_id uuid,actor_user_id uuid);
   create table vsi_exchanges(id uuid primary key,workspace_id uuid,actor_user_id uuid,conversation_id uuid,answer text,user_message text,citations jsonb);
   alter table ai_agent_runs enable row level security;alter table reports enable row level security;
   alter table vsi_conversations enable row level security;alter table vsi_exchanges enable row level security;
   grant select,insert,update,delete on ai_agent_runs,reports to authenticated;
   grant select on vsi_conversations,vsi_exchanges to authenticated;
   create policy member_runs on ai_agent_runs for all to authenticated using(exists(select 1 from workspace_members where workspace_id=ai_agent_runs.workspace_id and user_id=auth.uid() and status='active')) with check(exists(select 1 from workspace_members where workspace_id=ai_agent_runs.workspace_id and user_id=auth.uid() and status='active'));
   create policy member_reports on reports for all to authenticated using(exists(select 1 from workspace_members where workspace_id=reports.workspace_id and user_id=auth.uid() and status='active')) with check(exists(select 1 from workspace_members where workspace_id=reports.workspace_id and user_id=auth.uid() and status='active'));
   create policy actor_conversations on vsi_conversations for select to authenticated using(actor_user_id=auth.uid());
   create policy actor_exchanges on vsi_exchanges for select to authenticated using(actor_user_id=auth.uid());`);
   await db.query("insert into ai_agent_runs values($1,$2,'intelligence_briefing_v1','{}',$3,'completed',$4,null,null,null)",[uuid(30),w,JSON.stringify({contractId:'intelligence_briefing_v1',fixture:true}),owner]);
   await db.query('insert into vsi_conversations values($1,$2,$3)',[uuid(31),w,owner]);
   await db.query("insert into vsi_exchanges values($1,$2,$3,$4,'Existing answer','Existing question','[]')",[uuid(32),w,owner,uuid(31)]);
   if(historical) {
     await db.query("insert into reports values($1,$2,'Saved Analysis','Historical',$3,'Historical text',$4,null,null)",[uuid(33),w,JSON.stringify({analysis_type:'weekly_briefing',source_artifact:{id:'malformed'}}),owner]);
     await db.query("insert into reports values($1,$2,'Saved Analysis','Copy',$3,'Historical text',$4,null,null)",[uuid(34),w,JSON.stringify({source_artifact:{id:uuid(33),workflow:'saved_report'}}),owner]);
   }
   if(historical) await db.exec("create function private.reject_fixture_artifact_rewrite() returns trigger language plpgsql as $$begin raise exception 'historical_artifact_rewritten';end$$;create trigger fixture_no_backfill_update before update on reports for each row execute function private.reject_fixture_artifact_rewrite();");
   await db.exec(draft2);
   if(historical) await db.exec('drop trigger fixture_no_backfill_update on reports;');
 }
 await login(db); return db;
}
async function map(db,provider='harvest',connection=conn,ent=entity) {
 const state=(await db.query('select preview_legacy_evidence_mapping_v1($1,$2,$3) as v',[w,provider,connection])).rows[0].v;
 return (await db.query('select confirm_legacy_evidence_mapping_v1($1,$2,$3,$4,$5) as id',[w,provider,connection,ent,state.incarnation_hash])).rows[0].id;
}
async function capture(db,binding,workspace=w) {return (await db.query("select capture_legacy_evidence_v1($1,$2,'2026-10-01','2026-10-01') as v",[workspace,binding])).rows[0].v;}
async function reopen(db,id,workspace=w) {return (await db.query('select reopen_legacy_evidence_v1($1,$2) as v',[workspace,id])).rows[0].v;}

// Composition fixture: deployed owner/session, ticket, privacy-lock, trusted-run,
// and VSI mutation bodies are executed unchanged. get_read_context uses a narrow
// contract fixture (attribution boolean + sources); provider policy is not modeled.
async function manifestSetup(options={}) {
 const db=await setup(options);await admin(db);
 await db.exec(`create table business_notes(id uuid primary key,workspace_id uuid);
 create table ai_agent_runs(id uuid primary key,workspace_id uuid,agent_type text,input_json jsonb,output_json jsonb,status text,created_by uuid,
 archived_at timestamptz,deleted_at timestamptz,trusted_source boolean default true,google_sheets_read_ticket_id uuid,error_message text,updated_at timestamptz);
 create table reports(id uuid primary key,workspace_id uuid,report_type text,title text,source_data_json jsonb,body_markdown text,created_by uuid,archived_at timestamptz,deleted_at timestamptz,google_sheets_read_ticket_id uuid);
 create table private.google_sheets_privacy_epochs(workspace_id uuid primary key,epoch integer,blocked boolean);
 create table private.google_sheets_read_tickets(id uuid primary key,workspace_id uuid,actor_id uuid,expires_at timestamptz,epoch integer,bound boolean,sources jsonb,unattributed boolean default false);
 create table private.trusted_derived_run_commits(run_id uuid primary key,workspace_id uuid,actor_id uuid,read_ticket_id uuid,transition text,transaction_id bigint);
 create table private.platform_admin_subscription_exemptions(user_id uuid);
 create function private.workspace_billing_entitled_v1(w uuid) returns boolean language sql as $$select true$$;
 create function public.google_sheets_record_readable_v1(w uuid,t text,i uuid) returns boolean language sql as $$select true$$;`);
 const original=read('supabase/migrations/20261008190000_vsi_private_chat.sql');
 for(const table of ['vsi_conversations','vsi_requests','vsi_exchanges','vsi_cost_events']) {
  const ddl=original.match(new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`,'i'))?.[0];assert.ok(ddl,table);await db.exec(ddl);
 }
 await db.exec("alter table vsi_exchanges add column public_research_topics jsonb default '[]';");
 for(const name of ['google_sheets_privacy_lock_v1','google_sheets_privacy_open_v1','google_sheets_ticket_actor_v1','google_sheets_checked_ticket_v1']) await db.exec(definition(name));
 await db.exec(`create function public.get_google_sheets_read_context_v1(tid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
 declare t private.google_sheets_read_tickets;begin select * into t from private.google_sheets_read_tickets where id=tid;
 t:=private.google_sheets_checked_ticket_v1(tid,t.workspace_id);
 return jsonb_build_object('hasUnattributedDerivedSources',t.unattributed,'connectionIds','[]'::jsonb);end$$;`);
 for(const name of ['guard_trusted_derived_run_transition_v1','complete_trusted_derived_run_v1','fail_trusted_derived_run_v1','vsi_mutate_before_sheets_privacy_v1','vsi_mutate_v1','vsi_mutate_v2']) await db.exec(definition(name));
 await db.exec(`create trigger guard_trusted_derived_run_transition_v1 before update on ai_agent_runs for each row execute function private.guard_trusted_derived_run_transition_v1();
 revoke all on all functions in schema private from public,anon,authenticated,service_role;
 revoke all on function public.vsi_mutate_v1(uuid,uuid,text,jsonb),public.vsi_mutate_v2(uuid,uuid,text,jsonb,uuid),public.complete_trusted_derived_run_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb),public.fail_trusted_derived_run_v1(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
 grant execute on function public.vsi_mutate_v2(uuid,uuid,text,jsonb,uuid),public.complete_trusted_derived_run_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb),public.fail_trusted_derived_run_v1(uuid,uuid,uuid,uuid,uuid,text) to service_role;
 insert into private.google_sheets_privacy_epochs values('${w}',1,false);
 insert into private.google_sheets_read_tickets(id,workspace_id,actor_id,expires_at,epoch,bound,sources) values('${uuid(101)}','${w}','${owner}',clock_timestamp()+interval '1 hour',1,true,'[]');
 insert into vsi_conversations(id,workspace_id,actor_user_id,actor_role) values('${uuid(102)}','${w}','${owner}','owner');
 insert into vsi_requests(id,workspace_id,actor_user_id,conversation_id,request_id,question_hash,status,reservation_usd,lease_until)
 values('${uuid(103)}','${w}','${owner}','${uuid(102)}','${uuid(104)}',encode(sha256(convert_to('Question','UTF8')),'hex'),'pending',0.1,clock_timestamp()+interval '1 hour');`);
 await db.exec(draft2);await db.exec(read('docs/security-drafts/05-manifest-admission.sql'));
 await login(db);const ref=await capture(db,await map(db));
 return {db,ref};
}
async function seal(db,ref,{kind='vsi_request',id=uuid(103),attempt=1,ticket=uuid(101),inherited=[]}={}) {
 return (await db.query('select seal_shared_evidence_manifest_v1($1,$2,$3,$4,$5,$6,$7) as v',[w,kind,id,attempt,ticket,JSON.stringify([{kind:'legacy_reference',reference_id:ref.reference_id}]),inherited])).rows[0].v;
}
const settlement=(overrides={})=>({conversationId:uuid(102),id:uuid(103),attempt:1,readTicketId:uuid(101),question:'Question',answer:'Supported fixture answer',summary:'Fixture summary',citations:[],usage:{estimatedCostUsd:0.03},...overrides});
async function settle(db,m,input=settlement(),version=3) {
 const args=[w,owner,'settle',JSON.stringify(input),session];if(version===3)args.push(m);
 return (await db.query(`select vsi_mutate_v${version}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as v`,args)).rows[0].v;
}

async function newRequest(db,n=120) {
 await admin(db);
 await db.query("insert into vsi_requests(id,workspace_id,actor_user_id,conversation_id,request_id,question_hash,status,reservation_usd,lease_until) values($1,$2,$3,$4,$5,encode(sha256(convert_to('Question','UTF8')),'hex'),'pending',0.1,clock_timestamp()+interval '1 hour')",[uuid(n),w,owner,uuid(102),uuid(n+1)]);
 await login(db);return uuid(n);
}
async function newBrief(db,n=110) {
 await admin(db);
 await db.query("insert into ai_agent_runs(id,workspace_id,agent_type,input_json,status,created_by,trusted_source) values($1,$2,'intelligence_briefing_v1',$3,'processing',$4,true)",[uuid(n),w,JSON.stringify({workflow:'intelligence_briefing_v1',google_sheets_read_ticket_id:uuid(101),shared_evidence_contract:'shared_evidence_v1',generation_key:'fixture-key',briefing_type:'weekly'}),owner]);await login(db);return uuid(n);
}
async function finishedVsi(db,ref) {
 const m=await seal(db,ref);await login(db,owner,session,'service_role');await settle(db,m.manifest_id);await login(db);return m.manifest_id;
}
async function saveVsi(db,n=130) {
 const body={analysis_type:'vsi',source_artifact:{id:uuid(103),workflow:'vsi'},artifact:{exchangeId:uuid(103),citations:[]},display:{summary:'Question',sections:[{body:'Supported fixture answer'}]}};
 await db.query("insert into reports(id,workspace_id,report_type,title,source_data_json,body_markdown,created_by) values($1,$2,'Saved Analysis','Title',$3,E'# Title\\n\\nSupported fixture answer',$4)",[uuid(n),w,JSON.stringify(body),owner]);return uuid(n);
}

async function typedSetup(options={}) {
 const {db,ref}=await manifestSetup(options);await admin(db);
 await db.exec(`alter table business_entities add column timezone text default 'UTC';
 create schema square_customer_private;
 create table square_customer_private.connections(connection_id uuid,workspace_id uuid,business_entity_id uuid,application_id text,generation bigint,state text,
 merchant_id text,location_id text,revocation_pending boolean,authorization_uncertain boolean,last_read_start timestamptz,last_read_end timestamptz,last_read_completed_at timestamptz);
 create table square_customer_private.payments(workspace_id uuid,connection_id uuid,payment_id text,location_id text,status text,created_at timestamptz,updated_at timestamptz,amount_minor bigint,currency text);
 create table private.integration_connections(id uuid,workspace_id uuid,business_entity_id uuid,provider_key text,provider_environment text,status text,connection_generation bigint);
 create table private.provider_entity_mappings(id uuid,workspace_id uuid,business_entity_id uuid,connection_id uuid,provider_key text,provider_environment text,status text,verified_at timestamptz,row_version bigint);
 create table private.external_source_records(id uuid,workspace_id uuid,business_entity_id uuid,connection_id uuid,mapping_id uuid,provider_key text,source_kind text,lifecycle_state text,current_version_id uuid,provider_record_type text,provider_record_id text);
 create table private.external_source_record_versions(id uuid,workspace_id uuid,business_entity_id uuid,connection_id uuid,source_record_id uuid,provider_key text,source_kind text,provider_record_type text,provider_record_id text,
 prior_version_id uuid,validation_state text,normalized_projection jsonb,temporal_basis text,posting_date date,period_start date,period_end date,source_timezone text,accounting_basis text,accounting_currency text,observed_at timestamptz,synchronized_at timestamptz);
 create table private.qbo_production_source_validation_work(workspace_id uuid,business_entity_id uuid,connection_id uuid,mapping_id uuid,source_record_id uuid,source_version_id uuid,completed_version_id uuid,state text);
 alter table private.qbo_production_source_validation_work enable row level security;alter table private.qbo_production_source_validation_work force row level security;
 create table public.file_uploads(id uuid,workspace_id uuid,deleted_at timestamptz,archived_at timestamptz,metadata_json jsonb default '{}');
 create function public.get_worksheet_publication_heads_v1(w uuid,ids uuid[]) returns table(file_id uuid,completed_attempt_id uuid) language sql as $$select unnest(ids),null::uuid$$;
 create table public.business_memory_chunks(id uuid,workspace_id uuid,source_id uuid,source_type text,source_file_id uuid,trusted_index boolean,deleted_at timestamptz,archived_at timestamptz,
 source_metadata jsonb,content_hash text,source_excerpt text,summary text,chunk_index integer);
 alter table business_notes add column status text,add column evidence_lifecycle_status text,add column trusted_approval boolean,add column lifecycle_provenance_id uuid,
 add column release_channel text,add column approved_at timestamptz,add column deleted_at timestamptz,add column archived_at timestamptz,add column source_version integer,
 add column original_file_id uuid,add column source_text_hash text,add column original_note_text text,add column reviewed_extraction_json jsonb,add column source_spans_json jsonb,
 add column user_corrections_json jsonb,add column approved_by uuid,add column extraction_json jsonb,add column user_reporting_period_start date,add column user_reporting_period_end date;
 -- Contract fixture only: full document-job/cache trigger composition not modeled.
 create table private.fixture_document_authority(file_id uuid,workspace_id uuid,authority jsonb);
 create function public.resolve_document_extraction_file_authority_v1(w uuid,f uuid) returns jsonb language sql security definer set search_path='' as $$select authority from private.fixture_document_authority where workspace_id=w and file_id=f$$;
 insert into square_customer_private.connections values('${uuid(210)}','${w}','${entity}','app',1,'connected','merchant','location',false,false,'2026-10-01','2026-10-02','2026-10-03');
 insert into square_customer_private.payments values('${w}','${uuid(210)}','payment:1','location','COMPLETED','2026-10-01','2026-10-02',12345,'USD');`);
 const audit=readCapture('typed-source-contracts.json');
 await db.exec(audit.functions.find(f=>f.proname==='qbo_customer_preview_v1').definition);
 await db.exec(read('docs/security-drafts/06-typed-source-admission.sql'));await login(db);return {db,ref};
}
async function typedRead(db,identity,workspace=w) {return (await db.query('select read_shared_typed_evidence_v1($1,$2) v',[workspace,JSON.stringify(identity)])).rows[0].v.resolved;}
async function typedSeal(db,identities) {return (await db.query('select seal_shared_evidence_manifest_v1($1,$2,$3,1,$4,$5,$6) v',[w,'vsi_request',uuid(103),uuid(101),JSON.stringify(identities),[]])).rows[0].v;}

async function sheetsFixture(db){ await db.exec(`
 create table google_sheets_connections(id uuid,workspace_id uuid,business_entity_id uuid,generation bigint,active_approval_id uuid,last_sync_at timestamptz,field_mapping jsonb,headers jsonb,spreadsheet_id text,sheet_id bigint,header_row int,status text,authorization_uncertain boolean,revocation_pending boolean);
 create table google_sheets_mapping_approvals(id uuid,workspace_id uuid,connection_id uuid,approved_by uuid,field_mapping jsonb,headers jsonb,spreadsheet_id text,sheet_id bigint,header_row int);
 create table google_sheets_source_rows(id uuid,workspace_id uuid,connection_id uuid,business_entity_id uuid,current_version_id uuid,current boolean);
 create table google_sheets_source_versions(id uuid,workspace_id uuid,connection_id uuid,source_row_id uuid,validation_state text,normalized_projection jsonb,source_fingerprint text);
 create table google_sheets_fact_links(workspace_id uuid,connection_id uuid,source_row_id uuid,source_version_id uuid,approval_id uuid,kpi_id uuid,admission_state text,metric_column int);
 create table kpis(id uuid,workspace_id uuid,actual_value numeric,metric_date date,name text,raw_data_json jsonb,deleted_at timestamptz,archived_at timestamptz);
 create table operational_metrics(workspace_id uuid,metric_date date,value numeric,archived_at timestamptz,deleted_at timestamptz,source_file_id uuid,import_id uuid,metric_name text);
 create function private.google_sheets_operational_source_current_v1(uuid,uuid,uuid) returns boolean language sql as $$select true$$;
 insert into google_sheets_connections values('${uuid(300)}','${w}','${entity}',1,'${uuid(301)}',now(),'{}','[]','fixture',0,1,'connected',false,false);
 insert into google_sheets_mapping_approvals values('${uuid(301)}','${w}','${uuid(300)}','${owner}','{}','[]','fixture',0,1);
 insert into google_sheets_source_rows values('${uuid(302)}','${w}','${uuid(300)}','${entity}','${uuid(303)}',true);
 insert into google_sheets_source_versions values('${uuid(303)}','${w}','${uuid(300)}','${uuid(302)}','valid','{"date":"2026-10-01","metrics":[{"column":1,"name":"Orders","value":"17","unit":"count"}]}','fixture-fingerprint');
 insert into kpis values('${uuid(304)}','${w}',17,'2026-10-01','Orders','{}',null,null);
 insert into google_sheets_fact_links values('${w}','${uuid(300)}','${uuid(302)}','${uuid(303)}','${uuid(301)}','${uuid(304)}','accepted',1);
 `); }
export { read, draft1, draft2, draft3, deployed, definition, uuid, w, other, owner, member, owner2, session, memberSession, secondSession, entity, otherEntity, conn, sourceTables, login, admin, setup, map, capture, reopen, manifestSetup, seal, settlement, settle, newRequest, newBrief, finishedVsi, saveVsi, typedSetup, typedRead, typedSeal, sheetsFixture };
