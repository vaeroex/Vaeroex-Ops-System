/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS regression harness loads actual source functions. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const load=Module._load;
Module._load=function(id,parent,main){if(id==='server-only')return {};return load.call(this,id,parent,main);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
for(const key of ['OPENAI_INPUT_COST_CENTS_PER_1M','OPENAI_OUTPUT_COST_CENTS_PER_1M','NVIDIA_INPUT_COST_CENTS_PER_1M','NVIDIA_OUTPUT_COST_CENTS_PER_1M'])delete process.env[key];
const {providerCostEstimate,recordedEstimatedCostCents,estimatedProviderCostCents,recordVaeroexAiUsage}=require('../lib/ai/usage.ts');
const usage={model:'gpt-4o-mini',inputTokens:10000,outputTokens:1000,totalTokens:11000};
const estimate=providerCostEstimate(usage);assert.equal(estimate.amount_microcents,210000);
const precise={estimated_cost_cents:1,metadata_json:{cost_estimate:estimate}};
assert.equal(recordedEstimatedCostCents(precise)*10000/100,21,'10k small calls aggregate to $21 instead of $100');
assert.equal(recordedEstimatedCostCents({estimated_cost_cents:1,metadata_json:{}}),1,'preserve old estimates');
assert.equal(recordedEstimatedCostCents({...precise,metadata_json:{cost_estimate:{...estimate,version:'historical-catalog-v0'}}}),.21,'rate changes must not reinterpret prior precise rows');
assert.equal(recordedEstimatedCostCents({...precise,metadata_json:{cost_estimate:{...estimate,amount_microcents:-1}}}),1,'malformed metadata uses historical column');
for(const [model,input,output] of [['luna',20,120],['terra',200,1200],['sol',400,2000]]) {
 const short=providerCostEstimate({...usage,model:'gpt-5.6-'+model,inputTokens:100000,outputTokens:100000});
 assert.equal(short.amount_microcents,(input+output)*100000);
 const long=providerCostEstimate({...usage,model:'gpt-5.6-'+model,inputTokens:300000,outputTokens:100000});
 assert.equal(long.amount_microcents,input*2*300000+output*1.5*100000);
}
const attempts={...usage,metadata:{provider_attempts:[{runtime_model:'gpt-4o-mini',input_tokens:10000,output_tokens:1000},{runtime_model:'gpt-4o-mini',input_tokens:10000,output_tokens:1000}]}};
assert.equal(providerCostEstimate(attempts).amount_microcents,420000);assert.equal(estimatedProviderCostCents(attempts),1);
assert.equal(providerCostEstimate({...usage,model:'unknown'}).attempts[0].rate_basis,'conservative_unknown');
process.env.OPENAI_INPUT_COST_CENTS_PER_1M='3';process.env.OPENAI_OUTPUT_COST_CENTS_PER_1M='5';
const overridden=providerCostEstimate(usage);assert.equal(overridden.attempts[0].rate_basis,'environment_override');assert.equal(overridden.amount_microcents,35000);
delete process.env.OPENAI_OUTPUT_COST_CENTS_PER_1M;
const inputOnly=providerCostEstimate({...usage,model:'gpt-5.6-sol',inputTokens:300000,outputTokens:100000});
assert.equal(inputOnly.amount_microcents,3*300000+2000*1.5*100000);
assert.equal(inputOnly.attempts[0].output_rate_basis,'standard_catalog');
delete process.env.OPENAI_INPUT_COST_CENTS_PER_1M;process.env.OPENAI_OUTPUT_COST_CENTS_PER_1M='5';
const outputOnly=providerCostEstimate({...usage,model:'gpt-5.6-sol',inputTokens:300000,outputTokens:100000});
assert.equal(outputOnly.amount_microcents,400*2*300000+5*100000);
assert.equal(outputOnly.attempts[0].input_rate_basis,'standard_catalog');
assert.equal(providerCostEstimate({...usage,model:'unknown'}).attempts[0].input_rate_basis,'conservative_unknown');
delete process.env.OPENAI_INPUT_COST_CENTS_PER_1M;delete process.env.OPENAI_OUTPUT_COST_CENTS_PER_1M;
(async()=>{let saved;const supabase={from(table){assert.equal(table,'ai_usage');return{insert:async row=>{saved=row;return{error:null};}};}};await recordVaeroexAiUsage({supabase,workspaceId:'synthetic-a',agentType:'file_analysis',usage:{...usage,metadata:{cost_estimate:{forged:true},retained:'safe'}}});assert.equal(saved.metadata_json.retained,'safe');assert.equal(saved.metadata_json.cost_estimate.amount_microcents,210000);assert.equal(saved.estimated_cost_cents,1);console.log('Versioned cost regressions passed: standard rates, context threshold, attempts, precision, legacy fallback, override and persisted metadata. Provider invoices not exercised.');})().catch(e=>{console.error(e);process.exitCode=1;});
