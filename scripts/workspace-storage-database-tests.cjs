/* eslint-disable @typescript-eslint/no-require-imports -- Disposable PostgreSQL qualification harness. */
// Real SQL/locking tests using synthetic fixtures. Never accepts a remote DSN;
// does not claim to qualify Storage HTTP or Stripe provider behavior.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const root=path.resolve(__dirname,'..'),bin=process.env.WORKSPACE_STORAGE_PG_BIN;
assert(bin&&path.isAbsolute(bin),'Set WORKSPACE_STORAGE_PG_BIN to an existing PostgreSQL bin directory.');
const read=n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'vaeroex-storage-db-'));fs.chmodSync(work,0o700);
const A=randomUUID(),B=randomUUID(),C=randomUUID(),owner=randomUUID(),other=randomUUID(),viewer=randomUUID();
const clients=[],results=[];let started=false,maximumQualification=null,maximumWorkspace=null;
function cmd(name,args){const r=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:90000,maxBuffer:2**20});assert.equal(r.status,0,`${name}: ${r.stderr}`);return r.stdout;}
async function connect(){const c=new Client({host:work,port:55331,user:'postgres',database:'postgres',ssl:false,statement_timeout:20000});await c.connect();clients.push(c);return c;}
async function actor(c,id=owner,role='authenticated'){await c.query('reset role');await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[id||'',role]);await c.query(`set role ${role==='postgres'?'postgres':role}`);}
function ok(name,a,b){assert.deepEqual(a,b,name);results.push(name);}
async function denied(name,fn,code='23514'){try{await fn();assert.fail(`${name}: unexpectedly allowed`);}catch(e){ok(name,e.code,code);}}
const reserve=(c,workspace=A,bytes=1,request=randomUUID())=>c.query('select public.reserve_workspace_upload_v1($1,$2,$3,$4,$5,$6,null,$7) v',[workspace,request,'synthetic.csv','csv','text/csv',bytes,'Synthetic file']).then(r=>r.rows[0].v);
const inspect=(c,r,workspace=A,who=owner)=>c.query('select public.inspect_workspace_upload_v1($1,$2,$3) v',[workspace,r.reservation_id,who]).then(r=>r.rows[0].v);
const object=(c,r,bytes=r.bytes)=>c.query("insert into storage.objects(bucket_id,name,metadata) values('workspace-files',$1,jsonb_build_object('size',$2::bigint))",[r.storage_path,bytes]);
const finalize=(c,r,workspace=A,who=owner)=>c.query('select public.finalize_workspace_upload_v1($1,$2,$3) v',[workspace,r.reservation_id,who]).then(r=>r.rows[0].v);
async function fixture(c){
 await c.query(`create role authenticated;create role anon;create role service_role bypassrls;
 create schema auth;create schema private;create schema storage;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table public.profiles(id uuid primary key);
 create table public.workspaces(id uuid primary key,name text not null);
 create table public.workspace_members(workspace_id uuid references public.workspaces,user_id uuid references auth.users,status text default 'active',role text);
 create table public.customer_subscriptions(workspace_id uuid,stripe_customer_id text,created_at timestamptz default now());
 create table public.record_folders(id uuid primary key,workspace_id uuid references public.workspaces,collection_type text);
 create function public.can_contribute_workspace(w uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.workspace_members where workspace_id=w and user_id=auth.uid() and status='active' and role in ('owner','admin','manager','staff'))$$;
 create function private.workspace_entitlement_active_v1(w uuid) returns boolean language sql stable as $$select true$$;
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,version text,unique(bucket_id,name));
 create table public.business_memory_chunks(id uuid primary key default gen_random_uuid(),workspace_id uuid,source_file_id uuid,archived_at timestamptz,deleted_at timestamptz,updated_at timestamptz);
 grant usage on schema public,auth,storage to authenticated,service_role;
 grant execute on all functions in schema auth to authenticated,service_role;`);
 const files=read('202606180004_files_imports.sql').match(/create table if not exists public\.file_uploads \([\s\S]*?\n\);/)[0];await c.query(files);
 await c.query(`create function private.placeholder_file_limit() returns trigger language plpgsql as $$begin return new;end$$;
 create trigger workspace_persisted_usage_limit before insert on public.file_uploads for each row execute function private.placeholder_file_limit();
 alter table public.file_uploads enable row level security;
 create policy test_read on public.file_uploads for select to authenticated using(exists(select 1 from workspace_members where workspace_id=file_uploads.workspace_id and user_id=auth.uid() and status='active'));
 create policy test_write on public.file_uploads for all to authenticated using(public.can_contribute_workspace(workspace_id)) with check(public.can_contribute_workspace(workspace_id));
 grant select,insert,update,delete on public.file_uploads,public.workspace_members,public.business_memory_chunks to authenticated;
 grant select,insert,update,delete on all tables in schema public,storage to service_role;
 grant select,insert,update,delete on storage.objects to authenticated;
 alter table storage.objects enable row level security;
 create policy object_members on storage.objects to authenticated using(exists(select 1 from workspace_members where workspace_id::text=split_part(name,'/',1) and user_id=auth.uid())) with check(exists(select 1 from workspace_members where workspace_id::text=split_part(name,'/',1) and user_id=auth.uid()));`);
 await c.query('insert into auth.users(id) select unnest($1::uuid[])',[[owner,other,viewer]]);
 await c.query('insert into profiles(id) select id from auth.users');
 await c.query('insert into workspaces(id,name) select id,\'Synthetic\' from unnest($1::uuid[]) id',[[A,B,C]]);
 await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner'),($3,$4,'owner'),($1,$5,'viewer'),($6,$2,'owner')",[A,owner,B,other,viewer,C]);
 // Original history and missing metadata are present before the migration.
 for(const [name,deleted,present] of [['legacy',true,true],['missing',false,false]]){
 const id=randomUUID(),p=A+'/'+name;await c.query("insert into file_uploads(id,workspace_id,original_name,display_name,file_extension,mime_type,file_size_bytes,storage_path,created_by,deleted_at) values($1,$2,$3,$3,'csv','text/csv',10,$4,$5,case when $6 then now()-interval '2 years' end)",[id,A,name,p,owner,deleted]);
 if(present)await c.query("insert into storage.objects(bucket_id,name,metadata) values('workspace-files',$1,'{\"size\":10}')",[p]);
 }
 await c.query(read('20261012003846_workspace_storage_capacity.sql'));
 await c.query(read('20261012003920_workspace_storage_capacity_billing.sql'));
 await c.query(read('20261012013508_workspace_storage_invoice_capacity.sql'));
 await c.query(read('202607110002_business_signal_lifecycle_integrity.sql').slice(read('202607110002_business_signal_lifecycle_integrity.sql').indexOf('create or replace function public.update_source_file_lifecycle(')));
}
async function qualifyMaximum(c,workspace){ maximumWorkspace=workspace;
 const startedAt=Date.now();
 await actor(c,null,'postgres');
 // Synthetic bulk fixture represents 5496 existing 20 MB originals. It uses
 // reserved immutable paths and the production object/file guards; the final
 // concurrent admissions below use the actual customer RPCs.
 await c.query(`insert into private.workspace_upload_reservations(workspace_id,request_id,actor_id,storage_path,original_name,display_name,extension,mime_type,requested_bytes)
  select '${workspace}',gen_random_uuid(),'${owner}','${workspace}/reserved/'||gen_random_uuid()||'.csv','Synthetic bound.csv','Synthetic bound','csv','text/csv',20000000 from generate_series(1,5496);
  insert into storage.objects(bucket_id,name,metadata) select 'workspace-files',storage_path,'{"size":20000000}' from private.workspace_upload_reservations where workspace_id='${workspace}';
  update private.workspace_upload_reservations set state='committing' where workspace_id='${workspace}';
  insert into file_uploads(id,workspace_id,original_name,display_name,file_extension,mime_type,file_size_bytes,storage_bucket,storage_path,created_by)
   select file_id,workspace_id,original_name,display_name,extension,mime_type,requested_bytes,'workspace-files',storage_path,actor_id from private.workspace_upload_reservations where workspace_id='${workspace}';
  update private.workspace_upload_reservations set state='completed' where workspace_id='${workspace}';`);
 await actor(c);
 const workers=await Promise.all(Array.from({length:5},()=>connect()));await Promise.all(workers.map(x=>actor(x)));
 const slotRace=await Promise.allSettled(workers.map(x=>reserve(x,workspace,1)));
 ok('5500-file paid operating bound admits exactly four of five concurrent uploads',slotRace.filter(x=>x.status==='fulfilled').length,4);
 ok('fifth simultaneous upload blocked at qualified file ceiling',slotRace.find(x=>x.status==='rejected').reason.message,'workspace_file_slots_reached');
 for(const x of slotRace.filter(x=>x.status==='fulfilled')){await actor(c,owner,'service_role');await object(c,x.value);await finalize(c,x.value,workspace);}
 ok('5500 source originals committed at qualified file ceiling',(await c.query('select count(*)::int n from file_uploads where workspace_id=$1 and deleted_at is null',[workspace])).rows[0].n,5500);
 await actor(c,null,'postgres');
 // Trash retains all slots, so restoring an existing original never needs
 // additional capacity. Permanent deletion frees slots for the byte race.
 const ids=(await c.query('select id from file_uploads where workspace_id=$1 order by id limit 6',[workspace])).rows.map(x=>x.id);
 await c.query('update file_uploads set deleted_at=now() where id=any($1::uuid[])',[ids]);
 await actor(c);ok('Trash retains all 5500 slots at the qualified maximum',(await c.query('select workspace_storage_usage_v1($1) v',[workspace])).rows[0].v.used_files,5500);
 await c.query("select update_source_file_lifecycle($1,$2,'restore')",[workspace,ids[5]]);
 ok('restore succeeds at full retained-file allowance',true,true);
 await c.query("select update_source_file_lifecycle($1,$2,'delete')",[workspace,ids[5]]);
 await actor(c,owner,'service_role');
 for(const id of ids.slice(0,5)){
  const p=(await c.query('select mark_workspace_file_purge_v1($1,$2,$3) v',[workspace,id,owner])).rows[0].v;
  await c.query('delete from storage.objects where name=$1',[p.storage_path]);
  await c.query('select finalize_workspace_file_purge_v1($1,$2)',[workspace,id]);
 }
 await actor(c,null,'postgres');
 const currentBytes=Number((await c.query("select used_bytes from private.workspace_storage_counts_v1($1)",[workspace])).rows[0].used_bytes);
 await c.query('alter table storage.objects disable trigger workspace_original_admission');
 await c.query("insert into storage.objects(bucket_id,name,metadata) values('workspace-files',$1,jsonb_build_object('size',$2::bigint))",[workspace+'/synthetic-historical-bound',115000000000-currentBytes-4]);
 await c.query('alter table storage.objects enable trigger workspace_original_admission');
 const bytesRace=await Promise.allSettled(workers.map(x=>reserve(x,workspace,1)));
 ok('115 GB paid byte bound admits exactly four of five concurrent uploads',bytesRace.filter(x=>x.status==='fulfilled').length,4);
 ok('fifth concurrent byte rejected at 115 GB including reservations',bytesRace.find(x=>x.status==='rejected').reason.message,'workspace_storage_bytes_reached');
 await actor(c);
 const measure=Date.now();const usage=(await c.query('select workspace_storage_usage_v1($1) v',[workspace])).rows[0].v;const duration=Date.now()-measure;
 ok('qualified usage meters original plus Trash and reserved bytes',usage.used_bytes+usage.reserved_bytes,115000000000);
 ok('qualified large-file list bounded to fifty',usage.largest_files.length,50);
 const trash=(await c.query('select workspace_storage_trash_v1($1,1) v',[workspace])).rows[0].v;ok('qualified Trash page excludes permanently purged originals',trash.total,1);
 // Budget is deliberately generous enough for supported local test hosts; it
 // catches accidental per-file round trips while reporting exact measurement.
 ok('5500 file usage query below 5 second local qualification budget',duration<5000,true);
 maximumQualification={fileSlots:5500,bytes:115000000000,concurrentWriters:5,usageQueryMilliseconds:duration,totalMilliseconds:Date.now()-startedAt,syntheticMetadata:true};
 await actor(c);
}

