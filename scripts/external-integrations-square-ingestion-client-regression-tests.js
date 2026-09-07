const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const {getEventListeners}=require("node:events");
const ts=require("typescript");
const root=path.resolve(__dirname,"..");
require.extensions[".ts"]=function(module,filename){module._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);};
const originalResolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,isMain,options){if(request==="server-only")return path.join(root,"scripts/test-stubs/server-only.js");return originalResolve.call(this,request.startsWith("@/")?path.join(root,request.slice(2)):request,parent,isMain,options);};
const client=require("../lib/integrations/providers/square/ingestion-client.ts");
const requests=require("../lib/integrations/providers/square/request-validators.ts");
const locations=require("../lib/integrations/providers/square/location-responses.ts");
const locationFixtures=require("../lib/integrations/providers/square/fixtures/phase-2b1a.ts");
const payments=require("../lib/integrations/providers/square/payment-responses.ts");
const paymentFixtures=require("../lib/integrations/providers/square/fixtures/payment-responses.ts");
const orderLines=require("../lib/integrations/providers/square/order-responses.ts");
const orderFixtures=require("../lib/integrations/providers/square/fixtures/phase-2b2b1.ts");
const canary="private-square-transport-provider-canary";
let assertions=0,scenarios=0;
const equal=(a,b,message)=>{assertions++;assert.equal(a,b,message);};
const ok=(v,message)=>{assertions++;assert.ok(v,message);};
const deepEqual=(a,b,message)=>{assertions++;assert.deepEqual(a,b,message);};
const bytes=value=>new TextEncoder().encode(value);
const never=()=>new Promise(()=>{});
const request=(overrides={})=>({providerKey:"square",providerEnvironment:"sandbox",method:"GET",url:"https://connect.squareupsandbox.com/v2/payments/PAYMENT_1",headers:{"Square-Version":"2026-08-19"},...overrides});
const post=(url,body)=>request({method:"POST",url:"https://connect.squareupsandbox.com"+url,headers:{"Square-Version":"2026-08-19","Content-Type":"application/json"},body:JSON.stringify(body)});
function response(url,text="{}",overrides={}){return {status:200,url,redirected:false,headers:{"content-type":"application/json; charset=utf-8"},body:(async function*(){yield bytes(text);})(),cancel(){},...overrides};}
async function run(text="{}",overrides={},transportOverrides={}) {
  scenarios++;let calls=0,cancelled=0,captured;
  const value={request:request(),attempt:1,syntheticCredential:"square-synthetic-fixture",transport:async req=>{calls++;captured=req;return response(req.url,text,{cancel(){cancelled++;},...transportOverrides});},...overrides};
  const result=await client.readSquareBoundedResponse(value);
  ok(Object.isFrozen(result));
  if(result.outcome==="failed") {
    deepEqual(Object.keys(result).sort(),["code","outcome","retryAfterMs"]);
    ok(!JSON.stringify(result).includes(canary));
  }
  return {result,calls,cancelled,captured};
}
const read=entry=>{equal(entry.result.outcome,"read",JSON.stringify(entry.result));return entry.result.response;};
const failed=(entry,code,retry=null)=>{equal(entry.result.outcome,"failed");equal(entry.result.code,code);equal(entry.result.retryAfterMs,retry);};
async function accelerated(action) {
  const set=global.setTimeout,clear=global.clearTimeout;
  const timers=new Set();
  global.setTimeout=(fn,delay,...args)=>{
    let timer;timer=set(()=>{timers.delete(timer);fn(...args);},delay>1000?15:delay);timers.add(timer);return timer;
  };
  global.clearTimeout=timer=>{timers.delete(timer);return clear(timer);};
  try {await action();equal(timers.size,0,"overall deadline timer always cleaned");}
  finally {for(const timer of timers)clear(timer);global.setTimeout=set;global.clearTimeout=clear;}
}

