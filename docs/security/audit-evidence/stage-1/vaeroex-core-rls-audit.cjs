// Synthetic PostgreSQL/WASM audit. Selects actual DDL/functions/policies from
// deployed source; emulates auth.uid() and explicit PostgREST database roles.
// This is not a Supabase HTTP/session/storage-service integration test.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const root=process.env.VAEROEX_AUDIT_SOURCE_ROOT||process.cwd();
const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
const base=read('202606170001_phase_1_schema_rls.sql');
const high=read('20260819174100_security_high_findings_remediation.sql');
const kpi=read('202606180002_kpi_dashboard.sql');
const files=read('202606180004_files_imports.sql');
function must(re,s){const match=s.match(re); assert(match,'source extraction '+re);return match[0];}
const table=(name,s=base)=>must(new RegExp('create table (?:if not exists )?public\\.'+name+' \\([\\s\\S]*?\\n\\);'),s);
const fn=(name,s=base)=>must(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\n\\$\\$;'),s);
const policy=(name,s=base)=>must(new RegExp('create policy "'+name+'"[\\s\\S]*?;'),s);
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const ids=[1,2,3,4,5].map(n=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`);
const db=new PGlite();const results=[];
const record=(test,actual,expected)=>{assert.deepEqual(actual,expected,test);results.push({test,actual,expected,status:'pass'});};
async function actor(i){await db.exec(`reset role; select set_config('request.jwt.claim.sub','${ids[i]}',false); set role authenticated;`);}
async function denied(test,sql){try{await db.query(sql);throw new Error('UNEXPECTEDLY_ALLOWED:'+test);}catch(e){if(e.message.startsWith('UNEXPECTEDLY_ALLOWED'))throw e;record(test,e.code,'42501');}}
(async()=>{
 await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
 for(const name of ['profiles','workspaces','workspace_members','tasks','assets','asset_checks'])await db.exec(table(name));
 await db.exec(table('kpis',kpi));
 await db.exec(table('security_audit_events',read('202607080002_ai_tool_execution_security.sql')));
 await db.exec('alter table security_audit_events enable row level security;grant select,insert on security_audit_events to authenticated;');
 await db.exec(`alter table workspaces add column subscription_status text default 'canceled', add column subscription_required boolean default true, add column manually_unlocked boolean default false;
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);
 alter table storage.objects enable row level security;`);
 for(const name of ['is_workspace_member','workspace_member_role','has_workspace_role','can_manage_workspace','can_edit_operations'])await db.exec(fn(name));
 await db.exec(fn('can_contribute_workspace',high));
 await db.exec(policy('security audit events managers read',read('202607080003_security_audit_service_events.sql')));
 await db.exec(policy('security audit events contributors create',high));

 for(const name of ['workspaces','workspace_members','tasks','assets','asset_checks','kpis'])await db.exec(`alter table ${name} enable row level security;grant select,insert,update,delete on ${name} to authenticated;`);
 await db.exec('grant select,insert,update,delete on storage.objects to authenticated;');
 for(const name of ['members can read workspaces','members can read workspace members','members can read tasks','managers can create tasks','managers can update tasks','managers can delete tasks','members can read asset checks'])await db.exec(policy(name));
 for(const name of ['owners can invite members','admins can invite non-owner members','owners can update members','admins can update non-owner members','owners can delete members','admins can delete non-owner members','assigned contributors can update assigned tasks'])await db.exec(policy(name,high));
 for(const name of ['kpis members read','kpis managers update','kpis managers delete'])await db.exec(policy(name,kpi));
 await db.exec(policy('kpis contributors create',high));
 for(const name of ['workspace files members read'])await db.exec(policy(name,files));
 for(const name of ['workspace files contributors insert','workspace files contributors update'])await db.exec(policy(name,high));
 // These two instantiated templates are taken from the dynamic policy loops.
 assert(high.includes("'asset_checks'"));assert(base.includes("public.is_workspace_member(workspace_id)"));
 await db.exec(`create policy "asset_checks contributors create" on asset_checks for insert to authenticated with check(public.can_contribute_workspace(workspace_id));
 create policy "assets members read" on assets for select to authenticated using(public.is_workspace_member(workspace_id));`);
 await db.exec(`insert into profiles(id,email)values ${ids.map((id,i)=>`('${id}','synthetic${i}@example.invalid')`).join(',')};
 insert into workspaces(id,name)values('${A}','Synthetic canceled A'),('${B}','Synthetic B');
 insert into workspace_members(workspace_id,user_id,role,status)values('${A}','${ids[0]}','owner','active'),('${A}','${ids[1]}','admin','active'),('${A}','${ids[2]}','staff','active'),('${A}','${ids[3]}','viewer','active'),('${B}','${ids[4]}','owner','active');
 insert into tasks(workspace_id,title,assigned_to)values('${A}','Synthetic Task A','${ids[2]}'),('${B}','Synthetic Task B','${ids[4]}');
 insert into assets(id,workspace_id,asset_name)values('44444444-4444-4444-8444-444444444444','${B}','Synthetic Asset B');
 insert into storage.objects(bucket_id,name)values('workspace-files','${A}/a.csv'),('workspace-files','${B}/b.csv');`);
 await actor(0);
 record('owner sees only own tenant tasks',(await db.query('select title from tasks')).rows.map(r=>r.title),['Synthetic Task A']);
 await denied('owner cannot insert task into tenant B',`insert into tasks(workspace_id,title)values('${B}','forged')`);
 record('owner cannot update tenant B task',(await db.query(`update tasks set title='forged' where workspace_id='${B}' returning id`)).rows.length,0);
 record('owner cannot delete tenant B task',(await db.query(`delete from tasks where workspace_id='${B}' returning id`)).rows.length,0);
 record('owner reads only own storage objects',(await db.query('select name from storage.objects')).rows.map(r=>r.name),[A+'/a.csv']);
 await denied('owner cannot upload into tenant B prefix',`insert into storage.objects(bucket_id,name)values('workspace-files','${B}/forged.csv')`);
 await denied('owner cannot move object to tenant B prefix',`update storage.objects set name='${B}/moved.csv' where name='${A}/a.csv'`);
 // A is deliberately canceled; app requireActiveSubscription would reject it.
 record('DEFECT canceled workspace owner can create KPI via DB',(await db.query(`insert into kpis(workspace_id,name,actual_value)values('${A}','Canceled plan mutation',1) returning id`)).rows.length,1);
 await actor(1);
 await denied('admin cannot promote own membership to owner',`update workspace_members set role='owner' where user_id='${ids[1]}' returning id`);
 await actor(3);
 await denied('viewer cannot create KPI',`insert into kpis(workspace_id,name)values('${A}','forged')`);
 await denied('viewer cannot create storage object',`insert into storage.objects(bucket_id,name)values('workspace-files','${A}/viewer.csv')`);
 await actor(2);
 record('staff can update own assigned task',(await db.query(`update tasks set title='Staff completed' where workspace_id='${A}' returning id`)).rows.length,1);
 record('staff cannot read tenant B asset',(await db.query('select * from assets')).rows.length,0);
 record('DEFECT staff can create tenant A child referencing hidden tenant B asset',(await db.query(`insert into asset_checks(workspace_id,asset_id,status)values('${A}','44444444-4444-4444-8444-444444444444','Good') returning id`)).rows.length,1);
 record('DEFECT staff forges 12 blocked events attributed to owner',(await db.query(`insert into security_audit_events(workspace_id,user_id,action_name,operation_type,initiated_by,allowed) select '${A}','${ids[0]}','synthetic-forged','UPDATE_RECORD','user',false from generate_series(1,12)`)).affectedRows,12);
 await actor(0);record('DEFECT owner sees 12 forged events used by tool lockout',(await db.query(`select count(*)::int as count from security_audit_events where workspace_id='${A}' and user_id='${ids[0]}' and allowed=false and created_at>now()-interval '10 minutes'`)).rows[0].count,12);
 await db.exec(`reset role;update workspace_members set status='disabled' where user_id='${ids[2]}';`);await actor(2);
 record('disabled member no longer reads own tenant task',(await db.query('select * from tasks')).rows.length,0);
 await db.exec('reset role;set role anon;');await denied('anonymous cannot query tasks','select * from tasks');
 console.log(JSON.stringify({engine:'PGlite PostgreSQL',source:root,sourceScope:'Selected actual core table DDL, helper functions and policies + explicit grants matching inspected production; emulated auth.uid; synthetic roles/rows only',results},null,2));
 await db.close();
})().catch(async e=>{console.error(e.message,e.code??'');try{await db.close();}catch{}process.exitCode=1;});
