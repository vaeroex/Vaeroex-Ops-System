const assert=require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader();
const {minimizeQboSourceRecord}=require('../lib/integrations/providers/qbo/minimizers.ts');
const {mapQboJournalPostingsV2,calculateQboJournalPeriodV2}=require('../lib/integrations/provider-runtime/qbo/journal-accounting-v2.ts');
const {enrichJournalFixtures}=require('./qbo-journal-fixtures-v2.cjs');
const raw={QueryResponse:{JournalEntry:[['Sales','Food and beverage sales','Credit','100'],['COGS','Food cost','Debit','30'],['Labor','Labor expense','Debit','25'],['Other','Packaging expense','Debit','10']].map(([Id,name,PostingType,Amount])=>({Id,TxnDate:'2026-09-01',Line:[{Amount,JournalEntryLineDetail:{PostingType,AccountRef:{name}}},{Amount,JournalEntryLineDetail:{PostingType:PostingType==='Debit'?'Credit':'Debit',AccountRef:{name:'Accrued clearing'}}}]}))}};
const enriched=enrichJournalFixtures(raw),accounts=new Map(enriched.classes.map(x=>[x.accountRef,x]));
const project=raw=>minimizeQboSourceRecord({recordType:'JournalEntry',raw,provider:{providerKey:'quickbooks_online',realmId:'synthetic-realm',sourceEnvironment:'production'}});
const postings=enriched.journals.flatMap(j=>mapQboJournalPostingsV2(project(j),'USD',accounts));
assert.deepEqual(calculateQboJournalPeriodV2(postings),{recognizedRevenue:'100',costOfGoodsSold:'30',labor:'25',otherOperatingCosts:'10',operatingProfit:'35'});
assert.throws(()=>calculateQboJournalPeriodV2(postings.filter(p=>p.category!=='labor')),/category_missing/);
assert.throws(()=>mapQboJournalPostingsV2(project(enriched.journals[0]),'EUR',accounts),/unproven/);
assert.throws(()=>mapQboJournalPostingsV2(project(enriched.journals[0]),'USD',new Map()),/unproven/);
for(const mutate of [j=>j.Line[1].Amount='99',j=>j.Line[1].Id='1',j=>j.Line[0].JournalEntryLineDetail.PostingType='unknown',j=>j.Line[0].JournalEntryLineDetail.TaxCodeRef={value:'TAX'}]) {
 const changed=structuredClone(enriched.journals[0]);mutate(changed);assert.throws(()=>mapQboJournalPostingsV2(project(changed),'USD',accounts));
}
const reversed=structuredClone(enriched.journals[3]);for(const l of reversed.Line)l.JournalEntryLineDetail.PostingType=l.JournalEntryLineDetail.PostingType==='Credit'?'Debit':'Credit';
assert.equal(mapQboJournalPostingsV2(project(reversed),'USD',accounts)[0].amount,'-10');
console.log('QBO journal v2 mapper/registry checks passed.');
(async()=>{
 const {loadQboJournalPeriod}=require('../lib/integrations/qbo-customer/journal-accounting.ts');
 const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const data={contractVersion:'qbo_journal_period_v2',workspaceId:id(1),connectionId:id(2),entityId:id(3),authorityId:id(4),currency:'USD',basis:'accrual',periodStart:'2026-09-01',periodEnd:'2026-09-28',recognizedRevenue:'100',costOfGoodsSold:'30',labor:'25',otherOperatingCosts:'10',operatingProfit:'35',coverage:{kind:'admitted_subtotal',liveLedgerComplete:false,journalCount:4,limitation:'Imported subset'},sourceVersionIds:[id(5)],factVersionIds:[id(6)],sources:[{recordId:id(7),versionId:id(5),recordType:'JournalEntry'}],receiptHash:'sha256:'+'a'.repeat(64)};
 const query={connectionId:id(2),periodStart:data.periodStart,periodEnd:data.periodEnd};
 const read=(value,workspaceId=id(1),error=null)=>loadQboJournalPeriod({workspaceId,supabase:{rpc:async()=>({data:value,error})}},query);
 assert.equal((await read(data)).state,'available');
 assert.equal((await read(data,id(99))).state,'unavailable');
 assert.equal((await read({...data,operatingProfit:'99'})).state,'unavailable');
 assert.equal((await read({...data,sources:[{...data.sources[0],versionId:id(99)}]})).state,'unavailable');
 assert.equal((await read({...data,coverage:{...data.coverage,liveLedgerComplete:true}})).state,'unavailable');
 assert.equal((await read(data,id(1),{code:'42501'})).state,'unavailable');
 console.log('QBO journal v2 reader scope, arithmetic, citation and authorization checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
