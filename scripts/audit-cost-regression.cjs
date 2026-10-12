/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS regression harness loads actual source functions. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const load=Module._load;
Module._load=function(id,parent,main){if(id==='server-only')return {};return load.call(this,id,parent,main);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
for(const key of ['OPENAI_INPUT_COST_CENTS_PER_1M','OPENAI_OUTPUT_COST_CENTS_PER_1M','NVIDIA_INPUT_COST_CENTS_PER_1M','NVIDIA_OUTPUT_COST_CENTS_PER_1M'])delete process.env[key];
const {providerCostEstimate,recordedEstimatedCostCents,estimatedProviderCostCents,recordVaeroexAiUsage,assertWorkspaceTokenBudget}=require('../lib/ai/usage.ts');
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
async function verifyTokenBudgetCompleteness() {
  const { createClient } = require('@supabase/supabase-js');
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  let requests = 0;
  // Actual SDK parsing of a capped PostgREST-shaped response. No socket, real
  // account, database, or provider is used by this transport.
  const fixture = (data, count, status = 200) => createClient('http://127.0.0.1:1', 'synthetic-only', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      requests++;
      const url = new URL(String(input));
      assert.equal(url.pathname, '/rest/v1/ai_usage');
      assert.equal(url.searchParams.get('select'), 'tokens_used');
      assert.equal(url.searchParams.get('workspace_id'), `eq.${workspaceId}`);
      assert.match(url.searchParams.get('created_at'), /^gte.\d{4}-\d{2}-01T00:00:00.000Z$/);
      assert.equal(url.searchParams.get('limit'), '10000');
      assert.equal(new Headers(init.headers).get('prefer'), 'count=exact');
      const headers = { 'content-type': 'application/json' };
      if (count !== undefined) headers['content-range'] = `0-${Math.max(0, (data?.length || 0) - 1)}/${count}`;
      return new Response(JSON.stringify(data), { status, headers });
    } }
  });
  const check = (data, count, estimatedRequestTokens = 1, status = 200) =>
    assertWorkspaceTokenBudget({ supabase: fixture(data, count, status), workspaceId, estimatedRequestTokens });
  const zero = await check([], 0);
  assert.equal(zero.usedTokens, 0);
  assert.equal(zero.allowed, true);
  const complete = await check([{ tokens_used: 120 }, { tokens_used: 80 }], 2);
  assert.equal(complete.usedTokens, 200);
  assert.equal(complete.remainingTokens, complete.budget.monthlyTokens - 201);
  assert.equal((await check(Array.from({ length: 1000 }, () => ({ tokens_used: 1 })), 1000)).usedTokens, 1000);
  await assert.rejects(check(Array.from({ length: 1000 }, () => ({ tokens_used: 0 })), 1001), /safely calculate/);
  await assert.rejects(check([{ tokens_used: 1 }], undefined), /safely calculate/);
  await assert.rejects(check([{ tokens_used: 1 }], 'invalid'), /safely calculate/);
  await assert.rejects(check([{ tokens_used: 1 }], 0), /safely calculate/);
  await assert.rejects(check(null, 0), /safely calculate/);
  for (const value of [null, -1, 1.5, '1']) await assert.rejects(check([{ tokens_used: value }], 1), /safely calculate/);
  await assert.rejects(check(Array.from({ length: 10000 }, () => ({ tokens_used: 0 })), 10000), /safely calculate/);
  await assert.rejects(check([{ tokens_used: zero.budget.monthlyTokens }], 1), /reached its monthly/);
  const warnings = [], warn = console.warn;
  try {
    console.warn = value => warnings.push(String(value));
    await assert.rejects(check({ message: 'synthetic-sensitive-detail', code: '57014' }, undefined, 1, 503), /could not verify/);
  } finally { console.warn = warn; }
  assert.equal(warnings.length, 1);
  assert(!warnings[0].includes('synthetic-sensitive-detail'));
  assert.equal(requests, 15, 'each guard uses exactly one bounded request');
  console.log('Token-budget completeness regressions passed: 15 actual SDK response fixtures, including truncated/unknown/malformed usage denial and complete zero/history controls. No providers or sockets.');
}
(async()=>{await verifyTokenBudgetCompleteness();let saved;const supabase={from(table){assert.equal(table,'ai_usage');return{insert:async row=>{saved=row;return{error:null};}};}};await recordVaeroexAiUsage({supabase,workspaceId:'synthetic-a',agentType:'file_analysis',usage:{...usage,metadata:{cost_estimate:{forged:true},retained:'safe'}}});assert.equal(saved.metadata_json.retained,'safe');assert.equal(saved.metadata_json.cost_estimate.amount_microcents,210000);assert.equal(saved.estimated_cost_cents,1);console.log('Versioned cost regressions passed: standard rates, context threshold, attempts, precision, legacy fallback, override and persisted metadata. Provider invoices not exercised.');})().catch(e=>{console.error(e);process.exitCode=1;});
