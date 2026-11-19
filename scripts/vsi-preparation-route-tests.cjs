/* eslint-disable @typescript-eslint/no-require-imports -- Credential-free actual route and scope regression. */
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {installLoader,id}=require('./qbo-customer-test-support.cjs');
installLoader({'server-only':{}});
const qualification=require('../lib/vsi/qualification.ts');
const scopeGuard=require('../lib/vsi/preparation-scope.ts');
const workspace=id(1), actor=id(2), question='Review my Clockify tracked hours and Katana inventory.';
let role='owner', auth=true, entitled=true, allowed=true, reads=0, bindings=0;
const now=Date.now(),scope={workspaceId:workspace,actorUserId:actor,questionHash:qualification.qualificationHash(question),startsAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()};
function set(value=scope){process.env.VERCEL_ENV='preview';process.env.VAEROEX_VSI_PREPARATION=JSON.stringify(value);}
class HttpError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const client={ownerSession:true};
const mocks={
 'server-only':{},'next/server':{NextResponse:{json:(v,o)=>Response.json(v,o)}},zod:require('zod'),
 './shared-preparation':{prepareVsiSharedEvidence:async(c,w,q)=>{assert.equal(c,client);assert.equal(w,workspace);assert.equal(q,question);reads++;return {window:{start:'2026-10-19',end:'2026-11-17'},prepared:{fingerprint:'f'.repeat(64),rows:[{provider:'clockify',hash:'a'.repeat(64),identity:{version:1},roots:[],facts:['private source text']},{provider:'katana',hash:'b'.repeat(64),identity:{version:2},roots:[]}],coverage:{},limitations:[]}};}},
 './preparation-scope':scopeGuard,'./retrieval':{authorizeVsiRead:async()=>({membership:{role}})},
 '@/lib/vsi/qualification':qualification,
 '@/lib/vsi/request-boundary':{readVsiJson:r=>r.json()},
 '@/lib/vsi/sensitive-input':{hasProhibitedVsiIdentifiers:()=>false},
 '@/lib/vsi/config':{getVsiConfig:()=>({maxQuestionChars:8000})},
 '@/lib/security/rate-limit':{enforceRateLimit:async()=>({allowed}),rateLimitMessage:()=> 'Limited'},
 '@/lib/integrations/google-sheets/read-authority':{beginGoogleSheetsRead:async()=>({ticketId:id(3)}),bindGoogleSheetsRead:async()=>{bindings++;}},
 '@/lib/vsi/engine':{runVsiAnswer:()=>{throw Error('generation forbidden');}},
 '@/lib/vsi/storage':{vsiUuid:require('zod').z.string().uuid(),questionHash:qualification.qualificationHash,VsiHttpError:HttpError,
 requireVsiAccess:async(r,w)=>{if(!auth)throw new HttpError(401,'auth','Sign in');if(w!==workspace)throw new HttpError(403,'workspace','Wrong workspace');if(!entitled)throw new HttpError(402,'plan','Plan');return {supabase:client,workspaceId:workspace,userId:actor};}}
};
const compiled=ts.transpileModule(fs.readFileSync(require.resolve('../lib/vsi/http.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('exports','require','module',compiled)(mod.exports,name=>{assert(Object.hasOwn(mocks,name),name);return mocks[name];},mod);
const call=(body={expectedWorkspaceId:workspace,question})=>mod.exports.vsiRoute(new Request('https://preview.test/api/vsi/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),'prepare');
(async()=>{
 set();const response=await call();assert.equal(response.status,200);const result=await response.json();assert.equal(result.sources.length,2);assert.equal(result.questionHash,scope.questionHash);assert.equal(result.sources[1].identity.version,2);assert(!JSON.stringify(result).includes('private source text'));assert.equal(bindings,2);
 const baseline=reads;
 auth=false;assert.equal((await call()).status,401);auth=true;
 assert.equal((await call({expectedWorkspaceId:id(99),question})).status,403);
 entitled=false;assert.equal((await call()).status,402);entitled=true;
 role='admin';assert.equal((await call()).status,403);role='owner';
 allowed=false;assert.equal((await call()).status,429);allowed=true;
 for(const change of [{actorUserId:id(99)},{workspaceId:id(99)},{questionHash:'c'.repeat(64)},{expiresAt:new Date(now-1).toISOString()},{expiresAt:new Date(now+7200001).toISOString()}]){set({...scope,...change});assert.equal((await call()).status,403);}
 set();process.env.VERCEL_ENV='production';assert.equal((await call()).status,403);set();delete process.env.VAEROEX_VSI_PREPARATION;assert.equal((await call()).status,403);assert.equal(reads,baseline);
 console.log('Preparation route passed: owner/session/workspace/plan/rate/scope/expiry/production denials; complete source metadata, no source text, same owner client, zero generation or reservation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
