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
const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
const ddl=(name,s)=>{const m=s.match(new RegExp('create table (?:if not exists )?public\\.'+name+' \\([\\s\\S]*?\\n\\);'));assert(m);return m[0];};
const statement=(re,s)=>{const m=s.match(re);assert(m);return m[0];};
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
 await fixture(c);await seed(c,1);
 await c.query(`insert into business_memory_chunks(workspace_id,source_type,source_id,source_file_id,source_title,source_excerpt,content_hash,chunk_index,source_metadata) select $1,'file_analysis',$2,$2,'Legacy citation','Legacy content',i::text,i,jsonb_build_object('run_id','historical-run') from generate_series(1,1205) i`,[A,file(1)]);
 await base.actor(c,1); const first=await invoke(c,1);pass('first confirmed publication admits one bounded chunk',first.indexed_chunks,1);
 pass('all1205 old chunks are archived without deletion',(await c.query(`select count(*)::int n from business_memory_chunks where source_file_id=$1 and archived_at is not null and source_metadata->>'run_id'='historical-run'`,[file(1)])).rows[0].n,1205);
 pass('historical source metadata survives atomic merge',(await c.query('select metadata_json from file_uploads where id=$1',[file(1)])).rows[0].metadata_json.retained_history,{old_citation:'retained'});
 // Treat the first successful server commit as an acknowledgement lost in transit.
 const replay=await invoke(c,1);pass('lost acknowledgement retry returns the original citation IDs',replay.chunk_ids,first.chunk_ids);pass('receipt records replay without duplicating job',replay.replayed,true);
 pass('replay does not create another completed job',(await c.query('select count(*)::int n from file_processing_jobs where file_upload_id=$1',[file(1)])).rows[0].n,1);
 await rejects('same run cannot relabel committed content',invoke(c,1,{rows:payload('Changed')}),'40001');
 await c.query('update business_memory_chunks set archived_at=now() where id=$1',[first.chunk_ids[0]]);
 await rejects('retry does not revive deliberately archived memory',invoke(c,1),'40001');
 for(const n of [2,3,4,5,6,7,8,9])await seed(c,n);
 await base.actor(c,2);await rejects('staff cannot elevate to operator confirmation',invoke(c,2,{actor:user(2)}),'42501');
 await base.actor(c,3);await rejects('viewer cannot confirm publication',invoke(c,2,{actor:user(3)}),'42501');
 await base.actor(c,4);await rejects('foreign workspace operator cannot publish',invoke(c,2,{actor:user(4)}),'42501');
 await base.actor(c,1);await rejects('actor identity cannot be forged',invoke(c,2,{actor:user(4)}),'42501');
 await rejects('a run from another source cannot be attached',invoke(c,2,{run:run(3)}),'40001');
 await base.admin(c);await c.query('update ai_agent_runs set input_json=$1::jsonb where id=$2',[JSON.stringify({evidence_lineage:{source_file_id:file(3)}}),run(2)]);await base.actor(c,1);
 await rejects('current metadata alone cannot forge run-to-file lineage',invoke(c,2),'42501');
 await base.admin(c);await c.query(`update ai_agent_runs set output_json='{}' where id=$1`,[run(3)]);await base.actor(c,1);
 await rejects('ineligible current source run denied',invoke(c,3),'42501');
 await base.admin(c);await c.query(`update file_uploads set deleted_at=now() where id=$1`,[file(4)]);await base.actor(c,1);
 await rejects('withdrawn source denied at commit',invoke(c,4),'42501');
 await base.admin(c);await c.query(`update workspaces set subscription_required=true,subscription_status='expired' where id=$1`,[A]);await base.actor(c,1);
 await rejects('subscription expiry denies publication through retained RLS',invoke(c,5),'42501');
 await base.admin(c);await c.query(`update workspaces set subscription_required=false,subscription_status='demo' where id=$1`,[A]);
 await c.query(`insert into business_memory_chunks(workspace_id,source_type,source_id,source_file_id,source_title,source_excerpt,content_hash,source_metadata) values($1,'file_analysis',$2,$2,'Previous approved','Previous approved evidence','old5','{"run_id":"original-run"}')`,[A,file(5)]);
 // Failure after chunk insert and retirement proves all operations roll back.
 await c.query(`create function public.synthetic_publication_job_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic post-publication failure' using errcode='P0001';end;$$;create trigger synthetic_publication_job_failure before insert on file_processing_jobs for each row execute function public.synthetic_publication_job_failure();`);
 await base.actor(c,1);await rejects('post-publication job failure rolls back complete transaction',invoke(c,5),'P0001');
 pass('rolled-back replacement retains only prior memory',(await c.query('select count(*)::int n from business_memory_chunks where source_file_id=$1',[file(5)])).rows[0].n,1);
 pass('failed transaction does not retire previously approved memory',(await c.query('select archived_at from business_memory_chunks where source_file_id=$1',[file(5)])).rows[0].archived_at,null);
 pass('rolled-back source receipt is absent',(await c.query('select metadata_json ? \'business_memory\' yes from file_uploads where id=$1',[file(5)])).rows[0].yes,false);
 await base.admin(c);await c.query('drop trigger synthetic_publication_job_failure on file_processing_jobs');
 // Same request concurrency creates one commit and fifteen durable replays.
 const racers=await Promise.all(Array.from({length:16},async()=>{const client=await connect();await base.actor(client,1);return client;}));
 const same=await Promise.all(racers.map(client=>invoke(client,6)));pass('sixteen independent approvals create one publication',same.filter(x=>!x.replayed).length,1);
 pass('sixteen requests share the exact citation identity',new Set(same.map(x=>x.chunk_ids[0])).size,1);
 // A newer analysis holds the source lock while an older approval queues.
 await base.admin(c);await c.query('begin');await c.query(`update file_uploads set metadata_json=metadata_json||jsonb_build_object('latest_analysis_run_id',$1::text) where id=$2`,[run(8),file(7)]);
 const waiting=invoke(racers[0],7);await c.query('commit');await rejects('waiting stale analysis cannot replace a newer source generation',waiting,'40001');
 // Revoking an operator while it waits must be visible before admission.
 await base.admin(c);await c.query('begin');await c.query('select id from file_uploads where id=$1 for update',[file(9)]);
 const revoked=invoke(racers[1],9);await c.query(`update workspace_members set status='disabled' where workspace_id=$1 and user_id=$2`,[A,user(1)]);await c.query('commit');
 await rejects('membership revoked before publication is denied',revoked,'42501');
 await base.admin(c);await c.query(`update workspace_members set status='active' where workspace_id=$1 and user_id=$2`,[A,user(1)]);
 await seed(c,10);await base.actor(c,1);const original=await invoke(c,10);
 await base.admin(c);await c.query(`insert into ai_agent_runs(id,workspace_id,agent_type,status,input_json,output_json) select $1,workspace_id,agent_type,status,input_json,output_json from ai_agent_runs where id=$2`,[run(11),run(10)]);
 await c.query(`update file_uploads set metadata_json=metadata_json||jsonb_build_object('latest_analysis_run_id',$1::text) where id=$2`,[run(11),file(10)]);await base.actor(c,1);
 const newer=await invoke(c,10,{run:run(11)});pass('same source text in a newer run receives a new citation ID',newer.chunk_ids[0]!==original.chunk_ids[0]);
 const historical=(await c.query('select source_metadata,archived_at from business_memory_chunks where id=$1',[original.chunk_ids[0]])).rows[0];
 pass('new run never rewrites the older citation provenance',historical.source_metadata.run_id,run(10));pass('older immutable citation is archived not deleted',Boolean(historical.archived_at));
 await seed(c,12);await base.actor(c,1);await c.query('begin isolation level repeatable read');await c.query('select id from file_uploads where id=$1',[file(12)]);
 await invoke(racers[2],12);await rejects('repeatable-read loser fails safely after another publication',invoke(c,12),'40001');await c.query('rollback');
 await seed(c,14);await base.admin(c);await c.query("update file_uploads set processing_status='processing' where id=$1",[file(14)]);await base.actor(c,1);await rejects('processing a newer analysis cannot be cleared by old approval',invoke(c,14),'40001');
 await seed(c,13);await base.actor(c,1);const bad=payload().concat([{...payload()[0],confidence_score:101}]);
 await rejects('invalid second chunk rolls back the earlier chunk',invoke(c,13,{rows:bad}),'23514');pass('partial chunk batch persists no rows',(await c.query('select count(*)::int n from business_memory_chunks where source_file_id=$1',[file(13)])).rows[0].n,0);
 await base.actor(c,0,'anon');await rejects('anonymous RPC execution denied',invoke(c,5),'42501');
 await base.actor(c,0,'service_role');await rejects('generic service caller cannot bypass confirmed actor RPC',invoke(c,5),'42501');
 return {migration,checks:checks.length,results:checks};
}
(async()=>{
 for(const name of ['DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','SUPABASE_TEST_DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN'])if(Object.hasOwn(process.env,name))throw new Error('inherited_database_or_credential_configuration_forbidden');
 if(!bin||!path.isAbsolute(bin)||!fs.existsSync(path.join(bin,'initdb')))throw new Error('explicit_local_postgres_bin_required');
 owned=fs.mkdtempSync('/tmp/vaeroex-memory-sql-');fs.chmodSync(owned,0o700);const socket=path.join(owned,'socket');fs.mkdirSync(socket,{mode:0o700});
 command('initdb',['-D',path.join(owned,'data'),'--username=postgres','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
 command('pg_ctl',['-D',path.join(owned,'data'),'-l',path.join(owned,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c max_connections=24 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
 config={host:socket,port:5432,user:'postgres',database:'postgres'};const c=await connect();const observed=(await c.query("select current_setting('data_directory') d,current_setting('listen_addresses') a,inet_server_addr() ip")).rows[0];assert.equal(fs.realpathSync(observed.d),fs.realpathSync(path.join(owned,'data')));assert.equal(observed.a,'');assert.equal(observed.ip,null);
 console.log(JSON.stringify({scope:'Focused source SQL, real independent Postgres transactions; synthetic JWTs, vector represented as real[], no full Supabase/extraction-provider proof',...(await tests(c))},null,2));
})().catch(e=>{console.error(JSON.stringify({status:'failed',code:e.code||null,message:e.message,detail:e.detail,where:e.where,passed:checks.length}));process.exitCode=1;}).finally(async()=>{for(const c of clients)await c.end().catch(()=>{});if(started)command('pg_ctl',['-D',path.join(owned,'data'),'-m','fast','-w','stop']);});
