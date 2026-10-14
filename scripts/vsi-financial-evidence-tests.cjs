/* eslint-disable @typescript-eslint/no-require-imports -- Isolated deterministic financial qualification. */
const assert = require('node:assert/strict');
const { loadSource } = require('./integrations-ui-test-support');
const { financialReport, calculateFinancials } = loadSource('lib/vsi/financial-calculations.ts');
const { qboBrowser } = loadSource('scripts/website-demo/integration-data.ts');
function report(start, end, values, overrides = {}) {
 const b = structuredClone(qboBrowser); b.connectionId = '00000000-0000-4000-8000-000000000204';
 b.detail.source.periodStart = start; b.detail.source.periodEnd = end;
 b.detail.value.rows = Object.entries(values).map(([label, amount]) => ({depth:0,rowType:'summary',cells:[{columnKey:'account',value:label},{columnKey:'amount',value:amount}]}));
 Object.assign(b.detail.value, overrides);
 return financialReport(b, '/app/settings/integrations/quickbooks/data?sourceId='+end, false);
}
const old = report('2026-09-22','2026-09-28',{'Total Income':'24000.00','Total Cost of Goods Sold':'7200.00','Gross Profit':'16800.00','Total Expenses':'9500.00','Net Income':'7300.00'});
const next = report('2026-09-29','2026-10-05',{'Total Income':'26000.00','Total Cost of Goods Sold':'8060.00','Gross Profit':'17940.00','Total Expenses':'11000.00','Net Income':'6940.00'});
let result=calculateFinancials([old,next]);
assert.equal(result.margins[0].grossMargin.value,'70.00');
assert.equal(result.margins[1].netMargin.value,'26.69');
assert.equal(result.comparison.marginChanges.find(x=>x.category==='netIncome').percentagePoints,'-3.72');
for(const field of ['currency','periodStart','basis']) assert.equal(calculateFinancials([{...next,[field]:null}]).margins[0].netMargin.value,null);
assert.equal(result.comparison.changes.find(x=>x.category==='netIncome').change,'-360.00');
assert.equal(result.comparison.changes.find(x=>x.category==='revenue').percentChange.value,'8.33');
for(const [field,value,reason] of [['currency','EUR',/currencies/],['basis','cash',/accounting bases/],['connectionId','other',/entities/],['periodStart','2026-09-28',/periods/]]) {
 assert.match(calculateFinancials([old,{...next,[field]:value}]).comparison.reason,reason);
}
assert.match(calculateFinancials([old,{...next,periodEnd:'2026-10-06'}]).comparison.reason,/periods/);
const missing=report('2026-09-29','2026-10-05',{'Total Income':'26000.00'});
assert.equal(calculateFinancials([old,missing]).margins[1].grossMargin.value,null);
assert.equal(calculateFinancials([old,missing]).comparison.changes.find(x=>x.category==='costOfGoodsSold').change,null);
for(const revenue of ['0','-1']) assert.equal(calculateFinancials([{...next,totals:{...next.totals,revenue:{amount:revenue,row:1}}}]).margins[0].netMargin.value,null);
assert.equal(calculateFinancials([{...next,totals:{...next.totals,netIncome:{amount:'-100',row:5}}}]).margins[0].netMargin.value,'-0.38');
const truncated=report('2026-09-29','2026-10-05',{'Total Income':'26000'},{truncated:true});
assert.deepEqual(truncated.totals,{});
const multi=report('2026-09-29','2026-10-05',{'Total Income':'26000'},{columns:[{columnKey:'account',title:'Account'},{columnKey:'a',title:'Jan'},{columnKey:'b',title:'Feb'}]});
assert.deepEqual(multi.totals,{});
const ambiguous=report('2026-09-29','2026-10-05',{'Total Income':'26000','Total Revenue':'27000'});assert.equal(ambiguous.totals.revenue,undefined);
const parent=structuredClone(next);parent.rows.push({row:9,depth:1,kind:'data',path:['Income','Food'],label:'Food',amount:'26000'});
assert.equal(calculateFinancials([old,parent]).comparison.changes.find(x=>x.category==='revenue').current.amount,'26000.00');
assert.equal(calculateFinancials([{...old,periodStart:'2026-08-01',periodEnd:'2026-08-31'},{...next,periodStart:'2026-09-01',periodEnd:'2026-09-30'}]).comparison.reason,null);
const leafOld=structuredClone(old),leafNext=structuredClone(next);
leafOld.rows.push({row:6,depth:1,kind:'data',path:['Expenses','Labor'],label:'Labor',amount:'7200'});
leafNext.rows.push({row:6,depth:1,kind:'data',path:['Expenses','Labor'],label:'Labor',amount:'7800'});
const leaf=calculateFinancials([leafOld,leafNext]).comparison.lineChanges[0];
assert.equal(leaf.change,'600.00');assert.equal(leaf.previousPercentOfRevenue.value,'30.00');assert.equal(leaf.currentPercentOfRevenue.value,'30.00');
leafNext.rows.push({...leafNext.rows.at(-1),row:7});assert.equal(calculateFinancials([leafOld,leafNext]).comparison.lineChanges.length,0);
console.log('Financial decimal calculations: ratios, losses, missing inputs, mismatched scope, nonadditivity and bounded projections passed.');

