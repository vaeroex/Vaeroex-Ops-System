/* eslint-disable @typescript-eslint/no-require-imports -- Isolated native app qualification. */
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createServerClient}=require('@supabase/ssr');
const dir='/private/tmp/vaeroex-storage-staging',origin='http://127.0.0.1:49952';
const env=JSON.parse(fs.readFileSync(dir+'/status.private.json')).env,fixture=JSON.parse(fs.readFileSync(dir+'/fixture.private.json'));
assert(fixture.synthetic);assert.equal(new URL(env.API_URL).hostname,'127.0.0.1');
const results=[];function pass(n,a,b){assert.deepEqual(a,b,n);results.push(n);}
async function session(actor){const jar=new Map();const client=createServerClient(env.API_URL,env.ANON_KEY,{auth:{autoRefreshToken:false},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:v=>v.forEach(x=>jar.set(x.name,x.value))}});const r=await client.auth.signInWithPassword({email:actor.email,password:actor.password});assert(!r.error,'synthetic sign in');jar.set('vaeroex_workspace_id',actor.workspaceId);return [...jar].map(([k,v])=>k+'='+v).join('; ');}
async function run(){
 const [owner,viewer,other]=fixture.actors;const [cookie,viewerCookie,otherCookie]=await Promise.all([session(owner),session(viewer),session(other)]);
 const api=async(path,body,c=cookie,requestOrigin=origin)=>{const r=await fetch(origin+'/api/storage-capacity/'+path,{method:body?'POST':'GET',redirect:'manual',headers:{cookie:c,Origin:requestOrigin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});let value;try{value=await r.json()}catch{value=null}return{status:r.status,value,headers:r.headers};};
 const usage=await api('usage?workspaceId='+owner.workspaceId);pass('app authenticated workspace usage available',usage.status,200);pass('app exactincludedallowance',[usage.value.includedBytes,usage.value.includedFiles],[15000000000,500]);
 pass('anonymous usage denied',(await api('usage?workspaceId='+owner.workspaceId,null,'')).status,401);
 pass('other business usage denied',(await api('usage?workspaceId='+owner.workspaceId,null,otherCookie)).status,409);
 const input={workspaceId:owner.workspaceId,requestId:randomUUID(),originalName:'Synthetic app transport.pdf',displayName:'Synthetic app transport',bytes:26214400,mimeType:'application/pdf',folderId:null,allowDuplicate:false};
 pass('crossorigin upload rejected',(await api('reserve',input,cookie,'https://untrusted.invalid')).status,403);
 pass('viewer upload rejected',(await api('reserve',input,viewerCookie)).status,403);
 pass('other workspace upload rejected',(await api('reserve',input,otherCookie)).status,409);
 pass('over25MiB upload rejected',(await api('reserve',{...input,bytes:26214401})).status,400);
 const reserved=await api('reserve',input);pass('app reserve admitted',reserved.status,200);assert.equal(new URL(reserved.value.signedUrl).origin,env.API_URL);
 const body=Buffer.alloc(input.bytes,32);body.write('%PDF-1.4\n% Synthetic transport qualification only\n');
 const uploaded=await fetch(reserved.value.signedUrl,{method:'PUT',headers:{'Content-Type':'application/pdf','x-upsert':'false'},body});pass('raw browser PUT transports25MiB',uploaded.status,200);
 const completion={workspaceId:owner.workspaceId,reservationId:reserved.value.reservationId};
 const completed=await api('complete',completion);pass('app validates andfinalizes actual25MiB',completed.status,200);pass('duplicateappcomplete idempotent',(await api('complete',completion)).value.fileId,completed.value.fileId);
 const fileId=completed.value.fileId;
 const fresh=await api('usage?workspaceId='+owner.workspaceId);pass('committed byte increase',fresh.value.usedBytes-usage.value.usedBytes,body.length);pass('committed slot increase',fresh.value.usedFiles-usage.value.usedFiles,1);
 pass('download retained atquota',(await api('download?workspaceId='+owner.workspaceId+'&fileId='+fileId)).status,303);
 pass('download cannotcrossworkspace',(await api('download?workspaceId='+owner.workspaceId+'&fileId='+fileId,null,otherCookie)).status,409);
 const lifecycle=action=>api('lifecycle',{workspaceId:owner.workspaceId,fileId,action});
 pass('archive works',(await lifecycle('archive')).status,200);pass('archive keeps slots',(await api('usage?workspaceId='+owner.workspaceId)).value.usedFiles,fresh.value.usedFiles);
 pass('Trash deletion works',(await lifecycle('delete')).status,200);pass('Trash visible',(await api('trash?workspaceId='+owner.workspaceId+'&page=1')).value.files.some(f=>f.id===fileId),true);
 pass('restore works',(await lifecycle('restore')).status,200);await lifecycle('delete');pass('explicit permanentdelete works',(await lifecycle('purge')).status,200);
 pass('purge releasesbytes',(await api('usage?workspaceId='+owner.workspaceId)).value.usedBytes,usage.value.usedBytes);
 pass('purgedobject cannotrestore',(await lifecycle('restore')).status,404);
 pass('maintenance rejectsunauthenticated',(await api('maintenance')).status,401);
 const bad=await api('reserve',{...input,requestId:randomUUID(),originalName:'Synthetic invalid.pdf',bytes:12});pass('invalidbytes file reserves beforevalidation',bad.status,200);
 await fetch(bad.value.signedUrl,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:Buffer.from('not a PDF!!!')});
 pass('invalidmagic is rejected',(await api('complete',{workspaceId:owner.workspaceId,reservationId:bad.value.reservationId})).status,400);
 console.log(JSON.stringify({status:'passed',checks:results.length,results,scope:'Synthetic native app HTTP plus Supabase Storage, no customer data'},null,2));
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
