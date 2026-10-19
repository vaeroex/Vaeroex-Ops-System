/* eslint-disable @typescript-eslint/no-require-imports -- Node tests compile the production TypeScript adapter. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const originalLoad = Module._load, oldTs = require.extensions['.ts'], savedFetch = global.fetch;
Module._load = function(name, parent, main) { return name === 'server-only' ? {} : originalLoad.call(this, name, parent, main); };
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText, file);
const { recentReceipts } = require('../lib/integrations/loyverse/server.ts');
after(()=> { global.fetch=savedFetch; Module._load=originalLoad; require.extensions['.ts']=oldTs; });
const start='2024-01-01T00:00:00.000Z', end='2024-02-01T00:00:00.000Z';
const row=(id,created='2024-01-05T12:00:00Z')=>({receipt_number:id,store_id:'s',created_at:created,
  receipt_date:'2020-01-01T12:00:00Z',updated_at:'2024-02-02T12:00:00Z',receipt_type:'SALE',total_money:12,
  customer_id:'must-not-persist', note:'must-not-persist'});
const mock=(responses)=>{
  const calls=[];
  global.fetch=async (url,init)=>{
    calls.push(new URL(url)); assert.equal(init.redirect,'error'); assert.equal(init.cache,'no-store');
    const response=responses.shift(); if (!response) throw new Error('Unexpected request');
    return response instanceof Response ? response : Response.json(response);
  }; return calls;
};
test('Loyverse imports historical server creation timestamps and retains backdated receipts without sensitive details',async()=>{
  const calls=mock([{receipts:[row('first',start),row('backdated'),row('before','2023-12-31T23:59:59.999Z'),row('end',end)],cursor:'next'},
    {receipts:[row('last','2024-01-31T23:59:59Z')]}]);
  const facts=await recentReceipts('synthetic',start,end);
  assert.deepEqual(facts.map(r=>r.receipt_number),['first','backdated','last']);
  assert.equal(facts[0].created_at,start); assert.equal(facts[1].receipt_date,'2020-01-01T12:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(facts),/must-not-persist|customer_id|note/);
  assert.equal(calls[0].searchParams.get('created_at_min'),'2023-12-31T23:59:59.999Z');
  assert.equal(calls[0].searchParams.get('created_at_max'),end);
  assert.equal(calls[1].searchParams.get('cursor'),'next');
});
test('Loyverse refuses incomplete, looping, duplicate or malformed historical imports',async()=>{
  mock([{receipts:[row('a')],cursor:'same'},{receipts:[row('b')],cursor:'other'},{receipts:[row('c')],cursor:'same'}]);
  await assert.rejects(recentReceipts('synthetic',start,end),/pagination_invalid/);
  mock([{receipts:[row('a')],cursor:'next'},{receipts:[row('a')]}]);
  await assert.rejects(recentReceipts('synthetic',start,end),/duplicate_receipt/);
  mock([{receipts:[{...row('a'),created_at:undefined}]}]);
  await assert.rejects(recentReceipts('synthetic',start,end));
  mock([{receipts:[row('outside','2020-01-01T00:00:00Z')]}]);
  await assert.rejects(recentReceipts('synthetic',start,end),/invalid_window/);
  mock(Array.from({length:20},(_,i)=>({receipts:[row(`r${i}`)],cursor:`page${i}`})));
  await assert.rejects(recentReceipts('synthetic',start,end),/receipt_limit_exceeded/);
  mock([{receipts:[row('a')],cursor:'next'},new Response('private provider body',{status:429})]);
  await assert.rejects(recentReceipts('synthetic',start,end),/quota_exceeded/);
  mock([{receipts:[]}]); assert.deepEqual(await recentReceipts('synthetic',start,end),[]);
});
