import "server-only";

import { isProxy, isUint8Array } from "node:util/types";
import type { ContractJsonValue } from "@/lib/integrations/contracts/primitives";
import type {
  SquareBoundedReadInput, SquareReadFailureCode, SquareReadOutcome,
  SquareSyntheticTransport, SquareSyntheticTransportResponse
} from "@/lib/integrations/providers/square/ingestion-contracts";
import { assertSquareReadOperation, type SquareReadOperationAuthorizationInput, type SquareReadOperationDecision } from "@/lib/integrations/providers/square/request-validators";

export const SQUARE_BOUNDED_READ_DEADLINE_MS = 30_000;
const MAXIMUM_BYTES = 64 * 1024 * 1024;
const DECODE_BLOCK_BYTES = 64 * 1024;
const MAXIMUM_ATTEMPTS = 3;
const MAXIMUM_RETRY_AFTER_MS = 60_000;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const arrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;

// Resource derivation, before implementation: one attempt and one 30s deadline,
// including open/body/cleanup. Policy response bytes are 16 or 64MiB. A single
// 64KiB staging buffer copies incoming bytes; at most 1,024 full decoded strings
// plus a final fragment are retained, never an unbounded list of tiny chunks.
// UTF16 decoded text is <=2*byteCap bytes, join <=another2*byteCap; parsed strings
// are bounded by that text plus <=20,000 nodes. No BigInt of unbounded tokens.
// JSON allocation itself enforces the existing raw20k/depth12/array1000/props64/
// key128/string4096 bounds before downstream schema, hashing or freezing.
// Numeric scanning is linear in wire text and uses <=17 retained significant
// digits (the maximum needed by Number's shortest decimal representation). After
// stripping trailing zeros, only a <=40-character scientific token is converted.
// Its exact decimal core/scale must match Number.toString(): ordinary fractional
// coordinates survive, but precision loss/underflow/unsafe integers never do.
// The injected I/O must be asynchronous/cooperative: JavaScript cannot preempt
// an injected synchronous infinite loop. Hanging promises do not extend our wait.
// Sequential waits retain only one cancellation callback, cleared on settlement;
// tiny/empty chunks cannot accumulate reactions on a shared pending promise.
// Each decoded string uses <=4,097 temporary character slots and one join,
// avoiding retained per-character concatenation chains in the accepted graph.
const failures = new Map<object, SquareReadFailureCode>();
const failureTokens = Object.fromEntries(([
  "authorization", "rate_limited", "transient", "malformed_response", "provider_error",
  "redirect_denied", "destination_denied", "response_too_large", "deadline", "cancelled", "request_denied"
] as const).map(code => { const token=Object.freeze({}); failures.set(token,code); return [code,token]; })) as Record<SquareReadFailureCode, object>;
function fail(code: SquareReadFailureCode): never { throw failureTokens[code]; }
const failure = (code: SquareReadFailureCode, retryAfterMs: number | null = null): SquareReadOutcome => Object.freeze({outcome:"failed",code,retryAfterMs});

