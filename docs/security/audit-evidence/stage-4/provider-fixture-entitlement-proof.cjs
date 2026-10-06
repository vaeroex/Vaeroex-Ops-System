const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {Client}=require('/tmp/vaeroex-audit-production/node_modules/pg');
const root='/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex';
const bin='/tmp/vaeroex-stage4-pg/bin';
const fixtureNames=['external_integrations_phase_1_canonical_foundation.test.sql','external_integrations_phase_4_control_plane.test.sql','external_integrations_phase_8a0_contract_convergence.test.sql','external_integrations_qbo_production_convergence.test.sql'];
const baseline='d91be079c7beb0b6f21a4c5e6b451f90ca06e035',results=[];
const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
const base=read('202606170001_phase_1_schema_rls.sql'),billing=read('202606170003_phase_6_squarespace_subscriptions.sql'),boundary=read('20261005022017_workspace_security_boundaries.sql');
const match=(s,re)=>{const m=s.match(re);assert(m,`${re}`);return m[0]};
const table=n=>match(base,new RegExp('create table public\\.'+n+' \\([\\s\\S]*?\\n\\);'));
const fn=n=>match(boundary,new RegExp('create function private\\.'+n+'\\([\\s\\S]*?\\n\\$\\$;'));
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const owned=fs.mkdtempSync('/tmp/vaeroex-fixture-entitlement-');fs.chmodSync(owned,0o700);
const data=path.join(owned,'data'),socket=path.join(owned,'socket');fs.mkdirSync(socket,{mode:0o700});
function command(name,args){const p=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});if(p.status!==0)throw Error(`local_${name}_failed`);return p.stdout;}
let started=false,c;
(async()=>{try{
 for(const key of ['DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','SUPABASE_SERVICE_ROLE_KEY'])assert(!Object.hasOwn(process.env,key),'inherited_connection_configuration_forbidden');
 command('initdb',['-D',data,'-A','trust','--no-locale','-U','postgres']);
 command('pg_ctl',['-D',data,'-l',path.join(owned,'postgres.log'),'-o',`-k ${socket} -c listen_addresses='' -p 55461`,'-w','start']);started=true;
 c=new Client({host:socket,port:55461,database:'postgres',user:'postgres',ssl:false,statement_timeout:10000});await c.connect();
 await c.query(`create role authenticated;create schema auth;create schema private;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;grant usage on schema public,auth to authenticated;`);
 for(const name of ['profiles','workspaces','workspace_members'])await c.query(table(name));
  await c.query(billing.slice(0,billing.indexOf('do $$')));
 for(const name of ['subscription_plans','customer_subscriptions'])await c.query(match(billing,new RegExp('create table if not exists public\\.'+name+' \\([\\s\\S]*?\\n\\);')));
 await c.query(match(read('202606220001_stripe_billing_migration.sql'),/alter table public\.customer_subscriptions\n  add column if not exists billing_provider[\s\S]*?;/));
 await c.query(match(boundary,/create table private\.platform_admin_subscription_exemptions \([\s\S]*?\n\);/));
 for(const name of ['platform_admin_subscription_exempt_v1','workspace_billing_entitled_v1','workspace_entitlement_active_v1','guard_workspace_mutation_entitlement_v1'])await c.query(fn(name));
 await c.query(`create table public.synthetic_fixture_writes(workspace_id uuid not null references public.workspaces(id));create trigger entitlement before insert on public.synthetic_fixture_writes for each row execute function private.guard_workspace_mutation_entitlement_v1('workspace_id');create function public.synthetic_fixture_write(p_workspace_id uuid) returns void language sql security definer set search_path='' as $$insert into public.synthetic_fixture_writes(workspace_id) values(p_workspace_id)$$;grant execute on function public.synthetic_fixture_write(uuid) to authenticated;`);
 for(const fixture of fixtureNames){
  const full='supabase/tests/'+fixture;
  const original=spawnSync('git',['show',baseline+':'+full],{cwd:root,encoding:'utf8',maxBuffer:2**20});assert.equal(original.status,0);
  const changed=fs.readFileSync(path.join(root,full),'utf8');
  const profiles=match(changed,/insert into public\.profiles \([\s\S]*?;/);
  const memberships=match(changed,/insert into public\.workspace_members \([\s\S]*?;/);
  const beforeSeed=match(original.stdout,/insert into public\.workspaces \([\s\S]*?;/);
  const afterSeed=match(changed,/insert into public\.workspaces \([\s\S]*?;/);
  const workspaceIds=[...beforeSeed.matchAll(/'([b][0-9a-f-]{35})'/g)].map(m=>m[1]);assert.equal(workspaceIds.length,2);
  await c.query('begin');await c.query(profiles);await c.query(beforeSeed);await c.query(memberships);
  for(const workspaceId of workspaceIds){
   const actor=(await c.query('select user_id from workspace_members where workspace_id=$1 and role=\'owner\'',[workspaceId])).rows[0].user_id;
   await c.query(`select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)`,[actor]);await c.query('set local role authenticated');
   await c.query('savepoint before_probe');let code=null;try{await c.query('select synthetic_fixture_write($1)',[workspaceId]);}catch(e){code=e.code;}
   await c.query('rollback to savepoint before_probe');assert.equal(code,'42501');results.push({fixture,case:'baseline manual_review blocks authenticated positive write',status:'pass',code});await c.query('reset role');
  }
  await c.query('rollback');
  await c.query('begin');await c.query(profiles);await c.query(afterSeed);await c.query(memberships);
  for(const workspaceId of workspaceIds){
   const actor=(await c.query('select user_id from workspace_members where workspace_id=$1 and role=\'owner\'',[workspaceId])).rows[0].user_id;
   await c.query(`select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)`,[actor]);await c.query('set local role authenticated');await c.query('select synthetic_fixture_write($1)',[workspaceId]);await c.query('reset role');
   assert.equal((await c.query('select count(*)::int n from synthetic_fixture_writes where workspace_id=$1',[workspaceId])).rows[0].n,1);results.push({fixture,case:'bounded trial permits authenticated positive write',status:'pass'});
  }
  await c.query('rollback');
 }
 const output={baseline,scope:'Actual fixture profile/workspace/membership INSERT statements before/after; actual new entitlement functions/trigger, synthetic definer write target. Native local PostgreSQL; no provider RPC/full-suite replay.',version:(await c.query('show server_version')).rows[0].server_version,boundarySha256:digest(boundary),fixtureSha256:Object.fromEntries(fixtureNames.map(n=>[n,digest(fs.readFileSync(path.join(root,'supabase/tests',n),'utf8'))])),results};
 fs.writeFileSync('/tmp/vaeroex-fixture-entitlement-proof.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
}finally{if(c)await c.end();if(started)command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
