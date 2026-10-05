/* eslint-disable @typescript-eslint/no-require-imports -- Owned Unix-only production-shape rollout rehearsal; no supplied DSN or production access. */
// Default --plan performs no database work. --execute requires an explicit
// native PostgreSQL binary and an exclusive test window outside capacity runs.
// The 25 original rollout checks below are preserved from the archived seven-
// migration rehearsal. Historical evidence files are never rewritten.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const {Client}=require('pg');
const native=require('./run-square-durable-page-qualification.js');
const existing=require('./run-qbo-production-candidate-database-tests.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),id=()=>crypto.randomUUID();
const tail=[...existing.auditMigrations,...existing.capacityMigrations];assert.equal(tail.length,13);
const capture=(directory,name)=>{const sql=fs.readFileSync(path.join(root,directory,name),'utf8');return {name,version:name.split('_')[0],sql,sha256:sha(sql)};};
const frozenTail=new Map(tail.map(name=>[name,capture('supabase/migrations',name)]));
for(const name of existing.auditMigrations)assert.equal(frozenTail.get(name).sha256,capture('supabase/production-migrations',name).sha256);
const sql=name=>{assert(frozenTail.has(name));return frozenTail.get(name).sql;};
const prefix=fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>/^\d+_.+\.sql$/.test(n)&&n.split('_')[0]<='20260902191325').sort();assert.equal(prefix.length,104);
const baseline=[...prefix.map(n=>capture('supabase/migrations',n)),...existing.productionSquare.map(n=>capture('supabase/production-migrations',n)),...existing.candidates.map(n=>capture('supabase/production-migrations',n)),...existing.productionSheets.map(n=>capture('supabase/production-migrations',n)),...Object.values(existing.dashboardMigrations).map(n=>capture('supabase/production-migrations',n))];assert.equal(baseline.length,120);
const report={kind:'workspace_thirteen_migration_rollout_rehearsal_v1',createdAt:new Date().toISOString(),productionAccess:false,providerCalls:false,scope:'Targeted production120+13 migration-shape rollout and forward recovery; reduced platform prerequisite fixture in a fresh native Unix-only database. No Auth HTTP or production-volume timing claim.',runs:[],checks:[],events:[],passed:false,plan:{baselineMigrations:120,tailMigrations:13,reusedBoundaryChecks:25,addedScenarios:['later DDL failure and forward retry','actual commit with simulated lost acknowledgement and ledger/catalog reconciliation','pre-receipt historical import preservation','held partial and saved complete import reconciliation','full-tail administrator exemption/role/membership/revocation','old480-second Sheets lease and historical mismatch preservation','full-tail scoped expired-run terminal recovery'],operatorInputs:['actual approved UUID roster','named production write-admission/drain controls','compatible release artifact and release approval'],capacityClaim:false},baselineManifest:baseline.map(({name,sha256})=>({name,sha256})),tailManifest:[...frozenTail.values()].map(({name,sha256})=>({name,sha256}))};
const ok=(name,value,expected=true)=>{assert.deepEqual(value,expected,name);report.checks.push({name,status:'pass'});};
async function denied(name,fn,code='42501'){try{await fn();assert.fail(name+' unexpectedly passed');}catch(error){ok(name,error.code,code);}}
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
 out.fixture={A,B,E,owner,staff,admin,viewer};out.passed=true;return out;
}

