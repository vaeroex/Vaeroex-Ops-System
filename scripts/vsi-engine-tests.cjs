/* eslint-disable @typescript-eslint/no-require-imports -- Native qualification loads project TypeScript without changing the application runtime. */
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
let retrievalCalls = 0, permitted = true, productAvailable = true;
const source = { id:'B1', title:'Repair turnaround', url:'/app/kpis?q=Repair', sourceType:'kpi', sourceId:'metric-1',
  evidenceDate:'2026-09-01', retrievedAt:'2026-10-08T12:00:00Z', excerpt:'Turnaround rose from 2 to 4 days; cause not established.', text:'Turnaround rose from 2 to 4 days; cause not established.', treatment:'record' };
const mock=(file,exports)=>{const filename=path.join(root,file);require.cache[filename]={id:filename,filename,loaded:true,exports};};
mock('lib/vsi/retrieval.ts',{
  authorizeVsiRead: async () => { if (!permitted) throw new Error('Workspace denied'); return {}; },
  retrieveVsiEvidence: async () => { retrievalCalls++; return { sources:[source], limitations:['Only aggregate measurements are available.'] }; }
});
const productSource={id:'P1',title:'Vaeroex product',url:'/app/help',sourceType:'product_context',sourceId:null,evidenceDate:null,retrievedAt:'2026-10-08T12:00:00Z',text:'Vaeroex provides text chat and public research.',treatment:'record'};
mock('lib/vsi/product-context.ts',{loadVsiProductContext:async()=>{if(!productAvailable)throw new Error('synthetic product lookup failure');return {authoritative:{assistant:{name:'Vaeroex'},workspace:{name:'PRIVATE WORKSPACE LABEL'},publishedPlan:{price:'$149'}},sources:[productSource],limitations:[]};}});
const {runVsiAnswer,explicitVsiNoteDraft,boundedVsiHistory,validateVsiAnswer,readVsiWebSources,vsiLiveLookupDiagnostic,VsiEngineError,VSI_SYSTEM_PROMPT} = require('../lib/vsi/engine.ts');
const research = require('../lib/vsi/research.ts');
const {vsiEstimatedCost,getVsiConfig,vsiResearchLimits} = require('../lib/vsi/config.ts');
const {resetAIProviderCircuitForTests,recordAIProviderFailure,getAIProviderRetrySettings} = require('../lib/ai/provider-resilience.ts');
const calls=[];
let mode='normal', customPlan=null, currentRound=0;
const usage={input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:200},output_tokens_details:{reasoning_tokens:30}};
const response=(body)=>new Response(JSON.stringify(body),{status:200,headers:{'x-request-id':'synthetic-vsi'}});
const plan=(mode='answer',overrides={})=>({mode,businessEvidence:false,tier:'simple',clarification:'',publicTargets:[],objectives:[],...overrides});
const researchPlan=(text,tier='simple',objectives=['overview'])=>plan('research',{tier,publicTargets:[{text,origin:'question'}],objectives});
global.fetch=async(url,init)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init.body);calls.push(body);
  assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.equal(body.stream,false);
  if(mode==='transport')throw new Error('synthetic connection failure');
  if(mode==='slow_transport'){await new Promise(resolve=>setTimeout(resolve,20));throw new Error('synthetic delayed transport failure');}
  if(mode==='429')return new Response('{}',{status:429});
  if(mode==='wrong_model')return response({model:'gpt-6-sol',status:'completed',usage,output_text:'{}'});
  if(mode==='incomplete')return response({model:'gpt-6-luna',status:'incomplete',usage});
  const name=body.text?.format?.name,payload=JSON.parse(body.input[1].content);
  if(name==='vsi_research_plan_v1'){
    currentRound=0;assert.equal(body.tools,undefined);
    const value=customPlan||plan('answer');
    return response({model:'gpt-6-luna',status:'completed',usage,output_text:JSON.stringify(value)});
  }
  if(name==='vsi_public_research_v1'){
    currentRound++;
    if(['later_failure','later_failure_bad_answer'].includes(mode)&&currentRound===2)return new Response('{}',{status:503});
    const weather=payload.objectives.includes('weather');
    const old=(mode==='stale_weather'&&currentRound===1)||mode==='always_stale';
    const date=weather?(old?'2025-03-01T07:45:00Z':new Date().toISOString()):'2026-09-15';
    const url=weather?`https://weather.gov/observation-${currentRound}`:`https://example.org/research-${currentRound}`;
    const claim=weather?`Observation at ${date}: 14°C. Forecast period: today.`:`Public finding ${currentRound}: the company makes reusable packaging.`;
    const actionCount=mode==='later_tool_overrun'?(currentRound===1?3:4):mode==='global_tool_overrun'?13:mode==='deep'?body.max_tool_calls:mode==='tool_overrun'?body.max_tool_calls+1:1;
    const output=Array.from({length:actionCount},(_,i)=>({type:'web_search_call',status:'completed',action:(mode==='later_tool_overrun'?i<2:mode==='global_tool_overrun'||i===0)?{type:'search',sources:mode==='no_source'||mode==='feed_only'?[{type:'url',url:'oai-weather'}]:[{type:'url',url}]}:mode==='later_tool_overrun'||i===1?{type:'open_page',url}:{type:'find_in_page',url,pattern:'founder'}}));
    if(!['no_source','feed_only','action_sources'].includes(mode))output.push({type:'message',content:[{type:'output_text',text:claim,annotations:[{type:'url_citation',title:weather?'Official observation':'Official company page',url}]}]});
    const claims=mode==='large_deep'?Array.from({length:18},(_,i)=>({text:`Verified dimension ${currentRound}-${i}: `+'Measured public detail. '.repeat(45),urls:[`https://example.org/source-${currentRound}-${i}`],evidenceDate:date})):[{text:claim,urls:[url],evidenceDate:date}];
    if(mode==='large_deep')output[0].action.sources=claims.map(item=>({type:'url',url:item.urls[0]}));
    const responseUsage=['cost_at_reserve','cost_over_reserve'].includes(mode)&&currentRound===2?{...usage,input_tokens:mode==='cost_at_reserve'?2296860:3000000,input_tokens_details:{cached_tokens:0}}:usage;
    return response({model:'gpt-6-luna',status:'completed',usage:responseUsage,output,output_text:JSON.stringify({claims,limitations:[],needsMoreResearch:['deep','repeat','large_deep','later_failure','later_failure_bad_answer','later_tool_overrun','cost_at_reserve','cost_over_reserve'].includes(mode)})});
  }
  assert.equal(name,'vsi_answer_v1');assert.equal(body.tools,undefined);
  const isWeb=Boolean(payload.livePublicLookup), isBusiness=payload.businessSources.length>0;
  const cited=isWeb?payload.livePublicLookup.sources:isBusiness?payload.businessSources:mode==='history'?payload.historicalSources:mode==='product'?payload.productSources:[];
  const content=isWeb?`Here are the public findings${payload.researchStatus.partial?'; some checks remain unresolved':''} [${cited[0].id}].`:isBusiness?`Turnaround is 4 days, up from 2. The aggregate does not establish a cause [${cited[0].id}].`:mode==='history'?`The earlier research used its cited source snapshot [${cited[0].id}].`:mode==='product'?`Vaeroex supports public research [${cited[0].id}].`:'Here is a clear three-step writing plan.';
  return response({model:'gpt-6-luna',status:'completed',usage,output_text:JSON.stringify({content,citationIds:['bad_cite','later_failure_bad_answer'].includes(mode)?['B99']:cited.slice(0,1).map(source=>source.id)})});
};
const input=(question,extras={})=>({supabase:{},workspaceId:'synthetic-a',actorUserId:'actor-a',requestId:'request',question,recentMessages:[],...extras});
const answerPayload=()=>JSON.parse(calls.at(-1).input[1].content);
async function main(){
  process.env.OPENAI_API_KEY='synthetic-test-key';
  const circuitSettings={...getAIProviderRetrySettings('openai'),circuitFailureThreshold:2};recordAIProviderFailure('openai',circuitSettings);recordAIProviderFailure('openai',circuitSettings);
  await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError&&!error.accountingUncertain&&error.usage.estimatedCostUsd===0&&(error.usage.providerCalls||0)===0);assert.equal(calls.length,0,'an open circuit must not dispatch or charge the uncertainty reserve');resetAIProviderCircuitForTests();
  assert.equal(explicitVsiNoteDraft('remember this'),undefined);assert.equal(explicitVsiNoteDraft('Remember this:'),undefined);assert.equal(explicitVsiNoteDraft('Do not remember this: private detail'),undefined);
  assert.deepEqual(explicitVsiNoteDraft('Please remember this: We sell bicycle repairs.'),{title:'We sell bicycle repairs',content:'We sell bicycle repairs.'});assert.equal(explicitVsiNoteDraft('remember this: '+'x'.repeat(1801)),undefined);
  const bounded=boundedVsiHistory(Array.from({length:500},(_,i)=>({role:i%2?'assistant':'user',content:`message ${i} `+'x'.repeat(2000)})));
  assert.ok(bounded.length<=24);assert.ok(bounded.reduce((sum,row)=>sum+row.content.length,0)<=16000);assert.ok(bounded.at(-1).content.startsWith('message 499'));
  assert.throws(()=>validateVsiAnswer({content:'[B2]',citationIds:['B2']},[source]));assert.throws(()=>validateVsiAnswer({content:'See https://evil.example',citationIds:[]},[]));
  assert.equal('text' in validateVsiAnswer({content:'Supported [B1]',citationIds:['B1']},[source]).citations[0],false);
  assert.equal(validateVsiAnswer({content:'Product [P1]',citationIds:['P1']},[productSource]).citations[0].id,'P1');
  const lookedUpAt='2026-10-08T12:00:00Z',documentedSource={type:'web_search_call',status:'completed',action:{type:'search',sources:[{type:'url',url:'https://forecast.weather.gov/seattle'}]}};
  const sourceOnly=readVsiWebSources({output:[documentedSource]},lookedUpAt);assert.equal(sourceOnly.length,1);assert.equal(sourceOnly[0].retrievedAt,lookedUpAt);
  const annotated={type:'message',content:[{type:'output_text',annotations:[{type:'url_citation',url:'https://forecast.weather.gov/seattle',title:'Seattle official forecast'}]}]};
  assert.equal(readVsiWebSources({output:[documentedSource,annotated]},lookedUpAt)[0].title,'Seattle official forecast');
  for(const status of ['failed','incomplete','in_progress',undefined])assert.equal(readVsiWebSources({output:[{...documentedSource,status},annotated]},lookedUpAt).length,0);
  for(const type of ['open_page','find_in_page'])assert.equal(readVsiWebSources({output:[{...documentedSource,action:{type,url:'https://weather.gov/forecast'}}]},lookedUpAt)[0].url,'https://weather.gov/forecast');
  assert.equal(readVsiWebSources({output:[annotated]},lookedUpAt).length,0);
  for(const url of ['oai-weather','javascript:alert(1)','data:text/html,private','file:///private/data','https://user:secret@weather.gov/','https://127.0.0.1','https://local.internal','https://weather.gov/'+'a'.repeat(2001)])assert.equal(readVsiWebSources({output:[{...documentedSource,action:{type:'search',sources:[{type:'url',url}]}}]},lookedUpAt).length,0);
  const diagnostic=vsiLiveLookupDiagnostic({output:[{type:'PRIVATE QUESTION',status:'SECRET TOKEN',content:[{type:'output_text',text:'PRIVATE ANSWER',annotations:[{type:'url_citation',url:'https://private.invalid/SECRET_TOKEN'}]}]}, {...documentedSource,status:'SECRET TOKEN',action:{type:'search',sources:[{type:'url',url:'https://private.invalid/SECRET_TOKEN'},{type:'url',url:'oai-weather'}]}}]});
  assert.deepEqual(diagnostic.feedLabels,['oai-weather']);assert.ok(!/PRIVATE|SECRET|private.invalid|https:/.test(JSON.stringify(diagnostic)));

  customPlan=plan();const general=await runVsiAnswer(input('Help me plan a focused writing week.'));
  assert.equal(retrievalCalls,0);assert.equal(calls.length,2);assert.ok(calls.every(call=>!call.tools));assert.equal(general.noteDraft,undefined);assert.equal(general.usage.inputTokens,2000);assert.equal(general.usage.reasoningTokens,60);
  const beforeGuard=calls.length;
  for(const prohibited of ['Remember this: My SSN is 123-45-6789.','Patient Jane Doe has diabetes.','Remember this: Patient Jane Doe has diabetes.'])await assert.rejects(runVsiAnswer(input(prohibited)),/Social Security|patient-identifying/);
  assert.equal(calls.length,beforeGuard,'guard runs before planning and notes');
  const note=await runVsiAnswer(input('Remember this: We sell bicycle repairs.'));assert.equal(note.noteDraft.content,'We sell bicycle repairs.');assert.equal(calls.length,beforeGuard);
  customPlan=plan('clarify',{clarification:'Which city should I check the weather for?'});const missing=await runVsiAnswer(input('What is it like outside?'));assert.match(missing.content,/city/);

  customPlan=researchPlan('Lumen Packaging','standard',['overview','offerings','leadership']);
  const current=await runVsiAnswer(input('Tell me about Lumen Packaging.',{contextSummary:'TOP SECRET WORKSPACE METRIC',recentMessages:[{role:'user',content:'TOP SECRET PRIVATE HISTORY'}]}));
  assert.equal(current.usage.webSearchCalls,1);assert.equal(current.citations[0].sourceType,'web');assert.deepEqual(current.publicResearchTopics,['Lumen Packaging']);assert.ok(current.citations[0].excerpt.includes('reusable packaging'));
  const webCall=calls.find(call=>call.tools);assert.equal(webCall.max_tool_calls,3);assert.equal(webCall.tool_choice,'required');assert.equal(webCall.reasoning.effort,'medium');assert.equal(webCall.tools[0].search_context_size,'medium');
  assert.ok(!JSON.stringify(webCall).includes('TOP SECRET'));assert.ok(!JSON.stringify(calls.filter(call=>!call.tools).at(-1)).includes('TOP SECRET WORKSPACE METRIC'),'legacy mixed summary must never enter model context');assert.ok(!JSON.stringify(webCall).includes('PRIVATE WORKSPACE'));assert.ok(!JSON.stringify(webCall).includes('Tell me about'));
  assert.deepEqual(Object.keys(JSON.parse(webCall.input[1].content)).sort(),['approvedPublicTargets','continuation','now','objectives','priorPublicEvidence','priorPublicSources','researchDepth','round','toolAllowanceThisRound'].sort());
  const storedCitation=current.citations[0],storedTopics=current.publicResearchTopics;
  mode='history';customPlan=plan();const beforeHistory=calls.filter(call=>call.tools).length;
  const explained=await runVsiAnswer(input('How did you reach that finding?',{recentMessages:[{role:'user',content:'Tell me about Lumen Packaging.'},{role:'assistant',content:current.content,citations:[storedCitation],publicResearchTopics:storedTopics}]}));
  assert.equal(calls.filter(call=>call.tools).length,beforeHistory,'explanation reuses evidence without another lookup');assert.equal(explained.citations[0].url,storedCitation.url);assert.equal(explained.citations[0].retrievedAt,storedCitation.retrievedAt);assert.equal(explained.citations[0].id,storedCitation.id);
  assert.ok(answerPayload().historicalSources.some(citation=>citation.id===research.stableVsiCitationId(storedCitation)));
  mode='normal';customPlan=plan('research',{tier:'standard',publicTargets:[{text:'Lumen Packaging',origin:'prior_public_topic'}],objectives:['leadership']});
  await runVsiAnswer(input('Who founded it?',{recentMessages:[{role:'assistant',content:'PRIVATE METRIC MARGIN 42.7%',publicResearchTopics:storedTopics,citations:[storedCitation]}]}));
  const founderWeb=calls.filter(call=>call.tools).at(-1);assert.deepEqual(JSON.parse(founderWeb.input[1].content).approvedPublicTargets,storedTopics);assert.ok(!JSON.stringify(founderWeb).includes('42.7'));
  customPlan=plan('research',{publicTargets:[{text:'Maya Ortiz',origin:'question'},{text:'Lumen Packaging',origin:'prior_public_topic'}],objectives:['leadership']});
  await runVsiAnswer(input('Is it Maya Ortiz?',{priorPublicResearchTopics:storedTopics}));assert.deepEqual(JSON.parse(calls.filter(call=>call.tools).at(-1).input[1].content).approvedPublicTargets,['Maya Ortiz','Lumen Packaging']);
  customPlan=researchPlan('Secret Supplier');const beforeUnsafe=calls.filter(call=>call.tools).length;
  const privatePlan=await runVsiAnswer(input('Search our internal notes about Secret Supplier.'));assert.match(privatePlan.content,/separately from private/);assert.equal(calls.filter(call=>call.tools).length,beforeUnsafe);
  customPlan=researchPlan('Lumen Packaging');const mixedPrivate=await runVsiAnswer(input('Research Lumen Packaging; our revenue is $123456.',{contextSummary:'PRIVATE INTERNAL SECRET'}));assert.match(mixedPrivate.content,/separately from private/);customPlan=plan('research',{publicTargets:[{text:'Lumen Packaging',origin:'prior_public_topic'}],objectives:['overview']});await runVsiAnswer(input('Compare with our revenue of $123456',{priorPublicResearchTopics:['Lumen Packaging']}));assert.ok(!JSON.stringify(calls.filter(call=>call.tools).at(-1)).includes('123456'));

  const cjkTopics=Array.from({length:6},(_,i)=>'企'.repeat(159)+String.fromCodePoint(0x4e00+i));customPlan=plan('research',{publicTargets:cjkTopics.map(text=>({text,origin:'question'})),objectives:['overview']});const beforeCjk=calls.filter(call=>call.tools).length;const cjk=await runVsiAnswer(input('Research '+cjkTopics.join('; ')));assert.match(cjk.content,/fewer public names/);assert.equal(calls.filter(call=>call.tools).length,beforeCjk,'oversized persisted topics must clarify before public dispatch');assert.equal(cjk.publicResearchTopics,undefined);
  mode='stale_weather';customPlan=researchPlan('Seattle','simple',['weather']);const weather=await runVsiAnswer(input('Weather in Seattle today?'));
  assert.equal(weather.usage.webSearchCalls,2,'stale observation triggers a second lookup');assert.equal(answerPayload().researchStatus.rounds,2);
  const weatherCalls=calls.filter(call=>call.tools).slice(-2);assert.ok(weatherCalls.every(call=>call.max_tool_calls===1));
  for(const prompt of [weatherCalls[0].input[0].content,calls.at(-1).input[0].content]){assert.match(prompt,/more than about one hour old/);assert.match(prompt,/freshness cannot be verified/);assert.match(prompt,/never describe that reading as current or latest/);}
  mode='always_stale';await runVsiAnswer(input('Weather in Seattle today?'));assert.equal(answerPayload().researchStatus.partial,true);assert.match(answerPayload().researchStatus.limitations.join(' '),/last hour|freshness/);
  mode='action_sources';customPlan=researchPlan('Lumen Packaging');const sourceFallback=await runVsiAnswer(input('Find Lumen Packaging'));assert.equal(sourceFallback.citations[0].url,'https://example.org/research-1');
  mode='deep';customPlan=researchPlan('Lumen Packaging','deep',['overview','offerings','pricing','leadership','reputation','competitors']);
  const deep=await runVsiAnswer(input('Investigate Lumen Packaging thoroughly.'));assert.equal(deep.usage.providerCalls,5);assert.equal(deep.usage.webSearchCalls,3);assert.equal(deep.usage.webOpenCalls,3);assert.equal(deep.usage.webFindCalls,6);assert.equal(answerPayload().researchStatus.partial,true);assert.equal(deep.usage.researchTier,'deep');assert.equal(calls.at(-1).reasoning.effort,'high');assert.equal(calls.filter(call=>call.tools).at(-1).tools[0].search_context_size,'high');
  assert.ok(deep.usage.estimatedCostUsd<getVsiConfig().requestReserveUsd);
  mode='large_deep';customPlan=researchPlan('Lumen Packaging','deep',['overview','offerings','pricing','leadership','reputation','competitors']);const large=await runVsiAnswer(input('Investigate Lumen Packaging comprehensively.'));assert.ok(large.citations.length>0);assert.equal(answerPayload().researchStatus.partial,true);assert.match(answerPayload().researchStatus.limitations.join(' '),/additional verified findings/);assert.ok(JSON.stringify(answerPayload()).length+VSI_SYSTEM_PROMPT.length<=getVsiConfig().maxInputChars);const publicLookup=answerPayload().livePublicLookup;assert.ok(publicLookup.sources.every(source=>!('excerpt' in source)));assert.ok(publicLookup.claims.every(claim=>claim.urls.every(url=>publicLookup.sources.some(source=>source.url===url))));
  mode='later_failure';customPlan=researchPlan('Lumen Packaging','standard');const partial=await runVsiAnswer(input('Research Lumen Packaging'));assert.equal(answerPayload().researchStatus.partial,true);assert.equal(partial.usage.costEstimated,true);assert.equal(partial.usage.estimatedCostUsd,0.25);assert.ok(partial.citations.length);resetAIProviderCircuitForTests();
  mode='later_failure_bad_answer';customPlan=researchPlan('Lumen Packaging','standard');await assert.rejects(runVsiAnswer(input('Research Lumen Packaging')),error=>error instanceof VsiEngineError&&error.accountingUncertain&&error.usage.costEstimated===true);resetAIProviderCircuitForTests();
  mode='tool_overrun';customPlan=researchPlan('Lumen Packaging');const earlyOverrun=await runVsiAnswer(input('Find Lumen Packaging'));assert.equal(earlyOverrun.usage.toolAllowanceExceeded,true);assert.equal(earlyOverrun.usage.providerCalls,3);assert.equal(earlyOverrun.usage.webSearchCalls,1);assert.equal(earlyOverrun.usage.webOpenCalls,1);assert.equal(answerPayload().researchStatus.partial,true);assert.ok(earlyOverrun.citations.length);
  mode='later_tool_overrun';customPlan=researchPlan('Lumen Packaging','standard');const laterOverrun=await runVsiAnswer(input('Research Lumen Packaging'));assert.equal(laterOverrun.usage.toolAllowanceExceeded,true);assert.equal(laterOverrun.usage.webSearchCalls,4);assert.equal(laterOverrun.usage.webOpenCalls,3);assert.equal(laterOverrun.usage.providerCalls,4,'only synthesis follows a completed overrun');assert.equal(answerPayload().researchStatus.toolAllowanceExceeded,true);assert.match(answerPayload().researchStatus.limitations.join(' '),/more lookup steps than planned/);assert.ok(answerPayload().livePublicLookup.sources.some(source=>source.url.endsWith('research-2')),'verified evidence from the overrun response is retained');
  mode='global_tool_overrun';customPlan=researchPlan('Lumen Packaging','deep');const globalOverrun=await runVsiAnswer(input('Investigate Lumen Packaging'));assert.equal(globalOverrun.usage.webSearchCalls,13);assert.equal(globalOverrun.usage.toolAllowanceExceeded,true);assert.equal(globalOverrun.usage.providerCalls,3);assert.ok(globalOverrun.usage.estimatedCostUsd<getVsiConfig().requestReserveUsd);
  for(const spendingMode of ['cost_at_reserve','cost_over_reserve']){mode=spendingMode;customPlan=researchPlan('Lumen Packaging','standard');const beforeSpending=calls.length;await assert.rejects(runVsiAnswer(input('Research Lumen Packaging')),error=>error instanceof VsiEngineError&&error.usage.estimatedCostUsd>=getVsiConfig().requestReserveUsd&&!error.accountingUncertain);assert.equal(calls.length-beforeSpending,3,'spent reservation must block synthesis even when earlier evidence exists');assert.ok(calls.slice(beforeSpending).every(call=>call.text?.format?.name!=='vsi_answer_v1'));}

  mode='normal';customPlan=plan('answer',{businessEvidence:true});const business=await runVsiAnswer(input('Why did repair turnaround rise?'));assert.equal(retrievalCalls,1);assert.match(business.citations[0].id,/^B\d+$/);assert.match(business.citations[0].snapshotHash,/^[a-f0-9]{64}$/);assert.match(business.content,/does not establish a cause/);
  const sourceMessage={role:'assistant',content:'SENSITIVE OLD BUSINESS FACT [B1]',citations:[source]};customPlan=plan();await runVsiAnswer(input('Explain your earlier finding',{recentMessages:[sourceMessage]}));assert.ok(!JSON.stringify(answerPayload()).includes('SENSITIVE OLD BUSINESS FACT'));
  mode='product';const product=await runVsiAnswer(input('What can Vaeroex do?'));assert.equal(product.citations[0].id,'P1');assert.equal(answerPayload().runtimeCapabilities.publicWebResearch,'available');assert.equal(answerPayload().runtimeCapabilities.lookupThisTurn,'not_needed');
  assert.match(VSI_SYSTEM_PROMPT,/aggregate review count cannot establish/);assert.match(VSI_SYSTEM_PROMPT,/untrusted data/);assert.match(VSI_SYSTEM_PROMPT,/do not say you lack browsing/);
  mode='bad_cite';await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError&&error.usage.outputTokens===200);
  mode='wrong_model';await assert.rejects(runVsiAnswer(input('Explain gravity')),/required Luna/);mode='incomplete';await assert.rejects(runVsiAnswer(input('Explain gravity')),/response limit/);
  const failureLogs=[],originalError=console.error;console.error=(...args)=>failureLogs.push(args);
  try{mode='feed_only';customPlan=researchPlan('Seattle','simple',['weather']);await assert.rejects(runVsiAnswer(input('Weather in Seattle?')),error=>error instanceof VsiEngineError&&/verifiable source/.test(error.message)&&error.usage.webSearchCalls===2);}finally{console.error=originalError;}
  assert.equal(failureLogs.length,2);assert.ok(!/Seattle|synthetic-test-key|https:|PRIVATE/.test(JSON.stringify(failureLogs)));
  mode='transport';await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError&&error.accountingUncertain);resetAIProviderCircuitForTests();mode='slow_transport';await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError&&error.usage.latencyMs>=15&&error.accountingUncertain);resetAIProviderCircuitForTests();mode='429';await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError&&!error.accountingUncertain&&error.usage.estimatedCostUsd===0);resetAIProviderCircuitForTests();mode='normal';permitted=false;
  const callCount=calls.length;await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError&&!error.accountingUncertain&&error.usage.estimatedCostUsd===0&&/Workspace denied/.test(error.message));assert.equal(calls.length,callCount);permitted=true;productAvailable=false;await assert.rejects(runVsiAnswer(input('Explain gravity')),error=>error instanceof VsiEngineError&&!error.accountingUncertain&&error.usage.estimatedCostUsd===0);assert.equal(calls.length,callCount);productAvailable=true;
  assert.equal(vsiEstimatedCost({inputTokens:1000000,cachedInputTokens:200000,outputTokens:1000000,webSearchCalls:2}),0.602);
  assert.equal(getVsiConfig().requestReserveUsd,0.25);assert.equal(getVsiConfig().workspaceMonthlyBudgetUsd,50);assert.deepEqual(['simple','standard','deep'].map(tier=>vsiResearchLimits(tier).totalTools),[2,6,12]);
  require('./vsi-research-tests.cjs').run(research);
  console.log(JSON.stringify({passed:true,suite:'VSI adaptive research, history, privacy, accounting and failure behavior',providerCalls:calls.length,paidProviderCalls:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
