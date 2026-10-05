/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic embedded PostgreSQL and actual TypeScript contract tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const { assertBusinessLabel, assertMapping, parseDateCell, safeHeaders, spreadsheetIdFromUrl } = require('../lib/integrations/google-sheets/contracts.ts');
const { normalizeSheetsRows } = require('../lib/integrations/google-sheets/ingestion.ts');
const { buildIntelligenceLayer } = require('../lib/intelligence/layer.ts');
const { loadActiveWorkspaceKpis } = require('../lib/kpis/load-workspace-kpis.ts');
const { getSubscriptionStatus } = require('../lib/billing/get-subscription-status.ts');
const phase3 = fs.readFileSync(path.join(root,'supabase/migrations/20260821172015_external_integrations_phase_3_deterministic_dependencies.sql'),'utf8');
const source = name => fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
function fn(text,name) { const start=text.search(new RegExp(`create (?:or replace )?function ${name.replaceAll('.','\\.')}\\(`)); const end=text.indexOf('$function$;',start); assert(start>=0&&end>start); return text.slice(start,end+12); }
const ws=randomUUID(), entity=randomUUID(), actor=randomUUID(), session=randomUUID(), connection=randomUUID(), otherWs=randomUUID();
const spreadsheet='abcdefghijklmnopqrstuvwxyz123456';
const mapping={rowKeyColumn:0,dateColumn:1,dateFormat:'iso',locationColumn:null,metrics:[{column:2,name:'Orders shipped',category:'Operations',unit:'count',target:100},{column:3,name:'On-time rate',category:'Operations',unit:'percent_fraction',target:95}]};
const headers=['Record ID','Date','Orders','On time'];
const normalize=rows=>normalizeSheetsRows({workspaceId:ws,businessEntityId:entity,connectionId:connection,spreadsheetId:spreadsheet,sheetId:0,headerRow:1,mapping,rows});
let stage='setup'; let checks=0;
async function verifyWorkspaceEntitlements(db,call,deny) {
  const entitlementWs=randomUUID(),entitlementEntity=randomUUID();
  await db.query('insert into public.workspaces(id,manually_unlocked) values($1,false)',[entitlementWs]);
  await db.query("insert into public.workspace_members values($1,$2,'owner','active')",[entitlementWs,actor]);
  await db.query("insert into public.business_entities values($1,$2,'active','Entitlement fixture')",[entitlementEntity,entitlementWs]);
  const billingReader={from(table){return{select(){return this;},eq(){return this;},or(){return this;},async maybeSingle(){assert.equal(table,'workspaces');return{data:(await db.query('select * from public.workspaces where id=$1',[entitlementWs])).rows[0],error:null};},async order(){assert.equal(table,'customer_subscriptions');return{data:(await db.query('select * from public.customer_subscriptions where workspace_id=$1 order by created_at desc,id desc',[entitlementWs])).rows,error:null};}};}};
  const begin=()=>call('google_sheets_lifecycle_v1',['begin',entitlementWs,randomUUID(),actor,session,{businessEntityId:entitlementEntity,displayName:'Entitlement fixture',stateHash:'sha256:'+randomUUID().replaceAll('-','').repeat(2),redirectUri:'https://www.vaeroex.com/api/integrations/google-sheets/callback'}]);
  const parity=async(allowed,label)=>{
    const appAccess=await getSubscriptionStatus({supabase:billingReader,workspaceId:entitlementWs});
    assert.equal(appAccess.allowed,allowed,label+' app access');
    if(allowed) await begin(); else await assert.rejects(begin,/entitlement_denied/,label+' SQL access');
    checks++;
  };
  await parity(false,'no entitlement');
  await db.query('update public.workspaces set subscription_required=false where id=$1',[entitlementWs]);
  await parity(true,'subscription bypass');
  await db.query("update public.workspaces set subscription_required=true,subscription_status='demo' where id=$1",[entitlementWs]);
  await parity(true,'demo workspace');
  await db.query("update public.workspaces set subscription_status='trialing',trial_ends_at=now()+interval '1 day' where id=$1",[entitlementWs]);
  await parity(true,'active workspace trial');
  await db.query("update public.workspaces set trial_ends_at=now()-interval '1 second' where id=$1",[entitlementWs]);
  await parity(false,'expired workspace trial');
  await db.query("update public.workspaces set trial_ends_at=null where id=$1",[entitlementWs]);
  await parity(false,'missing trial expiry');
  await db.query("update public.workspaces set subscription_status='active',manually_unlocked=true where id=$1",[entitlementWs]);
  await parity(false,'manual unlock without qualifying subscription');
  await db.query("insert into public.customer_subscriptions(workspace_id,billing_provider,manually_activated,status) values($1,'manual',true,'active')",[entitlementWs]);
  await parity(true,'manual linked entitlement');
  await db.query('update public.workspaces set manually_unlocked=false where id=$1',[entitlementWs]);
  await parity(false,'manual subscription without workspace unlock');
  await db.query("update public.workspaces set subscription_required=false,manually_unlocked=true,subscription_status='trialing',trial_ends_at=now()+interval '1 day' where id=$1",[entitlementWs]);
  const stripeId=randomUUID();
  await db.query("insert into public.customer_subscriptions(id,workspace_id,billing_provider,manually_activated,status,current_period_end,stripe_customer_id,stripe_subscription_id) values($1,$2,'stripe',false,'past_due',now()+interval '1 day','cus_fixture','sub_fixture')",[stripeId,entitlementWs]);
  await parity(false,'Stripe denial overrides bypass manual and trial');
  await db.query("update public.workspaces set subscription_status='demo' where id=$1",[entitlementWs]);
  await parity(false,'Stripe denial overrides demo');
  await db.query("update public.customer_subscriptions set status='active',current_period_end=now()-interval '1 second' where id=$1",[stripeId]);
  await parity(false,'expired Stripe entitlement');
  await db.query("update public.customer_subscriptions set current_period_end=now()+interval '1 day',stripe_subscription_id=null where id=$1",[stripeId]);
  await parity(false,'incomplete Stripe identity');
  await db.query("update public.customer_subscriptions set stripe_subscription_id='sub_fixture' where id=$1",[stripeId]);
  await parity(true,'active Stripe entitlement');
  await db.query("update public.customer_subscriptions set manually_activated=true where id=$1",[stripeId]);
  await parity(false,'manual flag cannot activate Stripe');
  await db.query("update public.customer_subscriptions set manually_activated=false where id=$1",[stripeId]);
  await db.query("insert into public.customer_subscriptions(workspace_id,billing_provider,manually_activated,status,created_at) values($1,'stripe',false,'canceled',now()+interval '1 second')",[entitlementWs]);
  await parity(false,'latest linked Stripe controls access');
  await db.query("delete from public.customer_subscriptions where workspace_id=$1 and billing_provider='stripe'",[entitlementWs]);
  await db.query("update public.workspace_members set status='suspended' where workspace_id=$1",[entitlementWs]);
  await deny(begin,'owner_denied');
  await db.query("update public.workspace_members set status='active' where workspace_id=$1",[entitlementWs]);
  await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[actor]);
  await deny(begin,'owner_denied');
  await db.query('update auth.users set banned_until=null where id=$1',[actor]);
  // The same fallback must cover approved manual and scheduled refresh claims.
  const fallbackConnection=randomUUID();
  await db.query("insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,status,display_name,spreadsheet_id,sheet_id,sheet_title,headers) values($1,$2,$3,$4,'connected','Fallback fixture',$5,0,'Metrics',$6)",[fallbackConnection,entitlementWs,entitlementEntity,actor,spreadsheet,headers]);
  await call('approve_google_sheets_mapping_v1',[entitlementWs,fallbackConnection,actor,session,mapping,true]);
  const manual=await call('claim_google_sheets_sync_v1',[entitlementWs,fallbackConnection,actor,session,'manual']);
  await call('fail_google_sheets_sync_v1',[entitlementWs,fallbackConnection,manual.runId,'fixture_failure']);
  await db.query('update public.google_sheets_connections set next_sync_at=now() where id=$1',[fallbackConnection]);
  const automatic=await call('claim_google_sheets_sync_v1',[entitlementWs,fallbackConnection,null,null,'scheduled']);
  await call('fail_google_sheets_sync_v1',[entitlementWs,fallbackConnection,automatic.runId,'fixture_failure']);checks++;
}
async function verifyAbandonedSyncRecovery(db, call, deny) {
  const id = randomUUID();
  await db.query("insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,status,display_name,spreadsheet_id,sheet_id,sheet_title,headers) values($1,$2,$3,$4,'connected','Interrupted sync fixture',$5,0,'Metrics',$6)", [id, ws, entity, actor, spreadsheet, headers]);
  await call('approve_google_sheets_mapping_v1', [ws,id,actor,session,mapping,true]);
  const first = await call('claim_google_sheets_sync_v1', [ws,id,null,null,'scheduled']);
  const timing = (await db.query('select extract(epoch from (sync_lease_expires_at-updated_at))::int lease_seconds,extract(epoch from (next_sync_at-updated_at))::int retry_seconds from public.google_sheets_connections where id=$1', [id])).rows[0];
  assert.deepEqual(timing, { lease_seconds: 480, retry_seconds: 3600 }); checks++;
  // Accelerate only persisted expiry in the owned synthetic database. This
  // proves SQL state transitions, not process-kill or elapsed recovery latency.
  await db.query("update public.google_sheets_connections set sync_lease_expires_at=now()-interval '1 second' where id=$1", [id]);
  assert.equal((await db.query("select count(*)::int n from public.google_sheets_connections where id=$1 and status='connected' and automatic_refresh_enabled and active_approval_id is not null and next_sync_at<=now()", [id])).rows[0].n, 0); checks++;
  assert.equal((await db.query('select status from public.google_sheets_sync_runs where id=$1',[first.runId])).rows[0].status, 'running'); checks++;
  await deny(() => call('claim_google_sheets_sync_v1',[ws,id,null,null,'scheduled']), 'schedule_denied');
  const resumed = await call('claim_google_sheets_sync_v1',[ws,id,actor,session,'manual']);
  assert.equal((await db.query('select status,error_code from public.google_sheets_sync_runs where id=$1',[first.runId])).rows[0].error_code, 'lease_expired'); checks++;
  await call('fail_google_sheets_sync_v1',[ws,id,first.runId,'late_failure']);
  assert.equal((await db.query('select sync_lease_run_id from public.google_sheets_connections where id=$1',[id])).rows[0].sync_lease_run_id,resumed.runId); checks++;
  await deny(() => call('commit_google_sheets_sync_v1',[ws,id,first.runId,[],true]),'fence_denied');
  const rows = normalizeSheetsRows({workspaceId:ws,businessEntityId:entity,connectionId:id,spreadsheetId:spreadsheet,sheetId:0,headerRow:1,mapping,rows:[['recovery-once','2040-01-01',7,0.5]]});
  const committed = await call('commit_google_sheets_sync_v1',[ws,id,resumed.runId,rows,true]);
  assert.equal(committed.factCount,2); checks++;
  // Simulate lost commit acknowledgement by invoking normal failure cleanup
  // after the transaction succeeded. It must retain both facts and success.
  await call('fail_google_sheets_sync_v1',[ws,id,resumed.runId,'request_timeout']);
  assert.equal((await db.query('select status from public.google_sheets_sync_runs where id=$1',[resumed.runId])).rows[0].status,'succeeded'); checks++;
  assert.equal((await db.query('select count(*)::int n from public.google_sheets_fact_links where connection_id=$1',[id])).rows[0].n,2); checks++;
  await deny(() => call('commit_google_sheets_sync_v1',[ws,id,resumed.runId,rows,true]),'fence_denied');
  await db.query('update public.google_sheets_connections set automatic_refresh_enabled=false,next_sync_at=null where id=$1',[id]);
  const manual = await call('claim_google_sheets_sync_v1',[ws,id,actor,session,'manual']);
  await db.query("update public.google_sheets_connections set sync_lease_expires_at=now()-interval '1 second' where id=$1",[id]);
  assert.equal((await db.query('select next_sync_at from public.google_sheets_connections where id=$1',[id])).rows[0].next_sync_at,null); checks++;
  assert.equal((await db.query('select status from public.google_sheets_sync_runs where id=$1',[manual.runId])).rows[0].status,'running'); checks++;
  const final = await call('claim_google_sheets_sync_v1',[ws,id,actor,session,'manual']);
  assert.equal((await db.query('select error_code from public.google_sheets_sync_runs where id=$1',[manual.runId])).rows[0].error_code,'lease_expired'); checks++;
  await call('fail_google_sheets_sync_v1',[ws,id,final.runId,'fixture_cleanup']);
  return { scope: 'Persisted SQL with accelerated lease expiry; no worker kill or provider transport', leaseSeconds:480, automaticRetrySeconds:3600, expiredAutomaticRemainsUndue:true, expiredManualRemainsRunningUntilClaim:true, staleCommitDenied:true, lateCleanupPreservesSuccess:true, recovery300SecondsQualified:false };
}

