'use strict';
// Actual pure estimator, no DB/network, provider calls or environment-value output.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const root=path.resolve(process.argv[2]||'/tmp/vaeroex-audit-production');
for(const key of ['OPENAI_INPUT_COST_CENTS_PER_1M','OPENAI_OUTPUT_COST_CENTS_PER_1M','NVIDIA_INPUT_COST_CENTS_PER_1M','NVIDIA_OUTPUT_COST_CENTS_PER_1M'])delete process.env[key];
global.fetch=()=>{throw Error('audit_network_disabled');};
const req=Module.createRequire(path.join(root,'package.json')),ts=req('typescript');
const filename=path.join(root,'lib/ai/usage.ts'),source=fs.readFileSync(filename,'utf8'),m=new Module(filename,module);
m.filename=filename;m.require=name=>{assert.equal(name,'server-only');return{};};
m._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const api=m.exports,usage={model:'gpt-4o-mini',inputTokens:10000,outputTokens:1000,totalTokens:11000};
const estimatedCents=api.estimatedCostCents(usage);assert.equal(estimatedCents,1);
const defaults=Object.fromEntries(['gpt-4o-mini','gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol'].map(model=>[model,api.modelCost(model)]));
const bothAttempts=api.estimatedProviderCostCents({...usage,metadata:{provider_attempts:[{model:'gpt-4o-mini',input_tokens:10000,output_tokens:1000},{model:'gpt-4o-mini',input_tokens:10000,output_tokens:1000}]}});
assert.equal(bothAttempts,1); // .42 cents summed first, then rounded once, not twice.
console.log(JSON.stringify({capturedAt:new Date().toISOString(),source:filename,sha256:createHash('sha256').update(source).digest('hex'),
 scope:'Actual pure estimates with process-local cost overrides removed; no actual invoice, environment override or persisted usage examined',
 sourceDefaultsCentsPerMillion:defaults,fixture:{...usage,returnedEstimatedCents:estimatedCents,rawCostCentsAtSourceRate:.21,
 hypothetical10000SeparateEntries:{summedStoredUsd:100,unroundedTokenUsd:21},twoAttemptsOneEntryReturnedCents:bothAttempts},networkCalls:0},null,2));
