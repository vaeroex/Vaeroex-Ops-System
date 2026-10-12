const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert=require('node:assert/strict');
const root=process.env.VAEROEX_AUDIT_SOURCE_ROOT||process.cwd();
const requireRoot=require('node:module').createRequire(root+'/package.json');
const {chromium}=requireRoot('playwright');
const webpack=requireRoot('next/dist/compiled/webpack/webpack'); webpack.init();
const output=process.env.VAEROEX_AUDIT_OUTPUT||path.join(__dirname,'keyboard-rerun');fs.mkdirSync(output,{recursive:true});
(async()=>{
 await new Promise((resolve,reject)=>webpack.webpack({mode:'production',context:root,target:'web',devtool:false,optimization:{minimize:false},entry:path.join(__dirname,'vaeroex-stage1-keyboard-entry.tsx'),output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[root+'/node_modules','node_modules'],alias:{'@':root,'next/navigation$':path.join(__dirname,'vaeroex-stage1-keyboard-nav.tsx'),'next/link$':root+'/scripts/test-stubs/current-integrations-link.tsx','@/components/app/ActivityProvider$':path.join(__dirname,'vaeroex-stage1-keyboard-activity.tsx')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:root+'/scripts/test-stubs/qbo-browser-typescript-loader.cjs'}]}},(err,stats)=>err||stats.hasErrors()?reject(err??new Error(stats.toString({all:false,errors:true}))):resolve()));
 const postcss=requireRoot('postcss'),tailwind=requireRoot('tailwindcss');
 const css=(await postcss([tailwind({content:[root+'/components/operations/RecordDetailDrawer.tsx',root+'/components/app/GlobalSearch.tsx',path.join(__dirname,'vaeroex-stage1-keyboard-entry.tsx')],theme:{extend:{colors:{ink:'#111827',line:'#d1d5db',muted:'#475569','vaeroex-blue':'#1e40af','vaeroex-accent':'#22d3ee'}}}})]).process('@tailwind base; @tailwind components; @tailwind utilities;', {from:undefined})).css;
 const server=http.createServer((req,res)=>{res.setHeader('cache-control','no-store');if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(output+'/fixture.js'));return;}res.setHeader('content-type','text/html');res.end(`<!doctype html><html><head><title>Isolated keyboard audit</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{padding:20px}main>button{padding:12px;border:1px solid #ccc;margin:8px}</style></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>`);});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 let browser;const results=[];const errors=[];const requests=[];
 try {
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());requests.push({origin:u.origin,path:u.pathname});return u.origin===origin?route.continue():route.abort();});
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});await page.goto(origin);await page.getByRole('button',{name:'Open synthetic record'}).waitFor();
   const trigger=page.getByRole('button',{name:'Open synthetic record'});await trigger.focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();
   const opened=await page.evaluate(()=>({active:document.activeElement?.textContent?.trim(),inside:!!document.activeElement?.closest('[role="dialog"]')}));
   await page.locator('#inside-last').focus();await page.keyboard.press('Tab');
   const tabFromLast=await page.evaluate(()=>({id:document.activeElement?.id,inside:!!document.activeElement?.closest('[role="dialog"]')}));
   await page.locator('#inside').focus();await page.keyboard.press('Escape');
   const closed=await page.evaluate(()=>({active:document.activeElement?.tagName,id:document.activeElement?.id,triggerRestored:document.activeElement?.textContent==='Open synthetic record'}));
   results.push({width,component:'RecordDetailDrawer',opened,tabFromLast,closed});
   assert.equal(opened.inside,false);assert.equal(tabFromLast.inside,false);assert.equal(closed.triggerRestored,false);
   await trigger.click();await page.screenshot({path:output+'/record-detail-'+width+'.png'});await page.keyboard.press('Escape');
   await page.locator('#before').focus();await page.keyboard.press('Control+k');await page.getByRole('dialog').waitFor();
   await page.waitForFunction(() => document.activeElement?.tagName === 'INPUT');
   const searchOpened=await page.evaluate(()=>({tag:document.activeElement?.tagName,inside:!!document.activeElement?.closest('[role="dialog"]')}));
   await page.screenshot({path:output+'/global-search-'+width+'.png'});
   const focusables=await page.getByRole('dialog').locator('button,a,input,select,textarea,[tabindex]').count();const tabSteps=[];
   for(let i=0;i<focusables+3;i++){await page.keyboard.press('Tab');tabSteps.push(await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent?.trim().slice(0,60),inside:!!document.activeElement?.closest('[role="dialog"]')})));}
   await page.getByRole('dialog').locator('input').focus();await page.keyboard.press('Escape');
   const searchClosed=await page.evaluate(()=>({id:document.activeElement?.id,tag:document.activeElement?.tagName}));
   results.push({width,component:'GlobalSearch',searchOpened,tabSteps,searchClosed});assert(tabSteps.some(step=>!step.inside));assert.notEqual(searchClosed.id,'before');
  }
  assert.deepEqual(errors,[]);assert(requests.every(r=>r.origin===origin));
  const sourceFingerprints=Object.fromEntries(['components/operations/RecordDetailDrawer.tsx','components/app/GlobalSearch.tsx'].map(file=>[file,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
  const result={scope:'Real hydrated components in isolated browser fixture; no auth/backend/storage/provider; all non-loopback traffic denied',sourceRoot:root,sourceFingerprints,results,errors,requests:requests.map(r=>r.path)};
  fs.writeFileSync(output+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
