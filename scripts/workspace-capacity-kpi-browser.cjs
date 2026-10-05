/* eslint-disable @typescript-eslint/no-require-imports -- Isolated authenticated browser read qualification. */
// Run beneath runtime.network.sb with NODE_EXTRA_CA_CERTS set to runtime.cert.
// Usage: node scripts/workspace-capacity-kpi-browser.cjs <runtime.private.json> <expected full commit>
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),req=require('node:module').createRequire(root+'/package.json');
const {chromium}=req('playwright'),{validate,inspectStatus,openOwnedDatabase}=require(root+'/scripts/workspace-capacity-confine-stack.cjs');
const privateJson=f=>{assert.equal(fs.statSync(f).mode&0o077,0);return JSON.parse(fs.readFileSync(f));},hash=b=>createHash('sha256').update(b).digest('hex');
const [runtimeFile,expectedCommit]=process.argv.slice(2);assert(/^[a-f0-9]{40}$/.test(expectedCommit));
const ctx=validate(privateJson(runtimeFile).configFile,runtimeFile),cfg=ctx.runtime,plan=privateJson(cfg.planFile),sessions=privateJson(cfg.out+'/sessions.private.json'),initial=privateJson(cfg.out+'/processes.json');
assert.equal(initial.sourceCommit,expectedCommit);assert.equal(initial.runId,cfg.runId);assert.equal(initial.buildMode,'production');assert.equal(initial.instanceNonce,cfg.instanceNonce);assert.equal(process.env.NODE_EXTRA_CA_CERTS,cfg.cert);
const output=cfg.out+'/kpi-browser/'+randomUUID();fs.mkdirSync(output,{recursive:true,mode:0o700});
const result={kind:'authenticated_kpi_browser_read_qualification_v1',sourceCommit:expectedCommit,buildId:initial.buildId,instanceNonce:initial.instanceNonce,loadedRuntimeSourceFiles:initial.loadedRuntimeSourceFiles,startedAt:new Date().toISOString(),runId:cfg.runId,widths:[1440,390],repetitionsPerWidth:2,workspaces:2,harnessSha256:hash(fs.readFileSync(__filename)),results:[],errors:[],failedResponses:[],foreignRequests:[],passed:false,capacityClaim:false};
const save=()=>{const p=output+'/result.json.tmp';fs.writeFileSync(p,JSON.stringify(result,null,2)+'\n',{mode:0o600});fs.renameSync(p,output+'/result.json');};save();
let browser,db,stage='setup';
async function guard(){const current=privateJson(cfg.out+'/processes.json');for(const key of['sourceCommit','buildId','instanceNonce'])assert.equal(current[key],initial[key]);for(const key of['app','worker','provider']){assert.equal(current[key].pid,initial[key].pid);process.kill(current[key].pid,0);}}
async function inventory(){return(await db.query("select workspace_id,count(*)::int rows,md5(string_agg(md5(to_jsonb(k)::text),'' order by id)) hash from public.kpis k where workspace_id=any($1::uuid[]) group by workspace_id order by workspace_id",[plan.workspaces.map(w=>w.id)])).rows;}
(async()=>{
 try{
  const net=require('node:net'),denial=await new Promise(resolve=>{const s=net.connect({host:'192.0.2.1',port:9});s.once('connect',()=>{s.destroy();resolve('connected')});s.once('error',e=>resolve(e.code));s.setTimeout(1000,()=>{s.destroy();resolve('timeout')})});assert.equal(denial,'EPERM');result.osNetworkDenial=denial;
  await inspectStatus(ctx);db=(await openOwnedDatabase(ctx)).db;await guard();const before=await inventory();result.before=before;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking']});
  const owners=plan.workspaces.map(w=>plan.actors.find(a=>a.workspaceId===w.id&&a.role==='owner'&&a.active));
  const routes=[{path:'/app',heading:'Executive Overview'},{path:'/app/intelligence',heading:'Intelligence'},{path:'/app/kpis',heading:'Performance'},{path:'/app/reports',heading:'Saved Analyses'}];
  for(const width of[1440,390])for(const owner of owners){
   const session=sessions.actors[owner.id];assert(session?.cookie&&session.accessToken);assert(JSON.parse(Buffer.from(session.accessToken.split('.')[1],'base64url').toString()).exp*1000>Date.now()+120000,'session_expiry_too_close');
   const auth=await fetch(new URL('/auth/v1/user',ctx.config.apiUrl),{headers:{apikey:ctx.config.anonKey,authorization:'Bearer '+session.accessToken},redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(auth.status,200);assert.equal((await auth.json()).id,owner.id);
   const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:900},serviceWorkers:'block'});
   await context.addCookies(session.cookie.split(';').map(s=>{const i=s.indexOf('=');return{name:s.slice(0,i).trim(),value:s.slice(i+1).trim(),url:cfg.appOrigin,sameSite:'Lax'};}));
   await context.route('**/*',r=>{const u=new URL(r.request().url());if([cfg.appOrigin,new URL(ctx.config.apiUrl).origin].includes(u.origin))return r.continue();result.foreignRequests.push({origin:u.origin,method:r.request().method()});return r.abort('blockedbyclient');});
   const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>{result.errors.push({stage,source:'pageerror',name:e.name,messageSha256:hash(e.message)});save();});page.on('console',message=>{if(message.type()==='error'){result.errors.push({stage,source:'console',messageSha256:hash(message.text())});save();}});page.on('response',r=>{if(new URL(r.url()).origin===cfg.appOrigin&&r.status()>=400){result.failedResponses.push({stage,status:r.status(),path:new URL(r.url()).pathname});save();}});
   try{
    await page.goto(cfg.appOrigin+'/app/reports',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Saved Analyses',exact:true}).waitFor();
    for(let iteration=0;iteration<2;iteration++)for(const route of routes){
     await guard();stage=`${width}:${owner.workspaceId}:${iteration}:${route.path}`;
     if(width===390)await page.locator('summary').filter({hasText:/^Menu\s*\//}).click();
     const link=page.locator(`a[href="${route.path}"]:visible`).first();await link.waitFor();const started=Date.now();
     const navigation=page.waitForURL(u=>u.pathname===route.path&&!u.search,{timeout:15000});await link.click();await navigation;
     await page.getByRole('heading',{name:route.heading,exact:true}).waitFor();
     await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'),undefined,{timeout:15000});
     assert.equal(new URL(page.url()).pathname,route.path);assert.equal(await page.locator('[aria-busy="true"]').count(),0);
     assert.equal(await page.locator('[role="alert"]:visible').count(),0);assert.equal(await page.locator('.border-red-200.bg-red-50:visible').count(),0);
     assert.equal(await page.getByText(/Active KPI history exceeds|source authority could not be verified|application error/i).count(),0);
     const heading=await page.getByRole('heading',{name:route.heading,exact:true}).boundingBox();assert(heading&&heading.width>0&&heading.x>=0&&heading.x+heading.width<=width+1,'heading_fits_viewport');
     const entry={width,workspaceId:owner.workspaceId,iteration,path:route.path,heading:route.heading,automaticTransition:true,finalHeadingVisible:true,pendingCleared:true,noVisibleErrors:true,elapsedMs:Date.now()-started};result.results.push(entry);save();
     if(iteration===0)await page.screenshot({path:output+'/'+width+'-'+owner.workspaceId.slice(0,8)+'-'+(route.path==='/app'?'overview':route.path.split('/').at(-1))+'.png',fullPage:true});
    }
   }finally{await context.close();}
  }
  assert.equal(result.results.length,32);assert.equal(result.errors.length,0);assert.equal(result.failedResponses.length,0);assert.equal(result.foreignRequests.length,0);result.after=await inventory();assert.deepEqual(result.after,before);await guard();result.passed=true;result.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({passed:true,result:output+'/result.json',transitions:result.results.length,widths:result.widths,kpisUnchanged:true,capacityClaim:false}));
 }catch(e){result.failure={stage,code:e.code||e.name,message:/^[a-z_]+$/.test(e.message)?e.message:'browser_qualification_assertion_failed'};save();console.error(JSON.stringify({failed:true,result:output+'/result.json',...result.failure}));process.exitCode=1;}finally{if(browser)await browser.close();if(db)await db.end();}
})();
