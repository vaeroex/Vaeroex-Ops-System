/* eslint-disable @typescript-eslint/no-require-imports -- Owned native PostgreSQL regression fixture. */
// Independent real transactions and repository policies; synthetic JWT role
// GUCs. No URL, hosted database, Auth HTTP, browser or provider is accepted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const root=path.resolve(__dirname,'..'),bin=process.env.WORKSPACE_AUDIT_PG_BIN,checks=[],clients=[];
const source=fs.readFileSync(path.join(root,'scripts/workspace-security-database-tests.cjs'),'utf8');
const base=Function('require','__dirname',source.slice(0,source.indexOf('\n(async()=>{'))+'\nreturn {fixture,actor,admin,user,A,B};')(require,__dirname);
const {A,user}=base, migration='20261005061024_internal_form_submission_idempotency.sql';
const form=n=>`77777777-7777-4777-8777-${String(n).padStart(12,'0')}`;
const schema=[{key:'detail',label:'Business detail',type:'text',required:true},{key:'date',label:'Inspection date',type:'date',required:true},{key:'priority',label:'Priority',type:'priority',required:false}];
const payload=()=>({schema_version:1,schema_snapshot:schema,fields:{detail:'Synthetic inspection',date:'2026-10-04',priority:'High'},summary:'Synthetic response',priority:'Medium',follow_up:' First signal\nSecond signal '});
let owned,config,started=false;
function command(name,args){const r=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:120000,maxBuffer:2**20});if(r.status!==0)throw new Error(`local_${name}_failed: ${r.stderr.slice(0,500)}`);}
async function connect(){const c=new Client({...config,ssl:false,statement_timeout:10000,connectionTimeoutMillis:5000});c.on('error',()=>{});await c.connect();clients.push(c);return c;}
function pass(name,value,expected=true){assert.deepEqual(value,expected,name);checks.push({name,status:'pass'});}
async function denied(name,promise,code){try{await promise;assert.fail(name+' allowed');}catch(e){pass(name,e.code,code);}}
const invoke=(c,key,opts={})=>c.query('select public.submit_internal_form_v1($1,$2,$3,$4,$5,$6::jsonb) value',[opts.workspace||A,opts.form||form(1),key,opts.name??'Synthetic operator',opts.email??'operator@example.invalid',JSON.stringify(opts.data??payload())]).then(r=>r.rows[0].value);
async function tests(c){
 await base.fixture(c);await base.admin(c);
 await c.query('alter table auth.users add column deleted_at timestamptz,add column banned_until timestamptz;alter table forms add column archived_at timestamptz,add column deleted_at timestamptz;');
 await c.query(fs.readFileSync(path.join(root,'supabase/migrations/20261005022017_workspace_security_boundaries.sql'),'utf8'));
 await c.query(fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
 await c.query('update forms set schema_json=$1::jsonb',[JSON.stringify(schema)]);
 await c.query("insert into forms(id,workspace_id,name,schema_json) values($1,$2,'Another same-workspace form',$3)",[form(3),A,JSON.stringify(schema)]);
 const historical=(await c.query('select id,data_json from form_submissions')).rows;
 const count=async()=>Number((await c.query('select count(*) n from form_submissions')).rows[0].n);
 await base.actor(c,2);const key=randomUUID(),first=await invoke(c,key);pass('staff first request creates a response',first.replayed,false);
 const replay=await invoke(c,key);pass('lost acknowledgement retry returns the same submission',replay.submissionId,first.submissionId);pass('retry is marked replayed',replay.replayed);
 pass('one scoped request persists only once',(await c.query('select count(*)::int n from form_submissions where id=$1',[first.submissionId])).rows[0].n,1);
 pass('server derives actor and summary fields',(await c.query('select submitted_by,ai_summary,ai_detected_followups_json from form_submissions where id=$1',[first.submissionId])).rows[0],{submitted_by:user(2),ai_summary:'Vaeroex summary draft: Synthetic response',ai_detected_followups_json:['First signal','Second signal']});
 await denied('same identity with a changed response conflicts',invoke(c,key,{data:{...payload(),summary:'Changed'}}),'22023');
 const fresh=await invoke(c,randomUUID());pass('intentional fresh identity creates another response',fresh.submissionId!==first.submissionId);
 const otherForm=await invoke(c,key,{form:form(3)});pass('identity is scoped to the selected form',otherForm.submissionId!==first.submissionId);
 await base.actor(c,1);const otherActor=await invoke(c,key);pass('identity is scoped to the authenticated actor',otherActor.submissionId!==first.submissionId);
 await c.query("update form_submissions set ai_summary='Reviewed response' where id=$1",[first.submissionId]);
 await base.actor(c,2);await invoke(c,key);pass('replay cannot overwrite later reviewed content',(await c.query('select ai_summary from form_submissions where id=$1',[first.submissionId])).rows[0].ai_summary,'Reviewed response');
 for(const [name,change] of [
  ['missing required field',d=>delete d.fields.detail],['blank required field',d=>d.fields.detail=' '],['unlisted priority',d=>d.fields.priority='Emergency'],['impossible date',d=>d.fields.date='2026-02-30'],['non-text value',d=>d.fields.detail=42],['unknown field',d=>d.fields.forged='yes'],['forged schema snapshot',d=>d.schema_snapshot=[]],['oversized text',d=>d.fields.detail='x'.repeat(2001)],['UTF16 oversized text',d=>d.fields.detail='🧪'.repeat(1001)],['unknown envelope field',d=>d.forged=true],['missing summary',d=>delete d.summary],['unknown envelope priority',d=>d.priority='Emergency']
 ]){const data=structuredClone(payload());change(data);await denied('direct authenticated RPC denies '+name,invoke(c,randomUUID(),{data}),'22023');}
 const leap=payload();leap.fields.date='2000-02-29';pass('valid leap date remains accepted',(await invoke(c,randomUUID(),{data:leap})).replayed,false);
 const yearZero=payload();yearZero.fields.date='0000-02-29';pass('ISO year zero matches existing JavaScript validation',(await invoke(c,randomUUID(),{data:yearZero})).replayed,false);
 await denied('direct RPC denies invalid email',invoke(c,randomUUID(),{email:'invalid'}),'22023');
 await denied('same workspace cannot claim a foreign form',invoke(c,randomUUID(),{form:form(2)}),'42501');
 await base.actor(c,4);await denied('foreign actor cannot claim selected workspace',invoke(c,randomUUID()),'42501');
 await base.actor(c,3);await denied('viewer direct RPC is denied',invoke(c,randomUUID()),'42501');
 await base.actor(c,0,'anon');await denied('anonymous RPC is denied',invoke(c,randomUUID()),'42501');
 await base.actor(c,0,'service_role');await denied('service RPC cannot invent an actor',invoke(c,randomUUID()),'42501');
 await base.admin(c);await c.query('update forms set archived_at=now() where id=$1',[form(1)]);await base.actor(c,2);await denied('archived parent denies even matching replay',invoke(c,key),'42501');
 await base.admin(c);await c.query('update forms set archived_at=null,deleted_at=now() where id=$1',[form(1)]);await base.actor(c,2);await denied('hidden parent denies matching replay',invoke(c,key),'42501');
 await base.admin(c);await c.query('update forms set deleted_at=null where id=$1',[form(1)]);await c.query("update workspace_members set status='disabled' where workspace_id=$1 and user_id=$2",[A,user(2)]);await base.actor(c,2);await denied('revoked membership denies matching replay',invoke(c,key),'42501');
 await base.admin(c);await c.query("update workspace_members set status='active' where workspace_id=$1 and user_id=$2",[A,user(2)]);await c.query("update workspaces set subscription_required=true,subscription_status='expired' where id=$1",[A]);await base.actor(c,2);await denied('expired subscription denies matching replay',invoke(c,key),'42501');
 await base.admin(c);await c.query("update workspaces set subscription_required=false,subscription_status='demo' where id=$1",[A]);await c.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[user(2)]);await base.actor(c,2);await denied('banned account denies matching replay',invoke(c,key),'42501');
 await base.admin(c);await c.query('update auth.users set banned_until=null,deleted_at=now() where id=$1',[user(2)]);await base.actor(c,2);await denied('deleted account denies matching replay',invoke(c,key),'42501');
 await base.admin(c);await c.query('update auth.users set deleted_at=null where id=$1',[user(2)]);
 await base.actor(c,2);await denied('private receipt cannot be read by the caller',c.query('select * from private.internal_form_submission_receipts'),'42501');
 await base.admin(c);pass('no private schema usage or receipt DML is granted',(await c.query("select not has_schema_privilege('authenticated','private','USAGE') and not has_table_privilege('authenticated','private.internal_form_submission_receipts','SELECT,INSERT,UPDATE,DELETE') safe")).rows[0].safe);
 const before=await count(),raceKey=randomUUID();const racers=await Promise.all(Array.from({length:16},async()=>{const client=await connect();await base.actor(client,2);return client;}));
 const raced=await Promise.all(racers.map(client=>invoke(client,raceKey)));
 pass('sixteen independent transactions create exactly one response',raced.filter(row=>!row.replayed).length,1);pass('sixteen concurrent replies return the same identity',new Set(raced.map(row=>row.submissionId)).size,1);pass('race leaves one durable submission',await count(),before+1);
 const conflictKey=randomUUID();const conflict=await Promise.allSettled(racers.slice(0,2).map((client,i)=>invoke(client,conflictKey,{data:{...payload(),summary:'Race payload '+i}})));
 pass('conflicting concurrent payloads admit one only',conflict.filter(x=>x.status==='fulfilled').length,1);pass('other concurrent payload receives conflict',conflict.find(x=>x.status==='rejected').reason.code,'22023');
 await c.query(`create function public.synthetic_receipt_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic receipt write failure';end;$$;create trigger synthetic_receipt_failure before insert on private.internal_form_submission_receipts for each row execute function public.synthetic_receipt_failure();`);
 const rollbackKey=randomUUID(),preRollback=await count();await base.actor(c,2);await denied('receipt failure rolls back its preceding response insert',invoke(c,rollbackKey),'P0001');
 await base.admin(c);pass('failed receipt leaves no orphan response',await count(),preRollback);pass('failed receipt leaves no receipt',(await c.query('select count(*)::int n from private.internal_form_submission_receipts where request_id=$1',[rollbackKey])).rows[0].n,0);
 await c.query('drop trigger synthetic_receipt_failure on private.internal_form_submission_receipts');await base.actor(c,2);pass('intentional retry after rollback succeeds once',(await invoke(c,rollbackKey)).replayed,false);
 await base.admin(c);await c.query('delete from form_submissions where id=$1',[fresh.submissionId]);
 const receipt=(await c.query('select request_id from private.internal_form_submission_receipts where submission_id=$1',[fresh.submissionId])).rows[0];await base.actor(c,2);await denied('replay never recreates a removed response',invoke(c,receipt.request_id),'42501');
 await base.admin(c);for(const row of historical)pass('historical row '+row.id+' remains unchanged',(await c.query('select data_json from form_submissions where id=$1',[row.id])).rows[0].data_json,row.data_json);
 return {migration,checks:checks.length,results:checks};
}
(async()=>{
 for(const name of ['DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','SUPABASE_TEST_DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN'])if(Object.hasOwn(process.env,name))throw new Error('inherited_database_or_credential_configuration_forbidden');
 if(!bin||!path.isAbsolute(bin)||!fs.existsSync(path.join(bin,'initdb')))throw new Error('explicit_local_postgres_bin_required');
 owned=fs.mkdtempSync('/tmp/vaeroex-form-sql-');fs.chmodSync(owned,0o700);const socket=path.join(owned,'socket');fs.mkdirSync(socket,{mode:0o700});
 command('initdb',['-D',path.join(owned,'data'),'--username=postgres','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
 command('pg_ctl',['-D',path.join(owned,'data'),'-l',path.join(owned,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c max_connections=24 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
 config={host:socket,port:5432,user:'postgres',database:'postgres'};const c=await connect();const observed=(await c.query("select current_setting('data_directory') d,current_setting('listen_addresses') a,inet_server_addr() ip")).rows[0];assert.equal(fs.realpathSync(observed.d),fs.realpathSync(path.join(owned,'data')));assert.equal(observed.a,'');assert.equal(observed.ip,null);
 console.log(JSON.stringify({scope:'Focused repository SQL, real native independent transactions; synthetic JWT roles, no Auth HTTP/browser/provider proof',...(await tests(c))},null,2));
})().catch(e=>{console.error(JSON.stringify({status:'failed',code:e.code||null,message:e.message,detail:e.detail,where:e.where,passed:checks.length}));process.exitCode=1;}).finally(async()=>{for(const c of clients)await c.end().catch(()=>{});if(started)command('pg_ctl',['-D',path.join(owned,'data'),'-m','fast','-w','stop']);});