export async function readSquareBoundedResponse(input: SquareBoundedReadInput): Promise<SquareReadOutcome> {
  const started = Date.now();
  let request: SquareReadOperationAuthorizationInput;
  let decision: SquareReadOperationDecision;
  let transport: SquareSyntheticTransport;
  let externalSignal: AbortSignal | undefined;
  let attempt: number;
  try {
    const top = dataRecord(input, 6);
    if (top.syntheticCredential !== "square-synthetic-fixture" || typeof top.transport !== "function" || isProxy(top.transport) ||
        !Number.isSafeInteger(top.attempt) || Number(top.attempt)<1 || Number(top.attempt)>MAXIMUM_ATTEMPTS) fail("request_denied");
    if (top.signal !== undefined && (isProxy(top.signal) || typeof signalAborted.call(top.signal)!=="boolean")) fail("request_denied");
    transport=top.transport as SquareSyntheticTransport; externalSignal=top.signal as AbortSignal | undefined; attempt=Number(top.attempt);
    request = safeRequest(top.request);
    if(request.retryAttempt!==undefined&&request.retryAttempt.attempt!==attempt) fail("request_denied");
    decision = assertSquareReadOperation(request);
    if (decision.maximumResponseBytes > MAXIMUM_BYTES || decision.timeoutMs !== SQUARE_BOUNDED_READ_DEADLINE_MS) fail("request_denied");
    if(attempt>1&&decision.retryClassification!=="idempotent_read_with_backoff") fail("request_denied");
  } catch { return failure("request_denied"); }

  const controller = new AbortController();
  let stopped: "deadline" | "cancelled" | null = null;
  let rejectWait: ((reason: object) => void) | null = null;
  const end = (code: "deadline" | "cancelled") => {
    if (stopped !== null) return;
    stopped=code; controller.abort(); rejectWait?.(failureTokens[code]);
  };
  const onAbort = () => end("cancelled");
  const timer=setTimeout(() => end("deadline"),Math.max(0,decision.timeoutMs-(Date.now()-started)));
  if(externalSignal) EventTarget.prototype.addEventListener.call(externalSignal,"abort",onAbort,{once:true});
  if (externalSignal && signalAborted.call(externalSignal)) end("cancelled");
  const check = () => {
    if (stopped !== null) fail(stopped);
    if (externalSignal && signalAborted.call(externalSignal)) { end("cancelled"); fail("cancelled"); }
    if (Date.now()-started>=decision.timeoutMs) { end("deadline"); fail("deadline"); }
  };
  const wait = <T>(promise: Promise<T>) => new Promise<T>((resolve,reject) => {
    // There is exactly one sequential open/body/yield/cleanup wait. A shared
    // Promise.race stop operand would retain a reaction for every tiny chunk.
    const clear = () => { if(rejectWait===onStop) rejectWait=null; };
    const onStop = (reason: object) => { clear(); reject(reason); };
    // Always observe both outcomes, even after stopping, so late I/O rejection
    // is contained. Identity prevents late I/O from clearing a newer waiter.
    promise.then(value=>{clear();resolve(value);},error=>{clear();reject(error);});
    if(stopped!==null) onStop(failureTokens[stopped]);
    else rejectWait=onStop;
  });
  let response: SquareSyntheticTransportResponse | null = null;
  let iterator: AsyncIterator<Uint8Array> | null = null;
  let finished=false;
  let retryHeader: string | undefined;
  let result: SquareReadOutcome = failure("transient");
  const cleanup = async (candidate: SquareSyntheticTransportResponse, bodyIterator: AsyncIterator<Uint8Array> | null) => {
    const operations: Promise<unknown>[]=[];
    const cancel=dataRecord(candidate,64).cancel;
    if (typeof cancel==="function" && !isProxy(cancel)) operations.push(Promise.resolve().then(()=>cancel.call(candidate)));
    else fail("malformed_response");
    if (bodyIterator) {
      const close=dataMethod(bodyIterator,"return",false);
      if (close) operations.push(Promise.resolve().then(()=>close.call(bodyIterator)));
    }
    const outcomes=await Promise.allSettled(operations);
    if (outcomes.some(item=>item.status==="rejected")) fail("transient");
  };
  try {
    check();
    const headers: Record<string,string> = {
      "Square-Version": decision.squareVersion, Accept:"application/json",
      Authorization:"Bearer square-synthetic-fixture"
    };
    if (decision.contentType !== null) headers["Content-Type"]=decision.contentType;
    const open=Promise.resolve().then(()=>transport(Object.freeze({
      method:decision.method,url:request.url,headers:Object.freeze(headers),body:typeof request.body==="string"?request.body:null,
      redirect:"manual",signal:controller.signal
    }))).then(value=>{
      if(finished) void cleanup(value,null).catch(()=>undefined);
      else response=value;
      return value;
    });
    response=await wait(open);
    check();
    const meta=dataRecord(response,64);
    if (!Number.isSafeInteger(meta.status) || Number(meta.status)<100 || Number(meta.status)>599 ||
        typeof meta.url!=="string" || meta.url.length>64*1024 || typeof meta.redirected!=="boolean") fail("malformed_response");
    if (meta.redirected || Number(meta.status)>=300 && Number(meta.status)<400) fail("redirect_denied");
    if (meta.url!==request.url) fail("destination_denied");
    const responseHeaders=headerRecord(meta.headers,false);
    retryHeader=responseHeaders["retry-after"];
    const status=Number(meta.status);
    if(status===401||status===403) fail("authorization");
    if(status===429) fail("rate_limited");
    if(status===408||status>=500) fail("transient");
    if(status<200||status>=300) fail("provider_error");
    const contentType=responseHeaders["content-type"];
    if(contentType!==undefined&&!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)) fail("malformed_response");
    const declaredLength=responseHeaders["content-length"];
    if(declaredLength!==undefined) {
      if(!/^(?:0|[1-9][0-9]*)$/.test(declaredLength)) fail("malformed_response");
      if(declaredLength.length>String(decision.maximumResponseBytes).length || Number(declaredLength)>decision.maximumResponseBytes) fail("response_too_large");
    }
    const body=meta.body;
    const makeIterator=dataMethod(body,Symbol.asyncIterator,true)!;
    iterator=makeIterator.call(body) as AsyncIterator<Uint8Array>;
    const next=dataMethod(iterator,"next",true)!;
    const decoder=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true});
    const decode=(bytes?: Uint8Array, stream=false) => {
      try { return decoder.decode(bytes,{stream}); } catch { return fail("malformed_response"); }
    };
    const staging=new Uint8Array(DECODE_BLOCK_BYTES);
    const textParts: string[]=[];
    let used=0,total=0,chunks=0;
    while(true) {
      check();
      const step=dataRecord(await wait(Promise.resolve().then(()=>next.call(iterator))),2);
      if(typeof step.done!=="boolean") fail("malformed_response");
      if(step.done) break;
      const chunk=step.value;
      if(isProxy(chunk)||!isUint8Array(chunk)) fail("malformed_response");
      const length=byteLength.call(chunk) as number;
      if(length>decision.maximumResponseBytes-total) fail("response_too_large");
      total+=length;
      let offset=0;
      while(offset<length) {
        check();
        const take=Math.min(length-offset,DECODE_BLOCK_BYTES-used);
        const view=new Uint8Array(arrayBuffer.call(chunk),Number(byteOffset.call(chunk))+offset,take);
        staging.set(view,used);used+=take;offset+=take;
        if(used===DECODE_BLOCK_BYTES) {textParts.push(decode(staging,true));used=0;}
      }
      // Immediate/empty synthetic chunks cannot starve cancellation timers forever.
      if(++chunks%64===0) await wait(new Promise<void>(resolve=>setImmediate(resolve)));
    }
    textParts.push(decode(staging.subarray(0,used),true),decode());
    check();
    const value=decodeBoundedJson(textParts.join(""),check);
    const errors=value.errors;
    if(errors!==undefined&&errors!==null) {
      if(!Array.isArray(errors)||errors.length>100||errors.some(item=>item===null||typeof item!=="object"||Array.isArray(item))) fail("malformed_response");
      if(errors.length>0) fail("provider_error");
    }
    result=Object.freeze({outcome:"read",response:value,decision:Object.freeze(decision)});
  } catch(error) {
    const code=typeof error==="object"&&error!==null?failures.get(error)??"transient":"transient";
    // Decoder and shape exceptions are classified without exposing message/body.
    result=failure(code,retryPlan(code,attempt,decision,retryHeader));
  } finally {
    finished=true;
    controller.abort();
    if(response!==null) {
      try { await wait(cleanup(response,iterator)); check(); }
      catch(error) {
        const code=stopped??(typeof error==="object"&&error!==null?failures.get(error)??"transient":"transient");
        // Cleanup cannot turn a definitive authorization/redirect/provider failure
        // into a retryable error. A successful read is not delivered if cleanup
        // itself fails or runs past the overall deadline.
        if(result.outcome==="read") result=failure(code,retryPlan(code,attempt,decision,retryHeader));
      }
    }
    clearTimeout(timer);
    if(externalSignal) EventTarget.prototype.removeEventListener.call(externalSignal,"abort",onAbort);
  }
  return result;
}

