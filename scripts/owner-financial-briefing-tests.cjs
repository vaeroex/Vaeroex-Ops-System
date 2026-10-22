/* eslint-disable @typescript-eslint/no-require-imports -- Native private projection regression. */
const assert = require('node:assert/strict');
const {loadSource} = require('./integrations-ui-test-support');
const {buildOwnerFinancialBriefingPackage} = loadSource('lib/ai/intelligence-briefing/owner-financial-package.ts');
const {validateIntelligenceBriefingOutput} = loadSource('lib/ai/intelligence-briefing/validation.ts');
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const period = (start,end,values) => ({contractVersion:'qbo_journal_period_v2',workspaceId:id(1),connectionId:id(2),entityId:id(3),authorityId:id(4),
 currency:'USD',basis:'accrual',periodStart:start,periodEnd:end,recognizedRevenue:values[0],costOfGoodsSold:values[1],labor:values[2],otherOperatingCosts:values[3],operatingProfit:values[4],
 coverage:{kind:'admitted_subtotal',liveLedgerComplete:false,journalCount:192,limitation:'Admitted subset; full ledger coverage unknown.'},
 sources:[{recordId:id(7),versionId:id(5),recordType:'JournalEntry'}],sourceVersionIds:[id(5)],factVersionIds:[id(6)],receiptHash:'sha256:'+ (end==='2026-09-20'?'a':'b').repeat(64)});
const prior=period('2026-08-24','2026-09-20',['100000','30000','30000','25000','15000']);
for(const values of [['120000','34800','34200','29000','22000'],['120000','42000','42000','38000','-2000'],['120000','42000','42000','35000','1000']]){
 const current=period('2026-09-21','2026-10-18',values);
 const p=buildOwnerFinancialBriefingPackage({workspaceId:id(1),periods:[prior,current],asOf:'2026-10-19T12:00:00Z'});
 assert.equal(p.eligibility,'limited');assert.equal(p.confidence,'Low');assert.equal(p.businessHealth.available,false);assert.equal(p.businessHealth.score,null);
 assert.equal(p.evidenceCoverage.independentSourceCount,1);assert.equal(p.evidenceCoverage.overallCoverage,null);
 assert(p.manifest.evidence.every(e=>!e.originalEvidenceEligible&&e.evidenceRole==='derived'));
 assert(p.signals.every(s=>s.fact.includes('admitted journal subset')||s.fact.includes('admitted journal subtotals')));
 assert(p.signals.filter(s=>s.ref.startsWith('J1')).every(s=>s.periodContext==='historical_context'));
 const signal=p.signals.find(s=>s.ref==='JC-operatingProfit');assert(signal.fact.includes('USD '+values[4]));
 const claims=p.signals.filter(s=>s.ref.startsWith('JC')).map(s=>({text:s.fact,support_refs:[s.ref]}));
 const validated=validateIntelligenceBriefingOutput({executive_summary:claims[4],sections:[{section_id:'financial_performance',summary:signal.fact,support_refs:[signal.ref],claims}],leadership_considerations:[{text:"Review historical context through October 18, 2026 before using these totals for planning.",support_refs:[signal.ref]}],limitation_refs:p.limitations.map(l=>l.ref)},p);
 assert.equal(validated.ok, true, JSON.stringify(validated));
 for(const change of [{workspaceId:id(9)},{connectionId:id(9)},{currency:'EUR'},{periodStart:'2026-09-20'}])
  assert.throws(()=>buildOwnerFinancialBriefingPackage({workspaceId:id(1),periods:[prior,{...current,...change}],asOf:'2026-10-19T12:00:00Z'}));
}
assert.throws(()=>buildOwnerFinancialBriefingPackage({workspaceId:id(1),periods:[],asOf:'2026-10-19T12:00:00Z'}));
console.log('Owner financial projection: exact journal values, private limited scope, no Health promotion, period/currency/tenant fences and existing output validator passed.');
