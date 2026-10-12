/* eslint-disable @typescript-eslint/no-require-imports -- Native local qualification loads project TypeScript without changing the application runtime. */
/* Local synthetic database verification. No customer data and no provider calls. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),ts=require('typescript');
const {randomUUID,createHash}=require('node:crypto'),{createClient}=require('@supabase/supabase-js');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
const resolve=Module._resolveFilename;Module._resolveFilename=function(request,parent,...rest){if(request==='server-only')return request;return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
require.cache['server-only']={id:'server-only',filename:'server-only',loaded:true,exports:{}};
const {readConfig,check}=require('./vsi-e2e-fixture.cjs');
const {authorizeVsiRead,retrieveVsiEvidence}=require('../lib/vsi/retrieval.ts');
const {indexFileAnalysisEvidence}=require('../lib/ai/evidence-index.ts');
const configPath=process.argv[2],fixturePath=process.argv[3];
assert(configPath&&fixturePath,'Pass isolated local config and synthetic fixture paths.');
const config=readConfig(configPath),fixture=JSON.parse(fs.readFileSync(fixturePath));assert.equal(fixture.synthetic,true);
process.env.VERCEL_ENV='preview';delete process.env.OPENAI_API_KEY;delete process.env.GOOGLE_SHEETS_ENABLED;delete process.env.SQUARE_DIRECT_ENABLED;
const admin=createClient(config.apiUrl,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}),added=[];
async function actorSession(actor){const client=createClient(config.apiUrl,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});check(await client.auth.signInWithPassword({email:actor.email,password:actor.password}),'sign in');return client;}
async function main(){
 const owner=fixture.actors[0],other=fixture.actors[2],client=await actorSession(owner),otherClient=await actorSession(other);
 const note=check(await admin.from('business_notes').select('*').eq('workspace_id',owner.workspaceId).eq('id',fixture.sources.note).single(),'note');
 const hash=createHash('sha256').update('vsi-synthetic-approved-note:'+note.id).digest('hex');
 check(await admin.from('business_memory_chunks').upsert({workspace_id:owner.workspaceId,source_type:'business_note',source_id:note.id,source_title:'Bicycle shop context',
  source_excerpt:note.original_note_text,content_hash:hash,source_metadata:{evidence_classification:'business_evidence',evidence_lifecycle:'active',review_status:'approved',synthetic:true},source_quality:'medium',confidence_score:47},
  {onConflict:'workspace_id,source_type,source_id,content_hash,chunk_index'}),'note index');
 const access=await authorizeVsiRead({supabase:client,workspaceId:owner.workspaceId,actorUserId:owner.id});
 const result=await retrieveVsiEvidence(access,'What do our approved Business Notes, repair KPIs, review counts and uploaded workshop notice tell us?');
 const types=[...new Set(result.sources.map(source=>source.sourceType))];
 assert(types.includes('kpi'),'permitted KPI evidence');assert(types.includes('file'),'permitted file evidence');assert(types.includes('business_note'),'approved indexed note context');assert(types.includes('finding'),'canonical Intelligence findings');assert(types.includes('business_health'),'canonical Health/Overview');
 assert(result.sources.some(source=>source.sourceId===fixture.sources.image&&source.url.endsWith(fixture.sources.image)),'existing indexed PNG-derived text with original file citation');
 await assert.rejects(authorizeVsiRead({supabase:otherClient,workspaceId:owner.workspaceId,actorUserId:other.id}),/no longer have access/);
 const cross=check(await otherClient.from('business_memory_chunks').select('id').eq('workspace_id',owner.workspaceId),'cross workspace memory');assert.equal(cross.length,0);
 const crossNotes=check(await otherClient.from('business_notes').select('id').eq('workspace_id',owner.workspaceId),'cross workspace notes');assert.equal(crossNotes.length,0);
 for(const kind of ['archived','unapproved','approved']){
  const id=randomUUID();added.push(id);
  check(await admin.from('file_uploads').insert({id,workspace_id:owner.workspaceId,original_name:`synthetic-${kind}-image.png`,display_name:`Synthetic ${kind} image authority`,file_extension:'png',mime_type:'image/png',file_size_bytes:100,
   storage_bucket:'workspace-files',storage_path:`${owner.workspaceId}/vsi/${id}.png`,created_by:owner.id,metadata_json:{synthetic:true}}),'extra file');
  const excerpt=`Synthetic ${kind} image authority fixture: workshop opening hours are 09:00 to 17:00.`;
  check(await admin.from('business_memory_chunks').insert({workspace_id:owner.workspaceId,source_type:'file_analysis',source_id:id,source_file_id:id,source_title:`Synthetic ${kind} image authority`,source_excerpt:excerpt,
   content_hash:createHash('sha256').update(excerpt).digest('hex'),source_metadata:{evidence_classification:'business_evidence',evidence_lifecycle:'active',review_status:kind==='unapproved'?'pending':'approved',synthetic:true},source_quality:'medium',confidence_score:50}),'extra memory');
  if(kind==='archived')check(await admin.from('file_uploads').update({archived_at:new Date().toISOString()}).eq('workspace_id',owner.workspaceId).eq('id',id),'archive fixture');
 }
 const checked=await retrieveVsiEvidence(access,'What do the synthetic archived unapproved and approved image authority fixtures say?');
 assert(!checked.sources.some(source=>source.sourceId===added[0]),'archived original excluded');assert(!checked.sources.some(source=>source.sourceId===added[1]),'unapproved image analysis excluded');
 assert(checked.sources.some(source=>source.sourceId===added[2]),'legacy approved indexed image text included');
 const image=check(await client.from('file_uploads').select('*').eq('workspace_id',owner.workspaceId).eq('id',fixture.sources.image).single(),'source');
 const noConfirmation=await indexFileAnalysisEvidence({supabase:client,workspaceId:owner.workspaceId,userId:owner.id,file:image,extractedText:'Workshop notice: tune-ups cost $85.'});
 assert.equal(noConfirmation.indexedChunks,0);assert.match(noConfirmation.error,/Confirm/);
 console.log(JSON.stringify({passed:true,sourceTypes:types,sourceCount:result.sources.length,workspaceRls:true,noteRls:true,archivedExcluded:true,unapprovedImageAnalysisExcluded:true,
  approvedIndexedImageText:true,imageProcessorE2E:false,publishRequiresConfirmation:true,paidProviderCalls:0}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(async()=>{for(const id of added)await admin.from('file_uploads').update({deleted_at:new Date().toISOString()}).eq('id',id).eq('workspace_id',fixture.actors[0].workspaceId)});
