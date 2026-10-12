/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic native PostgreSQL test harness. */
// Creates an owned Unix-socket-only cluster. Never accepts a database URL or hosted credentials.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261012091842_admin_usage_trust_support_telemetry.sql'), 'utf8');
const bin = process.env.ADMIN_METRICS_PG_BIN || process.env.WORKSPACE_AUDIT_PG_BIN;
const decodedExports = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root, 'lib/admin/usage-metrics.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(decodedExports);
const checks = [], clients = []; let owned, started = false, config;
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const uuid = n => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`;
function cmd(name,args) { const result=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:120000,maxBuffer:2**20}); assert.equal(result.status,0,`Owned ${name} failed: ${result.stderr}`); return result.stdout; }
async function connect() { const c=new Client({...config,ssl:false,statement_timeout:15000}); c.on('error',()=>{}); await c.connect();clients.push(c);return c; }
function equal(name,value,expected) { assert.deepEqual(value,expected,name); checks.push(name); }
async function rejects(name,operation,code) { await assert.rejects(operation,error=>error.code===code,name);checks.push(name); }
// Use the repository's actual audit SELECT policy and authorization helpers,
// not a service-role query with an application-side workspace filter.
async function auditVisibilityFixture(c) {
 const base=fs.readFileSync(path.join(root,'supabase/migrations/202606170001_phase_1_schema_rls.sql'),'utf8');
 const audit=fs.readFileSync(path.join(root,'supabase/migrations/202607080003_security_audit_service_events.sql'),'utf8');
 await c.query(`create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 grant execute on function auth.uid() to authenticated;
 create table workspace_members(workspace_id uuid,user_id uuid,role text,status text);
 alter table security_audit_events enable row level security;
 grant select on security_audit_events to authenticated;`);
 for(const name of ['workspace_member_role','has_workspace_role','can_edit_operations']) {
  const sql=base.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\n\\$\\$;'))?.[0];
  assert(sql,`Missing authoritative helper ${name}`);await c.query(sql);
 }
 const policy=audit.match(/create policy "security audit events managers read"[\s\S]*?;/)?.[0];
 assert(policy,'Missing authoritative audit SELECT policy');await c.query(policy);
 await c.query(`insert into profiles(id) select ('44444444-4444-4444-8444-'||lpad(n::text,12,'0'))::uuid from generate_series(901,907) n;
 insert into workspace_members(workspace_id,user_id,role,status) values
 ('${A}','${uuid(901)}','manager','active'),('${A}','${uuid(902)}','admin','active'),('${B}','${uuid(903)}','owner','active'),
 ('${A}','${uuid(904)}','staff','active'),('${B}','${uuid(905)}','staff','active'),('${A}','${uuid(907)}','manager','disabled');`);
}
async function auditTenantTests(c) {
 await c.query(`insert into support_requests(id,workspace_id,name,email,message,deleted_at,status) values
 ('${uuid(401)}','${A}','Synthetic A1','a1@example.invalid','PRIVATE_SENTINEL',null,'open'),
 ('${uuid(402)}','${A}','Synthetic A2','a2@example.invalid','PRIVATE_SENTINEL',null,'open'),
 ('${uuid(403)}','${B}','Synthetic B1','b1@example.invalid','PRIVATE_SENTINEL',null,'open'),
 ('${uuid(404)}',null,'Synthetic unassigned','none@example.invalid','PRIVATE_SENTINEL',null,'open'),
 ('${uuid(405)}','${A}','Synthetic deleted','deleted@example.invalid','PRIVATE_SENTINEL',now(),'closed'),
 ('${uuid(406)}','${A}','Synthetic rollback A','rollback-a@example.invalid','PRIVATE_SENTINEL',null,'open'),
 ('${uuid(407)}','${B}','Synthetic rollback B','rollback-b@example.invalid','PRIVATE_SENTINEL',null,'open'),
 ('${uuid(408)}',null,'Synthetic rollback unassigned','rollback-none@example.invalid','PRIVATE_SENTINEL',null,'open');`);
 const mixedIds=[uuid(401),uuid(402),uuid(403),uuid(404),uuid(405),uuid(999)];
 const operation=uuid(701);
 const mixed=await support(c,mixedIds,'delete',operation);
 equal('mixed-workspace receipt retains the aggregate service-only result',mixed,{changed_count:4,changed_ids:[uuid(401),uuid(402),uuid(403),uuid(404)],requested_count:6,replayed:false});
 const auditRows=await c.query('select workspace_id,user_id,action_name,request_id,metadata_json from security_audit_events where request_id=$1 order by workspace_id nulls last',[operation]);
 equal('mixed batch produces one audit row per actual affected workspace',auditRows.rows.map(row=>row.workspace_id),[A,B,null]);
 const expectedMeta=(requested,changed)=>({source:'admin_support_request_action',requested_ids:requested,affected_ids:changed,requested_count:requested.length,changed_count:changed.length});
 const expected=[expectedMeta([uuid(401),uuid(402),uuid(405)],[uuid(401),uuid(402)]),expectedMeta([uuid(403)],[uuid(403)]),expectedMeta([uuid(404)],[uuid(404)])];
 equal('audit IDs and counts are local to each affected workspace',auditRows.rows.map(row=>row.metadata_json),expected);
 equal('audit groups record exact actor action and operation',auditRows.rows.every(row=>row.user_id===U&&row.action_name==='admin.delete_support_request'&&row.request_id===operation),true);
 equal('scoped audit metadata contains no support contents',JSON.stringify(auditRows.rows).includes('PRIVATE_SENTINEL'),false);
 equal('mixed operation retry returns original receipt',(await support(c,[...mixedIds].reverse(),'delete',operation)).replayed,true);
 equal('mixed retry does not create duplicate audit groups',(await c.query('select count(*)::int n from security_audit_events where request_id=$1',[operation])).rows[0].n,3);
 // Reads below execute the actual RLS policy as authenticated, with only a JWT
 // subject. They do not filter by workspace, so foreign rows would be detected.
 for(const [actor,visible,label] of [[901,[A],'workspace A manager'],[902,[A],'workspace A administrator'],[903,[B],'workspace B owner'],[904,[],'workspace A staff'],[905,[],'workspace B staff'],[906,[],'nonmember outsider'],[907,[],'disabled manager']]) {
  await c.query('reset role');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[uuid(actor)]);await c.query('set role authenticated');
  const visibleRows=(await c.query('select workspace_id,metadata_json from security_audit_events where request_id=$1',[operation])).rows;
  equal(`${label} audit RLS visibility`,visibleRows.map(row=>row.workspace_id),visible);
  equal(`${label} sees no foreign IDs counts or private null bucket`,visibleRows.map(row=>row.metadata_json),visible.map(workspace=>expected[workspace===A?0:1]));
  await rejects(`${label} cannot read aggregate receipt`,()=>c.query('select * from admin_telemetry.admin_support_operation_receipts where operation_id=$1',[operation]),'42501');
 }
 await c.query('reset role');await c.query('set role service_role');
 const noop=await support(c,mixedIds,'delete',uuid(702));
 equal('mixed no-op reports no changed requests',[noop.changed_count,noop.requested_count],[0,6]);
 equal('mixed no-op creates no invented audit workspace',(await c.query('select count(*)::int n from security_audit_events where request_id=$1',[uuid(702)])).rows[0].n,0);
 equal('mixed no-op has one durable service receipt',(await c.query('select count(*)::int n from admin_telemetry.admin_support_operation_receipts where operation_id=$1',[uuid(702)])).rows[0].n,1);
 equal('missing request alone does not count as changed',(await support(c,[uuid(999)],'delete',uuid(703))).changed_count,0);
 equal('missing request has no null-workspace audit',(await c.query('select count(*)::int n from security_audit_events where request_id=$1',[uuid(703)])).rows[0].n,0);
 const c2=await connect();await c2.query('set role service_role');
 const restoring=[uuid(401),uuid(402),uuid(403),uuid(404)];
 const concurrent=await Promise.all([support(c,restoring,'restore',uuid(704)),support(c2,[...restoring].reverse(),'restore',uuid(704))]);
 equal('concurrent mixed-workspace retry commits once',concurrent.map(row=>row.replayed).sort(),[false,true]);
 equal('concurrent mixed restore preserves original aggregate count',concurrent.map(row=>row.changed_count),[4,4]);
 equal('concurrent mixed restore writes three audit groups once',(await c.query('select count(*)::int n from security_audit_events where request_id=$1',[uuid(704)])).rows[0].n,3);
 // Fail only workspace B's audit after the ordered workspace A audit. The
 // entire operation must roll back, including A's event and all lifecycle rows.
 await c.query('reset role');await c.query(`alter table security_audit_events add constraint synthetic_one_group_reject check(request_id<>'${uuid(705)}' or workspace_id is distinct from '${B}'::uuid)`);await c.query('set role service_role');
 await rejects('one workspace audit failure rolls back whole mixed batch',()=>support(c,[uuid(406),uuid(407),uuid(408)],'delete',uuid(705)),'23514');
 equal('failed audit group restores all workspaces lifecycle',(await c.query('select count(*)::int n from support_requests where id=any($1) and deleted_at is null and status=$2',[[uuid(406),uuid(407),uuid(408)],'open'])).rows[0].n,3);
 equal('failed audit group removes earlier workspace event',(await c.query('select count(*)::int n from security_audit_events where request_id=$1',[uuid(705)])).rows[0].n,0);
 equal('failed audit group creates no durable receipt',(await c.query('select count(*)::int n from admin_telemetry.admin_support_operation_receipts where operation_id=$1',[uuid(705)])).rows[0].n,0);
}

async function fixture(c) {
 await c.query(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;
 create table private.synthetic_private_guard(id integer);
 grant select on private.synthetic_private_guard to service_role;
 create table profiles(id uuid primary key);create table workspaces(id uuid primary key,name text);
 create table ai_usage(id uuid primary key default gen_random_uuid(),workspace_id uuid,user_id uuid,agent_type text,tokens_used integer default 0,input_tokens integer default 0,output_tokens integer default 0,estimated_cost_cents integer default 0,model text,request_id text,latency_ms integer,status text default 'completed',metadata_json jsonb default '{}',created_at timestamptz default now());
 create table vsi_requests(id uuid primary key default gen_random_uuid(),workspace_id uuid,request_id uuid,status text,reservation_usd numeric default 0,cost_usd numeric default 0,created_at timestamptz default now());
 create table vsi_cost_events(id uuid primary key default gen_random_uuid(),workspace_id uuid,request_id uuid,attempt integer default 1,occurred_at timestamptz,cost_usd numeric,usage_json jsonb);
 create table ai_agent_runs(id uuid primary key default gen_random_uuid(),workspace_id uuid,agent_type text,status text,created_at timestamptz);
 create table reports(id uuid primary key default gen_random_uuid(),workspace_id uuid,report_type text,source_data_json jsonb default '{}',created_at timestamptz);
 create table business_notes(id uuid primary key default gen_random_uuid(),workspace_id uuid,status text,evidence_lifecycle_status text,provider_name text,model_used text,fallback_used boolean,provider_attempts_json jsonb,release_channel text,latency_ms integer,extracted_at timestamptz,approved_at timestamptz,archived_at timestamptz,deleted_at timestamptz,created_at timestamptz,extraction_json jsonb,user_corrections_json jsonb);
 create table support_requests(id uuid primary key,workspace_id uuid,name text,email text,message text,priority text default 'Medium',status text default 'open',archived_at timestamptz,deleted_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
 create table security_audit_events(id uuid primary key default gen_random_uuid(),workspace_id uuid,user_id uuid,action_name text,operation_type text,target_table text,initiated_by text,required_confirmation boolean,confirmation_received boolean,allowed boolean,request_id text,metadata_json jsonb,created_at timestamptz default now());
 grant usage on schema public to service_role;grant all on all tables in schema public to service_role;
 insert into profiles values('${U}');insert into workspaces values('${A}','Synthetic A'),('${B}','Synthetic B');
 insert into ai_usage(workspace_id,agent_type,tokens_used,input_tokens,output_tokens,estimated_cost_cents,model,latency_ms,created_at,metadata_json)
 select '${A}','file_analysis',300,100,200,1,'gpt-5.6-luna',100,'2026-10-05T12:00:00Z',jsonb_build_object('cost_estimate',jsonb_build_object('schema_version',1,'version','standard-text-2026-10-05-v1','currency','USD','amount_microcents',1000000),'provider_attempts',jsonb_build_array(jsonb_build_object('provider','openai','model','gpt-5.6-luna','success',true,'raw_payload','PRIVATE_SENTINEL','prompt','PRIVATE_SENTINEL')),'prompt','PRIVATE_SENTINEL') from generate_series(1,6001);
 insert into ai_usage(workspace_id,agent_type,tokens_used,input_tokens,output_tokens,estimated_cost_cents,created_at) values
 ('${B}','intelligence_briefing_v1',30,10,20,200,'2026-10-06Z'),('${A}','file_analysis',30,10,20,100,'2026-09-29Z'),('${A}','file_analysis',10,10,0,999,'2026-10-11Z');
 insert into vsi_requests(id,workspace_id,request_id,status,reservation_usd,cost_usd,created_at) values
 ('${uuid(1)}','${A}','${uuid(101)}','completed',0,99,'2026-10-05Z'),('${uuid(2)}','${A}','${uuid(102)}','failed',0,88,'2026-10-05Z'),('${uuid(3)}','${A}','${uuid(103)}','pending',0.25,0,'2026-09-01Z'),('${uuid(4)}','${B}','${uuid(104)}','pending',0.5,0,'2026-10-05Z');
 insert into vsi_cost_events(workspace_id,request_id,occurred_at,cost_usd,usage_json) values
 ('${A}','${uuid(1)}','2026-10-05Z',0.10,'{"inputTokens":100,"outputTokens":50,"cachedInputTokens":20,"providerCalls":2,"webSearchCalls":3,"webOpenCalls":1,"webFindCalls":1,"latencyMs":1000,"telemetryVersion":1,"providerFailures":1,"researchStatus":"partial","citationStatus":"validated","evidenceLimitations":true,"answer":"PRIVATE_SENTINEL","url":"https://private.invalid/PRIVATE_SENTINEL"}'),
 ('${A}','${uuid(2)}','2026-10-05Z',0.25,'{"status":"expired","costEstimated":true}'),
 ('${A}','${uuid(2)}','2026-10-06Z',0,'{"failed":true}');
 insert into ai_usage(workspace_id,agent_type,request_id,estimated_cost_cents,created_at) values ('${A}','global_search_or_ask','${uuid(101)}',9999,'2026-10-05Z'),('${A}','vsi',null,9999,'2026-10-05Z');
 insert into ai_agent_runs(workspace_id,agent_type,status,created_at) values('${A}','file_analysis','completed','2026-10-05Z'),('${B}','intelligence_briefing_v1','completed','2026-10-05Z'),('${A}','retired_workflow','completed','2026-10-05Z');
 insert into reports(workspace_id,report_type,source_data_json,created_at) select '${A}','Saved Analysis','{"record_kind":"saved_analysis","analysis_type":"finding_explanation","answer":"PRIVATE_SENTINEL"}','2026-10-05Z' from generate_series(1,6002);
 insert into support_requests(id,workspace_id,name,email,message) select ('44444444-4444-4444-8444-'||lpad(n::text,12,'0'))::uuid,'${A}','Synthetic','test@example.invalid','PRIVATE_SENTINEL' from generate_series(201,270) n;`);
 await auditVisibilityFixture(c);
 const beforePrivate=(await c.query("select role,has_schema_privilege(role,'private','USAGE') usage,has_schema_privilege(role,'private','CREATE') create_privilege from unnest(array['anon','authenticated','service_role']) role order by role")).rows;
 equal('all API roles start without private schema usage or create',beforePrivate.every(row=>!row.usage&&!row.create_privilege),true);
 await c.query(migration);
 equal('migration preserves private schema privilege matrix',(await c.query("select role,has_schema_privilege(role,'private','USAGE') usage,has_schema_privilege(role,'private','CREATE') create_privilege from unnest(array['anon','authenticated','service_role']) role order by role")).rows,beforePrivate);
 equal('dedicated schema role matrix is service usage only',(await c.query("select bool_and(has_schema_privilege(role,'admin_telemetry','USAGE')=(role='service_role') and not has_schema_privilege(role,'admin_telemetry','CREATE')) allowed from unnest(array['anon','authenticated','service_role']) role")).rows[0].allowed,true);
 await c.query(`set role service_role`);
 equal('service role retains no access to existing private schema',(await c.query("select has_schema_privilege('service_role','private','USAGE') allowed")).rows[0].allowed,false);
 await rejects('existing private objects remain unreachable by service role',()=>c.query('select * from private.synthetic_private_guard'),'42501');
 equal('service role can use only dedicated admin telemetry schema',(await c.query("select has_schema_privilege('service_role','admin_telemetry','USAGE') allowed")).rows[0].allowed,true);
 equal('service role cannot create objects in telemetry schema',(await c.query("select has_schema_privilege('service_role','admin_telemetry','CREATE') allowed")).rows[0].allowed,false);
 equal('dedicated helper executes with service role',(await c.query("select admin_telemetry.admin_nonnegative_number_v1('12'::jsonb) n")).rows[0].n,'12');
}
async function snapshot(c,workspace=null,page=1,workspacePage=1) { return (await c.query("select admin_usage_snapshot_v1('2026-10-01Z','2026-10-11Z',$1,$2,25,$3) result",[workspace,page,workspacePage])).rows[0].result; }
async function support(c,ids,action,operation,status=null,priority=null) { return (await c.query('select admin_manage_support_requests_v1($1,$2,$3,$4,$5,$6) result',[U,ids,action,operation,status,priority])).rows[0].result; }
async function tests(c) {
 await fixture(c);
 const result=await snapshot(c);
 const dto=decodedExports.decodeAdminUsageSnapshot(result,{start:'2026-10-01T00:00:00Z',end:'2026-10-11T00:00:00Z'},{monthlyTokenBudget:2000000,monthlyVsiBudgetUsd:50});
 equal('actual database JSON passes strict DTO decoder',dto.error,null);
 const corrupt=structuredClone(result);delete corrupt.totals.estimatedSpendUsd;
 equal('missing financial field cannot become zero spend',Boolean(decodedExports.decodeAdminUsageSnapshot(corrupt,{start:'2026-10-01Z',end:'2026-10-11Z'},{monthlyTokenBudget:2000000,monthlyVsiBudgetUsd:50}).error),true);
 const poisoned=structuredClone(result);poisoned.raw_payload='PRIVATE_SENTINEL';poisoned.details[0].prompt='PRIVATE_SENTINEL';
 equal('DTO discards unknown properties rather than forwarding server payload',JSON.stringify(decodedExports.decodeAdminUsageSnapshot(poisoned,{start:'2026-10-01Z',end:'2026-10-11Z'},{monthlyTokenBudget:2000000,monthlyVsiBudgetUsd:50})).includes('PRIVATE_SENTINEL'),false);
 equal('financial totals exceed both old row limits',result.totals.estimatedSpendUsd,60.11);
 equal('legacy and expired estimates are separate',result.totals.uncertainEstimateUsd,2.25);
 equal('unknown zero-cost attempt remains explicitly unknown',result.totals.unknownCostCount,1);
 equal('VSI request cumulative costs and mirrored rows are not added',result.totals.usageRecords,6002);
 equal('same period includes VSI questions across workspaces',result.totals.vsiQuestions,3);
 equal('settled request attempts remain distinct from provider calls',result.totals.vsiSettledAttempts,3);
 equal('unassigned amounts explicit without invented workspace',result.unassignedTotals.estimatedSpendUsd,0);
 equal('request state counts are distinct from attempts', [result.totals.vsiCompleted,result.totals.vsiFailed,result.totals.vsiPending],[1,1,1]);
 equal('all outstanding reservations include pending older than period',result.outstandingReservedUsd,0.75);
 equal('attempt counter covers recorded retries and calls',result.totals.providerAttempts,6004);
 equal('tokens use one authoritative ledger each',result.totals.inputTokens,600210);
 equal('tool estimate is subset of VSI cost, not added again',result.totals.researchToolUsd,0.03);
 equal('response latency denominator excludes missing samples',result.totals.latencySamples,6002);
 equal('missing latency is not zero latency',result.totals.latencyTotalMs,601100);
 equal('request outcome telemetry reports actual covered sample',result.totals.vsiTelemetrySamples,1);
 equal('partial successful research keeps failed provider attempt',result.totals.vsiProviderFailures,1);
 equal('partial and citation checks are measured separately',[result.totals.vsiResearchPartial,result.totals.vsiCitationsValidated],[1,1]);
 equal('retired artifact is excluded from current supported artifact count',result.totals.artifactRuns,2);
 equal('artifacts and saved analyses are separate populations',[result.totals.artifactRuns,result.totals.savedAnalyses],[2,6002]);
 equal('preceding comparison has same duration',new Date(result.previousStart).toISOString(),'2026-09-21T00:00:00.000Z');
 equal('period excludes end timestamp and compares preceding usage',result.previous.uncertainEstimateUsd,1);
 equal('bounded detail page does not truncate totals',result.details.length,25);
 equal('content sentinel absent from complete admin response',JSON.stringify(result).includes('PRIVATE_SENTINEL'),false);
 const scoped=await snapshot(c,A,2);
 equal('workspace isolation scope exact',[scoped.totals.usageRecords,scoped.totals.uncertainEstimateUsd],[6001,0.25]);
 equal('detail pagination keeps workspace summary',scoped.workspaces.length,1);
 equal('all period groups agree',Number(result.features.reduce((sum,row)=>sum+row.estimatedSpendUsd,0).toFixed(8)),result.totals.estimatedSpendUsd);
 equal('workspace totals agree',Number(result.workspaces.reduce((sum,row)=>sum+(row.estimatedSpendUsd||0),0).toFixed(8)),result.totals.estimatedSpendUsd);
 equal('previous period details not fetched',result.details.some(row=>row.createdAt<'2026-10-01'),false);
 const trust=(await c.query("select admin_ai_trust_rows_v1('2026-10-01Z','2026-10-11Z',null,5000) result")).rows[0].result;
 equal('trust returned rows bounded',trust.usage.length,5000);
 equal('trust exact count beyond bound',[trust.counts.usage,trust.counts.saved_analyses],[6002,6002]);
 equal('trust strips arbitrary nested payload fields',JSON.stringify(trust).includes('PRIVATE_SENTINEL'),false);
 const noUsageTrust=(await c.query("select admin_ai_trust_rows_v1('2026-10-01Z','2026-10-11Z',$1,5000) result",[B])).rows[0].result;
 equal('trust scope uses same workspace',[noUsageTrust.counts.usage,noUsageTrust.counts.saved_analyses],[1,0]);
 await rejects('report rejects invalid range',()=>c.query("select admin_usage_snapshot_v1('2026-10-01Z','2026-01-01Z')"),'22023');
 await rejects('report rejects unbounded range',()=>c.query("select admin_usage_snapshot_v1('2020-01-01Z','2026-10-11Z')"),'22023');
 await rejects('trust rejects null limit',()=>c.query("select admin_ai_trust_rows_v1(null,now(),null,null)"),'22023');
 equal('safe projection tolerates poisoned scalar',(await c.query("select admin_telemetry.admin_trust_scalar_v1('\"PRIVATE_SENTINEL\"','number') result")).rows[0].result,null);
 const supportedModels = ['nvidia/llama-3.3-nemotron-super-49b-v1.5','nvidia/nemotron-3-nano-30b-a3b','nvidia/nemotron-3-nano-omni-30b-a3b-reasoning','nvidia/nemotron-3-super-120b-a12b','nvidia/nemotron-3-ultra-550b-a55b','meta/llama-3.3-70b-instruct','deepseek-ai/deepseek-v4-flash','deepseek-ai/deepseek-v4-pro','openai/gpt-oss-20b','z-ai/glm-5.2','gpt-5.4-mini','gpt-5.4-mini-2026-03-17','gpt-6-luna'];
 equal('known provider profiles and priced historical models preserved', (await c.query("select admin_telemetry.admin_trust_scalar_v1(to_jsonb(model),'model') result from unnest($1::text[]) model",[supportedModels])).rows.map(row=>row.result), supportedModels);
 const excludedModels = ['nvidia/PRIVATE_SENTINEL','gpt-5.4-mini-PRIVATE_SENTINEL','https://private.invalid/PRIVATE_SENTINEL','claude-sonnet-'+ '1'.repeat(101)];
 equal('unknown or oversized model text cannot leave projection', (await c.query("select admin_telemetry.admin_trust_scalar_v1(to_jsonb(model),'model') result from unnest($1::text[]) model",[excludedModels])).rows.map(row=>row.result), excludedModels.map(()=>null));
 const modelAttempts = (await c.query("select admin_telemetry.admin_trust_attempts_v1($1::jsonb) result",[JSON.stringify([{provider:'nvidia',runtime_model:supportedModels[0],success:true,prompt:'PRIVATE_SENTINEL',raw_payload:'PRIVATE_SENTINEL'}])])).rows[0].result;
 equal('real NVIDIA model survives nested attempt projection',modelAttempts[0].runtime_model,supportedModels[0]);
 equal('nested model projection still strips customer/provider payload',JSON.stringify(modelAttempts).includes('PRIVATE_SENTINEL'),false);

 for(const role of ['anon','authenticated']) {
  await c.query('reset role');await c.query(`set role ${role}`);
  await rejects(`${role} denied usage aggregate`,()=>snapshot(c),'42501');
  await rejects(`${role} denied trust projection`,()=>c.query('select admin_ai_trust_rows_v1(null,now())'),'42501');
  await rejects(`${role} denied support mutation`,()=>support(c,[uuid(201)],'delete',uuid(301)),'42501');
  equal(`${role} denied admin telemetry schema usage`,(await c.query("select has_schema_privilege(current_user,'admin_telemetry','USAGE') allowed")).rows[0].allowed,false);
  equal(`${role} retains no private schema usage`,(await c.query("select has_schema_privilege(current_user,'private','USAGE') allowed")).rows[0].allowed,false);
  await rejects(`${role} denied direct telemetry helper`,()=>c.query("select admin_telemetry.admin_nonnegative_number_v1('12'::jsonb)"),'42501');
  await rejects(`${role} denied receipts`,()=>c.query('select * from admin_telemetry.admin_support_operation_receipts'),'42501');
 }
 await c.query('reset role');await c.query('set role service_role');
 const deleted=await support(c,[uuid(201),uuid(202)],'delete',uuid(301));
 equal('bulk deletion exact changed ids',deleted.changed_ids,[uuid(201),uuid(202)]);
 equal('bulk deletion retained content',(await c.query('select count(*)::int n from support_requests where id=any($1) and deleted_at is not null and message=$2',[[uuid(201),uuid(202)],'PRIVATE_SENTINEL'])).rows[0].n,2);
 const repeated=await support(c,[uuid(202),uuid(201)],'delete',uuid(301));
 equal('same operation safely replayed',[repeated.changed_count,repeated.replayed],[2,true]);
 equal('only one audit receipt recorded',(await c.query('select count(*)::int n from security_audit_events')).rows[0].n,1);
 equal('new repeated operation changes nothing',(await support(c,[uuid(201),uuid(202)],'delete',uuid(302))).changed_count,0);
 equal('restore respects existing lifecycle',(await support(c,[uuid(201),uuid(202),uuid(203)],'restore',uuid(303))).changed_count,2);
 equal('archive only changes active rows',(await support(c,[uuid(201)],'archive',uuid(304))).changed_count,1);
 equal('archived triage cannot change status before restore',(await support(c,[uuid(201)],'update',uuid(314),'resolved','High')).changed_count,0);
 equal('restore archived record',(await support(c,[uuid(201)],'restore',uuid(305))).changed_count,1);
 equal('update changes only differing values',(await support(c,[uuid(201)],'update',uuid(306),'resolved','High')).changed_count,1);
 equal('repeat update with new key no false success',(await support(c,[uuid(201)],'update',uuid(307),'resolved','High')).changed_count,0);
 await rejects('idempotency key argument reuse rejected',()=>support(c,[uuid(204)],'delete',uuid(301)),'22023');
 await rejects('duplicate IDs rejected',()=>support(c,[uuid(204),uuid(204)],'delete',uuid(308)),'22023');
 await rejects('oversized batches rejected',()=>support(c,Array.from({length:51},(_,n)=>uuid(201+n)),'delete',uuid(309)),'22023');
 await rejects('unknown action rejected',()=>support(c,[uuid(204)],'destroy',uuid(310)),'22023');
 await rejects('unknown status rejected',()=>support(c,[uuid(204)],'update',uuid(311),'bad','High'),'22023');
 const c2=await connect(); await c2.query('set role service_role');
 const concurrent=await Promise.all([support(c,[uuid(205),uuid(206)],'delete',uuid(312)),support(c2,[uuid(206),uuid(205)],'delete',uuid(312))]);
 equal('concurrent duplicate operation has one commit and one receipt replay',concurrent.map(x=>x.replayed).sort(),[false,true]);
 equal('audit is free of customer contents',JSON.stringify((await c.query('select metadata_json from security_audit_events')).rows).includes('PRIVATE_SENTINEL'),false);
 await c.query('reset role');await c.query(`alter table security_audit_events add constraint synthetic_audit_reject check(request_id<>'${uuid(313)}')`);await c.query('set role service_role');
 await rejects('audit failure rolls back lifecycle mutation',()=>support(c,[uuid(207)],'delete',uuid(313)),'23514');
 equal('failed atomic operation retains original lifecycle',(await c.query('select deleted_at from support_requests where id=$1',[uuid(207)])).rows[0].deleted_at,null);
 equal('failed atomic operation has no receipt',(await c.query('select count(*)::int n from admin_telemetry.admin_support_operation_receipts where operation_id=$1',[uuid(313)])).rows[0].n,0);
 await auditTenantTests(c);
 await c.query(`insert into ai_usage(workspace_id,agent_type,created_at,status,input_tokens) values('${A}','file_analysis','2026-10-05Z','completed',0),('${A}','file_analysis','2026-10-05Z','completed',10);insert into vsi_cost_events(workspace_id,request_id,occurred_at,cost_usd,usage_json) values('${A}','${uuid(1)}','2026-10-05Z',0.5,'{}');`);
 const missing=await snapshot(c);
 equal('missing and rounded legacy zero costs are unknown rather than confirmed free',missing.totals.unknownCostCount,3);
 equal('cost without observed usage is an uncertain estimate',missing.totals.uncertainEstimateUsd,2.75);
 await c.query('reset role');
 const security=(await c.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'admin_%' and n.nspname in ('admin_telemetry','public') and (p.prosecdef or not ('search_path=""'=any(p.proconfig)) or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))`)).rows[0].n;
 equal('local security advisor check invoker ACL and empty search path',security,0);
 const functionScope="(n.nspname='admin_telemetry' or (n.nspname='public' and p.proname in ('admin_usage_snapshot_v1','admin_ai_trust_rows_v1','admin_manage_support_requests_v1')))";
 equal('all telemetry functions executable only by service API role',(await c.query(`select bool_and(has_function_privilege('service_role',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')) valid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${functionScope}`)).rows[0].valid,true);
 equal('function ACLs exclude PUBLIC and extra or delegatable grants',(await c.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where ${functionScope} and (acl.grantee=0 or acl.grantee not in (p.proowner,'service_role'::regrole) or (acl.grantee='service_role'::regrole and acl.is_grantable))`)).rows[0].n,0);
 equal('receipt RLS is enabled',(await c.query("select relrowsecurity enabled from pg_class where oid='admin_telemetry.admin_support_operation_receipts'::regclass")).rows[0].enabled,true);
 equal('service receipt privileges are limited to read and append',(await c.query("select bool_and(has_table_privilege('service_role','admin_telemetry.admin_support_operation_receipts',privilege)=(privilege in ('SELECT','INSERT'))) valid from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege")).rows[0].valid,true);
 equal('customer roles have no receipt table privileges',(await c.query("select bool_and(not has_table_privilege(role,'admin_telemetry.admin_support_operation_receipts',privilege)) valid from unnest(array['anon','authenticated']) role cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege")).rows[0].valid,true);
 return checks;
}
(async()=>{
 for(const key of ['DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','SUPABASE_TEST_DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN']) assert(!Object.hasOwn(process.env,key),'Inherited remote DB configuration forbidden');
 assert(bin&&path.isAbsolute(bin)&&fs.existsSync(path.join(bin,'initdb')),'Explicit local PostgreSQL bin required');
 owned=fs.mkdtempSync('/tmp/vaeroex-admin-metrics-');fs.chmodSync(owned,0o700);const socket=path.join(owned,'socket');fs.mkdirSync(socket,{mode:0o700});
 cmd('initdb',['-D',path.join(owned,'data'),'--username=postgres','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
 cmd('pg_ctl',['-D',path.join(owned,'data'),'-l',path.join(owned,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c max_connections=12 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
 config={host:socket,port:5432,user:'postgres',database:'postgres'};const c=await connect();
 const observed=(await c.query("select current_setting('data_directory') d,current_setting('listen_addresses') a,inet_server_addr() ip")).rows[0];assert.equal(fs.realpathSync(observed.d),fs.realpathSync(path.join(owned,'data')));assert.equal(observed.a,'');assert.equal(observed.ip,null);
 console.log(JSON.stringify({scope:'Synthetic native PostgreSQL only; no customer records or provider calls',checks:await tests(c)},null,2));
})().catch(error=>{console.error(JSON.stringify({status:'failed',message:error.message,code:error.code,position:error.position,where:error.where,passed:checks.length}));process.exitCode=1;}).finally(async()=>{for(const c of clients)await c.end().catch(()=>{});if(started)cmd('pg_ctl',['-D',path.join(owned,'data'),'-m','fast','-w','stop']);});
