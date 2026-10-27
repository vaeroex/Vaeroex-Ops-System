/* eslint-disable @typescript-eslint/no-require-imports -- Offline TypeScript fixture loader. */
const assert = require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { pluginProviders } = require('../lib/ai/shared-evidence/contracts.ts');
const { requestedSharedProviders, prioritizeSharedCandidates, prioritizeSharedRows, decodeSharedDiscoveryCatalog } = require('../lib/ai/shared-evidence/generation-selection.ts');
const { requestedVsiProviders, vsiContextGroups } = require('../lib/vsi/context-selection.ts');
const { vsiEvidenceWindowSelection } = require('../lib/vsi/evidence-window.ts');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let checks = 0;
for (const [name, provider] of [['Sheets','google_sheets'],['QBO','quickbooks_online'],['Square','square'],['Loyverse','loyverse'],['Zoho Books','zoho-books'],['Wix Orders','wix-orders'],['Xero','xero'],['Harvest','harvest'],['Clockify','clockify'],['Toggl 2.0','toggl'],['Zoho Inventory','zoho-inventory'],['Katana','katana']]) {
  assert.deepEqual(requestedSharedProviders(`Review stored ${name} records`), [provider]);
  assert(requestedVsiProviders(`Review stored ${name} records`).includes(provider)); checks++;
}
assert.equal(pluginProviders.length, 12);
assert.deepEqual(requestedSharedProviders('Compare squarely stated facts with harvested fields'), []); checks++;
const candidates = [...Array.from({length:40}, (_,i)=>({provider:'square', id:i})), {provider:'xero',id:40}, {provider:'google_sheets',id:41}, {provider:'xero',id:42}];
const preferred = prioritizeSharedCandidates(candidates, ['xero','google_sheets']);
assert.deepEqual(preferred.slice(0,3).map(r=>r.id),[40,41,42]);
assert.equal(new Set(preferred).size,candidates.length); assert.equal(candidates[0].id,0); checks++;
const row = (provider,id,facts,connection=id) => ({provider,id,facts,scope:{entityBinding:'protected',entityId:uuid(1),connectionId:uuid(connection),scope:'stored_records'}});
const rows = [row('google_sheets',2,['Staff cafeteria meals: 8 count']),row('google_sheets',3,['Synthetic dispatch backlog: 4 count']),row('xero',4,['Outstanding sales invoices: 234 USD']),row('google_sheets',5,['Synthetic dispatches: 6 count'],3),row('square',6,['Payment: 100 USD minor units'])];
const before = JSON.stringify(rows);
const ranked = prioritizeSharedRows(rows,['google_sheets','xero'],'Compare Xero outstanding invoices with synthetic Sheets dispatch and backlog');
assert.deepEqual(ranked.slice(0,2).map(r=>r.id),[3,4]);
assert.equal(ranked.find(r=>r.id===5).facts,rows[3].facts); assert.equal(JSON.stringify(rows),before); checks++;
// A requested scope's relevance may be spread over several rows. Selecting by
// max per-row score would discard its union before final scope packing sees it.
const weakScope=Array.from({length:24},(_,i)=>row('google_sheets',100+i,['Dispatch backlog: 0 count'],10));
const wantedScope=['Dispatch: 0 count','Backlog: 4 count','Payroll: 8 hours'].map((fact,i)=>row('google_sheets',200+i,[fact],20));
const scopeRanked=prioritizeSharedRows([...weakScope,...wantedScope],['google_sheets'],'Sheets dispatch backlog payroll');
assert.deepEqual(scopeRanked.slice(0,3).map(r=>r.id),[200,201,202]);
assert(wantedScope.every(wanted=>scopeRanked.slice(0,24).includes(wanted)));checks++;
const packedScopes=vsiContextGroups([...weakScope,...wantedScope].map((row,index)=>({id:`B${index+1}`,sourceId:`source-${row.id}`,sourceType:`shared_${row.provider}`,title:row.provider.replace(/[_-]/g,' '),text:JSON.stringify({scope:row.scope,observations:row.facts})})),[],'Sheets dispatch backlog payroll');
assert.deepEqual(packedScopes[0].indexes,[24,25,26],'preparation and final packing agree on the best complete scope');checks++;
const tied = [row('harvest',7,['Tracked hours: 0 hours']),row('harvest',8,['Tracked hours: 0 hours'])];
assert.deepEqual(prioritizeSharedRows(tied,['harvest'],'Harvest hours').map(r=>r.id),[7,8]); checks++;
const catalog = {stage:'catalog_only',candidates:[{provider:'xero',identity:{kind:'legacy_binding',binding_id:uuid(2)}}],truncated:true,totalCandidates:100,providerCounts:[{provider:'xero',total:1,returned:1},{provider:'square',total:99,returned:0}]};
assert.deepEqual(decodeSharedDiscoveryCatalog(catalog),catalog); checks++;
for (const mutate of [v=>{v.truncated=false;},v=>{v.totalCandidates=99;},v=>{v.providerCounts[0].returned=0;},v=>{v.providerCounts.push(v.providerCounts[0]);},v=>{v.providerCounts[1].returned=1;},v=>{v.providerCounts[0].total=-1;},v=>{v.candidates[0].provider='unknown';},v=>{v.secret='not permitted';},v=>{v.candidates=Array(97).fill(v.candidates[0]);}]) {
 const invalid=structuredClone(catalog);mutate(invalid);assert.throws(()=>decodeSharedDiscoveryCatalog(invalid));checks++;
}
for (const [question,mode,days] of [['Show last 90 days of Xero','last_30_days',30],['Compare last 30 days versus prior 30 days','last_and_prior_30_days',60],['All time sales','last_30_days',30]]) {
 const window=vsiEvidenceWindowSelection(question,new Date('2026-10-27T00:00:00Z'));
 assert.equal(window.mode,mode);assert.equal((Date.parse(window.end)-Date.parse(window.start))/86400000+1,days);
 assert.match(window.limitation,/Other requested ranges are not searched as stated/);assert.match(window.limitation,/not a source reporting period/);checks++;
}
console.log(JSON.stringify({status:'pass',checks,providerCount:12,networkCalls:0,meaning:'ranking and exact discovery metadata only; not admission or model-quality proof'}));
