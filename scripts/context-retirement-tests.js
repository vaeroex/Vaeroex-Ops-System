const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
function load(file,mocks={}) {
 const filename=path.join(root,file), mod=new Module(filename,module);
 mod.filename=filename;mod.paths=module.paths;
 mod.require=name=>Object.hasOwn(mocks,name)?mocks[name]:name==='@/lib/search/retired-records'?load('lib/search/retired-records.ts'):name.startsWith('@/')?{}:require(name);
 mod._compile(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
 return mod.exports;
}
const retired=['app/app/accountability/actions.ts','app/app/intelligence/actions.ts','components/accountability/AccountabilityForms.tsx','components/intelligence/LeadershipDecisionJournal.tsx','components/intelligence/IntelligenceWorkspaceContext.tsx'];
test('obsolete creation modules and all customer controls are removed while historical schemas remain',()=>{
 for(const file of retired)assert.equal(fs.existsSync(path.join(root,file)),false,file);
 function walk(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.tsx?$/.test(f))assert.doesNotMatch(read(f),/createBusinessDecisionAction|shareRecordAction|createAssignmentAction|ShareRecordPanel|LeadershipDecisionJournal|Assignments &amp; shared context|Internal share records|Log Decision|Share \/ Distribute/,f);}}
 walk('app');walk('components');
 const search=read('app/api/search/route.ts');assert.doesNotMatch(search,/from\("(?:business_decisions|operational_assignments|record_shares)"\)/);
 assert.match(search,/private, no-store/);assert.match(read('components/app/GlobalSearch.tsx'),/visibleSearchGroups\(payload.groups/);
 for(const table of ['business_decisions','record_shares','operational_assignments'])assert.ok(read('lib/supabase/types.ts').includes(`${table}: {`));
 assert.doesNotMatch(read('app/app/kpis/page.tsx'),/record_shares|from\("people"\)|kpiShares/);
 assert.match(read('app/app/sources/SourcesPage.tsx'),/BusinessNote/);
});
test('stale search results and derived retired sources cannot reappear; content is never keyword-filtered',()=>{
 const {isRetiredSearchSource,visibleSearchGroups}=load('lib/search/retired-records.ts');
 for(const source of ['business_decisions','operational_assignment','record_shares','Decision Journal','Review Signal'])assert.equal(isRetiredSearchSource(source),true);
 for(const source of ['business_note','file_analysis','kpi','saved_analysis'])assert.equal(isRetiredSearchSource(source),false);
 const row=(sourceType,href='/app/sources')=>({id:sourceType,title:'Decision about sharing assignments',sourceType,href,preview:'Original content'});
 const groups=visibleSearchGroups([{label:'Review Signals',results:[row('Anything')]},{label:'Learned Knowledge',results:[row('Decision Journal'),row('Learned Knowledge','/app?view=Intelligence%20View#decision-journal'),row('business_note')]},{label:'KPIs',results:[row('KPI')]},{label:'Saved Analyses',results:[row('Saved Analysis')]},{label:'Files',results:[row('File')]}]);
 assert.deepEqual(groups.flatMap(g=>g.results.map(r=>r.sourceType)),['business_note','KPI','Saved Analysis','File']);
});
test('actual GET searches only current providers, excludes indexed retired sources, scopes reads and preserves unrelated results',async()=>{
 const queries=[];let workspace='w1';let user={id:'u1'};let subscribed=true;
 const rows={kpis:[{id:'k',name:'Decision KPI',workspace_id:'w1'}],reports:[{id:'r',workspace_id:'w1',source_data_json:{}}],file_uploads:[{id:'f',original_name:'Decision file',workspace_id:'w1'}],business_memory_chunks:[{id:'d',source_type:'business_decision',workspace_id:'w1'},{id:'a',source_type:'operational_assignment',workspace_id:'w1'},{id:'s',source_type:'record_share',workspace_id:'w1'},{id:'n',source_type:'business_note',source_title:'Decision note',workspace_id:'w1'}]};
 const db={auth:{getUser:async()=>({data:{user}})},from(table){assert.ok(!['business_decisions','record_shares','operational_assignments'].includes(table));const q={table,scope:null};queries.push(q);const builder=new Proxy({}, {get(_,key){if(key==='then')return resolve=>{assert.equal(q.scope,workspace);return Promise.resolve({data:(rows[table]||[]).filter(r=>r.workspace_id===workspace),error:null}).then(resolve)};return (...args)=>{if(key==='eq'&&args[0]==='workspace_id')q.scope=args[1];return builder}}});return builder;}};
 const {GET}=load('app/api/search/route.ts',{
 'next/server':{NextResponse:{json:(body,init)=>new Response(JSON.stringify(body),{...init,headers:{'content-type':'application/json',...init?.headers}})}},
 '@/lib/supabase/server':{createSupabaseServerClient:async()=>db},'@/lib/workspaces/current':{getWorkspaceContext:async()=>({activeWorkspace:{id:workspace},membership:{status:'active'}})},
 '@/lib/billing/get-subscription-status':{getSubscriptionStatus:async()=>({allowed:subscribed})},'@/lib/reports/release-channel':{currentSavedAnalysisReleaseChannel:()=> 'production'},
 '@/lib/security/rate-limit':{enforceRateLimit:async()=>({allowed:true})},'@/lib/easter-egg/discovery':{isEasterEggDiscoveryQuery:()=>false},'@/lib/security/security-response':{classifySecurityIntent:()=>({securitySensitive:false})},
 '@/lib/ai/query-depth-planner':{planVaeroexQuery:()=>({domains:[]})},'@/lib/intelligence/evidence-eligibility':{filterOriginalBusinessEvidence:r=>r},
 '@/lib/intelligence/source-parent-eligibility':{loadSourceParentEligibilityResult:async()=>({eligibility:{}}),filterBySourceParentEligibility:r=>r},
 '@/lib/reports/saved-analysis':{parseSavedAnalysisEnvelope:()=>({workspace_id:'w1',release_channel:'production',title:'Saved Decision analysis',display:{summary:'Synthetic'}})},
 '@/lib/ai/evidence-index':{filterEligibleMemoryRowsByLifecycle:async({rows})=>rows}
 });
 const request=()=>new Request('https://fixture.invalid/api/search?q=decision');
 let response=await GET(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual((await response.json()).groups.flatMap(g=>g.results.map(r=>r.id)),['k','r','f','n']);
 workspace='w2';assert.deepEqual((await(await GET(request())).json()).groups,[]);
 subscribed=false;assert.equal((await GET(request())).status,402);user=null;assert.equal((await GET(request())).status,401);
});
test('legacy Overview URLs authorize then reach current Intelligence without retired forms',async()=>{
 let guards=0;const Page=load('app/app/page.tsx',{'@/lib/workspaces/page-context':{requireWorkspacePage:async()=>{guards++}},'next/navigation':{redirect:url=>{throw Error(url)}}}).default;
 for(const view of ['Intelligence View','Operations View'])await assert.rejects(Page({searchParams:Promise.resolve({view})}),{message:`/app/intelligence?view=${encodeURIComponent(view).replace(/%20/g,'+')}`});
 assert.equal(guards,2);assert.doesNotMatch(read('app/app/intelligence/page.tsx'),/params\?\.view|leadership-decisions|decision-journal|WorkspaceContext/);
});
