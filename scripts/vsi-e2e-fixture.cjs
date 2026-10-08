/* eslint-disable @typescript-eslint/no-require-imports -- Local-only synthetic VSI verification. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const {createClient}=require('@supabase/supabase-js');
const {createServerClient}=require('@supabase/ssr');
const {Client}=require('pg');
const root=path.resolve(__dirname,'..');
const check=(r,label)=>{if(r.error)throw Error(label+':'+(r.error.code||r.error.status));return r.data;};
const hash=v=>createHash('sha256').update(v).digest('hex');
function readConfig(file){assert.equal(fs.statSync(file).mode&0o077,0);const c=JSON.parse(fs.readFileSync(file));assert.equal(c.mode,'disposable-native-local');for(const v of [c.apiUrl,c.dbUrl])assert.equal(new URL(v).hostname,'127.0.0.1');return c;}
async function seed(c){
 const admin=createClient(c.apiUrl,c.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const db=new Client({connectionString:c.dbUrl,ssl:false});await db.connect();
 const identity=(await db.query("select current_setting('data_directory') directory")).rows[0];assert(fs.realpathSync(identity.directory).startsWith(fs.realpathSync(c.ownedSupabaseHome)+'/stacks/'));
 const f={workspaces:[],actors:[],sources:{},synthetic:true};
 const legal=fs.readFileSync(path.join(root,'lib/legal/content.ts'),'utf8');const version=k=>new RegExp(k+': "([\\d-]+)"').exec(legal)[1];
 for(const [i,role] of ['owner','viewer','owner'].entries()){
  const a={id:randomUUID(),email:`vsi-${randomUUID()}@example.invalid`,password:randomBytes(24).toString('base64url'),role,workspaceId:i===1?f.workspaces[0]:randomUUID()};
  check(await admin.auth.admin.createUser({id:a.id,email:a.email,password:a.password,email_confirm:true,user_metadata:{full_name:'Synthetic VSI '+role}}),'actor');
  if(i!==1){f.workspaces.push(a.workspaceId);check(await admin.from('workspaces').insert({id:a.workspaceId,name:i===0?'SYNTHETIC VSI Bicycle Shop':'SYNTHETIC VSI Catering',created_by:a.id,primary_contact_email:a.email,industry:'Synthetic qualification',reporting_timezone:'UTC',subscription_required:true,subscription_status:'active',manually_unlocked:true,plan_slug:'vaeroex'}),'workspace');
   check(await admin.from('customer_subscriptions').insert({user_id:a.id,workspace_id:a.workspaceId,customer_email:a.email,customer_name:'Synthetic VSI',source:'manual',billing_provider:'manual',status:'active',plan_slug:'vaeroex',manually_activated:true,notes:'Local synthetic fixture only'}),'subscription');}
  check(await admin.from('workspace_members').insert({workspace_id:a.workspaceId,user_id:a.id,role,status:'active'}),'member');
  check(await admin.from('legal_acceptances').insert({user_id:a.id,workspace_id:a.workspaceId,terms_version:version('terms'),privacy_version:version('privacy'),ai_disclaimer_version:version('aiDisclaimer'),sensitive_data_policy_version:version('sensitiveData'),user_email:a.email}),'legal');f.actors.push(a);
 }
 const a=f.actors[0],w=a.workspaceId,observation='We sell and repair bicycles in Portland. Our customers are commuters. Our goal is to reduce repair turnaround to two days.';
 const extraction={schemaVersion:'business_note_extraction_v1',extractionDisposition:'extractable',title:'Bicycle shop context',summary:observation,noteType:'observation',sourceClassification:'manager_observation',departments:['Operations'],topics:['bicycles','repairs'],peopleMentioned:[],customersMentioned:[],vendorsMentioned:[],projectsMentioned:[],explicitFacts:[{statement:observation,sourceQuote:observation,confidence:0.95}],opinionsOrAssumptions:[],risks:[],opportunities:[],decisions:[],mentionedMetrics:[],reportingPeriod:{start:null,end:null,inferred:false,sourceQuote:null},evidenceTreatment:'context_only',extractionConfidence:0.95,missingContext:[]};
 f.sources.note=randomUUID();check(await admin.from('business_notes').insert({id:f.sources.note,workspace_id:w,author_user_id:a.id,original_note_text:observation,source_text_hash:hash(observation),release_channel:'preview',status:'approved',evidence_lifecycle_status:'active',approved_by:a.id,approved_at:new Date().toISOString(),reviewed_extraction_json:extraction,extraction_json:extraction}),'note');
 for(const s of [{key:'repair',name:'Repair turnaround',value:3.8,target:2,unit:'days',text:'Repair turnaround averaged 3.8 days across 24 repairs. No matched job-level cause records were included.',ext:'csv'},{key:'reviews',name:'1-Star Reviews',value:37,target:0,unit:'count',text:'An aggregate of 37 one-star reviews. No individual comments or review themes are included.',ext:'csv'},{key:'image',name:'Workshop notice',text:'Approved workshop notice: bicycle tune-ups cost $85. Express service is subject to parts availability.',ext:'png'}]){
  const id=randomUUID();f.sources[s.key]=id;
  check(await admin.from('file_uploads').insert({id,workspace_id:w,original_name:`synthetic-${s.key}.${s.ext}`,display_name:'Synthetic '+s.name,file_extension:s.ext,mime_type:s.ext==='png'?'image/png':'text/csv',file_size_bytes:100,storage_bucket:'workspace-files',storage_path:`${w}/vsi/${id}.${s.ext}`,import_status:'imported',processing_status:'ready',metadata_json:{synthetic:true},created_by:a.id}),'file');
  check(await admin.from('business_memory_chunks').insert({workspace_id:w,source_type:'file',source_id:id,source_file_id:id,source_title:'Synthetic '+s.name,source_excerpt:s.text,content_hash:hash(s.text),source_metadata:{evidence_classification:'business_evidence',evidence_lifecycle:'active',synthetic:true},source_quality:'high',confidence_score:90}),'memory');
  if(s.value!==undefined){check(await admin.from('kpi_settings').insert({workspace_id:w,kpi_name:s.name,category:'Operations',target:s.target,weight:1,is_visible:true,semantic_unit:s.unit,desired_direction:'minimize',target_behavior:'maximum_limit',metric_role:'actual',classification_source:'user',classification_confidence:1,classification_confirmed:true,definition:s.text,created_by:a.id}),'settings');
   for(const days of [2,9,16])check(await admin.from('kpis').insert({workspace_id:w,name:s.name,category:'Operations',target:s.target,actual_value:s.value,metric_date:new Date(Date.now()-days*86400000).toISOString().slice(0,10),source_file_id:id,source:'Synthetic '+s.name,created_by:a.id}),'kpi');}
 }
 await db.end();return f;
}
async function session(c,a,origin){const cookies=new Map();const client=createServerClient(c.apiUrl,c.anonKey,{auth:{autoRefreshToken:false},cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:v=>v.forEach(x=>cookies.set(x.name,x.value))}});check(await client.auth.signInWithPassword({email:a.email,password:a.password}),'login');cookies.set('vaeroex_workspace_id',a.workspaceId);return{client,cookies:[...cookies].map(([name,value])=>({name,value,url:origin,sameSite:'Lax'}))};}
module.exports={readConfig,seed,session,check};
