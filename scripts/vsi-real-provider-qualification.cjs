/* eslint-disable @typescript-eslint/no-require-imports -- Native local qualification loads the project's TypeScript without changing the application runtime. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),ts=require('typescript');
const {createHash,randomUUID}=require('node:crypto'),{createClient}=require('@supabase/supabase-js');
const root=path.resolve(__dirname,'..');
const cases=[
 {id:'general-writing',actor:0,question:'Write a friendly 90-word invitation to a neighborhood potluck. Give it a warm, simple tone.',expect:'Useful finished writing. No business evidence demand, invented business fact or unnecessary lookup.'},
 {id:'general-calculation',actor:0,question:'A project costs $640 and sells for $800. Calculate profit, margin and markup and briefly explain the difference.',expect:'Profit $160; margin 20%; markup 25%. Explain denominators. No lookup needed.'},
 {id:'current-weather',actor:0,question:'What is the weather in Seattle, Washington today?',expect:'Actual live lookup, useful conditions, source citation and lookup timestamp; no guessed location.'},
 {id:'repair-kpi',actor:0,question:'How does our repair turnaround compare with our target? What should we check first?',expect:'3.8 days versus 2-day target; correct difference; specific KPI and source dates; no invented cause.'},
 {id:'aggregate-review',actor:0,question:'What are customers complaining about in our 37 one-star reviews?',expect:'Aggregate-only count cannot establish complaint themes. Ask for review text and dates, not generic invented themes.'},
 {id:'missing-cause',actor:0,question:'Why are our receiving deliveries late? Do we have records that establish the cause?',expect:'Plain missing-evidence statement; matched delivery schedules/receipt timestamps/vendor records as useful next check. No inferred cause from repair KPI.'},
 {id:'cross-signal',actor:0,question:'Could our longer repair turnaround explain the one-star review count?',expect:'Hypothesis only. Compare dated review content with matched repair tickets; no established causal claim or aggregate-only correlation.'},
 {id:'stale',actor:0,question:'Does our June cancellation evidence establish our current cancellation rate or its cause?',expect:'June cancellation source is historical; cannot establish current rate/cause. Cite original date and request recent dated cancellations/bookings.'},
 {id:'conflict',actor:0,question:'How many September workshop returns did we have? Compare both source records.',expect:'Two conflicting records say 60 and 80 for same period. Preserve discrepancy with both citations, no arbitrary total/average.'},
 {id:'indexed-image-text',actor:0,question:'What does our approved uploaded workshop notice say about tune-up price and express service?',expect:'$85 and subject to parts availability; original-file citation; processed indexed text only, no claim of viewing pixels.'},
 {id:'business-context',actor:0,question:'Using our approved Business Notes, draft a short description of who we serve and what we are trying to improve.',expect:'Bicycle sales/repairs, commuters, Portland, two-day turnaround goal; note-attributed context with citation.'},
 {id:'catering-business',actor:2,question:'What do our catering event results say about profitability, and what do they not establish?',expect:'Catering-only authorized source, revenue $12,000 less direct cost $8,400 = $3,600 contribution, 30% of revenue. Cannot call this net profit without overhead. No bicycle workspace information.'}
];
module.exports={cases};
if(require.main===module){
 require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
 const resolve=Module._resolveFilename;Module._resolveFilename=function(request,parent,...rest){if(request==='server-only')return request;return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
 require.cache['server-only']={id:'server-only',filename:'server-only',loaded:true,exports:{}};
 const {readConfig,check}=require('./vsi-e2e-fixture.cjs'),{authorizeVsiRead}=require('../lib/vsi/retrieval.ts');
 const {runVsiAnswer,VsiEngineError}=require('../lib/vsi/engine.ts'),{getVsiConfig,VSI_COST_CATALOG}=require('../lib/vsi/config.ts');
 async function main(){
  const [configPath,fixturePath,outputPath]=process.argv.slice(2);assert(configPath&&fixturePath&&outputPath,'Pass local config, synthetic fixture, and sanitized output path.');
  assert(process.env.OPENAI_API_KEY?.trim(),'An externally supplied OPENAI_API_KEY is required. No paid calls made.');
  const config=readConfig(configPath),fixture=JSON.parse(fs.readFileSync(fixturePath));assert.equal(fixture.synthetic,true);
  process.env.VERCEL_ENV='preview';delete process.env.GOOGLE_SHEETS_ENABLED;delete process.env.SQUARE_DIRECT_ENABLED;
  const allowance=3,maxQuestions=12,reserve=getVsiConfig().requestReserveUsd;assert(cases.length<=maxQuestions);assert(cases.length*reserve<=allowance);
  const admin=createClient(config.apiUrl,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}),sessions=new Map(),added=[];
  const log={synthetic:true,model:'gpt-6-luna',startedAt:new Date().toISOString(),catalog:VSI_COST_CATALOG,ceilingUsd:allowance,reservedWorstCaseUsd:cases.length*reserve,
   estimatedCostUsd:0,uncertainReservedUsd:0,questions:[],humanReviewRequired:true,imageProcessorE2E:false};
  const save=()=>fs.writeFileSync(outputPath,JSON.stringify(log,null,2),{mode:0o600});
  try{
   for(const index of [0,2]){const actor=fixture.actors[index],client=createClient(config.apiUrl,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
    check(await client.auth.signInWithPassword({email:actor.email,password:actor.password}),'synthetic login');await authorizeVsiRead({supabase:client,workspaceId:actor.workspaceId,actorUserId:actor.id});sessions.set(index,client);}
   for(const [actorIndex,title,excerpt] of [[0,'June cancellation evidence','June 2026: 20 cancellations from 100 booked repairs, cancellation rate 20%. No cancellation reason records are included.'],
    [0,'September workshop returns ledger A','September 2026 workshop returns: 60. Scope: all workshop returns from September 1 through September 30, 2026.'],
    [0,'September workshop returns ledger B','September 2026 workshop returns: 80. Scope: all workshop returns from September 1 through September 30, 2026.'],
    [2,'Catering event profitability','September 2026 catering event: revenue $12,000; direct costs $8,400. Overhead, taxes and other business expenses are not provided.']]){
    const actor=fixture.actors[actorIndex],id=randomUUID();added.push({id,workspaceId:actor.workspaceId});
    check(await admin.from('file_uploads').insert({id,workspace_id:actor.workspaceId,original_name:'synthetic-vsi-qualification.csv',display_name:title,file_extension:'csv',mime_type:'text/csv',file_size_bytes:200,
     storage_bucket:'workspace-files',storage_path:`${actor.workspaceId}/vsi/${id}.csv`,metadata_json:{synthetic:true},created_by:actor.id}),'synthetic source');
    check(await admin.from('business_memory_chunks').insert({workspace_id:actor.workspaceId,source_type:'file',source_id:id,source_file_id:id,source_title:title,source_excerpt:excerpt,
     content_hash:createHash('sha256').update(id+excerpt).digest('hex'),source_metadata:{synthetic:true,evidence_classification:'business_evidence',review_status:'approved'},source_quality:'high',confidence_score:90}),'synthetic indexed source');
   }
   for(const test of cases){
    if(log.estimatedCostUsd+log.uncertainReservedUsd+reserve>allowance)throw Error('Qualification spending ceiling reached before dispatch.');
    const actor=fixture.actors[test.actor],started=Date.now();
    try{const answer=await runVsiAnswer({supabase:sessions.get(test.actor),workspaceId:actor.workspaceId,actorUserId:actor.id,question:test.question,recentMessages:[],requestId:randomUUID()});
     log.estimatedCostUsd+=answer.usage.estimatedCostUsd;log.questions.push({id:test.id,question:test.question,expectedQuality:test.expect,answer:answer.content,citations:answer.citations,
      usage:answer.usage,latencyMs:Date.now()-started,transportCompleted:true,humanGrade:null});}
    catch(error){const known=error instanceof VsiEngineError?error.usage:null;if(known)log.estimatedCostUsd+=known.estimatedCostUsd;
     if(!(error instanceof VsiEngineError)||error.accountingUncertain)log.uncertainReservedUsd+=reserve;
     log.questions.push({id:test.id,question:test.question,expectedQuality:test.expect,error:error instanceof Error?error.message:'Unavailable',usage:known,latencyMs:Date.now()-started,transportCompleted:false,humanGrade:null});}
    save();console.log(JSON.stringify({case:test.id,completed:log.questions.at(-1).transportCompleted,estimatedTotalUsd:log.estimatedCostUsd,uncertainReservedUsd:log.uncertainReservedUsd}));
   }
   log.finishedAt=new Date().toISOString();save();
  }finally{for(const source of added)await admin.from('file_uploads').update({deleted_at:new Date().toISOString()}).eq('workspace_id',source.workspaceId).eq('id',source.id);}
 }
 main().catch(error=>{console.error(error.message);process.exitCode=1});
}
