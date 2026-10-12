/* eslint-disable @typescript-eslint/no-require-imports -- Node-only CommonJS synthetic browser harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const { chromium } = require('playwright');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const root = path.resolve(__dirname, '..');
const source = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: file }).outputText;
const vendor = (pkg, file) => fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`, { paths: [path.dirname(require.resolve('react-dom/package.json')), root] })), 'cjs', file), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const requests = Array.from({ length: 3 }, (_, i) => ({ id: id(i + 1), workspace_id: id(99), workspaceName: 'Synthetic workspace', name: `Synthetic requester ${i + 1}`, email: `synthetic.long-support-address-${i}@example.invalid`, issue_type: `Synthetic support request ${i + 1}`, status: 'open', priority: i === 0 ? 'High' : 'Medium', created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z', archived_at: null, deleted_at: null }));
function bundle(preview = false) {
  const modules = {
    react: vendor('react', 'react.development.js'), 'react/jsx-runtime': vendor('react', 'react-jsx-runtime.development.js'),
    'react-dom': vendor('react-dom', 'react-dom.development.js'), 'react-dom/client': vendor('react-dom', 'react-dom-client.development.js'), scheduler: vendor('scheduler', 'scheduler.development.js'),
    '@/components/admin/SupportRequestsInbox': source('components/admin/SupportRequestsInbox.tsx'),
    '@/components/admin/AdminLocalTime': source('components/admin/AdminLocalTime.tsx'),
    '@/components/operations/StatusBadge': source('components/operations/StatusBadge.tsx'), '@/lib/admin/support-requests': source('lib/admin/support-requests.ts'),
    'next/navigation': 'exports.useRouter = () => ({ refresh() { window.refreshes++; if(window.fixtureAutomatic)window.renderFixture(); } });',
    '@/app/app/admin/support-requests/actions': `exports.getSupportRequestContentAction = async id => { window.contentReads.push(id); return {message:'Synthetic support message body',error:null}; }; exports.manageSupportRequestAction = form => { window.mutations.push(Object.fromEntries([...form].map(([key,value])=>[key,key==='support_request_ids'?form.getAll(key):value]))); return new Promise((resolve,reject) => { window.finishMutation = resolve; window.failMutation = reject; if (window.fixtureAutomatic) setTimeout(() => { const action=form.get('support_action'); let changed=0; for(const row of window.fixtureRows) {if(!form.getAll('support_request_ids').includes(row.id))continue; if(action==='delete' && !row.deleted_at){row.deleted_at=new Date().toISOString();row.status='closed';changed++;}else if(action==='archive' && !row.archived_at && !row.deleted_at){row.archived_at=new Date().toISOString();row.status='closed';changed++;}else if(action==='restore' && (row.archived_at || row.deleted_at)){row.archived_at=null;row.deleted_at=null;row.status='open';changed++;}else if(action==='update' && !row.archived_at && !row.deleted_at && (row.status!==form.get('status') || row.priority!==form.get('priority'))){row.status=form.get('status');row.priority=form.get('priority');changed++;}}resolve({ok:true,message:changed+' synthetic request(s) changed. No real requests were affected.',changedCount:changed,requestedCount:form.getAll('support_request_ids').length});},650); }); };`
  };
  return `window.fixtureAutomatic=${preview};window.process={env:{NODE_ENV:'development'}};const process=window.process;const modules={${Object.entries(modules).map(([key, value]) => `${JSON.stringify(key)}:function(require,module,exports){${value}\n}`).join(',')}};const cache={};function require(key){if(cache[key])return cache[key].exports;if(!modules[key])throw new Error('Unexpected browser import '+key);const m={exports:{}};cache[key]=m;modules[key](require,m,m.exports);return m.exports;}window.mutations=[];window.contentReads=[];window.refreshes=0;const props={requests:${JSON.stringify(requests)},filters:{q:'',status:'',view:'active',page:1},total:80};window.fixtureRows=props.requests;const reactRoot=require('react-dom/client').createRoot(document.getElementById('root'));function render(){if(window.fixtureAutomatic){const query=new URLSearchParams(location.search);props.filters={q:query.get('q')||'',status:query.get('status')||'',view:query.get('view')||'active',page:1};props.requests=window.fixtureRows.filter(row=>(!props.filters.status||row.status===props.filters.status)&&(!props.filters.q||[row.name,row.email,row.issue_type].some(v=>v.toLowerCase().includes(props.filters.q.toLowerCase())))&&(props.filters.view==='all'||props.filters.view==='deleted'?props.filters.view==='all'||Boolean(row.deleted_at):props.filters.view==='archived'?Boolean(row.archived_at)&&!row.deleted_at:!row.archived_at&&!row.deleted_at));props.total=props.requests.length;}reactRoot.render(require('react').createElement(require('@/components/admin/SupportRequestsInbox').SupportRequestsInbox,props));}window.renderFixture=render;window.swapPage=function(){props.requests=props.requests.map((r,i)=>({...r,id:r.id.replace(/.$/,String(i+4))}));render();};render();`;
}
async function main() {
  const configModule = { exports: {} }; Function('module','exports', source('tailwind.config.ts'))(configModule, configModule.exports);
  const css = (await postcss([tailwind({ ...configModule.exports.default, content: [path.join(root, 'components/admin/SupportRequestsInbox.tsx'), path.join(root, 'components/operations/StatusBadge.tsx'), __filename] })]).process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css;
  const html = (preview=false) => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic support inbox</title><style>${css}</style></head><body class="bg-white text-ink"><main class="mx-auto max-w-6xl p-3">${preview ? '<p class="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">Synthetic review preview · All actions affect local fixtures only. No customer data or live database access.</p>' : ''}<h1 class="mb-3 text-2xl">Support requests</h1><div id="root"></div></main><script src="./bundle.js"></script></body></html>`;
  if (process.env.ADMIN_PREVIEW_OUTPUT) {
    fs.mkdirSync(process.env.ADMIN_PREVIEW_OUTPUT, {recursive:true});
    fs.writeFileSync(path.join(process.env.ADMIN_PREVIEW_OUTPUT,'index.html'),html(true));
    fs.writeFileSync(path.join(process.env.ADMIN_PREVIEW_OUTPUT,'bundle.js'),bundle(true));
    if(process.env.ADMIN_PREVIEW_ONLY==='1')return;
  }
  const js = bundle();
  const server = http.createServer((req,res) => { if (req.method !== 'GET') { res.writeHead(405); return res.end(); } res.writeHead(200, {'content-type':req.url === '/bundle.js' ? 'text/javascript' : 'text/html'}); res.end(req.url === '/bundle.js' ? js : html()); });  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.ADMIN_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.ADMIN_TEST_CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ timezoneId: 'America/Los_Angeles' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin && route.request().method() === 'GET' ? route.continue() : route.abort());
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:900}); await page.goto(origin);
      await page.getByRole('button',{name:'Delete',exact:true}).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
      assert.equal(await page.evaluate(() => window.contentReads.length),0);
      await page.getByLabel('Select all requests on this page').focus(); await page.keyboard.press('Space');
      await page.getByText('3 selected',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Clear selection',exact:true}).click(); await page.getByText('0 selected',{exact:true}).waitFor();
      const boxes=page.getByRole('checkbox'); await boxes.nth(1).check(); await boxes.nth(2).check(); await page.getByText('2 selected',{exact:true}).waitFor();
      await page.getByLabel('Search',{exact:true}).fill('fixture'); await page.getByText('0 selected',{exact:true}).waitFor();
      await boxes.nth(1).check(); await boxes.nth(2).check();
      let confirmations=0; page.once('dialog',async dialog=>{confirmations++; assert.match(dialog.message(),/exactly 2 support requests/); await dialog.accept();});
      await page.getByRole('button',{name:'Delete',exact:true}).click();
      await page.getByText('Saving support changes…',{exact:true}).waitFor();
      assert.equal(confirmations,1); assert.equal(await page.getByRole('button',{name:'Delete',exact:true}).isDisabled(),true); assert.equal(await boxes.nth(1).isDisabled(),true); assert.equal(await page.getByLabel('Search',{exact:true}).isDisabled(),true);
      assert.equal(await page.evaluate(()=>window.mutations.length),1); assert.deepEqual(await page.evaluate(()=>window.mutations[0].support_request_ids),[id(1),id(2)]);
      await page.evaluate(()=>window.finishMutation({ok:true,message:'1 request moved to Deleted. 1 unchanged or no longer available.',changedCount:1,requestedCount:2}));
      await page.getByText('1 request moved to Deleted. 1 unchanged or no longer available.',{exact:true}).waitFor(); await page.getByText('0 selected',{exact:true}).waitFor();
      await page.getByText('Request details and triage',{exact:true}).first().click(); await page.getByText('Read support message',{exact:true}).first().click();
      await page.getByText('Synthetic support message body',{exact:true}).waitFor(); assert.deepEqual(await page.evaluate(()=>window.contentReads),[id(1)]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
      assert.deepEqual(await page.locator('main p, main button, main summary, main select').evaluateAll(elements=>elements.filter(e=>e.clientWidth && e.scrollWidth > e.clientWidth + 2).map(e=>e.textContent)),[]);
      await page.screenshot({path:path.join(require('node:os').tmpdir(), `admin-support-${width}.png`),fullPage:true});
      console.log(`Support hydrated browser passed ${width}px: selection, keyboard, filters, confirmation, pending, support-only disclosure, no overflow.`);
    }
    // An uncertain response retries the same operation key, and never selects an unseen row.
    await page.goto(origin); await page.getByRole('checkbox').nth(1).check(); await page.getByRole('button',{name:'Archive',exact:true}).click(); await page.evaluate(()=>window.failMutation(new Error('Synthetic network loss')));
    await page.getByRole('alert').waitFor(); await page.getByRole('button',{name:'Archive',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.mutations[0].operation_id === window.mutations[1].operation_id),true);
    await page.evaluate(()=>window.finishMutation({ok:true,message:'Previously completed: 1 request archived.',changedCount:1,requestedCount:1,replayed:true}));
    await page.getByText('Previously completed: 1 request archived.',{exact:true}).waitFor();
    await page.getByRole('checkbox').nth(1).check(); await page.evaluate(()=>window.swapPage()); await page.getByText('0 selected',{exact:true}).waitFor(); assert.equal(await page.getByRole('button',{name:'Delete',exact:true}).isDisabled(),true);
    assert.deepEqual(errors,[]);
  } finally { if(browser)await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
