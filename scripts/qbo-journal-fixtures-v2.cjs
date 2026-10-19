/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS synthetic fixtures and isolated native adapter tests. */
/* Provider-shaped synthetic fixture enrichment; no provider access or oracle inputs. */
const { createHash } = require('node:crypto');
// Authored chart of accounts: exact reference mapping, not a production name classifier.
const definitions = {
 'Food and beverage sales': ['Income', 'revenue'], 'Food cost': ['Cost of Goods Sold', 'cost_of_goods_sold'],
 'Labor expense': ['Expense', 'labor'], 'Delivery commissions': ['Expense', 'other_operating_costs'],
 'Packaging expense': ['Expense', 'other_operating_costs'], 'Rent and occupancy': ['Expense', 'other_operating_costs'],
 'Utilities': ['Expense', 'other_operating_costs'], 'Other operating expenses': ['Expense', 'other_operating_costs'],
 'Accrued clearing': ['Other Current Liability', 'balance_sheet'], 'Inventory asset': ['Other Current Asset', 'balance_sheet']
};
function enrichJournalFixtures(raw) {
 const entries=raw.QueryResponse.JournalEntry;
 if(!Array.isArray(entries)||!entries.length) throw new Error('journal_fixture_missing');
 const names=[...new Set(entries.flatMap(j=>j.Line.map(l=>l.JournalEntryLineDetail.AccountRef.name)))].sort();
 const ids=new Map(names.map(name=>[name,'ck-account-'+createHash('sha256').update(name).digest('hex').slice(0,16)]));
 const first=entries.map(j=>j.TxnDate).sort()[0];
 const metadata=date=>({CreateTime:date+'T08:00:00Z',LastUpdatedTime:date+'T08:00:00Z'});
 const accounts=names.map(name=>{
  if(!definitions[name])throw new Error('unclassified_fixture_account');
  return {Id:ids.get(name),Name:name,AccountType:definitions[name][0],Active:true,CurrencyRef:{value:'USD'},SyncToken:'1',MetaData:metadata(first)};
 });
 const journals=entries.map(j=>({...j,SyncToken:'1',CurrencyRef:{value:'USD'},GlobalTaxCalculation:'NotApplicable',MetaData:metadata(j.TxnDate),
  Line:j.Line.map((line,i)=>({...line,Id:String(i+1),DetailType:'JournalEntryLineDetail',
   JournalEntryLineDetail:{...line.JournalEntryLineDetail,AccountRef:{...line.JournalEntryLineDetail.AccountRef,value:ids.get(line.JournalEntryLineDetail.AccountRef.name)}}}))}));
 return {accounts,journals,classes:accounts.map(a=>({accountRef:a.Id,accountType:a.AccountType,category:definitions[a.Name][1]})),
  provenance:{synthetic:true,providerFetchPerformed:false,completeLiveLedger:false,source:'Authored journal fixture; schema enrichment preserves amounts and posting dates.'}};
}
module.exports={enrichJournalFixtures};
