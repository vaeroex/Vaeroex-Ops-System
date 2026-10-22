/* eslint-disable @typescript-eslint/no-require-imports -- Server-rendered authorization regression. */
const assert=require('node:assert/strict'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {loadSource}=require('./integrations-ui-test-support');
const {reportedFinancialMetrics}=loadSource('lib/integrations/qbo-customer/reported-financial-metrics.ts');
const {financialReport}=loadSource('lib/vsi/financial-calculations.ts');
const {qboBrowser}=loadSource('scripts/website-demo/integration-data.ts');
let role='staff',loads=0;
const report=financialReport(qboBrowser,'/app/settings/integrations/quickbooks/data',false);
const mocks={
 'next/link':({children,...props})=>React.createElement('a',props,children),
 '@/lib/security/require-workspace-access':{requireWorkspaceAccess:async()=>({membership:{role}})},
 '@/lib/vsi/financial-evidence':{retrieveFinancialEvidence:async()=>{loads++;return {reports:[report],limitations:[]}}}
};
const component=loadSource('components/kpis/ReportedFinancialMetrics.tsx',mocks);
const {loadReportedFinancialMetrics}=loadSource('lib/integrations/qbo-customer/load-reported-financial-metrics.ts',mocks);
(async()=>{
 assert.deepEqual(await loadReportedFinancialMetrics(),{groups:[],limitations:[]});assert.equal(loads,0);
 role='owner';const html=renderToStaticMarkup(React.createElement(component.ReportedFinancialMetricsView,await loadReportedFinancialMetrics()));assert.equal(loads,1);assert.match(html,/Reported P&amp;L metrics/);assert.match(html,/not establish an overall Business Health score/);assert.match(html,/not added to overlapping POS/);
 const groups=reportedFinancialMetrics([report,{...report,sourceId:'other',currency:'EUR'}]);assert.equal(groups.length,2);assert(groups.every(g=>!g.originalEvidenceEligible&&g.coverage==='unknown'));
 console.log('Reported P&L: owner-only render, member zero reads, currency separation and nonadditive/Health labels passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
