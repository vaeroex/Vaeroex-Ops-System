// LOCAL ONLY: empty disposable PostgreSQL/WASM, explicit screened metadata input.
// No network, credentials, customer rows or captured bodies written to Git/logs.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite/vector';
const require=createRequire(import.meta.url),{assemble}=require('./shared-evidence-release-package.cjs');
const root=resolve(new URL('..',import.meta.url).pathname),directory=process.argv[2];
assert(directory,'Explicit local screened capture directory required; no fetch fallback.');
const read=p=>readFileSync(join(root,p),'utf8');
const captured=p=>JSON.parse(readFileSync(join(directory,p),'utf8'));
const q=s=>'"'+s.replaceAll('"','""')+'"';
const qualified=s=>s.split('.').map(q).join('.');
const nameOf=r=>r.name?.includes('.')?r.name:`${r.schema??r.nspname??'public'}.${r.name??r.proname}`;
const hash=s=>createHash('md5').update(s.replace(/\s/g,'')).digest('hex');
const functions=[];
function scan(text,path){
 const pattern=/create\s+(?:or\s+replace\s+)?function\s+((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)\s*\(/gi;let match;
 while((match=pattern.exec(text))){
  const tail=text.slice(match.index),body=/\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);if(!body)continue;
  const start=body.index+body[0].length,end=tail.indexOf(body[1],start);if(end<0)continue;
  const stop=tail.indexOf(';',end+body[1].length);
  functions.push({name:match[1].includes('.')?match[1]:'public.'+match[1],sql:stop<0?tail.trim()+';':tail.slice(0,stop+1),hash:hash(tail.slice(start,end)),path});
 }
}
for(const folder of ['supabase/migrations','supabase/production-migrations'])for(const file of readdirSync(join(root,folder)).filter(f=>f.endsWith('.sql')).sort())scan(read(folder+'/'+file),folder+'/'+file);
for(const file of ['docs/security-drafts/audit/deployed-contracts.json','docs/security-drafts/audit/typed-source-contracts.json'])for(const f of JSON.parse(read(file)).functions)scan(f.definition,file);
const metadata=['functions.json','direct-bound-guards.json','sheets-guards.json','bounded-helper-bodies.json','bounded-helper-metadata.json'].flatMap(captured);
for(const r of metadata)if(typeof r.definition==='string'&&!r.definition_withheld)scan(r.definition,'screened_local_capture');
const expected=new Map();for(const r of metadata){const name=nameOf(r);const prior=expected.get(name);if(!prior||r.definition)expected.set(name,r);}
const rows=captured('relations.json').filter(r=>r.exists);
for(const r of rows){
 assert.equal(r.relkind,'r','Captured target must be an ordinary table');
 assert.equal(r.owner,'postgres','Captured target owner must be restored explicitly if different');
 assert((r.indexes??[]).every(i=>i.valid),'Invalid index reconstruction required');
}
const bound=captured('bounded-relations.json');
const tables=new Map(rows.map(r=>[r.name,r]));
// Only supporting relations already captured separately, never extra discovery.
const unexecutedSupportingTriggers=[],unexecutedSupportingPolicies=[];
for(const r of bound)if(!tables.has(r.name)){
 // This intake writer is outside all twelve forward drafts and the 64-table
 // target. Its INSERT trigger cannot fire during this migration. The captured
 // fields/constraints still support the existing file foreign key. Do not
 // fabricate its uncaptured body or claim qualification of intake writes.
 const triggers=(r.triggers??[]).filter(t=>{if(r.name==='public.document_extraction_intake_requests'&&t.function==='private.guard_document_extraction_screen_v1()'){unexecutedSupportingTriggers.push({relation:r.name,function:t.function});return false;}return true;});
 // A bounded supporting capture serializes some role OIDs, not role names.
 // None of the forward drafts alters those supporting tables/policies and its
 // privileged billing routines bypass their RLS. Do not guess an OID identity.
 const policies=(r.policies??[]).filter(p=>{if(p.roles.some(role=>/^\d+$/.test(role))){unexecutedSupportingPolicies.push({relation:r.name,policy:p.name,reason:'supporting_role_oid_not_named'});return false;}return true;});
 tables.set(r.name,{...r,exists:true,columns:r.columns.map(c=>({name:c.attname,type:c.type,not_null:c.attnotnull,default:null})),constraints:r.constraints,policies,triggers});
}
const allColumns=new Map([...tables].map(([n,r])=>[n,new Map(r.columns.map(c=>[c.name,c]))]));
const fkBoundary=new Map();
for(const [name,r]of tables)for(const c of r.constraints??[]){
 if(c.type!=='f')continue;
 const m=/FOREIGN KEY \(([^)]+)\) REFERENCES ([a-z_.]+)\(([^)]+)\)/i.exec(c.definition);assert(m,'Captured FK shape required');
 const target=m[2].includes('.')?m[2]:'public.'+m[2];if(tables.has(target))continue;
 const local=m[1].split(',').map(s=>s.trim().replaceAll('"','')),foreign=m[3].split(',').map(s=>s.trim().replaceAll('"',''));
 const boundary=fkBoundary.get(target)??{columns:new Map(),keys:[]};
 foreign.forEach((column,i)=>{const type=allColumns.get(name).get(local[i])?.type;assert(type,'Captured FK input type required');if(boundary.columns.has(column))assert.equal(boundary.columns.get(column),type);boundary.columns.set(column,type);});
 boundary.keys.push(foreign);fkBoundary.set(target,boundary);
}
const schemas=new Set(['public','private','auth','extensions','square_customer_private',...[...tables.keys(),...fkBoundary.keys()].map(n=>n.split('.')[0])]);
const roles=new Set(['anon','authenticated','service_role']);
for(const r of rows){for(const policy of r.policies??[])for(const role of policy.roles)if(role.toLowerCase()!=='public')roles.add(role);for(const acl of (r.acl??'').matchAll(/(?:^|[,\{])([^=,{]+)=/g))if(acl[1]!=='postgres')roles.add(acl[1].replaceAll('"',''));}
for(const r of expected.values())for(const acl of (r.acl??'').matchAll(/(?:^|[,\{])([^=,{]+)=/g))if(acl[1]!=='postgres')roles.add(acl[1].replaceAll('"',''));
const required=new Set(expected.keys());
for(const r of tables.values())for(const text of [...r.columns.map(c=>c.default??''),...(r.constraints??[]).map(c=>c.definition??''),...(r.indexes??[]).map(i=>i.definition??''),...(r.policies??[]).flatMap(p=>[p.using??'',p.check??'']),...(r.triggers??[]).filter(t=>!t.internal).map(t=>t.definition??'')])for(const name of [...text.matchAll(/\b((?:private|public)\.[a-z_][a-z0-9_]*)\s*\(/gi)].map(m=>m[1]))if(!tables.has(name)&&!fkBoundary.has(name))required.add(name);
for(const r of tables.values())for(const t of r.triggers??[])if(!t.internal){const name=t.function.replace(/\(.*$/,'');required.add(name.includes('.')?name:'public.'+name);}
function candidatesFor(name){const r=expected.get(name),fingerprint=r?.normalized_body_md5??r?.body_md5;let found=functions.filter(f=>f.name===name&&(!fingerprint||f.hash===fingerprint));if(!found.length&&fingerprint)found=functions.filter(f=>f.hash===fingerprint);return found;}
const missingFunctions=[...required].filter(name=>!name.startsWith('auth.')&&!name.startsWith('extensions.')&&!candidatesFor(name).length).sort();
if(process.argv[3]==='--inventory'){
 console.log(JSON.stringify({status:missingFunctions.length?'captured_layout_definition_gap':'captured_layout_definitions_available',missingFunctions,sourceRowsRead:false,productionAccess:false,execution:'not_run'},null,2));process.exit(missingFunctions.length?1:0);
}
let stage='initialize',subject='',installedFunctions=0,repositoryOnlyFunctions=[];
const db=new PGlite({extensions:{vector}});
async function execute(sql,label){subject=label;await db.exec(sql);}
const available=new Set();
async function installFunction(name){
 if(available.has(name)||name.startsWith('auth.')||name.startsWith('extensions.'))return;
 const r=expected.get(name),fingerprint=r?.normalized_body_md5??r?.body_md5;
 const candidates=candidatesFor(name);
 assert(candidates.length,'Definition unavailable for '+name);
 const f=candidates.at(-1);
 let sql=f.sql.replace(/create\s+(?:or\s+replace\s+)?function\s+((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)/i,'create or replace function '+name);
 await execute(sql,'function:'+name);available.add(name);installedFunctions++;
 if(!fingerprint&&f.path!=='screened_local_capture')repositoryOnlyFunctions.push(name);
}
function calls(sql){
 const qualifiedCalls=[...sql.matchAll(/\b((?:private|public)\.[a-z_][a-z0-9_]*)\s*\(/gi)].map(m=>m[1]);
 const publicCalls=[...sql.matchAll(/(?<![a-z_0-9.])([a-z_][a-z0-9_]*)\s*\(/gi)].map(m=>'public.'+m[1]).filter(n=>functions.some(f=>f.name===n));
 return [...new Set([...qualifiedCalls,...publicCalls])].filter(n=>!tables.has(n)&&!fkBoundary.has(n));
}
function grantAcl(target,acl,kind='table'){
 const privileges={a:'insert',r:'select',w:'update',d:'delete',D:'truncate',x:'references',t:'trigger',X:'execute',m:'maintain'};
 const commands=[`revoke all on ${kind} ${target} from public,anon,authenticated,service_role`];
 for(const m of (acl??'').matchAll(/(?:^|[,\{])([^=,{]*)=([^/,}]+)\//g)){
  const role=m[1]?q(m[1].replaceAll('"','')):'public',permissions=[...m[2].replaceAll('*','')].map(c=>privileges[c]).filter(Boolean);
  if(permissions.length)commands.push(`grant ${permissions.join(',')} on ${kind} ${target} to ${role}`);
 }return commands.join(';')+';';
}
try{
 for(const role of roles)await execute(`create role ${q(role)}`,'role');
 for(const schema of schemas)if(schema!=='public')await execute(`create schema ${q(schema)}`,'schema');
 await execute(`create extension vector;set check_function_bodies=off;
 create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;`,'platform_auth_fixture');
 stage='captured_columns';
 for(const [name,r]of tables){for(const c of r.columns)assert(!c.default_withheld&&!c.generated&&!c.identity,'Unsupported captured generated/identity column');await execute(`create table ${qualified(name)} (${r.columns.map(c=>q(c.name)+' '+c.type).join(',')})`,name);}
 for(const [name,r]of fkBoundary)await execute(`create table ${qualified(name)} (${[...r.columns].map(([n,t])=>q(n)+' '+t).join(',')},${[...new Set(r.keys.map(k=>k.map(q).join(',')))].map(k=>'unique('+k+')').join(',')})`,'FK_boundary:'+name);
 stage='captured_functions';for(const name of expected.keys())await installFunction(name);
 // Existing expression/trigger functions: retain real definitions, never no-op stubs.
 for(const r of tables.values())for(const text of [...r.columns.map(c=>c.default??''),...(r.constraints??[]).map(c=>c.definition??''),...(r.indexes??[]).map(i=>i.definition??''),...(r.policies??[]).flatMap(p=>[p.using??'',p.check??'']),...(r.triggers??[]).filter(t=>!t.internal).map(t=>t.definition??'')])for(const name of calls(text))await installFunction(name);
 // Trigger regprocedure names may be unqualified in metadata.
 for(const r of tables.values())for(const t of r.triggers??[])if(!t.internal){const n=t.function.replace(/\(.*$/,'');await installFunction(n.includes('.')?n:'public.'+n);}
 stage='captured_defaults';for(const [name,r]of tables)for(const c of r.columns){if(c.default)await execute(`alter table ${qualified(name)} alter column ${q(c.name)} set default ${c.default}`,name+'.'+c.name);if(c.not_null)await execute(`alter table ${qualified(name)} alter column ${q(c.name)} set not null`,name+'.'+c.name);}
 stage='captured_constraints';for(const kind of ['p','u','c','f'])for(const [name,r]of tables)for(const c of r.constraints??[])if(c.type===kind)await execute(`alter table ${qualified(name)} add constraint ${q(c.name)} ${c.definition}`,name+':'+c.name);
 // Draft09 touches this existing store. Reuse the exact public repository DDL
 // already used by the completed legacy-writer composition; load no key values.
 const credentialDDL=read('supabase/migrations/20261019001207_ready_account_reporting_connectors.sql').match(/create table public\.reporting_credentials \([\s\S]*?\n\);/i)?.[0];assert(credentialDDL);
 await execute(credentialDDL,'repository_support:public.reporting_credentials');
 await execute('alter table public.reporting_credentials enable row level security;revoke all on public.reporting_credentials from public,anon,authenticated;grant all on public.reporting_credentials to service_role;','repository_support:credential_boundary');
 stage='captured_indexes';for(const r of rows)for(const i of r.indexes??[]){assert(!i.definition_withheld);const n=i.name.includes('.')?i.name:r.name.split('.')[0]+'.'+i.name;const exists=(await db.query('select to_regclass($1) v',[n])).rows[0].v;if(!exists)await execute(i.definition,'index:'+n);}
 stage='captured_policies';
 const commands={r:'select',a:'insert',w:'update',d:'delete','*':'all'};
 for(const [name,r]of tables){
  if(r.rls??r.relrowsecurity)await execute(`alter table ${qualified(name)} enable row level security`,name);
  if(r.force_rls??r.relforcerowsecurity)await execute(`alter table ${qualified(name)} force row level security`,name);
  for(const p of r.policies??[]){assert(!p.using_withheld&&!p.check_withheld);await execute(`create policy ${q(p.name)} on ${qualified(name)} as ${p.permissive?'permissive':'restrictive'} for ${commands[p.command]} to ${p.roles.map(x=>x.toLowerCase()==='public'?'public':q(x)).join(',')}${p.using?' using ('+p.using+')':''}${p.check?' with check ('+p.check+')':''}`,name+':policy');}
  if(r.acl!==undefined)await execute(grantAcl(qualified(name),r.acl),name+':ACL');
  for(const c of r.columns)for(const grant of (c.acl??'').matchAll(/(?:^|[,\{])([^=,{]*)=([^/,}]+)\//g)){
   const privileges={a:'insert',r:'select',w:'update',x:'references'};
   for(const flag of grant[2].replaceAll('*','')){assert(privileges[flag],'Unsupported captured column privilege');await execute(`grant ${privileges[flag]} (${q(c.name)}) on ${qualified(name)} to ${grant[1]?q(grant[1].replaceAll('"','')):'public'}`,name+'.'+c.name+':column_ACL');}
  }
 }
 stage='captured_triggers';for(const [name,r]of tables)for(const t of r.triggers??[])if(!t.internal){assert(!t.definition_withheld);await execute(t.definition,name+':'+t.name);if(t.enabled==='D')await execute(`alter table ${qualified(name)} disable trigger ${q(t.name)}`,name+':disabled');else if(t.enabled==='A')await execute(`alter table ${qualified(name)} enable always trigger ${q(t.name)}`,name+':always');else if(t.enabled==='R')await execute(`alter table ${qualified(name)} enable replica trigger ${q(t.name)}`,name+':replica');}
 stage='captured_function_ACLs';
 for(const [name,r]of expected){if(r.acl==null)continue;const [schema,fn]=name.split('.');const fingerprint=r.normalized_body_md5??r.body_md5;
  const candidates=(await db.query(`select p.oid::regprocedure::text signature,md5(regexp_replace(p.prosrc,'\\s','','g')) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2`,[schema,fn])).rows;
  const candidate=candidates.find(c=>!fingerprint||c.hash===fingerprint);assert(candidate,'Installed captured function identity required');
  await execute(grantAcl(candidate.signature,r.acl,'function'),name+':ACL');
 }
 const layout=async()=>(await db.query(`select 'policy' kind,polrelid::regclass::text relation,polname name,jsonb_build_object('command',polcmd,'permissive',polpermissive,'roles',polroles::text,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) definition from pg_policy union all select 'trigger',tgrelid::regclass::text,tgname,jsonb_build_object('definition',pg_get_triggerdef(oid),'enabled',tgenabled) from pg_trigger where not tgisinternal union all select 'column_acl',attrelid::regclass::text,attname,jsonb_build_object('acl',attacl::text) from pg_attribute where attacl is not null order by 1,2,3`)).rows;
 const baseline=await layout();
 const forward=assemble().sql;await db.exec('set check_function_bodies=on');
 stage='atomic_rollback_rehearsal';subject='ordered_forward.sql';
 await assert.rejects(db.exec(forward.replace(/\ncommit;\s*$/,'\nselect 1/0;\ncommit;\n')),error=>error.code==='22012');
 await db.exec('rollback');assert.deepEqual(await layout(),baseline);
 assert.equal((await db.query("select to_regclass('private.derived_evidence_audiences') v")).rows[0].v,null);
 assert.equal((await db.query("select to_regprocedure('public.fail_vsi_request_accounting_v1(uuid,uuid,uuid,uuid,uuid,integer,numeric,integer,boolean)') v")).rows[0].v,null);
 stage='atomic_forward_install';subject='ordered_forward.sql';await db.exec(forward);
 stage='preservation';
 const after=await layout();
 for(const old of baseline){subject=`preserve:${old.kind}:${old.relation}:${old.name}`;assert(after.some(r=>JSON.stringify(r)===JSON.stringify(old)),'Existing policy/trigger changed');}
 subject='writer_fence_trigger_count';
 assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname in ('aaa_shared_evidence_writer_fence','shared_evidence_no_truncate')")).rows[0].n,128);
 for(const role of ['anon','authenticated','service_role']){subject='new_failure_accounting_ACL:'+role;assert.equal((await db.query("select has_function_privilege($1,'public.fail_vsi_request_accounting_v1(uuid,uuid,uuid,uuid,uuid,integer,numeric,integer,boolean)','EXECUTE') v",[role])).rows[0].v,role==='service_role');}
 for(const role of ['anon','authenticated','service_role']){subject='old_vsi_v1_ACL:'+role;assert.equal((await db.query("select has_function_privilege($1,'public.vsi_mutate_v1(uuid,uuid,text,jsonb)','EXECUTE') v",[role])).rows[0].v,false);}
 stage='pause_procedure';subject='pause.sql';await db.exec(assemble().pauseSql);
 for(const signature of ['public.discover_shared_evidence_v1(uuid,date,date)','public.seal_shared_evidence_manifest_v1(uuid,text,uuid,integer,uuid,jsonb,uuid[])'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) v',['authenticated',signature,'EXECUTE'])).rows[0].v,false);
 for(const signature of ['public.fail_vsi_request_accounting_v1(uuid,uuid,uuid,uuid,uuid,integer,numeric,integer,boolean)','public.vsi_mutate_v3(uuid,uuid,text,jsonb,uuid,uuid)','public.complete_trusted_derived_run_v2(uuid,uuid,uuid,uuid,uuid,text,jsonb,uuid)'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) v',['service_role',signature,'EXECUTE'])).rows[0].v,true);
 const result={status:'ordered_installation_passed',engine:'PGlite_single_backend',capturedTargetLayoutRestored:true,capturedRelations:rows.length,externalForeignKeyBoundaryRelations:[...fkBoundary.keys()],repositorySupportingRelations:['public.reporting_credentials'],unexecutedSupportingTriggers,unexecutedSupportingPolicies,repositoryOnlyFunctions,atomicRollbackRehearsal:true,pauseProcedureChecked:true,inFlightTerminalGrantsRetained:true,existingTargetPoliciesAndTriggersPreserved:true,oldVsiV1RemainsRevoked:true,forwardDrafts:12,pauseExcluded:true,writerFenceTriggers:128,runtimeEnabled:false,providerCalls:0,productionAccess:false,nativeInstallation:false};
 console.log(JSON.stringify(result,null,2));
}catch(error){
 // PostgreSQL diagnostics can contain a private function body. Keep output bounded.
 console.error(JSON.stringify({status:'ordered_installation_blocked',stage,subject,code:/^[A-Z0-9_]{1,32}$/.test(error.code??'')?error.code:'LOCAL_ASSERTION',missingFunction:/Definition unavailable for ([a-z_0-9.]+)/.exec(error.message??'')?.[1],capturedLayoutRestored:false,nativeInstallation:false,productionAccess:false}));process.exitCode=1;
}finally{await db.close();}
