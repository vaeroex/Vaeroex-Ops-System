/* eslint-disable @typescript-eslint/no-require-imports -- Compile production TypeScript for the Node test runner. */
const {test,after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");
const oldLoad = Module._load, oldTs = require.extensions[".ts"], oldFetch = global.fetch;
const routeMocks = {};
Module._load = function(name,parent,main) {
  if (name === "server-only") return {};
  if (name === "@/lib/integrations/wix-orders/server") return routeMocks.server;
  if (name === "@/lib/security/require-workspace-access") return {requireWorkspaceAccess:async()=>({workspaceId:"workspace",membership:{role:"owner"}})};
  if (name === "@/lib/integrations/date-range") return require("../lib/integrations/date-range.ts");
  return oldLoad.call(this,name,parent,main);
};
require.extensions[".ts"] = (module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,file);
const {recentOrders} = require("../lib/integrations/wix-orders/server.ts");
const connection = "44444444-4444-4444-8444-444444444444";
const start = "2020-01-01T00:00:00.000Z", end = "2020-02-01T00:00:00.000Z";
const order = (n=1,createdDate="2020-01-12T12:00:00Z")=>({id:`77777777-7777-4777-8777-${String(n).padStart(12,"0")}`,createdDate,status:"APPROVED",paymentStatus:"PAID",currency:"USD",priceSummary:{total:{amount:"12.50"}},buyerInfo:{email:"must-not-store@example.com"}});
const mock = responses=>{
  const calls=[];
  global.fetch=async(url,init)=>{calls.push({url,...init});assert.equal(init.redirect,"error");assert.equal(init.cache,"no-store");assert.ok(init.signal);if(!responses.length)throw Error("unexpected_request");const next=responses.shift();if(next instanceof Error)throw next;return next instanceof Response?next:Response.json(next);};
  return calls;
};
after(()=>{Module._load=oldLoad;require.extensions[".ts"]=oldTs;global.fetch=oldFetch;});

test("Wix reads historical approved orders with documented createdDate and cursor paging",async()=>{
  const calls=mock([{orders:[order()],metadata:{cursors:{next:"next-page"}}},{orders:[order(2)],metadata:{}}]);
  const facts=await recentOrders("synthetic-token",start,end);
  assert.equal(facts.length,2);assert.deepEqual(Object.keys(facts[0]).sort(),["created_at","currency_code","order_id","payment_status","total_amount"]);
  assert.doesNotMatch(JSON.stringify(facts),/buyer|email|must-not-store/);
  const body=JSON.parse(calls[0].body);
  assert.deepEqual(body.search.filter,{createdDate:{$gte:start,$lt:end},status:"APPROVED"});
  assert.equal(JSON.parse(calls[1].body).search.cursorPaging.cursor,"next-page");
  assert.equal(calls[0].url,"https://www.wixapis.com/ecom/v1/orders/search");
});

test("Wix refuses duplicates, out-of-range rows, malformed pages and cursor cycles",async()=>{
  mock([{orders:[order(),order()],metadata:{}}]);await assert.rejects(recentOrders("t",start,end),/window_invalid/);
  mock([{orders:[order(1,"2020-02-01T00:00:00Z")],metadata:{}}]);await assert.rejects(recentOrders("t",start,end),/window_invalid/);
  mock([{metadata:{}}]);await assert.rejects(recentOrders("t",start,end));
  mock([{orders:[order()]}]);await assert.rejects(recentOrders("t",start,end));
  mock([{orders:[],metadata:{hasNext:true}}]);await assert.rejects(recentOrders("t",start,end),/pagination_invalid/);
  mock([{orders:[],metadata:{cursors:{next:"a"}}},{orders:[],metadata:{cursors:{next:"b"}}},{orders:[],metadata:{cursors:{next:"a"}}}]);
  await assert.rejects(recentOrders("t",start,end),/pagination_invalid/);
  mock(Array.from({length:50},(_,n)=>({orders:[],metadata:{cursors:{next:`page-${n}`}}})));
  await assert.rejects(recentOrders("t",start,end),/too_many_orders/);
  mock([]);await assert.rejects(recentOrders("t",start,end,AbortSignal.abort()),/abort/i);
});

test("Wix excludes non-approved orders and rejects provider failure without a partial result",async()=>{
  mock([{orders:[{...order(),status:"CANCELED"}],metadata:{}}]);assert.deepEqual(await recentOrders("t",start,end),[]);
  mock([{orders:[order()],metadata:{cursors:{next:"next"}}},new Response("unavailable",{status:500})]);
  await assert.rejects(recentOrders("t",start,end),/provider_unavailable/);
});

function routeSetup({failure}={}) {
  const changes=[],applied=[],reads=[];
  const db={from:table=>{
    const chain={update:data=>{changes.push({table,data});return chain;},eq:()=>chain,or:()=>chain,select:()=>chain,
      maybeSingle:async()=>({data:{id:connection},error:null}),single:async()=>({data:{instance_ciphertext:"opaque"},error:null})};
    return chain;
  },rpc:async(name,args)=>{applied.push({name,args});return {error:null};}};
  routeMocks.server={assertOrigin:()=>{},requireOwner:()=>{},admin:()=>db,decryptInstance:()=>"instance",accessToken:async()=>"token",
    recentOrders:async(token,a,b,signal)=>{reads.push({token,a,b,signal});if(failure)throw failure;return [];} };
  delete require.cache[require.resolve("../app/api/integrations/wix-orders/sync/route.ts")];
  const {POST}=require("../app/api/integrations/wix-orders/sync/route.ts");
  const run=(fields={})=>POST(new Request("https://www.vaeroex.com/api/integrations/wix-orders/sync",{method:"POST",body:new URLSearchParams({connectionId:connection,...fields})}));
  return {run,changes,applied,reads};
}

test("Wix route validates dates before lease and passes old selected range to one atomic apply",async()=>{
  const a=routeSetup();const response=await a.run({startDate:"2020-01-01",endDate:"2020-01-31"});
  assert.match(response.headers.get("location"),/result=synced/);assert.equal(a.applied.length,1);
  assert.equal(a.applied[0].args.p_window_start,start);assert.equal(a.applied[0].args.p_window_end,end);
  assert.equal(a.applied[0].args.p_workspace_id,"workspace");assert.equal(a.applied[0].args.p_connection_id,connection);
  assert.ok(a.reads[0].signal instanceof AbortSignal);
  const b=routeSetup();assert.match((await b.run({startDate:"2020-01-01"})).headers.get("location"),/invalid_range/);
  assert.equal(b.changes.length,0);assert.equal(b.reads.length,0);assert.equal(b.applied.length,0);
});

test("Wix route preserves saved history on failed or oversized fetch and only releases lease",async()=>{
  for(const failure of [new Error("wix_provider_unavailable"),new Error("wix_too_many_orders"),new DOMException("timed out","TimeoutError")]) {
    const a=routeSetup({failure});const response=await a.run({startDate:"2020-01-01",endDate:"2020-01-31"});
    assert.match(response.headers.get("location"),/result=(error|range_too_large)/);
    assert.equal(a.applied.length,0);assert.equal(a.changes.length,2);
    assert.deepEqual(a.changes[1],{table:"wix_order_connections",data:{sync_lease_id:null,sync_lease_expires_at:null,last_error_code:"sync_failed"}});
  }
});
