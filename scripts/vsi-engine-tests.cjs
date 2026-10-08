/* eslint-disable @typescript-eslint/no-require-imports -- Native local qualification loads project TypeScript without changing the application runtime. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request === 'server-only') return request;
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...rest);
};
require.cache['server-only'] = { id: 'server-only', filename: 'server-only', loaded: true, exports: {} };
const retrievalPath = path.join(root, 'lib/vsi/retrieval.ts');
// Exercise the real retrieval classifier independently; authorized DB/source integration is covered by the SQL/browser suite.
const actualRetrieval = require(retrievalPath);
const needsBusinessEvidence = actualRetrieval.needsBusinessEvidence;
let retrievalCalls = 0, permitted = true;
const source = { id:'B1', title:'Repair turnaround', url:'/app/kpis?q=Repair', sourceType:'kpi', sourceId:'metric-1',
  evidenceDate:'2026-09-01', retrievedAt:'2026-10-08T12:00:00Z', text:'Turnaround rose from 2 to 4 days; cause not established.', treatment:'record' };
require.cache[retrievalPath].exports = { ...actualRetrieval,
  authorizeVsiRead: async () => { if (!permitted) throw new Error('Workspace denied'); return {}; },
  retrieveVsiEvidence: async () => { retrievalCalls++; return { sources:[source], limitations:['Only aggregate measurements are available.'] }; }
};
const {runVsiAnswer,planVsiLiveLookup,explicitVsiNoteDraft,boundedVsiHistory,validateVsiAnswer,VsiEngineError,VSI_SYSTEM_PROMPT} = require('../lib/vsi/engine.ts');
const {vsiEstimatedCost,getVsiConfig} = require('../lib/vsi/config.ts');
const {resetAIProviderCircuitForTests} = require('../lib/ai/provider-resilience.ts');
const calls=[];
let mode='normal';
const response = (body) => new Response(JSON.stringify(body), {status:200,headers:{'x-request-id':'synthetic-vsi'}});
global.fetch = async (url, init) => {
  assert.equal(url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(init.body); calls.push(body);
  assert.equal(body.model,'gpt-6-luna'); assert.equal(body.store,false); assert.equal(body.stream,false);
  if(mode==='transport') throw new Error('synthetic connection failure');
  if(mode==='429') return new Response('{}',{status:429});
  const usage={input_tokens:1000, output_tokens:100, input_tokens_details:{cached_tokens:200},output_tokens_details:{reasoning_tokens:30}};
  if(body.tools) return response({model:'gpt-6-luna',status:'completed',usage,output_text:'At 12:00 UTC, Seattle is 14°C.',
    output:[{type:'web_search_call',status:'completed'}, {type:'message',content:[{type:'output_text',text:'Seattle: 14°C.',
      annotations:mode==='no_source'?[]:[{type:'url_citation',title:'Official forecast',url:'https://weather.gov/seattle'}]}]}]});
  const payload=JSON.parse(body.input[1].content);
  const isWeb=Boolean(payload.livePublicLookup), isBusiness=payload.businessSources.length>0;
  const content=isWeb?'Seattle is 14°C. Live lookup: 2026-10-08T12:00:00Z [W1]':isBusiness?'Turnaround is 4 days, up from 2. The aggregate does not establish a cause [B1].':'Here is a clear three-step writing plan.';
  return response({model:mode==='wrong_model'?'gpt-6-sol':'gpt-6-luna',status:mode==='incomplete'?'incomplete':'completed',usage,
    output_text: JSON.stringify({content,citationIds:mode==='bad_cite'?['B99']:isWeb?['W1']:isBusiness?['B1']:[]})});
};
const input=(question,extras={})=>({supabase:{},workspaceId:'synthetic-a',actorUserId:'actor-a',requestId:'request',question,recentMessages:[],...extras});
async function main(){
  process.env.OPENAI_API_KEY='synthetic-test-key';
  assert.equal(needsBusinessEvidence('Write a friendly birthday poem.'),false);
  assert.equal(needsBusinessEvidence('Help me plan a focused writing week.'),false);
  assert.equal(needsBusinessEvidence('Could you help me plan a focused writing week?'),false);
  assert.equal(needsBusinessEvidence('Why did repair turnaround rise?'),true);
  assert.equal(needsBusinessEvidence('What are our sales today?'),true);
  assert.equal(planVsiLiveLookup('What are our sales today?').query,null);
  assert.equal(planVsiLiveLookup('Forecast next month revenue').needsLocation,false);
  assert.equal(planVsiLiveLookup('What is the weather today?').needsLocation,true);
  assert.match(planVsiLiveLookup('What is the weather today in Seattle?').query,/Seattle/);
  assert.match(planVsiLiveLookup('Seattle weather today').query,/Seattle/);
  assert.equal(planVsiLiveLookup('Write a plan for today').query,null);
  assert.match(planVsiLiveLookup('Who is the current president of France?').query,/president/);
  assert.match(planVsiLiveLookup('Portland, Oregon',[{role:'user',content:'Weather today?'},{role:'assistant',content:'Which city or location should I check?'}]).query,/Portland/);
  assert.equal(explicitVsiNoteDraft('remember this'),undefined);
  assert.equal(explicitVsiNoteDraft('Remember this:'),undefined);
  assert.equal(explicitVsiNoteDraft('Do not remember this: private detail'),undefined);
  assert.deepEqual(explicitVsiNoteDraft('Please remember this: We sell bicycle repairs.'),{title:'We sell bicycle repairs',content:'We sell bicycle repairs.'});
  assert.equal(explicitVsiNoteDraft('remember this: '+'x'.repeat(1801)),undefined);
  const bounded=boundedVsiHistory(Array.from({length:500},(_,i)=>({role:i%2?'assistant':'user',content:`message ${i} `+'x'.repeat(2000)})));
  assert.ok(bounded.length<=24); assert.ok(bounded.reduce((sum,row)=>sum+row.content.length,0)<=9000);
  assert.ok(bounded.at(-1).content.startsWith('message 499'));
  assert.throws(()=>validateVsiAnswer({content:'[B2]',citationIds:['B2']},[source]));
  assert.throws(()=>validateVsiAnswer({content:'See https://evil.test',citationIds:[]},[]));
  assert.equal('text' in validateVsiAnswer({content:'Supported [B1]',citationIds:['B1']},[source]).citations[0],false);
  const general=await runVsiAnswer(input('Write a friendly invitation to dinner.'));
  assert.equal(retrievalCalls,0);assert.equal(calls.length,1);assert.equal(calls[0].tools,undefined);assert.equal(general.noteDraft,undefined);
  assert.equal(general.usage.inputTokens,1000);assert.equal(general.usage.cachedInputTokens,200);assert.equal(general.usage.reasoningTokens,30);
  await assert.rejects(runVsiAnswer(input('Remember this: My SSN is 123-45-6789.')),/Social Security|regulated|sensitive|healthcare/);
  assert.equal(calls.length,1);
  const note=await runVsiAnswer(input('Remember this: We sell bicycle repairs.'));
  assert.equal(note.noteDraft.content,'We sell bicycle repairs.');assert.equal(calls.length,1);
  const missing=await runVsiAnswer(input('Weather today?')); assert.match(missing.content,/city|location/); assert.equal(calls.length,1);
  const current=await runVsiAnswer(input('Weather in Seattle today?',{contextSummary:'TOP SECRET WORKSPACE METRIC',recentMessages:[{role:'user',content:'TOP SECRET PRIVATE HISTORY'}]}));
  assert.equal(current.usage.webSearchCalls,1);assert.equal(current.citations[0].sourceType,'web');
  const webCall=calls.find(call=>call.tools);assert.equal(webCall.max_tool_calls,2);assert.equal(webCall.tool_choice,'required');
  assert.ok(!JSON.stringify(webCall).includes('TOP SECRET'));
  const business=await runVsiAnswer(input('Why did repair turnaround rise?'));assert.equal(retrievalCalls,1);assert.equal(business.citations[0].id,'B1');
  assert.match(business.content,/does not establish a cause/);
  assert.match(VSI_SYSTEM_PROMPT,/aggregate review count cannot establish/);assert.match(VSI_SYSTEM_PROMPT,/untrusted data/);
  mode='bad_cite'; await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError && error.usage.outputTokens===100);
  mode='wrong_model';await assert.rejects(runVsiAnswer(input('Explain gravity')),/required Luna/);
  mode='incomplete';await assert.rejects(runVsiAnswer(input('Explain gravity')),/response limit/);
  mode='no_source';await assert.rejects(runVsiAnswer(input('Weather in Seattle today?')),error=>error instanceof VsiEngineError && error.usage.webSearchCalls===1);
  mode='transport';await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError && error.accountingUncertain);
  resetAIProviderCircuitForTests();mode='429';await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError && !error.accountingUncertain && error.usage.estimatedCostUsd===0);
  resetAIProviderCircuitForTests();mode='normal';permitted=false;
  const callCount=calls.length;await assert.rejects(runVsiAnswer(input('Explain gravity')),/Workspace denied/);assert.equal(calls.length,callCount);
  assert.equal(vsiEstimatedCost({inputTokens:1000000,cachedInputTokens:200000,outputTokens:1000000,webSearchCalls:2}),0.602);
  assert.ok(getVsiConfig().requestReserveUsd>=0.1);assert.equal(getVsiConfig().workspaceMonthlyBudgetUsd,50);
  console.log(JSON.stringify({passed:true,suite:'VSI engine behavior and accounting',providerCalls:calls.length,paidProviderCalls:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
