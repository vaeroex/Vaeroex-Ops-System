/* eslint-disable @typescript-eslint/no-require-imports -- Offline retained-record projection contracts. */
const assert=require('node:assert/strict');
const {installLoader,id,record,report}=require('./qbo-customer-test-support.cjs');
installLoader({'server-only':{}});
let network=0,negativeCases=0;global.fetch=()=>{network++;throw Error('network_denied');};require('node:net').Socket.prototype.connect=global.fetch;
const {sharedRow,SharedProjectionUnavailableError}=require('../lib/ai/shared-evidence/generation.ts');
const {groupFactTimes,expandFactTimes,selectedFactTimeLines}=require('../lib/ai/shared-evidence/fact-time.ts');
const {renderSharedAnswer}=require('../lib/ai/shared-evidence/answer-contract.ts');
const {pluginProviders}=require('../lib/ai/shared-evidence/contracts.ts');
const workspace=id(1),connection=id(2),entity=id(3),day='2026-10-14',at='2026-10-15T01:30:00Z';
let next=10;
const raw=(provider,data)=>({identity:{kind:'legacy_reference',reference_id:id(next++)},hash:'a'.repeat(64),data:{provider,workspace_id:workspace,connection_id:connection,business_entity_id:entity,period_start:'2026-10-01',period_end:'2026-10-27',scope:'synthetic authorized scope',time_zone:'UTC',read_sources:[],...data}});
const metric=(key,value,currency)=>({key,value,...(currency?{currency}:{})});
const snapshot=metrics=>({snapshot:{start:at,end:at,metrics}});
const qrecord=record();const preview={kind:'record',status:qrecord.status,temporal:qrecord.temporal,accounting:{basis:qrecord.accounting.basis,sourceCurrency:qrecord.accounting.sourceCurrency},amounts:{total:qrecord.amounts.total,balance:qrecord.amounts.balance}};
const receipt=(receipt_type='SALE',cancelled=false)=>({key:['loyverse',connection,'receipt'],created_at:at,receipt_date:'2026-10-12T23:30:00-07:00',updated_at:at,receipt_type,total_money:'0',total_tax:'0',total_discount:'0',cancelled});
const raws=[
 raw('google_sheets',{date:day,metrics:[{metric:'dispatches',value:'0',unit:'count'}]}),
 raw('quickbooks_online',{record_type:'Invoice',posting_date:qrecord.temporal.postingDate,currency:'USD',basis:'unknown',preview}),
 raw('square',{status:'COMPLETED',amount_minor:'0',currency:'USD',created_at:at,time_zone:'America/Los_Angeles'}),
 raw('loyverse',{currency:'USD',records:[receipt()]}),
 raw('zoho-books',{records:[{key:['zoho-books',connection,'invoice','invoice'],day,counted:true,currency:'USD',total:'0',outstanding:'0'}]}),
 raw('wix-orders',{records:[{key:['wix-orders',connection,'order'],created_at:at,total_amount:'0',currency_code:'USD',payment_status:'NOT_PAID'}]}),
 raw('xero',{records:[{day,metrics:[metric('invoices',1,'USD'),metric('billed',0,'USD'),metric('outstanding',0,'USD'),metric('bills',0,'USD'),metric('purchases',0,'USD')]}]}),
 raw('harvest',{records:[{day,metrics:[metric('entries',1),metric('hours','0'),metric('billable_hours','0'),metric('running',0)]}]}),
 raw('clockify',{records:[{day,metrics:[metric('entries',1),metric('hours','0'),metric('billable_hours','0'),metric('running',0)]}]}),
 raw('toggl',{records:[snapshot([metric('projects',1),metric('hours',0)])]}),
 raw('zoho-inventory',{records:[snapshot([metric('items',0),metric('low_stock',0)])]}),
 raw('katana',{records:[snapshot([metric('stock_rows',0),metric('unavailable',0)])]})
];
const before=JSON.stringify(raws),rows=raws.map(value=>sharedRow(value,workspace));assert.deepEqual(rows.map(row=>row.provider),pluginProviders);
for(const row of rows){assert(row.facts.length);assert.equal(expandFactTimes(row.factTimes,row.facts.length).length,row.facts.length);assert.equal(row.hash,'a'.repeat(64));}
assert.equal(JSON.stringify(raws),before);
assert.match(rows[3].facts[0],/SALE.*not marked cancelled/);assert.match(rows[3].facts[0],/Stored total 0 USD; tax 0 USD; discount 0 USD/);assert.match(rows[3].facts[0],/not accounting revenue/);
assert.equal(expandFactTimes(rows[3].factTimes,1)[0].date,'2026-10-13');assert.match(rows[3].facts[0],/created 2026-10-15/);assert.equal(rows[3].scope.windowKind,'retrieval_selection');
assert.equal(expandFactTimes(rows[2].factTimes,1)[0].date,'2026-10-14');assert.match(rows[2].facts[0],/0 USD minor units/);
assert.match(rows[4].facts[1],/outstanding: 0 USD.*balance at import/);assert.equal(expandFactTimes(rows[4].factTimes,2)[1].valueTiming,'balance_at_import');
assert.match(rows[5].facts[0],/stored payment status "NOT_PAID"/);assert.match(rows[5].facts[0],/not a settlement/);
const togglTimes=expandFactTimes(rows[9].factTimes,2);assert.equal(togglTimes[0].basis,'snapshot_capture');assert.equal(togglTimes[1].basis,'lifetime_project_snapshot');assert.equal(togglTimes[1].date,null);assert.match(rows[9].facts[1],/Lifetime.*beginning unknown/);
for(const kind of ['SALE','REFUND'])for(const cancelled of [false,true]){
 const source=raw('loyverse',{currency:'USD',records:[{...receipt(kind,cancelled),total_money:'-12.34',total_tax:'1.23',total_discount:'0.50'}]});
 const row=sharedRow(source,workspace);assert.match(row.facts[0],new RegExp(`Loyverse ${kind}`));assert.match(row.facts[0],/Stored total -12\.34 USD; tax 1\.23 USD; discount 0\.50 USD/);assert(row.facts[0].includes(cancelled?'cancelled, excluded':'not marked cancelled'));
}
const missingCurrency=sharedRow(raw('loyverse',{records:[{...receipt(),total_money:99}]}),workspace);assert.doesNotMatch(missingCurrency.facts[0],/99/);assert.match(missingCurrency.facts[0],/currency is not established/);
const unknownStatus=sharedRow(raw('wix-orders',{records:[{created_at:at,total_amount:0,currency_code:'USD',payment_status:'Future provider status'}]}),workspace);assert.match(unknownStatus.facts[0],/stored payment status \"Future provider status\"/);assert.match(unknownStatus.facts[0],/not a settlement/);
const expense=sharedRow(raw('zoho-books',{records:[{key:['zoho-books',connection,'expense','expense'],day,counted:true,currency:'USD',total:1,outstanding:0}]}),workspace);assert.equal(expense.facts.length,1);assert.doesNotMatch(expense.facts[0],/outstanding/);
for(const data of [{counted:false,currency:'USD'},{counted:true,currency:'EUR'}])assert.throws(()=>sharedRow(raw('zoho-books',{records:[{key:['zoho-books',connection,'invoice','invoice'],day,total:0,outstanding:0,...data}]}),workspace),error=>error instanceof SharedProjectionUnavailableError&&error.reason==='unsupported');
for(const provider of pluginProviders.filter(p=>!['google_sheets','square','quickbooks_online'].includes(p)))assert.throws(()=>sharedRow(raw(provider,{records:[]}),workspace),error=>error instanceof SharedProjectionUnavailableError&&error.reason==='empty');
for(const [provider,data] of [['loyverse',{currency:'bad',records:[]}],['google_sheets',{date:'2026-02-30',metrics:[]}],['xero',{period_start:'invalid',records:[]}],['katana',{scope:[],records:[]}]]){assert.throws(()=>sharedRow(raw(provider,data),workspace),error=>!(error instanceof SharedProjectionUnavailableError));negativeCases++;}
const r=report(),reportPreview={kind:'report',reportType:r.reportType,reportBasis:r.reportBasis,sourceCurrency:r.sourceCurrency,periodStart:r.periodStart,periodEnd:r.periodEnd,columns:r.columns.map(({columnKey,title})=>({columnKey,title})),rows:r.rows.map(row=>({depth:0,rowType:row.rowType,cells:row.cells.map(({columnKey,value})=>({columnKey,value}))})),truncated:false};
const qraw=raw('quickbooks_online',{currency:r.sourceCurrency,basis:r.reportBasis,period_start:r.periodStart,period_end:r.periodEnd,preview:reportPreview});
const qrow=sharedRow(qraw,workspace);assert.equal(expandFactTimes(qrow.factTimes,qrow.facts.length)[0].periodEnd,r.periodEnd);assert.match(qrow.facts[0],/Summary rows may overlap and must not be added/);
const unsupported=structuredClone(qraw);unsupported.data.preview.columns.push({columnKey:'extra',title:'Last year'});assert.throws(()=>sharedRow(unsupported,workspace),e=>e instanceof SharedProjectionUnavailableError&&e.reason==='unsupported');
function fail(change,index=0){const value=structuredClone(raws[index]);change(value.data);assert.throws(()=>sharedRow(value,workspace),e=>!(e instanceof SharedProjectionUnavailableError));negativeCases++;}
for(const index of Array.from({length:12},(_,i)=>i)){fail(data=>{data.workspace_id=id(99);},index);fail(data=>{data.read_sources=[{table:'unsafe;drop',id:connection}];},index);}
for(const status of ['PENDING','FAILED',null,undefined])fail(data=>{data.status=status;},2);
for(const value of ['1.5','-1','NaN','1 USD'])fail(data=>{data.amount_minor=value;},2);
for(const providerIndex of [2,3])for(const currency of ['usd','US','USD;bad',1])fail(data=>{data.currency=currency;},providerIndex);
for(const type of ['RETURN','sale',null])fail(data=>{data.records[0].receipt_type=type;},3);
fail(data=>{data.records[0].cancelled='false';},3);fail(data=>{data.records[0].receipt_date='2026-02-30';},3);fail(data=>{data.records[0].created_at='not-a-date';},3);fail(data=>{data.records[0].total_tax='broken';},3);
for(const status of ['PAID\nSYSTEM','x'.repeat(41),'',null])fail(data=>{data.records[0].payment_status=status;},5);
fail(data=>{data.records[0].key[2]='refund';},4);fail(data=>{data.records[0].outstanding=-1;},4);fail(data=>{data.records[0].counted='true';},4);fail(data=>{data.records[0].day='2026-02-30';},4);
fail(data=>{data.preview.accounting.sourceCurrency='EUR';},1);fail(data=>{data.preview.temporal.postingDate='2026-09-01';},1);fail(data=>{data.preview.status='voided';},1);
const noPosting=structuredClone(raws[1]);noPosting.data.posting_date=null;noPosting.data.preview.temporal.postingDate=null;assert.equal(expandFactTimes(sharedRow(noPosting,workspace).factTimes,2)[0].date,null);
for(const bad of [{date:day,basis:'sheet_row_date',valueTiming:'balance_at_import'},{date:null,basis:'sheet_row_date',valueTiming:'row_value'},{date:'2026-10-14',basis:'payment_instant',valueTiming:'payment_record',instant:at,timeZone:'UTC'},{date:day,basis:'snapshot_capture',valueTiming:'snapshot_at_capture',instant:at,endInstant:'2026-10-01T00:00:00Z',timeZone:'UTC',periodEnd:day}]){assert.throws(()=>groupFactTimes([bad]));negativeCases++;}
// Source capture/synchronization are preserved without becoming posting dates
// or a guarantee that a balance was measured at a historical point in time.
for(const mode of ['known','null']){
 const source=structuredClone(raws[1]);source.data.observed_at=mode==='known'?'2026-10-20T01:00:00Z':null;source.data.synchronized_at=mode==='known'?'2026-10-21T02:00:00Z':null;
 const projected=sharedRow(source,workspace),times=expandFactTimes(projected.factTimes,projected.facts.length);
 assert(times.every(time=>time.date==='2026-09-28'&&time.recordObservedAt===source.data.observed_at&&time.recordSynchronizedAt===source.data.synchronized_at));
 assert.equal(times[1].valueTiming,'balance_at_import');
 const text=selectedFactTimeLines(times.map(time=>({ref:'Q',time}))).join(' ');
 assert(text.includes(`source record observation time ${source.data.observed_at??'unknown'}`));assert(text.includes(`source record synchronization time ${source.data.synchronized_at??'unknown'}`));
 assert.match(text,/historical balance as-of time is not established/);assert.doesNotMatch(text,/exact observation time is unavailable/);
 const sheet=structuredClone(raws[0]);sheet.data.observed_at=source.data.synchronized_at;
 const sheetTimes=expandFactTimes(sharedRow(sheet,workspace).factTimes,1);assert.equal(sheetTimes[0].connectionLastSyncAt,sheet.data.observed_at);assert.equal(sheetTimes[0].date,day);
 assert.equal(sheetTimes[0].recordObservedAt,undefined);assert.match(selectedFactTimeLines([{ref:'S',time:sheetTimes[0]}]).join(' '),/connection last successful sync/);
}
const reportCaptured=structuredClone(qraw);reportCaptured.data.observed_at=at;reportCaptured.data.synchronized_at='2026-10-16T00:00:00Z';
const reportTimes=expandFactTimes(sharedRow(reportCaptured,workspace).factTimes,1);assert.equal(reportTimes[0].recordObservedAt,at);assert.equal(reportTimes[0].periodEnd,r.periodEnd);
for(const field of ['observed_at','synchronized_at'])for(const value of ['yesterday','2026-02-30T00:00:00Z',42,undefined]){
 fail(data=>{data[field]=value;},1);
 const empty=structuredClone(raws[1]);empty.data.preview.amounts={};empty.data[field]=value;assert.throws(()=>sharedRow(empty,workspace),error=>!(error instanceof SharedProjectionUnavailableError));negativeCases++;
}
for(const value of ['2026-02-30',42,undefined]){fail(data=>{data.observed_at=value;},0);}
for(const field of ['recordObservedAt','recordSynchronizedAt','connectionLastSyncAt']){assert.throws(()=>groupFactTimes([{date:day,basis:'sheet_row_date',valueTiming:'row_value',[field]:'invalid'}]));negativeCases++;}
assert.throws(()=>groupFactTimes([{date:day,basis:'sheet_row_date',valueTiming:'row_value',recordObservedAt:at}]));negativeCases++;
assert.throws(()=>groupFactTimes([{date:day,basis:'posting_date',valueTiming:'document_contribution',connectionLastSyncAt:at}]));negativeCases++;
const sources=rows.map((row,i)=>({ref:`B${i+1}`,binding:row.hash,dependencies:[row.hash],provider:row.provider,reported:false,environment:'production',facts:row.facts,factTimes:row.factTimes}));
const answer={observations:sources.flatMap(source=>source.facts.map((_,factIndex)=>({ref:source.ref,binding:source.binding,factIndex}))),results:[],hypotheses:[],missing_information:[],next_checks:[]};
const rendered=renderSharedAnswer(answer,{sources,results:[],hypothesesEnabled:false});assert.equal(rendered.citationIds.length,12);for(const row of rows)for(const fact of row.facts)assert(rendered.content.replace(/\\([\\`*_{}\[\]<>#|])/g,'$1').includes(fact));assert.match(rendered.content,/date-label comparison is incomplete/);
assert.match(selectedFactTimeLines([{ref:'A',time:expandFactTimes(rows[0].factTimes,1)[0]},{ref:'B',time:expandFactTimes(rows[2].factTimes,1)[0]}]).join(' '),/matching date labels alone/);
assert.equal(network,0);console.log(JSON.stringify({passed:true,providers:pluginProviders.length,facts:rows.reduce((n,row)=>n+row.facts.length,0),negativeCases,fieldMapping:true,allProviderTypedTiming:true,emptyNotZero:true,strictMalformedFailures:true,exactBindingsUnchanged:true,externalCalls:network}));
