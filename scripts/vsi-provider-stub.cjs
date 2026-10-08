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
 const payload=web?null:JSON.parse(body.input[1].content);
 const ids=web?[]:(payload.livePublicLookup?payload.livePublicLookup.sources:payload.businessSources).slice(0,3).map(x=>x.id);
 const answer=web?'Portland weather source checked for this synthetic transport test.':JSON.stringify({content:'Here is a practical answer from Vaeroex. '+(ids.length?'Available records support the measurements, but they do not establish a cause. Compare dated repair records and customer comments to test a possible relationship. '+ids.map(id=>'['+id+']').join(' '):'Set a clear goal, reserve focused time, and review your progress at the end of the week.'),citationIds:ids});
 const output=[...(web?[{type:'web_search_call',id:'ws_synthetic',status:'completed',action:{type:'search',query:'Portland weather'}}]:[]),{type:'message',role:'assistant',content:[{type:'output_text',text:answer,annotations:web?[{type:'url_citation',url:'https://www.weather.gov/',title:'National Weather Service — synthetic transport',start_index:0,end_index:16}]:[]}]}];
 return Response.json({id:'resp_synthetic',model:'gpt-6-luna',status:'completed',output,usage:{input_tokens:1200,input_tokens_details:{cached_tokens:0},output_tokens:180,output_tokens_details:{reasoning_tokens:40}}});
};
