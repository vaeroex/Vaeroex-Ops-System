/* eslint-disable @typescript-eslint/no-require-imports -- Test harness loads production TypeScript with a server-only stub. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const originalLoad = Module._load, originalTs = require.extensions['.ts'], originalFetch = global.fetch;
Module._load = function(name,parent,main) {
  if (name === 'server-only') return {};
  if (name.startsWith('@/')) return originalLoad.call(this,path.resolve(__dirname,'..',name.slice(2)+'.ts'),parent,main);
  return originalLoad.call(this,name,parent,main);
};
require.extensions['.ts'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,file);
const { accountingFacts } = require('../lib/integrations/zoho-books/server.ts');
after(()=>{Module._load=originalLoad;require.extensions['.ts']=originalTs;global.fetch=originalFetch;});
const invoice = (invoice_id,date,total,extra={}) => ({invoice_id,date,total,balance:total,status:'sent',currency_code:'USD',...extra});
const expense = (expense_id,date,total,extra={}) => ({expense_id,date,total,currency_code:'USD',...extra});
function mock(invoices,expenses) {
  const requests=[];
  global.fetch=async(url,init)=>{
    const u=new URL(url); requests.push(u);
    assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.ok(init.signal);
    const key=u.pathname.endsWith('/invoices')?'invoices':'expenses';
    const rows=key==='invoices'?invoices:expenses;
    return Response.json({code:0,[key]:rows,page_context:{has_more_page:false}});
  };
  return requests;
}
test('Books imports older periods with stable IDs, excludes foreign amounts and strips private fields',async()=>{
  const calls=mock([invoice('123','2020-01-02',12,{customer_name:'Private name',line_items:[{name:'private'}]}),invoice('124','2020-01-03',999,{currency_code:'EUR'}),invoice('125','2020-01-04',99,{status:'void'})],[expense('456','2020-01-02',5,{vendor_name:'Private vendor'})]);
  const facts=await accountingFacts('synthetic-test-token','123456','2020-01-01','2020-01-31');
  assert.deepEqual(facts,[
    {kind:'invoice',source_id:'123',day:'2020-01-02',counted:true,currency:'USD',total:12,outstanding:12},
    {kind:'invoice',source_id:'124',day:'2020-01-03',counted:true,currency:'EUR',total:0,outstanding:0},
    {kind:'invoice',source_id:'125',day:'2020-01-04',counted:false,currency:'USD',total:0,outstanding:0},
    {kind:'expense',source_id:'456',day:'2020-01-02',counted:true,currency:'USD',total:5,outstanding:0}
  ]);
  for(const call of calls){assert.equal(call.searchParams.get('date_start'),'2020-01-01');assert.equal(call.searchParams.get('date_end'),'2020-01-31');}
  assert.doesNotMatch(JSON.stringify(facts),/Private|line_items|customer|vendor/);
});
test('Books rejects duplicates, out-of-range rows, malformed dates and unknown status instead of partial history',async()=>{
  for(const rows of [[invoice('1','2020-01-01',1),invoice('1','2020-01-01',1)],[invoice('1','2020-02-01',1)],[invoice('1','2020-01-32',1)],[invoice('1','2020-01-01',1,{status:'new_unknown'})]]) {
    mock(rows,[]); await assert.rejects(accountingFacts('synthetic','123456','2020-01-01','2020-01-31'));
  }
  mock([],[]);assert.deepEqual(await accountingFacts('synthetic','123456','2020-01-01','2020-01-31'),[]);
});
test('Books refuses an incomplete paginated result and invalid ranges before importing',async()=>{
  let calls=0;
  global.fetch=async(url)=>{calls++;const key=new URL(url).pathname.endsWith('/invoices')?'invoices':'expenses';return Response.json({code:0,[key]:[],page_context:{has_more_page:true}});};
  await assert.rejects(accountingFacts('synthetic','123456','2020-01-01','2020-01-31'),/page_limit_exceeded/);
  assert.equal(calls,20);
  calls=0;await assert.rejects(accountingFacts('synthetic','123456','2019-01-01','2020-01-02'),/invalid_date_range/);assert.equal(calls,0);
});
