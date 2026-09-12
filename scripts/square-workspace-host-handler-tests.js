const assert=require('node:assert/strict');
require('./square-account-browser-test-support.js').loadSquareBrowserModules();
const {NextRequest}=require('next/server');
const Module=require('node:module');const original=Module._load;
let queries=0, authCalls=0, rpcCalls=0, mode='valid';
const {view}=require('./square-workspace-evidence-regression-tests.js');
const workspace='10000000-0000-4000-8000-000000000001';
const fake={auth:{getUser:async()=>{authCalls++;return {data:{user:mode==='unauth'?null:{id:'10000000-0000-4000-8000-000000000002'}},error:null};},signInWithPassword:async()=>({error:null}),signOut:async()=>({error:null})},
  rpc:async(name,args)=>{rpcCalls++;assert.equal(name,'read_square_workspace_card_v1');assert.deepEqual(Object.keys(args),['p_workspace_name']);return {data:['nonmember','unsubscribed','revoked'].includes(mode)||args.p_workspace_name==='Vaeroex Square Evidence Denial Test'?null:mode==='forged'?{...view,secret:'PRIVATE_SENTINEL'}:view,error:null};},
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
 for(mode of ['nonmember','unsubscribed','revoked','forged']){const body=await(await handle(request())).text();assert(!body.includes('Square Sandbox evidence</h3>'));assert(!body.includes('PRIVATE_SENTINEL'));}
 mode='valid';
 const denied=await(await handle(request('/evidence',{cookie:'square-evidence-workspace=Vaeroex%20Square%20Evidence%20Denial%20Test'}))).text();
 assert.match(denied,/No Square evidence available/);assert(!denied.includes('Payment: 1'));assert.equal(queries,0,'host never needs table SELECT');
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
   await page.waitForURL(url+'/evidence');assert.match(await page.locator('body').innerText(),/Inventory observations: 6/);
   await page.getByRole('combobox').selectOption('Vaeroex Square Evidence Denial Test');await page.getByRole('button',{name:'View workspace',exact:true}).click();
   assert.match(await page.locator('body').innerText(),/No Square evidence available/);assert.equal(await page.getByRole('heading',{name:'Square Sandbox evidence',exact:true}).count(),0);
   await page.getByRole('combobox').selectOption('Vaeroex Square Sandbox');await page.getByRole('button',{name:'View workspace',exact:true}).click();
   assert.match(await page.locator('body').innerText(),/2 unresolved location relationships; 1 reference conflict/);
   mode='revoked';await page.reload();assert.match(await page.locator('body').innerText(),/No Square evidence available/);
   assert.equal(await page.locator('script,img').count(),0);assert.equal(external,0);assert.equal(queries,0);
   console.log('square_workspace_host_browser_allowed_denied_revoked_zero_external_passed');
  } finally {await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
 }
 console.log('square_workspace_host_handler_authority_privacy_passed');
})().catch(error=>{process.exitCode=1;console.error('square_workspace_host_handler_failed',error.stack);});
