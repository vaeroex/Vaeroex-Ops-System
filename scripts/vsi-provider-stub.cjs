/* eslint-disable @typescript-eslint/no-require-imports -- Test-process-only provider transport; never imported by the application. */
const fs=require('node:fs');
if(process.env.VSI_LOCAL_TRANSPORT_PROOF!=='true'||!process.env.VSI_TRANSPORT_LOG)throw Error('explicit local harness required');
const nativeFetch=globalThis.fetch;
globalThis.fetch=async function(input,init){
 const url=String(input instanceof Request?input.url:input);
 if(url!=='https://api.openai.com/v1/responses')return nativeFetch(input,init);
 const body=JSON.parse(init.body);if(body.model!=='gpt-6-luna')throw Error('VSI must stay Luna-only');
 const serialized=JSON.stringify(body.input);const web=Boolean(body.tools?.some(t=>t.type==='web_search'));
 fs.appendFileSync(process.env.VSI_TRANSPORT_LOG,JSON.stringify({at:new Date().toISOString(),model:body.model,web,inputChars:serialized.length,containsBusinessContext:serialized.includes('Bicycle shop context'),schema:body.text?.format?.name})+'\n');
 if(serialized.includes('VSI_TEST_PROVIDER_FAILURE'))return new Response(JSON.stringify({error:{message:'synthetic provider outage'}}),{status:503});
 const payload=JSON.parse(body.input[1].content),schema=body.text?.format?.name;
 const inheritedQuestion='Who founded the company from the previous chat?',unavailableQuestion="Explain the previous chat's private finding.";
 const handoffFinding='SYNTHETIC_HANDOFF_FINDING: Lumen Packaging makes reusable shipping boxes.';
 const webUrl=payload.approvedPublicTargets?.includes('Lumen Packaging')?'https://example.org/vsi-handoff-founder':'https://www.weather.gov/';
 let answer;
 if(schema==='vsi_research_plan_v1'){
  const q=payload.question||'';
  if(q===inheritedQuestion){
   if(!payload.approvedPublicTopics?.includes('Lumen Packaging')||!JSON.stringify(payload.recentConversation).includes(handoffFinding))throw Error('Synthetic continuation did not receive the permitted parent context');
   answer=JSON.stringify({mode:'research',businessEvidence:false,tier:'simple',clarification:'',publicTargets:[{text:'Lumen Packaging',origin:'prior_public_topic'}],objectives:['leadership']});
  }else if(q===unavailableQuestion){
   if(serialized.includes(handoffFinding)||payload.approvedPublicTopics?.includes('Lumen Packaging'))throw Error('Synthetic continuation leaked inaccessible parent context');
   answer=JSON.stringify({mode:'answer',businessEvidence:false,tier:'simple',clarification:'',publicTargets:[],objectives:[]});
  }else{
  const weather=/weather/i.test(q)||/Portland, Oregon/.test(q),missing=weather&&!/Portland, Oregon/.test(q);
  answer=JSON.stringify({mode:missing?'clarify':weather?'research':'answer',businessEvidence:/our|notes|files|repairs|reviews/i.test(q),tier:'simple',
   clarification:missing?'Which city or location should I check?':'',publicTargets:weather&&!missing?[{text:'Portland, Oregon',origin:'question'}]:[],objectives:weather&&!missing?['weather']:[]});
  }
 } else if(web){
  answer=JSON.stringify({claims:[{text:webUrl.includes('vsi-handoff')?'Synthetic founder finding: Lumen Packaging was founded by Morgan Example.':'Portland weather source checked for this synthetic transport test.',urls:[webUrl],evidenceDate:new Date().toISOString()}],limitations:['Synthetic transport, not actual weather.'],needsMoreResearch:false});
 } else if(payload.question===inheritedQuestion){
  const old=payload.historicalSources?.find(source=>source.url==='https://example.org/vsi-handoff-original'),current=payload.livePublicLookup?.sources?.find(source=>source.url==='https://example.org/vsi-handoff-founder');
  if(!old||!current||!JSON.stringify(payload.recentConversation).includes(handoffFinding))throw Error('Synthetic continuation lost its source snapshot or new lookup');
  answer=JSON.stringify({content:`The previous chat found reusable shipping boxes [${old.id}]. The synthetic public follow-up identifies founder Morgan Example [${current.id}].`,citationIds:[old.id,current.id]});
 } else if(payload.question===unavailableQuestion){
  if(serialized.includes(handoffFinding)||payload.historicalSources?.some(source=>source.url==='https://example.org/vsi-handoff-original'))throw Error('Synthetic synthesis leaked inaccessible parent evidence');
  answer=JSON.stringify({content:'No permitted previous finding is available in this chat.',citationIds:[]});
 } else {
  const ids=(payload.livePublicLookup?.sources||payload.businessSources||[]).slice(0,3).map(x=>x.id);
  answer=JSON.stringify({content:'Here is a practical answer from Vaeroex. '+(ids.length?'Available records support the measurements, but they do not establish a cause. Compare dated repair records and customer comments to test a possible relationship. '+ids.map(id=>'['+id+']').join(' '):'Set a clear goal, reserve focused time, and review your progress at the end of the week.'),citationIds:ids});
 }

 const output=[...(web?[{type:'web_search_call',id:'ws_synthetic',status:'completed',action:{type:'search',query:'Portland weather'}}]:[]),{type:'message',role:'assistant',content:[{type:'output_text',text:answer,annotations:web?[{type:'url_citation',url:webUrl,title:webUrl.includes('vsi-handoff')?'Synthetic founder source':'National Weather Service — synthetic transport',start_index:0,end_index:16}]:[]}]}];
 return Response.json({id:'resp_synthetic',model:'gpt-6-luna',status:'completed',output,usage:{input_tokens:1200,input_tokens_details:{cached_tokens:0},output_tokens:180,output_tokens_details:{reasoning_tokens:40}}});
};