function retryPlan(code: SquareReadFailureCode, attempt: number, decision: SquareReadOperationDecision, header?: string) {
  if(attempt>=MAXIMUM_ATTEMPTS||decision.retryClassification!=="idempotent_read_with_backoff"||!(code==="rate_limited"||code==="transient"||code==="deadline")) return null;
  const baseline=500*2**(attempt-1);
  if(header===undefined) return baseline;
  let delay: number;
  if(/^[0-9]+$/.test(header.trim())) delay=Number(header.trim())*1000;
  else {const parsed=Date.parse(header);if(!Number.isFinite(parsed)) return baseline;delay=Math.max(0,parsed-Date.now());}
  // A provider delay above our retry planning horizon is NOT clamped early.
  if(!Number.isFinite(delay)||delay>MAXIMUM_RETRY_AFTER_MS) return null;
  return Math.max(baseline,delay);
}

function dataRecord(value: unknown, maximum: number): Record<string,unknown> {
  if(value===null||typeof value!=="object"||isProxy(value)||Array.isArray(value)) fail("malformed_response");
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null) fail("malformed_response");
  const keys=Reflect.ownKeys(value);if(keys.length>maximum) fail("malformed_response");
  const result: Record<string,unknown>=Object.create(null);
  for(const key of keys) {
    if(typeof key!=="string"||key.length>128) fail("malformed_response");
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor?.enumerable||!("value" in descriptor)) fail("malformed_response");
    result[key]=descriptor.value;
  }
  return result;
}
function dataMethod(value: unknown, key: string|symbol, required: boolean): ((...args:unknown[])=>unknown)|null {
  if(value===null||typeof value!=="object"||isProxy(value)) fail("malformed_response");
  let current: object|null=value;
  for(let depth=0;current!==null&&depth<8;depth++) {
    if(isProxy(current)) fail("malformed_response");
    const descriptor=Object.getOwnPropertyDescriptor(current,key);
    if(descriptor) {
      if(!("value" in descriptor)||typeof descriptor.value!=="function"||isProxy(descriptor.value)) fail("malformed_response");
      return descriptor.value;
    }
    current=Object.getPrototypeOf(current);
  }
  if(required) fail("malformed_response");return null;
}
function headerRecord(value: unknown, request: boolean): Record<string,string> {
  const source=dataRecord(value,64),result: Record<string,string>=Object.create(null);
  for(const [key,raw] of Object.entries(source)) {
    let value=raw;
    // The existing request policy also permits one-element header arrays. Read
    // their sole data descriptor without evaluating accessors or custom members.
    if(request&&!isProxy(value)&&Array.isArray(value)) {
      const element=Object.getOwnPropertyDescriptor(value,"0");
      const length=Object.getOwnPropertyDescriptor(value,"length");
      if(Object.getPrototypeOf(value)!==Array.prototype||Reflect.ownKeys(value).length!==2||!length||!("value" in length)||length.value!==1||!element?.enumerable||!("value" in element))fail("request_denied");
      value=element.value;
    }
    const name=key.toLowerCase();
    if(typeof value!=="string"||value.length>4096||! /^[A-Za-z0-9-]+$/.test(key)||/[\r\n]/.test(value)||Object.hasOwn(result,name)) fail("malformed_response");
    if(request&&!(["square-version","content-type","accept"].includes(name))) fail("request_denied");
    if(request&&name==="accept"&&value!=="application/json") fail("request_denied");
    result[name]=value;
  }
  return result;
}
function safeRequest(value: unknown): SquareReadOperationAuthorizationInput {
  const source=dataRecord(value,9);
  if(Object.keys(source).some(key=>!["providerKey","providerEnvironment","method","url","headers","body","expectedCursorBindingFingerprint","retryAttempt"].includes(key))) fail("request_denied");
  for(const key of ["providerKey","providerEnvironment","method","url"])if(typeof source[key]!=="string"||String(source[key]).length>64*1024)fail("request_denied");
  let body=source.body;
  if(body!==undefined&&body!==null) {
    if(typeof body!=="string") {
      if(isProxy(body)||!isUint8Array(body)||byteLength.call(body)>32*1024)fail("request_denied");
      const view=new Uint8Array(arrayBuffer.call(body),Number(byteOffset.call(body)),Number(byteLength.call(body)));
      body=new TextDecoder("utf-8",{fatal:true}).decode(view);
    }
    if(Buffer.byteLength(body as string,"utf8")>32*1024)fail("request_denied");
    // Existing request policy then checks exact allowed semantics. Decode first
    // so JSON.parse inside that policy cannot hide duplicated/rounded numbers.
    if(body===""&&source.method==="GET") body=null;
    else decodeBoundedJson(body as string,()=>undefined);
  }
  const retry=source.retryAttempt===undefined?undefined:dataRecord(source.retryAttempt,2);
  return {...source,headers:headerRecord(source.headers,true),body,retryAttempt:retry} as SquareReadOperationAuthorizationInput;
}

