const assert=require("node:assert/strict");
const {React,renderToStaticMarkup}=require("./square-account-browser-test-support.js").loadSquareBrowserModules();
const {SquareEvidenceCard}=require("../components/integrations/SquareEvidenceCard.tsx");
const {parseSquareWorkspaceEvidence}=require("../lib/integrations/providers/square/workspace-evidence.ts");
const {readSquareWorkspaceEvidence}=require("../lib/integrations/control-plane/square-workspace-evidence.ts");
const time="2026-09-11T22:00:56.232Z";
const counts={payment:1,refund:1,order:3,catalog:2,inventory:6};
const view={version:"square_workspace_evidence_v1",source:"Square Sandbox",status:"verified_non_economic",policy:"square_canonical_interpretation_v1",
  counts,relationships:{unresolvedLocation:2,conflict:1,idMatch:7,otherUncertain:0},historical:"unknown",economic:"blocked",checkpointRevision:1,
  interpretedAt:time,lastObservedAt:time,checkedAt:time,syncStatus:"unknown",
  provenance:Object.entries(counts).flatMap(([kind,n])=>Array.from({length:n},()=>({kind,sourceVersion:1,observedAt:time,scope:kind==="catalog"?"seller_with_location_applicability":"mapped_location_or_explicitly_unresolved"})))};
