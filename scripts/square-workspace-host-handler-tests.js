const assert=require('node:assert/strict');
require('./square-account-browser-test-support.js').loadSquareBrowserModules();
const {NextRequest}=require('next/server');
const Module=require('node:module');const original=Module._load;
let queries=0, authCalls=0, rpcCalls=0, mode='valid', lastOperationalArgs=null;
const {view}=require('./square-workspace-evidence-regression-tests.js');
const kpi=(refs=[])=>({evidenceRefs:refs,dimensionalScope:'current_workspace_entity_generation',freshness:refs.length?'observed':'unknown',admission:'verified_non_economic',completeness:'unknown',reasonCodes:['synthetic_test_reason']});
const calculation={policyVersion:'square_operational_intelligence_v1',economic:'blocked',historical:'unknown',aiDispatch:'disabled',
 payment:{count:1,total:{amountMinor:'100',currency:'USD'},exactAverageMinor:'100',averageState:'exact'},refund:{count:1,total:{amountMinor:'100',currency:'USD'},exactAverageMinor:'100',averageState:'exact'},order:{count:3,total:null,exactAverageMinor:null,averageState:'amount_unavailable'},groups:[],
 refundRate:{numerator:1,denominator:1,state:'observed_count_ratio_not_financial_rate'},statusMix:{payment:{COMPLETED:1},refund:{COMPLETED:1},order:{OPEN:2,COMPLETED:1},catalog:{unknown:2},inventory:{IN_STOCK:6}},orderStatusMix:{OPEN:2,COMPLETED:1},kpiEvidence:{payment:kpi(['sqe_0123456789abcdef']),refund:kpi(),order:kpi(),catalog:kpi(),inventory:kpi(),statusMix:kpi(['sqe_0123456789abcdef']),refundRate:kpi(['sqe_0123456789abcdef'])},catalog:{admittedVariations:2,activeVariations:null,activeState:'lifecycle_state_not_admitted'},inventory:{observations:6,movementTotal:null,movementState:'unit_compatibility_and_completeness_unverified'},fulfillment:{activity:null,state:'fulfillment_state_not_admitted'},
 insights:[{code:'history_required_for_trend',state:'insufficient_evidence',rule:'compare only when both bounded periods are proven complete',text:'Trend comparisons are unavailable because historical completeness is unknown.',blockedReason:'historical_completeness_unknown',evidenceRefs:[]}]};
const row={evidenceRef:'sqe_0123456789abcdef',kind:'payment',status:'COMPLETED',occurredAt:'2026-09-11T12:00:00.000Z',location:'mapped_location',amount:{amountMinor:'100',currency:'USD'},quantity:null,unitState:'not_applicable',label:null,relationship:'not_applicable',admission:'verified_non_economic'};
const operationalView={version:'square_workspace_operational_v1',evidence:view,calculation,page:{rows:[row],page:1,pageSize:25,total:1,pages:1}};
const workspace='10000000-0000-4000-8000-000000000001';
const fake={auth:{getUser:async()=>{authCalls++;return {data:{user:mode==='unauth'?null:{id:'10000000-0000-4000-8000-000000000002'}},error:null};},signInWithPassword:async()=>({error:null}),signOut:async()=>({error:null})},
  rpc:async(name,args)=>{rpcCalls++;assert.ok(['read_square_workspace_card_v1','read_square_workspace_operational_v1'].includes(name));
   if(name==='read_square_workspace_card_v1')assert.deepEqual(Object.keys(args),['p_workspace_name']);
   else {assert.deepEqual(Object.keys(args),['p_workspace_name','p_kind','p_status','p_location','p_from','p_to','p_sort','p_page']);lastOperationalArgs=args;}
   const value=name==='read_square_workspace_card_v1'?view:operationalView;
   return {data:['nonmember','unsubscribed','revoked'].includes(mode)||args.p_workspace_name==='Vaeroex Square Evidence Denial Test'?null:mode==='forged'?{...value,secret:'PRIVATE_SENTINEL'}:value,error:null};},
  from(){queries++;throw Error('direct_table_access_forbidden');}};
