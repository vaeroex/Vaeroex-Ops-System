// LOCAL ONLY: explicit authorized metadata captures, never fetched or embedded.
// Single-backend composition checks; not complete schema or native writer parity.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareWriterCases} from './shared-evidence-writer-cases.mjs';
import {installFenceFixture} from './shared-evidence-fence-fixture.mjs';
import * as f from './shared-evidence-sql-fixture.mjs';

const directory=process.argv[2];
assert.ok(directory,'Explicit authorized local capture directory required; no network fallback.');
const captures=['functions.json','direct-bound-guards.json','bounded-helper-bodies.json','bounded-helper-metadata.json']
 .flatMap(file=>JSON.parse(readFileSync(resolve(directory,file),'utf8')));
const helperFingerprints=JSON.parse(readFileSync(resolve(directory,'failure-accounting-six-helpers.json'),'utf8'));
for(const row of helperFingerprints){
 assert.equal(row.present,true);assert.equal(row.owner,'postgres');assert.deepEqual(row.proconfig,['search_path=""']);
 assert.equal(row.proacl,'{postgres=X/postgres}');
 for(const key of ['service_execute','authenticated_execute','anon_execute'])assert.equal(row[key],false);
 captures.push({name:row.signature.slice(0,row.signature.indexOf('(')),normalized_body_md5:row.body_md5});
}
const body=sql=>sql.match(/\bas (\$[^$]*\$)([\s\S]*?)\1/i)?.[2];
const hash=sql=>createHash('md5').update(body(sql).replace(/\s/g,'')).digest('hex');
const names=[];
const repositoryFunction=(name,file)=>f.read(file).match(new RegExp(`create(?: or replace)? function (?:public|private)\\.${name}\\([\\s\\S]*?as (\\$[^$]*\\$)[\\s\\S]*?\\1;`,'i'))?.[0];
function actual(name){
 const rows=captures.filter(r=>r.name===name||r.name?.endsWith('.'+name));
 const expected=new Set(rows.map(r=>r.normalized_body_md5).filter(Boolean));
 assert.equal(expected.size,1,'Unambiguous captured fingerprint required: '+name);
 let sql=rows.find(r=>r.definition&&!r.definition_withheld&&!r.withheld)?.definition;
 sql??=f.deployed.functions.find(r=>r.proname===name)?.definition;
 if(!sql){
  for(const file of ['supabase/production-migrations/20261012191836_google_sheets_restricted_erasure_retention.sql','supabase/migrations/20261005022017_workspace_security_boundaries.sql','supabase/migrations/20261005022445_workspace_persisted_usage_limits.sql'])sql??=repositoryFunction(name,file);
 }
 assert.ok(sql,'Missing local definition: '+name);
 assert.equal(hash(sql),[...expected][0],'Definition does not match capture: '+name);
 names.push(name);return sql;
}
const {db,cases}=await prepareWriterCases();
let checks=0,stage='setup';
try{
 // Verify the terminal/authority bodies already installed by the shared fixture.
 for(const name of ['vsi_mutate_v1','vsi_mutate_v2','vsi_mutate_before_sheets_privacy_v1','require_live_actor_session_v1','square_production_customer_require_owner_v1','complete_trusted_derived_run_v1','fail_trusted_derived_run_v1','guard_trusted_derived_run_transition_v1','google_sheets_checked_ticket_v1','google_sheets_privacy_open_v1'])actual(name);
 await f.admin(db);await installFenceFixture(db);
 // Narrow billing inputs, with captured column types; no full platform overlay.
 const bounded=JSON.parse(readFileSync(resolve(directory,'bounded-relations.json'),'utf8'));
 const subscription=bounded.find(r=>r.name==='public.customer_subscriptions');assert.ok(subscription);
 for(const c of subscription.columns){assert.match(c.attname,/^[a-z_]+$/);assert.ok(['uuid','text','timestamp with time zone','boolean','jsonb'].includes(c.type));}
 await db.exec('create table public.customer_subscriptions('+subscription.columns.map(c=>`${c.attname} ${c.type}${c.attnotnull?' not null':''}`).join(',')+')');
 const planDDL=f.read('supabase/migrations/202606170003_phase_6_squarespace_subscriptions.sql').match(/create table if not exists public\.subscription_plans \([\s\S]*?\n\);/i)?.[0];assert.ok(planDDL);await db.exec(planDDL);
 const quotaSource=f.read('supabase/migrations/20261005022445_workspace_persisted_usage_limits.sql');
 for(const table of ['workspace_usage_locks','ai_run_actor_authorizations']){const ddl=quotaSource.match(new RegExp(`create table private\\.${table} \\([\\s\\S]*?\\n\\);`,'i'))?.[0];assert.ok(ddl);await db.exec(ddl);}
 for(const table of ['ai_run_actor_authorizations','platform_admin_subscription_exemptions']){
  const metadata=bounded.find(r=>r.name==='private.'+table);assert.ok(metadata);
  for(const c of metadata.constraints)if(!(await db.query('select 1 from pg_constraint where conrelid=$1::regclass and conname=$2',['private.'+table,c.name])).rows.length)await db.exec(`alter table private.${table} add constraint ${c.name} ${c.definition}`);
  await db.exec(`alter table private.${table} enable row level security;revoke all on private.${table} from public,anon,authenticated,service_role;`);
 }
 await db.exec(`alter table workspaces add column subscription_required boolean not null default false,add column manually_unlocked boolean not null default false,add column subscription_status text,add column trial_ends_at timestamptz;
 alter table ai_agent_runs add column created_at timestamptz not null default clock_timestamp();
 alter function private.workspace_billing_entitled_v1(uuid) rename to composition_old_billing;`);
 // Newly captured installed fingerprint matches the repository helper. No
 // exemption rows or fabricated entitlement bypass are added to the fixture.
 await db.exec(actual('platform_admin_subscription_exempt_v1'));
 for(const name of ['workspace_billing_entitled_v1','workspace_entitlement_active_v1','workspace_persisted_limit_v1','guard_workspace_mutation_entitlement_v1','enforce_workspace_persisted_limit_v1'])await db.exec(actual(name));
 for(const table of ['ai_agent_runs','reports'])await db.exec(`create trigger audit_workspace_entitlement before insert or update or delete on ${table} for each row execute function private.guard_workspace_mutation_entitlement_v1('workspace_id');`);
 await db.exec('create trigger workspace_persisted_usage_limit before insert or update on ai_agent_runs for each row execute function private.enforce_workspace_persisted_limit_v1();');
 await db.exec(`alter table private.google_sheets_derivation_roots add column root_id uuid,add column table_name text,add column record_id uuid;
 create unique index composition_root_identity on private.google_sheets_derivation_roots(workspace_id,table_name,record_id,root_id);
 alter table private.google_sheets_retention_roots add column erased_at timestamptz,add column expires_at timestamptz;
 alter table private.google_sheets_source_root_links add column root_id uuid,add column source_row_id uuid,add column connection_id uuid;
 alter table private.google_sheets_connection_root_links add column root_id uuid,add column connection_id uuid;
 alter table google_sheets_connections add column disconnected_at timestamptz;
 create table google_sheets_sync_runs(id uuid,workspace_id uuid,connection_id uuid);
 alter table vsi_conversations add column google_sheets_read_ticket_id uuid;
 alter table vsi_exchanges add column google_sheets_read_ticket_id uuid;`);
 for(const name of ['current_auth_session_live_v1','is_workspace_member','google_sheets_allowed_source_v1','bind_google_sheets_read_v1','google_sheets_file_metadata_without_analysis_v1','google_sheets_unmaterialized_file_v1','google_sheets_derivative_write_v1'])await db.exec(actual(name));
 // Existing fixture signatures use synthetic argument names; replace by rename.
 await db.exec('alter function public.get_google_sheets_read_context_v1(uuid) rename to composition_old_context;alter function public.google_sheets_record_readable_v1(uuid,text,uuid) rename to composition_old_readable;');
 await db.exec(actual('get_google_sheets_read_context_v1'));await db.exec(actual('google_sheets_record_readable_v1'));
 await db.query("insert into private.google_sheets_retention_roots(workspace_id,id,expires_at) values($1,$2,now()+interval '1 day')",[f.w,f.uuid(801)]);
 await db.query('insert into private.google_sheets_source_root_links(workspace_id,source_row_id,root_id,connection_id) values($1,$2,$3,$4)',[f.w,f.uuid(302),f.uuid(801),f.uuid(300)]);
 await db.query("insert into private.google_sheets_derivation_roots(workspace_id,table_name,record_id,root_id) values($1,'kpis',$2,$3)",[f.w,f.uuid(304),f.uuid(801)]);
 // Attributed seed conversation represents normal ticket-aware create, not legacy laundering.
 await db.query('update vsi_conversations set google_sheets_read_ticket_id=$1 where id=$2',[f.uuid(101),f.uuid(102)]);
 for(const table of ['ai_agent_runs','reports','vsi_exchanges','vsi_conversations']){
  await db.exec(`create trigger zz_google_sheets_derivative_fence before insert or update on ${table} for each row execute function private.google_sheets_derivative_write_v1();`);
 }
 await db.exec(`grant select,insert,update on reports to authenticated;grant select on ai_agent_runs,vsi_exchanges,vsi_conversations to authenticated;
 alter table reports enable row level security;alter table ai_agent_runs enable row level security;
 create policy composition_member_reports on reports for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
 create policy composition_member_runs on ai_agent_runs for select to authenticated using(public.is_workspace_member(workspace_id));`);
 for(const table of ['reports','ai_agent_runs','vsi_exchanges','vsi_conversations'])await db.exec(`create policy composition_live on ${table} as restrictive for all to authenticated using(private.current_auth_session_live_v1()) with check(private.current_auth_session_live_v1());
 create policy composition_retention on ${table} as restrictive for select to authenticated using(public.google_sheets_record_readable_v1(workspace_id,'${table}',id));`);
 await f.login(db);
 const bind=async(ticket,sources)=>(await db.query('select bind_google_sheets_read_v1($1,$2) v',[ticket,JSON.stringify(sources)])).rows[0].v;
 const ticket=async(n,sources)=>{
  await f.admin(db);await db.query("insert into private.google_sheets_read_tickets(id,workspace_id,actor_id,expires_at,epoch,bound,sources) values($1,$2,$3,now()+interval '1 hour',1,false,'[]')",[f.uuid(n),f.w,f.owner]);
  await f.login(db);await bind(f.uuid(n),sources);return f.uuid(n);
 };
 await bind(f.uuid(101),[{table:'kpis',id:f.uuid(304)}]);
 const ref={reference_id:cases.find(c=>c.provider==='harvest').source.reference_id};
 const parent=await f.finishedVsi(db,ref);
 await f.admin(db);
 for(const table of ['vsi_exchanges','vsi_conversations'])assert.equal((await db.query('select count(*)::int n from private.google_sheets_derivation_roots where table_name=$1 and root_id=$2',[table,f.uuid(801)])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from vsi_cost_events where request_id=$1',[f.uuid(103)])).rows[0].n,1);checks+=3;
 const save=async(id,sourceId,workflow,t)=>{
  const source=workflow==='vsi'?{analysis_type:'vsi',source_artifact:{id:sourceId,workflow},artifact:{exchangeId:sourceId,citations:[]},display:{summary:'Question',sections:[{body:'Supported fixture answer'}]}}:{source_artifact:{id:sourceId,workflow}};
  await db.query("insert into reports(id,workspace_id,report_type,title,source_data_json,body_markdown,created_by,google_sheets_read_ticket_id) values($1,$2,'Saved Analysis','Title',$3,E'# Title\\n\\nSupported fixture answer',$4,$5)",[id,f.w,JSON.stringify(source),f.owner,t]);
 };
 const t1=await ticket(810,[{table:'vsi_exchanges',id:f.uuid(103)}]);await save(f.uuid(811),f.uuid(103),'vsi',t1);
 const t2=await ticket(812,[{table:'reports',id:f.uuid(811)}]);await save(f.uuid(813),f.uuid(811),'saved_report',t2);
 assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,2);checks++;
 await f.login(db,f.owner2,f.secondSession);assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,0);checks++;
 await f.login(db,f.owner,f.secondSession);assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,0);checks++;
 await f.login(db);await assert.rejects(db.query("update reports set source_data_json='{}' where id=$1",[f.uuid(811)]),e=>e.code==='42501');checks++;
 await f.admin(db);assert.equal((await db.query("select count(*)::int n from private.google_sheets_derivation_roots where table_name='reports' and root_id=$1",[f.uuid(801)])).rows[0].n,2);checks++;
 const brief=await f.newBrief(db,820);const sealed=await f.seal(db,ref,{kind:'briefing_run',id:brief});
 await f.login(db,f.owner,f.session,'service_role');
 await db.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8)',[f.w,brief,f.owner,f.session,f.uuid(101),'intelligence_briefing_v1',JSON.stringify({contractId:'intelligence_briefing_v1',workspaceId:f.w,briefingType:'weekly',generationKey:'fixture-key'}),sealed.manifest_id]);
 await f.admin(db);assert.equal((await db.query("select count(*)::int n from private.google_sheets_derivation_roots where table_name='ai_agent_runs' and record_id=$1 and root_id=$2",[brief,f.uuid(801)])).rows[0].n,1);checks++;
 stage='prepare_failures';const pendingId=await f.newRequest(db,830);const pendingManifest=await f.seal(db,ref,{id:pendingId,inherited:[parent]});
 const failedBrief=await f.newBrief(db,840);await f.seal(db,ref,{kind:'briefing_run',id:failedBrief});
 await f.admin(db);
 await db.query("update private.google_sheets_retention_roots set expires_at=now()-interval '1 second' where id=$1",[f.uuid(801)]);
 await f.login(db);assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from ai_agent_runs where id=$1',[brief])).rows[0].n,0);checks+=2;
 await assert.rejects(bind(t2,[]),e=>e.code==='55000');checks++;
 await f.login(db,f.owner,f.session,'service_role');
 await assert.rejects(f.settle(db,pendingManifest.manifest_id,f.settlement({id:pendingId})),e=>e.code==='55000');checks++;
 const failed={id:pendingId,conversationId:f.uuid(102),attempt:1,readTicketId:f.uuid(101),usage:{estimatedCostUsd:0.03,providerCalls:1,failed:true}};
 stage='expired_vsi_failed_settlement';
 // Existing v1 privacy wrapper rejects every mutation for an expired conversation,
 // including output-free accounting cleanup. Preserve/report this contract gap.
 await assert.rejects(f.settle(db,null,failed,2),e=>e.code==='55000');checks++;
 await f.admin(db);assert.equal((await db.query('select status from vsi_requests where id=$1',[pendingId])).rows[0].status,'pending');
 assert.equal((await db.query('select count(*)::int n from vsi_cost_events where request_id=$1',[pendingId])).rows[0].n,0);checks+=2;
 await db.query("update private.google_sheets_retention_roots set expires_at=now()+interval '1 day' where id=$1",[f.uuid(801)]);
 await f.login(db,f.owner,f.session,'service_role');await f.settle(db,null,failed,2);await f.settle(db,null,failed,2);
 await f.admin(db);const failedRow=(await db.query('select status,cost_usd from vsi_requests where id=$1',[pendingId])).rows[0];
 assert.equal(failedRow.status,'failed');assert.equal(Number(failedRow.cost_usd),0.03);
 assert.equal((await db.query('select count(*)::int n from vsi_cost_events where request_id=$1',[pendingId])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from vsi_exchanges where id=$1',[pendingId])).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from private.shared_evidence_artifact_manifests where artifact_id=$1',[pendingId])).rows[0].n,0);checks+=5;
 // Failed brief cleanup preserves output despite creator demotion and expired roots.
 await db.query("update private.google_sheets_retention_roots set expires_at=now()-interval '1 second' where id=$1",[f.uuid(801)]);
 await db.query("update workspace_members set role='admin' where workspace_id=$1 and user_id=$2",[f.w,f.owner]);
 stage='expired_demoted_brief_failed_settlement';await f.login(db,f.owner,f.session,'service_role');await db.query('select fail_trusted_derived_run_v1($1,$2,$3,$4,$5,$6)',[f.w,failedBrief,f.owner,f.session,f.uuid(101),'intelligence_briefing_v1']);
 await f.admin(db);const run=(await db.query('select status,output_json from ai_agent_runs where id=$1',[failedBrief])).rows[0];
 assert.equal(run.status,'failed');assert.equal(run.output_json,null);checks+=2;
 await db.query("update workspace_members set role='owner' where workspace_id=$1 and user_id=$2",[f.w,f.owner]);
 await f.admin(db);await db.query("update private.google_sheets_retention_roots set expires_at=now()+interval '1 day' where id=$1",[f.uuid(801)]);
 await db.query('update private.google_sheets_privacy_epochs set blocked=true where workspace_id=$1',[f.w]);
 await f.login(db);assert.equal((await db.query('select count(*)::int n from reports')).rows[0].n,0);await assert.rejects(bind(t2,[]),e=>e.code==='55000');checks+=2;
 await f.admin(db);assert.equal((await db.query('select count(*)::int n from vsi_cost_events where request_id=$1',[f.uuid(103)])).rows[0].n,1);checks++;
 stage='entitlement_and_persisted_limits';
 await db.query('update private.google_sheets_privacy_epochs set blocked=false where workspace_id=$1',[f.w]);
 await db.query("insert into subscription_plans(name,slug,max_ai_runs_per_month) values('Synthetic plan','composition-plan',2)");
 const sub={id:f.uuid(860),workspace_id:f.w,user_id:f.owner,customer_email:'synthetic@example.invalid',source:'synthetic',status:'active',plan_slug:'composition-plan',billing_provider:'stripe',
  current_period_end:new Date(Date.now()+86400000).toISOString(),stripe_customer_id:'synthetic-customer',stripe_subscription_id:'synthetic-subscription',
  raw_payload_json:{},manually_activated:false,stripe_cancel_at_period_end:false,onboarding_email_status:'not_sent',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
 const keys=Object.keys(sub);await db.query(`insert into customer_subscriptions(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(sub));
 await db.query("update workspaces set subscription_required=true,subscription_status='demo' where id=$1",[f.w]);
 assert.equal((await db.query('select private.workspace_persisted_limit_v1($1,$2) n',[f.w,'ai_runs_this_month'])).rows[0].n,2);checks++;
 assert.equal((await db.query('select count(*)::int n from ai_agent_runs where workspace_id=$1',[f.w])).rows[0].n,2);
 const usageBefore=(await db.query('select revision from private.workspace_usage_locks where workspace_id=$1',[f.w])).rows[0].revision;
 await f.login(db);await assert.rejects(f.newBrief(db,850),e=>e.code==='23514');checks++;
 await f.admin(db);assert.equal((await db.query('select revision from private.workspace_usage_locks where workspace_id=$1',[f.w])).rows[0].revision,usageBefore);
 assert.equal((await db.query('select count(*)::int n from ai_agent_runs where id=$1',[f.uuid(850)])).rows[0].n,0);checks+=2;
 // Failed/archived runs still consume their month; lifecycle update is allowed.
 // Inspect reached trigger behavior as fixture owner with authenticated claims;
 // this does not grant direct client UPDATE or qualify the lifecycle RPC.
 await f.login(db);await f.admin(db);await db.query('update ai_agent_runs set archived_at=now() where id=$1',[brief]);
 await assert.rejects(f.newBrief(db,850),e=>e.code==='23514');checks++;
 await f.login(db);await f.admin(db);await assert.rejects(db.query("update ai_agent_runs set created_at=created_at-interval '1 month' where id=$1",[brief]),e=>e.code==='23514');checks++;
 await f.admin(db);await db.query("update subscription_plans set max_ai_runs_per_month=3 where slug='composition-plan'");
 await f.login(db);await f.newBrief(db,850);await f.admin(db);assert.equal((await db.query('select count(*)::int n from ai_agent_runs where workspace_id=$1',[f.w])).rows[0].n,3);checks++;
 await db.query("update customer_subscriptions set current_period_end=now()-interval '1 second' where id=$1",[f.uuid(860)]);
 await f.login(db);await assert.rejects(save(f.uuid(861),f.uuid(811),'saved_report',t2),e=>e.code==='42501');checks++;
 // Stripe expiry takes precedence over workspace demo/manual fallback.
 await f.admin(db);assert.equal((await db.query('select private.workspace_billing_entitled_v1($1) ok',[f.w])).rows[0].ok,false);
 assert.equal((await db.query('select count(*)::int n from reports where id=$1',[f.uuid(861)])).rows[0].n,0);checks+=2;
 await db.query("update customer_subscriptions set current_period_end=now()+interval '1 day' where id=$1",[f.uuid(860)]);
 await f.login(db);await save(f.uuid(861),f.uuid(811),'saved_report',t2);
 assert.equal((await db.query('select count(*)::int n from reports where id=$1',[f.uuid(861)])).rows[0].n,1);checks++;
 console.log(JSON.stringify({passed:true,checks,verifiedFunctions:[...new Set(names)].sort(),providerCalls:0,nativeConcurrency:false,releaseQualified:false,
  limits:['Expired VSI conversation blocks existing output-free cost settlement','Synthetic partial relation schemas','Subscription-plan and usage-lock full constraint/RLS composition remains unqualified; bounded installed columns compared separately','No full erasure orchestration','No live or provider calls']}));
}catch(error){
 // Never echo private definition/query text, driver messages or source rows.
 console.error(JSON.stringify({passed:false,stage,code:error.code,line:Number(/composition-save-tests\.mjs:(\d+):/.exec(error.stack??'')?.[1])||undefined,
  assertion:error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:undefined}));process.exitCode=1;
}finally{await db.close();}
