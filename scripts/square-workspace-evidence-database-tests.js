/* Called only by the owned, remote-rejecting native database harness. */
module.exports=async function({c,eq,workspace,actor,session,connection,entity,manifest}) {
  const claims={sub:actor,session_id:session,role:"authenticated",iss:"https://oysjpoondtcrqpghhrbd.supabase.co/auth/v1",is_anonymous:false};
  async function read(workspaceId=workspace,patch={}) {
    await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({...claims,...patch})]);
    await c.query("set local role authenticated");
    try{return (await c.query("select public.read_square_workspace_evidence_v1($1) value",[workspaceId])).rows[0].value;}
    finally {try{await c.query("reset role");}catch{/* Failed statement is recovered at the caller's savepoint. */}}
  }
  // A savepoint recovers intentionally denied calls without suppressing errors.
  async function reject(fn,label) {
    await c.query("savepoint evidence_denial");let code;
    try{await fn();}catch(e){code=e.code;}
    await c.query("rollback to evidence_denial");eq(code,"42501",label);
  }
  async function mutation(sql,params,label) {
    await c.query("savepoint evidence_change");await c.query(sql,params);await reject(()=>read(),label);
    await c.query("rollback to evidence_change");
  }
  await c.query("begin");
  try {
    // Isolated fixture configuration only; no hosted identity or record copied.
    await c.query(`insert into private.square_account_configuration select (jsonb_populate_record(null::private.square_account_configuration,
      to_jsonb(c)||jsonb_build_object('application_id','sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw'))).* from private.square_account_configuration c`);
    await c.query("update private.square_account_connections set application_id='sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw' where connection_id=$1",[connection]);
    const before=(await c.query("select count(*)::int n from private.square_interpretation_runs")).rows[0].n;
    const view=await read();
    eq(view.counts,{payment:1,refund:1,order:1,catalog:1,inventory:3},"live checked counts reflect actual seven synthetic sources, not hosted fixture constants");
    eq(view.provenance.length,7,"bounded identifier-free provenance");
    eq(view.historical,"unknown","unknown history survives database projection");eq(view.syncStatus,"unknown","observation time is not sync health");
    eq(view.economic,"blocked","no economic output");
    const safe=require("../lib/integrations/providers/square/workspace-evidence.ts").parseSquareWorkspaceEvidence(view);
    eq(!!safe,true,"actual PostgreSQL output matches UI contract");
    const text=JSON.stringify(view);for(const secret of [workspace,actor,session,connection,entity,"SELLER_SYNTHETIC","LOC_SYNTHETIC",...manifest.flatMap(x=>[x.versionKey,x.resourceKey,x.sourceFingerprint])])eq(text.includes(secret),false,"private identifiers withheld");
    eq((await read()).counts,view.counts,"read replay stable");
    eq((await c.query("select count(*)::int n from private.square_interpretation_runs")).rows[0].n,before,"reader never creates checkpoint");
    await reject(()=>read("00000000-0000-4000-8000-000000000001"),"cross-workspace denied");
    for(const patch of [{sub:"00000000-0000-4000-8000-000000000001"},{session_id:"00000000-0000-4000-8000-000000000001"},{role:"service_role"},{iss:"https://production.invalid/auth/v1"},{is_anonymous:true}])await reject(()=>read(workspace,patch),"invalid actor/session/issuer/role denied");
    for(const [sql,params,label] of [
      ["update auth.sessions set not_after=clock_timestamp()-interval '1 second'",[],"expired session"],
      ["update auth.users set banned_until=clock_timestamp()+interval '1 hour'",[],"banned user"],
      ["update public.workspace_members set status='disabled' where workspace_id=$1",[workspace],"removed membership"],
      ["update public.workspace_members set role='viewer' where workspace_id=$1",[workspace],"insufficient role"],
      ["update public.business_entities set status='inactive' where id=$1",[entity],"inactive entity"],
      ["update private.square_account_configuration set blocked=true",[],"closed gate"],
      ["update private.square_account_connections set revocation_pending=true",[],"revocation pending"],
      ["update private.square_connections set state='revoked',revoked_at=clock_timestamp()",[],"revoked connection"],
      ["update private.square_connections set current_generation=5",[],"new generation fences old facts"],
      ["update private.square_account_connections set merchant_id='other'",[],"seller mismatch"],
      ["update private.square_ingestion_resources set current_version_key=null where resource_key=$1",[manifest[0].resourceKey],"stale source version"],
      ["delete from auth.sessions where id=$1",[session],"deleted session"]
    ])await mutation(sql,params,label);
    for(const role of ["anon","service_role"]) {
      await reject(async()=>{await c.query(`set local role ${role}`);await c.query("select public.read_square_workspace_evidence_v1($1)",[workspace]);},"non-user role cannot execute reader");
    }
    await reject(async()=>{await c.query("set local role authenticated");await c.query("select output from private.square_interpretation_runs");},"no raw table access");
    eq((await c.query("select has_schema_privilege('authenticated','private','usage') ok")).rows[0].ok,false,"reader grants no private schema usage");
    await require('./square-workspace-card-database-tests.js')({c,eq,workspace,actor,session,connection,entity,claims,view});
  } finally {await c.query("rollback");}
};