const render=x=>renderToStaticMarkup(React.createElement(SquareEvidenceCard,{evidence:x}));
async function main(){
  const {withoutSquareQualificationPaths}=require("./square-dormant-scope-test-support.js");
  assert.equal(withoutSquareQualificationPaths("app/app/settings/page.tsx\ncomponents/integrations/SquareEvidenceCard.tsx\nlib/supabase/types.ts\nsupabase/migrations/20260911222230_square_workspace_evidence.sql"),"");
  for(const path of ["app/api/unapproved/route.ts","components/integrations/Unapproved.tsx","supabase/migrations/unapproved.sql","lib/supabase/admin.ts","services/external-integrations-qbo/src/server.ts"])
    assert.equal(withoutSquareQualificationPaths(path),path,"unrelated scope remains denied");
  assert.deepEqual(parseSquareWorkspaceEvidence(view),view);
  const html=render(view);
  for(const copy of ["Square Sandbox","Verified, non-economic","1 reference conflict","2 unresolved location relationships","Historical completeness: unknown","No revenue, profit, netting, inventory valuation, stock calculation","Current sync health: unknown","Source-version provenance"])assert.ok(html.includes(copy),copy);
  assert.equal((html.match(/<tbody>.*<\/tbody>/)?.[0].match(/<tr>/g)||[]).length,13);
  assert.ok(!/<form|<button|<script|<input|https:\/\//.test(html));
  for(const value of [null,{...view,source:"Square Production"},{...view,economic:"enabled"},{...view,historical:"complete"},{...view,syncStatus:"healthy"},
    {...view,counts:{...counts,payment:2}},{...view,provenance:view.provenance.slice(1)},
    {...view,rawPayload:"SECRET_SENTINEL"},{...view,privateCursor:"SECRET_SENTINEL"},{...view,credential:"SECRET_SENTINEL"},
    {...view,interpretedAt:"2099-01-01T00:00:00Z"}, {...view,provenance:[{...view.provenance[0],providerId:"SECRET_SENTINEL"},...view.provenance.slice(1)]},
    {...view,relationships:{...view.relationships,conflict:-1}},{...view,source:"<script>SECRET_SENTINEL</script>"}]){
    assert.equal(parseSquareWorkspaceEvidence(value),null);assert.equal(render(value),"");
  }
  const workspace="10000000-0000-4000-8000-000000000001";let calls=0;
  const client={rpc:async(name,args)=>{calls++;assert.equal(name,"read_square_workspace_evidence_v1");assert.deepEqual(args,{p_workspace_id:workspace});return {data:view,error:null};}};
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;delete process.env.NEXT_PUBLIC_APP_URL;
  assert.equal(await readSquareWorkspaceEvidence(client,workspace),null);assert.equal(calls,0);
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://oysjpoondtcrqpghhrbd.supabase.co";
  process.env.NEXT_PUBLIC_APP_URL="https://square-sandbox.vaeroex.com";
  const approvedHeaders=new Headers({host:"square-sandbox.vaeroex.com","x-forwarded-host":"square-sandbox.vaeroex.com","x-forwarded-proto":"https"});
  assert.equal(await readSquareWorkspaceEvidence(client,workspace,approvedHeaders),null);assert.equal(calls,0);
  process.env.SQUARE_EVIDENCE_HOST="gcp-square-sandbox-workspace-v1";
  process.env.NODE_ENV="production";
  for(const key of ["VERCEL","VERCEL_ENV","VERCEL_TARGET_ENV","VERCEL_PROJECT_ID","VERCEL_URL"])delete process.env[key];
  assert.equal(await readSquareWorkspaceEvidence(client,workspace),null);assert.equal(calls,0);
  for(const host of ["vaeroex.com","www.vaeroex.com","localhost","localhost:3000","127.0.0.1","[::1]","192.0.2.1","preview.vercel.app","unapproved.example","square-sandbox.vaeroex.com.evil.example","square-sandbox.vaeroex.com:443","square-sandbox.vaeroex.com.","square-sandbox.vaeroex.com, evil.example"]){
    for(const key of ["host","x-forwarded-host"]){
      const h=new Headers(approvedHeaders);h.set(key,host);
      assert.equal(await readSquareWorkspaceEvidence(client,workspace,h),null,`${key}: ${host}`);
    }
  }
  for(const key of ["host","x-forwarded-host","x-forwarded-proto"]){
    const h=new Headers(approvedHeaders);h.delete(key);assert.equal(await readSquareWorkspaceEvidence(client,workspace,h),null);
  }
  for(const proto of ["http","https,http",""]){const h=new Headers(approvedHeaders);h.set("x-forwarded-proto",proto);assert.equal(await readSquareWorkspaceEvidence(client,workspace,h),null);}
  const forwarded=new Headers(approvedHeaders);forwarded.set("forwarded","host=square-sandbox.vaeroex.com;proto=https");
  assert.equal(await readSquareWorkspaceEvidence(client,workspace,forwarded),null);
  for(const [key,value] of [["VERCEL","1"],["VERCEL_ENV","preview"],["VERCEL_ENV","production"],["VERCEL_TARGET_ENV","development"],["VERCEL_PROJECT_ID","prj_J810bZ9ECoN4CyLKujUoEEH8N6ja"],["VERCEL_URL","custom.example"]]){
    process.env[key]=value;assert.equal(await readSquareWorkspaceEvidence(client,workspace,approvedHeaders),null);delete process.env[key];
  }
  for(const mode of ["development","test"]){process.env.NODE_ENV=mode;assert.equal(await readSquareWorkspaceEvidence(client,workspace,approvedHeaders),null);}
  process.env.NODE_ENV="production";
  assert.equal(calls,0,"all rejected hosts stop before database IO");
  assert.deepEqual(await readSquareWorkspaceEvidence(client,workspace,approvedHeaders),view);
  process.env.VERCEL_PROJECT_ID="prj_J810bZ9ECoN4CyLKujUoEEH8N6ja";
  assert.equal(await readSquareWorkspaceEvidence(client,workspace,approvedHeaders),null);assert.equal(calls,1);delete process.env.VERCEL_PROJECT_ID;
  assert.equal(await readSquareWorkspaceEvidence({rpc:async()=>({data:view,error:{message:"SECRET_SENTINEL"}})},workspace,approvedHeaders),null);
  assert.equal(await readSquareWorkspaceEvidence({rpc:async()=>{throw new Error("SECRET_SENTINEL");}},workspace,approvedHeaders),null);
  assert.equal(await readSquareWorkspaceEvidence({rpc:async()=>({data:{...view,token:"SECRET_SENTINEL"},error:null})},workspace,approvedHeaders),null);
  assert.equal(await readSquareWorkspaceEvidence(client,"invalid",approvedHeaders),null);
  assert.equal(render(await readSquareWorkspaceEvidence(client,workspace,approvedHeaders)),html,"replay/render deterministic");
  console.log("Square workspace evidence: UI, privacy, uncertainty, deployment gate, fail-closed reads and deterministic rendering passed.");
}
if(require.main===module)main().catch(()=>{console.error("Square evidence regression failed");process.exitCode=1;});
module.exports={view,render};
