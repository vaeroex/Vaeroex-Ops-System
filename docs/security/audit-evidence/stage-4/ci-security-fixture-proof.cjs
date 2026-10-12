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
const read = name => fs.readFileSync(path.join(root,"supabase/migrations",name),"utf8");
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
  const kpi=read("202606180002_kpi_dashboard.sql");
  await c.query(table("kpis",kpi));
  await c.query("alter table kpis enable row level security; grant select,insert,update,delete on kpis to authenticated");
  await c.query(policy("kpis members read",kpi));
  await c.query(policy("kpis contributors create",high));
  await c.query(fn("set_updated_at"));
  await c.query(read("20261002182049_integration_summary_preferences.sql"));
  const migrations=["20261005022017_workspace_security_boundaries.sql","20261005022445_workspace_persisted_usage_limits.sql"];
  for(const m of migrations)await c.query(read(m));
  const before=fs.readFileSync('/tmp/vaeroex-ci-security-fixture-before.sql','utf8');
  const after=fs.readFileSync(path.join(root,'supabase/tests/security_high_findings_remediation.test.sql'),'utf8');
  const insert=(source,name)=>must(new RegExp('insert into public\\.'+name+'\\s*\\([\\s\\S]*?;'),source);
  const setActor=async id=>{await c.query('reset role');await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[id]);await c.query('set role authenticated');};
  await c.query(insert(after,'profiles'));await c.query(insert(before,'workspaces'));await c.query(insert(after,'workspace_members'));
  const staff='a6900000-0000-4000-8000-000000000003',viewer='a6900000-0000-4000-8000-000000000004';
  const staffInsert=must(/insert into public.kpis \(workspace_id, name, actual_value, metric_date, created_by\)[\s\S]*?;/,after);
  await setActor(staff);await denied(c,'old default-entitlement fixture reproduces CI42501 at Staff KPI insert',staffInsert);
  await admin(c);await c.query("delete from workspaces where id in ('b6900000-0000-4000-8000-000000000001','b6900000-0000-4000-8000-000000000002')");
  await c.query(insert(after,'workspaces'));await c.query(insert(after,'workspace_members'));
  await setActor(staff);await c.query(staffInsert);pass('actual corrected bounded-trial fixture permits legitimate Staff KPI',(await c.query("select count(*)::int n from kpis where name='Staff legitimate KPI'")).rows[0].n,1);
  await denied(c,'entitled fixture still rejects cross-workspace Staff KPI',"insert into kpis(workspace_id,name) values('b6900000-0000-4000-8000-000000000002','foreign')");
  await setActor(viewer);await denied(c,'entitled fixture still rejects Viewer KPI',staffInsert);
  await setActor('a6900000-0000-4000-8000-000000000001');pass('entitled Owner can update safe workspace name',(await c.query("update workspaces set name='Safe rename' where id='b6900000-0000-4000-8000-000000000001' returning id")).rowCount,1);

  await admin(c);
  for(const [name,actorId,workspace,otherWorkspace] of [
    ['integration_summary_preferences','a9910000-0000-4000-8000-000000000001','b9910000-0000-4000-8000-000000000001','b9910000-0000-4000-8000-000000000003'],
    ['workspace_reporting_timezone','a9920000-0000-4000-8000-000000000001','b9920000-0000-4000-8000-000000000001','b9920000-0000-4000-8000-000000000002']
  ]) {
    const oldSource=fs.readFileSync('/tmp/vaeroex-ci-'+name+'-before.sql','utf8');
    const source=fs.readFileSync(path.join(root,'supabase/tests',name+'.test.sql'),'utf8');
    await c.query(must(/insert into auth.users\([\s\S]*?;/,source));
    await c.query(insert(source,'profiles'));await c.query(insert(oldSource,'workspaces'));await c.query(insert(source,'workspace_members'));
    const statement=name==='integration_summary_preferences'?must(/insert into public.integration_summary_preferences\([\s\S]*?;/,source):must(/update public.workspaces set reporting_timezone = 'America\/Los_Angeles'[\s\S]*?;/,source);
    await setActor(actorId);
    if(name==='integration_summary_preferences')await denied(c,'old preferences fixture rejects positive Viewer save without entitlement',statement);
    else pass('old timezone fixture cannot persist positive Owner update without entitlement',(await c.query(statement)).rowCount,0);
    await admin(c);
    await c.query(`delete from workspaces where id::text like '${workspace.slice(0,8)}%'`);
    await c.query(insert(source,'workspaces'));await c.query(insert(source,'workspace_members'));
    await setActor(actorId);await c.query(statement);
    if(name==='integration_summary_preferences') {
      pass('corrected actual preferences fixture permits own Viewer preferences',(await c.query('select count(*)::int n from integration_summary_preferences')).rows[0].n,3);
      await denied(c,'corrected preferences fixture still denies inaccessible workspace',`insert into integration_summary_preferences(workspace_id,user_id,summary_key) values('${otherWorkspace}','${actorId}','square:'||repeat('c',64))`);
    } else {
      pass('corrected actual timezone fixture permits active Owner update',(await c.query(`select reporting_timezone from workspaces where id='${workspace}'`)).rows[0].reporting_timezone,'America/Los_Angeles');
      pass('corrected timezone fixture still denies foreign workspace update',(await c.query(`update workspaces set reporting_timezone='UTC' where id='${otherWorkspace}'`)).rowCount,0);
    }
    await admin(c);
  }
  await admin(c);return {version:(await c.query('show server_version')).rows[0].server_version,scope:'Focused actual fixture seed/KPI statement and production SQL, not full pgTAP suite',migrations,results};
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
})().catch(e=>{console.error(JSON.stringify({status:"failed",code:e.code||null,message:e.message,passed:results.length}));process.exitCode=1;})
 .finally(async()=>{for(const c of clients) await c.end().catch(()=>{});if(started) command("pg_ctl",["-D",path.join(owned,"data"),"-m","fast","-w","stop"]);});
