/* eslint-disable @typescript-eslint/no-require-imports -- Provider shape boundary regression. */
const assert=require('node:assert/strict');
const {loadSource}=require('./integrations-ui-test-support');
const {parseQboReport}=loadSource('lib/integrations/providers/qbo/reports.ts');
const {financialReport,calculateFinancials}=loadSource('lib/vsi/financial-calculations.ts');
const {qboBrowser}=loadSource('scripts/website-demo/integration-data.ts');
function parsedReport(net='-2000',extra=[]){
 const raw={Header:{ReportName:'ProfitAndLoss',ReportBasis:'Accrual',StartPeriod:'2026-09-21',EndPeriod:'2026-10-18',Currency:'USD'},Columns:{Column:[{ColTitle:'Account',ColType:'Account'},{ColTitle:'Total',ColType:'Money'}]},Rows:{Row:[
  {type:'Section',group:'Income',Header:{ColData:[{value:'Income'},{value:''}]},Rows:{Row:[{type:'Data',ColData:[{value:'Sales'},{value:'120000'}]}]},Summary:{ColData:[{value:'Total Income'},{value:'120000'}]}},
  {type:'Section',group:'GrossProfit',Summary:{ColData:[{value:'Gross Profit'},{value:'78000'}]}},
  {type:'Section',group:'NetIncome',Summary:{ColData:[{value:'Net Income'},{value:net}]}},...extra]}};
 const parsed=parseQboReport({raw,reportType:'ProfitAndLoss',provider:{providerKey:'quickbooks_online',sourceEnvironment:'production',realmId:'synthetic'}});
 const rows=[];function visit(items,depth=0){for(const row of items){rows.push({depth,rowType:row.rowType,cells:row.cells});visit(row.children,depth+1)}}visit(parsed.rows);
 const b=structuredClone(qboBrowser);Object.assign(b.detail.source,{periodStart:'2026-09-21',periodEnd:'2026-10-18',currency:'USD',accountingBasis:'accrual'});
 b.detail.value={kind:'report',reportType:'ProfitAndLoss',columns:parsed.columns,rows,truncated:false};return b;
}
for(const [net,margin] of [['-2000','-1.67'],['0','0.00'],['22000','18.33'],['1000','0.83']]){
 const b=parsedReport(net),r=financialReport(b,'/source',false);
 assert.equal(r.totals.netIncome.amount,net);assert.equal(r.totals.grossProfit.amount,'78000');
 assert.equal(r.totals.grossProfit.row,5);assert.equal(r.totals.netIncome.row,7);assert.equal(r.rows[r.totals.netIncome.row-1].label,'Net Income');assert.equal(calculateFinancials([r]).margins[0].netMargin.value,margin);
}
const duplicate=parsedReport('1000',[{type:'Section',Summary:{ColData:[{value:'Net Income'},{value:'2000'}]}}]);
assert.equal(financialReport(duplicate,'/source',false).totals.netIncome,undefined);
for(const mutate of [
 b=>{b.detail.value.rows.at(-2).cells=[{columnKey:'label',value:'Unlabelled row'}]},
 b=>{b.detail.value.rows.at(-2).depth=1;b.detail.value.rows.at(-1).depth=2},
 b=>{b.detail.value.rows.push({depth:1,rowType:'data',cells:[]})},
 b=>{b.detail.value.rows.splice(-1,0,{depth:1,rowType:'data',cells:[]})},
 b=>{b.detail.value.truncated=true},
 b=>{b.detail.value.rows.at(-1).rowType='data'}
]){const b=parsedReport();mutate(b);assert.equal(financialReport(b,'/source',false).totals.netIncome,undefined)}
console.log('QBO parser-to-financial summary shape: losses, zero, profit, duplicate, named/nested/multi-child wrappers, truncated and ordinary rows passed.');
