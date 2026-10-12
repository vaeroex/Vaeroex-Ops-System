/* eslint-disable @typescript-eslint/no-require-imports -- Controlled image transport with real authenticated database, Files analysis/approval code and VSI retrieval. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {randomUUID}=require('node:crypto'),{createClient}=require('@supabase/supabase-js');
const root=path.resolve(__dirname,'..'),actionsFile=path.join(root,'app/app/files/actions.ts');
require.extensions['.ts']=(module,filename)=>{let source=fs.readFileSync(filename,'utf8');if(filename===actionsFile)source+='\nexport { runFileVaeroexAnalysis as qualifyFileAnalysis };';
 module._compile(ts.transpileModule(source,{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename)};
const resolve=Module._resolveFilename;Module._resolveFilename=function(request,parent,...rest){if(request==='server-only')return request;return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
require.cache['server-only']={id:'server-only',filename:'server-only',loaded:true,exports:{}};
const {readConfig,check}=require('./vsi-e2e-fixture.cjs');
const config=readConfig(process.argv[2]),fixture=JSON.parse(fs.readFileSync(process.argv[3]));assert.equal(fixture.synthetic,true);
process.env.VERCEL_ENV='preview';process.env.NEXT_PUBLIC_SUPABASE_URL=config.apiUrl;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=config.anonKey;process.env.SUPABASE_SERVICE_ROLE_KEY=config.serviceKey;
delete process.env.OPENAI_API_KEY;delete process.env.GOOGLE_SHEETS_ENABLED;delete process.env.SQUARE_DIRECT_ENABLED;
const {authorizeVsiRead,retrieveVsiEvidence}=require('../lib/vsi/retrieval.ts');
const admin=createClient(config.apiUrl,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const a=fixture.actors[0],fileId=randomUUID();
async function main(){
 const client=createClient(config.apiUrl,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 check(await client.auth.signInWithPassword({email:a.email,password:a.password}),'login');const access=await authorizeVsiRead({supabase:client,workspaceId:a.workspaceId,actorUserId:a.id});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
 const storagePath=`${a.workspaceId}/vsi/${fileId}.png`;
 const file=check(await client.from('file_uploads').insert({id:fileId,workspace_id:a.workspaceId,original_name:'synthetic-image-pipeline.png',display_name:'Synthetic image pipeline workshop notice',file_extension:'png',mime_type:'image/png',file_size_bytes:png.length,
  storage_bucket:'workspace-files',storage_path:storagePath,created_by:a.id,metadata_json:{synthetic:true}}).select('*').single(),'source');
 let downloads=0,readerCalls=0;
 // Replace only storage/provider transport. The actual image extraction, lineage, approval and publication code runs below.
 Object.defineProperty(client,'storage',{value:{from(bucket){assert.equal(bucket,'workspace-files');return {download:async objectPath=>{assert.equal(objectPath,storagePath);downloads++;return {data:new Blob([png],{type:'image/png'}),error:null}}}}}});
 require('../lib/supabase/server.ts').createSupabaseServerClient=async()=>client;
 require('../lib/workspaces/current.ts').getWorkspaceContext=async()=>access.context;
 const transcription='Workshop service notice. Bicycle tune-ups cost $85. Express service is subject to parts availability. Please ask the workshop team for the next available appointment.';
 const output={extraction_status:'populated',confidence:'high',executive_summary:'Bicycle tune-ups cost $85.',extracted_text:transcription,
  extracted_findings:['Bicycle tune-ups cost $85.','Express service is subject to parts availability.'],kpis_found:[],risks:[],operational_issues:[],recommended_actions:[],opportunities:[],unclear_fields:[],response_markdown:""};
 require('../lib/ai/vaeroex-client.ts').runVaeroexCompletionWithUsage=async request=>{readerCalls++;assert.equal(request.modelRoute,'file_analysis');assert.equal(request.fileAttachment.inputType,'image');
  assert.equal(request.fileAttachment.base64Data,png.toString('base64'));assert.equal(request.workspaceId,a.workspaceId);
  return {outputJson:output,usage:{inputTokens:0,outputTokens:0,totalTokens:0,model:'controlled-image-reader',status:'completed',metadata:{synthetic:true}}}};
 const originalLoad=Module._load;
 Module._load=function(request,parent,isMain){
  if(request==='next/cache')return {revalidatePath:()=>{}};
  if(request==='next/navigation')return {redirect:url=>{const error=new Error('Synthetic server redirect');error.redirectUrl=url;throw error}};
  return originalLoad.call(this,request,parent,isMain);
 };
 const actions=require(actionsFile);
 const analysis=await actions.qualifyFileAnalysis({supabase:client,userId:a.id,email:a.email,workspaceId:a.workspaceId,file,prompt:'Read the workshop service notice exactly.',rowLimit:100});
 assert.equal(analysis.extraction.kind,'image_vision');assert.equal(analysis.extraction.textContent,transcription);assert.equal(analysis.learningDecision.reviewRequired,true);
 assert.equal(analysis.indexResult.indexedChunks,0,'image output is not shared memory before confirmation');
 assert.equal(check(await client.from('business_memory_chunks').select('id').eq('workspace_id',a.workspaceId).eq('source_file_id',fileId),'pre-confirmation memory').length,0);
 const before=await retrieveVsiEvidence(access,'What does the synthetic image pipeline workshop notice say?');assert(!before.sources.some(source=>source.sourceId===fileId));
 const form=new FormData();form.set('file_id',fileId);form.set('run_id',analysis.runId);form.set('summary',transcription);form.set('return_path','sources');
 try{await actions.approveFileAnalysisAction(form);assert.fail('approval should redirect')}catch(error){assert(error.redirectUrl,`expected completed server action redirect: ${error.message}`);assert(!error.redirectUrl.includes('error='),decodeURIComponent(error.redirectUrl));assert(error.redirectUrl.includes('message='));}
 const chunks=check(await client.from('business_memory_chunks').select('*').eq('workspace_id',a.workspaceId).eq('source_file_id',fileId).is('archived_at',null).is('deleted_at',null),'published memory');
 assert(chunks.length>0);assert(chunks.every(chunk=>chunk.source_type==='file_analysis'&&chunk.source_metadata.publication_version==='file_analysis_v2'&&chunk.source_metadata.approved_by===a.id));
 const after=await retrieveVsiEvidence(access,'What does the synthetic image pipeline workshop notice say about bicycle tune-ups?');
 const citation=after.sources.find(source=>source.sourceId===fileId);assert(citation);assert.equal(citation.url,`/app/sources/${fileId}`);assert.match(citation.text,/\$85/);
 try{await actions.approveFileAnalysisAction(form)}catch(error){assert(error.redirectUrl&&!error.redirectUrl.includes('error='))}
 assert.equal(check(await client.from('business_memory_chunks').select('id').eq('workspace_id',a.workspaceId).eq('source_file_id',fileId).is('archived_at',null),'replay memory').length,chunks.length);
 console.log(JSON.stringify({passed:true,storageDownloads:downloads,controlledImageReaderCalls:readerCalls,actualFilesImageExtraction:true,actualSavedRun:true,reviewRequired:true,
  actualExistingApprovalAction:true,atomicPublication:true,retryNoDuplicate:true,actualVsiRetrieval:true,sourceCitation:true,realImageReaderQualification:false,paidProviderCalls:0}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(async()=>{await admin.from('file_uploads').update({deleted_at:new Date().toISOString()}).eq('workspace_id',a.workspaceId).eq('id',fileId)});
