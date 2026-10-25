/* eslint-disable @typescript-eslint/no-require-imports -- Offline authored-language and diagnostic contract. */
const assert=require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{}});
const {validateQualitativeInterpretation:validate,renderQualitativeInterpretation:render,qualitativeInterpretationJsonSchema:schema,QualitativeAssertionError}=require('../lib/ai/shared-evidence/qualitative-synthesis.ts');
const {vsiValidationDiagnostic:diagnose}=require('../lib/vsi/validation-diagnostics.ts');
const sources=[
 {ref:'B1',binding:'a'.repeat(64),dependencies:['invoice-original'],facts:['The invoice ledger records billing balances and payment timing for 2026-10-14; coverage is incomplete.'],reported:false,environment:'production'},
 {ref:'B2',binding:'b'.repeat(64),dependencies:['operations-original'],facts:['The dispatch observations record backlog snapshots; coverage is incomplete.'],reported:false,environment:'production'}
];
const value={premises:sources.map(s=>({ref:s.ref,binding:s.binding,quote:s.facts[0]})),hypothesis:'Billing balances may warrant review alongside backlog snapshots.',missing_information:'Whether billing balances and backlog snapshots concern comparable periods.',next_check:'Review billing balances alongside backlog snapshots.'};
let positiveCases=0,negativeCases=0;
for(const hypothesis of [value.hypothesis,'Payment timing might warrant review alongside backlog snapshots.','Billing balances and payment timing could warrant review alongside backlog snapshots.','Backlog snapshots may warrant review alongside billing balances.','Billing balances may warrant review alongside backlog snapshots without a causal conclusion.']){
 assert.deepEqual(validate({...value,hypothesis},sources),{...value,hypothesis});positiveCases++;
}
const rendered=render(value,sources,ref=>` [${ref}]`);
assert(rendered.includes(sources[0].facts[0]));assert(rendered.includes(sources[1].facts[0]));assert.match(rendered,/2026-10-14/);
assert.match(rendered,/\[B1\]/);assert.match(rendered,/\[B2\]/);assert.match(rendered,/Interpretation \(unverified hypothesis\)/);
const vocabulary={
 quantitative_language:['zero','one','two','three','four','five','six','seven','eight','nine','ten','hundred','thousand','million','billion','percent','ratio','per hour','profitability'],
 causal_language:['cause','caused','causes','causing','because','due to','therefore','drive','drives','driven','driving','drove','result in','results in','resulted in','resulting in','lead to','leads to'],
 certainty_language:['prove','proves','proven','guarantee','guaranteed','guarantees','definitely'],
 record_linkage_language:['correlation','correlated','reconcile','reconciliation','matched','linked','identical','attribution','attributed'],
 calculation_language:['offset','offsetting','higher than','lower than','greater than','less than','equal','equals','sum','summed','add','added','adding','combined total']
};
const fields=['hypothesis','missing_information','next_check'];
function rejected(patch,rule,field){
 let caught;try{validate({...value,...patch},sources);}catch(error){caught=error;}
 assert(caught instanceof QualitativeAssertionError,`${field}/${rule}: ${caught?.message || 'accepted'}`);assert.equal(caught.message,'interpretation_assertion_denied');
 assert.deepEqual(diagnose('qualitative_interpretation',caught),{stage:'qualitative_interpretation',category:'citation_validation',reason:'interpretation_assertion_denied',assertionRule:rule,authoredField:field});negativeCases++;
}
for(const field of fields){
 for(const [rule,terms]of Object.entries(vocabulary))for(const term of terms)rejected({[field]:`${value[field].slice(0,-1)} ${term}.`},rule,field);
 for(const text of ['; check coverage.',' [reference].',' {coverage}.',' <coverage>.',' https://private.invalid/DO_NOT_LOG_SECRET.','. Check coverage.',' e.g. coverage.'])rejected({[field]:value[field].slice(0,-1)+text},'formatting',field);
 for(const text of [' [B1].','\nCheck coverage.']){assert.throws(()=>validate({...value,[field]:value[field].slice(0,-1)+text},sources),/interpretation_unsupported_characters/);negativeCases++;}
}
// Questions and negations remain subject to the declared lexical boundary.
rejected({hypothesis:'Billing balances may warrant review alongside backlog snapshots, not a proven conclusion.'},'certainty_language','hypothesis');
rejected({missing_information:'Whether billing balances caused backlog snapshots.'},'causal_language','missing_information');
rejected({missing_information:'Whether billing balances and backlog snapshots are linked.'},'record_linkage_language','missing_information');
assert.throws(()=>validate({...value,hypothesis:'Billing balances could be compared alongside backlog snapshots.'},sources),/interpretation_unsupported_term/);negativeCases++;
assert.throws(()=>validate({...value,hypothesis:'Billing balances may warrant review alongside 14 backlog snapshots.'},sources),/interpretation_unsupported_characters/);negativeCases++;
for(const field of fields)assert.equal(schema.properties[field].type,'string');
assert.match(schema.description,/exact premise business words/);
assert.match(schema.properties.missing_information.description,/even in questions or negations/);
assert.match(schema.description,/no numbers, dates/);
assert.equal(schema.properties.premises.minItems,2);assert.equal(schema.properties.premises.maxItems,8);
console.log(JSON.stringify({positiveCases,negativeCases,completeQuotedDatesPreserved:true,independentOriginalCitationsPreserved:true,allAuthoredFieldsCovered:true,restrictedLanguageAcceptanceUnchanged:true,contentFreeRuleAndFieldDiagnostics:true,semanticEntailmentProved:false,liveResponseReconstructed:false,externalCalls:0}));