async function guards() {
  equal(client.SQUARE_BOUNDED_READ_DEADLINE_MS,30000);
  const first=await run('{"quantity":"0012.3400000000000000001","amount":9007199254740991}');
  const value=read(first);equal(value.quantity,"0012.3400000000000000001");equal(value.amount,Number.MAX_SAFE_INTEGER);
  equal(first.calls,1);equal(first.cancelled,1);equal(first.captured.redirect,"manual");equal(first.captured.signal.aborted,true);
  deepEqual(first.captured.headers,{"Square-Version":"2026-08-19",Accept:"application/json",Authorization:"Bearer square-synthetic-fixture"});
  equal(first.result.decision.requestFingerprint,requests.assertSquareReadOperation(request()).requestFingerprint);
  const paths=["/v2/merchants","/v2/merchants/me","/v2/locations","/v2/locations/main","/v2/orders/ORDER_1","/v2/payments","/v2/payments/P1","/v2/refunds","/v2/refunds/R1","/v2/catalog/list?types=CATEGORY","/v2/catalog/object/C1","/v2/inventory/V1","/v2/inventory/adjustments/A1","/v2/inventory/physical-counts/PC1"];
  for(const pathname of paths)read(await run("{}",{request:request({url:"https://connect.squareupsandbox.com"+pathname})}));
  for(const [url,body] of [["/v2/orders/search",{location_ids:["LOC_1"]}],["/v2/orders/batch-retrieve",{order_ids:["ORDER_1"],location_id:"LOC_1"}],["/v2/catalog/search",{object_types:["ITEM"]}],["/v2/catalog/batch-retrieve",{object_ids:["ITEM_1"]}],["/v2/inventory/counts/batch-retrieve",{limit:1000}],["/v2/inventory/changes/batch-retrieve",{limit:1000}]])read(await run("{}",{request:post(url,body)}));
  read(await run("{}",{request:request({body:""})}));
  read(await run("{}",{request:request({headers:{"Square-Version":["2026-08-19"]}})}));
  for(const invalid of [
    request({method:"DELETE"}),request({method:"POST"}),request({providerKey:"qbo"}),request({providerEnvironment:"production"}),request({url:"http://connect.squareupsandbox.com/v2/payments/P1"}),
    request({url:"https://evil.test/v2/payments/P1"}),request({url:"https://connect.squareupsandbox.com.evil.test/v2/payments/P1"}),request({url:"https://user@connect.squareupsandbox.com/v2/payments/P1"}),request({url:"https://connect.squareupsandbox.com/v2/payments/P1#frag"}),
    request({headers:{"Square-Version":"2025-01-01"}}),request({headers:{"Square-Version":"2026-08-19",Authorization:canary}}),request({headers:{"Square-Version":"2026-08-19","square-version":"2026-08-19"}}),
    request({body:"{}"}),post("/v2/payments",{}),post("/v2/catalog/search",{object_types:["ITEM"],write:true}),
    {...post("/v2/catalog/search",{}),body:'{"object_types":["ITEM"],"limit":1.0000000000000001}'},
    {...post("/v2/catalog/search",{}),body:'{"object_types":["ITEM"],"object_types":["ITEM"]}'},
    {...post("/v2/catalog/search",{}),body:new Uint8Array([0xff])},request({retryAttempt:{attempt:2}})
  ]) {const result=await run("{}",{request:invalid});failed(result,"request_denied");equal(result.calls,0);}
  for(const attempt of [0,4,-1,1.5,NaN]){const result=await run("{}",{attempt});failed(result,"request_denied");equal(result.calls,0);}
  for(const credential of [canary,undefined,null]){const result=await run("{}",{syntheticCredential:credential});failed(result,"request_denied");equal(result.calls,0);}
  const production=await run("{}",{request:request({providerEnvironment:"production",url:"https://connect.squareup.com/v2/payments/P1"})});read(production);equal(production.captured.headers.Authorization,"Bearer square-synthetic-fixture");
}