async function prepareImport(c,workspace,owner,label){
 const f=id(),i=id(),r=id();
 await c.query("insert into public.file_uploads(id,workspace_id,original_name,display_name,file_extension,mime_type,storage_path,created_by) values($1,$2,$3,$3,'csv','text/csv','synthetic-rollout/'||$1::text,$4)",[f,workspace,label,owner]);
 await c.query("insert into public.file_imports(id,workspace_id,file_upload_id,import_type,status,rows_total,mapping_json,created_by)values($1,$2,$3,'metrics','needs_review',1,jsonb_build_object('preparation_id',$1::text),$4)",[i,workspace,f,owner]);
 await c.query("insert into public.file_import_rows(id,workspace_id,file_upload_id,import_id,import_type,row_number,data_json)values($1,$2,$3,$4,'metrics',2,'{\"Value\":100}')",[r,workspace,f,i]);
 return {workspace,owner,file:f,import:i,row:r};
}
const beginImport=(c,x,row=x.row)=>as(c,x.owner,'authenticated',()=>c.query('select public.begin_file_import_attempt_v1($1,$2,$3,$4::jsonb,$5::uuid[]) value',[x.workspace,x.file,x.import,JSON.stringify({metric_name:'Value'}),[row]]).then(r=>r.rows[0].value));
const reconcileImport=(c,x,failed=false)=>as(c,x.owner,'authenticated',()=>c.query('select public.reconcile_file_import_attempt_v1($1,$2,$3,$4) value',[x.workspace,x.file,x.import,failed]).then(r=>r.rows[0].value));
async function completeMarkers(c,x){await as(c,x.owner,'authenticated',async()=>{
 await c.query("update public.file_import_rows set status='imported' where id=$1",[x.row]);
 await c.query("update public.file_imports set status='completed',rows_imported=1,imported_at=clock_timestamp() where id=$1",[x.import]);
 await c.query("update public.file_uploads set import_status='imported',metadata_json=metadata_json||jsonb_build_object('last_import',jsonb_build_object('import_id',$1::text,'imported_at',(select imported_at from public.file_imports where id=$1::uuid))) where id=$2",[x.import,x.file]);
 });}
async function importHistory(c,x){return{
 file:(await c.query('select to_jsonb(f) row from public.file_uploads f where id=$1',[x.file])).rows,
 import:(await c.query("select to_jsonb(i)-'recovery_status' row from public.file_imports i where id=$1",[x.import])).rows,
 rows:(await c.query('select to_jsonb(r) row from public.file_import_rows r where import_id=$1 order by id',[x.import])).rows,
 metrics:(await c.query('select to_jsonb(m) row from public.operational_metrics m where import_id=$1 order by id',[x.import])).rows,
 chunks:(await c.query('select to_jsonb(b) row from public.business_memory_chunks b where source_file_id=$1 order by id',[x.file])).rows
 };}
async function seedSheetsHistory(c,workspace,owner){
 const entity=id();await c.query("insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,created_by,updated_by)values($1,$2,$3,'Synthetic rollout entity','USD','UTC',$4,$4)",[entity,workspace,'rollout_'+entity.replaceAll('-',''),owner]);
 const fixtures=[];
 for(const kind of['live480','expired480','historical_mismatch']){
  const connection=id(),approval=id(),run=id();
  await c.query("insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,status,display_name)values($1,$2,$3,$4,'reauthorization_required',$5)",[connection,workspace,entity,owner,'Synthetic '+kind]);
  await c.query("insert into public.google_sheets_mapping_approvals(id,workspace_id,connection_id,approved_by,spreadsheet_id,sheet_id,header_row,headers,field_mapping)values($1,$2,$3,$4,'synthetic_rollout_spreadsheet_123',0,1,'[]','{}')",[approval,workspace,connection,owner]);
  if(kind!=='historical_mismatch')await c.query("insert into public.google_sheets_sync_runs(id,workspace_id,connection_id,approval_id,trigger_kind,status,started_at)values($1,$2,$3,$4,'scheduled','running',clock_timestamp()+$5::interval)",[run,workspace,connection,approval,kind==='live480'?'0 seconds':'-600 seconds']);
  await c.query("update public.google_sheets_connections set sync_lease_run_id=$1,sync_lease_expires_at=case when $3='historical_mismatch' then clock_timestamp()-interval '2 hours' else(select started_at+interval '480 seconds' from public.google_sheets_sync_runs where id=$1)end where id=$2",[run,connection,kind]);
  fixtures.push({kind,connection,run});
 }
 return {workspace,fixtures};
}
async function sheetsHistory(c,x){return{
 connections:(await c.query('select to_jsonb(c) row from public.google_sheets_connections c where workspace_id=$1 order by id',[x.workspace])).rows,
 runs:(await c.query("select to_jsonb(r)-'eligible_at' row from public.google_sheets_sync_runs r where workspace_id=$1 order by id",[x.workspace])).rows
 };}
