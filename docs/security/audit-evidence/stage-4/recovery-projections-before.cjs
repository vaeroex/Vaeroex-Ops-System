/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS regression harness loads actual source functions. */
/* Synthetic SQL regression only. Creates its own Unix-socket-only PostgreSQL
 * cluster; accepts no database URL or hosted target. The focused fixture uses
 * repository DDL/policies and emulates Supabase JWT GUCs. It does not verify
 * GoTrue, PostgREST or Storage HTTP, or replay the entire provider schema. */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { Client } = require('/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex/node_modules/pg');
const ts = require('/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex/node_modules/typescript');
const root = '/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex';
const read = name => fs.readFileSync(path.join(root,"supabase/migrations",name),"utf8").replace(
  "'workspace_agreements',\n         'integration_connection_summaries','integration_freshness_summaries'", "'workspace_agreements'");
const base = read("202606170001_phase_1_schema_rls.sql");
const high = read("20260819174100_security_high_findings_remediation.sql");
const billing = read("202606170003_phase_6_squarespace_subscriptions.sql");
const files = read("202606180004_files_imports.sql");
const audit = read("202607080002_ai_tool_execution_security.sql");
const results = [], clients = [];
const inputShapeMeasurements = [];
let config, owned, started = false;
const bin = process.env.WORKSPACE_AUDIT_PG_BIN;
const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222";
const user = n => `33333333-3333-4333-8333-${String(n).padStart(12,"0")}`;
const asset = n => `44444444-4444-4444-8444-${String(n).padStart(12,"0")}`;
const check = n => `55555555-5555-4555-8555-${String(n).padStart(12,"0")}`;
const form = n => `77777777-7777-4777-8777-${String(n).padStart(12,"0")}`;
const must = (re,s) => { const m=s.match(re); assert(m,`source fixture missing ${re}`); return m[0]; };
const table = (name,s=base) => must(new RegExp("create table (?:if not exists )?public\\."+name+" \\([\\s\\S]*?\\n\\);"),s);
const fn = (name,s=base) => must(new RegExp("create or replace function public\\."+name+"\\([\\s\\S]*?\\n\\$\\$;"),s);
const policy = (name,s=base) => must(new RegExp('create policy "'+name+'"[\\s\\S]*?;'),s);
function analysisInputFixtures() {
  // Evaluate only the actual object initializers, with deliberately generous
  // synthetic values. Unknown new fields fail the fixture instead of being
  // silently omitted. All current production fields are scalar identifiers,
  // code-owned versions, timestamps or counts; no source text/arrays are sent.
  const strict = value => new Proxy(value,{get(target,key){if(key in target)return target[key];throw new Error(`unqualified_analysis_input_field:${String(key)}`);}});
  const text="x".repeat(1024), count=Number.MAX_SAFE_INTEGER;
  const analysisPackage=strict({contractId:text,contractVersion:text,validatorVersion:text,generationPolicyVersion:text,fingerprint:text,
    manifest:strict({version:text}),submode:text,requiredCitationIds:strict({length:count}),facts:strict({drivers:strict({length:count}),independentSourceCount:count})});
  const briefingPackage=strict({generationKey:text,materialStateFingerprint:text,effectiveEvidenceFingerprint:text,evidenceFingerprint:text,
    period:strict({start:text,end:text,cutoff:text}),schemaVersion:text,validatorVersion:text,promptVersion:text,generationPolicyVersion:text});
  return [
    ["app/app/business-health-analysis/actions.ts","business_health_explanation_v1"],
    ["app/app/intelligence/briefings/actions.ts","intelligence_briefing_v1"],
    ["app/app/finding-explanation/actions.ts","finding_explanation_v1"]
  ].map(([relativePath,workflow])=>{
    const source=fs.readFileSync(path.join(root,relativePath),"utf8"), ast=ts.createSourceFile(relativePath,source,ts.ScriptTarget.ES2022,true);
    let expression;
    function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==="inputJson")expression=node.initializer.getText(ast);ts.forEachChild(node,visit);} visit(ast);
    assert(expression,`actual input initializer missing: ${relativePath}`);
    const moduleSource=ts.transpileModule(`exports.build=(analysisPackage,briefingPackage,briefingType)=>{const BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID='business_health_explanation_v1';const INTELLIGENCE_BRIEFING_CONTRACT_ID='intelligence_briefing_v1';const FINDING_EXPLANATION_CONTRACT_ID='finding_explanation_v1';return (${expression});};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const exported={}; new Function("exports",moduleSource)(exported);
    return {relativePath,workflow,input:exported.build(analysisPackage,briefingPackage,"monthly")};
  });
}
function command(name,args) {
  const r=spawnSync(path.join(bin,name),args,{encoding:"utf8",timeout:120000,maxBuffer:2**20});
  if(r.status!==0) throw new Error(`local_${name}_failed: ${String(r.stderr).slice(0,700)}`);
  return r.stdout;
}
async function connect() {
  const c=new Client({...config,ssl:false,statement_timeout:15000,connectionTimeoutMillis:5000});
  c.on("error",()=>{}); await c.connect(); clients.push(c); return c;
}
function pass(name,actual,expected) { assert.deepEqual(actual,expected,name); results.push({name,status:"pass"}); }
async function denied(c,name,sql,code="42501") {
  try { await c.query(sql); assert.fail(`unexpectedly allowed: ${name}`); }
  catch(e) { pass(name,e.code,code); }
}
async function actor(c,n,role="authenticated") {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)",
    [n?user(n):"",role,JSON.stringify({sub:n?user(n):null,role,email:n?`synthetic${n}@example.invalid`:null})]);
  if(role!=="postgres") await c.query(`set role ${role}`);
}
async function admin(c) { await actor(c,0,"postgres"); }
async function projectionFixture(c) {
  const source=read("20260821201220_external_integrations_phase_4_control_plane.sql");
  // Column shapes, SELECT policies, and both complete AFTER writers come from
  // source. This focused fixture does not replay all provider validators/RPCs.
  for(const [summary,backing,label] of [
    ["integration_connection_summaries","integration_connections","connection"],
    ["integration_freshness_summaries","integration_freshness_states","freshness"]
  ]) {
    const ddl=table(summary,source);
    const columns=[...ddl.matchAll(/^  ([a-z_]+) (uuid|text\[\]|text|jsonb|bigint|timestamptz)\b/gm)].map(m=>[m[1],m[2]]);
    // The word boundary does not consume the closing bracket in text[].
    for(const column of columns)if(new RegExp(`^  ${column[0]} text\\[\\]`,'m').test(ddl))column[1]='text[]';
    assert(columns.length>=19,`projection column fixture incomplete: ${summary}`);
    const definition=columns.map(([name,type])=>`${name} ${type}${name==='id'?' primary key':''}`).join(',');
    await c.query(`create table public.${summary}(${definition});alter table public.${summary} enable row level security;alter table public.${summary} force row level security;revoke all on public.${summary} from public,anon,authenticated,service_role;grant select on public.${summary} to authenticated`);
    await c.query(policy(`workspace members read integration ${label} summaries`,source));
    if(backing==='integration_connections') {
      for(const [name,type] of columns.filter(([name])=>!['id','workspace_id','status'].includes(name)))await c.query(`alter table private.${backing} add column ${name} ${type}`);
    } else await c.query(`create table private.${backing}(${definition})`);
    await c.query(must(new RegExp(`create or replace function private\\.sync_integration_${label}_summary_v1\\(\\)[\\s\\S]*?\\n\\$function\\$;`),source));
    await c.query(must(new RegExp(`create trigger sync_integration_${label}_summary_v1[\\s\\S]*?;`),source));
  }
}
async function fixture(c) {
  await c.query(`create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create schema storage; create schema private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant execute on all functions in schema auth to anon,authenticated,service_role;`);
  for(const n of ["profiles","workspaces","workspace_members","tasks","assets","asset_checks","ai_agent_runs","forms","form_submissions"]) await c.query(table(n));
  await c.query(table("record_folders",read("202606180003_record_management.sql")));
  await c.query(table("file_uploads",files));
  await c.query(table("subscription_plans",billing));
  await c.query(table("customer_subscriptions",billing));
  await c.query(table("security_audit_events",audit));
  await c.query(table("support_requests",read("202606170004_admin_support_tools.sql")));
  // Minimal private provider fixtures exercise only the new entitlement
  // triggers, not provider contracts/credentials or full RPC behavior.
  for(const n of ["integration_connections","integration_oauth_states","integration_qbo_oauth_state_bindings_v2","integration_reauthorization_states"]) {
    await c.query(`create table private.${n}(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,status text default 'active')`);
  }
  await c.query(billing.slice(0,billing.indexOf("do $$")));
  // Later migration columns used by these boundaries; no customer data copied.
  await c.query(`alter table customer_subscriptions add column billing_provider text default 'manual',add column stripe_customer_id text,add column stripe_subscription_id text;
    alter table asset_checks add column archived_at timestamptz,add column deleted_at timestamptz;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant all on all tables in schema public to service_role;
    grant all on all tables in schema storage to service_role;`);
  for(const n of ["is_workspace_member","workspace_member_role","has_workspace_role","can_manage_workspace","can_edit_operations"]) await c.query(fn(n));
  await c.query(fn("can_contribute_workspace",high));
  await c.query(read("202606170002_phase_2_invites.sql"));
  for(const n of ["workspaces","workspace_members","tasks","assets","asset_checks","ai_agent_runs","file_uploads","record_folders","security_audit_events","support_requests","forms","form_submissions"]) {
    await c.query(`alter table ${n} enable row level security; grant select,insert,update,delete on ${n} to authenticated;`);
  }
  for(const n of ["members can read workspaces","owners and admins can update workspaces","owners can delete workspaces","members can read workspace members","members can read tasks","managers can create tasks","managers can update tasks","managers can delete tasks","members can read asset checks","managers can delete asset checks"]) await c.query(policy(n));
  for(const n of ["owners can invite members","admins can invite non-owner members","owners can update members","admins can update non-owner members","owners can delete members","admins can delete non-owner members"]) await c.query(policy(n,high));
  // Instantiate the exact dynamic policy templates in the base/high migrations.
  assert(base.includes("'%s managers write'".replaceAll("'",'"')) || base.includes('%s managers write'));
  for(const n of ["assets","ai_agent_runs","forms"]) await c.query(`
    create policy "${n} members read" on ${n} for select to authenticated using(public.is_workspace_member(workspace_id));
    create policy "${n} managers write" on ${n} for insert to authenticated with check(public.can_edit_operations(workspace_id));
    create policy "${n} managers update" on ${n} for update to authenticated using(public.can_edit_operations(workspace_id)) with check(public.can_edit_operations(workspace_id));
    create policy "${n} managers delete" on ${n} for delete to authenticated using(public.can_edit_operations(workspace_id));`);
  for(const n of ["asset_checks","file_uploads","form_submissions"]) await c.query(`
    create policy "${n} contributors create" on ${n} for insert to authenticated with check(public.can_contribute_workspace(workspace_id));
    create policy "${n} contributors update" on ${n} for update to authenticated using(public.can_contribute_workspace(workspace_id)) with check(public.can_contribute_workspace(workspace_id));`);
  await c.query(`create policy "files read" on file_uploads for select to authenticated using(public.is_workspace_member(workspace_id));`);
  await c.query(policy("members can read form submissions"));
  await c.query(policy("security audit events managers read",read("202607080003_security_audit_service_events.sql")));
  await c.query(policy("security audit events contributors create",high));
  for(const n of ["workspace files members read"]) await c.query(policy(n,files));
  for(const n of ["workspace files contributors insert","workspace files contributors update"]) await c.query(policy(n,high));
  await projectionFixture(c);
  await c.query(`create function public.synthetic_definer_write(p_workspace uuid) returns void language plpgsql security definer set search_path='' as $$begin insert into public.tasks(workspace_id,title) values(p_workspace,'Synthetic definer'); end$$;
    grant execute on function public.synthetic_definer_write(uuid) to authenticated;
    insert into profiles(id,email) values ${[1,2,3,4,5,6,7].map(n=>`('${user(n)}','synthetic${n}@example.invalid')`).join(",")};
    insert into workspaces(id,name,subscription_required,subscription_status) values('${A}','Synthetic A',false,'demo'),('${B}','Synthetic B',false,'demo');
    insert into workspace_members(workspace_id,user_id,role) values('${A}','${user(1)}','owner'),('${A}','${user(2)}','staff'),('${A}','${user(3)}','viewer'),('${B}','${user(4)}','owner');
    insert into assets(id,workspace_id,asset_name) values('${asset(1)}','${A}','Synthetic A'),('${asset(2)}','${B}','Synthetic B');
    insert into asset_checks(id,workspace_id,asset_id,status) values('${check(99)}','${A}','${asset(2)}','Historical mismatched');
    insert into security_audit_events(workspace_id,user_id,action_name,operation_type,initiated_by,allowed,created_at) values('${A}','${user(1)}','Legacy forged fixture','SYSTEM','user',false,now()+interval '1 day');
    insert into tasks(workspace_id,title) values('${A}','Historical task');`);
  await c.query("insert into auth.users(id) select id from profiles");
  await c.query(`insert into forms(id,workspace_id,name) values('${form(1)}','${A}','Form A'),('${form(2)}','${B}','Form B')`);
  await actor(c,2);
  await c.query(`insert into form_submissions(workspace_id,form_id,submitted_by,submitter_name) values('${A}','${form(2)}','${user(2)}','Historical mismatch')`);
  pass("before migration: staff can persist a cross-workspace form parent",(await c.query("select count(*)::int n from form_submissions where submitter_name='Historical mismatch'")).rows[0].n,1);
  await admin(c);
}
async function tests(c) {
  await fixture(c);
  await c.query(read("20260731071855_business_health_generation_claim.sql"));
  await c.query(must(/create unique index if not exists ai_agent_runs_intelligence_briefing_generation_claim_uidx[\s\S]*?;/,read("20260817185529_intelligence_briefing_storage_contract.sql")));
  const migrations=["20261005022017_workspace_security_boundaries.sql","20261005022445_workspace_persisted_usage_limits.sql"];
  for(const m of migrations) await c.query(read(m));
  pass("historical mismatched asset row retained",(await c.query(`select count(*)::int n from asset_checks where id='${check(99)}'`)).rows[0].n,1);
  pass("tenant FK remains NOT VALID pending historical review",(await c.query("select convalidated from pg_constraint where conname='asset_checks_workspace_asset_fkey'")).rows[0].convalidated,false);
  pass("form tenant FK remains NOT VALID pending historical review",(await c.query("select convalidated from pg_constraint where conname='form_submissions_workspace_form_fkey'")).rows[0].convalidated,false);
  await actor(c,1);
  await c.query(`insert into storage.objects(bucket_id,name) values('workspace-files','${A}/owner-upload')`);
  results.push({name:"entitled owner can insert own workspace storage metadata",status:"pass"});
  await c.query(`update storage.objects set name='${A}/owner-renamed' where bucket_id='workspace-files' and name='${A}/owner-upload'`);
  pass("entitled owner can update own workspace storage metadata",(await c.query(`select count(*)::int n from storage.objects where name='${A}/owner-renamed'`)).rows[0].n,1);
  await denied(c,"owner cannot move storage metadata into a foreign workspace",`update storage.objects set name='${B}/foreign-move' where bucket_id='workspace-files' and name='${A}/owner-renamed'`);
  await denied(c,"owner cannot insert foreign workspace storage metadata",`insert into storage.objects(bucket_id,name) values('workspace-files','${B}/foreign-upload')`);
  await denied(c,"malformed workspace storage path is denied",`insert into storage.objects(bucket_id,name) values('workspace-files','invalid-workspace/upload')`);
  await actor(c,2);
  await c.query(`insert into storage.objects(bucket_id,name) values('workspace-files','${A}/staff-upload')`);
  results.push({name:"entitled staff can insert own workspace storage metadata",status:"pass"});
  await actor(c,3);
  await denied(c,"viewer cannot insert workspace storage metadata",`insert into storage.objects(bucket_id,name) values('workspace-files','${A}/viewer-upload')`);
  await actor(c,1);
  await denied(c,"client cannot forge trusted security events",`insert into security_audit_events(workspace_id,user_id,action_name,operation_type,initiated_by,allowed) values('${A}','${user(2)}','Forged','SYSTEM','user',false)`);
  await admin(c);
  await c.query(`create function public.synthetic_definer_audit() returns void language plpgsql security definer set search_path='' as $$begin insert into public.security_audit_events(workspace_id,user_id,action_name,operation_type,initiated_by,allowed) values('${A}','${user(2)}','Definer forgery','SYSTEM','user',false); end$$; grant execute on function public.synthetic_definer_audit() to authenticated;`);
  await actor(c,1);
  await denied(c,"client definer cannot stamp trusted security events","select synthetic_definer_audit()");
  await denied(c,"client cannot insert another tenant's asset check",`insert into asset_checks(workspace_id,asset_id,status) values('${A}','${asset(2)}','Ready')`,"23503");
  await denied(c,"nonmember cannot read other tenant",`insert into tasks(workspace_id,title) values('${B}','Foreign')`);
  pass("tenant read isolation",(await c.query(`select count(*)::int n from assets where workspace_id='${B}'`)).rows[0].n,0);
  await actor(c,3);
  await denied(c,"viewer cannot contribute checks",`insert into asset_checks(workspace_id,asset_id,status) values('${A}','${asset(1)}','Ready')`);
  await actor(c,2);
  await denied(c,"after migration: foreign form parent blocked",`insert into form_submissions(workspace_id,form_id,submitted_by) values('${A}','${form(2)}','${user(2)}')`,"23503");
  await c.query(`insert into form_submissions(workspace_id,form_id,submitted_by) values('${A}','${form(1)}','${user(2)}')`);
  results.push({name:"same-tenant staff form submission succeeds",status:"pass"});
  pass("staff cannot independently update parent asset",(await c.query(`update assets set status='Spoofed' where id='${asset(1)}' returning id`)).rowCount,0);
  await c.query(`insert into asset_checks(id,workspace_id,asset_id,checked_by,status,created_at) values('${check(1)}','${A}','${asset(1)}','${user(2)}','Needs attention','2026-01-01'),('${check(2)}','${A}','${asset(1)}','${user(2)}','Ready','2026-01-02')`);
  pass("staff check atomically updates parent readiness",(await c.query(`select status from assets where id='${asset(1)}'`)).rows[0].status,"Ready");
  await c.query(`insert into asset_checks(id,workspace_id,asset_id,status,created_at) values('${check(3)}','${A}','${asset(1)}','Older','2025-01-01')`);
  pass("older check cannot replace newer readiness",(await c.query(`select status from assets where id='${asset(1)}'`)).rows[0].status,"Ready");
  await c.query(`update asset_checks set deleted_at=now() where id='${check(2)}'`);
  pass("hiding latest check reselects active predecessor",(await c.query(`select status from assets where id='${asset(1)}'`)).rows[0].status,"Needs attention");
  await c.query(`update asset_checks set deleted_at=now() where workspace_id='${A}' and asset_id='${asset(1)}'`);
  pass("no active check clears checked time",(await c.query(`select status,last_checked_at from assets where id='${asset(1)}'`)).rows[0],{status:"Needs attention",last_checked_at:null});
  await c.query(`update asset_checks set deleted_at=null,status='Restored' where id='${check(2)}'`);
  pass("restore updates readiness",(await c.query(`select status from assets where id='${asset(1)}'`)).rows[0].status,"Restored");
  await c.query("begin");
  await c.query(`insert into asset_checks(workspace_id,asset_id,status,created_at) values('${A}','${asset(1)}','Rolled back','2027-01-01')`);
  await c.query("rollback");
  pass("rollback preserves both check history and parent",(await c.query(`select status from assets where id='${asset(1)}'`)).rows[0].status,"Restored");
  await admin(c);
  await c.query(`delete from assets where id='${asset(2)}'`);
  pass("foreign parent deletion retains mismatched history",(await c.query(`select count(*)::int n from asset_checks where id='${check(99)}'`)).rows[0].n,1);
  await c.query(`delete from forms where id='${form(2)}'`);
  pass("foreign form deletion retains mismatched historical submission",(await c.query("select count(*)::int n from form_submissions where submitter_name='Historical mismatch'")).rows[0].n,1);
  await actor(c,0,"service_role");
  await c.query(`insert into security_audit_events(workspace_id,user_id,action_name,operation_type,initiated_by,allowed,created_at,server_recorded) values('${A}','${user(1)}','Trusted','SYSTEM','system',false,'2100-01-01',false)`);
  pass("server writer provenance and timestamp enforced",(await c.query("select server_recorded,created_at<'2100-01-01'::timestamptz recent from security_audit_events where action_name='Trusted'")).rows[0],{server_recorded:true,recent:true});
  pass("legacy security events excluded from trusted counts",(await c.query("select count(*)::int n from security_audit_events where server_recorded and not allowed")).rows[0].n,1);
  await admin(c);
  await c.query(`insert into subscription_plans(name,slug,max_ai_runs_per_month) values('Synthetic plan','synthetic',1),('Vaeroex','vaeroex',1000);
    update workspaces set subscription_required=true,subscription_status='expired' where id='${A}';`);
  await actor(c,1);
  pass("expired membership retains historical reads",(await c.query(`select count(*)::int n from tasks where workspace_id='${A}'`)).rows[0].n,1);
  await denied(c,"expired direct data insert denied",`insert into tasks(workspace_id,title) values('${A}','Expired')`);
  await denied(c,"expired definer RPC data insert denied",`select synthetic_definer_write('${A}')`);
  await admin(c);
  for(const n of ["integration_connections","integration_oauth_states","integration_qbo_oauth_state_bindings_v2","integration_reauthorization_states"]) {
    await c.query(`create function public.synthetic_${n}() returns void language plpgsql security definer set search_path='' as $$begin insert into private.${n}(workspace_id) values('${A}'); end$$;grant execute on function public.synthetic_${n}() to authenticated;`);
    await actor(c,1); await denied(c,`expired private ${n} insert blocked through definer`,`select synthetic_${n}()`); await admin(c);
  }
  await c.query(`insert into private.integration_connections(workspace_id) values('${A}');
    insert into private.integration_freshness_states(id,workspace_id,status) values(gen_random_uuid(),'${A}','current');
    create function public.synthetic_disconnect() returns void language plpgsql security definer set search_path='' as $$begin
      if not public.can_edit_operations('${A}') then raise exception 'synthetic_disconnect_denied' using errcode='42501';end if;
      update private.integration_connections set status='disconnecting' where workspace_id='${A}';
      update private.integration_freshness_states set status='disconnected',blocking_level='all_derived' where workspace_id='${A}';
    end$$; grant execute on function public.synthetic_disconnect() to authenticated;`);
  await actor(c,1); await c.query("select synthetic_disconnect()");
  pass("expired owner disconnect reaches actual connection projection writer",(await c.query(`select status from integration_connection_summaries where workspace_id='${A}'`)).rows[0].status,"disconnecting");
  pass("expired owner withdrawal reaches actual freshness projection writer",(await c.query(`select status,blocking_level from integration_freshness_summaries where workspace_id='${A}'`)).rows[0],{status:"disconnected",blocking_level:"all_derived"});
  for(const summary of ["integration_connection_summaries","integration_freshness_summaries"]) {
    await denied(c,`authenticated direct ${summary} insert remains denied`,`insert into public.${summary}(id,workspace_id,status) values(gen_random_uuid(),'${A}','active')`);
    await denied(c,`authenticated direct ${summary} update remains denied`,`update public.${summary} set status='active' where workspace_id='${A}'`);
  }
  await denied(c,"expired storage metadata insert denied",`insert into storage.objects(bucket_id,name) values('workspace-files','${A}/file')`);
  pass("expired direct update has no persisted result",(await c.query(`update tasks set title='Expired update' where workspace_id='${A}' returning id`)).rowCount,0);
  pass("expired delete preserves history",(await c.query(`delete from tasks where workspace_id='${A}' returning id`)).rowCount,0);
  // Payment truth matrix: a Stripe denial overrides every workspace fallback.
  const cases=[
    {name:"future workspace trial",state:"trialing",trial:"now()+interval '1 day'",allowed:true},
    {name:"expired workspace trial",state:"trialing",trial:"now()-interval '1 day'",allowed:false},
    {name:"demo workspace",state:"demo",trial:"null",allowed:true},
    {name:"active flag without authoritative subscription",state:"active",trial:"null",allowed:false}
  ];
  for(const t of cases) {
    await admin(c); await c.query(`update workspaces set subscription_status='${t.state}',trial_ends_at=${t.trial} where id='${A}'`);
    await actor(c,1); const sql=`insert into tasks(workspace_id,title) values('${A}','Matrix')`;
    if(t.allowed) { await c.query(sql); results.push({name:t.name,status:"pass"}); }
    else await denied(c,t.name,sql);
    if(t.name==="future workspace trial") {
      await c.query("select synthetic_disconnect()");
      pass("entitled owner can refresh both recovery projections",(await c.query(`select
        (select status='disconnecting' from integration_connection_summaries where workspace_id='${A}') connection_ok,
        (select status='disconnected' from integration_freshness_summaries where workspace_id='${A}') freshness_ok`)).rows[0],{connection_ok:true,freshness_ok:true});
    }
  }
  await admin(c);
  await c.query(`update workspaces set manually_unlocked=true,subscription_status='demo',subscription_required=false where id='${A}';
    insert into customer_subscriptions(workspace_id,customer_email,billing_provider,manually_activated,status,plan_slug) values('${A}','synthetic@example.invalid','manual',true,'active','synthetic');`);
  await actor(c,1); await c.query(`insert into tasks(workspace_id,title) values('${A}','Manual')`); results.push({name:"manual entitlement write",status:"pass"});
  await admin(c);
  await c.query(`insert into customer_subscriptions(workspace_id,customer_email,billing_provider,status,current_period_end,stripe_customer_id,stripe_subscription_id,plan_slug) values('${A}','synthetic@example.invalid','stripe','canceled',now()+interval '1 day','cus_synthetic','sub_synthetic','synthetic');`);
  await actor(c,1); await denied(c,"canceled Stripe overrides manual/demo/not-required fallback",`insert into tasks(workspace_id,title) values('${A}','Canceled stripe')`);
  for(const [name,status,period,cus,allowed] of [
    ["active Stripe future period","active","now()+interval '1 day'","cus_synthetic",true],
    ["trialing Stripe future period","trialing","now()+interval '1 day'","cus_synthetic",true],
    ["active Stripe expired period","active","now()-interval '1 day'","cus_synthetic",false],
    ["past due Stripe","past_due","now()+interval '1 day'","cus_synthetic",false],
    ["active Stripe missing customer","active","now()+interval '1 day'","",false]
  ]) {
    await admin(c); await c.query(`update customer_subscriptions set status='${status}',current_period_end=${period},stripe_customer_id='${cus}' where billing_provider='stripe'`);
    await actor(c,1); const sql=`insert into tasks(workspace_id,title) values('${A}','Stripe matrix')`;
    if(allowed) { await c.query(sql); results.push({name,status:"pass"}); } else await denied(c,name,sql);
  }
  await actor(c,0,"service_role");
  await c.query(`update customer_subscriptions set status='active',current_period_end=now()+interval '1 day',stripe_customer_id='cus_synthetic' where billing_provider='stripe'`);
  results.push({name:"service billing recovery remains writable",status:"pass"});
  const bootstrap="66666666-6666-4666-8666-666666666666";
  await c.query(`insert into workspaces(id,name,created_by) values('${bootstrap}','Synthetic bootstrap','${user(7)}'); insert into workspace_members(workspace_id,user_id,role) values('${bootstrap}','${user(7)}','owner')`);
  results.push({name:"service workspace bootstrap can create first membership before entitlement link",status:"pass"});
  await c.query(`update workspaces set subscription_required=false where id='${bootstrap}'`);
  await actor(c,7);
  pass("authorized active workspace deletion retains FK cascade behavior",(await c.query(`delete from workspaces where id='${bootstrap}' returning id`)).rowCount,1);
  await admin(c);
  await c.query(`insert into workspace_members(workspace_id,invited_email,role,status) values('${A}','synthetic5@example.invalid','staff','invited')`);
  await actor(c,5); await c.query("select accept_workspace_invites_for_current_user()");
  pass("active invite acceptance without prior membership",(await c.query(`select count(*)::int n from workspace_members where user_id='${user(5)}'`)).rows[0].n,1);
  await admin(c);
  await c.query(`update customer_subscriptions set status='canceled' where billing_provider='stripe'; insert into workspace_members(workspace_id,invited_email,role,status) values('${A}','synthetic6@example.invalid','staff','invited')`);
  await actor(c,6); await denied(c,"expired invite definer cannot mutate membership","select accept_workspace_invites_for_current_user()");
  await admin(c); await c.query(`update customer_subscriptions set status='active' where billing_provider='stripe'`);
  // Independent real connections race one remaining slot. No provider calls.
  const race=await Promise.all(Array.from({length:16},()=>connect()));
  for(const rc of race) await actor(rc,1);
  const admitted=await Promise.all(race.map(rc=>rc.query(`insert into ai_agent_runs(workspace_id,agent_type,created_at) values('${A}','synthetic-race','2000-01-01')`).then(()=>"accepted",e=>e.code)));
  pass("16 concurrent final AI slots admit exactly one",admitted.filter(v=>v==="accepted").length,1);
  pass("15 excess AI slots fail closed",admitted.filter(v=>v==="23514").length,15);
  pass("authenticated backdating cannot bypass monthly count",(await c.query(`select count(*)::int n from ai_agent_runs where created_at>=date_trunc('month',now())`)).rows[0].n,1);
  await c.query(`update customer_subscriptions set plan_slug='vaeroex' where billing_provider='stripe';
    insert into file_uploads(workspace_id,original_name,display_name,file_extension,mime_type,storage_path)
      select '${A}','synthetic','synthetic','txt','text/plain','synthetic/'||n from generate_series(1,499) n;`);
  const filesRace=await Promise.all(race.map(rc=>rc.query(`insert into file_uploads(workspace_id,original_name,display_name,file_extension,mime_type,storage_path) values('${A}','synthetic','synthetic','txt','text/plain','synthetic/race')`).then(()=>"accepted",e=>e.code)));
  pass("16 concurrent final file slots admit exactly one",filesRace.filter(v=>v==="accepted").length,1);
  pass("15 excess file slots fail closed",filesRace.filter(v=>v==="23514").length,15);
  const hidden=(await c.query(`update file_uploads set deleted_at=now() where id=(select id from file_uploads limit 1) returning id`)).rows[0].id;
  await race[0].query(`insert into file_uploads(workspace_id,original_name,display_name,file_extension,mime_type,storage_path) values('${A}','synthetic','synthetic','txt','text/plain','synthetic/replacement')`);
  await denied(race[0],"hidden-file restore cannot overfill quota",`update file_uploads set deleted_at=null where id='${hidden}'`,"23514");
  await c.query(`update customer_subscriptions set plan_slug='synthetic' where billing_provider='stripe'; delete from ai_agent_runs where workspace_id='${A}'`);
  await race[0].query("begin isolation level repeatable read"); await race[1].query("begin isolation level repeatable read");
  await race[0].query("select count(*) from ai_agent_runs"); await race[1].query("select count(*) from ai_agent_runs");
  await race[0].query(`insert into ai_agent_runs(workspace_id,agent_type) values('${A}','repeatable-read')`); await race[0].query("commit");
  await denied(race[1],"repeatable-read stale final slot fails serialization",`insert into ai_agent_runs(workspace_id,agent_type) values('${A}','repeatable-read')`,"40001"); await race[1].query("rollback");
  const run=(await c.query("select id,created_at from ai_agent_runs limit 1")).rows[0];
  await race[0].query(`insert into ai_agent_runs(id,workspace_id,agent_type) values('${run.id}','${A}','retry') on conflict(id) do update set status='completed'`);
  results.push({name:"idempotent run upsert at full quota preserves one persisted slot",status:"pass"});
  await denied(race[0],"run timestamp cannot be moved to evade usage",`update ai_agent_runs set created_at='2000-01-01' where id='${run.id}'`,"23514");
  await race[0].query("begin");
  await race[0].query(`insert into asset_checks(workspace_id,asset_id,status,created_at) values('${A}','${asset(1)}','Concurrent older','2030-01-01')`);
  const newer=race[1].query(`insert into asset_checks(workspace_id,asset_id,status,created_at) values('${A}','${asset(1)}','Concurrent latest','2031-01-01')`);
  await race[0].query("commit"); await newer;
  pass("concurrent checks serialize and retain latest readiness",(await c.query(`select status from assets where id='${asset(1)}'`)).rows[0].status,"Concurrent latest");
  await c.query(`create function public.synthetic_parent_failure() returns trigger language plpgsql as $$begin if new.status='Injected failure' then raise exception 'injected_parent_failure' using errcode='23514'; end if; return new; end$$; create trigger synthetic_parent_failure before update on assets for each row execute function public.synthetic_parent_failure();`);
  await denied(race[0],"parent failure rolls back check insert",`insert into asset_checks(workspace_id,asset_id,status,created_at) values('${A}','${asset(1)}','Injected failure','2032-01-01')`,"23514");
  pass("failed parent update persists no child",(await c.query("select count(*)::int n from asset_checks where status='Injected failure'")).rows[0].n,0);

  // Explicit private platform authority preserves the established admin bypass
  // without inheriting anyone else's exemption or trusting metadata/email.
  await c.query(`update workspaces set subscription_status='expired',subscription_required=true,manually_unlocked=false where id='${A}';
    update customer_subscriptions set status='canceled' where workspace_id='${A}' and billing_provider='stripe'`);
  await actor(c,1);
  await denied(c,"unconfigured admin-style account obeys normal expired rules",`insert into tasks(workspace_id,title) values('${A}','Unconfigured exemption')`);
  await actor(c,0,"service_role");
  pass("service role retains the existing private schema usage barrier",(await c.query("select has_schema_privilege('service_role','private','USAGE') allowed")).rows[0].allowed,false);
  await admin(c);
  pass("service role has no direct exemption table privileges",(await c.query("select has_table_privilege('service_role','private.platform_admin_subscription_exemptions','SELECT,INSERT,UPDATE,DELETE') allowed")).rows[0].allowed,false);
  await actor(c,0,"service_role");
  await denied(c,"service client cannot configure platform subscription exemptions",`insert into private.platform_admin_subscription_exemptions(user_id) values('${user(1)}')`);
  await admin(c);
  await c.query(`insert into private.platform_admin_subscription_exemptions(user_id) values('${user(1)}')`);
  results.push({name:"trusted database owner can configure a verified auth user exemption",status:"pass"});
  await denied(c,"exemption requires an existing auth.users identity",`insert into private.platform_admin_subscription_exemptions(user_id) values('99999999-9999-4999-8999-999999999999')`,"23503");
  await actor(c,0,"service_role");
  const rpcSql=(actorId,workflow="business_health_explanation_v1",input="{}")=>`select * from create_trusted_analysis_run_v1('${A}','${actorId}','${workflow}','${input}'::jsonb)`;
  const rpcInput=JSON.stringify({fingerprint:"synthetic-exempt-fingerprint",generation_policy_version:"synthetic-policy"});
  const trustedRun=(await c.query(rpcSql(user(1),"business_health_explanation_v1",rpcInput))).rows[0].id;
  pass("service RPC accepts configured admin after expiry with authoritative fields",(await c.query("select status,created_by,output_json,created_at>now()-interval '1 minute' recent from ai_agent_runs where id=$1",[trustedRun])).rows[0],{status:"processing",created_by:user(1),output_json:{},recent:true});
  await denied(c,"service RPC preserves Business Health duplicate23505",rpcSql(user(1),"business_health_explanation_v1",rpcInput),"23505");
  const briefingInput=JSON.stringify({briefing_type:"monthly",generation_key:"synthetic-exempt-generation"});
  await c.query(rpcSql(user(1),"intelligence_briefing_v1",briefingInput));
  await denied(c,"service RPC preserves Briefing duplicate23505",rpcSql(user(1),"intelligence_briefing_v1",briefingInput),"23505");
  await c.query(rpcSql(user(1),"finding_explanation_v1"));
  results.push({name:"service RPC accepts allowlisted Finding Explanation workflow",status:"pass"});
  for(const shaped of analysisInputFixtures()) {
    const input=JSON.stringify(shaped.input);
    const bytes=(await c.query("select pg_column_size($1::jsonb) n",[input])).rows[0].n;
    pass(`actual ${shaped.workflow} shape fits bounded RPC with generous scalar values`,bytes<262144,true);
    await c.query("select * from create_trusted_analysis_run_v1($1,$2,$3,$4::jsonb)",[A,user(1),shaped.workflow,input]);
    inputShapeMeasurements.push({source:shaped.relativePath,workflow:shaped.workflow,jsonbBytes:bytes,limitBytes:262144,fixture:"1024-byte strings; MAX_SAFE_INTEGER counts; actual caller initializer"});
  }
  const emptyPaddingBytes=(await c.query("select pg_column_size(jsonb_build_object('padding','')) n")).rows[0].n;
  await c.query("select * from create_trusted_analysis_run_v1($1,$2,'finding_explanation_v1',jsonb_build_object('padding',repeat('x',$3::integer)))",[A,user(1),262144-emptyPaddingBytes]);
  results.push({name:"RPC accepts exact256KiB JSONB payload boundary",status:"pass"});
  await denied(c,"RPC rejects payload exceeding256KiB JSONB boundary",`select * from create_trusted_analysis_run_v1('${A}','${user(1)}','finding_explanation_v1',jsonb_build_object('padding',repeat('x',${262145-emptyPaddingBytes})))`,"22023");
  await denied(c,"service RPC cannot grant ordinary actor expired access",rpcSql(user(2)));
  await denied(c,"service RPC refuses actor outside selected workspace",rpcSql(user(4)));
  await denied(c,"service RPC refuses unregistered workflow",rpcSql(user(1),"file_analysis"),"22023");
  await denied(c,"service client cannot forge a private per-run authorization",`insert into private.ai_run_actor_authorizations(run_id,workspace_id,actor_id,transaction_id) values(gen_random_uuid(),'${A}','${user(1)}',txid_current())`);
  await denied(c,"direct service insert cannot borrow exemption through created_by",`insert into ai_agent_runs(workspace_id,agent_type,created_by) values('${A}','direct-service','${user(1)}')`,"23514");
  await actor(c,1,"service_role");
  await denied(c,"service JWT subject alone does not create a global quota bypass",`insert into ai_agent_runs(workspace_id,agent_type,created_by) values('${A}','direct-service','${user(1)}')`,"23514");
  await actor(c,1);
  await denied(c,"authenticated admin cannot invoke trusted service RPC",rpcSql(user(1)));
  await c.query(`insert into tasks(workspace_id,title) values('${A}','Configured admin despite expiry')`);
  results.push({name:"configured active-member admin remains entitled after expiry",status:"pass"});
  await c.query(`insert into ai_agent_runs(workspace_id,agent_type) values('${A}','Exempt over quota')`);
  results.push({name:"configured admin retains unlimited persisted AI slots",status:"pass"});
  await c.query(`insert into file_uploads(workspace_id,original_name,display_name,file_extension,mime_type,storage_path) values('${A}','exempt','exempt','txt','text/plain','synthetic/exempt')`);
  results.push({name:"configured admin retains unlimited persisted file slots",status:"pass"});
  await denied(c,"exempt account cannot mutate a workspace without membership",`insert into tasks(workspace_id,title) values('${B}','Foreign exempt account')`);
  await actor(c,2);
  await denied(c,"authenticated staff cannot invoke RPC with another admin identity",rpcSql(user(1)));
  await denied(c,"staff cannot grant a subscription exemption",`insert into private.platform_admin_subscription_exemptions(user_id) values('${user(2)}')`);
  await denied(c,"staff cannot change another admin exemption",`update private.platform_admin_subscription_exemptions set user_id='${user(2)}' where user_id='${user(1)}'`);
  await denied(c,"staff cannot read private exemption identities","select * from private.platform_admin_subscription_exemptions");
  await denied(c,"staff cannot use another admin exemption",`insert into asset_checks(workspace_id,asset_id,status) values('${A}','${asset(1)}','Borrowed exemption')`);
  await c.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user(2),role:"authenticated",email:"synthetic1@example.invalid",user_metadata:{vaeroex_admin:true},app_metadata:{vaeroex_admin:true}})]);
  await denied(c,"email or metadata claims cannot forge exemption",`insert into asset_checks(workspace_id,asset_id,status) values('${A}','${asset(1)}','Forged exemption')`);
  await admin(c);
  await c.query(`insert into private.platform_admin_subscription_exemptions(user_id) values('${user(3)}')`);
  await actor(c,3);
  await denied(c,"configured exemption does not upgrade viewer mutation permissions",`insert into asset_checks(workspace_id,asset_id,status) values('${A}','${asset(1)}','Viewer exemption')`);
  await actor(c,0,"service_role");
  await c.query(`update workspace_members set status='disabled' where workspace_id='${A}' and user_id='${user(1)}'`);
  await denied(c,"service RPC refuses disabled actor despite configured exemption",rpcSql(user(1)));
  await actor(c,1);
  await denied(c,"disabled membership cannot use configured exemption",`insert into tasks(workspace_id,title) values('${A}','Disabled exemption')`);
  await admin(c);
  await c.query(`update workspace_members set status='active' where workspace_id='${A}' and user_id='${user(1)}'; delete from private.platform_admin_subscription_exemptions where user_id in ('${user(1)}','${user(3)}')`);
  await actor(c,1);
  await denied(c,"removing exemption resumes expired subscription enforcement",`insert into tasks(workspace_id,title) values('${A}','Revoked exemption')`);
  await actor(c,0,"service_role");
  await c.query(`update customer_subscriptions set status='active' where workspace_id='${A}' and billing_provider='stripe'`);
  await denied(c,"ordinary service RPC actor remains subject to quota",rpcSql(user(2)),"23514");
  // A new generation is denied at capacity, but existing generation retries
  // must retain their 23505 signal for the caller's cached/conflict lookup.
  await denied(c,"ordinary actor retry preserves23505 at full quota",rpcSql(user(2),"business_health_explanation_v1",rpcInput),"23505");
  await actor(c,1);
  await denied(c,"removing exemption resumes the normal AI quota",`insert into ai_agent_runs(workspace_id,agent_type) values('${A}','Normal quota restored')`,"23514");
  await actor(c,0,"service_role");
  await c.query(`update customer_subscriptions set plan_slug='vaeroex' where workspace_id='${A}' and billing_provider='stripe'`);
  await actor(c,1);
  await denied(c,"removing exemption resumes the normal file quota",`insert into file_uploads(workspace_id,original_name,display_name,file_extension,mime_type,storage_path) values('${A}','normal','normal','txt','text/plain','synthetic/restored-quota')`,"23514");
  await actor(c,0,"service_role");
  for(const ordinaryActor of [1,2,3]) await c.query(rpcSql(user(ordinaryActor),"finding_explanation_v1",JSON.stringify({synthetic_actor:ordinaryActor})));
  results.push({name:"service RPC preserves owner staff and viewer active analysis behavior under quota",status:"pass"});
  await admin(c);
  pass("successful and failed RPCs leave no reusable actor authorizations",(await c.query("select count(*)::int n from private.ai_run_actor_authorizations")).rows[0].n,0);
  await actor(c,0,"anon");
  pass("fixture anonymous ACL has no read grant (not a hosted ACL assertion)",(await c.query("select has_table_privilege('anon','public.asset_checks','SELECT') allowed")).rows[0].allowed,false);
  await admin(c);
  pass("private mutation functions not directly executable",(await c.query("select has_function_privilege('authenticated','private.enforce_workspace_persisted_limit_v1()','EXECUTE') allowed")).rows[0].allowed,false);
  await admin(c);
  return {migrations,version:(await c.query("show server_version")).rows[0].server_version,inputShapeMeasurements,results};
}
(async()=>{
  for(const n of ["DATABASE_URL","PGHOST","PGPORT","PGDATABASE","PGUSER","PGPASSWORD","PGSERVICE","SUPABASE_TEST_DATABASE_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_ACCESS_TOKEN"]) {
    if(Object.hasOwn(process.env,n)) throw new Error("inherited_database_or_credential_configuration_forbidden");
  }
  if(!bin||!path.isAbsolute(bin)||!fs.existsSync(path.join(bin,"initdb"))) throw new Error("explicit_local_postgres_bin_required");
  owned=fs.mkdtempSync("/tmp/vaeroex-security-sql-"); fs.chmodSync(owned,0o700); const socket=path.join(owned,"socket"); fs.mkdirSync(socket,{mode:0o700});
  command("initdb",["-D",path.join(owned,"data"),"--username=postgres","--auth-local=trust","--auth-host=reject","--encoding=UTF8","--no-locale"]);
  command("pg_ctl",["-D",path.join(owned,"data"),"-l",path.join(owned,"postgres.log"),"-o",`-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c max_connections=24 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`,"-w","start"]); started=true;
  config={host:socket,port:5432,user:"postgres",database:"postgres"}; const c=await connect();
  const observed=(await c.query("select current_setting('data_directory') d,current_setting('listen_addresses') a,inet_server_addr() ip")).rows[0];
  assert.equal(fs.realpathSync(observed.d),fs.realpathSync(path.join(owned,"data"))); assert.equal(observed.a,""); assert.equal(observed.ip,null);
  console.log(JSON.stringify({scope:"focused repository-SQL fixture, synthetic JWT roles, owned native PostgreSQL, no HTTP/provider verification",...(await tests(c))},null,2));
})().catch(e=>{console.error(JSON.stringify({status:"failed",code:e.code||null,message:e.message,where:e.where,passed:results.length}));process.exitCode=1;})
 .finally(async()=>{for(const c of clients) await c.end().catch(()=>{});if(started) command("pg_ctl",["-D",path.join(owned,"data"),"-m","fast","-w","stop"]);});
