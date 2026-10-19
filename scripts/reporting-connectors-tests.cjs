/* eslint-disable @typescript-eslint/no-require-imports -- Node test loader compiles the production TypeScript modules. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if(name === 'server-only') return {};
  return originalLoad.call(this,name,parent,main);
};
const oldTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,file);
const {accounts,snapshot,importHistory,validateSnapshot} = require('../lib/integrations/reporting/adapters.ts');
const {resolveImportRange} = require('../lib/integrations/date-range.ts');
const {seal,unseal,assertRequest,formData} = require('../lib/integrations/reporting/security.ts');
const {authorizationUrl,exchange} = require('../lib/integrations/reporting/oauth.ts');
const {reader,readJson} = require('../lib/integrations/reporting/transport.ts');
const savedFetch = global.fetch;
after(()=>{global.fetch=savedFetch;Module._load=originalLoad;require.extensions['.ts']=oldTs;});
const now=new Date('2026-10-19T12:00:00Z');
const signal=()=>AbortSignal.timeout(1000);
const token='synthetic-token-not-a-real-key';
function mock(responses) {
  const requests=[];
  global.fetch=async (url,init)=>{
    requests.push({url:String(url),...init});
    assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
    if(!responses.length) throw new Error('Unexpected request');
    const response=responses.shift();
    return response instanceof Response ? response : Response.json(response);
  };
  return requests;
}
test('Harvest admits only completed, dated totals and strips employee details',async()=>{
 const calls=mock([{time_entries:[{id:1,spent_date:'2026-10-18',hours:2.5,billable:true,is_running:false,user:{name:'Must not persist'}},{id:2,spent_date:'2026-10-19',hours:1,billable:false,is_running:true}],page:1,next_page:null,total_entries:2}]);
 const report=await snapshot('harvest',token,{id:'123',name:'Test'},signal(),now);
 assert.deepEqual(report.metrics.map(m=>m.value),[1,2.5,2.5,1]);assert.doesNotMatch(JSON.stringify(report),/Must not persist/);
 assert.equal(calls[0].method,'GET');assert.equal(calls[0].headers['Harvest-Account-Id'],'123');
 mock([{time_entries:[{id:1,spent_date:'2020-01-01',hours:1,billable:false,is_running:false}],page:1,next_page:null,total_entries:1}]);
 await assert.rejects(snapshot('harvest',token,{id:'123',name:'Test'},signal(),now),/invalid_window/);
});
test('Harvest rejects duplicate, incomplete and looping pages',async()=>{
 const r={id:1,spent_date:'2026-10-18',hours:1,billable:false,is_running:false};
 mock([{time_entries:[r,r],page:1,next_page:null,total_entries:2}]);await assert.rejects(snapshot('harvest',token,{id:'123',name:'Test'},signal(),now),/duplicate/);
 mock([{time_entries:[r],page:1,next_page:null,total_entries:4}]);await assert.rejects(snapshot('harvest',token,{id:'123',name:'Test'},signal(),now),/incomplete/);
 mock([{time_entries:[r],page:1,next_page:1,total_entries:4}]);await assert.rejects(snapshot('harvest',token,{id:'123',name:'Test'},signal(),now),/pagination/);
});
test('Clockify binds a user to selected workspace and measures completed time',async()=>{
 mock([{id:'userA'},[{id:'workA',name:'A'}]]);
 const found=await accounts('clockify',token,signal());assert.deepEqual(found,[{id:'workA',name:'A',user:'userA'}]);
 const calls=mock([[{id:'entryA',billable:true,timeInterval:{start:'2026-10-18T10:00:00Z',end:'2026-10-18T11:30:00Z'}},{id:'entryB',billable:false,timeInterval:{start:'2026-10-19T10:00:00Z',end:null}}]]);
 const report=await snapshot('clockify',token,found[0],signal(),now);assert.deepEqual(report.metrics.map(m=>m.value),[1,1.5,1.5,1]);
 assert.match(calls[0].url,/workspaces\/workA\/user\/userA\/time-entries/);assert.equal(calls[0].headers['X-Api-Key'],token);
});
test('Zoho Inventory uses only inventory read endpoints and retains counts',async()=>{
 const calls=mock([{code:0,items:[{item_id:'1',status:'active',item_type:'inventory'},{item_id:'2',status:'inactive',item_type:'inventory'}],page_context:{has_more_page:false}},
 {code:0,items:[{item_id:'1',status:'active',item_type:'inventory'}],page_context:{has_more_page:false}}]);
 const report=await snapshot('zoho-inventory',token,{id:'12345',name:'Test'},signal(),now);
 assert.deepEqual(report.metrics,[{key:'items',value:1},{key:'low_stock',value:1}]);assert.equal(report.start,report.end);
 for(const c of calls){assert.match(c.url,/www.zohoapis.com\/inventory\/v1\/items/);assert.equal(c.method,'GET');}
});
test('Toggl uses Focus bearer tokens and project lifetime figures, never Track',async()=>{
 await assert.rejects(accounts('toggl',token,signal(),new URLSearchParams()),/toggl_2_token/);
 mock([{data:[],page:1,total:0}]);
 const a=await accounts('toggl','toggl_sk_synthetic',signal(),new URLSearchParams({organizationId:'12',accountId:'34'}));
 const calls=mock([{data:[{id:1,total_tracked_secs:3600},{id:2,total_tracked_secs:1800}],page:1,total:2}]);
 const report=await snapshot('toggl',token,a[0],signal(),now);assert.deepEqual(report.metrics.map(m=>m.value),[2,1.5]);assert.equal(report.start,report.end);
 assert.match(calls[0].url,/focus.toggl.com\/api\/organizations\/12\/workspaces\/34\/projects/);
});
test('Katana parses documented decimal strings and counts mixed-unit stock without summing units',async()=>{
 mock([{display_name:'Factory',legal_address:{line_1:'Must not store'}}]);const a=await accounts('katana',token,signal());
 assert.deepEqual(a,[{id:'key-account',name:'Factory'}]);
 mock([{data:[{variant_id:1,location_id:1,quantity_in_stock:'7.00000',quantity_committed:'0.00000'},
 {variant_id:2,location_id:1,quantity_in_stock:'-2.00000',quantity_committed:'0.00000'}]}]);
 const report=await snapshot('katana',token,a[0],signal(),now);assert.deepEqual(report.metrics.map(m=>m.value),[2,1]);
});
test('Xero separates currencies, excludes draft/void and distinguishes bills from sales',async()=>{
 const r=(id,type,currency,total,status='AUTHORISED')=>({InvoiceID:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,DateString:"2026-10-18T00:00:00",Type:type,Status:status,CurrencyCode:currency,Total:total,AmountDue:total});
 const calls=mock([{Invoices:[r(1,'ACCREC','USD',12.34),r(2,'ACCREC','EUR',20),r(3,'ACCPAY','USD',10),r(4,'ACCREC','USD',500,'DRAFT')]}]);
 const report=await snapshot('xero',token,{id:'00000000-0000-4000-8000-000000000009',name:'Test'},signal(),now);
 assert.equal(report.metrics.find(m=>m.key==='billed'&&m.currency==='USD').value,12.34);
 assert.equal(report.metrics.find(m=>m.key==='purchases'&&m.currency==='USD').value,10);
 assert.equal(report.metrics.find(m=>m.key==='billed'&&m.currency==='EUR').value,20);
 assert.equal(calls[0].headers['Xero-Tenant-Id'],'00000000-0000-4000-8000-000000000009');
 assert.match(new URL(calls[0].url).searchParams.get('where'),/DateTime\(2026,10,13\)/);
});
test('pagination and provider quota failures never return partial success',async()=>{
 const rows=Array.from({length:250},(_,i)=>({variant_id:i+1,location_id:1,quantity_in_stock:'1',quantity_committed:'0'}));
 mock(Array.from({length:10},()=>({data:rows})));
 await assert.rejects(snapshot('katana',token,{id:'key-account',name:'Test'},signal(),now),/snapshot_too_large/);
 for(const status of [402,429]){mock([new Response('secret provider error',{status})]);await assert.rejects(snapshot('toggl',token,{id:'1',parent:'2',name:'Test'},signal(),now),/quota_exceeded/);}
});
test('snapshots reject arbitrary text and invalid metric values',()=>{
 const value={start:now.toISOString(),end:now.toISOString(),metrics:[{key:'hours',value:3}]};
 assert.doesNotThrow(()=>validateSnapshot('harvest',value));
 for(const metrics of [[{key:'notes',value:3}],[{key:'hours',value:NaN}],[{key:'hours',value:3,secret:'test'}],[{key:'hours',value:3,currency:'USD'}]]){
 assert.throws(()=>validateSnapshot('harvest',{...value,metrics}));}
});
test('credentials cannot cross provider, workspace or connection boundaries',()=>{
 process.env.REPORTING_CONNECTOR_TOKEN_KEY=Buffer.alloc(32,1).toString('base64');
 const c={accessToken:token,refreshToken:'synthetic-refresh',expiresAt:now.toISOString()};
 const encrypted=seal('harvest','w1','c1',c);assert.deepEqual(unseal('harvest','w1','c1',encrypted),c);
 for(const args of [['xero','w1','c1'],['harvest','w2','c1'],['harvest','w1','c2']]) assert.throws(()=>unseal(...args,encrypted));
 assert.throws(()=>unseal('harvest','w1','c1',encrypted.slice(0,-8)+'AAAAAAAA'));
});
test('OAuth uses fixed callback, minimal scope and refresh-token rotation',async()=>{
 for(const p of ['XERO','HARVEST','ZOHO_INVENTORY']){process.env[`${p}_REPORTING_ENABLED`]='true';process.env[`${p}_CLIENT_ID`]='synthetic-client';process.env[`${p}_CLIENT_SECRET`]='synthetic-secret';}
 const u=new URL(authorizationUrl('xero','state'));assert.equal(u.searchParams.get('redirect_uri'),'https://www.vaeroex.com/api/integrations/xero/callback');
 assert.equal(u.searchParams.get('scope'),'offline_access accounting.settings.read accounting.invoices.read');
 mock([{access_token:'synthetic-access',refresh_token:'new-refresh-token',expires_in:1800,token_type:'Bearer'}]);
 const c=await exchange('xero',{refresh:'old-refresh-token'},signal());assert.equal(c.refreshToken,'new-refresh-token');
 mock([{access_token:'synthetic-access',expires_in:3600,api_domain:'https://www.zohoapis.eu'}]);
 await assert.rejects(exchange('zoho-inventory',{refresh:'synthetic-refresh'},signal()));
});
test('transport enforces streaming size, request budget and GET-only provider reads',async()=>{
 mock([new Response('x'.repeat(4*1024*1024+1))]);await assert.rejects(readJson(new URL('https://example.com'),{},signal()),/response_too_large/);
 const calls=mock(Array.from({length:12},()=>({})));const get=reader('https://api.harvestapp.com/v2',{},signal());
 await assert.rejects(get('//evil.com'));
 // A rejected path consumes budget conservatively.
 for(let i=0;i<11;i++) await get('/time_entries');await assert.rejects(get('/time_entries'),/budget/);
 assert.ok(calls.every(c=>c.method==='GET'));
});
test('mutation boundary rejects CSRF, forwarded host spoofing and duplicate/oversized forms',async()=>{
 const make=(headers={},body='confirmation=connect')=>new Request('https://www.vaeroex.com/api/integrations/harvest/connect',{method:'POST',headers:{host:'www.vaeroex.com',origin:'https://www.vaeroex.com','content-type':'application/x-www-form-urlencoded',...headers},body});
 assert.doesNotThrow(()=>assertRequest(make()));
 assert.throws(()=>assertRequest(make({origin:'https://evil.example'})));
 assert.throws(()=>assertRequest(make({'x-forwarded-host':'evil.example'})));
 await assert.rejects(formData(make({},'confirmation=connect&confirmation=disconnect')),/invalid_form/);
 await assert.rejects(formData(make({},'x'.repeat(12001))),/invalid_form/);
});

test('historical Harvest imports use requested years and preserve only stable IDs, dates and metrics',async()=>{
 const calls=mock([{time_entries:[{id:47,spent_date:'2018-04-05',hours:2.25,billable:true,is_running:false,user:{name:'Excluded employee'},notes:'Excluded note'}],page:1,next_page:null,total_entries:1}]);
 const report=await importHistory('harvest',token,{id:'123',name:'Test'},signal(),resolveImportRange('2018-01-01','2018-12-31',now),now);
 assert.equal(new URL(calls[0].url).searchParams.get('from'),'2018-01-01');assert.equal(new URL(calls[0].url).searchParams.get('to'),'2018-12-31');
 assert.deepEqual(report.records,[{recordId:'47',day:'2018-04-05',metrics:[{key:'entries',value:1},{key:'hours',value:2.25},{key:'billable_hours',value:2.25},{key:'running',value:0}]}]);
 assert.doesNotMatch(JSON.stringify(report),/Excluded|notes|user/);
 mock([]);await assert.rejects(importHistory('harvest',token,{id:'123',name:'Test'},signal(),{startDate:'2018-01-01',endDate:'2019-12-31'},now),/invalid_date_range/);
});

test('historical Clockify bounds by UTC start date and keeps complete overnight durations',async()=>{
 const calls=mock([[{id:'before',billable:true,timeInterval:{start:'2019-03-31T23:00:00Z',end:'2019-04-01T01:00:00Z'}},
 {id:'in',billable:true,timeInterval:{start:'2019-04-01T23:00:00Z',end:'2019-04-02T02:00:00Z'}},
 {id:'after',billable:false,timeInterval:{start:'2019-04-02T00:00:00Z',end:'2019-04-02T01:00:00Z'}}]]);
 const report=await importHistory('clockify',token,{id:'123',user:'userA',name:'Test'},signal(),resolveImportRange('2019-04-01','2019-04-01',now),now);
 assert.equal(new URL(calls[0].url).searchParams.get('end'),'2019-04-02T00:00:00.000Z');
 assert.equal(report.records.length,1);assert.equal(report.records[0].recordId,'in');assert.equal(report.records[0].metrics.find(m=>m.key==='hours').value,3);
});

test('historical Xero facts retain distinct currencies and empty imports fetch actual base currency',async()=>{
 const row=(i,currency,Type='ACCREC')=>({InvoiceID:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,DateString:'2016-02-29T00:00:00',Type,Status:'AUTHORISED',CurrencyCode:currency,Total:12.34,AmountDue:1.25});
 const calls=mock([{Invoices:[row(1,'USD'),row(2,'EUR','ACCPAY')]}]);
 const range=resolveImportRange('2016-01-01','2016-12-31',now);
 let report=await importHistory('xero',token,{id:'123',name:'Test'},signal(),range,now);
 assert.match(new URL(calls[0].url).searchParams.get('where'),/DateTime\(2016,1,1\).*DateTime\(2017,1,1\)/);
 assert.equal(report.records.length,2);assert.equal(report.records[0].day,'2016-02-29');assert.deepEqual(report.currencies,['USD','EUR']);
 mock([{Invoices:[]},{Organisations:[{BaseCurrency:'CAD'}]}]);
 report=await importHistory('xero',token,{id:'123',name:'Test'},signal(),range,now);assert.deepEqual(report.records,[]);assert.deepEqual(report.currencies,['CAD']);
});

test('historical imports never succeed after truncated pages, duplicate IDs or quota failures',async()=>{
 const range=resolveImportRange('2015-01-01','2015-12-31',now);
 const row={id:1,spent_date:'2015-02-03',hours:2,billable:false,is_running:false};
 mock([{time_entries:[row],page:1,next_page:null,total_entries:2}]);await assert.rejects(importHistory('harvest',token,{id:'123',name:'Test'},signal(),range,now),/incomplete/);
 mock([{time_entries:[row,row],page:1,next_page:null,total_entries:2}]);await assert.rejects(importHistory('harvest',token,{id:'123',name:'Test'},signal(),range,now),/duplicate/);
 mock([new Response('excluded provider body',{status:429})]);await assert.rejects(importHistory('harvest',token,{id:'123',name:'Test'},signal(),range,now),/quota_exceeded/);
 mock(Array.from({length:10},(_,i)=>({time_entries:[{...row,id:i+1}],page:i+1,next_page:i+2,total_entries:11})));
 await assert.rejects(importHistory('harvest',token,{id:'123',name:'Test'},signal(),range,now),/snapshot_too_large/);
});

test('historical Xero imports keep zero-value excluded-status IDs to correct moved invoices',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const calls=mock([{Invoices:[{InvoiceID:id,DateString:'2018-05-01T00:00:00',Type:'ACCREC',Status:'VOIDED',CurrencyCode:'EUR'}]},
 {Organisations:[{BaseCurrency:'USD'}]}]);
 const report=await importHistory('xero',token,{id:'123',name:'Test'},signal(),resolveImportRange('2018-05-01','2018-05-01',now),now);
 assert.match(new URL(calls[0].url).searchParams.get('Statuses'),/VOIDED/);
 assert.equal(report.records[0].recordId,id);assert.ok(report.records[0].metrics.every(m=>m.value===0));
 assert.ok(report.currencies.includes('EUR'));
});