async function addChunk(c,x,attempt,label){return(await c.query("insert into public.business_memory_chunks(workspace_id,source_type,source_id,source_file_id,source_title,source_excerpt,content_hash,embedding,source_metadata)values($1,'file',$2,$2,'Synthetic worksheet',$4,md5($3::text),array_prepend(1::real,array_fill(0::real,array[1535]))::extensions.vector,jsonb_build_object('indexing_method','worksheet_import','import_attempt_id',$3::text,'import_id',$5::text,'evidence_classification','business_evidence','extraction_outcome','completed'))returning id",[x.workspace,x.file,attempt,label,x.import])).rows[0].id;}
async function rolloutCatalogFingerprint(c,runtime){
 // The reused provider fingerprint covers functions, ACLs, RLS, triggers and
 // constraints. Add all public/private columns and indexes (including Square)
 // so a rolled-back eligible_at column or index cannot evade this assertion.
 const objects=(await c.query(`select n.nspname,c.relname,c.relkind,a.attnum,a.attname,
   format_type(a.atttypid,a.atttypmod) type,a.attnotnull,a.attidentity,a.attgenerated,
   pg_get_expr(d.adbin,d.adrelid) default_expression
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
   left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
   where n.nspname in('public','private') order by 1,2,4`)).rows;
 const indexes=(await c.query("select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in('public','private') order by 1,2,3")).rows;
 return sha(JSON.stringify([await runtime.sourceSchemaFingerprint(c),objects,indexes]));
}
async function postTailChecks(c,state,fixture){
 const {A,E,admin,viewer}=fixture;
 ok('all thirteen migrations preserve pre-receipt historical import contents',await importHistory(c,state.legacy),state.legacyBefore);
 ok('legacy import is not assigned an invented durable receipt',(await c.query('select count(*)::int n from private.file_import_attempts where file_id=$1',[state.legacy.file])).rows[0].n,0);
 ok('pre-receipt source explicitly reports not_started without asserting no historical effects',(await reconcileImport(c,state.legacy)).status,'not_started');
 for(const name of['partial','complete','head'])ok('later six migrations preserve '+name+' source and known effects',await importHistory(c,state[name]),state[name+'Before']);
 ok('partial interrupted writer receipt remains the original attempt',(await beginImport(c,state.partial)).attempt_id,state.partialAttempt.attempt_id);
 const held=await reconcileImport(c,state.partial,true);ok('partial work is truthfully held',held.status,'reconciliation_required');ok('partial inventory retains one committed metric',held.metric_records,1);ok('held retry does not admit a new writer',(await beginImport(c,state.partial)).admitted,false);
 await denied('held source content cannot be rewritten',()=>as(c,state.partial.owner,'authenticated',()=>c.query("update public.file_import_rows set data_json='{\"Value\":999}' where id=$1",[state.partial.row])),'55000');
 const completed=await reconcileImport(c,state.complete);ok('saved complete work reconciles after lost final acknowledgement',completed.status,'completed');ok('completed replay cannot duplicate work',(await beginImport(c,state.complete)).admitted,false);ok('completed inventory retains exactly one metric',completed.metric_records,1);
 const getHead=()=>as(c,state.head.owner,'authenticated',()=>c.query('select * from public.get_worksheet_publication_heads_v1($1,$2::uuid[])',[A,[state.head.file]]).then(r=>r.rows[0].completed_attempt_id));
 ok('prior completed publication head survives a held next generation',await getHead(),state.headCompleted.attempt_id);
 await reconcileImport(c,state.head,true);ok('marking uncertain generation held cannot replace prior head',await getHead(),state.headCompleted.attempt_id);
 const matches=await as(c,state.head.owner,'authenticated',()=>c.query('select id from public.match_business_memory_chunks($1,array_prepend(1::real,array_fill(0::real,array[1535]))::extensions.vector,20,0.1)',[A]).then(r=>r.rows.map(x=>x.id)));
 ok('actual pgvector read excludes held generation and retains prior completed evidence',matches,[state.headPublishedChunk]);
 ok('prior and pending citation records remain stored',(await c.query('select count(*)::int n from public.business_memory_chunks where id=any($1::uuid[])',[[state.headPublishedChunk,state.headPendingChunk]])).rows[0].n,2);
 await c.query("update public.workspaces set subscription_status='expired',trial_ends_at=null where id=$1",[A]);
 ok('expired workspace retains held-work readback',(await reconcileImport(c,state.partial)).metric_records,1);
 await denied('expiry does not permit a new import claim',()=>beginImport(c,state.legacy));
 await denied('viewer cannot reconcile held import',()=>as(c,viewer,'authenticated',()=>c.query('select public.reconcile_file_import_attempt_v1($1,$2,$3,false)',[A,state.partial.file,state.partial.import])));
 await c.query("update public.workspaces set subscription_status='trialing',trial_ends_at=clock_timestamp()+interval '1 day' where id=$1",[A]);
 const payload={title:'Synthetic full-tail exempt issue',description:'Synthetic review rehearsal',issue_type:'Audit',severity:'Low',status:'Open',root_cause:'',recommended_fix:'',assigned_person_id:null,assigned_role:null,assigned_department:null,due_date:null},request=id();
 const issue=(who=admin,body=payload,w=E)=>as(c,who,'authenticated',()=>c.query('select public.submit_issue_v1($1,$2,$3::jsonb) value',[w,request,JSON.stringify(body)]).then(r=>r.rows[0].value));
 await denied('full-tail issue RPC rejects unconfigured expired administrator',()=>issue());
 await c.query('insert into private.platform_admin_subscription_exemptions(user_id) values($1),($2)',[admin,viewer]);
 const accepted=await issue();ok('approved synthetic owner exemption admits issue write',accepted.replayed,false);ok('issue acknowledgement replay returns same saved issue',(await issue()).issueId,accepted.issueId);
 // The actual production-seeded plan gives finite 500-file/1000-run limits.
 // These synthetic rows prove that the full tail preserves the configured
 // exemption and that revocation restores persisted quotas, not only billing.
 await c.query("insert into public.customer_subscriptions(workspace_id,customer_email,plan_slug,status,billing_provider,stripe_customer_id,stripe_subscription_id,current_period_end)values($1,'rollout-admin@example.test','vaeroex','canceled','stripe','synthetic_rollout_customer','synthetic_rollout_subscription',clock_timestamp()+interval '1 day')",[E]);
 await c.query("insert into public.file_uploads(workspace_id,original_name,display_name,file_extension,mime_type,storage_path) select $1,'Synthetic quota file','Synthetic quota file','txt','text/plain','synthetic-rollout-quota/'||n from generate_series(1,500)n",[E]);
 await c.query("insert into public.ai_agent_runs(workspace_id,agent_type)select $1,'synthetic_rollout_quota' from generate_series(1,1000)",[E]);
 const quotaFile=()=>as(c,admin,'authenticated',()=>c.query("insert into public.file_uploads(workspace_id,original_name,display_name,file_extension,mime_type,storage_path)values($1,'Synthetic exempt file','Synthetic exempt file','txt','text/plain','synthetic-rollout-exempt/'||gen_random_uuid()::text)",[E]));
 await quotaFile();ok('full-tail configured administrator exceeds finite file quota',(await c.query('select count(*)::int n from public.file_uploads where workspace_id=$1',[E])).rows[0].n,501);
 await as(c,admin,'authenticated',()=>c.query("insert into public.ai_agent_runs(workspace_id,agent_type)values($1,'synthetic_rollout_exempt')",[E]));
 const trustedRun=()=>as(c,null,'service_role',()=>c.query("select * from public.create_trusted_analysis_run_v1($1,$2,'finding_explanation_v1','{}')",[E,admin]));
 await trustedRun();ok('full-tail authenticated and actor-bound service exemptions exceed finite run quota',(await c.query('select count(*)::int n from public.ai_agent_runs where workspace_id=$1',[E])).rows[0].n,1002);
 await denied('direct service insert cannot borrow the approved actor exemption',()=>as(c,null,'service_role',()=>c.query("insert into public.ai_agent_runs(workspace_id,agent_type,created_by)values($1,'synthetic_borrowed_exemption',$2)",[E,admin])),'23514');

 await denied('same issue request with changed payload is rejected',()=>issue(admin,{...payload,title:'Changed replay'}),'22023');
 await denied('configured viewer exemption does not create manager authority',()=>issue(viewer));
 await denied('configured administrator exemption cannot cross tenant boundary',()=>issue(admin,payload,A));
 await c.query("update public.workspace_members set status='disabled' where workspace_id=$1 and user_id=$2",[E,admin]);await denied('revoked membership denies even known issue replay',()=>issue());
 await c.query("update public.workspace_members set status='active' where workspace_id=$1 and user_id=$2",[E,admin]);
 await c.query('delete from private.platform_admin_subscription_exemptions where user_id=any($1::uuid[])',[[admin,viewer]]);await denied('removing exemption restores issue expiry denial',()=>issue());
 await c.query("update public.customer_subscriptions set status='active' where workspace_id=$1 and billing_provider='stripe'",[E]);
 await denied('removing exemption restores full-tail persisted file quota',quotaFile,'23514');
 await denied('removing exemption restores full-tail actor-bound service run quota',trustedRun,'23514');
 ok('denied quota retries retain all existing files',(await c.query('select count(*)::int n from public.file_uploads where workspace_id=$1',[E])).rows[0].n,501);
 ok('denied quota retries retain all existing runs',(await c.query('select count(*)::int n from public.ai_agent_runs where workspace_id=$1',[E])).rows[0].n,1002);
 ok('trusted exemption transactions leave no reusable actor authorization',(await c.query('select count(*)::int n from private.ai_run_actor_authorizations')).rows[0].n,0);
 ok('issue and immutable receipt survive denied retries',(await c.query('select count(*)::int n from private.issue_submission_receipts where workspace_id=$1 and actor_id=$2 and request_id=$3',[E,admin,request])).rows[0].n,1);
 ok('all API roles remain excluded from exemption table',(await c.query("select rolname,has_table_privilege(rolname,'private.platform_admin_subscription_exemptions','SELECT,INSERT,UPDATE,DELETE') allowed from pg_roles where rolname in('anon','authenticated','service_role') order by rolname")).rows,[{rolname:'anon',allowed:false},{rolname:'authenticated',allowed:false},{rolname:'service_role',allowed:false}]);
 ok('all migrations preserve original Sheets lease and historical mismatch inventory',await sheetsHistory(c,state.sheets),state.sheetsBefore);
 const live=state.sheets.fixtures.find(x=>x.kind==='live480'),expired=state.sheets.fixtures.find(x=>x.kind==='expired480'),mismatch=state.sheets.fixtures.find(x=>x.kind==='historical_mismatch');
 ok('old in-flight lease still has original480-second duration',(await c.query('select extract(epoch from(c.sync_lease_expires_at-r.started_at))::int seconds from public.google_sheets_connections c join public.google_sheets_sync_runs r on r.id=c.sync_lease_run_id where c.id=$1',[live.connection])).rows[0].seconds,480);
 ok('old run has no fabricated queue eligibility',(await c.query('select eligible_at from public.google_sheets_sync_runs where id=$1',[live.run])).rows[0].eligible_at,null);
 const beforeMismatch=(await c.query('select to_jsonb(c) row from public.google_sheets_connections c where id=$1',[mismatch.connection])).rows;
 const recovery=await as(c,null,'service_role',()=>c.query('select public.recover_google_sheets_syncs_v1(100) value').then(r=>r.rows[0].value));
 ok('matching expired run is terminalized once',recovery.recovered,1);ok('historical mismatch remains operator-visible',recovery.historicalMismatches,1);ok('mismatch remains a non-green recovery result',recovery.remainingExpired,1);
 ok('historical mismatch is not repaired or deleted',(await c.query('select to_jsonb(c) row from public.google_sheets_connections c where id=$1',[mismatch.connection])).rows,beforeMismatch);
 ok('unexpired480-second run is still running',(await c.query('select status from public.google_sheets_sync_runs where id=$1',[live.run])).rows[0].status,'running');
 ok('expired run truthfully records lease_expired',(await c.query('select status,error_code from public.google_sheets_sync_runs where id=$1',[expired.run])).rows[0],{status:'failed',error_code:'lease_expired'});
 const repeated=await as(c,null,'service_role',()=>c.query('select public.recover_google_sheets_syncs_v1(100) value').then(r=>r.rows[0].value));ok('repeat recovery does not fabricate another terminal transition',repeated.recovered,0);
 report.recovery={oldLeaseSeconds:480,oldEligibilityRemainsNull:true,expiredRunTerminal:'failed/lease_expired',historicalMismatchesPreserved:1,remainingExpired:1,elapsedRecoveryQualified:false,syntheticExpiryFixture:true};
 report.heldImports={partial:{status:held.status,metrics:held.metric_records},completed:{status:completed.status,metrics:completed.metric_records},preReceipt:'not_started with historical records preserved',priorHeadPreserved:true,automaticResumeImplemented:false};
}
async function main(){
 const args=process.argv.slice(2);assert(args.length<=1&&['--plan','--execute',undefined].includes(args[0]),'only_plan_or_execute_supported');
 report.harnessSha256=sha(fs.readFileSync(__filename));
 const originalSource=fs.readFileSync(path.join(root,'docs/security/audit-evidence/closeout/vaeroex-closeout-rollout-rehearsal-seven.cjs'),'utf8');
 report.originalBoundaryFixtureSha256=sha(originalSource);
 const originalFunction=originalSource.slice(originalSource.indexOf('async function qualifies('),originalSource.indexOf('\nasync function main(')).trim();
 const reusedFunction=qualifies.toString().replace('out.fixture={A,B,E,owner,staff,admin,viewer};','');
 assert.equal(reusedFunction,originalFunction,'original25_checks_must_remain_identical');
 report.originalBoundaryFunctionSha256=sha(originalFunction);
 if(args[0]!=='--execute'){console.log(JSON.stringify({...report.plan,executed:false,tailManifest:report.tailManifest},null,2));return;}
 native.assertNoRemoteConfiguration();native.assertNoLinkedProject();
 const bin=process.env.WORKSPACE_AUDIT_PG_BIN;assert(bin&&path.isAbsolute(bin)&&fs.existsSync(path.join(bin,'initdb')),'explicit_local_postgres_bin_required');
 assert.equal(process.env.WORKSPACE_ROLLOUT_EXCLUSIVE_WINDOW,'confirmed','exclusive_non_capacity_window_required');process.env.SQUARE_QUALIFICATION_PG_BIN=bin;
 // The consumed execution flag is not a target selector; the existing bootstrap
 // must continue to reject supplied database URLs and all remote configuration.
 process.argv.splice(2);const evidence=fs.mkdtempSync('/tmp/vaeroex-rollout-thirteen-');fs.chmodSync(evidence,0o700);
 report.sourceCommit=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();const save=()=>fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});save();
 let stage='owned_native_bootstrap';
 try{await native.runAdditionalQualification(async runtime=>{
  const owned=await runtime.createDatabase('rollout_thirteen'),c=owned.client,directory=path.dirname(owned.connection.host);report.nativeDirectory=directory;
  await c.query('create extension if not exists pg_stat_statements with schema extensions;create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key)');
  const ledger=[];const verifyLedger=async()=>ok('exact committed migration ledger at '+ledger.length,(await c.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(x=>x.version),[...ledger].sort());
  for(const item of baseline){stage=item.name;await c.query(item.sql);await c.query('insert into supabase_migrations.schema_migrations values($1)',[item.version]);ledger.push(item.version);}
  existing.assertProductionBaselineLedger(ledger);await verifyLedger();
  const state={};let seeded=false;const securityRollback=sql(tail[0]).replace(/commit;\s*$/,'rollback;');
  async function seedBeforeTail(){const w=(await c.query("select id,created_by from public.workspaces where name='SYNTHETIC CLOSEOUT A'")).rows[0];assert(w);state.legacy=await prepareImport(c,w.id,w.created_by,'Synthetic historical pre-receipt source');await c.query("insert into public.operational_metrics(workspace_id,source_file_id,import_id,import_row_id,metric_name,value,metric_date)values($1,$2,$3,$4,'Legacy known partial row',100,'2026-10-01')",[w.id,state.legacy.file,state.legacy.import,state.legacy.row]);state.legacyBefore=await importHistory(c,state.legacy);state.sheets=await seedSheetsHistory(c,w.id,w.created_by);state.sheetsBefore=await sheetsHistory(c,state.sheets);}
  async function seedPartialRollout(){const {workspace,owner}=state.legacy;state.partial=await prepareImport(c,workspace,owner,'Synthetic interrupted accepted source');state.partialAttempt=await beginImport(c,state.partial);ok('partial-rollout import accepted exactly once',state.partialAttempt.admitted,true);
   const worker=new Client({...owned.connection,statement_timeout:5000});await worker.connect();try{ok('independent worker uses the owned database',(await worker.query('select current_database() db')).rows[0].db,owned.name);await as(worker,owner,'authenticated',()=>worker.query("insert into public.operational_metrics(workspace_id,source_file_id,import_id,import_row_id,metric_name,value,metric_date)values($1,$2,$3,$4,'Synthetic committed partial row',100,'2026-10-01')",[workspace,state.partial.file,state.partial.import,state.partial.row]));}finally{await worker.end();}report.events.push({event:'synthetic_import_worker_disconnected_after_committed_business_write',receipt:state.partialAttempt.attempt_id});
   state.complete=await prepareImport(c,workspace,owner,'Synthetic saved complete unacknowledged source');state.completeAttempt=await beginImport(c,state.complete);await as(c,owner,'authenticated',()=>c.query("insert into public.operational_metrics(workspace_id,source_file_id,import_id,import_row_id,metric_name,value,metric_date)values($1,$2,$3,$4,'Synthetic complete row',100,'2026-10-01')",[workspace,state.complete.file,state.complete.import,state.complete.row]));await completeMarkers(c,state.complete);
   state.head=await prepareImport(c,workspace,owner,'Synthetic prior publication source');state.headCompleted=await beginImport(c,state.head);state.headPublishedChunk=await addChunk(c,state.head,state.headCompleted.attempt_id,'Prior complete synthetic evidence');await completeMarkers(c,state.head);ok('prior publication is complete before later migration files',(await reconcileImport(c,state.head)).status,'completed');
   await c.query("update public.file_imports set status='needs_review',mapping_json=jsonb_build_object('preparation_id',$2::text) where id=$1",[state.head.import,id()]);state.head.row=id();await c.query("insert into public.file_import_rows(id,workspace_id,file_upload_id,import_id,import_type,row_number,data_json)values($1,$2,$3,$4,'metrics',3,'{\"Value\":200}')",[state.head.row,workspace,state.head.file,state.head.import]);state.headPending=await beginImport(c,state.head);state.headPendingChunk=await addChunk(c,state.head,state.headPending.attempt_id,'Pending uncertain synthetic evidence');
   for(const key of['partial','complete','head'])state[key+'Before']=await importHistory(c,state[key]);
  }
  const query=async(text,params)=>{
   if(!seeded&&text===securityRollback){seeded=true;await seedBeforeTail();}
   const item=[...frozenTail.values()].find(i=>i.sql===text);if(!item)return c.query(text,params);
   stage=item.name;assert(item.sql.trim().startsWith('begin;')&&/commit;\s*$/.test(item.sql));const ledgerSql="insert into supabase_migrations.schema_migrations(version)values('"+item.version+"');\n";
   const transaction=item.sql.replace(/commit;\s*$/,ledgerSql+'commit;');
   if(item.name===tail[7]){
    // Model already accepted work at the seven-file contract boundary. No
    // assertion here substitutes for production admission/drain controls.
    await seedPartialRollout();
    const catalog=await rolloutCatalogFingerprint(c,runtime),beforeLedger=[...ledger];
    try{await c.query(transaction.replace(/commit;\s*$/,'select 1/0;commit;'));assert.fail('injected_later_migration_error_expected');}catch(error){assert.equal(error.code,'22012');await c.query('rollback');}
    ok('later failed file leaves earlier seven files committed',ledger,beforeLedger);ok('later failed file restores guarded catalog plus all application columns and indexes',await rolloutCatalogFingerprint(c,runtime),catalog);await verifyLedger();ok('failed dispatch migration preserves historical Sheets records',await sheetsHistory(c,state.sheets),state.sheetsBefore);for(const key of['partial','complete','head'])ok('failed dispatch migration preserves '+key+' accepted work',await importHistory(c,state[key]),state[key+'Before']);report.events.push({event:'migration8_rolled_back_after_injected_DDL_transaction_failure',earlierCommittedFiles:7});
   }
   const applied=await c.query(transaction);ledger.push(item.version);await verifyLedger();
   if(item.name===tail[8]){
    // Fault injection discards the successful result at the migrator boundary;
    // SQL COMMIT is real. No claim of a kernel/network disconnect is made.
    report.events.push({event:'migration9_commit_acknowledgement_simulated_lost',committed:true});const observed=(await c.query("select to_regclass('private.issue_submission_receipts') receipt,to_regprocedure('public.submit_issue_v1(uuid,uuid,jsonb)') rpc")).rows[0];ok('unknown migration outcome reconciles receipt catalog',Boolean(observed.receipt&&observed.rpc));await verifyLedger();report.events.push({event:'migration9_reconciled_from_catalog_and_atomic_ledger',migrationReapplied:false});
   }
   return applied;
  };
  const proxy={query,on:c.on.bind(c)};stage='original_boundary_checks_with_thirteen_files';const original=await qualifies(proxy,'production120_plus13_forward_recovery',directory);ok('original boundary assertions preserved',original.checks.length,25);
  stage='full_tail_coordinated_recovery';await restore(c);await postTailChecks(c,state,original.fixture);await verifyLedger();ok('production-shape final ledger includes exactly133 committed versions',ledger.length,133);
  report.finalLedger=[...ledger].sort();report.originalBoundaryChecks=original.checks.length;report.passed=true;report.finishedAt=new Date().toISOString();save();
 });report.ownedClusterStopped=!fs.existsSync(path.join(report.nativeDirectory,'data/postmaster.pid'));ok('owned native cluster stopped after rehearsal',report.ownedClusterStopped);save();console.log(JSON.stringify({passed:true,result:path.join(evidence,'result.json'),originalChecks:report.originalBoundaryChecks,additionalChecks:report.checks.length,tailMigrations:13,productionAccess:false}));
 }catch(error){report.passed=false;report.failure={stage,code:error.code||error.name,message:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[local-dsn]')};save();throw error;}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({failed:true,code:error.code||error.name,message:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[local-dsn]')}));process.exitCode=1;});
