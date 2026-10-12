/* eslint-disable @typescript-eslint/no-require-imports -- Local native Supabase HTTP qualification. */
// Only this task's disposable native stack is accepted. Never accepts a hosted
// endpoint or prints provider credentials, file content, or login credentials.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,randomBytes,createHash}=require('node:crypto'),{Client}=require('pg'),{createClient}=require('@supabase/supabase-js');
const root=path.resolve(__dirname,'..'),dir='/private/tmp/vaeroex-storage-staging';
const state=JSON.parse(fs.readFileSync(path.join(dir,'status.private.json'),'utf8'));
assert.equal(state.runtime,'native');assert.equal(state.identity.project_root,path.join(dir,'project'));
const env=state.env;for(const key of ['API_URL','DB_URL'])assert.equal(new URL(env[key]).hostname,'127.0.0.1');
const clean=r=>{if(r.error)throw Error(`HTTP_${r.error.code||r.error.status||r.error.statusCode||'error'}_${r.error.message?.slice(0,150)||''}`);return r.data;};
const client=key=>createClient(env.API_URL,key,{auth:{autoRefreshToken:false,persistSession:false}}),admin=client(env.SERVICE_ROLE_KEY);
const checks=[];const pass=(n,a,b)=>{assert.deepEqual(a,b,n);checks.push(n);};
const digest=x=>createHash('sha256').update(x).digest('hex');
(async()=>{
 const db=new Client({connectionString:env.DB_URL,ssl:false});await db.connect();
 try{
 const data=(await db.query("select current_setting('data_directory') directory")).rows[0];assert(fs.realpathSync(data.directory).startsWith(dir+'/home/stacks/'));
 // Latest reviewed trigger patch only; full migrations were applied by root.
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261012003846_workspace_storage_capacity.sql'),'utf8');
 const trigger=sql.match(/create function private\.guard_workspace_original_object_v1\(\)[\s\S]*?\n\$\$;/)[0].replace('create function','create or replace function');await db.query(trigger);
 const fixture={synthetic:true,apiUrl:env.API_URL,actors:[],createdAt:new Date().toISOString()};
 const legal=fs.readFileSync(path.join(root,'lib/legal/content.ts'),'utf8'),version=k=>new RegExp(k+': "([\\d-]+)"').exec(legal)[1];
 for(const [i,role] of ['owner','viewer','owner'].entries()){
 const a={id:randomUUID(),email:`storage-${randomUUID()}@example.invalid`,password:randomBytes(24).toString('base64url'),role,workspaceId:i===1?fixture.actors[0].workspaceId:randomUUID()};
 clean(await admin.auth.admin.createUser({id:a.id,email:a.email,password:a.password,email_confirm:true,user_metadata:{full_name:'Synthetic Storage '+role}}));
 if(i!==1){clean(await admin.from('workspaces').insert({id:a.workspaceId,name:i===0?'SYNTHETIC Storage Capacity':'SYNTHETIC Independent Storage',created_by:a.id,primary_contact_email:a.email,industry:'Synthetic qualification',reporting_timezone:'UTC',subscription_required:true,subscription_status:'active',manually_unlocked:true,plan_slug:'vaeroex'}));
 clean(await admin.from('customer_subscriptions').insert({user_id:a.id,workspace_id:a.workspaceId,customer_email:a.email,customer_name:'Synthetic Storage',source:'manual',billing_provider:'manual',status:'active',plan_slug:'vaeroex',manually_activated:true,notes:'Local synthetic storage fixture only'}));}
 clean(await admin.from('workspace_members').insert({workspace_id:a.workspaceId,user_id:a.id,role,status:'active'}));
 clean(await admin.from('legal_acceptances').insert({user_id:a.id,workspace_id:a.workspaceId,terms_version:version('terms'),privacy_version:version('privacy'),ai_disclaimer_version:version('aiDisclaimer'),sensitive_data_policy_version:version('sensitiveData'),user_email:a.email}));fixture.actors.push(a);
 }
 fs.writeFileSync(path.join(dir,'storage-fixture.private.json'),JSON.stringify(fixture,null,2),{mode:0o600});
 const a=fixture.actors[0],user=client(env.ANON_KEY);clean(await user.auth.signInWithPassword({email:a.email,password:a.password}));
 const reserve=async(bytes,name='Synthetic transport.csv')=>clean(await user.rpc('reserve_workspace_upload_v1',{p_workspace_id:a.workspaceId,p_request_id:randomUUID(),p_original_name:name,p_extension:'csv',p_mime_type:'text/csv',p_bytes:bytes,p_display_name:name}));
 let usage=clean(await user.rpc('workspace_storage_usage_v1',{p_workspace_id:a.workspaceId}));pass('native usage endpoint exposes exact per-workspace allowance',[usage.allowance_bytes,usage.allowance_files],[15000000000,500]);
 pass('native cross-workspace usage blocked',Boolean((await user.rpc('workspace_storage_usage_v1',{p_workspace_id:fixture.actors[2].workspaceId})).error),true);
 const body=Buffer.alloc(26214400,32);body.write('date,value\n2026-10-11,1\n');
 const r=await reserve(body.length,'Synthetic 25 MiB.csv');const signed=clean(await admin.storage.from('workspace-files').createSignedUploadUrl(r.storage_path,{upsert:false}));
 pass('Supabase signed URL issued after reservation',typeof signed.token,'string');
 clean(await user.storage.from('workspace-files').uploadToSignedUrl(r.storage_path,signed.token,body,{contentType:'text/csv',upsert:false}));
 const inspect=clean(await admin.rpc('inspect_workspace_upload_v1',{p_workspace_id:a.workspaceId,p_reservation_id:r.reservation_id,p_actor_id:a.id}));pass('inspection remains pending until validated finalization',inspect.state,'pending');
 const blob=clean(await admin.storage.from('workspace-files').download(r.storage_path));const downloaded=Buffer.from(await blob.arrayBuffer());
 pass('actual 25 MiB crosses native Storage HTTP with exact bytes',[downloaded.length,digest(downloaded)],[body.length,digest(body)]);
 let complete=clean(await admin.rpc('finalize_workspace_upload_v1',{p_workspace_id:a.workspaceId,p_reservation_id:r.reservation_id,p_actor_id:a.id}));pass('server completion creates one source',complete.file_id,r.file_id);
 pass('HTTP duplicate completion idempotent',clean(await admin.rpc('finalize_workspace_upload_v1',{p_workspace_id:a.workspaceId,p_reservation_id:r.reservation_id,p_actor_id:a.id})).file_id,r.file_id);
 pass('same signed URL cannot overwrite completed original',Boolean((await user.storage.from('workspace-files').uploadToSignedUrl(r.storage_path,signed.token,body,{contentType:'text/csv',upsert:true})).error),true);
 pass('direct unreserved Storage upload blocked',Boolean((await user.storage.from('workspace-files').upload(a.workspaceId+'/unreserved.csv',Buffer.from('x'),{contentType:'text/csv'})).error),true);
 const wrong=await reserve(7,'Wrong size.csv'),wrongSigned=clean(await admin.storage.from('workspace-files').createSignedUploadUrl(wrong.storage_path));
 pass('actual byte mismatch rejected through Storage HTTP',Boolean((await user.storage.from('workspace-files').uploadToSignedUrl(wrong.storage_path,wrongSigned.token,Buffer.from('too many bytes'),{contentType:'text/csv'})).error),true);
 const late=await reserve(1,'Expired.csv'),lateSigned=clean(await admin.storage.from('workspace-files').createSignedUploadUrl(late.storage_path));
 await db.query("update private.workspace_upload_reservations set expires_at=now()-interval '1 second' where id=$1",[late.reservation_id]);
 pass('expired reservation rejects still-cryptographically-valid signed token',Boolean((await user.storage.from('workspace-files').uploadToSignedUrl(late.storage_path,lateSigned.token,Buffer.from('x'),{contentType:'text/csv'})).error),true);
 clean(await user.rpc('update_source_file_lifecycle',{p_workspace_id:a.workspaceId,p_file_id:r.file_id,p_action:'delete'}));
 usage=clean(await user.rpc('workspace_storage_usage_v1',{p_workspace_id:a.workspaceId}));pass('native Trash retains bytes and file slot',[usage.used_bytes,usage.used_files,usage.trash.files],[body.length,1,1]);
 clean(await user.rpc('update_source_file_lifecycle',{p_workspace_id:a.workspaceId,p_file_id:r.file_id,p_action:'restore'}));
 pass('native restore preserves retained file slot',clean(await user.rpc('workspace_storage_usage_v1',{p_workspace_id:a.workspaceId})).used_files,1);
 clean(await user.rpc('update_source_file_lifecycle',{p_workspace_id:a.workspaceId,p_file_id:r.file_id,p_action:'delete'}));
 clean(await admin.rpc('mark_workspace_file_purge_v1',{p_workspace_id:a.workspaceId,p_file_id:r.file_id,p_actor_id:a.id}));
 clean(await admin.storage.from('workspace-files').remove([r.storage_path]));
 pass('Storage API permanent deletion finalized',clean(await admin.rpc('finalize_workspace_file_purge_v1',{p_workspace_id:a.workspaceId,p_file_id:r.file_id})),true);
 pass('permanently deleted signed path cannot resurrect',Boolean((await user.storage.from('workspace-files').uploadToSignedUrl(r.storage_path,signed.token,body,{contentType:'text/csv'})).error),true);
 usage=clean(await user.rpc('workspace_storage_usage_v1',{p_workspace_id:a.workspaceId}));pass('confirmed Storage deletion releases original bytes',usage.used_bytes,0);
 // Leave one small visible original for app browser verification.
 const smallBody=Buffer.from('date,value\n2026-10-11,42\n'),small=await reserve(smallBody.length,'Synthetic Usage sample.csv');const smallSigned=clean(await admin.storage.from('workspace-files').createSignedUploadUrl(small.storage_path));
 clean(await user.storage.from('workspace-files').uploadToSignedUrl(small.storage_path,smallSigned.token,smallBody,{contentType:'text/csv'}));clean(await admin.rpc('finalize_workspace_upload_v1',{p_workspace_id:a.workspaceId,p_reservation_id:small.reservation_id,p_actor_id:a.id}));
 fixture.sampleFileId=small.file_id;fs.writeFileSync(path.join(dir,'storage-fixture.private.json'),JSON.stringify(fixture,null,2),{mode:0o600});
 console.log(JSON.stringify({status:'passed',checks:checks.length,results:checks,fixtureFile:path.join(dir,'storage-fixture.private.json'),transportBytes:body.length,scope:'Full native Supabase Auth/PostgREST/Storage HTTP, synthetic workspace'},null,2));
 } finally {await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