function decodeBoundedJson(text: string, check:()=>void): Readonly<Record<string,ContractJsonValue>> {
  let index=0,values=0;
  const tick=()=>{if(index%4096===0)check();};
  const whitespace=()=>{while(index<text.length&&/^[\t\n\r ]$/.test(text[index])){index++;tick();}};
  const string=(maximum:number) => {
    if(text[index++]!=='"')fail("malformed_response");
    const result:string[]=[];
    while(index<text.length) {
      tick();let character=text[index++];
      if(character==='"')return result.join("");
      if(character==="\\") {
        const escaped=text[index++];
        if(escaped==="u") {const hex=text.slice(index,index+4);if(!/^[0-9a-fA-F]{4}$/.test(hex))fail("malformed_response");character=String.fromCharCode(parseInt(hex,16));index+=4;}
        else {const escapes:Record<string,string>={'"':'"',"\\":"\\","/":"/",b:"\b",f:"\f",n:"\n",r:"\r",t:"\t"};if(!Object.hasOwn(escapes,escaped))fail("malformed_response");character=escapes[escaped];}
      } else if(character.charCodeAt(0)<32)fail("malformed_response");
      result.push(character);if(result.length>maximum)fail("malformed_response");
    }
    return fail("malformed_response");
  };
  const number=()=>{
    const negative=text[index]==="-";if(negative)index++;
    let prefix="",significant=0,trailingZeros=0,fraction=0;
    const digit=()=>{
      const char=text[index++];
      if(char!=="0"||significant>0) {significant++;if(prefix.length<17)prefix+=char;trailingZeros=char==="0"?trailingZeros+1:0;}
      tick();
    };
    if(text[index]==="0")digit();
    else {if(!/[1-9]/.test(text[index]??""))fail("malformed_response");while(/[0-9]/.test(text[index]??""))digit();}
    if(text[index]===".") {index++;if(!/[0-9]/.test(text[index]??""))fail("malformed_response");while(/[0-9]/.test(text[index]??"")){digit();fraction++;}}
    let exponent=0;
    if(text[index]==="e"||text[index]==="E") {
      index++;const sign=text[index]==="-"?-1:1;if(text[index]==="-"||text[index]==="+")index++;
      if(!/[0-9]/.test(text[index]??""))fail("malformed_response");
      while(/[0-9]/.test(text[index]??"")){exponent=Math.min(MAXIMUM_BYTES+17,exponent*10+Number(text[index++]));tick();}exponent*=sign;
    }
    if(significant===0){if(negative)fail("malformed_response");return 0;}
    const core=significant-trailingZeros,scale=exponent-fraction+trailingZeros;
    if(core>17)fail("malformed_response");
    const digits=prefix.slice(0,core);
    const result=Number((negative?"-":"")+digits+"e"+scale);
    if(!Number.isFinite(result)||Math.abs(result)>Number.MAX_SAFE_INTEGER||result===0)fail("malformed_response");
    // This normalizes decimal rational values, not their binary expansion: 0.1
    // is supported, while 0.10000000000000001 may not silently become 0.1. All
    // strings inspected here come from bounded Number.toString(), not wire text.
    const representation=Math.abs(result).toString();
    const [coefficient,power="0"]=representation.split("e");
    const point=coefficient.indexOf(".");
    const decimalPlaces=point<0?0:coefficient.length-point-1;
    const coefficientDigits=coefficient.replace(".","").replace(/^0+/,"");
    const normalizedDigits=coefficientDigits.replace(/0+$/,"");
    const normalizedScale=Number(power)-decimalPlaces+coefficientDigits.length-normalizedDigits.length;
    if(digits!==normalizedDigits||scale!==normalizedScale)fail("malformed_response");
    return result;
  };
  const value=(depth:number):ContractJsonValue=>{
    check();if(++values>20_000||depth>12)fail("malformed_response");whitespace();
    const char=text[index];
    if(char==='"')return string(4096);
    if(char==="{"||char==="[") {
      index++;whitespace();
      if(char==="[") {
        const result:ContractJsonValue[]=[];
        if(text[index]==="]"){index++;Object.freeze(result);return result;}
        while(true){if(result.length>=1000)fail("malformed_response");result.push(value(depth+1));whitespace();if(text[index++]==="]")break;if(text[index-1]!==",")fail("malformed_response");}
        Object.freeze(result);return result;
      }
      const result:Record<string,ContractJsonValue>=Object.create(null);let properties=0;
      if(text[index]==="}"){index++;return Object.freeze(result);}
      while(true) {
        whitespace();if(++properties>64)fail("malformed_response");const key=string(128);
        if(key.length<1||/[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u.test(key)||["__proto__","prototype","constructor"].includes(key)||Object.hasOwn(result,key))fail("malformed_response");
        whitespace();if(text[index++]!==":")fail("malformed_response");result[key]=value(depth+1);whitespace();
        const separator=text[index++];if(separator==="}")break;if(separator!==",")fail("malformed_response");
      }
      return Object.freeze(result);
    }
    for(const [literal,result] of [["true",true],["false",false],["null",null]] as const)if(text.startsWith(literal,index)){index+=literal.length;return result;}
    if(char==="-"||/[0-9]/.test(char??""))return number();
    return fail("malformed_response");
  };
  const result=value(0);whitespace();if(index!==text.length||result===null||typeof result!=="object"||Array.isArray(result))fail("malformed_response");
  return result as Readonly<Record<string,ContractJsonValue>>;
}
