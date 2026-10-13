/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in isolated local capture runner. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),req=Module.createRequire(root+'/package.json'),ts=req('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const resolver=Module._resolveFilename;Module._resolveFilename=function(r,p,...rest){if(r==='server-only')return r;return resolver.call(this,r.startsWith('@/')?root+'/'+r.slice(2):r,p,...rest)};
require.cache['server-only']={id:'server-only',filename:'server-only',loaded:true,exports:{}};
const privateDir=process.argv[process.argv.indexOf('--config-dir')+1];
assert(process.argv.includes('--config-dir')&&privateDir&&path.isAbsolute(privateDir),'Pass --config-dir with the owned local assembly directory');
assert(!path.resolve(privateDir).startsWith(root+path.sep),'Private configuration must remain outside Git');
const config=req('./scripts/vsi-e2e-fixture.cjs').readConfig(path.join(privateDir,'private-e2e-config.json'));
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:config.apiUrl,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.anonKey,SUPABASE_SERVICE_ROLE_KEY:config.serviceKey,VERCEL_ENV:'preview'});
const {Client}=req('pg'),{createClient}=req('@supabase/supabase-js');
const raw=req('./scripts/website-demo/data.ts'),rawContext=req('./scripts/website-demo/context.ts');
const ids=new Map();for(const rows of [raw.files,raw.imports,raw.kpis,raw.performanceKpiSettings,raw.operationalMetrics])for(const r of rows){if(!/^[a-f0-9-]{36}$/i.test(r.id)){const h=crypto.createHash('sha256').update('coastal-local:'+r.id).digest('hex');ids.set(r.id,`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`);}}
function remap(v){if(typeof v==='string')return ids.get(v)||v;if(Array.isArray(v))return v.map(remap);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,remap(x)]));return v;}
let data=remap(raw);const context=remap(rawContext);
async function main(){
 const db=new Client({connectionString:config.dbUrl});await db.connect();
 const identity=(await db.query("select current_setting('data_directory') directory")).rows[0];assert(fs.realpathSync(identity.directory).startsWith(fs.realpathSync(config.ownedSupabaseHome)+'/stacks/'));
 const admin=createClient(config.apiUrl,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 let actor;const actorPath=privateDir+'/coastal-actor.private.json';
 if(fs.existsSync(actorPath))actor=JSON.parse(fs.readFileSync(actorPath));else{
  assert.equal(Number((await db.query('select count(*) from public.workspaces')).rows[0].count),0,'Fresh disposable database required');
  actor={id:data.profile.id,email:data.profile.email,password:crypto.randomBytes(24).toString('base64url'),workspaceId:data.WORKSPACE_ID};
  const r=await admin.auth.admin.createUser({id:actor.id,email:actor.email,password:actor.password,email_confirm:true,user_metadata:{full_name:data.profile.full_name}});if(r.error)throw Error('local_user:'+r.error.code);
  fs.writeFileSync(actorPath,JSON.stringify(actor),{mode:0o600});
 }
 async function insert(table,rows){
  assert(/^[a-z_]+$/.test(table));
  const cols=new Set((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[table])).rows.map(r=>r.column_name));
  for(const row of rows){const entries=Object.entries(row).filter(([k])=>cols.has(k)&&k!=='import_row_id');const values=entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v);await db.query(`insert into public.${table} (${entries.map(([k])=>'"'+k+'"').join(',')}) values (${entries.map((_,i)=>'$'+(i+1)).join(',')}) on conflict do nothing`,values);}
 }
 await db.query('begin');try{
 await insert('workspaces',[{...data.workspace,created_by:actor.id,primary_contact_email:actor.email,reporting_timezone:'UTC',manually_unlocked:true,plan_slug:'vaeroex'}]);
 await insert('workspace_members',[{workspace_id:actor.workspaceId,user_id:actor.id,role:'owner',status:'active'}]);
 if(!(await db.query('select 1 from public.customer_subscriptions where workspace_id=$1',[actor.workspaceId])).rowCount)await insert('customer_subscriptions',[{user_id:actor.id,workspace_id:actor.workspaceId,customer_email:actor.email,customer_name:'Maya Rowan',source:'manual',billing_provider:'manual',status:'active',plan_slug:'vaeroex',manually_activated:true,notes:'Disposable local synthetic capture only; no billing.'}]);
 await db.query('commit');
 const uploader=createClient(config.apiUrl,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});const logged=await uploader.auth.signInWithPassword({email:actor.email,password:actor.password});if(logged.error)throw Error('upload_login');
 for(let i=0;i<raw.files.length;i++){
  const file=raw.files[i];
  const reserved=await uploader.rpc('reserve_workspace_upload_v1',{p_workspace_id:actor.workspaceId,p_request_id:ids.get(file.id),p_original_name:file.original_name,p_extension:'csv',p_mime_type:'text/csv',p_bytes:file.file_size_bytes,p_display_name:file.display_name});if(reserved.error)throw Error('reserve:'+reserved.error.message);
  const r=reserved.data;
  if(r.state!=='completed'){const uploaded=await admin.storage.from('workspace-files').upload(r.storage_path,Buffer.from(raw.csvContents[i]),{contentType:'text/csv'});if(uploaded.error)throw Error('upload:'+uploaded.error.message);const finalized=await admin.rpc('finalize_workspace_upload_v1',{p_workspace_id:actor.workspaceId,p_reservation_id:r.reservation_id,p_actor_id:actor.id});if(finalized.error)throw Error('finalize:'+finalized.error.message);}
  ids.set(file.id,r.file_id);
  await db.query('update public.file_uploads set created_at=$1, updated_at=$1, import_status=$2, imported_rows=$3, processing_status=$4 where id=$5 and workspace_id=$6',[file.created_at,'imported',file.imported_rows,'ready',r.file_id,actor.workspaceId]);
 }
 data=remap(raw);
 await db.query('begin');
 await insert('file_imports',data.imports.map(r=>({...r,import_type:data.kpis.some(k=>k.import_id===r.id)?'kpi':'metrics',status:'completed',recovery_status:'completed'})));await insert('kpi_settings',data.performanceKpiSettings);await insert('kpis',data.kpis);await insert('operational_metrics',data.operationalMetrics);
 await insert('business_notes',context.businessNotes.map(n=>({...n,release_channel:'preview'})));
 await insert('business_memory_chunks',data.sourceDocuments.map((source,i)=>({id:`00000000-0000-4000-8000-${String(5000+i).padStart(12,'0')}`,workspace_id:actor.workspaceId,source_type:'file',source_id:source.id,source_file_id:source.id,source_title:data.files[i].display_name,source_excerpt:source.text,content_hash:crypto.createHash('sha256').update(source.text).digest('hex'),source_metadata:{synthetic:true,evidence_classification:'business_evidence',review_status:'approved'},source_quality:'high',confidence_score:90,indexed_at:data.files[i].created_at})));
 await insert('business_memory_chunks',context.businessNotes.map(n=>({id:'00000000-0000-4000-8000-000000006000',workspace_id:actor.workspaceId,source_type:'business_note',source_id:n.id,source_title:n.reviewed_extraction_json.title,source_excerpt:n.original_note_text,content_hash:crypto.createHash('sha256').update(n.original_note_text).digest('hex'),source_metadata:{synthetic:true,release_channel:'preview',source_version:1,evidence_classification:'business_evidence',evidence_lifecycle:'active',evidence_role:'supporting_context',review_status:'approved',original_evidence_eligible:false},source_quality:'medium',confidence_score:48,indexed_at:data.AS_OF})));
 await db.query('commit');}catch(e){await db.query('rollback');throw e;}finally{await db.end();}
 const client=createClient(config.apiUrl,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});const login=await client.auth.signInWithPassword({email:actor.email,password:actor.password});if(login.error)throw Error('local_login:'+login.error.code);
 const {authorizeVsiRead,retrieveVsiEvidence}=req('./lib/vsi/retrieval.ts'),{beginGoogleSheetsRead}=req('./lib/integrations/google-sheets/read-authority.ts');
 const access=await authorizeVsiRead({supabase:client,workspaceId:actor.workspaceId,actorUserId:actor.id});
 const ticket=await beginGoogleSheetsRead(client,actor.workspaceId,actor.id);
 const question='Based on the business information available, which marketing campaign should Coastal Kitchen prioritize over the next two weeks? Explain your recommendation and build a practical plan with a proposed budget, preparation steps, sample messaging, and measures of success.';
 const evidence=await retrieveVsiEvidence(access,question,data.AS_OF,ticket);
 if(process.argv.includes('--preflight')){
  assert(!process.env.OPENAI_API_KEY&&!process.env.GOOGLE_SHEETS_OPENAI_API_KEY,'Preflight must have no provider credentials');
  try{await req('./lib/vsi/engine.ts').runVsiAnswer({readTicket:ticket,supabase:client,workspaceId:actor.workspaceId,actorUserId:actor.id,question,recentMessages:[],requestId:crypto.randomUUID()});throw Error('Unexpected successful preflight');}
  catch(error){const expected=/provider connection is not configured/.test(error.message);console.log(JSON.stringify({preflight:expected?'ready_except_provider':'blocked',message:error.message,providerCalls:error.usage?.providerCalls||0}));if(!expected)throw error;}
 }
 if(process.argv.includes('--generate')){
  const envFile=path.join(require('node:os').homedir(),'.config/vaeroex/coastal-kitchen/provider.env');assert.equal(fs.statSync(envFile).mode&0o077,0);
  const env=require('node:util').parseEnv(fs.readFileSync(envFile,'utf8'));assert(env.OPENAI_API_KEY?.trim(),'Configure the dedicated key privately in provider.env first.');
  assert(!process.env.GOOGLE_SHEETS_OPENAI_API_KEY,'No integration provider override is permitted');process.env.OPENAI_API_KEY=env.OPENAI_API_KEY;
  const out=privateDir+'/vsi-generation.private.json';assert(!fs.existsSync(out),'An attempt already exists; review it before authorizing another call.');
  fs.writeFileSync(out,JSON.stringify({status:'started',synthetic:true,reservedWorstCaseUsd:.25,question,startedAt:new Date().toISOString()}),{mode:0o600});
  const config=req('./lib/vsi/config.ts').getVsiConfig();assert(config.requestReserveUsd<=.25,'Unexpected spending limit');
  try{const answer=await req('./lib/vsi/engine.ts').runVsiAnswer({readTicket:ticket,supabase:client,workspaceId:actor.workspaceId,actorUserId:actor.id,question,recentMessages:[],requestId:crypto.randomUUID()});fs.writeFileSync(out,JSON.stringify({status:'completed',synthetic:true,question,answer},null,2),{mode:0o600});console.log(JSON.stringify({generated:true,citations:answer.citations.length,estimatedCostUsd:answer.usage.estimatedCostUsd}));}
  catch(error){fs.writeFileSync(out,JSON.stringify({status:'failed',synthetic:true,question,message:error.message,usage:error.usage||null,uncertainReservedUsd:error.accountingUncertain?.25:0},null,2),{mode:0o600});throw error;}
 }

 fs.writeFileSync(privateDir+'/retrieval.json',JSON.stringify({synthetic:true,question,evidence},null,2),{mode:0o600});
 console.log(JSON.stringify({synthetic:true,workspaceCount:1,kpis:data.kpis.length,files:data.files.length,sources:evidence.sources.map(s=>({type:s.sourceType,title:s.title,date:s.evidenceDate})),limitations:evidence.limitations,generationAttempted:process.argv.includes('--generate')}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
