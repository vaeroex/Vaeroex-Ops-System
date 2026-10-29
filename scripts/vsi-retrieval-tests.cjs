/* eslint-disable @typescript-eslint/no-require-imports -- Native local qualification loads project TypeScript without changing the application runtime. */
const assert=require('node:assert/strict'), fs=require('node:fs'), Module=require('node:module'), path=require('node:path'), ts=require('typescript');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){if(request==='server-only')return request;return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
require.cache['server-only']={id:'server-only',filename:'server-only',loaded:true,exports:{}};
const authority = require('../lib/integrations/google-sheets/read-authority.ts');
authority.beginGoogleSheetsRead = async () => ({ ticketId: 'synthetic-ticket' });
const boundSources=[];
authority.bindGoogleSheetsRead = async (_client,_ticket,sources) => {boundSources.push(...sources);return { ticketId: 'synthetic-ticket' }};
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
let reportReadError=false,legacyOnly=false;
const supabase={auth:{getUser:async()=>({data:{user},error:null})},from(table){const filters=[];queries.push({table,filters});const query={};
  for(const method of ['select','eq','is','not','contains','order','limit'])query[method]=(...args)=>{filters.push([method,...args]);return query};
  query.then=(success)=>{
    let data=[];
    if(table==='reports'){
      const projection=filters.find(([method])=>method==='select')[1];
      if(projection==='id') {assert(filters.some(([m,k,v])=>m==='is'&&k==='google_sheets_read_ticket_id'&&v===null));data=[{id:'legacy-report'}];}
      else {
        assert(filters.some(([m,k,op,v])=>m==='not'&&k==='google_sheets_read_ticket_id'&&op==='is'&&v===null),'report content must be filtered in the database before loading');
        data=legacyOnly?[]:[{id:'saved-1',title:'Saved receiving review',source_data_json:savedEnvelope,google_sheets_read_ticket_id:'attributed-ticket'}];
      }
    }
    return Promise.resolve({data,error:reportReadError?{message:'synthetic unavailable'}:null}).then(success);
  };return query}};
const access={supabase,user,context,workspace,workspaceId:'w-a',membership:context.membership};
const imageChunk={id:'chunk-image',workspace_id:'w-a',source_type:'file',source_id:'file-image',source_file_id:'file-image',
  source_title:'Approved warehouse image',source_excerpt:'The photographed receiving log records three deliveries on October 1.',indexed_at:'2026-10-02T00:00:00Z'};
function health(){return {consumedSources:[],errors:[],businessHealthSourceErrors:[],kpis:[{id:'image-kpi',source_file_id:'file-image',name:'Receiving image count',actual_value:3,target:3,metric_date:'2026-10-01',notes:null}],kpiSettings:[],intelligenceKpis:[],intelligenceKpiSettings:[],issues:[],sops:[],
  files:[{id:'file-image',created_at:'2026-10-01T00:00:00Z'}],imports:[],assets:[],crmLeads:[],crmHistory:[],operationalMetrics:[],intelligenceOperationalMetrics:[],people:[],decisions:[],
  memoryChunks:[{...imageChunk}],forms:[],submissions:[],sourceParentResult:{eligibility:{records:{files:[],imports:[]}},error:null}}}
require('../lib/intelligence/workspace-health.ts').loadWorkspaceHealthEvidence=async()=>health();
require('../lib/ai/evidence-index.ts').SupabasePgvectorCandidateRetriever=class{async retrieve(query){assert.equal(query.workspaceId,'w-a');assert.equal(query.strategy,'keyword_only');return {candidates:[{candidateId:imageChunk.id,title:imageChunk.source_title,excerpt:imageChunk.source_excerpt,
  source:{sourceType:'file',sourceId:'file-image',sourceFileId:'file-image'},provenance:{recordedAt:imageChunk.indexed_at}}]}}};
require('../lib/ai/business-notes/contextual-evidence.ts').loadApprovedBusinessNoteContextV1=async({workspaceId})=>{assert.equal(workspaceId,'w-a');return {records:[],error:null}};
const authorityCalls=[];
require('../lib/document-extraction/approval-guard.ts').assertDocumentExtractionAuthority=async(input)=>{authorityCalls.push(input);assert.equal(input.supabase,supabase);assert.equal(input.workspaceId,'w-a');return {eligible:approved}};
require('../lib/integrations/dashboard/server.ts').loadIntegrationDashboard=async({access:input})=>{assert.equal(input.user.id,'u-a');return {googleSheetsConnectionIds:[],dashboard:{entries:[],unavailable:[]}}};
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
  assert.match(allowed.limitations.join(' '),/without verified read-ticket attribution were excluded/);
  assert(boundSources.some(row=>row.table==='reports'&&row.id==='saved-1'));
  assert(!boundSources.some(row=>row.id==='legacy-report'),'metadata-only legacy records must not taint the consumed-source ticket');
  const kpiUrl=new URL(allowed.sources.find(row=>row.sourceType==='kpi').url,'https://example.test');
  assert.equal(kpiUrl.searchParams.get('metric'),'Receiving image count');assert.equal(kpiUrl.searchParams.get('section'),'detail');assert.equal(kpiUrl.hash,'#kpi-detail');
  const originalLineage=savedEnvelope.evidence_lineage;
  for(const href of ['/app/kpis?q=Receiving%20image%20count',kpiUrl.pathname+kpiUrl.search+kpiUrl.hash]) {
    savedEnvelope.evidence_lineage=[{href,recordedAt:'2026-10-01T00:00:00Z'}];
    assert((await retrieveVsiEvidence(access,'Our receiving metric')).sources.some(row=>row.sourceType==='saved_analysis'),'old/new exact metric links preserve valid attributed saved lineage');
  }
  for(const reference of [{href:'/app/kpis?q=Different%20metric',recordedAt:'2026-10-01T00:00:00Z'},
    {href:'/app/kpis?q=Receiving%20image%20count',recordedAt:'2026-09-01T00:00:00Z'},
    {href:'/app/kpis?q=Receiving%20image%20count&section=records',recordedAt:'2026-10-01T00:00:00Z'}]) {
    savedEnvelope.evidence_lineage=[reference];assert(!(await retrieveVsiEvidence(access,'Our receiving metric')).sources.some(row=>row.sourceType==='saved_analysis'));
  }
  savedEnvelope.evidence_lineage=originalLineage;
  // Exercise actual retrieval through the actual engine using a fake provider.
  // Attributed saved evidence survives; legacy report content is never fetched
  // and therefore cannot reach either the planner or answer transport.
  require('../lib/ai/providers/google-data-policy.ts').googleSheetsOpenAIHeaders=async()=>({});
  require('../lib/vsi/product-context.ts').loadVsiProductContext=async()=>({authoritative:{},sources:[],limitations:[]});
  // Preserve this legacy retrieval regression; dedicated suites cover shared admission.
  require('../lib/ai/shared-evidence/runtime-gate.ts').sharedEvidenceRuntimeEnabled=()=>false;
  require('../lib/ai/shared-evidence/qualitative-policy.ts').qualitativeSynthesisEnabled=()=>false;
  const {runVsiAnswer}=require('../lib/vsi/engine.ts');
  const payloads=[];process.env.OPENAI_API_KEY='synthetic-test-only';
  global.fetch=async(_url,init)=>{
    const body=JSON.parse(init.body),payload=JSON.parse(body.input[1].content);payloads.push(payload);
    assert(!init.body.includes('legacy-report'));
    const planner=body.text.format.name==='vsi_research_plan_v1';
    const source=payload.businessSources?.find(row=>row.sourceType==='saved_analysis');
    if(!planner) {assert(source);assert.match(source.text,/Receiving source summary/);assert.match(payload.evidenceLimitations.join(' '),/attribution/);}
    const output=planner?{mode:'answer',businessEvidence:true,tier:'simple',clarification:'',publicTargets:[],objectives:[]}:{content:`Historical receiving review [${source.id}].`,citationIds:[source.id]};
    return new Response(JSON.stringify({model:body.model,status:'completed',output_text:JSON.stringify(output),usage:{input_tokens:10,output_tokens:10}}),{status:200});
  };
  const generated=await runVsiAnswer({supabase,workspaceId:'w-a',actorUserId:'u-a',readTicket:{ticketId:'synthetic-ticket'},requestId:'synthetic-request',question:'What does our receiving image show?',recentMessages:[]});
  assert.equal(payloads.length,2);assert.equal(generated.citations[0].sourceId,'saved-1');
  legacyOnly=true;const legacyEvidence=await retrieveVsiEvidence(access,'What does our receiving image show?');
  assert(!legacyEvidence.sources.some(row=>row.sourceType==='saved_analysis'));assert.match(legacyEvidence.limitations.join(' '),/attribution/);legacyOnly=false;
  reportReadError=true;const unavailable=await retrieveVsiEvidence(access,'What does our receiving image show?');
  assert(!unavailable.sources.some(row=>row.sourceType==='saved_analysis'));assert.match(unavailable.limitations.join(' '),/could not be checked/);reportReadError=false;
  approved=false;const revoked=await retrieveVsiEvidence(access,'What does the receiving image show?','2026-10-08T00:00:00Z');
  assert.equal(revoked.sources.some(row=>['file','kpi','saved_analysis','business_health'].includes(row.sourceType)),false);assert.match(revoked.limitations.join(' '),/approval/);
  assert.ok(authorityCalls.length>=2);
  for(const query of queries)assert.ok(query.filters.some(([method,key,value])=>method==='eq'&&key==='workspace_id'&&value==='w-a'));
  console.log(JSON.stringify({passed:true,suite:'VSI authorization, attribution before report content retrieval, valid report retained through generation, unavailable/legacy exclusion, metric citation target, revoked extraction exclusion',paidProviderCalls:0,fakeProviderCalls:payloads.length}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
