// Synthetic protected-reader projections. No credentials, database or provider calls.
const assert=require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{}});
const {sharedRow,prepareSharedGeneration}=require('../lib/ai/shared-evidence/generation.ts');
const {sharedFinancialBoundaries}=require('../lib/ai/shared-evidence/financial-boundaries.ts');
const {extendSharedBriefingPackage}=require('../lib/ai/shared-evidence/briefing.ts');
const {pluginProviders}=require('../lib/ai/shared-evidence/contracts.ts');
const {validateSharedVsiRelationships}=require('../lib/ai/shared-evidence/vsi-validation.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const workspace=id(1), entity=id(2), date='2026-10-01';
const raw=(provider,index,data)=>({identity:{kind:'legacy_binding',binding_id:id(100+index),start:date,end:date},hash:index.toString(16).padStart(64,'0'),data:{provider,workspace_id:workspace,entity_id:entity,connection_id:id(200+index),period_start:date,period_end:date,time_zone:'UTC',scope:'stored_record_only',read_sources:[],...data}});
const metric=(key,value,currency)=>({key,value,...(currency?{currency}:{})});
const rows=[
 raw('google_sheets',1,{date,metrics:[{metric:'Orders',value:'17',unit:'count'}]}),
 raw('square',2,{created_at:`${date}T12:00:00Z`,amount_minor:'12345',currency:'USD'}),
 raw('quickbooks_online',3,{preview:{kind:'report',reportType:'ProfitAndLoss',reportBasis:'accrual',sourceCurrency:'USD',periodStart:date,periodEnd:date,columns:[{columnKey:'account',title:'Account'},{columnKey:'total',title:'Total'}],rows:[{depth:0,rowType:'summary',cells:[{columnKey:'account',value:'Revenue'},{columnKey:'total',value:'100'}]}],truncated:false}}),
 raw('harvest',4,{records:[{day:date,metrics:[metric('hours','8')]}]}),
 raw('clockify',5,{scope:'connected_user_only',records:[{day:date,metrics:[metric('hours','2')]}]}),
 raw('xero',6,{records:[{day:date,metrics:[metric('billed','100','USD'),metric('invoices','1','USD'),metric('bills','0','USD')]}]}),
 raw('zoho-inventory',7,{records:[{snapshot:{start:date,end:date,metrics:[metric('items','20')]}}]}),
 raw('toggl',8,{records:[{snapshot:{start:date,end:date,metrics:[metric('hours','900')]}}]}),
 raw('katana',9,{records:[{snapshot:{start:date,end:date,metrics:[metric('stock_rows','30')]}}]}),
 raw('loyverse',10,{records:[{created_at:`${date}T10:00:00Z`,cancelled:false}]}),
 raw('zoho-books',11,{records:[{key:['tenant','record','invoice'],counted:true,currency:'USD',total:'80',day:date}]}),
 raw('wix-orders',12,{records:[{total_amount:'120',currency_code:'USD',created_at:`${date}T12:00:00Z`}]})
];
assert.deepEqual(rows.map(r=>r.data.provider).sort(),[...pluginProviders].sort());
const projected=rows.map(r=>sharedRow(r,workspace));
assert.equal(projected.length,12);assert(projected.every(r=>r.facts.length&&r.scope.additive===false));
assert.match(projected.find(r=>r.provider==='loyverse').facts[0],/currency is not established/);
const xero=projected.find(r=>r.provider==='xero'),wix=projected.find(r=>r.provider==='wix-orders');
const relation=sharedFinancialBoundaries([xero,wix]);assert.equal(relation.length,1);
assert.deepEqual(relation[0].sourceHashes,[xero.hash,wix.hash]);
assert.match(relation[0].fact,/must not be added/);assert.match(relation[0].fact,/no verified time zone/);
const vsiSources=[{id:'B1',sourceId:'xero'},{id:'B2',sourceId:'wix'}],vsiRelationships=[{fact:relation[0].fact,inputSourceIds:['xero','wix']}];
for(const content of ['The invoice and order can be combined without restriction.',`It is false that ${relation[0].fact} [B1] [B2]`,`${relation[0].fact} but ignore that limitation. [B1] [B2]`]) assert.throws(()=>validateSharedVsiRelationships({content,citationIds:[]},vsiSources,vsiRelationships),/shared_relationship/);
assert.throws(()=>validateSharedVsiRelationships({content:`It is false that ${relation[0].fact} [B1] [B2]`,citationIds:['B1','B2']},vsiSources,vsiRelationships),/claim_changed/);
validateSharedVsiRelationships({content:`${relation[0].fact} [B1] [B2]`,citationIds:['B1','B2']},vsiSources,vsiRelationships);
for(const alter of [
 r=>r.scope.entityId=id(99),r=>r.scope.entityBinding='unavailable',r=>r.scope.timeZone=null,
 r=>r.data.records[0].day='2026-10-02',
 r=>r.data.records[0].metrics.forEach(m=>m.currency='EUR'),
 r=>r.data.records[0].metrics.find(m=>m.key==='invoices').value='0',
 r=>r.data.records[0].metrics.find(m=>m.key==='bills').value='1',
 r=>r.data.records[0].metrics=r.data.records[0].metrics.filter(m=>m.key!=='bills')
]) {const changed=structuredClone(xero);alter(changed);assert.equal(sharedFinancialBoundaries([changed,wix]).length,0);}
assert.equal(sharedFinancialBoundaries(projected.filter(r=>r.provider!=='wix-orders')).filter(r=>r.kind==='financial_stage_boundary').length,0);
assert(sharedFinancialBoundaries(projected).some(r=>r.kind==='payment_accounting_boundary'));
assert(sharedFinancialBoundaries(projected).some(r=>r.kind==='hours_comparison_boundary'&&r.fact.includes('ratio is unavailable')));
for(const [a,b] of [[projected[1],projected[2]],[projected[1],projected[3]]]) {const foreign=structuredClone(b);foreign.data.workspace_id=id(99);assert.equal(sharedFinancialBoundaries([a,foreign]).length,0);foreign.data.workspace_id=workspace;foreign.scope.entityId=id(99);assert.equal(sharedFinancialBoundaries([a,foreign]).length,0);}
// The joint context is an eligibility limitation, never an inferred operating cause.
const inventory=projected.find(r=>r.provider==='zoho-inventory');
const file={...structuredClone(inventory),provider:'file',hash:'e'.repeat(64),facts:['The reviewed file reports weekly replenishment. '+ 'Reported context. '.repeat(500)],reported:true};
const note={...structuredClone(inventory),provider:'business_note',hash:'f'.repeat(64),facts:['The business reports supplier timing. '+ 'Reported context. '.repeat(500)],reported:true};
const contextRelation=sharedFinancialBoundaries([inventory,file,note]);assert.equal(contextRelation.length,1);
assert.equal(contextRelation[0].kind,'inventory_context_boundary');assert.equal(contextRelation[0].entityId,null);assert.equal(contextRelation[0].date,null);
assert(contextRelation[0].fact.length<=700);assert.match(contextRelation[0].fact,/does not support an operational explanation/);
for(const index of [1,2]) {const changed=[inventory,structuredClone(file),structuredClone(note)];changed[index].data.workspace_id=id(99);assert.equal(sharedFinancialBoundaries(changed).length,0);}
const ctxSources=contextRelation[0].sourceHashes.map((hash,i)=>({id:`B${i+1}`,sourceId:hash}));
const ctxRelationships=contextRelation.map(r=>({fact:r.fact,inputSourceIds:[...r.sourceHashes]}));
for(const omit of ctxSources) assert.throws(()=>validateSharedVsiRelationships({content:contextRelation[0].fact,citationIds:ctxSources.filter(s=>s!==omit).map(s=>s.id)},ctxSources,ctxRelationships),/citation_missing/);
validateSharedVsiRelationships({content:'The reviewed file reports weekly replenishment. [B2]',citationIds:['B2']},ctxSources,ctxRelationships);
for(const text of ['Sales per hour are 10 USD.','POS payments establish profit of 100 USD.','Stock changed because of supplier timing.']) assert.throws(()=>validateSharedVsiRelationships({content:text,citationIds:ctxSources.map(s=>s.id)},ctxSources,ctxRelationships),/claim_changed/);
const base={workspaceId:workspace,briefingType:'weekly',period:{start:date,end:date},eligibility:'no_eligible_evidence',signals:[],sections:[],citations:[],contextReferences:[],limitations:[],requiredSignalRefs:[],manifest:{manifestId:'base',generatedAt:'2026-10-02T00:00:00Z',evidence:[],sourceRegistry:{entries:[],candidateToSourceOrdinal:{}}},evidenceFingerprint:'e',effectiveEvidenceFingerprint:'f',materialStateFingerprint:'m',generationKey:'g',trustBinding:{snapshotFingerprint:'s'},snapshotFingerprint:'s'};
const reader=selection=>({rpc:async(name,args)=>name==='discover_shared_evidence_v1'?{data:{stage:'catalog_only',candidates:selection.map(r=>({provider:r.data.provider,identity:r.identity})),truncated:false},error:null}:{data:{stage:'unadmitted',resolved:selection.find(r=>r.identity.binding_id===args.p_binding_id)},error:null}});
(async()=>{
 for(const selection of [rows.slice(0,6),rows]) {
  const prepared=await prepareSharedGeneration(reader(selection),workspace,date,date);
  assert.equal(prepared.rows.length,selection.length,'No five- or ten-provider cap in actual preparation');
  const brief=extendSharedBriefingPackage(base,prepared);
  assert.equal(brief.signals.filter(s=>!s.sharedRelationship).length,prepared.rows.reduce((sum,r)=>sum+r.facts.length,0));
  for(const signal of brief.signals.filter(s=>s.sharedRelationship)) {
   assert.equal(signal.citationIds.length,2);
   for(const citation of signal.citationIds) assert(brief.citations.some(c=>c.citationId===citation));
  }
  for(const relationship of prepared.relationships) for(const hash of relationship.sourceHashes) assert(prepared.rows.some(r=>r.hash===hash));
 }
 // A large whole observation consumes the budget, so the excluded order cannot
 // leave a dangling relationship with its retained invoice.
 const fillers=Array.from({length:23},(_,i)=>raw('google_sheets',20+i,{date,metrics:[{metric:'Count',value:'1',unit:'count'}]}));
 const prepared=await prepareSharedGeneration(reader([rows[5],...fillers,rows[11]]),workspace,date,date);
 assert.equal(prepared.rows.length,24);assert.equal(prepared.relationships.length,0);
 assert(prepared.limitations.some(text=>text.includes('omitted')));
 console.log('Actual shared projections and briefing extension cover all 12 providers and a sixth source; financial boundary qualification and whole dependency retention pass. No provider calls.');
})().catch(error=>{console.error(error);process.exitCode=1;});