async function statusAndRetry() {
  for(let status=400;status<=599;status++) {
    const code=status===401||status===403?"authorization":status===429?"rate_limited":status===408||status>=500?"transient":"provider_error";
    failed(await run(canary,{}, {status}),code,code==="transient"||code==="rate_limited"?500:null);
  }
  for(const status of [301,302,303,304,307,308]) {const result=await run(canary,{}, {status,headers:{location:"https://evil.test/"}});failed(result,"redirect_denied");equal(result.calls,1);equal(result.cancelled,1);}
  failed(await run("{}",{}, {redirected:true}),"redirect_denied");
  for(const url of ["https://evil.test/","https://connect.squareupsandbox.com/v2/payments/OTHER","http://connect.squareupsandbox.com/v2/payments/PAYMENT_1"])failed(await run("{}",{}, {url}),"destination_denied");
  for(const status of [401,403])failed(await run(canary,{}, {status}),"authorization");
  for(const status of [400,404,405,409,410,422])failed(await run(canary,{}, {status}),"provider_error");
  for(const status of [408,500,501,502,503,504,599])for(const attempt of [1,2,3])failed(await run(canary,{attempt},{status}),"transient",attempt===3?null:500*2**(attempt-1));
  for(const attempt of [1,2,3])failed(await run(canary,{attempt},{status:429}),"rate_limited",attempt===3?null:500*2**(attempt-1));
  for(const [header,expected] of [["0",500],["2",2000],["60",60000],["61",null],["999999999999999999999999",null],["bad",500]])failed(await run(canary,{}, {status:429,headers:{"Retry-After":header}}),"rate_limited",expected);
  const now=Date.now;Date.now=()=>Date.UTC(2026,8,1,12);
  try {
    failed(await run(canary,{}, {status:503,headers:{"retry-after":"Tue, 01 Sep 2026 12:00:30 GMT"}}),"transient",30000);
    failed(await run(canary,{}, {status:429,headers:{"retry-after":"Tue, 01 Sep 2026 12:01:01 GMT"}}),"rate_limited",null);
  } finally {Date.now=now;}
  failed(await run('{"errors":[{"code":"SECRET","detail":"'+canary+'"}]}'),"provider_error");
  for(const errors of [1,"bad",{},[1],[null]])failed(await run(JSON.stringify({errors})),"malformed_response");
  read(await run('{"errors":null}'));read(await run('{"errors":[]}'));
  failed(await run("{}",{}, {headers:{"content-type":"text/html"}}),"malformed_response");
  failed(await run("{}",{}, {headers:{"content-type":"application/json; charset=utf-16"}}),"malformed_response");
  failed(await run("{}",{}, {headers:{"content-length":"-1"}}),"malformed_response");
  failed(await run("{}",{}, {status:401,cancel(){throw Error(canary);}}),"authorization");
}

