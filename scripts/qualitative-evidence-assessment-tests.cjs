/* eslint-disable @typescript-eslint/no-require-imports -- Sanitized retained SYNTHETIC response, pure validation and mocked engine replay only. */
const assert=require('node:assert/strict'),path=require('node:path'),{fork}=require('node:child_process');
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{}});
const {validateQualitativeInterpretation:validate,renderQualitativeInterpretation:render,QualitativeVocabularyError}=require('../lib/ai/shared-evidence/qualitative-synthesis.ts');
const {vsiValidationDiagnostic:diagnose}=require('../lib/vsi/validation-diagnostics.ts');
// All observations are invented. Retained model prose is preserved; dynamic citation IDs are remapped.
const sources=[
 {ref:'B1',binding:'a'.repeat(64),dependencies:['synthetic-sheets-original'],facts:['Google Sheets Synthetic scenario dispatches: 6 count, recorded 2026-10-14.','Google Sheets Synthetic scenario end of day backlog: 4 count, recorded 2026-10-14.'],reported:false,environment:'production'},
 {ref:'B2',binding:'b'.repeat(64),dependencies:['synthetic-invoice-original'],facts:['xero invoice balance: 50 USD; recorded 2026-10-14. Scope: stored synthetic invoice observations.'],reported:false,environment:'production'}
];
const premise=(s,n=0)=>({ref:s.ref,binding:s.binding,quote:s.facts[n]});
const retained={premises:[premise(sources[0]),premise(sources[0],1),premise(sources[1])],hypothesis:'The dispatches and end of day backlog may warrant review alongside the invoice balance.',missing_information:'Whether coverage and source context for the invoice balance, dispatches and end of day backlog are sufficient for review remains unclear.',next_check:'Review source coverage and context for the invoice balance, dispatches and end of day backlog.'};
let positiveCases=0,negativeCases=0;
function positive(value){assert.deepEqual(validate(value,sources),value);positiveCases++;}
function denied(value,code,context=sources){assert.throws(()=>validate(value,context),error=>error.message===code);negativeCases++;}
positive(retained);
for(const missing_information of [
 'Whether the source information for the invoice balance, dispatches and end of day backlog is adequate for comparison remains unresolved.',
 'Whether source coverage for the invoice balance, dispatches and end of day backlog is sufficiently clear for review.',
 'What limitations in the source information for the invoice balance, dispatches and end of day backlog remain unclear.'
])positive({...retained,missing_information});
for(const next_check of ['Inspect the reliability and clarity of the source information for the invoice balance, dispatches and end of day backlog.','Check whether source data for the invoice balance, dispatches and end of day backlog is adequate for comparison.'])positive({...retained,next_check});
const rendered=render(retained,sources,ref=>` [${ref}]`);for(const p of retained.premises)assert(rendered.includes(p.quote));assert(rendered.includes('[B1]')&&rendered.includes('[B2]'));
// Evidence-assessment words are not new hypothesis authority or business nouns.
for(const word of ['sufficient','adequate','reliable','unclear'])denied({...retained,hypothesis:`Invoice balance may be ${word} for dispatches and end of day backlog.`},'interpretation_unsupported_term');
for(const word of ['sufficient','adequate','reliable'])denied({...retained,next_check:`Review ${word} invoice balance alongside dispatches and end of day backlog.`},'interpretation_unsupported_term');
for(const noun of ['bankruptcy','staffing','stockouts']){
 denied({...retained,hypothesis:`Invoice balance and dispatches may warrant review alongside end of day backlog and ${noun}.`},'interpretation_unsupported_term');
 denied({...retained,missing_information:`Whether invoice balance, dispatches, end of day backlog and ${noun} warrant review.`},'interpretation_unsupported_term');
 denied({...retained,next_check:`Review invoice balance, dispatches, end of day backlog and ${noun}.`},'interpretation_unsupported_term');
}
for(const [field,value]of Object.entries({hypothesis:'Invoice balance may cause dispatches and end of day backlog.',missing_information:'Whether invoice balance caused dispatches and end of day backlog.',next_check:'Review invoice balance because it caused dispatches and end of day backlog.'}))denied({...retained,[field]:value},'interpretation_assertion_denied');
for(const [field,value]of Object.entries({hypothesis:'Invoice balance may be definitely relevant to dispatches and end of day backlog.',missing_information:'Whether invoice balance is proven alongside dispatches and end of day backlog.',next_check:'Review invoice balance linked to dispatches and end of day backlog.'}))denied({...retained,[field]:value},'interpretation_assertion_denied');
for(const field of ['hypothesis','missing_information','next_check'])denied({...retained,[field]:retained[field].slice(0,-1)+' 50 USD.'},'interpretation_unsupported_characters');
denied({...retained,premises:retained.premises.map((p,i)=>i===2?{...p,quote:p.quote.replace('50 USD','500 USD')}:p)},'interpretation_premise_changed');
denied({...retained,premises:retained.premises.map((p,i)=>i===2?{...p,ref:'B404'}:p)},'interpretation_premise_changed');
denied({...retained,premises:[retained.premises[0],retained.premises[0],retained.premises[2]]},'interpretation_duplicate_premise');
denied({...retained,premises:retained.premises.slice(0,2)},'interpretation_distinct_dependencies_required');
denied(retained,'interpretation_distinct_dependencies_required',sources.map(s=>({...s,dependencies:['same-original']})));
denied(retained,'interpretation_environment_changed',[sources[0],{...sources[1],environment:'sandbox',installation:'separate-installation'}]);
denied({...retained,hypothesis:'Invoice balance may warrant review.'},'interpretation_grounding_missing');
const error=new QualitativeVocabularyError('next_check');error.rejectedWord='DO_NOT_LOG_PRIVATE';assert.deepEqual(diagnose('qualitative_interpretation',error),{stage:'qualitative_interpretation',category:'citation_validation',reason:'interpretation_unsupported_term',authoredField:'next_check'});

