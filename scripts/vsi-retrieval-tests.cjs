/* eslint-disable @typescript-eslint/no-require-imports -- Native local qualification loads project TypeScript without changing the application runtime. */
const assert=require('node:assert/strict'), fs=require('node:fs'), Module=require('node:module'), path=require('node:path'), ts=require('typescript');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){if(request==='server-only')return request;return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
require.cache['server-only']={id:'server-only',filename:'server-only',loaded:true,exports:{}};
const {authorizeVsiRead,retrieveVsiEvidence,publicVsiExcerpt}=require('../lib/vsi/retrieval.ts');
const workspace={id:'w-a',name:'Synthetic repairs'},user={id:'u-a',email:'synthetic@example.test'};
let context={profile:null,workspaces:[workspace],activeWorkspace:workspace,membership:{workspace_id:'w-a',user_id:'u-a',role:'owner',status:'active'}};
let entitled=true,approved=true;
require('../lib/workspaces/current.ts').getWorkspaceContext=async()=>context;
require('../lib/billing/get-subscription-status.ts').getSubscriptionStatus=async()=>({allowed:entitled});
const queries=[];
const savedEnvelope={workspace_id:'w-a',release_channel:'development',evidence_lineage:[{href:'/app/sources/file-image',recordedAt:'2026-10-01T00:00:00Z'}],citations:[],
 display:{summary:'Receiving source summary',sections:[],evidence_status:'Current'},freshness:'current',confidence:'Low',generated_at:'2026-10-02T00:00:00Z'};
require('../lib/reports/saved-analysis.ts').parseSavedAnalysisEnvelope=value=>value;
const supabase={auth:{getUser:async()=>({data:{user},error:null})},from(table){const filters=[];queries.push({table,filters});const query={};
  for(const method of ['select','eq','is','contains','order','limit'])query[method]=(...args)=>{filters.push([method,...args]);return query};
  query.then=(success)=>Promise.resolve({data:table==='reports'?[{id:'saved-1',title:'Saved receiving review',source_data_json:savedEnvelope}]:[],error:null}).then(success);return query}};
const access={supabase,user,context,workspace,workspaceId:'w-a',membership:context.membership};
const imageChunk={id:'chunk-image',workspace_id:'w-a',source_type:'file',source_id:'file-image',source_file_id:'file-image',
  source_title:'Approved warehouse image',source_excerpt:'The photographed receiving log records three deliveries on October 1.',indexed_at:'2026-10-02T00:00:00Z'};
function health(){return {errors:[],businessHealthSourceErrors:[],kpis:[{id:'image-kpi',source_file_id:'file-image',name:'Receiving image count',actual_value:3,target:3,metric_date:'2026-10-01',notes:null}],kpiSettings:[],intelligenceKpis:[],intelligenceKpiSettings:[],issues:[],sops:[],
  files:[{id:'file-image',created_at:'2026-10-01T00:00:00Z'}],imports:[],assets:[],crmLeads:[],crmHistory:[],operationalMetrics:[],intelligenceOperationalMetrics:[],people:[],decisions:[],
  memoryChunks:[{...imageChunk}],forms:[],submissions:[],sourceParentResult:{eligibility:{records:{files:[],imports:[]}},error:null}}}
require('../lib/intelligence/workspace-health.ts').loadWorkspaceHealthEvidence=async()=>health();
require('../lib/ai/evidence-index.ts').SupabasePgvectorCandidateRetriever=class{async retrieve(query){assert.equal(query.workspaceId,'w-a');assert.equal(query.strategy,'keyword_only');return {candidates:[{candidateId:imageChunk.id,title:imageChunk.source_title,excerpt:imageChunk.source_excerpt,
  source:{sourceType:'file',sourceId:'file-image',sourceFileId:'file-image'},provenance:{recordedAt:imageChunk.indexed_at}}]}}};
require('../lib/ai/business-notes/contextual-evidence.ts').loadApprovedBusinessNoteContextV1=async({workspaceId})=>{assert.equal(workspaceId,'w-a');return {records:[],error:null}};
const authorityCalls=[];
require('../lib/document-extraction/approval-guard.ts').assertDocumentExtractionAuthority=async(input)=>{authorityCalls.push(input);assert.equal(input.supabase,supabase);assert.equal(input.workspaceId,'w-a');return {eligible:approved}};
require('../lib/integrations/dashboard/server.ts').loadIntegrationDashboard=async({access:input})=>{assert.equal(input.user.id,'u-a');return {dashboard:{entries:[],unavailable:[]}}};
require('../lib/intelligence/operational-evidence.ts').buildOperationalEvidenceInsights=({memoryChunks})=>{if(!approved)assert.equal(memoryChunks.length,0);return []};
require('../lib/intelligence/layer.ts').buildIntelligenceLayer=()=>({businessHealth:{available:false},executiveSummary:'Insufficient data',dataQuality:{},forecastReadiness:{},insights:[]});
async function main(){
  assert.equal(publicVsiExcerpt('kpi',JSON.stringify({name:'Repair time',value:3.8,target:2,date:'2026-10-01',sourceFileId:'private-id',semantics:{unit:'days'}})), 'Repair time: 3.8 days; target 2 days. Recorded 2026-10-01.');
  assert.equal(publicVsiExcerpt('kpi',JSON.stringify({name:'One-star reviews',value:'37',target:'0',semantics:{unit:'count'}})), 'One-star reviews: 37 count; target 0 count.');
  assert.equal(publicVsiExcerpt('business_note',JSON.stringify({reportedContext:'We repair bicycles.',statements:[]})), 'Reported context: We repair bicycles.');
  assert.equal(publicVsiExcerpt('saved_analysis',JSON.stringify({summary:'Historical review.',source_artifact:{id:'private-id'}})), 'Historical review.');
  const args={supabase,workspaceId:'w-a',actorUserId:'u-a'};
  assert.equal((await authorizeVsiRead(args)).workspaceId,'w-a');
  await assert.rejects(authorizeVsiRead({...args,actorUserId:'u-b'}),/Sign in/);
  await assert.rejects(authorizeVsiRead({...args,workspaceId:'w-b'}),/no longer have access/);
  context={...context,membership:{...context.membership,status:'removed'}};await assert.rejects(authorizeVsiRead(args),/no longer have access/);
  context={...context,membership:{...context.membership,status:'active'}};entitled=false;await assert.rejects(authorizeVsiRead(args),/active subscription/);entitled=true;
  const allowed=await retrieveVsiEvidence(access,'What does the receiving image show?','2026-10-08T00:00:00Z');
  const image=allowed.sources.find(row=>row.sourceType==='file');assert.ok(image);assert.equal(image.sourceId,'file-image');assert.equal(image.url,'/app/sources/file-image');
  assert.equal(image.evidenceDate,'2026-10-01T00:00:00Z');assert.match(image.text,/three deliveries/);assert(allowed.sources.some(row=>row.sourceType==='saved_analysis'));assert(allowed.sources.some(row=>row.sourceType==='kpi'));
  approved=false;const revoked=await retrieveVsiEvidence(access,'What does the receiving image show?','2026-10-08T00:00:00Z');
  assert.equal(revoked.sources.some(row=>['file','kpi','saved_analysis','business_health'].includes(row.sourceType)),false);assert.match(revoked.limitations.join(' '),/approval/);
  assert.ok(authorityCalls.length>=2);
  for(const query of queries)assert.ok(query.filters.some(([method,key,value])=>method==='eq'&&key==='workspace_id'&&value==='w-a'));
  console.log(JSON.stringify({passed:true,suite:'VSI authenticated authorization, workspace/entitlement denial, approved image source and revoked extraction exclusion',paidProviderCalls:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