Module._load=function(name,parent,main){if(name==='@supabase/ssr')return {createServerClient:()=>fake};return original.call(this,name,parent,main);};
const {handle}=require('../services/square-workspace-host/src/handler.ts');
const host='square-sandbox.vaeroex.com';
const request=(path='/evidence',h={})=>new NextRequest(`https://${host}${path}`,{headers:{host,'x-forwarded-host':host,'x-forwarded-proto':'https',...h}});
Object.assign(process.env,{NODE_ENV:'production',SQUARE_EVIDENCE_HOST:'gcp-square-sandbox-workspace-v1',NEXT_PUBLIC_SUPABASE_URL:'https://oysjpoondtcrqpghhrbd.supabase.co',NEXT_PUBLIC_APP_URL:`https://${host}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_SYNTHETIC_NEVER_ISSUED_123456789'});
for(const name of ['VERCEL','VERCEL_ENV','VERCEL_TARGET_ENV','VERCEL_PROJECT_ID','VERCEL_URL','VAEROEX_ADMIN_EMAILS'])delete process.env[name];
(async()=>{
 const {withoutSquareQualificationPaths}=require('./square-dormant-scope-test-support.js');
 assert.equal(withoutSquareQualificationPaths('services/square-workspace-host/src/handler.ts'),'');
 for(const p of ['services/square-workspace-host/app/admin/route.ts','services/square-workspace-host/src/unapproved.ts','services/external-integrations-qbo/src/server.ts'])assert.equal(withoutSquareQualificationPaths(p),p);
 const {publicKey}=require('../services/square-workspace-host/src/config.ts');
 for(const key of [undefined,'sb_secret_PRIVATE','plain-secret','a.'+Buffer.from(JSON.stringify({role:'service_role',ref:'oysjpoondtcrqpghhrbd',iss:'supabase'})).toString('base64url')+'.s'])assert.equal(publicKey(key),false);
 for(const h of [{host:'localhost'},{host:'preview.vercel.app'},{'x-forwarded-proto':'http'},{forwarded:'host=x'}])assert.equal((await handle(request('/evidence',h))).status,404);
 for(const p of ['/admin','/api','/_next/static/a.js'])assert.equal((await handle(request(p))).status,404);
 assert.equal(queries+authCalls+rpcCalls,0);
 const valid=await (await handle(request())).text();assert.match(valid,/Payment: 1/);assert.match(valid,/Inventory observations: 6/);assert.match(valid,/2 unresolved location relationships; 1 reference conflict/);assert(!valid.includes(workspace));assert(!/<script|src=|PRIVATE_SENTINEL/.test(valid));
 assert.match(valid,/<title>Vaeroex Executive Intelligence Sandbox<\/title>/);
 assert.match(valid,/Authority checked at/);assert.match(valid,/page retrieval is not a sync/);
 assert.match(valid,/Admitted observations/);assert.match(valid,/Economic contributions remain blocked/);
 assert.match(valid,/Seller; location applicability/);
 const {card,escape}=require('../services/square-workspace-host/src/presentation.ts');
 assert.equal(escape('<script>"&'), '&lt;script&gt;&quot;&amp;');
 assert.equal(card(view),card(view),'presentation is deterministic, with no wall-clock freshness guess');
 assert(!/https?:\/\//.test(valid),'navigation has no Production or external links');
 assert(!/\$\d|Business Health|Ask Vaeroex/.test(valid),'no economics or model interaction');
 const activity=await(await handle(request('/activity'))).text();assert.match(activity,/Operational activity/);assert.match(activity,/USD 100 minor units/);assert.match(activity,/AI dispatch: disabled/);assert(!activity.includes('PAY_SYNTHETIC'));
 assert.match(activity,/name="kind" value="payment"><input type="hidden" name="status" value="COMPLETED"/,'completed payment KPI drills only to completed observations');
 assert.match(activity,/name="kind" value="refund"><input type="hidden" name="status" value="COMPLETED"/,'completed refund KPI drills only to completed observations');
 assert.match(activity,/name="kind" value="order"><input type="hidden" name="status" value=""/,'order KPI retains its all-status definition');
 const filterCookie=encodeURIComponent(JSON.stringify({kind:'payment',status:'COMPLETED',location:'mapped_location',from:'2026-09-01',to:'2026-09-11',sort:'oldest',page:1}));
 await handle(request('/activity',{cookie:`square-activity-filter=${filterCookie}`}));
 assert.deepEqual(lastOperationalArgs,{p_workspace_name:'Vaeroex Square Sandbox',p_kind:'payment',p_status:'COMPLETED',p_location:'mapped_location',p_from:'2026-09-01',p_to:'2026-09-11',p_sort:'oldest',p_page:1});
 const invalidCookie=encodeURIComponent(JSON.stringify({kind:'payment',status:'COMPLETED',location:'mapped_location',from:'2026-09-12',to:'2026-09-11',sort:'oldest',page:1}));
 await handle(request('/activity',{cookie:`square-activity-filter=${invalidCookie}`}));assert.equal(lastOperationalArgs.p_kind,null,'invalid date range fails back to bounded defaults');
 for(mode of ['nonmember','unsubscribed','revoked','forged']){const body=await(await handle(request())).text();assert(!body.includes('Square Sandbox evidence</h3>'));assert(!body.includes('PRIVATE_SENTINEL'));}
 mode='valid';
 const denied=await(await handle(request('/evidence',{cookie:'square-evidence-workspace=Vaeroex%20Square%20Evidence%20Denial%20Test'}))).text();
 assert.match(denied,/No Square evidence available/);assert(!denied.includes('Payment: 1'));assert.equal(queries,0,'host never needs table SELECT');
 assert.match(denied,/<option selected>Vaeroex Square Evidence Denial Test/);
 for(const label of ['Admitted observations','Interpretation checkpoint','unresolved location relationships','Source &amp; provenance'])assert(!denied.includes(label),'denial reveals no evidence');
 mode='unauth';assert.equal((await handle(request())).status,303);
 mode='valid';
 const controller=new AbortController();controller.abort();const before=queries+authCalls+rpcCalls;
 assert.equal((await handle(new NextRequest(`https://${host}/evidence`,{signal:controller.signal,headers:{host,'x-forwarded-host':host,'x-forwarded-proto':'https'}}))).status,503);
 assert.equal(queries+authCalls+rpcCalls,before,'aborted request does not query');
 fake.auth.signOut=async()=>({error:{message:'PRIVATE_SENTINEL'}});
 const logout=await handle(new NextRequest(`https://${host}/signout`,{method:'POST',headers:{host,'x-forwarded-host':host,'x-forwarded-proto':'https',origin:`https://${host}`,'content-type':'application/x-www-form-urlencoded','content-length':'0',cookie:'sb-test-auth-token=SYNTHETIC'},body:''}));
 assert.equal(logout.status,303);assert.equal(logout.cookies.get('sb-test-auth-token').value,'');assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 if(process.env.SQUARE_HOST_BROWSER_TEST==='1') {
  const playwright=require('playwright');
  // Real browser/form/cookie traversal with injected Auth/RPC only. The TLS/raw
  // boundary is independently exercised by wire.test; no hosted I/O is possible.
  const http=require('node:http');
  const server=http.createServer(async(req,res)=>{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const reply=await handle(new NextRequest(`https://${host}${req.url}`,{method:req.method,headers:{host,'x-forwarded-host':host,'x-forwarded-proto':'https',origin:`https://${host}`,'content-type':'application/x-www-form-urlencoded',...(req.headers.cookie?{cookie:req.headers.cookie}:{})},...(req.method==='POST'?{body:Buffer.concat(chunks).toString()}: {})}));
   res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(await reply.text());
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
   browser=await playwright.chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
   const page=await browser.newPage();let external=0;
   await page.route('**/*',r=>r.request().url().startsWith(url+'/')?r.continue():(external++,r.abort()));
   await page.goto(url+'/signin');await page.getByLabel('Email').fill('synthetic@example.invalid');await page.getByLabel('Password').fill('synthetic-not-a-credential');await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await page.waitForURL(url+'/evidence');assert.equal(await page.getByRole('article',{name:'Inventory observations: 6',exact:true}).count(),1);
   assert.equal(await page.title(),'Vaeroex Executive Intelligence Sandbox');
   for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    assert(await page.getByRole('heading',{name:'Vaeroex Executive Intelligence Sandbox',exact:true}).isVisible());
    assert(await page.getByRole('heading',{name:'Square Sandbox evidence',exact:true}).isVisible());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
    await page.getByText('Inspect 13 admitted source versions',{exact:true}).click();
    assert.equal(await page.locator('tbody tr').count(),13);
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
    assert(await page.locator('header .badge').isVisible(),'Sandbox label remains visible');
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    if(process.env.SQUARE_HOST_SCREENSHOTS)await page.screenshot({path:process.env.SQUARE_HOST_SCREENSHOTS+`/sandbox-${width}.png`,fullPage:true});
    await page.getByText('Inspect 13 admitted source versions',{exact:true}).click();
   }
   await page.getByRole('combobox').selectOption('Vaeroex Square Evidence Denial Test');await page.getByRole('button',{name:'View workspace',exact:true}).click();
   assert.match(await page.locator('body').innerText(),/No Square evidence available/);assert.equal(await page.getByRole('heading',{name:'Square Sandbox evidence',exact:true}).count(),0);
   assert.equal(await page.getByRole('combobox').inputValue(),'Vaeroex Square Evidence Denial Test');
   assert.equal(await page.locator('.kpi,table').count(),0);
   await page.getByRole('combobox').selectOption('Vaeroex Square Sandbox');await page.getByRole('button',{name:'View workspace',exact:true}).click();
   assert.match(await page.locator('body').innerText(),/2 unresolved location relationships; 1 reference conflict/);
   mode='revoked';await page.reload();assert.match(await page.locator('body').innerText(),/No Square evidence available/);
   assert.equal(await page.locator('script,img').count(),0);assert.equal(external,0);assert.equal(queries,0);
   console.log('square_workspace_host_browser_allowed_denied_revoked_zero_external_passed');
  } finally {await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
 }
 console.log('square_workspace_host_handler_authority_privacy_passed');
})().catch(error=>{process.exitCode=1;console.error('square_workspace_host_handler_failed',error.stack);});
