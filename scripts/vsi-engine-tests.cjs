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
const {runVsiAnswer,planVsiLiveLookup,explicitVsiNoteDraft,boundedVsiHistory,validateVsiAnswer,readVsiWebSources,vsiLiveLookupDiagnostic,VsiEngineError,VSI_SYSTEM_PROMPT} = require('../lib/vsi/engine.ts');
const {vsiEstimatedCost,getVsiConfig} = require('../lib/vsi/config.ts');
const {resetAIProviderCircuitForTests} = require('../lib/ai/provider-resilience.ts');
const calls=[];
let mode='normal';
const staleObservationTime=new Date(Date.now()-4*60*60*1000).toISOString();
const response = (body) => new Response(JSON.stringify(body), {status:200,headers:{'x-request-id':'synthetic-vsi'}});
global.fetch = async (url, init) => {
  assert.equal(url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(init.body); calls.push(body);
  assert.equal(body.model,'gpt-6-luna'); assert.equal(body.store,false); assert.equal(body.stream,false);
  if(mode==='transport') throw new Error('synthetic connection failure');
  if(mode==='429') return new Response('{}',{status:429});
  const usage={input_tokens:1000, output_tokens:100, input_tokens_details:{cached_tokens:200},output_tokens_details:{reasoning_tokens:30}};
  if(body.tools) return response({model:'gpt-6-luna',status:'completed',usage,output_text:mode==='stale_weather'?`Seattle observation at ${staleObservationTime}: 14°C. Forecast period: today.`:'At 12:00 UTC, Seattle is 14°C.',
    output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:mode==='action_sources'?[{type:'url',url:'https://forecast.weather.gov/MapClick.php?lat=47.6&lon=-122.3'}]:mode==='feed_only'?[{type:'url',url:'oai-weather'}]:[]}}, {type:'message',content:[{type:'output_text',text:'Seattle: 14°C.',
      annotations:['no_source','action_sources','feed_only'].includes(mode)?[]:[{type:'url_citation',title:'Official forecast',url:'https://weather.gov/seattle'}]}]}]});
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
  assert.equal(needsBusinessEvidence('Explain profit margin.'),false);
  assert.equal(needsBusinessEvidence('A project costs $640 and sells for $800. Calculate profit, margin and markup.'),false);
  assert.equal(needsBusinessEvidence('Explain why repair turnaround is rising.'),true);
  assert.equal(needsBusinessEvidence('What is causing cancelled appointments?'),true);
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
  const lookedUpAt='2026-10-08T12:00:00Z';
  const documentedSource={type:'web_search_call',status:'completed',action:{type:'search',sources:[{type:'url',url:'https://forecast.weather.gov/seattle'}]}};
  const sourceOnly=readVsiWebSources({output:[documentedSource]},lookedUpAt);
  assert.equal(sourceOnly.length,1);assert.equal(sourceOnly[0].url,'https://forecast.weather.gov/seattle');assert.equal(sourceOnly[0].title,'forecast.weather.gov');assert.equal(sourceOnly[0].retrievedAt,lookedUpAt);
  const annotated={type:'message',content:[{type:'output_text',annotations:[{type:'url_citation',url:'https://forecast.weather.gov/seattle',title:'Seattle official forecast'}]}]};
  const combined=readVsiWebSources({output:[documentedSource,annotated]},lookedUpAt);assert.equal(combined.length,1);assert.equal(combined[0].title,'Seattle official forecast');
  for(const status of ['failed','incomplete','in_progress',undefined])assert.equal(readVsiWebSources({output:[{...documentedSource,status},annotated]},lookedUpAt).length,0);
  assert.equal(readVsiWebSources({output:[annotated]},lookedUpAt).length,0);
  assert.equal(readVsiWebSources({output:[{...documentedSource,action:{type:'open_page',sources:documentedSource.action.sources}}]},lookedUpAt).length,0);
  const invalidUrls=['oai-weather','javascript:alert(1)','data:text/html,private','file:///private/data','https://user:secret@weather.test/','https://','https://weather.test/'+'a'.repeat(2001)];
  for(const url of invalidUrls)assert.equal(readVsiWebSources({output:[{...documentedSource,action:{type:'search',sources:[{type:'url',url}]}}]},lookedUpAt).length,0);
  assert.equal(readVsiWebSources({output:[{...documentedSource,action:{type:'search',sources:Array.from({length:30},(_,i)=>({type:'url',url:`https://weather.test/${i}`}))}}]},lookedUpAt).length,10);
  const diagnostic=vsiLiveLookupDiagnostic({output:[{type:'PRIVATE QUESTION',status:'SECRET TOKEN',content:[{type:'output_text',text:'PRIVATE ANSWER',annotations:[{type:'url_citation',url:'https://private.invalid/SECRET_TOKEN'}]}]},
    {...documentedSource,status:'SECRET TOKEN',action:{type:'search',sources:[{type:'url',url:'https://private.invalid/SECRET_TOKEN'},{type:'url',url:'oai-weather'}]}}]});
  assert.deepEqual(diagnostic.feedLabels,['oai-weather']);assert.deepEqual(diagnostic.searchStatuses,['other']);
  assert.ok(!/PRIVATE|SECRET|private.invalid|https:/.test(JSON.stringify(diagnostic)));
  const general=await runVsiAnswer(input('Write a friendly invitation to dinner.'));
  assert.equal(retrievalCalls,0);assert.equal(calls.length,1);assert.equal(calls[0].tools,undefined);assert.equal(general.noteDraft,undefined);
  assert.equal(general.usage.inputTokens,1000);assert.equal(general.usage.cachedInputTokens,200);assert.equal(general.usage.reasoningTokens,30);
  for(const prohibited of ['Remember this: My SSN is 123-45-6789.','Patient Jane Doe has diabetes.','Remember this: Patient Jane Doe has diabetes.']){
    await assert.rejects(runVsiAnswer(input(prohibited)),/Social Security|patient-identifying/);
    assert.equal(calls.length,1,'prohibited patient/identifier content must be rejected before provider dispatch or note proposal');
  }
  const note=await runVsiAnswer(input('Remember this: We sell bicycle repairs.'));
  assert.equal(note.noteDraft.content,'We sell bicycle repairs.');assert.equal(calls.length,1);
  const missing=await runVsiAnswer(input('Weather today?')); assert.match(missing.content,/city|location/); assert.equal(calls.length,1);
  const current=await runVsiAnswer(input('Weather in Seattle today?',{contextSummary:'TOP SECRET WORKSPACE METRIC',recentMessages:[{role:'user',content:'TOP SECRET PRIVATE HISTORY'}]}));
  assert.equal(current.usage.webSearchCalls,1);assert.equal(current.citations[0].sourceType,'web');
  const webCall=calls.find(call=>call.tools);assert.equal(webCall.max_tool_calls,2);assert.equal(webCall.tool_choice,'required');
  assert.ok(!JSON.stringify(webCall).includes('TOP SECRET'));
  assert.match(webCall.input[0].content,/citable public webpage/);
  mode='stale_weather';await runVsiAnswer(input('Weather in Seattle today?'));
  const staleLookup=calls.at(-2),staleAnswer=calls.at(-1),stalePayload=JSON.parse(staleAnswer.input[1].content);
  assert.match(stalePayload.livePublicLookup.text,new RegExp(staleObservationTime.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.ok(Date.parse(stalePayload.now)-Date.parse(staleObservationTime)>3*60*60*1000,'final answer receives both old observation time and current time');
  assert.ok(Date.parse(stalePayload.livePublicLookup.sources[0].retrievedAt)>Date.parse(staleObservationTime),'citation keeps lookup time separate from source observation');
  for(const prompt of [staleLookup.input[0].content,staleAnswer.input[0].content]){
    assert.match(prompt,/more than about one hour old/);assert.match(prompt,/freshness cannot be verified/);assert.match(prompt,/never describe that reading as current or latest/);assert.match(prompt,/observation time, forecast period and lookup time separate/);
  }
  mode='action_sources';const sourceFallback=await runVsiAnswer(input('Weather in Seattle today?'));assert.equal(sourceFallback.citations[0].url,'https://forecast.weather.gov/MapClick.php?lat=47.6&lon=-122.3');assert.equal(sourceFallback.usage.webSearchCalls,1);mode='normal';
  const business=await runVsiAnswer(input('Why did repair turnaround rise?'));assert.equal(retrievalCalls,1);assert.equal(business.citations[0].id,'B1');
  assert.match(business.content,/does not establish a cause/);
  assert.match(VSI_SYSTEM_PROMPT,/aggregate review count cannot establish/);assert.match(VSI_SYSTEM_PROMPT,/untrusted data/);
  mode='bad_cite'; await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError && error.usage.outputTokens===100);
  mode='wrong_model';await assert.rejects(runVsiAnswer(input('Explain gravity')),/required Luna/);
  mode='incomplete';await assert.rejects(runVsiAnswer(input('Explain gravity')),/response limit/);
  const failureLogs=[],originalError=console.error;console.error=(...args)=>failureLogs.push(args);
  try {
    mode='no_source';await assert.rejects(runVsiAnswer(input('Weather in Seattle today?')),error=>error instanceof VsiEngineError && error.usage.webSearchCalls===1);
    mode='feed_only';await assert.rejects(runVsiAnswer(input('Weather in Seattle today?')),error=>error instanceof VsiEngineError && /verifiable source/.test(error.message) && error.usage.webSearchCalls===1);
  } finally { console.error=originalError; }
  assert.equal(failureLogs.length,2);assert.deepEqual(failureLogs[1][1].feedLabels,['oai-weather']);
  assert.ok(!/Seattle|synthetic-test-key|https:|PRIVATE/.test(JSON.stringify(failureLogs)));

  mode='transport';await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError && error.accountingUncertain);
  resetAIProviderCircuitForTests();mode='429';await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError && !error.accountingUncertain && error.usage.estimatedCostUsd===0);
  resetAIProviderCircuitForTests();mode='normal';permitted=false;
  const callCount=calls.length;await assert.rejects(runVsiAnswer(input('Explain gravity')),/Workspace denied/);assert.equal(calls.length,callCount);
  assert.equal(vsiEstimatedCost({inputTokens:1000000,cachedInputTokens:200000,outputTokens:1000000,webSearchCalls:2}),0.602);
  assert.ok(getVsiConfig().requestReserveUsd>=0.1);assert.equal(getVsiConfig().workspaceMonthlyBudgetUsd,50);
  console.log(JSON.stringify({passed:true,suite:'VSI engine behavior and accounting',providerCalls:calls.length,paidProviderCalls:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