async function exactJsonAndStructure() {
  const acceptedNumbers={"0":0,"1.000":1,"1e3":1000,"1e+0":1,"1000000000000000000000e-21":1,"0.00000000001e11":1,"0e99999999999999999999":0,"9007199254740991":Number.MAX_SAFE_INTEGER,"-9007199254740991":-Number.MAX_SAFE_INTEGER,
    "1.5":1.5,"0.1":0.1,"37.123456":37.123456,"37.5000":37.5,"-122.25000":-122.25,"37123456e-6":37.123456,"0.0000012300000e+5":0.123,"1.0000000000000002":1.0000000000000002,"1.2345678901234567":1.2345678901234567,"5e-324":Number.MIN_VALUE,"2.2250738585072014e-308":2.2250738585072014e-308};
  for(const [raw,value] of Object.entries(acceptedNumbers))equal(read(await run('{"n":'+raw+'}')).n,value,"exact numeric lexeme "+raw);
  for(const raw of ["9007199254740992","9007199254740993","-9007199254740992","9007199254740991.1","1.0000000000000001","0.10000000000000001","1.23456789012345678","4e-324","1e309","1e-400","-1e-400","1e999999999999999999999","1e-999999999999999999999","-0","-0e4","-0.0","01","+1","1.",".1","1e","1e+-1","NaN","Infinity"])failed(await run('{"n":'+raw+'}'),"malformed_response");
  equal(read(await run('{"n":1'+"0".repeat(4096)+'e-4096}')).n,1,"large exact coefficient uses bounded significant digits");
  equal(read(await run('{"n":12345'+"0".repeat(4096)+'e-4100}')).n,1.2345,"large fractional coefficient uses bounded core and scale");
  equal(read(await run('{"n":0.'+"0".repeat(4096)+'12345e4096}')).n,0.12345,"leading fractional zeros do not consume retained significant digits");
  for(const raw of ['',"null","[]","true","{}{}",'{"a":1,}',"{a:1}",'{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"__proto__":{}}','{"x":{"constructor":{}}}','{"\\u202e":1}','{"":1}','{"a":"\\z"}','{"a":"unterminated}','{"a":[1,]}','{"a":"\u0000"}','\ufeff{}'])failed(await run(raw),"malformed_response");
  read(await run(JSON.stringify({a:"x".repeat(4096)})));failed(await run(JSON.stringify({a:"x".repeat(4097)})),"malformed_response");
  read(await run(JSON.stringify({["k".repeat(128)]:1})));failed(await run(JSON.stringify({["k".repeat(129)]:1})),"malformed_response");
  read(await run(JSON.stringify(Object.fromEntries(Array.from({length:64},(_,i)=>["k"+i,i])))));failed(await run(JSON.stringify(Object.fromEntries(Array.from({length:65},(_,i)=>["k"+i,i])))),"malformed_response");
  read(await run(JSON.stringify({a:Array(1000).fill(0)})));failed(await run(JSON.stringify({a:Array(1001).fill(0)})),"malformed_response");
  let deep={};for(let i=0;i<12;i++)deep={a:deep};read(await run(JSON.stringify(deep)));failed(await run(JSON.stringify({a:deep})),"malformed_response");
  const boundary={values:[]};let remaining=19998;while(remaining>0){const size=Math.min(1000,remaining-1);boundary.values.push(Array(size).fill(0));remaining-=size+1;}
  const valueCount=value=>value&&typeof value==="object"?1+Object.values(value).reduce((sum,item)=>sum+valueCount(item),0):1;
  equal(valueCount(boundary),20000);read(await run(JSON.stringify(boundary)));boundary.values.at(-1).push(0);equal(valueCount(boundary),20001);failed(await run(JSON.stringify(boundary)),"malformed_response");
  for(const raw of [[0xff],[0xc3,0x28],[0xe2,0x82]])failed(await run("",{}, {body:(async function*(){for(const byte of raw)yield new Uint8Array([byte]);})()}),"malformed_response");
  const utf8=bytes('{"unicode":"😀é","escaped":"\\u0061"}');const decoded=read(await run("",{}, {body:(async function*(){for(const byte of utf8)yield new Uint8Array([byte]);})()}));equal(decoded.unicode,"😀é");equal(decoded.escaped,"a");
}

