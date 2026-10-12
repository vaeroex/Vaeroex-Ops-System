/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS harness exercises actual security helpers. */
// Actual TypeScript helpers with synthetic Supabase responses. No network/env.
const assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path"), Module=require("node:module"), ts=require("typescript");
const root=path.resolve(__dirname,".."); let auditClient=null, readOnlyClient=null;
const subscription={allowed:true,plan:{slug:"synthetic",max_ai_runs_per_month:1,max_files:1},source:"subscription",stripe_customer_id:"cus_synthetic"};
const resolve=Module._resolveFilename, load=Module._load;
require.extensions[".ts"]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX},fileName:f}).outputText,f);
require.extensions[".tsx"]=require.extensions[".ts"];
Module._resolveFilename=function(r,p,i,o){return resolve.call(this,r.startsWith("@/")?path.join(root,r.slice(2)):r,p,i,o);};
Module._load=function(r,p,i){
  if(r==="server-only") return {};
  if(r==="@/lib/supabase/admin") return {createSupabaseAdminClient:()=>auditClient};
  if(r==="@/lib/billing/get-subscription-status") return {getSubscriptionStatus:async()=>subscription};
  if(r==="@/lib/supabase/server") return {createSupabaseServerClient:async()=>readOnlyClient};
  if(r==="@/lib/workspaces/current") return {getWorkspaceContext:async()=>({activeWorkspace:{id:"11111111-1111-4111-8111-111111111111"}})};
  return load.call(this,r,p,i);
};
const usage=require(path.join(root,"lib/billing/usage-limits.ts"));
const gateway=require(path.join(root,"lib/security/tool-execution-gateway.ts"));
const results=[];
function client(response={count:0,error:null}) {
  const queries=[],inserts=[];
  return {queries,inserts,from(table){const q={table,filters:[]};queries.push(q);const chain={
    select(){return chain;},eq(k,v){q.filters.push([k,v]);return chain;},gte(k,v){q.filters.push([k,v]);return chain;},is(k,v){q.filters.push([k,v]);return chain;},
    insert(row){inserts.push(row);q.insert=true;return chain;},then(yes,no){return Promise.resolve(q.insert?{error:null}:response).then(yes,no);}
  };return chain;}};
}
async function test(name,fn){await fn();results.push({name,status:"pass"});}
(async()=>{
  const context={workspaceId:"11111111-1111-4111-8111-111111111111",userId:"22222222-2222-4222-8222-222222222222"};
  for(const [name,response] of [
    ["SQL count error",{count:null,error:{message:"synthetic private SQL detail"}}],
    ["missing count",{count:null,error:null}],
    ["negative count",{count:-1,error:null}],
    ["invalid count",{count:NaN,error:null}]
  ]) await test(`${name} blocks generic and AI quota preflights`,async()=>{
    await assert.rejects(usage.isUsageLimitReached({...context,supabase:client(response),limit:"files"}),/Workspace usage could not be verified/);
    await assert.rejects(usage.isAiRunUsageLimitReached({workspaceId:context.workspaceId,subscription,supabase:client(response)}),/Workspace usage could not be verified/);
  });
  await test("known zero remains zero, known final count reaches limit",async()=>{
    assert.equal((await usage.isAiRunUsageLimitReached({workspaceId:context.workspaceId,subscription,supabase:client()})).reached,false);
    assert.equal((await usage.isAiRunUsageLimitReached({workspaceId:context.workspaceId,subscription,supabase:client({count:1,error:null})})).reached,true);
  });
  await test("missing workspace/user context uses intentional empty snapshot without queries",async()=>{
    const db=client(); assert.deepEqual(await usage.getUsageSnapshot({supabase:db}),{workspaces:0,users:0,forms:0,checklists:0,ai_runs_this_month:0,files:0}); assert.equal(db.queries.length,0);
  });
  await test("preflight remains advisory; atomicity belongs to database trigger",async()=>{
    const values=await Promise.all(Array.from({length:16},()=>usage.isAiRunUsageLimitReached({workspaceId:context.workspaceId,subscription,supabase:client()})));
    assert.equal(values.filter(v=>!v.reached).length,16);
  });
  const caller={from(){throw new Error("Caller client must not read or write trusted audit evidence");}};
  const toolContext={...context,supabase:caller,userRole:"owner"};
  const request={toolName:"delete_record",args:{recordId:"33333333-3333-4333-8333-333333333333"},initiatedBy:"user",confirmationReceived:true};
  await test("trusted service client handles audit writes and scoped trusted count",async()=>{
    auditClient=client(); const decision=await gateway.evaluateToolExecution(toolContext,request);assert.equal(decision.allowed,true);assert.equal(auditClient.inserts.length,1);
    const filters=auditClient.queries[0].filters;for(const pair of [["workspace_id",context.workspaceId],["user_id",context.userId],["server_recorded",true],["allowed",false]])assert.ok(filters.some(p=>JSON.stringify(p)===JSON.stringify(pair)));
    await gateway.logSecurityAuditEvent({supabase:caller,workspaceId:context.workspaceId,userId:context.userId,actionName:"synthetic",operationType:"READ",initiatedBy:"user",allowed:true});assert.equal(auditClient.inserts.length,2);
  });
  await test("missing audit credential fails closed",async()=>{auditClient=null;assert.equal((await gateway.evaluateToolExecution(toolContext,request)).allowed,false);});
  await test("audit count failure fails closed without raw details",async()=>{
    auditClient=client({count:null,error:{message:"private database detail"}});const d=await gateway.evaluateToolExecution(toolContext,request);assert.equal(d.allowed,false);assert.doesNotMatch(d.reasonBlocked,/private database detail/);
  });
  await test("trusted blocked-event threshold rejects mutation",async()=>{auditClient=client({count:12,error:null});assert.equal((await gateway.evaluateToolExecution(toolContext,request)).allowed,false);});
  await test("confirmation remains required after trusted writer change",async()=>{auditClient=client();assert.equal((await gateway.evaluateToolExecution(toolContext,{...request,confirmationReceived:false})).allowed,false);});
  await test("billing recovery stays visible when usage is unknown",async()=>{
    readOnlyClient={...client({count:null,error:{message:"synthetic database failure"}}),auth:{getUser:async()=>({data:{user:{id:context.userId,email:"synthetic@example.invalid"}}})}};
    const page=require(path.join(root,"app/app/account/subscription/page.tsx")).default;
    const rendered=JSON.stringify(await page({}),(key,value)=>key==="type"||key==="_owner"?undefined:value);
    assert.match(rendered,/Manage billing/);assert.match(rendered,/Current usage is temporarily unavailable/);assert.doesNotMatch(rendered,/synthetic database failure/);
  });
  await test("subscription status API returns explicit unavailable response",async()=>{
    const route=require(path.join(root,"app/api/subscription/status/route.ts"));const response=await route.GET();assert.equal(response.status,503);assert.equal((await response.json()).ok,false);
  });
  console.log(JSON.stringify({scope:"actual helper logic with synthetic database responses; no HTTP/provider calls",results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
