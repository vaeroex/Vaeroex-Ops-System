/* eslint-disable @typescript-eslint/no-require-imports -- Offline temporal contract and residual-boundary regressions. */
const assert=require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{}});
let calls=0;const deny=()=>{calls++;throw Error('network_denied');};global.fetch=deny;require('node:net').Socket.prototype.connect=deny;
const {renderSharedAnswer:render,sharedAnswerSchema,sharedAnswerJsonSchema}=require('../lib/ai/shared-evidence/answer-contract.ts');
const source=(ref,binding,provider,facts,times)=>({ref,binding,provider,dependencies:[binding],facts,factTimes:times,reported:false,environment:'production'});
const time=(date,basis,valueTiming,...factIndexes)=>({date,basis,valueTiming,factIndexes});
const x=source('B1','a'.repeat(64),'xero',[
 'Xero invoice contribution on a purchase-bill record: zero; invoice/bill date 2026-10-13.',
 'Xero outstanding contribution: zero USD; invoice/bill date 2026-10-13; balance at import, exact as-of unknown.',
 'Xero sales invoice: 100 USD; invoice/bill date 2026-10-14.',
 'Xero sales invoice: 200 USD; invoice/bill date 2026-10-15.'
],[time('2026-10-13','invoice_or_bill_date','document_contribution',0),time('2026-10-13','invoice_or_bill_date','balance_at_import',1),time('2026-10-14','invoice_or_bill_date','document_contribution',2),time('2026-10-15','invoice_or_bill_date','document_contribution',3)]);
const g=source('B2','b'.repeat(64),'google_sheets',['Dispatches: 6 count, supplied row date 2026-10-14.','Backlog: 4 count, supplied row date 2026-10-15.'],[time('2026-10-14','sheet_row_date','row_value',0),time('2026-10-15','sheet_row_date','row_value',1)]);
const pick=(s,factIndex=0)=>({ref:s.ref,binding:s.binding,factIndex});
const observed=[pick(x),pick(x,1),pick(g),pick(g,1)];
const closed=premises=>({kind:'selected_fact_time_comparison',premises});
const answer=(observations=observed,comparison=observations)=>({observations,results:[],hypotheses:[],missing_information:[closed(comparison)],next_checks:[]});
const context=(sources=[x,g])=>({sources,results:[],hypothesesEnabled:true,requiredRefs:sources.map(s=>s.ref)});
let positives=0,negatives=0;
const pass=(a=answer(),c=context())=>{const result=render(a,c);positives++;return result;};
const fail=(a,c=context(),rule)=>{assert.throws(()=>render(a,c),error=>!rule||error.rule===rule);negatives++;};
const original=JSON.stringify([x,g]),result=pass();
assert.match(result.content,/Selected-date comparison \(application-computed from cited premises\)/);
assert.match(result.content,/selected date labels differ; same-period alignment is not established/);
assert.match(result.content,/invoice\/bill date 2026-10-13/);
assert.doesNotMatch(result.content,/invoice\/bill date 2026-10-14|invoice\/bill date 2026-10-15/);
assert.match(result.content,/balances at import; their exact observation time is unavailable here, not the document date/);
assert.deepEqual(result.citationIds,['B1','B2']);
assert.equal((result.content.match(/Application date check:/g)||[]).length,1,'a full comparison must not repeat the identical date block');
const subset=pass(answer(observed,[pick(x),pick(g)])).content;
assert.equal((subset.match(/Application date check:/g)||[]).length,2,'a subset comparison must retain dates from other observed facts');
assert.match(subset,/supplied row date 2026-10-15/,'selected facts outside the comparison remain visible');
// Unselected invoice rows cannot substitute their dates for the selected bill contribution.
for(const mutate of [s=>{s.facts[2]='Unselected replacement';s.facts[3]='Other unselected replacement';},s=>{s.factTimes[2].date='2026-12-24';s.factTimes[3].date='2026-12-25';},s=>{s.facts.push('Another unselected invoice');s.factTimes.push(time('2026-10-14','invoice_or_bill_date','document_contribution',4));}]){
 const changed=structuredClone(x);mutate(changed);assert.equal(pass(answer(),context([changed,g])).content,result.content);
}
const falseText='The Xero records contain invoice and outstanding-balance observations for those dates.';
fail({...answer(),missing_information:[{premises:observed,text:falseText}]},context(),'temporal_assessment_required');
// Exact tuples: alternative in-range facts must first be explicitly observed.
fail(answer(observed,[pick(x,2),pick(g)]),context(),'draft_support');
const sameObservations=[pick(x,2),pick(g)];
const equal=pass(answer(sameObservations),context()).content;
assert.match(equal,/matching date labels alone do not establish comparable measurement times/);assert.doesNotMatch(equal,/selected date labels differ/);
// Neither matching labels nor valid IDs issue causal, same-period or join verdicts.
for(const fields of [{text:'These dates align.'},{status:'aligned'},{date:'2026-10-14'},{conclusion:'Nonpayment caused the delays.'},{result:'same_period'},{basis:'measurement_time'}]){
 const bad={...answer(),missing_information:[{...closed(observed),...fields}]};assert.equal(sharedAnswerSchema.safeParse(bad).success,false);fail(bad);
}
for(const kind of ['causal_verdict','aligned_period','source_correspondence','selected_fact_time_comparison_v2'])fail({...answer(),missing_information:[{kind,premises:observed}]});
// Missing or mixed typed metadata stays unknown, including when scope windows match.
for(const sources of [[{...x,factTimes:undefined},g],[{...x,factTimes:undefined},{...g,factTimes:undefined}]]){
 const c={...context(sources),scopes:new Map(sources.map(s=>[s.ref,{start:'2026-10-14',end:'2026-10-15',timeZone:'UTC',windowKind:'retrieval_selection'}]))};
 const text=pass(answer(),c).content;assert.match(text,/date-label comparison is incomplete and same-period alignment is not established/);assert.doesNotMatch(text,/selected date labels differ|matching date labels alone/);
}
// Balance-as-of unknown survives even when the document and row label are equal.
const sameSheet={...g,facts:['Recorded row'],factTimes:[time('2026-10-13','sheet_row_date','row_value',0)]};
const balance=pass(answer([pick(x,1),pick(sameSheet)]),context([x,sameSheet])).content;assert.match(balance,/balances at import/);assert.match(balance,/matching date labels alone/);
// Closed comparisons need exact observed, independent business originals.
for(const premises of [[observed[0],observed[0]],[pick(x),pick(x,1)],[{...pick(x),binding:'f'.repeat(64)},pick(g)],[{...pick(x),factIndex:1999},pick(g)],[{...pick(x),ref:'B9'},pick(g)]])fail(answer(observed,premises),context(),premises[0].ref==='B1'&&premises[1].ref==='B1'&&premises[0].factIndex!==premises[1].factIndex?'independent_sources':'draft_support');
const alias={...g,binding:x.binding,dependencies:[x.binding]};fail(answer([pick(x),pick(alias)]),context([x,alias]),'independent_sources');
fail(answer(),context([{...x,dependencies:['common-root']},{...g,dependencies:['common-root']}]),'independent_sources');
fail(answer(),context([{...x,supportOnly:true},g]),'independent_sources');
const support=source('P1','c'.repeat(64),'product_context',['Product fact'],undefined);support.supportOnly=true;support.environment='supporting';
const withSupport=[...observed,pick(support)];fail(answer(withSupport),context([x,g,support]),'draft_support');
fail(answer(),context([x,{...g,environment:'sandbox',installation:'demo'}]),'environment');
fail(answer(),context([{...x,environment:'sandbox',installation:'one'},{...g,environment:'sandbox',installation:'two'}]),'environment');
pass(answer(),context([{...x,environment:'sandbox',installation:'same'},{...g,environment:'sandbox',installation:'same'}]));
// Positive and sparse usefulness remain case-specific. No rich payment-hold
// premise is borrowed by the sparse dispatch/backlog case.
const richInvoice={...x,facts:['Outstanding invoice balance: 1200 USD, as of import; partial observation.'],factTimes:[time('2026-10-14','invoice_or_bill_date','balance_at_import',0)]};
const richOrders={...g,facts:['Orders recorded on payment hold: 3 count, supplied row date 2026-10-14; partial observation.'],factTimes:[time('2026-10-14','sheet_row_date','row_value',0)]};
const richSelections=[pick(richInvoice),pick(richOrders)];
const useful={...answer(richSelections),hypotheses:[{premises:richSelections,text:'The separate payment-hold and outstanding-balance observations may warrant reconciliation; their correspondence remains unestablished.'}],next_checks:[{premises:richSelections,text:'Compare the underlying invoice and order identifiers, statuses and observation times before linking the records.'}]};
const usefulText=pass(useful,context([richInvoice,richOrders])).content;assert.match(usefulText,/Hypothesis \(unverified model draft\)/);assert.match(usefulText,/Compare the underlying invoice and order identifiers/);assert.match(usefulText,/1200 USD/);assert.match(usefulText,/3 count/);assert.match(usefulText,/matching date labels alone/);
const sparseInvoice={...x,facts:['Invoice balance: 50 USD, recorded 2026-10-14; coverage unknown.'],factTimes:undefined};
const sparseRows={...g,facts:['Dispatches: 6 count, supplied row date 2026-10-14.','End-of-day backlog: 4 count, supplied row date 2026-10-14.'],factTimes:[time('2026-10-14','sheet_row_date','row_value',0,1)]};
const sparseSelections=[pick(sparseInvoice),pick(sparseRows),pick(sparseRows,1)];
const sparse={...answer(sparseSelections),next_checks:[{premises:sparseSelections,text:'Check whether any invoice was overdue and whether any dispatch was delayed, then seek matched records and documented reasons before asserting a relationship.'}]};
const sparseText=pass(sparse,context([sparseInvoice,sparseRows])).content;assert.match(sparseText,/date-label comparison is incomplete/);assert.match(sparseText,/whether any dispatch was delayed/);assert.doesNotMatch(sparseText,/payment.hold|1200 USD|Hypothesis/);
// Honest residual boundary: these channels still permit unsupported prose. A
// manual semantic review rejects it; this targeted repair does not validate it.
for(const channel of ['hypotheses','next_checks','missing_information']){
 const premises=channel==='missing_information'?[pick(x)]:observed;
 const residual={...answer(),[channel]:[{premises,text:falseText}]};
 const text=pass(residual).content;assert.match(text,/for those dates/);assert.match(text,channel==='missing_information'?/unverified model assessment/:/model draft/);
}
const union=sharedAnswerJsonSchema.properties.missing_information.items.anyOf;
const closedSchema=union.find(schema=>schema.properties.kind);assert(closedSchema);assert.equal(closedSchema.additionalProperties,false);assert.deepEqual(closedSchema.required,['kind','premises']);
assert.deepEqual(Object.keys(closedSchema.properties).sort(),['kind','premises']);
assert.equal(JSON.stringify([x,g]),original);assert.equal(calls,0);
console.log(JSON.stringify({passed:true,positiveCases:positives,negativeCases:negatives,exactObservedFacts:true,unselectedInvoiceDatesDoNotInfluenceComparison:true,closedTemporalClaimsOnly:true,unknownAndBalanceTimingPreserved:true,residualDraftProseNotSemanticProof:true,providerCalls:0}));
