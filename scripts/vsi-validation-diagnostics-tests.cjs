/* eslint-disable @typescript-eslint/no-require-imports -- Offline diagnostics privacy and category contract. */
const assert=require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{}});
const {z}=require('zod');
const {vsiValidationDiagnostic:diagnose}=require('../lib/vsi/validation-diagnostics.ts');
const {QualitativeAssertionError}=require('../lib/ai/shared-evidence/qualitative-synthesis.ts');
const secret='DO_NOT_LOG_SECRET https://private.invalid/customer';
const bad=z.object({content:z.string().min(1),interpretations:z.array(z.object({quote:z.string().min(20)}).strict())}).strict().safeParse({content:'',interpretations:[{quote:'short',[secret]:secret}],[secret]:secret});
assert(!bad.success);
const diagnostic=diagnose('answer_schema',bad.error);
assert.equal(diagnostic.category,'output_validation');assert.equal(diagnostic.reason,'schema_invalid');
assert(diagnostic.schemaIssueCount>=3);assert(diagnostic.schemaFields.includes('content'));assert(diagnostic.schemaFields.includes('interpretations.quote'));
assert.doesNotMatch(JSON.stringify(diagnostic),/DO_NOT_LOG_SECRET|private.invalid|short|unrecognized.*keys.*customer/);
assert.equal(diagnose('answer_json',new SyntaxError(secret)).reason,'malformed_json');
for(const stage of ['shared_relationships','qualitative_interpretation','citation_resolution','public_source_coverage']){
 const result=diagnose(stage,new Error(secret));assert.deepEqual(result,{stage,category:'citation_validation',reason:'unclassified'});
}
for(const code of ['shared_relationship_dependency_missing','shared_relationship_citation_missing','shared_relationship_claim_changed','interpretation_duplicate_context_reference','interpretation_duplicate_premise','interpretation_premise_changed','interpretation_assertion_denied','interpretation_grounding_missing'])assert.equal(diagnose('qualitative_interpretation',new Error(code)).reason,code);
assert.equal(diagnose('public_source_coverage',new Error('The live answer omitted its source.')).reason,'web_source_missing');
assert.deepEqual(diagnose('citation_resolution',{message:secret,issues:[{path:[secret],message:secret}]}),{stage:'citation_resolution',category:'citation_validation',reason:'unclassified'});
const restricted=new QualitativeAssertionError('causal_language','missing_information');restricted.rejectedText=secret;restricted.match=secret;
assert.deepEqual(diagnose('qualitative_interpretation',restricted),{stage:'qualitative_interpretation',category:'citation_validation',reason:'interpretation_assertion_denied',assertionRule:'causal_language',authoredField:'missing_information'});
restricted.rule=secret;restricted.field=secret;
assert.deepEqual(diagnose('qualitative_interpretation',restricted),{stage:'qualitative_interpretation',category:'citation_validation',reason:'interpretation_assertion_denied'});
assert.doesNotMatch(JSON.stringify(diagnose('qualitative_interpretation',restricted)),/DO_NOT_LOG_SECRET|private.invalid|rejectedText|match/);
assert.deepEqual(diagnose('citation_resolution',restricted),{stage:'citation_resolution',category:'citation_validation',reason:'interpretation_assertion_denied'});
const spoof=Object.assign(new Error('interpretation_assertion_denied'),{rule:'causal_language',field:'hypothesis'});
assert.deepEqual(diagnose('qualitative_interpretation',spoof),{stage:'qualitative_interpretation',category:'citation_validation',reason:'interpretation_assertion_denied'});
console.log(JSON.stringify({safeStageCategories:true,unknownMessagesAndFieldsWithheld:true,zodValuesAndMessagesWithheld:true,assertionMetadataClosedEnumsOnly:true,externalCalls:0}));