async function fractionalSchemaCompatibility() {
  // Pinned SDK e4a5bf7 types/Coordinates.ts and serialization/types/Coordinates.ts
  // specify numbers, not integral fields. The existing Location projection strips
  // coordinates for privacy, but transport must preserve supported wire values.
  for(const coordinates of [{latitude:37.5,longitude:-122.25},{latitude:37.123456,longitude:-0.1}]) {
    const location=locationFixtures.squarePhase2B1ALocation({coordinates});
    for(const [path,response] of [["/v2/locations",{locations:[location]}],["/v2/locations/"+location.id,{location}]]) {
      const direct=locations.parseSquareLocationResponse(locationFixtures.squarePhase2B1AParserInput(response));equal(direct.outcome,"accepted");
      const decoded=read(await run(JSON.stringify(response),{request:request({url:"https://connect.squareupsandbox.com"+path})}));
      const decodedLocation=decoded.location??decoded.locations[0];
      equal(decodedLocation.coordinates.latitude,coordinates.latitude);equal(decodedLocation.coordinates.longitude,coordinates.longitude);
      const parsed=locations.parseSquareLocationResponse(locationFixtures.squarePhase2B1AParserInput(decoded));equal(parsed.outcome,"accepted");
      deepEqual(parsed,direct,"byte client does not change accepted Location projection");ok(!JSON.stringify(parsed).includes("coordinates"),"Location minimization still strips coordinates");
    }
  }
  for(const amount of [1000,1.5,0.1]) {
    const response={payment:paymentFixtures.squarePaymentFixture({amount_money:{amount,currency:"USD"}})};
    const decoded=read(await run(JSON.stringify(response)));
    equal(typeof decoded.payment.amount_money.amount,"number");equal(decoded.payment.amount_money.amount,amount);
    equal(payments.parseSquarePaymentResponse(paymentFixtures.squarePaymentParserInput(decoded)).outcome,amount===1000?"accepted":"rejected","Money still requires safe integral minor units");
  }
  for(const quantity of ["1.250",1.25,1]) {
    const order=orderFixtures.squarePhase2B2B1Order({line_items:[orderFixtures.squarePhase2B2B1CatalogLineItem({quantity})]});
    const decoded=read(await run(JSON.stringify({order}),{request:request({url:"https://connect.squareupsandbox.com/v2/orders/"+order.id})}));
    equal(decoded.order.line_items[0].quantity,quantity,"quantity type/value is not repaired by transport");
    equal(orderLines.parseSquareOrderLineItemResponse(orderFixtures.squarePhase2B2B1ParserInput(decoded)).outcome,typeof quantity==="string"?"accepted":"rejected","quantity remains the existing string-only contract");
  }
}

async function streamingBounds() {
  for(const [url,cap] of [["/v2/payments/P1",16*1024*1024],["/v2/orders/O1",64*1024*1024]]) {
    const req=request({url:"https://connect.squareupsandbox.com"+url});
    const block=new Uint8Array(64*1024).fill(32);
    const stream=extra=>(async function*(){for(let sent=0;sent<cap-block.length;sent+=block.length)yield block;const tail=block.slice();tail[tail.length-2]=123;tail[tail.length-1]=125;yield tail;if(extra)yield new Uint8Array([32]);})();
    const started=performance.now();read(await run("",{request:req},{body:stream(false)}));
    failed(await run("",{request:req},{headers:{"content-length":"1"},body:stream(true)}),"response_too_large");
    failed(await run("{}",{request:req},{headers:{"content-length":String(cap+1)}}),"response_too_large");
    console.log("Square bounded client byte boundary:",JSON.stringify({cap,elapsedMs:Math.round(performance.now()-started)}));
  }
  const original=bytes('{"a":1}');const entry=await run("",{}, {body:(async function*(){yield original;original.fill(32);})()});equal(read(entry).a,1,"transport reusing a chunk cannot alter already copied bytes");
  let overridden=0;const chunk=bytes('{"a":1}');Object.defineProperty(chunk,"byteLength",{get(){overridden++;throw Error(canary);}});Object.defineProperty(chunk,"buffer",{get(){overridden++;throw Error(canary);}});
  equal(read(await run("",{}, {body:(async function*(){yield chunk;})()})).a,1);equal(overridden,0,"intrinsic typed-array access bypasses overridden accessors");
}

