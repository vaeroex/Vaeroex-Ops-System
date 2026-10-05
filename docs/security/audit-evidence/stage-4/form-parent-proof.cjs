/* Synthetic in-memory PostgreSQL proof; no target URL, network, or real data.
 * Actual repository DDL/functions/policy templates are extracted below.
 * Not a hosted PostgREST/Auth ACL test or complete migration replay. */
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto'), assert=require('node:assert/strict');
const {PGlite}=require('/tmp/vaeroex-audit-production/node_modules/@electric-sql/pglite');
const root='/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex';
const names=['202606170001_phase_1_schema_rls.sql','20260819174100_security_high_findings_remediation.sql'];
const sources=names.map(n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8'));
const [base,high]=sources;
const match=(source,re)=>{const m=source.match(re);assert(m,`missing source ${re}`);return m[0];};
const table=n=>match(base,new RegExp(`create table public\\.${n} \\([\\s\\S]*?\\n\\);`));
const fn=(n,s=base)=>match(s,new RegExp(`create or replace function public\\.${n}\\([\\s\\S]*?\\n\\$\\$;`));
const policy=n=>match(base,new RegExp(`create policy "${n}"[\\s\\S]*?;`));
const template=(source,name,tableName)=>{
  const re=new RegExp(`'create policy "%s ${name}"[^']+'`),sql=match(source,re).slice(1,-1);
  return sql.replace('%s',tableName).replace('%I',tableName);
};
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const user=n=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`;
const form=n=>`44444444-4444-4444-8444-${String(n).padStart(12,'0')}`;
const sub=n=>`55555555-5555-4555-8555-${String(n).padStart(12,'0')}`;
const result={recordedAt:new Date().toISOString(),baseline:'d91be079c7beb0b6f21a4c5e6b451f90ca06e035',engine:'isolated in-memory PGlite',sourceRoot:root,sourceHashes:Object.fromEntries(names.map((n,i)=>[n,crypto.createHash('sha256').update(sources[i]).digest('hex')])),tests:[]};
const db=new PGlite();
async function ok(name,actual,expected){assert.deepEqual(actual,expected,name);result.tests.push({name,actual,expected,status:'pass'});}
async function actor(n){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${user(n)}',false);set role authenticated;`);}
async function denied(name,sql){try{await db.exec(sql);assert.fail(name);}catch(e){await ok(name,e.code,'42501');}}
(async()=>{try{
  await db.exec(`create role authenticated;create role anon;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated;grant execute on all functions in schema auth to authenticated;`);
  for(const n of ['profiles','workspaces','workspace_members','forms','form_submissions'])await db.exec(table(n));
  for(const n of ['is_workspace_member','workspace_member_role','has_workspace_role','can_edit_operations'])await db.exec(fn(n));
  await db.exec(fn('can_contribute_workspace',high));
  for(const n of ['forms','form_submissions'])await db.exec(`alter table ${n} enable row level security;grant select,insert,update,delete on ${n} to authenticated;`);
  for(const n of ['members read','managers write','managers update','managers delete'])await db.exec(template(base,n,'forms'));
  await db.exec(policy('members can read form submissions'));
  await db.exec(policy('managers can update form submissions'));
  for(const n of ['contributors create','contributors update'])await db.exec(template(high,n,'form_submissions'));
  // Public/member insert policies are absent after the actual high remediation.
  assert(high.includes('drop policy if exists "members can create form submissions"'));
  assert(high.includes('drop policy if exists "public can submit public forms"'));
  await db.exec(`insert into profiles(id,email) values('${user(1)}','staff@example.invalid'),('${user(2)}','viewer@example.invalid');insert into workspaces(id,name) values('${A}','Synthetic A'),('${B}','Synthetic B');insert into workspace_members(workspace_id,user_id,role) values('${A}','${user(1)}','staff'),('${A}','${user(2)}','viewer');insert into forms(id,workspace_id,name) values('${form(1)}','${A}','Local private form'),('${form(2)}','${B}','Foreign private form');`);
  await actor(1);
  await ok('staff cannot read foreign private parent',(await db.query(`select count(*)::int n from forms where id='${form(2)}'`)).rows[0].n,0);
  await db.exec(`insert into form_submissions(id,workspace_id,form_id,data_json) values('${sub(1)}','${A}','${form(1)}','{"synthetic":true}')`);
  await ok('same-workspace staff submission persists',(await db.query(`select count(*)::int n from form_submissions where id='${sub(1)}'`)).rows[0].n,1);
  await db.exec(`insert into form_submissions(id,workspace_id,form_id,data_json) values('${sub(2)}','${A}','${form(2)}','{"synthetic":true}')`);
  await ok('VXA005 foreign private form accepted in owned workspace',(await db.query(`select workspace_id,form_id from form_submissions where id='${sub(2)}'`)).rows[0],{workspace_id:A,form_id:form(2)});
  await denied('inserting directly into foreign workspace remains denied',`insert into form_submissions(workspace_id,form_id) values('${B}','${form(2)}')`);
  await actor(2);
  await denied('viewer cannot insert same-workspace submission',`insert into form_submissions(workspace_id,form_id) values('${A}','${form(1)}')`);
  await db.exec('reset role');
  await ok('baseline FK contains form_id alone',(await db.query(`select pg_get_constraintdef(oid) definition from pg_constraint where conname='form_submissions_form_id_fkey'`)).rows[0].definition,'FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE');
  await db.exec(`delete from forms where id='${form(2)}'`);
  await actor(1);
  await ok('foreign parent deletion cascades into owned workspace submission',(await db.query(`select count(*)::int n from form_submissions where id='${sub(2)}'`)).rows[0].n,0);
  await ok('same-workspace control is retained',(await db.query(`select count(*)::int n from form_submissions where id='${sub(1)}'`)).rows[0].n,1);
  result.status='pass';
  result.limitations=['Actual selected DDL and policy templates; fixture emulates Supabase JWT GUC, grants authenticated table privileges, and omits hosted API/Auth behavior.','Existing new entitlement migration not applied in this baseline-only proof; entitlement adds workspace predicate but does not bind form parent.','Foreign parent UUID is assumed known; no disclosure of form contents proved.'];
  fs.writeFileSync('/tmp/vaeroex-form-parent-proof.json',JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{await db.close();}})().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
