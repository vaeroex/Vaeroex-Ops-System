const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {Client}=require('/tmp/vaeroex-audit-production/node_modules/pg');
const root='/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex',bin='/tmp/vaeroex-stage4-pg/bin';
const phase=fs.readFileSync(path.join(root,'supabase/migrations/20260820233007_external_integrations_phase_1_canonical_foundation.sql'),'utf8');
const boundary=fs.readFileSync(path.join(root,'supabase/migrations/20261005022017_workspace_security_boundaries.sql'),'utf8');
const fixture=fs.readFileSync(path.join(root,'supabase/tests/external_integrations_phase_1_canonical_foundation.test.sql'),'utf8');
const one=(s,re)=>{const m=s.match(re);assert(m,String(re));return m[0]};
const readPolicy=one(phase,/create policy "workspace members read business entities"[\s\S]*?;/);
const guardLoop=one(boundary,/do \$\$\ndeclare item record;[\s\S]*?\n\$\$;/);
const assertions=[...fixture.matchAll(/select ok\(\n  \(select jsonb_agg\(jsonb_build_array\(policyname, cmd, roles::text\)[\s\S]*?\n\);/g)].map(m=>m[0]);assert.equal(assertions.length,2);
const owned=fs.mkdtempSync('/tmp/vaeroex-policy-collation-');fs.chmodSync(owned,0o700);const data=path.join(owned,'data'),socket=path.join(owned,'socket');fs.mkdirSync(socket,{mode:0o700});
const results=[];let started=false,c;
function command(n,args){const p=spawnSync(path.join(bin,n),args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});if(p.status!==0)throw Error('local_'+n+'_failed');}
async function check(name,index,expected){const actual=(await c.query(assertions[index])).rows[0].ok;assert.equal(actual,expected,name);results.push({name,expected,actual,status:'pass'});}
(async()=>{try{
 for(const k of ['DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','SUPABASE_SERVICE_ROLE_KEY'])assert(!Object.hasOwn(process.env,k),'inherited_connection_configuration_forbidden');
 command('initdb',['-D',data,'-A','trust','--no-locale','-U','postgres']);
 command('pg_ctl',['-D',data,'-l',path.join(owned,'postgres.log'),'-o',`-k ${socket} -c listen_addresses='' -p 55462`,'-w','start']);started=true;
 c=new Client({host:socket,port:55462,database:'postgres',user:'postgres',ssl:false,statement_timeout:10000});await c.connect();
 await c.query(`create role authenticated;create role anon;create schema private;create table public.business_entities(workspace_id uuid);alter table public.business_entities enable row level security;create function public.is_workspace_member(uuid) returns boolean language sql as $$select true$$;create function private.workspace_mutation_entitled_v1(uuid) returns boolean language sql as $$select true$$;create function private.guard_workspace_mutation_entitlement_v1() returns trigger language plpgsql as $$begin return new;end$$;create function public.ok(boolean,text) returns boolean language sql as $$select $1$$;`);
 await c.query(readPolicy);await c.query(guardLoop);
 await check('exact original permissive tuple passes',0,true);await check('exact three restrictive tuples pass',1,true);
 await c.query('begin');await c.query('create policy unexpected_extra on business_entities for select to authenticated using(true)');await check('extra permissive policy fails',0,false);await c.query('rollback');
 await c.query('begin');await c.query('create policy unexpected_extra on business_entities as restrictive for select to authenticated using(true)');await check('extra restrictive policy fails',1,false);await c.query('rollback');
 await c.query('begin');await c.query('alter policy "workspace members read business entities" on business_entities to anon');await check('wrong permissive role fails',0,false);await c.query('rollback');
 await c.query('begin');await c.query('alter policy audit_entitled_insert on business_entities to anon');await check('wrong restrictive role fails',1,false);await c.query('rollback');
 await c.query('begin');await c.query('drop policy audit_entitled_insert on business_entities;create policy audit_entitled_insert on business_entities as restrictive for select to authenticated using(true)');await check('wrong restrictive command fails',1,false);await c.query('rollback');
 const output={scope:'Native pg_policies, actual source permissive policy and restrictive policy-generation loop; exact fixture JSONB aggregate assertions via an identity ok(bool,text) shim (not pgTAP itself). Minimal target table/predicate stubs only; no app behavior or full provider-suite claim.',bounds:{network:'disabled; private Unix socket',statementMs:10000,utilityTimeoutMs:30000},serverVersion:(await c.query('show server_version')).rows[0].server_version,fixtureSha256:crypto.createHash('sha256').update(fixture).digest('hex'),results};
 fs.writeFileSync('/tmp/vaeroex-phase1-policy-collation-proof.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
}finally{if(c)await c.end();if(started)command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
