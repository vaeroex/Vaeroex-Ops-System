/* eslint-disable @typescript-eslint/no-require-imports -- Offline synthetic evidence authority fixture. */
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>{throw Error('no admin');}}});
const {prepareSharedGeneration,assertSharedPrepared}=require('../lib/ai/shared-evidence/generation.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,workspace=id(1);
const sheet=(n,metric='unrelated background',count=1)=>({identity:{kind:'sheets_ticket_source',source_id:id(100+n),version_id:id(200+n)},hash:createHash('sha256').update(String(n)).digest('hex'),data:{workspace_id:workspace,provider:'google_sheets',connection_id:id(300+n),entity_id:id(2),date:'2026-10-15',time_zone:'UTC',metrics:Array.from({length:count},()=>({metric,value:'0',unit:'count'})),read_sources:[]}});
const xero=(n,records=[])=>({identity:{kind:'legacy_binding',binding_id:id(n),start:'2026-10-01',end:'2026-10-30'},hash:createHash('sha256').update(`x${n}`).digest('hex'),data:{workspace_id:workspace,provider:'xero',entity_id:id(2),connection_id:id(n+2000),scope:'stored observations',records,read_sources:[]}});
const invoice=[{day:'2026-10-13',metrics:[{key:'invoices',value:'1',currency:'USD'},{key:'billed',value:'0',currency:'USD'},{key:'outstanding',value:'0',currency:'USD'},{key:'bills',value:'0',currency:'USD'},{key:'purchases',value:'0',currency:'USD'}]}];
let sources=[],denied=false,seen=[],extra=0;
const reader={rpc:async(name,args)=>{
 seen.push(name);assert.equal(args.p_workspace_id,workspace);
 if(name==='discover_shared_evidence_v2'){
  const providers=[...new Set(sources.map(s=>s.data.provider))];
  return{data:{stage:'catalog_only',candidates:sources.map(s=>({provider:s.data.provider,identity:s.identity})),truncated:extra>0,totalCandidates:sources.length+extra,providerCounts:providers.map((provider,i)=>({provider,total:sources.filter(s=>s.data.provider===provider).length+(i===0?extra:0),returned:sources.filter(s=>s.data.provider===provider).length}))},error:null};
 }
 if(denied)return{data:null,error:{code:'42501'}};
 const found=sources.find(s=>name==='preview_shared_legacy_evidence_v1'?s.identity.binding_id===args.p_binding_id:s.identity.source_id===args.p_identity.source_id);
 assert(found);return{data:{stage:'unadmitted',resolved:found},error:null};
}};
const prepare=question=>prepareSharedGeneration(reader,workspace,'2026-10-01','2026-10-30',question);
(async()=>{
 let cases=0;
 sources=[...Array.from({length:70},(_,n)=>sheet(n)),sheet(80,'priority dispatch backlog'),xero(90,invoice)];
 const original=JSON.stringify(sources);let p=await prepare('Review Xero and Sheets priority dispatch backlog');
 assertSharedPrepared(p);assert.equal(p.rows.length,24);assert.equal(p.rows[0].provider,'google_sheets');assert.equal(p.rows[0].hash,sources[70].hash);assert.equal(p.rows[1].provider,'xero');assert.equal(JSON.stringify(sources),original);
 assert.equal(p.coverage.providers.find(c=>c.provider==='google_sheets').rowBudgetOmitted,48);assert.equal(p.rows[0].facts.length,1);assert.match(p.rows[0].facts[0],/0 count/);cases++;
 sources=[sheet(1,'unrelated background '.repeat(5),100),sheet(2,'priority dispatch backlog'),xero(90,invoice)];
 p=await prepare('Xero and Sheets priority dispatch backlog');assert.equal(p.rows.length,2);assert.equal(p.coverage.providers[0].factBudgetOmitted,1);assert.match(p.limitations.join(' '),/1 outside the fact-character budget/);assert(p.rows.some(r=>r.provider==='xero'));cases++;
 sources=[xero(90),sheet(1,'priority dispatch backlog')];p=await prepare('Xero and Sheets');assert.equal(p.rows.length,1);assert.equal(p.coverage.providers[0].empty,1);assert.match(p.limitations.join(' '),/Requested source xero has no usable evidence/);assert.doesNotMatch(p.limitations.join(' '),/xero.*zero balance/);cases++;
 // A valid but unsupported accounting report layout is a coverage outcome. An
 // unauthorized read of that same source remains fatal, never a catch-and-ignore.
 const q=require('./qbo-customer-test-support.cjs').report();q.columns[1].title='Unsupported subtotal layout';
 sources=[{identity:{kind:'qbo_version',source_id:id(900),version_id:id(901)},hash:'f'.repeat(64),data:{workspace_id:workspace,provider:'quickbooks_online',record_type:'ProfitAndLoss',basis:'accrual',currency:'USD',period_start:q.periodStart,period_end:q.periodEnd,preview:require('../lib/integrations/qbo-customer/contracts.ts').QboPreviewSchema.parse({kind:'report',reportType:q.reportType,reportBasis:q.reportBasis,sourceCurrency:q.sourceCurrency,periodStart:q.periodStart,periodEnd:q.periodEnd,columns:q.columns.map(({columnKey,title})=>({columnKey,title})),rows:q.rows.map(r=>({rowType:r.rowType,depth:0,cells:r.cells.map(({columnKey,value})=>({columnKey,value}))})),truncated:false}),read_sources:[]}},sheet(1)];
 p=await prepare('QBO and Sheets');assert.equal(p.rows.length,1);assert.equal(p.coverage.providers[0].unsupported,1);cases++;
 denied=true;await assert.rejects(prepare('QBO and Sheets'),/authority_unavailable/);denied=false;cases++;
 sources=[xero(90),sheet(1)];sources[0].data.workspace_id=id(999);await assert.rejects(prepare('Sheets'),/workspace_mismatch/);cases++;
 sources=[xero(90),sheet(1)];sources[0].data.read_sources=[{table:'bad;sql',id:id(2)}];await assert.rejects(prepare('Sheets'));cases++;
 sources=[xero(90,invoice),sheet(1)];sources[0].data.records[0].metrics[1].currency='bad';await assert.rejects(prepare('Sheets'));sources[0].data.records[0].metrics[1].currency='USD';cases++;
 sources=[sheet(1)];extra=4;p=await prepare('Sheets and Katana');assert.equal(p.coverage.providers[0].catalog,5);assert.match(p.limitations.join(' '),/4 outside the discovery cap/);assert.match(p.limitations.join(' '),/Requested source katana has no usable evidence/);extra=0;cases++;
 p.coverage.providers[0].prepared=99;assert.throws(()=>assertSharedPrepared(p),/preparation_changed/);cases++;
 assert(seen.every(name=>['discover_shared_evidence_v2','preview_shared_legacy_evidence_v1','read_shared_typed_evidence_v1'].includes(name)));
 console.log(JSON.stringify({passed:true,cases,realisticCandidateCount:72,admittedRowCap:24,factCharacterCap:12000,wholeGroups:true,sourceFactsUnchanged:true,authorityFailClosed:true,externalCalls:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