async function run(c){
 await fixture(c);await actor(c);
 let usage=(await c.query('select workspace_storage_usage_v1($1) v',[A])).rows[0].v;
 ok('per-workspace included allowance is decimal 15 GB/500', [usage.included_bytes,usage.included_files,usage.allowance_bytes],[15000000000,500,15000000000]);
 ok('historical Trash protected and missing original reconciled',[usage.historical_trash.files,usage.missing_files,usage.used_files,usage.used_bytes],[1,1,1,10]);
 await denied('cross-workspace usage rejected',()=>c.query('select workspace_storage_usage_v1($1)',[B]),'42501');
 await denied('cross-workspace reservation rejected',()=>reserve(c,B), '42501');
 await actor(c,viewer);await denied('viewer cannot reserve',()=>reserve(c),'42501');await actor(c);
 const request=randomUUID(),r=await reserve(c,A,17,request);ok('reservation retries idempotent',(await reserve(c,A,17,request)).reservation_id,r.reservation_id);
 await denied('reservation request cannot change bytes',()=>reserve(c,A,18,request));
 await denied('unreserved Storage write blocked',()=>object(c,{storage_path:A+'/direct',bytes:1}));
 await denied('under-declared object bytes blocked',()=>object(c,r,18));
 await c.query('begin');await c.query("insert into storage.objects(bucket_id,name) values('workspace-files',$1)",[r.storage_path]);await c.query('rollback');ok('Storage permission probe accepted only with a live reservation',true,true);
 await object(c,r);
 await denied('client cannot finalize unvalidated upload',()=>finalize(c,r),'42501');
 await actor(c,owner,'service_role');ok('inspect returns immutable server details',(await inspect(c,r)).display_name,'Synthetic file');
 let committed=await finalize(c,r);ok('commit gives reserved file id',committed.file_id,r.file_id);
 ok('duplicate complete is idempotent',(await finalize(c,r)).file_id,r.file_id);
 await denied('immutable source cannot be overwritten',()=>c.query('update storage.objects set version=$1 where name=$2',[randomUUID(),r.storage_path]));
 await denied('active object cannot be deleted',()=>c.query('delete from storage.objects where name=$1',[r.storage_path]),'42501');
 await actor(c);
 await denied('direct file metadata insert cannot bypass quota',()=>c.query("insert into file_uploads(workspace_id,original_name,display_name,file_extension,mime_type,file_size_bytes,storage_path,created_by) values($1,'x','x','csv','text/csv',1,$2,$3)",[A,A+'/rogue',owner]));
 await actor(c,null,'postgres');await c.query("update workspace_members set role='staff' where workspace_id=$1 and user_id=$2",[A,viewer]);
 await actor(c,viewer);await denied('staff direct REST cannot bypass manager-only retention',()=>c.query('update file_uploads set deleted_at=now() where id=$1',[r.file_id]),'42501');
 await actor(c);await c.query("select update_source_file_lifecycle($1,$2,'delete')",[A,r.file_id]);
 let f=(await c.query('select * from file_uploads where id=$1',[r.file_id])).rows[0];
 ok('future Trash receives exactly 30 days',Math.round((f.trash_purge_after-f.deleted_at)/86400000),30);
 usage=(await c.query('select workspace_storage_usage_v1($1) v',[A])).rows[0].v;
 ok('Trash retains both original slots and bytes',[usage.used_files,usage.used_bytes,usage.trash.files],[2,27,1]);
 await denied('client cannot rewrite Trash retention',()=>c.query("update file_uploads set trash_purge_after=now() where id=$1",[r.file_id]),'42501');
 await denied('client cannot postpone cleanup by forging attempt timestamps',()=>c.query("update file_uploads set storage_purge_attempted_at=now()+interval '10 years' where id=$1",[r.file_id]),'42501');
 await c.query("select update_source_file_lifecycle($1,$2,'restore')",[A,r.file_id]);
 ok('restore does not change retained file slot count',(await c.query('select workspace_storage_usage_v1($1) v',[A])).rows[0].v.used_files,2);
 await c.query("select update_source_file_lifecycle($1,$2,'delete')",[A,r.file_id]);
 await actor(c,owner,'service_role');
 await denied('cross-workspace purge rejected',()=>c.query('select mark_workspace_file_purge_v1($1,$2,$3)',[B,r.file_id,owner]),'42501');
 await denied('legacy Trash cannot be purged',()=>c.query("select mark_workspace_file_purge_v1($1,(select id from file_uploads where original_name='legacy'),$2)",[A,owner]));
 await c.query('select mark_workspace_file_purge_v1($1,$2,$3)',[A,r.file_id,owner]);
 await actor(c);ok('largest files show durable pending deletion',(await c.query('select workspace_storage_usage_v1($1) v',[A])).rows[0].v.largest_files.find(f=>f.id===r.file_id).deletion_pending,true);await actor(c,owner,'service_role');
 ok('purge remains pending while actual object exists',(await c.query('select finalize_workspace_file_purge_v1($1,$2) v',[A,r.file_id])).rows[0].v,false);
 await c.query('delete from storage.objects where name=$1',[r.storage_path]);
 ok('confirmed object deletion releases quota',(await c.query('select finalize_workspace_file_purge_v1($1,$2) v',[A,r.file_id])).rows[0].v,true);
 await actor(c);await denied('customer cannot cascade-delete purged source metadata',()=>c.query('delete from file_uploads where id=$1',[r.file_id]),'42501');
 await actor(c,owner,'service_role');
 await denied('signed upload tombstone prevents resurrection',()=>object(c,r));
 await actor(c);await denied('purged original cannot be restored',()=>c.query("select update_source_file_lifecycle($1,$2,'restore')",[A,r.file_id]));
 // An expired upload token cannot create an object, and aborted objects are still charged until removed.
 const abandoned=await reserve(c,A,29);await object(c,abandoned);await actor(c,owner,'service_role');
 await c.query('select abort_workspace_upload_v1($1,$2,$3)',[A,abandoned.reservation_id,owner]);
 const cleanup=(await c.query('select workspace_storage_cleanup_batch_v1() v')).rows[0].v;
 ok('abandoned object enters cleanup',cleanup.uploads.some(x=>x.id===abandoned.reservation_id),true);
 await c.query('delete from storage.objects where name=$1',[abandoned.storage_path]);
 await denied('aborted upload cannot resurrect',()=>object(c,abandoned));
 await actor(c);const expired=await reserve(c,A,1);await actor(c,null,'postgres');
 await c.query("update private.workspace_upload_reservations set expires_at=now()-interval '1 minute' where id=$1",[expired.reservation_id]);
 await actor(c,owner,'service_role');await denied('expired signed token rejected',()=>object(c,expired));
 await actor(c);const boundary=await reserve(c,A,26214400);ok('25 MiB reservation accepted',boundary.bytes,26214400);
 await denied('file above 25 MiB rejected',()=>reserve(c,A,26214401),'22023');await actor(c,owner,'service_role');await c.query('select abort_workspace_upload_v1($1,$2,$3)',[A,boundary.reservation_id,owner]);
 // Separate workspace has all 500 slots available, independent of A.
 await actor(c);const cleanups=[await reserve(c,A,3),await reserve(c,A,4)];
 for(const q of cleanups){await object(c,q);await actor(c,owner,'service_role');await c.query('select abort_workspace_upload_v1($1,$2,$3)',[A,q.reservation_id,owner]);await actor(c);}
 await actor(c,owner,'service_role');
 const firstBatch=(await c.query('select workspace_storage_cleanup_batch_v1(1) v')).rows[0].v;
 const nextBatch=(await c.query('select workspace_storage_cleanup_batch_v1(1) v')).rows[0].v;
 ok('failed cleanup cannot starve another abandoned upload',firstBatch.uploads[0].id!==nextBatch.uploads[0].id,true);
 for(const q of cleanups)await c.query('delete from storage.objects where name=$1',[q.storage_path]);
 await actor(c,other);ok('second workspace receives full independent allowance',(await c.query('select workspace_storage_usage_v1($1) v',[B])).rows[0].v.available_files,500);
 await actor(c);
 // Fill C with reservations using actual admission RPC. Verify last slot race.
 for(let i=0;i<499;i++)await reserve(c,C,1);
 const d=await connect();await actor(d);const start=Date.now();
 const raced=await Promise.allSettled([reserve(c,C,1),reserve(d,C,1)]);
 ok('concurrent last-slot admission yields one winner',raced.map(x=>x.status).sort(),['fulfilled','rejected']);
 ok('concurrent last-slot loser is quota error',raced.find(x=>x.status==='rejected').reason.message,'workspace_file_slots_reached');
 usage=(await c.query('select workspace_storage_usage_v1($1) v',[C])).rows[0].v;ok('reserved slots cannot oversubscribe',usage.reserved_files,500);
 // A snapshot transaction that started before a concurrent writer must retry.
 await c.query('begin isolation level repeatable read');await c.query('select count(*) from file_uploads');await reserve(d,A,1);
 await denied('repeatable-read admission forces retry',()=>reserve(c,A,1),'40001');await c.query('rollback');
 // Meter byte boundary with synthetic historical object; migration guard stays on for all requests.
 await actor(c,null,'postgres');await c.query('alter table storage.objects disable trigger workspace_original_admission');
 await c.query("insert into storage.objects(bucket_id,name,metadata) values('workspace-files',$1,jsonb_build_object('size',14999999999::bigint))",[B+'/historical-byte-boundary']);
 await c.query('alter table storage.objects enable trigger workspace_original_admission');
 await actor(c,other);await reserve(c,B,1);await denied('bytes including reservations enforce exact allowance',()=>reserve(c,B,1));
 await actor(c,owner);await denied('bytes from another business do not grant room or access',()=>reserve(c,B,1),'42501');
 // Catalog checks catch accidental anonymous or client mutation RPC grants.
 await actor(c,null,'postgres');
 const bad=(await c.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname ~ '(workspace_upload|workspace_file_purge|workspace_storage_cleanup|reconcile_workspace_storage)' and (has_function_privilege('anon',p.oid,'EXECUTE') or (proname not in ('reserve_workspace_upload_v1','request_workspace_file_purge_v1') and has_function_privilege('authenticated',p.oid,'EXECUTE')))" )).rows;
 ok('no accidental anonymous or authenticated service RPC grants',bad,[]);
 await require('./workspace-capacity-billing-database-checks.cjs')(c,{owner,other,actor,ok,denied,qualifyMaximum});
 await actor(c);const retained=(await c.query('select id from file_uploads where workspace_id=$1 and deleted_at is not null and storage_purged_at is null limit 1',[maximumWorkspace])).rows[0].id;
 await c.query("select update_source_file_lifecycle($1,$2,'restore')",[maximumWorkspace,retained]);
 ok('existing original restores after packs revoked below current usage',true,true);
 await denied('only a new upload is blocked after pack revocation',()=>reserve(c,maximumWorkspace,1));
 await require('./workspace-capacity-invoice-database-checks.cjs')(c,{owner,other,actor,ok,denied});
 console.log(JSON.stringify({status:'passed',checks:results.length,results,qualification:{fileSlots:500,maxFileBytes:26214400,concurrentWriters:2,lastSlotMilliseconds:Date.now()-start,scope:'Synthetic PostgreSQL, not provider HTTP',maximum:maximumQualification}},null,2));
}
(async()=>{try{cmd('initdb',['-D',path.join(work,'data'),'-U','postgres','--auth=trust','--no-locale']);cmd('pg_ctl',['-D',path.join(work,'data'),'-l',path.join(work,'server.log'),'-o',`-p 55331 -h '' -k ${work}`,'start']);started=true;await run(await connect());}finally{await Promise.allSettled(clients.map(c=>c.end()));if(started)cmd('pg_ctl',['-D',path.join(work,'data'),'-m','immediate','stop']);}})().catch(e=>{console.error(e);process.exitCode=1;});
