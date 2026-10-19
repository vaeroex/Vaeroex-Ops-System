/* eslint-disable @typescript-eslint/no-require-imports -- Local rendered production component fixtures; non-loopback requests are blocked. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),postcss=require('postcss'),tailwind=require('tailwindcss');
const {root,loadSource,React,renderToStaticMarkup,harness}=require('./integrations-ui-test-support');
const {catalog,providers}=loadSource('lib/integrations/reporting/catalog.ts');
const output='/tmp/vaeroex-reporting-browser';fs.mkdirSync(output,{recursive:true});
async function render(provider,role='owner',state='new') {
 const row=state==='new'||state==='disabled'?null:{id:'synthetic-connection',status:state,created_by:'synthetic-user',account:{id:'123',name:'Synthetic account'},last_sync_at:'2026-10-19T01:00:00Z',next_sync_at:'2020-01-01T00:00:00Z',last_error_code:null,
 snapshot:state==='connected'?{start:'2026-10-13T00:00:00Z',end:'2026-10-19T01:00:00Z',metrics:Object.keys(catalog[provider].metrics).map(key=>({key,value:12,...(provider==='xero'?{currency:'USD'}:{})}))}:null};
 const db={from(){const q={};for(const m of ['select','eq','neq'])q[m]=()=>q;q.maybeSingle=async()=>({data:row,error:null});return q;}};
 const mocks={
  'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},
  'next/navigation':{notFound(){throw new Error('NOT_FOUND');}},
  '@/lib/workspaces/page-context':{requireWorkspacePage:async()=>({workspaceId:'synthetic-workspace',context:{membership:{role,user_id:'synthetic-user'}},supabase:db})},
  '@/lib/integrations/reporting/security':{...loadSource('lib/integrations/reporting/security.ts'),available:()=>state!=='disabled',admin:()=>{throw new Error('credential_read_forbidden');}}
 };
 return renderToStaticMarkup(await loadSource('app/app/integrations/[provider]/page.tsx',mocks).default({params:Promise.resolve({provider}),searchParams:Promise.resolve({})}));
}
(async()=>{
 const config=loadSource('tailwind.config.ts').default;
 const css=(await postcss([tailwind({...config,content:[path.join(root,'app/app/integrations/**/*.tsx'),path.join(root,'components/operations/*.tsx')]})]).process(fs.readFileSync(path.join(root,'app/globals.css'),'utf8'),{from:path.join(root,'app/globals.css')})).css;
 let serverError=null,posts=0;
 const server=http.createServer(async(req,res)=>{try{
  if(req.method==='POST'){posts++;res.writeHead(200,{'content-type':'text/plain'});res.end('Synthetic form received');return;}
  const u=new URL(req.url,'http://127.0.0.1');
  const content=u.pathname==='/catalog'?await harness({qboEnabled:false,squareEnabled:false}).render('app/app/integrations/page.tsx'):await render(u.searchParams.get('provider')??'harvest',u.searchParams.get('role')??'owner',u.searchParams.get('state')??'new');
  res.writeHead(200,{'content-type':'text/html'});res.end(`<!doctype html><html lang="en" class="pulsar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporting plug-in fixture</title><style>${css}</style></head><body class="vaeroex-customer-workspace"><main class="workspace-main p-4">${content}</main></body></html>`);
 }catch(e){serverError=e;res.writeHead(500);res.end('Fixture failed');}});
 let browser;try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.env.QBO_TEST_CHROME_EXECUTABLE?{executablePath:process.env.QBO_TEST_CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage();await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  for(const width of [1280,390,320]){
   await page.setViewportSize({width,height:1000});
   for(const provider of providers){
    for(const state of ['new','disabled','connected']){
     await page.goto(`${origin}/?provider=${provider}&state=${state}`);await page.getByRole('heading',{name:catalog[provider].name,exact:true}).waitFor();
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${provider}/${state}/${width} overflow`);
     if(state==='disabled')assert.equal(await page.locator('form').count(),0);
     if(state==='new'&&catalog[provider].auth==='key') assert.equal(await page.getByLabel('API key').getAttribute('type'),'password');
     if(state==='connected')assert.equal(await page.getByRole('heading',{name:'Last complete report'}).count(),1);
    }
   }
   await page.goto(`${origin}/?provider=harvest&state=connected`);await page.screenshot({path:path.join(output,`harvest-${width}.png`),fullPage:true});
  }
  await page.goto(`${origin}/?provider=harvest&role=viewer`);assert.equal(await page.locator('form').count(),0);
  await page.goto(`${origin}/?provider=harvest`);await page.getByRole('button',{name:'Connect Harvest'}).click();assert.equal(posts,0,'unchecked consent cannot submit');
  await page.getByRole('checkbox').check();await Promise.all([page.waitForURL('**/api/integrations/harvest/connect'),page.getByRole('button',{name:'Connect Harvest'}).click()]);assert.equal(posts,1);
  await page.setViewportSize({width:1280,height:1000});await page.goto(`${origin}/catalog`);assert.equal(await page.getByRole('article').count(),8);await page.screenshot({path:path.join(output,'catalog.png'),fullPage:true});
  assert.equal(serverError,null);console.log(`PASS: six providers at 1280/390/320px, owner/member gates, disabled setup, report rendering and native consent. Screenshots: ${output}`);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
