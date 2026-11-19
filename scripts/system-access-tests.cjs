/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic auth/catalog fixtures; no hosted services. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = process.cwd();
let fixture, calls;
function reset(extra={}) { fixture={ user:{id:'fixture-user',email:'fixture@example.invalid',app_metadata:{}}, memberships:[], subscriptions:[], preferred:null, ...extra }; calls=[]; }
const workspace=(id,extra={})=>({id,name:`Fixture ${id}`,subscription_required:true,subscription_status:'active',...extra});
const member=(w,extra={})=>({id:`m-${w.id}`,user_id:'fixture-user',workspace_id:w.id,status:'active',workspaces:w,...extra});
const stripe=(id,extra={})=>({id:`s-${id}`,workspace_id:id,user_id:'fixture-user',billing_provider:'stripe',status:'active',manually_activated:false,current_period_end:'2100-01-01T00:00:00Z',stripe_customer_id:'fixture-customer',stripe_subscription_id:'fixture-subscription',...extra});
const db={auth:{getUser:async()=>({data:{user:fixture.user}}),signInWithPassword:async input=>{calls.push(['signIn',input]);return {error:fixture.authError||null}},signOut:async()=>{calls.push(['signOut']);return{}},resetPasswordForEmail:async(...args)=>{calls.push(['reset',...args]);return{error:null}},exchangeCodeForSession:async code=>({error:code==='fixture-code'?null:{message:'invalid'}})},rpc:async name=>{calls.push(['rpc',name]);return{error:null}},from(table){
 let filters=[];
 const q={select(){return q},eq(k,v){filters.push([k,v]);return q},or(){return q},order(){return q},maybeSingle:async()=>{const r=await q;return {...r,data:r.data[0]||null}},then(resolve,reject){
 let rows=table==='workspace_members'?fixture.memberships:table==='workspaces'?fixture.memberships.map(m=>m.workspaces):table==='customer_subscriptions'?fixture.subscriptions:[];
 rows=rows.filter(row=>filters.every(([k,v])=>row[k]===v));return Promise.resolve({data:rows,error:fixture.dbError?{message:'synthetic failure'}:null}).then(resolve,reject);
 }};return q;
}};
function redirect(url){throw Object.assign(new Error('redirect'),{url})}
const cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file).exports;
 const loadedModule={exports:{}};cache.set(file,loadedModule);
 const mocks={'server-only':{},'next/link':{__esModule:true,default:({children,href,...props})=>React.createElement('a',{href,...props},children)},'next/navigation':{redirect},'next/headers':{cookies:async()=>({get:()=>fixture.preferred?{value:fixture.preferred}:undefined,set:(...args)=>calls.push(['cookie',...args])})},'next/server':{NextResponse:{redirect:url=>({location:String(url)})}},'@/lib/supabase/server':{createSupabaseServerClient:async()=>db},'@/lib/supabase/config':{getAppUrl:()=> 'https://fixture.invalid'},'@/lib/admin/admin-emails':{isVaeroexAdminUser:()=>false,isVaeroexAdminEmail:()=>false}};
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module:loadedModule,exports:loadedModule.exports,console,FormData,URL,URLSearchParams,process:{env:{}},require(spec){if(spec in mocks)return mocks[spec];if(spec.startsWith('@/')||spec.startsWith('.')){let base=spec.startsWith('@/')?spec.slice(2):path.join(path.dirname(file),spec);const target=[base,base+'.ts',base+'.tsx'].find(f=>fs.existsSync(path.join(root,f)));return load(target)}return require(spec)}},{filename:file});return loadedModule.exports;
}
(async()=>{
 reset(); const {loadSystemAccess}=load('lib/systems/access.ts');const routing=load('lib/systems/routing.ts');const {SYSTEM_CATALOG}=load('lib/systems/catalog.ts');const {SystemsCatalog}=load('components/systems/SystemsCatalog.tsx');
 const cases=[
 ['no membership',{},0],
 ['unpaid',{memberships:[member(workspace('a'))]},0],
 ['workspace label alone',{memberships:[member(workspace('a',{manually_unlocked:true}))]},0],
 ['active Stripe',{memberships:[member(workspace('a'))],subscriptions:[stripe('a')]},1],
 ['expired Stripe',{memberships:[member(workspace('a'))],subscriptions:[stripe('a',{current_period_end:'2000-01-01'})]},0],
 ['unverified Stripe IDs',{memberships:[member(workspace('a'))],subscriptions:[stripe('a',{stripe_subscription_id:null})]},0],
 ['Stripe overrides nonrequired flag',{memberships:[member(workspace('a',{subscription_required:false}))],subscriptions:[stripe('a',{status:'past_due'})]},0],
 ['manual activation',{memberships:[member(workspace('a',{manually_unlocked:true}))],subscriptions:[stripe('a',{billing_provider:'manual',manually_activated:true})]},1],
 ['expired trial',{memberships:[member(workspace('a',{subscription_status:'trialing',trial_ends_at:'2000-01-01'}))]},0],
 ['inactive membership',{memberships:[member(workspace('a',{subscription_required:false}),{status:'inactive'})]},0],
 ['foreign membership',{memberships:[member(workspace('a',{subscription_required:false}),{user_id:'other-user'})]},0],
 ['demo denied to ordinary user',{memberships:[member(workspace('a',{subscription_status:'demo'}))]},0],
 ['database failure',{memberships:[member(workspace('a'))],dbError:true},0],
 ];
 const results=[];
 for(const [name,data,count] of cases){reset(data);const access=await loadSystemAccess(db,fixture.user);assert.equal(routing.accessibleSystemLinks(access.decisions).length,count,name);results.push({name,passed:true});}
 reset({subscriptions:[stripe('future-setup')]});assert.equal((await loadSystemAccess(db,fixture.user)).needsWorkspaceSetup,true);
 reset({preferred:'b',memberships:[member(workspace('a',{subscription_required:false})),member(workspace('b'))]});let access=await loadSystemAccess(db,fixture.user);assert.equal(access.activeAllowed,false);assert.match(access.reason,/Choose an accessible workspace/);
 reset({preferred:'foreign',memberships:[member(workspace('a',{subscription_required:false}))]});assert.equal((await loadSystemAccess(db,fixture.user)).activeAllowed,true);
 const {default:AccessPage}=load('app/access/page.tsx');
 for(const preferred of [null,'a','foreign']){reset({preferred,memberships:[member(workspace('a',{subscription_required:false}))]});await assert.rejects(AccessPage(),e=>e.url==='/systems');}
 const {default:Chooser}=load('app/systems/page.tsx');
 for(const memberships of [[],[member(workspace('a',{subscription_required:false}))],[member(workspace('a',{subscription_required:false})),member(workspace('b',{subscription_required:false}))]]){
   reset({memberships,preferred:'a'});const html=renderToStaticMarkup(await Chooser());assert.match(html,/Choose a system to get started\./);assert.equal((html.match(/<article/g)||[]).length,3);assert.equal(calls.filter(c=>c[0]==='cookie').length,0);
 }
 const one={id:'executive-intelligence',name:'Vaeroex Executive Intelligence',href:'/app/intelligence',available:true,allowed:true};
 const second={id:'fixture-second',name:'Synthetic second system',href:'/fixture-second',available:true,allowed:true};
 const upcoming={id:'biological-intelligence',name:'Biological Intelligence',href:'/not-a-real-system',available:false,allowed:true};
 assert.equal(routing.accessibleSystemLinks([one,one]).length,1);
 for(const [name,decisions] of [['zero',[]],['one',[one]],['multiple',[one,second,upcoming]]]){
 const html=renderToStaticMarkup(React.createElement(SystemsCatalog,{decisions,reason:`SYNTHETIC ${name}-access fixture. No customer data or authorization.`}));
 const articles=html.match(/<article\b[\s\S]*?<\/article>/g);assert.equal(articles.length,3);for(const card of articles.slice(1)){assert.match(card,/In Development/);assert.doesNotMatch(card,/<a\b|<button\b|<form\b/)}
 assert.equal(html.includes('Switch system'),name==='multiple');assert.equal(html.includes('href="/not-a-real-system"'),false);
 if(process.env.SYSTEMS_FIXTURE_DIR){fs.mkdirSync(process.env.SYSTEMS_FIXTURE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.SYSTEMS_FIXTURE_DIR,`${name}.html`),`<!doctype html><html class="dark pulsar" data-theme="pulsar"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated ${name} system fixture</title><link rel="stylesheet" href="/style.css"></head><body><main class="min-h-screen bg-slate-50 p-5 text-slate-900"><div class="mx-auto max-w-7xl">${html}</div></main></body></html>`)}
 }
 assert.equal(SYSTEM_CATALOG.length,3);assert.equal(SYSTEM_CATALOG.filter(x=>x.status==='available').length,1);
 // Actual auth handlers with only synthetic SDK transport; no network or emails.
 const actions=load('lib/auth/actions.ts');const {safeAuthRedirectPath}=load('lib/auth/safe-redirect.ts');
 for(const next of ['', '//attacker.invalid','/%255cattacker.invalid','https://attacker.invalid'])assert.equal(safeAuthRedirectPath(next),'/systems');
 for(const next of ['/app/sources?file=fixture#review','/checkout/legal','/reset-password'])assert.equal(safeAuthRedirectPath(next),next);
 reset();let form=new FormData();form.set('email','fixture@example.invalid');form.set('password','synthetic-only');
 await assert.rejects(actions.signInAction(form),e=>e.url==='/systems');assert.equal(calls[0][0],'signIn');assert.equal(calls[1][1],'accept_workspace_invites_for_current_user');
 await assert.rejects(actions.signOutAction(),e=>e.url==='/login');await assert.rejects(actions.signInAction(form),e=>e.url==='/systems');
 form.set('next','/app/sources?file=fixture');await assert.rejects(actions.signInAction(form),e=>e.url==='/app/sources?file=fixture');
 fixture.authError={message:'synthetic rejection'};await assert.rejects(actions.signInAction(form),e=>e.url.startsWith('/login?error='));
 await assert.rejects(actions.signOutAction(),e=>e.url==='/login');assert.ok(calls.some(c=>c[0]==='signOut'));
 await assert.rejects(actions.forgotPasswordAction(form),e=>e.url.startsWith('/forgot-password?message='));assert.ok(calls.some(c=>c[0]==='reset'&&c[2].redirectTo==='https://fixture.invalid/auth/callback?next=/reset-password'));
 const callback=load('app/auth/callback/route.ts');
 assert.equal((await callback.GET({url:'https://fixture.invalid/auth/callback?code=fixture-code'})).location,'https://fixture.invalid/systems');
 for(const next of ['/reset-password','/app/setup','/checkout/legal','/app/intelligence?finding=fixture'])assert.equal((await callback.GET({url:'https://fixture.invalid/auth/callback?code=fixture-code&next='+encodeURIComponent(next)})).location,'https://fixture.invalid'+next);
assert.equal((await callback.GET({url:'https://fixture.invalid/auth/callback?code=fixture-code&next=%2Fapp%2Fsources'})).location,'https://fixture.invalid/app/sources');assert.equal((await callback.GET({url:'https://fixture.invalid/auth/callback?code=fixture-code&next=https://attacker.invalid'})).location,'https://fixture.invalid/systems');
 const {selectWorkspaceAction}=load('lib/workspaces/actions.ts');reset({memberships:[member(workspace('a',{subscription_required:false}))]});
 const selection=new FormData();selection.set('workspace_id','a');await assert.rejects(selectWorkspaceAction(selection),e=>e.url.startsWith('/app/intelligence?message='));assert.equal(calls.filter(c=>c[0]==='cookie').length,1);
 calls=[];selection.set('workspace_id','foreign');await assert.rejects(selectWorkspaceAction(selection),e=>e.url.startsWith('/app/intelligence?error='));assert.equal(calls.length,0);
 // Destination gates and workspace switch keep their established authority.
 const read=f=>fs.readFileSync(path.join(root,f),'utf8');assert.match(read('app/app/layout.tsx'),/hasAcceptedLatestLegalPolicies[\s\S]*LegalAcceptanceGate/);assert.match(read('lib/security/require-workspace-access.ts'),/getCurrentWorkspace[\s\S]*requireActiveSubscription/);assert.match(read('lib/workspaces/actions.ts'),/\.eq\("user_id", user.id\)[\s\S]*\.eq\("status", "active"\)/);
 assert.doesNotMatch(read('app/systems/page.tsx'),/redirect\(|useRouter|router\.push/);
 const loginPage = read('app/(auth)/login/page.tsx');
 assert.match(loginPage, /Executive Intelligence sign in/);
 assert.match(loginPage, /action=\{signInAction\}/);
 assert.match(loginPage, /name="next" value=\{params\?\.next \|\| "\/systems"\}/);
 assert.doesNotMatch(loginPage + read('components/auth/AuthShell.tsx'), /SYSTEM_CATALOG|SystemsCatalog/);
 for (const file of ['components/legal/PublicSiteHeader.tsx', 'components/marketing/PublicNavigation.tsx', 'app/page.tsx']) {
   const publicPage = read(file);
   assert.match(publicPage, /href=\{discoveryDemo\}[^>]*>\s*Explore sample compounds/);
   assert.match(publicPage, /href=\{discoveryWalkthrough\}[^>]*>\s*Request a walkthrough/);
   assert.doesNotMatch(publicPage, /["']\/(?:login|systems)["']|Get Executive Intelligence/);
 }
 assert.match(read('app/executive-intelligence/page.tsx'), /Start Executive Intelligence/);
 console.log(JSON.stringify({passed:true,accessMatrix:results.length,zeroOneMultiple:true,noninteractiveDevelopmentCards:2,actualServerResolvers:true,actualAuthHandlers:true,actualCallback:true,transport:'synthetic SDK/database responses',emailsSent:0,networkCalls:0,hostedWrites:0}));
})().catch(e=>{console.error(e);process.exitCode=1});