function offlineReplay(makeAnswer){return new Promise((resolve,reject)=>{
 let requests=0,done=false;const child=fork(path.join(__dirname,'vsi-isolated-contract-evaluation.cjs'),['--fixture-worker','qualified-brief'],{env:{VAEROEX_SYNTHETIC_EVAL_WORKER:'1'},execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
 const timer=setTimeout(()=>finish(Error('offline_replay_timeout')),15000);
 function finish(error,result){if(done)return;done=true;clearTimeout(timer);child.kill();if(error)reject(error);else resolve({...result,mockedCalls:requests});}
 child.on('error',error=>finish(error));child.on('exit',()=>{if(!done)finish(Error('offline_worker_exited'));});
 child.on('message',message=>{try{
  if(message.type==='result'){finish(null,message.result);return;}
  assert.equal(message.type,'provider_request');requests++;assert(requests<=2);assert.equal(message.url,'https://api.openai.com/v1/responses');
  const body=JSON.parse(message.body);assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.equal(body.tools,undefined);
  const answering=body.text.format.name==='vsi_answer_v1';
  if(answering){assert.match(body.input[0].content,/Coexisting records need not support a business relationship/);assert.match(body.input[0].content,/specific evidence limitation/);assert.match(body.input[0].content,/Within interpretations, numbers and dates/);}
  const value=answering?makeAnswer(JSON.parse(body.input[1].content)):{mode:'answer',businessEvidence:true,tier:'simple',clarification:'',publicTargets:[],objectives:[]};
  child.send({type:'provider_response',request:message.request,payload:{model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:30},output_text:JSON.stringify(value)}});
 }catch(error){finish(error);}});
});}
function answerFor(payload){
 const sheet=payload.qualitative_sources.find(s=>s.facts.some(f=>f.includes('dispatches'))),invoice=payload.qualitative_sources.find(s=>s.facts.some(f=>f.includes('invoice balance')));
 const claim={...retained,premises:retained.premises.map(p=>{const s=p.ref==='B1'?sheet:invoice;return{...p,ref:s.ref,binding:s.binding};})};
 return{content:`On 2026-10-14, the synthetic observations record dispatches of 6 count and end of day backlog of 4 count [${sheet.ref}], alongside invoice balance of 50 USD [${invoice.ref}].`,citationIds:[sheet.ref,invoice.ref],interpretations:[claim]};
}
(async()=>{
 const replayed=await offlineReplay(answerFor);assert(replayed.mechanicalPass);assert.equal(replayed.citations.length,2);assert.equal(replayed.mockedCalls,2);assert(replayed.answer.includes(retained.missing_information));
 // Accept a precise jointly grounded limitation without inventing a hypothesis.
 const limited=await offlineReplay(payload=>{const answer=answerFor(payload);return{...answer,interpretations:[],content:answer.content+' These are single-day observations of different quantities. The supplied records do not provide a common invoice-to-dispatch identifier or complete population. They do not establish a billing-to-operations explanation or a trend. Check the invoice population and the definition and coverage of the dispatch/backlog observations before comparing them.'};});
 assert(limited.mechanicalPass);assert.equal(limited.citations.length,2);assert(limited.answer.includes('do not provide a common invoice-to-dispatch identifier'));
 const fabricated=await offlineReplay(payload=>{const answer=answerFor(payload);answer.interpretations[0].premises[0].quote+=' Invented support.';return answer;});assert(!fabricated.mechanicalPass);assert.equal(fabricated.diagnostic.reason,'interpretation_premise_changed');
 const numerical=await offlineReplay(payload=>{const answer=answerFor(payload);answer.interpretations[0].hypothesis='Invoice balance may explain 50% of dispatches and end of day backlog.';return answer;});assert(!numerical.mechanicalPass);assert.equal(numerical.diagnostic.reason,'interpretation_unsupported_characters');
 console.log(JSON.stringify({positiveCases,negativeCases,retainedSyntheticWordingReplayed:true,actualEngineMockedReplays:4,preciseLimitationWithoutHypothesis:true,retainedGenericAnswerStillFailsManualUsefulness:true,semanticEntailmentProved:false,externalCalls:0}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
