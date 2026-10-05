/* eslint-disable @typescript-eslint/no-require-imports -- Isolated native SQL regression harness. */
// No URL or provider accepted. Real Postgres locks/RLS/transactions; pgvector's
// representation is replaced by real[] in this focused fixture, not qualified.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{Client}=require('pg');
const root=path.resolve(__dirname,'..'), bin=process.env.WORKSPACE_AUDIT_PG_BIN, checks=[], clients=[];
const baseSource=fs.readFileSync(path.join(root,'scripts/workspace-security-database-tests.cjs'),'utf8');
const base=Function('require','__dirname',baseSource.slice(0,baseSource.indexOf('\n(async()=>{'))+'\nreturn {fixture,actor,admin,user,A,B};')(require,__dirname);
const {A,B,user}=base;
const file=n=>`88888888-8888-4888-8888-${String(n).padStart(12,'0')}`,run=n=>`99999999-9999-4999-8999-${String(n).padStart(12,'0')}`;
const migration='20261005060101_atomic_confirmed_memory_publication.sql';
const importMigration='20261005062005_durable_import_attempt_reconciliation.sql';
const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
const ddl=(name,s)=>{const m=s.match(new RegExp('create table (?:if not exists )?public\\.'+name+' \\([\\s\\S]*?\\n\\);'));assert(m,name);return m[0];};
const statement=(re,s)=>{const m=s.match(re);assert(m,String(re));return m[0];};
let owned,config,started=false;
function command(name,args){const r=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:120000,maxBuffer:2**20});if(r.status!==0)throw new Error(`local_${name}_failed: ${r.stderr.slice(0,500)}`);}
async function connect(){const c=new Client({...config,ssl:false,statement_timeout:10000,connectionTimeoutMillis:5000});c.on('error',()=>{});await c.connect();clients.push(c);return c;}
function pass(name,value,expected=true){assert.deepEqual(value,expected,name);checks.push({name,status:'pass'});}
async function rejects(name,promise,code){try{await promise;assert.fail(name+' allowed');}catch(e){pass(name,e.code,code);}}
const payload=(suffix='')=>[{source_excerpt:'October revenue was 100 units. This synthetic source provides a documented business fact for confirmation. '+suffix,source_quality:'high',confidence_score:80,token_estimate:25,source_metadata:{review_status:'approved'},embedding:null}];
const invoke=(c,n,opts={})=>c.query('select public.publish_confirmed_file_memory_v1($1,$2,$3,$4,$5::jsonb,$6,$7) value',[opts.workspace||A,opts.file||file(n),opts.run||run(n),opts.actor||user(1),JSON.stringify(opts.rows||payload()),opts.summary||'Synthetic confirmed summary',null]).then(r=>r.rows[0].value);
async function seed(c,n){await base.admin(c);await c.query(`insert into file_uploads(id,workspace_id,original_name,display_name,file_extension,mime_type,storage_path,metadata_json) values($1::uuid,$2::uuid,'Synthetic','Synthetic','txt','text/plain','synthetic/'||$1::uuid::text,$3::jsonb)`,[file(n),A,JSON.stringify({latest_analysis_run_id:run(n),retained_history:{old_citation:'retained'}})]);await c.query(`insert into ai_agent_runs(id,workspace_id,agent_type,status,input_json,output_json) values($1,$2,'file_analysis','completed',$3::jsonb,$4::jsonb)`,[run(n),A,JSON.stringify({evidence_lineage:{source_file_id:file(n)}}),JSON.stringify({evidence_classification:'business_evidence',extraction_outcome:'facts_extracted'})]);}
async function fixture(c){
 await base.fixture(c);
 const source=read('202607060001_business_memory_evidence_index.sql'),high=read('20260819174100_security_high_findings_remediation.sql');
 await c.query(`alter table file_uploads add column processing_status text default 'uploaded',add column processing_error text,add column processed_at timestamptz,add column index_status text default 'not_indexed',add column indexed_at timestamptz,add column indexed_chunk_count integer default 0,add column index_error text;alter table ai_agent_runs add column if not exists archived_at timestamptz,add column if not exists deleted_at timestamptz;`);
 await c.query(ddl('file_processing_jobs',source));
 await c.query(ddl('business_memory_chunks',source).replace('extensions.vector(1536)','real[]'));
 await c.query(statement(/create unique index if not exists business_memory_chunks_source_hash_idx[\s\S]*?;/,source));
 for(const table of ['file_processing_jobs','business_memory_chunks'])await c.query(`alter table ${table} enable row level security;grant select,insert,update,delete on ${table} to authenticated;create policy "fixture ${table} member read" on ${table} for select to authenticated using(public.is_workspace_member(workspace_id));`);
 for(const name of ['file processing jobs contributors create','file processing jobs contributors update','business memory chunks contributors create','business memory chunks contributors update'])await c.query(statement(new RegExp('create policy "'+name+'"[\\s\\S]*?;'),high));
 await c.query(read('20261005022017_workspace_security_boundaries.sql'));
 await c.query(read(migration));
}
async function tests(c){
 await fixture(c);
 const fileSource=read('202606180004_files_imports.sql'),history=read('202606180005_file_kpi_historical_memory.sql');
 for(const [name,source] of [['kpis',read('202606180002_kpi_dashboard.sql')],['operational_metrics',fileSource],['file_imports',fileSource],['file_import_rows',fileSource]])await c.query(ddl(name,source));
 await c.query(history.slice(0,history.indexOf('alter table public.kpis')));
 for(const table of ['kpis','operational_metrics'])await c.query(statement(new RegExp('alter table public\\.'+table+'[\\s\\S]*?;'),history));
 for(const table of ['kpis','operational_metrics','file_imports','file_import_rows'])await c.query(`alter table ${table} enable row level security;grant select,insert,update,delete on ${table} to authenticated;create policy "${table} read fixture" on ${table} for select to authenticated using(public.is_workspace_member(workspace_id));create policy "${table} insert fixture" on ${table} for insert to authenticated with check(public.can_contribute_workspace(workspace_id));create policy "${table} update fixture" on ${table} for update to authenticated using(public.can_contribute_workspace(workspace_id)) with check(public.can_contribute_workspace(workspace_id));`);
 await c.query(read(importMigration));
 const imported=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`,row=n=>`bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12,'0')}`;
 const prepare=async n=>{await seed(c,n);await c.query(`insert into file_imports(id,workspace_id,file_upload_id,import_type,status,rows_total,mapping_json) values($1,$2,$3,'metrics','needs_review',1,$4::jsonb)`,[imported(n),A,file(n),JSON.stringify({mode:'workbook',preparation_id:'preparation-'+n})]);await c.query(`insert into file_import_rows(id,workspace_id,file_upload_id,import_id,import_type,row_number,data_json) values($1,$2,$3,$4,'metrics',2,'{"Value":100}')`,[row(n),A,file(n),imported(n)]);};
 const begin=(client,n,ids=[row(n)])=>client.query('select public.begin_file_import_attempt_v1($1,$2,$3,$4::jsonb,$5::uuid[]) value',[A,file(n),imported(n),JSON.stringify({metric:'Value'}),ids]).then(r=>r.rows[0].value);
 const reconcile=(client,n,failed=false)=>client.query('select public.reconcile_file_import_attempt_v1($1,$2,$3,$4) value',[A,file(n),imported(n),failed]).then(r=>r.rows[0].value);
 for(const n of [21,22,23,24,25,26,27,28,29])await prepare(n);
 await base.actor(c,1);const accepted=await begin(c,21);pass('operator first claim is durable before business writes',accepted.admitted,true);
 const retry=await begin(c,21);pass('lost claim acknowledgement never admits a second writer',retry.admitted,false);pass('claim retry reads the same durable attempt',retry.attempt_id,accepted.attempt_id);
 await base.admin(c);pass('ordinary caller cannot configure a private attempt',(await c.query("select has_table_privilege('authenticated','private.file_import_attempts','INSERT') yes")).rows[0].yes,false);await base.actor(c,1);
 await rejects('unresolved preparation generation cannot be overwritten',c.query(`update file_imports set mapping_json='{"preparation_id":"other"}' where id=$1`,[imported(21)]),'55000');
 await rejects('approved source row cannot be reparented away from held source',c.query('update file_import_rows set file_upload_id=$1 where id=$2',[file(22),row(21)]),'55000');
 await rejects('accepted import cannot be reparented away from held source',c.query('update file_imports set file_upload_id=$1 where id=$2',[file(22),imported(21)]),'55000');
 await rejects('new staging rows are rejected while accepted work is uncertain',c.query(`insert into file_import_rows(workspace_id,file_upload_id,import_id,import_type,row_number) values($1,$2,$3,'metrics',3)`,[A,file(21),imported(21)]),'55000');
 await rejects('new import record is rejected for the unresolved source',c.query(`insert into file_imports(workspace_id,file_upload_id,import_type,status) values($1,$2,'metrics','needs_review')`,[A,file(21)]),'55000');
 await rejects('approved source content cannot be rewritten',c.query(`update file_import_rows set data_json='{"Value":999}' where id=$1`,[row(21)]),'55000');
 // Actual independent writer commits one batch and loses its connection before
 // finalization: receipt survives without relying on process memory or timeout.
 const worker=await connect();await base.actor(worker,1);await worker.query(`insert into operational_metrics(workspace_id,source_file_id,import_id,import_row_id,metric_name,value,metric_date) values($1,$2,$3,$4,'Revenue',100,'2026-10-01')`,[A,file(21),imported(21),row(21)]);await worker.end();
 const partial=await reconcile(c,21,true);pass('terminated worker leaves truthful persisted record inventory',partial.metric_records,1);pass('partial accepted work becomes explicit reconciliation required',partial.status,'reconciliation_required');
 pass('partial worker cannot be silently retried',(await begin(c,21)).admitted,false);
 await c.query(`update file_imports set recovery_status='completed' where id=$1`,[imported(21)]);pass('client cannot forge completed recovery projection',(await c.query('select recovery_status from file_imports where id=$1',[imported(21)])).rows[0].recovery_status,'reconciliation_required');
 const racers=await Promise.all(Array.from({length:16},async()=>{const client=await connect();await base.actor(client,1);return client;}));
 const claims=await Promise.all(racers.map(client=>begin(client,22)));pass('sixteen independent import requests admit exactly one writer',claims.filter(x=>x.admitted).length,1);pass('all losing claims identify the same durable attempt',new Set(claims.map(x=>x.attempt_id)).size,1);
 // Complete business writes and public markers, then lose final acknowledgement.
 await begin(c,23);await c.query(`insert into operational_metrics(workspace_id,source_file_id,import_id,import_row_id,metric_name,value,metric_date) values($1,$2,$3,$4,'Revenue',100,'2026-10-01')`,[A,file(23),imported(23),row(23)]);
 await c.query(`update file_import_rows set status='imported' where id=$1;`,[row(23)]);await c.query(`update file_imports set status='completed',imported_at=now(),rows_imported=1 where id=$1`,[imported(23)]);await c.query(`update file_uploads set import_status='imported',metadata_json=metadata_json||jsonb_build_object('last_import',jsonb_build_object('import_id',$1::text,'imported_at',(select imported_at from file_imports where id=$1::uuid))) where id=$2`,[imported(23),file(23)]);
 const correctMarker=(await c.query('select metadata_json from file_uploads where id=$1',[file(23)])).rows[0].metadata_json;
 await c.query(`update file_uploads set metadata_json=jsonb_set(metadata_json,'{last_import,imported_at}','"2020-01-01T00:00:00Z"') where id=$1`,[file(23)]);
 pass('old file completion marker cannot confirm a newer import generation',(await reconcile(c,23)).status,'running');
 await c.query('update file_uploads set metadata_json=$1::jsonb where id=$2',[JSON.stringify(correctMarker),file(23)]);
 const finished=await reconcile(c,23);pass('saved completion can be recovered after acknowledgement loss',finished.status,'completed');pass('complete reconciliation never duplicates a business record',finished.metric_records,1);
 pass('completed claim replay cannot write another batch',(await begin(c,23)).admitted,false);
 // Explicit new preparation after completion is supported and keeps old rows.
 await c.query(`update file_imports set status='needs_review',mapping_json='{"mode":"workbook","preparation_id":"new-reviewed-generation"}' where id=$1`,[imported(23)]);
 const newRow=row(30);await c.query(`insert into file_import_rows(id,workspace_id,file_upload_id,import_id,import_type,row_number,data_json) values($1,$2,$3,$4,'metrics',3,'{"Value":200}')`,[newRow,A,file(23),imported(23)]);
 pass('completed source supports a separately reviewed preparation',(await begin(c,23,[newRow])).admitted,true);pass('repreparation preserves original accepted business rows',(await reconcile(c,23)).metric_records,1);
 await base.actor(c,2);await rejects('staff cannot approve import work',begin(c,24),'42501');
 await base.actor(c,3);await rejects('viewer cannot approve import work',begin(c,24),'42501');
 await base.actor(c,4);await rejects('foreign operator cannot claim another workspace',begin(c,24),'42501');
 await base.actor(c,1);await rejects('foreign row identity cannot enter an approved claim',begin(c,24,[row(25)]),'22023');
 await rejects('duplicate row IDs cannot inflate a claim',begin(c,24,[row(24),row(24)]),'22023');
 await base.admin(c);await c.query(`update workspaces set subscription_required=true,subscription_status='expired' where id=$1`,[A]);await base.actor(c,1);await rejects('expired workspace cannot start import writes',begin(c,24),'42501');
 pass('expired workspace retains readback recovery without new admission',(await reconcile(c,21)).metric_records,1);
 await base.admin(c);await c.query(`update workspaces set subscription_required=false,subscription_status='demo' where id=$1`,[A]);await base.actor(c,1);
 await begin(c,25);await c.query(`update file_imports set status='completed',imported_at=now() where id=$1`,[imported(25)]);await c.query(`update file_uploads set import_status='imported',metadata_json=metadata_json||jsonb_build_object('last_import',jsonb_build_object('import_id',$1::text,'imported_at',(select imported_at from file_imports where id=$1::uuid))) where id=$2`,[imported(25),file(25)]);
 pass('staged rows prevent a false completed reconciliation',(await reconcile(c,25,true)).status,'reconciliation_required');
 await base.actor(c,0,'anon');await rejects('anonymous cannot access attempt authority',begin(c,26),'42501');await base.actor(c,0,'service_role');await rejects('generic service role cannot invent user approval',begin(c,26),'42501');
 await require('./workspace-worksheet-publication-database-tests.cjs').qualify({c,base,read,A,B,file,prepare,imported,row,begin,reconcile,connect,pass,rejects});
 return {migration:importMigration,checks:checks.length,results:checks};
}

(async()=>{
 for(const name of ['DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','SUPABASE_TEST_DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN'])if(Object.hasOwn(process.env,name))throw new Error('inherited_database_or_credential_configuration_forbidden');
 if(!bin||!path.isAbsolute(bin)||!fs.existsSync(path.join(bin,'initdb')))throw new Error('explicit_local_postgres_bin_required');
 owned=fs.mkdtempSync('/tmp/vaeroex-import-sql-');fs.chmodSync(owned,0o700);const socket=path.join(owned,'socket');fs.mkdirSync(socket,{mode:0o700});
 command('initdb',['-D',path.join(owned,'data'),'--username=postgres','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
 command('pg_ctl',['-D',path.join(owned,'data'),'-l',path.join(owned,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c max_connections=24 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
 config={host:socket,port:5432,user:'postgres',database:'postgres'};const c=await connect();const observed=(await c.query("select current_setting('data_directory') d,current_setting('listen_addresses') a,inet_server_addr() ip")).rows[0];assert.equal(fs.realpathSync(observed.d),fs.realpathSync(path.join(owned,'data')));assert.equal(observed.a,'');assert.equal(observed.ip,null);
 console.log(JSON.stringify({scope:'Focused source SQL, real independent Postgres transactions; synthetic JWTs, vector represented as real[], no full Supabase/extraction-provider proof',...(await tests(c))},null,2));
})().catch(e=>{console.error(JSON.stringify({status:'failed',code:e.code||null,message:e.message,stack:e.stack,detail:e.detail,where:e.where,passed:checks.length}));process.exitCode=1;}).finally(async()=>{for(const c of clients)await c.end().catch(()=>{});if(started)command('pg_ctl',['-D',path.join(owned,'data'),'-m','fast','-w','stop']);});
