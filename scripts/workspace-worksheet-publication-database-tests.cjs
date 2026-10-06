/* eslint-disable @typescript-eslint/no-require-imports -- Isolated native SQL qualification module. */
// Called by workspace-import-attempt-database-tests.cjs in its owned Unix-only
// fixture. Vector representation/distance are stubbed; the SQL visibility and
// receipt authority are actual source, not a real pgvector ranking benchmark.
exports.qualify = async function({c,base,read,A,B,file,prepare,imported,row,begin,reconcile,connect,pass,rejects}) {
 await base.admin(c);
 await c.query("create schema if not exists extensions;create function public.fixture_worksheet_distance(real[],real[]) returns double precision language sql immutable as 'select 0.0::double precision';create operator public.<=> (leftarg=real[],rightarg=real[],function=public.fixture_worksheet_distance);");
 await c.query(read('20261005070311_worksheet_import_publication_heads.sql').replaceAll('extensions.vector(1536)','real[]'));
 for(const n of [41,42])await prepare(n);
 const legacy=(await c.query(`insert into business_memory_chunks(workspace_id,source_type,source_id,source_file_id,source_title,source_excerpt,chunk_index,content_hash,embedding,source_metadata) select $1,'file',$2,$2,'Prior worksheet','Legacy revenue100',n,md5(n::text),array[1,0]::real[],'{"indexing_method":"worksheet_import","evidence_classification":"business_evidence","extraction_outcome":"completed"}'::jsonb from generate_series(1,321)n returning id`,[A,file(41)])).rows.map(x=>x.id);
 const insertChunk=async(id,attempt,content)=> (await c.query(`insert into business_memory_chunks(workspace_id,source_type,source_id,source_file_id,source_title,source_excerpt,content_hash,embedding,source_metadata) values($1,'file',$2,$2,'Approved worksheet',$4,md5($3::text),array[1,0]::real[],jsonb_build_object('indexing_method','worksheet_import','import_attempt_id',$3::text,'evidence_classification','business_evidence','extraction_outcome','completed')) returning id`,[A,id,attempt,content])).rows[0].id;
 const heads=(client,ids=[file(41)])=>client.query('select * from public.get_worksheet_publication_heads_v1($1,$2::uuid[])',[A,ids]).then(r=>r.rows);
 const match=()=>c.query('select id from public.match_business_memory_chunks($1,array[1,0]::real[],20,0.1)',[A]).then(r=>r.rows.map(x=>x.id));
 await base.actor(c,1);pass('head RPC gives explicit legacy fallback row before first completed attempt',(await heads(c))[0].completed_attempt_id,null);
 const first=await begin(c,41),firstChunk=await insertChunk(file(41),first.attempt_id,'Current revenue200');
 pass('running first attempt never becomes committed head',(await heads(c))[0].completed_attempt_id,null);
 let found=await match();pass('direct vector retrieval excludes running attempt but retains legacy evidence',found.length===20&&found.every(id=>legacy.includes(id)),true);
 await reconcile(c,41,true);found=await match();pass('held failed attempt cannot enter direct vector retrieval',found.includes(firstChunk),false);
 await c.query(`update file_import_rows set status='imported' where id=$1`,[row(41)]);await c.query(`update file_imports set status='completed',imported_at=clock_timestamp(),rows_imported=1 where id=$1`,[imported(41)]);await c.query(`update file_uploads set import_status='imported',metadata_json=jsonb_build_object('last_import',jsonb_build_object('import_id',$1::text,'imported_at',(select imported_at from file_imports where id=$1::uuid))) where id=$2`,[imported(41),file(41)]);
 await reconcile(c,41);pass('completed private receipt selects first durable publication',(await heads(c))[0].completed_attempt_id,first.attempt_id);
 pass('direct vector SQL excludes all321 stale old chunks before rank limit',await match(),[firstChunk]);
 pass('historical321 citation IDs remain directly readable',(await c.query('select count(*)::integer n from business_memory_chunks where id=any($1::uuid[])',[legacy])).rows[0].n,321);
 await c.query(`update file_imports set status='needs_review',mapping_json='{"preparation_id":"second-generation"}' where id=$1`,[imported(41)]);
 const nextRow=row(43);await c.query(`insert into file_import_rows(id,workspace_id,file_upload_id,import_id,import_type,row_number,data_json) values($1,$2,$3,$4,'metrics',3,'{"Value":300}')`,[nextRow,A,file(41),imported(41)]);
 const second=await begin(c,41,[nextRow]);const secondChunk=await insertChunk(file(41),second.attempt_id,'Pending revenue300');
 pass('new preparation cannot regress the completed head',(await heads(c))[0].completed_attempt_id,first.attempt_id);
 pass('older completed generation remains eligible while next attempt runs',await match(),[firstChunk]);await reconcile(c,41,true);
 pass('older completed evidence survives held next attempt',await match(),[firstChunk]);
 // A completion held in one transaction remains invisible to another session.
 const observer=await connect();await base.actor(observer,1);await c.query('begin');await c.query(`update file_import_rows set status='imported' where id=$1`,[nextRow]);await c.query(`update file_imports set status='completed',imported_at=clock_timestamp() where id=$1`,[imported(41)]);await c.query(`update file_uploads set metadata_json=jsonb_build_object('last_import',jsonb_build_object('import_id',$1::text,'imported_at',(select imported_at from file_imports where id=$1::uuid))) where id=$2`,[imported(41),file(41)]);await reconcile(c,41);
 pass('uncommitted completion is not visible to another actual session',(await heads(observer))[0].completed_attempt_id,first.attempt_id);await c.query('commit');
 pass('committed completion advances head once',(await heads(observer))[0].completed_attempt_id,second.attempt_id);pass('direct vector retrieval switches to complete new generation',await match(),[secondChunk]);await reconcile(c,41);
 pass('completion replay cannot reorder the publication head',(await heads(c))[0].completed_attempt_id,second.attempt_id);
 await base.actor(c,3);pass('viewer retains read-only completed-head access',(await heads(c))[0].completed_attempt_id,second.attempt_id);
 await base.actor(c,2);pass('staff retains read-only completed-head access',(await heads(c))[0].completed_attempt_id,second.attempt_id);
 await base.actor(c,4);await rejects('foreign member cannot query another workspace publication authority',heads(c),'42501');
 await base.actor(c,1);pass('requested foreign or nonexistent file produces no leaked head',await heads(c,['ffffffff-ffff-4fff-8fff-ffffffffffff']),[]);
 pass('duplicate requested file IDs return exactly one authority row',(await heads(c,[file(41),file(41)])).length,1);
 pass('empty request has explicit empty output',await heads(c,[]),[]);
 await rejects('null requested file array fails closed',heads(c,null),'22023');await rejects('more than200 requested IDs are rejected',heads(c,Array(201).fill(file(41))),'22023');
 await base.admin(c);await c.query(`update workspaces set subscription_required=true,subscription_status='expired' where id=$1`,[A]);await base.actor(c,1);pass('expired workspace retains read-only committed evidence authority',(await heads(c))[0].completed_attempt_id,second.attempt_id);
 await base.actor(c,0,'anon');await rejects('anonymous cannot read publication heads',heads(c),'42501');await base.actor(c,0,'service_role');pass('trusted service client preserves existing workspace read capability',(await heads(c))[0].completed_attempt_id,second.attempt_id);
 await base.admin(c);pass('head RPC does not grant private schema usage to authenticated or service',(await c.query("select has_schema_privilege('authenticated','private','USAGE') a,has_schema_privilege('service_role','private','USAGE') s")).rows[0],{a:false,s:false});
};
