/* eslint-disable @typescript-eslint/no-require-imports -- Offline exact-premise and independent-original boundary. */
const assert=require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{}});
const {validateQualitativeInterpretation:validate,renderQualitativeInterpretation:render}=require('../lib/ai/shared-evidence/qualitative-synthesis.ts');
const a={ref:'B1',binding:'a'.repeat(64),dependencies:['invoice-original'],facts:[
 'The invoice ledger records outstanding billing balances; coverage is incomplete.',
 'The invoice ledger records payment timing; coverage is incomplete.',
 'The invoice ledger records access permissions; coverage is incomplete.'
],reported:false,environment:'production'};
const b={ref:'B2',binding:'b'.repeat(64),dependencies:['operations-original'],facts:[
 'The dispatch observations record backlog snapshots; coverage is incomplete.',
 'The dispatch review records backlog snapshots with unknown completeness.'
],reported:false,environment:'production'};
const premise=(source,n)=>({ref:source.ref,binding:source.binding,quote:source.facts[n]});
const claim={premises:[premise(a,0),premise(a,1),premise(b,0)],hypothesis:'Billing balances and payment timing may warrant review alongside backlog snapshots.',missing_information:'Whether billing balances, payment timing and backlog snapshots concern comparable periods.',next_check:'Review billing balances and payment timing alongside backlog snapshots.'};
assert.deepEqual(validate(claim,[a,b]),claim);
assert.deepEqual(validate({...claim,premises:[premise(b,0),premise(a,1),premise(a,0)]},[b,a]).premises,[premise(b,0),premise(a,1),premise(a,0)]);
assert.equal(validate({...claim,premises:[...claim.premises,premise(b,1)]},[a,b]).premises.length,4);
const rendered=render(claim,[a,b],ref=>` [${ref}]`);
for(const p of claim.premises)assert(rendered.includes(p.quote));
assert.equal((rendered.match(/\[B1\]/g)||[]).length,2);assert.equal((rendered.match(/\[B2\]/g)||[]).length,1);
assert.match(rendered,/not a measured finding or a calculation/);
let negativeCases=0;
function denied(value,context,code){assert.throws(()=>validate(value,context),new RegExp(`^Error: ${code}$`));negativeCases++;}
denied(claim,[a,a,b],'interpretation_duplicate_context_reference');
denied(claim,[a,{...a,binding:'c'.repeat(64)},b],'interpretation_duplicate_context_reference');
denied({...claim,premises:[premise(a,0),premise(a,0),premise(b,0)]},[a,b],'interpretation_duplicate_premise');
denied({...claim,premises:[premise(a,0),premise(a,1)]},[a,b],'interpretation_distinct_dependencies_required');
const alias={...a,ref:'B3',binding:'c'.repeat(64)};
denied({...claim,premises:[premise(a,0),premise(alias,1)]},[a,alias,b],'interpretation_distinct_dependencies_required');
denied({...claim,premises:[premise(a,0),premise(alias,1),premise(b,0)]},[a,alias,b],'interpretation_distinct_dependencies_required');
const sameBinding={...b,binding:a.binding};
denied({...claim,premises:[premise(a,0),premise(a,1),premise(sameBinding,0)]},[a,sameBinding],'interpretation_distinct_dependencies_required');
denied(claim,[{...a,dependencies:[]},b],'interpretation_distinct_dependencies_required');
for(const patch of [{ref:'B404'},{binding:'d'.repeat(64)},{quote:a.facts[1]+' Invented support.'},{quote:'The invoice ledger records payment timing.'}]){
 denied({...claim,premises:[premise(a,0),{...premise(a,1),...patch},premise(b,0)]},[a,b],'interpretation_premise_changed');
}
denied({...claim,premises:[premise(a,0),premise(a,1),{...premise(b,0),quote:a.facts[0]}]},[a,b],'interpretation_premise_changed');
denied({...claim,premises:[...claim.premises,premise(a,2)]},[a,b],'interpretation_grounding_missing');
denied({...claim,hypothesis:'Billing balances may warrant review alongside backlog snapshots.'},[a,b],'interpretation_grounding_missing');
denied({...claim,hypothesis:'Billing balances and payment timing may cause backlog snapshots.'},[a,b],'interpretation_assertion_denied');
denied({...claim,hypothesis:'Billing balances and payment timing may explain 50% of backlog snapshots.'},[a,b],'interpretation_unsupported_characters');
denied(claim,[{...a,environment:'sandbox',installation:'demo'},b],'interpretation_environment_changed');
console.log(JSON.stringify({differentFactsReuseOriginal:true,independentOriginalsRequired:true,exactQuotesAndBindingsRequired:true,everyFactContributes:true,renderedAttributionPreserved:true,negativeCases,externalCalls:0}));
