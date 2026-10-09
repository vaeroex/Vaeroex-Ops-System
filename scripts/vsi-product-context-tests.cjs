/* eslint-disable @typescript-eslint/no-require-imports -- Exercise production TypeScript and existing authorization helpers without providers. */
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){if(request==='server-only')return request;return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...rest)};
require.cache['server-only']={id:'server-only',filename:'server-only',loaded:true,exports:{}};
const {loadVsiProductContext,VSI_PRODUCT_CONTEXT_MAX_CHARS}=require('../lib/vsi/product-context.ts');
const {VAEROEX_PLAN_PRICE_LABEL,VAEROEX_PLAN_FEATURES,VAEROEX_PLAN_LIMITS}=require('../lib/billing/plans.ts');
const workspaceId='11111111-1111-4111-8111-111111111111',actorId='22222222-2222-4222-8222-222222222222';
const user={id:actorId,email:'vsi-product-fixture@example.test'};
let workspace,context,subscription,dbFailure,authFailure,dashboard,connectionsRead;
const queried=[];
const supabase={auth:{getUser:async()=>({data:{user:authFailure?null:user},error:authFailure?new Error('signed_out'):null})},from(table){const filters=[];queried.push({table,filters});const q={};for(const method of ['select','eq','or','order'])q[method]=(...args)=>{filters.push([method,...args]);return q};const result=()=>({data:dbFailure?null:table==='workspaces'?workspace:table==='customer_subscriptions'?[subscription]:[],error:dbFailure?{message:'database private diagnostic'}:null});q.maybeSingle=async()=>result();q.then=(success,failure)=>Promise.resolve(result()).then(success,failure);return q;}};
require('../lib/workspaces/current.ts').getWorkspaceContext=async(id,{supabase:client,user:actor})=>{assert.equal(id,workspaceId);assert.equal(client,supabase);assert.equal(actor.id,actorId);return context};
require('../lib/integrations/dashboard/server.ts').loadIntegrationDashboard=async({access,eligibleKpis})=>{connectionsRead++;assert.equal(access.workspaceId,workspaceId);assert.equal(access.membership.role,context.membership.role);assert.deepEqual(eligibleKpis,[]);if(dashboard instanceof Error)throw dashboard;return dashboard};
function baseDashboard(){return {loadFailed:false,dashboard:{workspaceId,observedAt:'2026-10-08T00:00:00Z',timeZone:'UTC',timeZoneConfirmed:false,preferencesAvailable:true,entries:[],unavailable:[]}};}
function entry(provider,name='Saved connection',overrides={}){const key=provider==='Google Sheets'?'google_sheets':provider==='Square'?'square':'quickbooks_online';return {key:`${key}:${'a'.repeat(64)}`,provider,name,href:'/app/integrations',connectionState:'connected',lastSuccessfulRefreshAt:'2026-10-01T00:00:00Z',currentUntil:'2026-10-01T00:15:00Z',freshness:'current',unchangedCheck:false,cadence:'Every15minutes',results:[{label:'PRIVATE financial result',value:'987654321',period:'secret period',href:'/app/integrations',limitation:null}],hidden:false,...overrides};}
function reset(){workspace={id:workspaceId,name:'Synthetic Bicycle Store',industry:'Bicycle repair',size:'private-size',primary_contact_email:'private-contact@example.test',subscription_status:'active',subscription_required:true,manually_unlocked:false,trial_ends_at:null,plan_slug:'vaeroex'};context={profile:null,workspaces:[workspace],activeWorkspace:workspace,membership:{workspace_id:workspaceId,user_id:actorId,role:'owner',status:'active'}};subscription={id:'private-subscription-id',workspace_id:workspaceId,billing_provider:'stripe',manually_activated:false,status:'active',current_period_end:'2099-01-01T00:00:00Z',stripe_customer_id:'private-stripe-customer',stripe_subscription_id:'private-stripe-subscription',plan_slug:'vaeroex',subscription_plans:{slug:'vaeroex',name:'Vaeroex',features_json:[],...VAEROEX_PLAN_LIMITS}};dbFailure=false;authFailure=false;dashboard=baseDashboard();connectionsRead=0;}
const access=()=>({supabase,user,context,workspace,workspaceId,membership:context.membership});
let assertions=0;
const check=(condition,message)=>{assert.ok(condition,message);assertions++;};
async function rejected(run,pattern){await assert.rejects(run,pattern);assertions++;}
async function main(){
 reset();let result=await loadVsiProductContext(access());
 check(result.authoritative.company.legalName==='Vaeroex LLC','canonical legal identity');
 check(result.authoritative.assistant.model==='gpt-6-luna','actual configured model');
 check(result.authoritative.company.name!=='Synthetic Bicycle Store','workspace is not company identity');
 check(result.authoritative.publishedPlan.price===VAEROEX_PLAN_PRICE_LABEL,'canonical price');
 assert.deepEqual(result.authoritative.publishedPlan.advertisedFeatures,[...VAEROEX_PLAN_FEATURES]);assertions++;
 assert.deepEqual(result.authoritative.publishedPlan.limits,VAEROEX_PLAN_LIMITS);assertions++;
 check(result.authoritative.entitlement.actualChargeOrDiscount.includes('Unknown'),'published price is not invoice');
 check(result.authoritative.productSystems.some(s=>s.availability==='under_development'),'development products not claimed available');
 check(result.sources.some(s=>s.id==='P2'&&s.url==='https://www.vaeroex.com/pricing'),'price citation');
 check(result.sources.every(s=>s.id.startsWith('P')&&s.retrievedAt&&s.evidenceDate===null),'product sources are lookup dated, not invented publication dates');
 check(result.publicResearchProfile===null&&result.publicResearchProfileStatus==='not_configured','no implied public export authority');
 check(result.authoritative.workspace.website===null&&result.authoritative.workspace.city===null,'unsupported fields unknown');
 check(!JSON.stringify(result).includes('private-stripe')&&!JSON.stringify(result).includes('private-contact')&&!JSON.stringify(result).includes('private-subscription')&&!JSON.stringify(result).includes('private-size'),'private billing and contacts omitted');
 check(JSON.stringify(result).length<=VSI_PRODUCT_CONTEXT_MAX_CHARS,'bounded complete context');
 check(result.authoritative.connections.entries.length===0&&result.authoritative.connections.interpretation.includes('not prove no connection'),'empty saved state is not global absence');
 for(const source of queried)check(source.table==='workspaces'||source.table==='customer_subscriptions','no notes/intakes/files queried for public identifiers');

 const staleAccess=access();context={...context,membership:{...context.membership,role:'viewer'}};
 dashboard.dashboard.entries=[entry('QuickBooks','PRIVATE_OWNER_QBO'),entry('Square','PRIVATE_OWNER_SQUARE'),entry('Google Sheets','Visible Sheets'),entry('Google Sheets','HIDDEN_SHEETS',{hidden:true})];
 result=await loadVsiProductContext(staleAccess);
 check(result.authoritative.permissions.role==='viewer'&&!result.authoritative.permissions.canEditBusinessNotes&&!result.authoritative.permissions.canManageIntegrations,'current role overrides stale caller role');
 check(result.authoritative.connections.entries.length===1&&result.authoritative.connections.entries[0].provider==='Google Sheets','owner-only and hidden integration records excluded');
 check(result.authoritative.connections.entries[0].freshness==='Stale','expired currentUntil is not current');
 check(!JSON.stringify(result).includes('PRIVATE_OWNER')&&!JSON.stringify(result).includes('PRIVATE financial')&&!JSON.stringify(result).includes('987654321'),'connection context contains no provider results');
 for(const role of ['admin','manager','staff']){context.membership.role=role;result=await loadVsiProductContext(staleAccess);check(result.authoritative.permissions.canEditBusinessNotes&&!result.authoritative.permissions.canManageIntegrations,`${role} note/integration permissions`);}

 reset();dashboard.loadFailed=true;result=await loadVsiProductContext(access());check(result.authoritative.connections.state==='unavailable'&&result.authoritative.connections.entries.length===0,'dashboard failure fail closed');
 reset();dashboard.dashboard.workspaceId='33333333-3333-4333-8333-333333333333';result=await loadVsiProductContext(access());check(result.authoritative.connections.state==='unavailable','cross-workspace dashboard rejected');
 reset();dashboard=new Error('PRIVATE_PROVIDER_ERROR');result=await loadVsiProductContext(access());check(result.authoritative.connections.state==='unavailable'&&!JSON.stringify(result).includes('PRIVATE_PROVIDER_ERROR'),'thrown diagnostic not disclosed');
 reset();dashboard.dashboard.entries=[entry('Google Sheets','Future state',{connectionState:'unexpected'})];result=await loadVsiProductContext(access());check(result.authoritative.connections.state==='unavailable','unknown state fail closed');

 for(const status of ['past_due','unpaid','canceled','incomplete','expired','manual_review']){reset();subscription.status=status;await rejected(loadVsiProductContext(access()),/active subscription/);check(connectionsRead===0,`${status} cannot load connection context`);}
 reset();subscription.current_period_end='2020-01-01T00:00:00Z';await rejected(loadVsiProductContext(access()),/active subscription/);
 reset();dbFailure=true;await rejected(loadVsiProductContext(access()),/active subscription/);
 reset();authFailure=true;await rejected(loadVsiProductContext(access()),/Sign in/);
 reset();context.membership.status='disabled';await rejected(loadVsiProductContext(access()),/no longer have access/);
 reset();context.membership.user_id='other-actor';await rejected(loadVsiProductContext(access()),/no longer have access/);
 reset();context.activeWorkspace={...workspace,id:'other-workspace'};await rejected(loadVsiProductContext(access()),/no longer have access/);

 reset();subscription.status='trialing';result=await loadVsiProductContext(access());check(result.authoritative.entitlement.status==='trialing'&&result.authoritative.entitlement.allowed,'valid trial authoritative');
 reset();subscription.billing_provider='manual';subscription.manually_activated=true;workspace.manually_unlocked=true;result=await loadVsiProductContext(access());check(result.authoritative.entitlement.source==='manual'&&result.authoritative.entitlement.actualChargeOrDiscount.includes('Unknown'),'manual activation not proof of charged price');
 reset();subscription.billing_provider='manual';subscription.manually_activated=false;workspace.subscription_status='demo';workspace.name='Urban Outfitters Demo';result=await loadVsiProductContext(access());check(result.authoritative.workspace.kind==='demo'&&result.authoritative.company.legalName==='Vaeroex LLC','demo business never substitutes platform company');
 reset();subscription.plan_slug='unknown-enterprise';subscription.subscription_plans={...subscription.subscription_plans,slug:'unknown-enterprise',name:'UNVERIFIED CUSTOM PLAN',max_users:999};result=await loadVsiProductContext(access());check(result.authoritative.entitlement.planName===null&&result.authoritative.entitlement.planLimits===null,'unknown plan no invented features/limits');
 reset();workspace.name='Vaeroex';workspace.industry=null;result=await loadVsiProductContext(access());check(result.publicResearchProfile===null&&result.authoritative.workspace.industry===null&&result.authoritative.company.ownershipOrFounders.includes('Not established'),'matching name proves no company ownership/public permission');
 // Fingerprints cover exact authoritative facts, not constant citation labels.
 reset();dashboard.dashboard.entries=[entry('QuickBooks')];const connected=await loadVsiProductContext(access());
 const hash=(value,id)=>value.sources.find(source=>source.id===id).snapshotHash;
 const repeated=await loadVsiProductContext(access());
 assert.deepEqual(repeated.sources.map(source=>source.snapshotHash),connected.sources.map(source=>source.snapshotHash));assertions++;
 check(connected.sources.every(source=>/^[a-f0-9]{64}$/.test(source.snapshotHash)),'all product snapshots valid');
 const a=connected.authoritative;const facts=[{company:a.company,productSystems:a.productSystems},a.publishedPlan,a.entitlement,
  {workspace:a.workspace,permissions:a.permissions,connections:a.connections},a.navigation,{assistant:a.assistant,vsiAllowance:a.vsiAllowance}];
 facts.forEach((value,index)=>check(connected.sources[index].snapshotHash===createHash('sha256').update(JSON.stringify(value)).digest('hex'),'source '+(index+1)+' fingerprints complete relevant facts'));
 dashboard.dashboard.entries[0].connectionState='disconnected';result=await loadVsiProductContext(access());
 check(hash(result,'P4')!==hash(connected,'P4'),'connection change invalidates earlier connected claim');
 check(hash(result,'P2')===hash(connected,'P2'),'connection change leaves unrelated published plan stable');
 dashboard.dashboard.entries=[];result=await loadVsiProductContext(access());check(hash(result,'P4')!==hash(connected,'P4'),'connection removal invalidates previous source');
 context.membership.role='viewer';result=await loadVsiProductContext(access());check(hash(result,'P4')!==hash(connected,'P4'),'role change invalidates previous source');
 reset();const beforePlan=await loadVsiProductContext(access());const savedLimit=VAEROEX_PLAN_LIMITS.max_files;
 try{VAEROEX_PLAN_LIMITS.max_files=savedLimit+1;result=await loadVsiProductContext(access());check(hash(result,'P2')!==hash(beforePlan,'P2'),'published limit change invalidates old plan snapshot');}
 finally{VAEROEX_PLAN_LIMITS.max_files=savedLimit;}
 VAEROEX_PLAN_FEATURES.push('Synthetic future feature');
 try{result=await loadVsiProductContext(access());check(hash(result,'P2')!==hash(beforePlan,'P2'),'published feature change invalidates old plan snapshot');}
 finally{VAEROEX_PLAN_FEATURES.pop();}
 subscription.status='trialing';result=await loadVsiProductContext(access());check(hash(result,'P3')!==hash(beforePlan,'P3'),'entitlement status change invalidates old subscription source');
 reset();workspace.name='x'.repeat(1000);workspace.industry='y'.repeat(1000);dashboard.dashboard.entries=Array.from({length:8},(_,i)=>entry('Google Sheets',String(i)+'z'.repeat(500)));result=await loadVsiProductContext(access());check(JSON.stringify(result).length<=VSI_PRODUCT_CONTEXT_MAX_CHARS,'long labels/connections remain bounded');
 check(hash(result,'P4')===createHash('sha256').update(JSON.stringify({workspace:result.authoritative.workspace,permissions:result.authoritative.permissions,connections:result.authoritative.connections})).digest('hex'),'snapshot reflects final bounded connection facts');
 console.log(JSON.stringify({passed:true,suite:'VSI maintained product context, identity separation, authoritative subscription, permissions, connection failure and public disclosure boundary',assertions,paidProviderCalls:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