async function cancellationAndFaults() {
  const pre=new AbortController();pre.abort();const cancelled=await run("{}",{signal:pre.signal});failed(cancelled,"cancelled");equal(cancelled.calls,0);equal(getEventListeners(pre.signal,"abort").length,0);
  await accelerated(async()=>{failed(await run("{}",{transport:never}),"deadline",500);});
  await accelerated(async()=>{failed(await run("{}",{}, {body:{[Symbol.asyncIterator](){return this;},next:never,return:never}}),"deadline",500);});
  await accelerated(async()=>{failed(await run("{}",{}, {cancel:never}),"deadline",500);});
  await accelerated(async()=>{
    let count=0;const body={[Symbol.asyncIterator](){return this;},async next(){return count++===0?{value:bytes("{}"),done:false}:{done:true};},return:never};
    failed(await run("",{}, {body}),"deadline",500);
  });
  await accelerated(async()=>{failed(await run("{}",{}, {body:{[Symbol.asyncIterator](){return this;},async next(){return {done:false,value:new Uint8Array(0)};},async return(){return {done:true};}}}),"deadline",500);});
  const signal=new AbortController();let bodyCancel=0;const late=run("{}",{signal:signal.signal},{body:{[Symbol.asyncIterator](){return this;},async next(){signal.abort();return never();},return:never},cancel(){bodyCancel++;}});failed(await late,"cancelled");equal(bodyCancel,1);equal(getEventListeners(signal.signal,"abort").length,0);
  await accelerated(async()=>{
    let resolve,cancel=0;const open=new Promise(done=>{resolve=done;});
    failed(await run("{}",{transport:()=>open}),"deadline",500);
    resolve(response(request().url,"{}",{cancel(){cancel++;}}));await new Promise(setImmediate);equal(cancel,1,"late-open response cleanup runs without holding the caller");
  });
  let traps=0,getters=0;const proxy=new Proxy({}, {getPrototypeOf(){traps++;throw Error(canary);},ownKeys(){traps++;return[];}});const revoked=Proxy.revocable({},{});revoked.revoke();
  for(const thrown of [Error(canary),proxy,revoked.proxy])failed(await run("{}",{transport:async()=>{throw thrown;}}),"transient",500);
  failed(await run("{}",{transport:async()=>proxy}),"malformed_response");
  // Native Promise resolution rejects a revoked value while probing then, before
  // a transport response exists; this is a payload-free transport failure.
  failed(await run("{}",{transport:async()=>revoked.proxy}),"transient",500);
  const accessor=response(request().url);Object.defineProperty(accessor,"url",{enumerable:true,get(){getters++;return request().url;}});failed(await run("{}",{transport:async()=>accessor}),"malformed_response");
  failed(await run("{}",{}, {body:proxy}),"malformed_response");
  failed(await run("{}",{}, {body:{[Symbol.asyncIterator](){return {get next(){getters++;return never;}};}}}),"malformed_response");
  equal(traps,0);equal(getters,0);
  const safe=await run("{}",{}, {cancel(){throw Error(canary);}});failed(safe,"transient",500);
  const cancelledCleanup=new AbortController();failed(await run("{}",{signal:cancelledCleanup.signal},{cancel(){cancelledCleanup.abort();}}),"cancelled");equal(getEventListeners(cancelledCleanup.signal,"abort").length,0);
}

async function main() {
  let logs=0,network=0;const originalFetch=global.fetch,originalWarn=console.warn,originalError=console.error,originalInfo=console.info;
  global.fetch=()=>{network++;throw Error("no live fallback");};console.warn=console.error=console.info=()=>{logs++;};
  try {await guards();await statusAndRetry();await exactJsonAndStructure();await fractionalSchemaCompatibility();await streamingBounds();await cancellationAndFaults();equal(network,0);equal(logs,0);}
  finally {global.fetch=originalFetch;console.warn=originalWarn;console.error=originalError;console.info=originalInfo;}
  console.log(`Square bounded ingestion client: ${assertions} assertions across ${scenarios} scenarios.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