async function qualify(db) {
  await db.exec(`create schema private; create schema auth; create schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create table public.workspaces(id uuid primary key,manually_unlocked boolean default true,subscription_required boolean default true,subscription_status text default 'manual_review',trial_ends_at timestamptz,plan_slug text);
    create table public.customer_subscriptions(id uuid primary key default gen_random_uuid(),workspace_id uuid,billing_provider text,created_at timestamptz default now(),manually_activated boolean,status text,current_period_end timestamptz,stripe_customer_id text,stripe_subscription_id text);
    create table public.profiles(id uuid primary key);
    create table public.workspace_members(workspace_id uuid,user_id uuid,role text,status text);
    create table public.business_entities(id uuid primary key,workspace_id uuid,status text,display_name text,unique(workspace_id,id));
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz,role text);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function public.is_workspace_member(uuid) returns boolean language sql security definer as $$select exists(select 1 from public.workspace_members where workspace_id=$1 and user_id=auth.uid() and status='active')$$;
    create table public.kpis(id uuid primary key default gen_random_uuid(),workspace_id uuid,name text,category text,target numeric,actual_value numeric,metric_date date,owner text,source text,raw_data_json jsonb default '{}',created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now(),archived_at timestamptz,deleted_at timestamptz);
    create table public.file_uploads(id uuid primary key,workspace_id uuid,archived_at timestamptz,deleted_at timestamptz);
    create table public.file_imports(id uuid primary key,workspace_id uuid,file_upload_id uuid);
    create table public.operational_metrics(id uuid primary key default gen_random_uuid(),workspace_id uuid,source_file_id uuid,import_id uuid,metric_name text,value numeric,metric_date date,raw_data_json jsonb default '{}',archived_at timestamptz,deleted_at timestamptz);
    create table private.canonical_business_facts(id uuid primary key,workspace_id uuid,business_entity_id uuid,current_version_id uuid);
    create table private.canonical_business_fact_versions(id uuid primary key,workspace_id uuid,business_entity_id uuid,reconciliation_state text,validation_state text,value_kind text,posting_date date,period_start date,period_end date);
    grant usage on schema public,auth to service_role,authenticated,anon;
    grant select,insert,update on public.kpis to service_role;
    grant select on public.workspaces,public.profiles,public.workspace_members,public.business_entities to service_role;
    select set_config('request.jwt.claim.role','service_role',false);`);
  await db.exec(fn(phase3,'private.phase_3_canonical_json_v1'));
  await db.exec(fn(phase3,'private.phase_3_contract_fingerprint_v1'));
  await db.exec(source('20261002040024_google_sheets_complete.sql'));
  await db.exec(source('20261002040031_google_sheets_lifecycle.sql'));
  assert((await db.query("select not has_schema_privilege('anon','private','USAGE') and not has_schema_privilege('authenticated','private','USAGE') and not has_schema_privilege('service_role','private','USAGE') as private_boundary")).rows[0].private_boundary);checks++;
  assert((await db.query("select not has_function_privilege('service_role','private.require_google_sheets_owner_v1(uuid,uuid,uuid,uuid)','EXECUTE') and not has_function_privilege('service_role','private.retire_google_sheets_facts_v1(uuid,uuid)','EXECUTE') and not has_function_privilege('service_role','private.require_google_sheets_eligible_v1(uuid)','EXECUTE') as helper_boundary")).rows[0].helper_boundary);checks++;
  await db.query('insert into public.workspaces(id) values($1),($2)',[ws,otherWs]);
  await db.query("insert into public.customer_subscriptions(workspace_id,billing_provider,manually_activated,status) values($1,'manual',true,'active')",[ws]);
  await db.query('insert into public.profiles values($1)',[actor]);
  await db.query("insert into public.workspace_members values($1,$2,'owner','active')",[ws,actor]);
  await db.query("insert into public.business_entities values($1,$2,'active','Test business')",[entity,ws]);
  await db.query('insert into auth.users(id,deleted_at,banned_until) values($1,null,null)',[actor]);
  await db.query("insert into auth.sessions values($1,$2,now()+interval '1 day')",[session,actor]);
  const call=async(name,args,role='service_role')=>{ stage=name; await db.exec(`set role ${role}; select set_config('request.jwt.claim.role','${role}',false)`); try { return (await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result; } finally { await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false)"); } };
  const deny=async(action,pattern)=>{await assert.rejects(action,error=>pattern?new RegExp(pattern).test(error.message):true);checks++;};
  await verifyWorkspaceEntitlements(db,call,deny);
  await db.query("insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,status,display_name,spreadsheet_id,sheet_id,sheet_title,headers) values($1,$2,$3,$4,'connected','Operations sheet',$5,0,'Daily',$6)",[connection,ws,entity,actor,spreadsheet,headers]);
  const approve=()=>call('approve_google_sheets_mapping_v1',[ws,connection,actor,session,mapping,true]);
  const claim=()=>call('claim_google_sheets_sync_v1',[ws,connection,actor,session,'manual']);
  const commit=(run,rows,complete=true)=>call('commit_google_sheets_sync_v1',[ws,connection,run.runId,normalize(rows),complete]);
  await deny(()=>call('approve_google_sheets_mapping_v1',[otherWs,connection,actor,session,mapping,true]),'unavailable|entitlement_denied');
  await deny(()=>call('approve_google_sheets_mapping_v1',[ws,connection,actor,randomUUID(),mapping,true]),'owner_denied');
  await deny(()=>call('approve_google_sheets_mapping_v1',[ws,connection,actor,session,mapping,true],'authenticated'));
  await deny(()=>call('approve_google_sheets_mapping_v1',[ws,connection,actor,session,mapping,true],'anon'));
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
  await deny(()=>db.query('select public.approve_google_sheets_mapping_v1($1,$2,$3,$4,$5,$6)',[ws,connection,actor,session,mapping,true]),'service_denied');
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  assert.match(await approve(),/^[a-f0-9-]{36}$/);checks++;
  const first=await claim(); await deny(claim,'sync_busy');
  await deny(()=>commit(first,[['row-1','2026-10-01',20,0.9]],false),'incomplete_read');
  const initial=await commit(first,[['row-1','2026-10-01',20,0.9],['row-2','2026-10-02',30,0.95]]);
  assert.equal(initial.factCount,4); checks++;
  // Cleanup after a lost commit acknowledgement must preserve authoritative success.
  const successSnapshot=async()=>(await db.query("select jsonb_build_object('run',to_jsonb(r),'connection',to_jsonb(c),'facts',(select jsonb_agg(to_jsonb(k) order by k.id) from public.kpis k where k.workspace_id=c.workspace_id)) snapshot from public.google_sheets_sync_runs r join public.google_sheets_connections c on c.id=r.connection_id and c.workspace_id=r.workspace_id where r.id=$1",[first.runId])).rows[0].snapshot;
  const committedSnapshot=await successSnapshot();
  await call('fail_google_sheets_sync_v1',[ws,connection,first.runId,'request_timeout']);
  assert.deepEqual(await successSnapshot(),committedSnapshot);checks++;

  assert((await db.query("select next_sync_at>now() and next_sync_at<=now()+interval '15 minutes' and mod(extract(epoch from next_sync_at),900)=0 due from public.google_sheets_connections where id=$1",[connection])).rows[0].due);checks++;
  assert.equal((await db.query("select actual_value from public.kpis where name like 'On-time rate%' and metric_date='2026-10-01' and archived_at is null")).rows[0].actual_value,'90');checks++;
  const savedApproval=(await db.query('select active_approval_id from public.google_sheets_connections where id=$1',[connection])).rows[0].active_approval_id;
  assert.equal(await approve(),savedApproval);assert.equal((await db.query('select count(*)::int n from public.kpis where archived_at is null')).rows[0].n,4);checks++;
  const again=await claim(); await commit(again,[['row-2','2026-10-02',30,0.95],['row-1','2026-10-01',20,0.9]]);
  assert.equal((await db.query('select count(*)::int n from public.google_sheets_source_versions')).rows[0].n,2);checks++;
  const edited=await claim(); await commit(edited,[['row-2','2026-10-02',40,0.95],['row-1','2026-10-01',20,0.9]]);
  assert.equal((await db.query('select count(*)::int n from public.google_sheets_source_versions')).rows[0].n,3);checks++;
  assert.equal((await db.query('select count(*)::int n from public.kpis where archived_at is null')).rows[0].n,4);checks++;
  await db.query("insert into public.kpis(workspace_id,name,actual_value,metric_date) values($1,'Orders shipped',99,'2026-10-01')",[ws]);
  assert.equal((await db.query("select count(*)::int n from public.kpis where name like 'Orders shipped%' and metric_date='2026-10-01' and archived_at is null")).rows[0].n,1);checks++;
  const conflict=await claim(); const conflicts=await commit(conflict,[['row-1','2026-10-01',20,0.9]]);assert.equal(conflicts.conflictCount,1);checks++;
  const invalid=await claim(); const invalidResult=await commit(invalid,[['bad-date','not-a-date',10,0.5]]);assert.equal(invalidResult.rejectedCount,1);assert.equal(invalidResult.factCount,0);checks++;
  const large=Array.from({length:750},(_,i)=>[`stable-${i}`,new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),i,0.95]);
  const largeRun=await claim(); const largeResult=await commit(largeRun,large);assert.equal(largeResult.factCount,1500);checks++;
  const kpis=(await db.query('select * from public.kpis where workspace_id=$1 and archived_at is null and deleted_at is null',[ws])).rows;
  // Execute the actual deterministic producer used by the Executive Intelligence page.
  const layer=buildIntelligenceLayer({asOf:'2026-10-02T00:00:00Z',workspace:{name:'Synthetic operations'},issues:[],kpis:kpis.map(row=>({...row,actual_value:Number(row.actual_value),target:Number(row.target),metric_date:new Date(row.metric_date).toISOString().slice(0,10),created_at:new Date(row.created_at).toISOString(),updated_at:new Date(row.updated_at).toISOString()})),kpiSettings:[],files:[],crmLeads:[],imports:[],sops:[],forms:[],submissions:[],people:[],decisions:[]});
  assert.equal(layer.memorySummary.kpiHistoryRecords,kpis.length);assert.equal(layer.forecastReadiness.totalMeasurementCount,kpis.length);assert(kpis.some(row=>row.raw_data_json.googleSheets?.sourceVersionId));checks++;
  const late=await claim(); await db.query("update public.google_sheets_connections set status='disconnected' where id=$1",[connection]);
  await deny(()=>commit(late,large),'fence_denied');
  assert.equal((await db.query("select count(*)::int n from public.kpis where raw_data_json ? 'googleSheets' and archived_at is null")).rows[0].n,0);checks++;
  await deny(()=>db.query("update public.google_sheets_source_versions set validation_state='valid'"),'immutable');
  await db.query("update public.google_sheets_connections set status='connected',sync_lease_run_id=null,sync_lease_expires_at=null,next_sync_at=now()-interval '1 hour' where id=$1",[connection]);
  const scheduled=await call('claim_google_sheets_sync_v1',[ws,connection,null,null,'scheduled']);
  await deny(()=>call('claim_google_sheets_sync_v1',[ws,connection,null,null,'scheduled']),'schedule_denied|sync_busy');
  await call('fail_google_sheets_sync_v1',[ws,connection,scheduled.runId,'provider_request_failed']);
  assert((await db.query('select next_sync_at>now() future from public.google_sheets_connections where id=$1',[connection])).rows[0].future);checks++;
  // A later accepted accounting source immediately withdraws conflicting currency projections.
  const currencyMapping={...mapping,metrics:[{column:2,name:'Revenue',category:'Financial',unit:'currency',target:null}]};
  await call('approve_google_sheets_mapping_v1',[ws,connection,actor,session,currencyMapping,false]);
  const currencyRows=normalizeSheetsRows({workspaceId:ws,businessEntityId:entity,connectionId:connection,spreadsheetId:spreadsheet,sheetId:0,headerRow:1,mapping:currencyMapping,rows:[['revenue-row','2027-01-01',500]]});
  const currencyRun=await claim();await call('commit_google_sheets_sync_v1',[ws,connection,currencyRun.runId,currencyRows,true]);
  const accountingVersion=randomUUID();
  await db.query("insert into private.canonical_business_fact_versions(id,workspace_id,business_entity_id,reconciliation_state,validation_state,value_kind,posting_date) values($1,$2,$3,'accepted','valid','money','2027-01-01')",[accountingVersion,ws,entity]);
  assert.equal((await db.query("select count(*)::int n from public.kpis where raw_data_json#>>'{googleSheets,unit}'='currency' and archived_at is null")).rows[0].n,0);checks++;
  await db.query('insert into private.canonical_business_facts values($1,$2,$3,$4)',[randomUUID(),ws,entity,accountingVersion]);
  const currencyAgain=await claim();assert.equal((await call('commit_google_sheets_sync_v1',[ws,connection,currencyAgain.runId,currencyRows,true])).conflictCount,1);checks++;
  await db.query("update public.google_sheets_connections set field_mapping='{}' where id=$1",[connection]);
  assert.equal((await db.query('select active_approval_id from public.google_sheets_connections where id=$1',[connection])).rows[0].active_approval_id,null);checks++;
  const locationConnection=randomUUID();const locationMapping={...mapping,locationColumn:4,metrics:[mapping.metrics[0]]};
  await db.query("insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,status,display_name,spreadsheet_id,sheet_id,sheet_title,headers) values($1,$2,$3,$4,'connected','Location sheet',$5,0,'Daily',$6)",[locationConnection,ws,entity,actor,spreadsheet,[...headers,'Location']]);
  await call('approve_google_sheets_mapping_v1',[ws,locationConnection,actor,session,locationMapping,false]);
  const locationRows=normalizeSheetsRows({workspaceId:ws,businessEntityId:entity,connectionId:locationConnection,spreadsheetId:spreadsheet,sheetId:0,headerRow:1,mapping:locationMapping,rows:[['north','2029-01-01',25,null,'North']]});
  const locationRun=await call('claim_google_sheets_sync_v1',[ws,locationConnection,actor,session,'manual']);
  assert.equal((await call('commit_google_sheets_sync_v1',[ws,locationConnection,locationRun.runId,locationRows,true])).factCount,1);checks++;
  await approve(); const totalRun=await claim();assert.equal((await commit(totalRun,[['total','2029-01-01',25,null]])).conflictCount,1);checks++;
  await db.query("insert into public.kpis(workspace_id,name,actual_value,metric_date) values($1,'Orders shipped',25,'2029-01-01')",[ws]);
  assert.equal((await db.query("select count(*)::int n from public.kpis where metric_date='2029-01-01' and archived_at is null")).rows[0].n,1);checks++;
  const operationalId=randomUUID();
  await db.query("insert into public.operational_metrics(id,workspace_id,metric_name,value,metric_date,raw_data_json) values($1,$2,'Orders shipped',70,'2031-01-01',$3)",[operationalId,ws,{'Vaeroex dataset type':'orders','Vaeroex source row':2}]);
  await approve();const preexistingOperational=await claim();
  assert.equal((await commit(preexistingOperational,[['operational-existing','2031-01-01',70,null]])).conflictCount,1);checks++;
  const beforeOperational=await claim();assert.equal((await commit(beforeOperational,[['operational-later','2031-01-02',80,null]])).factCount,1);checks++;
  await db.query("insert into public.operational_metrics(workspace_id,metric_name,value,metric_date) values($1,'Orders shipped',80,'2031-01-02')",[ws]);
  // Late imports never mutate stored values: only the actual EI reader excludes Sheets.
  assert.equal((await db.query("select count(*)::int n from public.kpis where metric_date='2031-01-02' and archived_at is null")).rows[0].n,1);checks++;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  const asPostgrest=row=>({...row,actual_value:row.actual_value===null?null:Number(row.actual_value),target:row.target===null?null:Number(row.target),metric_date:new Date(row.metric_date).toISOString().slice(0,10),created_at:new Date(row.created_at).toISOString(),updated_at:new Date(row.updated_at).toISOString()});
  const reader={from(name){assert.equal(name,'kpis');return{select(){return this;},eq(){return this;},is(){return this;},order(){return this;},async range(from,to){return{data:(await db.query('select * from public.kpis where workspace_id=$1 and archived_at is null and deleted_at is null order by metric_date desc,id limit $2 offset $3',[ws,to-from+1,from])).rows.map(asPostgrest),error:null};}};},async rpc(name,args){try{return{data:await call(name,[args.p_workspace_id],'authenticated'),error:null};}catch(error){return{data:null,error};}}};
  // JSON aggregation avoids PostgREST row caps on the conflict result.
  reader.rpc=async(name,args)=>{await db.exec("set role authenticated; select set_config('request.jwt.claim.role','authenticated',false)");try{return{data:(await db.query(`select public.${name}($1) as result`,[args.p_workspace_id])).rows[0].result,error:null};}finally{await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false)");}};
  assert.equal((await db.query("select prorettype::regtype::text result_type from pg_proc where proname='read_google_sheets_operational_conflicts_v1'")).rows[0].result_type,'jsonb');checks++;
  const eligible=await loadActiveWorkspaceKpis({supabase:reader,workspaceId:ws});assert.equal(eligible.error,null);assert(eligible.complete);assert(!eligible.data.some(row=>row.metric_date==='2031-01-02'));checks++;
  const malformedAuthority=await loadActiveWorkspaceKpis({supabase:{...reader,rpc:async()=>({data:[{kpi_id:42}],error:null})},workspaceId:ws});assert(malformedAuthority.error);assert(!malformedAuthority.complete);assert.deepEqual(malformedAuthority.data,[]);checks++;
  const oversizedAuthority=await loadActiveWorkspaceKpis({supabase:{...reader,rpc:async()=>({data:Array.from({length:20001},()=>({kpi_id:randomUUID()})),error:null})},workspaceId:ws});assert(oversizedAuthority.error);assert(!oversizedAuthority.complete);assert.deepEqual(oversizedAuthority.data,[]);checks++;
  const filteredLayer=buildIntelligenceLayer({asOf:'2031-01-03T00:00:00Z',workspace:{name:'Synthetic'},kpis:eligible.data});assert.equal(filteredLayer.memorySummary.kpiHistoryRecords,eligible.data.length);checks++;
  await db.query("update public.operational_metrics set archived_at=now() where workspace_id=$1 and metric_date='2031-01-02'",[ws]);
  assert((await loadActiveWorkspaceKpis({supabase:reader,workspaceId:ws})).data.some(row=>row.metric_date==='2031-01-02'));checks++;
  assert.equal((await db.query('select value from public.operational_metrics where id=$1',[operationalId])).rows[0].value,'70');checks++;
  await deny(()=>reader.rpc('read_google_sheets_operational_conflicts_v1',{p_workspace_id:otherWs}),'workspace_denied');
  const lifeConnection=randomUUID(), stateHash='sha256:'+'a'.repeat(64), redirectUri='https://vaeroex.com/api/integrations/google-sheets/callback';
  const life=(operation,payload={},cid=lifeConnection,owner=actor,ownerSession=session,workspace=ws)=>call('google_sheets_lifecycle_v1',[operation,workspace,cid,owner,ownerSession,payload]);
  await life('begin',{businessEntityId:entity,displayName:'Lifecycle fixture',stateHash,redirectUri});
  const oauthLease=randomUUID();
  await deny(()=>life('consume',{stateHash,leaseId:oauthLease,redirectUri},lifeConnection,actor,randomUUID()),'owner_denied');
  await deny(()=>life('consume',{stateHash,leaseId:oauthLease,redirectUri},lifeConnection,actor,session,otherWs),'owner_denied');
  await life('consume',{stateHash,leaseId:oauthLease,redirectUri});
  await deny(()=>life('consume',{stateHash,leaseId:oauthLease,redirectUri}),'state_invalid');
  await life('complete_oauth',{leaseId:oauthLease,ciphertext:'synthetic-ciphertext-'.repeat(4),accessExpiresAt:new Date(Date.now()+3600000).toISOString()});
  const refreshLease=randomUUID();
  await life('claim_refresh',{leaseId:refreshLease,credentialVersion:1,generation:1},lifeConnection,null,null);
  await deny(()=>life('claim_refresh',{leaseId:randomUUID(),credentialVersion:1,generation:1},lifeConnection,null,null),'refresh_busy');
  await deny(()=>life('disconnect'),'recovery_required');
  await deny(()=>life('commit_refresh',{leaseId:refreshLease,credentialVersion:1,ciphertext:'synthetic-ciphertext-'.repeat(4),accessExpiresAt:new Date(Date.now()+3600000).toISOString()},lifeConnection,null,null),'refresh_stale');
  await life('commit_refresh',{leaseId:refreshLease,credentialVersion:2,ciphertext:'synthetic-rotated-ciphertext-'.repeat(4),accessExpiresAt:new Date(Date.now()+3600000).toISOString()},lifeConnection,null,null);
  await life('disconnect');
  assert.equal((await db.query('select count(*)::int n from public.google_sheets_credentials where connection_id=$1',[lifeConnection])).rows[0].n,1);checks++;
  await deny(()=>life('complete_disconnect',{credentialVersion:2,generation:2}),'disconnect_stale');
  await life('complete_disconnect',{credentialVersion:2,generation:1});
  assert.equal((await db.query('select count(*)::int n from public.google_sheets_credentials where connection_id=$1',[lifeConnection])).rows[0].n,0);checks++;
  await life('reconnect',{stateHash:'sha256:'+'b'.repeat(64),redirectUri});
  await db.query("update public.google_sheets_oauth_states set created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' where connection_id=$1 and consumed_at is null",[lifeConnection]);
  await deny(()=>life('consume',{stateHash:'sha256:'+'b'.repeat(64),leaseId:randomUUID(),redirectUri}),'state_invalid');
  const recoveryConnection=randomUUID(),recoveryState='sha256:'+'c'.repeat(64),recoveryLease=randomUUID();
  await life('begin',{businessEntityId:entity,displayName:'Recovery fixture',stateHash:recoveryState,redirectUri},recoveryConnection);
  await life('consume',{stateHash:recoveryState,leaseId:recoveryLease,redirectUri},recoveryConnection);
  await deny(()=>life('recover_oauth',{confirmation:'access_removed'},recoveryConnection),'recovery_unavailable');
  await db.query("update public.google_sheets_connections set oauth_lease_expires_at=now()-interval '1 second' where id=$1",[recoveryConnection]);
  const otherActor=randomUUID(),otherSession=randomUUID();
  await db.query('insert into public.profiles values($1)',[otherActor]);await db.query('insert into auth.users(id,deleted_at,banned_until) values($1,null,null)',[otherActor]);
  await db.query('insert into auth.sessions values($1,$2,null)',[otherSession,otherActor]);
  await db.query("insert into public.workspace_members values($1,$2,'owner','active')",[ws,otherActor]);
  await deny(()=>life('recover_oauth',{confirmation:'access_removed'},recoveryConnection,otherActor,otherSession),'recovery_actor_denied');
  await db.query("insert into public.google_sheets_credentials(connection_id,workspace_id,token_ciphertext,access_expires_at,granted_scope,generation,credential_version) values($1,$2,$3,now()+interval '1 hour','https://www.googleapis.com/auth/spreadsheets.readonly',1,1)",[recoveryConnection,ws,'synthetic-ciphertext-'.repeat(4)]);
  await deny(()=>life('recover_oauth',{confirmation:'access_removed'},recoveryConnection),'recovery_unavailable');
  await db.query('delete from public.google_sheets_credentials where connection_id=$1',[recoveryConnection]);
  await life('recover_oauth',{confirmation:'access_removed'},recoveryConnection);
  assert.equal((await db.query('select status,authorization_uncertain from public.google_sheets_connections where id=$1',[recoveryConnection])).rows[0].status,'disconnected');checks++;
  await life('reconnect',{stateHash:'sha256:'+'d'.repeat(64),redirectUri},recoveryConnection);checks++;
  // Endpoints never accept a supplied tenant identifier without SQL revalidation.
  await deny(()=>life('credential',{},lifeConnection,null,null,otherWs),'entitlement_denied|unavailable');
  // Tenant RLS and ciphertext exposure are tested with real PostgreSQL roles.
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${actor}',false)`);
  assert.equal((await db.query('select count(*)::int n from public.google_sheets_connections where workspace_id=$1',[otherWs])).rows[0].n,0);checks++;
  await deny(()=>db.query('select token_ciphertext from public.google_sheets_credentials'));
  await db.exec('reset role');
  const abandonedRecovery = await verifyAbandonedSyncRecovery(db,call,deny);
  return {checks,largeRows:750,largeFacts:1500,liveProviderCalls:0,fullCanonicalBootstrap:false,abandonedRecovery};
}
function verifySensitiveFieldBoundaries() {
  const restricted = [
    'patient_id', 'patients', 'Patient IDs', 'patientCount', 'PatientID',
    'medical_record_number', 'medicalRecordNumber', 'medical-record-numbers',
    'insurance_id', 'insuranceIDs', 'INSURANCE.NUMBERS', 'ephi_value', 'ePHIValue',
    'PHIRecords', 'SSNs', 'MRNValue', 'dateOfBirth', 'dates_of_birth',
    'socialSecurityNumber', 'diagnoses', 'treatments', 'prescriptions',
  ];
  for (const value of restricted) {
    const raw = [...headers]; raw[2] = value;
    assert.equal(safeHeaders(raw)[2], '[restricted column]', value);
    assert.throws(() => assertMapping(raw, mapping), /google_sheets_mapping_invalid/, 'raw or previously saved header: ' + value);
    assert.throws(() => assertMapping(safeHeaders(raw), mapping), /google_sheets_mapping_invalid/, 'discovered header: ' + value);
    assert.throws(() => assertBusinessLabel(value), /google_sheets_sensitive_label_denied/, value);
    for (const field of ['name', 'category']) {
      const named = { ...mapping, metrics: mapping.metrics.map((metric, index) => index === 0 ? { ...metric, [field]: value } : metric) };
      assert.throws(() => assertMapping(headers, named), /Restricted business field/, field + ': ' + value);
    }
    checks++;
  }
  for (const value of ['patientlyProcessedOrders', 'impatientCustomers', 'medicality', 'healthiness', 'philosophy', 'shipping', 'insurancePremiums', 'dobermanCount']) {
    const raw = [...headers]; raw[2] = value;
    assert.deepEqual(safeHeaders(raw), raw, value);
    assertMapping(raw, mapping);
    assert.equal(assertBusinessLabel(value), value);
    assertMapping(headers, { ...mapping, metrics: mapping.metrics.map((metric, index) => index === 0 ? { ...metric, name: value, category: value } : metric) });
    checks++;
  }
  const withLocation = { ...mapping, locationColumn: 4 };
  for (const index of [0, 1, 2, 4]) {
    const raw = [...headers, 'Location']; raw[index] = 'patient_id';
    assert.throws(() => assertMapping(raw, withLocation), /google_sheets_mapping_invalid/, 'every mapped role rejects restricted columns');
    checks++;
  }
  assertMapping(safeHeaders([...headers, 'patient_id']), mapping); checks++;
  assert.equal(safeHeaders(['Orders '.repeat(20) + 'patient_id'])[0], '[restricted column]', 'inspect before header display truncation'); checks++;
}

async function main(){
  verifySensitiveFieldBoundaries();
  const {PGlite}=require(process.env.GOOGLE_SHEETS_PGLITE_PATH||'@electric-sql/pglite');const db=new PGlite();
  try {
    assertMapping(headers,mapping);assert.equal(parseDateCell(46296,'serial'),'2026-10-01');checks++;
    assert.throws(()=>spreadsheetIdFromUrl('https://docs.google.com.evil.test/spreadsheets/d/'+spreadsheet));checks++;
    assert.throws(()=>normalize([['duplicate','2026-10-01',1,0.5],['duplicate','2026-10-02',2,0.5]]),/duplicate/);checks++;
    console.log(JSON.stringify({suite:'google_sheets_data_and_database',...await qualify(db)}));
  }finally{await db.close();}
}
module.exports={qualify};
if(require.main===module)main().catch(error=>{console.error({stage,checks,code:error.code,message:error.message,where:error.where,stack:error.code?undefined:error.stack});process.exitCode=1;});
