// Run only against an isolated localhost app configured with dummy credentials.
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.AUDIT_NODE_MODULES + '/playwright');
const root = process.env.AUDIT_SOURCE_ROOT;
const base = 'http://127.0.0.1:3211';
const output = process.env.AUDIT_OUTPUT;
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(path.join(dir,d.name)):[path.join(dir,d.name)]); }
(async()=>{
 const results=[];
 if(process.env.AUDIT_RESUME_LOG) {
  for(const line of fs.readFileSync(process.env.AUDIT_RESUME_LOG,'utf8').split('\n')) {
   const m=line.match(/GET (\/app[^ ]*) (\d{3}) in /);
   if(m&&!results.some(r=>r.route===m[1])) results.push({route:m[1],status:Number(m[2]),basis:'recovered server log; redirect location not retained'});
  }
 }
 const save=()=>fs.writeFileSync(path.join(output,'unauthenticated-http-results.json'),JSON.stringify({scope:'Production commit local dev server; no sessions; dummy loopback Supabase configuration; not authenticated role or production HTTP verification',results},null,2)+'\n');
 if(!process.env.AUDIT_RESUME_LOG) {
 const browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page = await browser.newPage(); const browserEvidence=[];
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:950});
  await page.goto(base+'/app');
  await page.getByRole('heading',{name:/sign in|log in|welcome/i}).first().waitFor({timeout:10000}).catch(()=>{});
  browserEvidence.push({width,url:page.url(),title:await page.title(),text:(await page.locator('body').innerText()).slice(0,1500),horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
  await page.screenshot({path:path.join(output,'unauth-login-'+width+'.png'),fullPage:true});
 }
 await browser.close();
 fs.writeFileSync(path.join(output,'unauthenticated-browser-results.json'),JSON.stringify(browserEvidence,null,2));
 }
 const routes=walk(path.join(root,'app/app')).filter(f=>f.endsWith('/page.tsx')).map(f=>f.slice(path.join(root,'app').length).replace(/\/page\.tsx$/,'').replace(/\[[^\]]+\]/g,'11111111-1111-4111-8111-111111111111')).filter(f=>!f.includes('easter-egg'));
 for(const route of routes) {
  if(results.some(r=>r.route===route)) continue;
  try {
  const response=await fetch(base+route,{redirect:'manual',signal:AbortSignal.timeout(60000)});
  const body=await response.text();
  results.push({route,status:response.status,location:response.headers.get('location'),result:response.status>=300&&response.status<400?'passed-login-or-retirement-redirect':'inspect',bodyIncludesLoginRedirect:body.includes('NEXT_REDIRECT')});
  } catch(e) {results.push({route,status:'blocked',reason:e.message});}
  save();
 }
 const APIs=walk(path.join(root,'app/api')).filter(f=>f.endsWith('/route.ts'));
 for(const file of APIs) {
  const source=fs.readFileSync(file,'utf8');
  const route=file.slice(path.join(root,'app').length).replace(/\/route\.ts$/,'').replace(/\[[^\]]+\]/g,'11111111-1111-4111-8111-111111111111');
  for(const method of ['GET','POST','PATCH'].filter(m=>new RegExp('export (?:async )?function '+m+'\\(').test(source))) {
   try {
   const response=await fetch(base+route,{method,redirect:'manual',headers:{origin:base,'content-type':'application/json'},...(method==='GET'?{}:{body:'{}'}),signal:AbortSignal.timeout(60000)});
   const body=await response.text();
   results.push({route,method,status:response.status,location:response.headers.get('location'),body:body.slice(0,800)});
   } catch(e) {results.push({route,method,status:'blocked',reason:e.message});}
   save();
  }
 }
 save();
 console.log(JSON.stringify({pageRoutes:routes.length,requests:results.length,statuses:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