const totalColumn=report('2026-09-29','2026-10-05',{'Total Income':'26000'},{columns:[{columnKey:'account',title:'Account'},{columnKey:'amount',title:'Total'}]});
assert.equal(totalColumn.totals.revenue.amount,'26000');
(async()=>{
 const fixture=structuredClone(qboBrowser);fixture.connections[0].state='active';
 const workspaceId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
 let calls=0,denied=false,foreign=false;
 const access={workspaceId,user:{id:userId},membership:{workspace_id:workspaceId,user_id:userId,role:'owner',status:'active'},supabase:{auth:{getClaims:async()=>({data:{claims:{sub:userId,session_id:'33333333-3333-4333-8333-333333333333'}}})},
  from(table){assert.equal(table,'integration_connection_summaries');const filters=[];const q={then(resolve){assert(filters.some(x=>x[0]==='eq'&&x[1]==='workspace_id'&&x[2]===workspaceId));assert(filters.some(x=>x[0]==='contains'&&x[1]==='granted_scopes'));return resolve({data:denied?[]:[{id:fixture.connectionId,status:'active'}],error:null});}};for(const method of ['select','eq','contains','in','order','limit'])q[method]=(...args)=>{filters.push([method,...args]);return q;};return q;},
  async rpc(name,args){calls++;assert.equal(name,'qbo_customer_source_browse_v1');assert.equal(args.p_workspace_id,workspaceId);const b=structuredClone(fixture);if(!args.p_source_id)b.detail=null;else b.detail={source:b.detail.source,preview:{state:b.detail.state,value:b.detail.value}};if(foreign)b.connectionId='44444444-4444-4444-8444-444444444444';return {data:b,error:null};}}};
 const {retrieveFinancialEvidence}=loadSource('lib/vsi/financial-evidence.ts',{'@/lib/integrations/control-plane/qbo-customer-availability':{qboProductionCustomerConnectionsEnabled:()=>true}});
 let evidence=await retrieveFinancialEvidence(access,'2026-10-15T18:00:00Z');assert.equal(evidence.sources.length,2);assert.equal(JSON.parse(evidence.sources[0].text).stale,true);
 for(const [field,value] of [['mappingStatus','replaced'],['validation','invalid'],['validationWork','quarantined'],['lifecycle','deleted']]){
  const prior=fixture.sources[0][field];fixture.sources[0][field]=value;assert.equal((await retrieveFinancialEvidence(access,'2026-10-15T18:00:00Z')).sources.length,0);fixture.sources[0][field]=prior;
 }
 fixture.connections[0].state='disconnected';assert.equal((await retrieveFinancialEvidence(access,'2026-10-15T18:00:00Z')).sources.length,0);fixture.connections[0].state='active';
 foreign=true;assert.equal((await retrieveFinancialEvidence(access,'2026-10-15T18:00:00Z')).sources.length,0);foreign=false;
 denied=true;assert.equal((await retrieveFinancialEvidence(access,'2026-10-15T18:00:00Z')).sources.length,0);denied=false;
 const before=calls;access.membership.role='staff';assert.equal((await retrieveFinancialEvidence(access,'2026-10-15T18:00:00Z')).sources.length,0);assert.equal(calls,before);
 console.log('Financial retrieval: scoped RPC, granted scope, stale labeling, ineligible/foreign records and unauthorized role passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
