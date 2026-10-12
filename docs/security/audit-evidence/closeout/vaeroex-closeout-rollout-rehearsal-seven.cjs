/* Synthetic closeout migration rehearsal. Fixed owned local stack, no arbitrary target argument. */
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {Client}=require('/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex/node_modules/pg');
const root='/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex';
function localConfiguration(){
 const status=JSON.parse(fs.readFileSync('/tmp/vaeroex-closeout-rollout-status.private.json','utf8'));
 assert.equal(fs.realpathSync(status.identity.project_root),fs.realpathSync('/tmp/vaeroex-closeout-rollout'));
 const url=new URL(status.env.DB_URL);assert(['127.0.0.1','localhost'].includes(url.hostname));
 return {connectionString:status.env.DB_URL,connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:35000};
}
const report={createdAt:new Date().toISOString(),productionAccess:false,providerCalls:false,scope:'Full canonical baseline and separately declared production migration shape; isolated native PostgreSQL, synthetic historical anomalies. Not production deployment rehearsal at production volume, not Auth HTTP.',runs:[]};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const baseline=fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<'20261005').sort();assert.equal(baseline.length,123);
const sql=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
const tail=['20261005022017_workspace_security_boundaries.sql','20261005022445_workspace_persisted_usage_limits.sql','20261005060101_atomic_confirmed_memory_publication.sql','20261005060258_asset_check_server_chronology.sql','20261005061024_internal_form_submission_idempotency.sql','20261005062005_durable_import_attempt_reconciliation.sql','20261005070311_worksheet_import_publication_heads.sql'];
const id=()=>crypto.randomUUID();
async function restore(c){await c.query('reset role');await c.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','',false),set_config('request.jwt.claims','{}',false)");}
async function as(c,u,role,fn){await restore(c);await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)",[u||'',role,JSON.stringify({sub:u||null,role})]);await c.query('set role '+role);try{return await fn();}finally{await restore(c)}}
async function qualifies(c,name,nativeOwnedDirectory){
 const out={name,checks:[],migrations:[],notices:[]};report.runs.push(out);c.on('notice',n=>{if(n.message.includes('historical rows require review'))out.notices.push(n.message)});
 const ok=(n,a,b=true)=>{assert.deepEqual(a,b,n);out.checks.push({name:n,status:'pass'});};
 async function denied(n,fn,code='42501'){try{await fn();assert.fail(n+' unexpectedly passed')}catch(e){ok(n,e.code,code)}}
 const version=(await c.query("select current_setting('server_version') version,current_setting('max_connections') max_connections,current_database() database,current_setting('data_directory') directory")).rows[0];
 if(nativeOwnedDirectory){assert.match(nativeOwnedDirectory,/^\/(?:private\/)?tmp\/square-qualification-[A-Za-z0-9]+$/);assert.equal(fs.realpathSync(version.directory),fs.realpathSync(path.join(nativeOwnedDirectory,'data')));}
 else assert(version.directory.startsWith('/private/tmp/vaeroex-closeout-supabase-home/stacks/'));
 out.runtime={version:version.version,maxConnections:version.max_connections,database:version.database};
 ok('empty application database before synthetic seed',(await c.query('select count(*)::int n from public.workspaces')).rows[0].n,0);
 const A=id(),B=id(),E=id(),owner=id(),staff=id(),admin=id(),viewer=id(), assetA=id(),assetB=id(),formA=id(),formB=id(),badCheck=id(),badSubmission=id(),futureCheck=id();
 for(const u of [owner,staff,admin,viewer])await c.query("insert into auth.users(id,email)values($1,$2)",[u,'rollout-'+u+'@example.test']);
 for(const [w,n,status]of[[A,'A','trialing'],[B,'B','trialing'],[E,'expired','expired']])await c.query("insert into public.workspaces(id,name,created_by,subscription_status,trial_ends_at)values($1,$2,$3,$4,now()+interval '1 day')",[w,'SYNTHETIC CLOSEOUT '+n,owner,status]);
 for(const [w,u,r]of[[A,owner,'owner'],[B,owner,'owner'],[A,staff,'staff'],[A,viewer,'viewer'],[E,admin,'owner'],[E,viewer,'viewer']])await c.query('insert into public.workspace_members(workspace_id,user_id,role,status)values($1,$2,$3,\'active\')',[w,u,r]);
 await c.query("insert into public.assets(id,workspace_id,asset_name,status)values($1,$2,'synthetic A','Ready'),($3,$4,'synthetic B','Ready')",[assetA,A,assetB,B]);
 await c.query("insert into public.forms(id,workspace_id,name,created_by)values($1,$2,'synthetic A',$5),($3,$4,'synthetic B',$5)",[formA,A,formB,B,owner]);
 await c.query("insert into public.asset_checks(id,workspace_id,asset_id,checked_by,status,created_at)values($1,$2,$3,$4,'Ready','2024-01-01Z'),($5,$2,$6,$4,'Ready','2300-01-01Z')",[badCheck,A,assetB,staff,futureCheck,assetA]);
 await c.query("insert into public.form_submissions(id,workspace_id,form_id,submitted_by,data_json)values($1,$2,$3,$4,'{\"synthetic\":true}')",[badSubmission,A,formB,staff]);
 const history=async()=>({checks:(await c.query('select to_jsonb(c) row from public.asset_checks c order by id')).rows,submissions:(await c.query('select to_jsonb(s) row from public.form_submissions s order by id')).rows,assets:(await c.query('select to_jsonb(a) row from public.assets a order by id')).rows});
 const before=await history();
 // Simulate interruption before COMMIT using the actual complete transactional DDL.
 const security=sql(tail[0]);assert(security.trim().startsWith('begin;')&&security.trim().endsWith('commit;'));
 await c.query(security.replace(/commit;\s*$/,'rollback;'));
 ok('aborted security migration removes new exemption table',(await c.query("select to_regclass('private.platform_admin_subscription_exemptions') x")).rows[0].x,null);
 ok('aborted security migration restores original single-parent foreign keys',(await c.query("select count(*)::int n from pg_constraint where conname in ('asset_checks_asset_id_fkey','form_submissions_form_id_fkey')")).rows[0].n,2);
 ok('aborted migration preserves all preexisting rows',await history(),before);
 for(const name of tail){const s=sql(name),start=performance.now();await c.query(s);out.migrations.push({name,sha256:sha(s),milliseconds:Math.round((performance.now()-start)*100)/100});}
 ok('successful migration preserves historical children and parent states',await history(),before);
 ok('both composite foreign keys remain NOT VALID',(await c.query("select conname,convalidated from pg_constraint where conname in ('asset_checks_workspace_asset_fkey','form_submissions_workspace_form_fkey') order by conname")).rows,[{conname:'asset_checks_workspace_asset_fkey',convalidated:false},{conname:'form_submissions_workspace_form_fkey',convalidated:false}]);
 await denied('constraint validation exposes existing asset mismatch without repairing it',()=>c.query('alter table public.asset_checks validate constraint asset_checks_workspace_asset_fkey'),'23503');
 await denied('constraint validation exposes existing form mismatch without repairing it',()=>c.query('alter table public.form_submissions validate constraint form_submissions_workspace_form_fkey'),'23503');
 await denied('new cross-workspace check blocked',()=>as(c,staff,'authenticated',()=>c.query("insert into public.asset_checks(workspace_id,asset_id,checked_by,status)values($1,$2,$3,'Ready')",[A,assetB,staff])),'23503');
 await denied('new cross-workspace submission blocked',()=>as(c,staff,'authenticated',()=>c.query("insert into public.form_submissions(workspace_id,form_id,submitted_by)values($1,$2,$3)",[A,formB,staff])),'23503');
 await denied('unconfigured platform administrator has no expired workspace bypass',()=>as(c,admin,'authenticated',()=>c.query("insert into public.forms(workspace_id,name)values($1,'synthetic denied')",[E])));
 await c.query('insert into private.platform_admin_subscription_exemptions(user_id)values($1)',[admin]);
 const form=(await as(c,admin,'authenticated',()=>c.query("insert into public.forms(workspace_id,name)values($1,'synthetic exemption')returning id",[E]))).rows[0];ok('database-owner configured exemption preserves legitimate expired-admin write',Boolean(form.id));
 await denied('service API cannot configure administrator exemptions',()=>as(c,null,'service_role',()=>c.query('insert into private.platform_admin_subscription_exemptions(user_id)values($1)',[viewer])));
 await denied('authenticated API cannot configure administrator exemptions',()=>as(c,admin,'authenticated',()=>c.query('insert into private.platform_admin_subscription_exemptions(user_id)values($1)',[viewer])));
 await denied('administrator exemption does not grant foreign workspace role',()=>as(c,admin,'authenticated',()=>c.query("insert into public.forms(workspace_id,name)values($1,'synthetic foreign denied')",[A])));
 await c.query('delete from private.platform_admin_subscription_exemptions where user_id=$1',[admin]);
 await denied('removing administrator exemption immediately restores expiry denial',()=>as(c,admin,'authenticated',()=>c.query("insert into public.forms(workspace_id,name)values($1,'synthetic revoked denied')",[E])));
 const checkId=id();await as(c,staff,'authenticated',()=>c.query("insert into public.asset_checks(id,workspace_id,asset_id,checked_by,status,created_at)values($1,$2,$3,$4,'Out of service','2400-01-01Z')",[checkId,A,assetA,staff]));
 ok('latest legitimate check overrides historical future readiness',(await c.query('select status from public.assets where id=$1',[assetA])).rows[0].status,'Out of service');
 ok('authenticated future timestamp replaced by current server time',(await c.query("select created_at between now()-interval '1 minute' and now()+interval '1 second' sane from public.asset_checks where id=$1",[checkId])).rows[0].sane);
 await denied('authenticated retiming fails',()=>as(c,staff,'authenticated',()=>c.query("update public.asset_checks set created_at='2400-01-01Z' where id=$1",[checkId])),'23514');
 // The new same-tenant parent FKs must not cascade-delete old cross-tenant evidence.
 await c.query('delete from public.assets where id=$1',[assetB]);await c.query('delete from public.forms where id=$1',[formB]);
 ok('foreign parent deletion preserves mismatched historical check',(await c.query('select count(*)::int n from public.asset_checks where id=$1',[badCheck])).rows[0].n,1);
 ok('foreign parent deletion preserves mismatched historical form submission',(await c.query('select count(*)::int n from public.form_submissions where id=$1',[badSubmission])).rows[0].n,1);
 ok('private schema still unavailable to API roles',(await c.query("select rolname,has_schema_privilege(rolname,'private','USAGE') allowed from pg_roles where rolname in ('anon','authenticated','service_role')order by rolname")).rows,[{rolname:'anon',allowed:false},{rolname:'authenticated',allowed:false},{rolname:'service_role',allowed:false}]);
 await denied('trusted analysis RPC remains inaccessible to authenticated clients',()=>as(c,owner,'authenticated',()=>c.query("select public.create_trusted_analysis_run_v1($1,$2,'finding_explanation_v1','{}')",[A,owner])));
 const run=await as(c,null,'service_role',()=>c.query("select * from public.create_trusted_analysis_run_v1($1,$2,'finding_explanation_v1','{}')",[A,owner]));ok('trusted service analysis live member admitted',run.rows.length,1);
 ok('trusted analysis transaction leaves no reusable authorization',(await c.query('select count(*)::int n from private.ai_run_actor_authorizations')).rows[0].n,0);
 out.finalProtectedHistory={mismatchedChecks:1,mismatchedSubmissions:1,historicalFutureChecks:(await c.query("select count(*)::int n from public.asset_checks where id=$1 and created_at='2300-01-01Z'",[futureCheck])).rows[0].n};
 out.passed=true;return out;
}
async function main(){const c=new Client(localConfiguration());await c.connect();try{
 const shape=process.argv[2]||'canonical';assert.equal(shape,'canonical');
 report.baseline={count:baseline.length,sha256:sha(baseline.map(n=>n+':'+sha(fs.readFileSync(path.join(root,'supabase/migrations',n)))).join('\n'))};
 await qualifies(c,'canonical-native-full-schema');
}finally{await c.end();fs.writeFileSync('/tmp/vaeroex-closeout-rollout-results.json',JSON.stringify(report,null,2)+'\n')}}
if(require.main===module)main().then(()=>console.log(JSON.stringify({passed:true,checks:report.runs.reduce((n,r)=>n+r.checks.length,0)}))).catch(e=>{console.error(JSON.stringify({failed:true,code:e.code||'assertion',message:e.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[local-dsn]')}));process.exitCode=1});
module.exports={qualifies,report,tail,sql,sha};
