/* Disposable native PostgreSQL only. Injected synthetic transport and pg bridge;
 * no hosted DSN, actual account, Supabase link or cloud credential is accepted. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { runAdditionalQualification } = require("./run-square-durable-page-qualification.js");
const root = path.resolve(__dirname, "..");
const migration = "20260908042529_square_gcp_callback_authority.sql";
const recoveryMigration = "20260910193429_square_gcp_callback_oregon_recovery.sql";
const uuid = () => crypto.randomUUID();
const origin = "https://square-sandbox.vaeroex.com", applicationId = "sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw";
const redirectUri = origin + "/api/integrations/square/callback";
const kmsKeyResource = "projects/vaeroex-square-sandbox/locations/us-west1/keyRings/synthetic/cryptoKeys/credential";
const canary = "SYNTHETIC_GCP_CALLBACK_CREDENTIAL_NOT_REAL";
let assertions = 0, stage = "startup", lastDatabaseFailure, publicCaFixture;
const equal = (a, b, message) => { assertions++; assert.deepEqual(a, b, message); };
const ok = (a, message) => { assertions++; assert.ok(a, message); };
async function rejects(run, message, sql = false) {
  let caught; try { await run(); } catch (error) { caught = error; }
  ok(caught, message);
  if (sql) equal(caught.code, "42501", "fails at checked authority boundary");
  ok(!String(caught?.message).includes(canary), "no credential in denial");
}
const quote = value => '"' + value.replaceAll('"', '""') + '"';

async function qualify(runtime) {
  runtime.installTypescriptLoader();
  const { openSquareGcpCallbackDatabase } = require(path.join(root, "lib/integrations/control-plane/square-gcp-callback-database.ts"));
  const { createSquareAccountConnectionService } = require(path.join(root, "lib/integrations/providers/square/account-connection-service.ts"));
  const { ProviderApplicationSecret } = require(path.join(root, "lib/integrations/credentials/secret-manager.ts"));
  const { SQUARE_OAUTH_SCOPES } = require(path.join(root, "lib/integrations/providers/square/account-connection-oauth.ts"));
  const { oauthStateHash } = require(path.join(root, "lib/integrations/credentials/oauth-state.ts"));
  const database = await runtime.createDatabase("gcp_callback"), owner = database.client;
  const files = runtime.migrationFiles(), baseline = files.filter(name => name < migration);
  equal(baseline.length, 106, "exact complete PR354 baseline");
  equal(files.filter(name => name >= migration), [migration, recoveryMigration], "explicit callback and Oregon recovery tail");
  await runtime.applyMigrations(owner, baseline);
  const sourceBefore = await runtime.sourceSchemaFingerprint(owner);
  const squareMetadata = async () => (await owner.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,
    pg_get_functiondef(p.oid) as body,p.proacl::text as acl,p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like '%square%' and p.proname not like '%gcp_callback%' order by 1,2,3`)).rows;
  const squareBefore = await squareMetadata();
  stage = "atomic_installation";
  const sql = fs.readFileSync(path.join(root,"supabase/migrations",migration),"utf8"), end = sql.lastIndexOf("commit;");
  let rollback = false;
  try { await owner.query(sql.slice(0,end) + "select 1/0;\n" + sql.slice(end)); }
  catch (error) { rollback = error.code === "22012"; await owner.query("rollback"); }
  ok(rollback,"injected pre-COMMIT failure rolls back");
  equal((await owner.query("select to_regclass('private.square_gcp_callback_binding') as value")).rows[0].value,null,"no partial table after rollback");
  await runtime.applyMigrations(owner,[migration]);
  equal(await runtime.sourceSchemaFingerprint(owner),sourceBefore,"QBO and all non-Square metadata unchanged");
  equal(await squareMetadata(),squareBefore,"all 106-chain Square bodies, owners and ACLs unchanged");
  equal((await owner.query("select count(*)::int as n from private.square_gcp_callback_binding")).rows[0].n,0,"migration installs no approval");
  const broker = await runtime.login(database,"broker",["square_account_broker_authority"],"square_sandbox");
  const enroller = await runtime.login(database,"enroller",["square_verified_enrollment_authority"],"square_sandbox");
  const webhook = await runtime.login(database,"webhook",["square_account_broker_authority"],"square_sandbox");
  const worker = await runtime.login(database,"runtime",["square_ingestion_runtime_authority"],"square_sandbox");
  const locker = await runtime.login(database,"locker",[],"square_sandbox");
  const user = uuid(), session = uuid(), workspace = uuid(), entity = uuid(), foreignEntity = uuid();
  const actor = { actorId:user,sessionId:session,workspaceId:workspace,role:"owner" };
  const context = { actor,environment:"sandbox",applicationId,redirectUri };
  await owner.query("insert into auth.users(id,email) values($1,'gcp-callback@example.invalid')",[user]);
  await owner.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,clock_timestamp()+interval '1 day')",[session,user]);
  await owner.query("insert into public.workspaces(id,name,created_by) values($1,'Synthetic GCP callback',$2)",[workspace,user]);
  await owner.query("insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active') on conflict(workspace_id,user_id) where user_id is not null do update set role=excluded.role,status=excluded.status",[workspace,user]);
  for (const [id,key] of [[entity,"approved"],[foreignEntity,"foreign"]]) await owner.query("insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,status,created_by,updated_by) values($1,$2,$3,'Synthetic entity','USD','UTC','active',$4,$4)",[id,workspace,key,user]);
  const fingerprint = "sha256:" + "a".repeat(64);
  await owner.query(`insert into private.square_account_configuration(environment,application_id,redirect_uri,broker_login,enrollment_login,webhook_login,kms_key_resource,
    surface_enabled,enrollment_enabled,approval_expires_at,retention_policy_version,retention_approval_fingerprint,source_retention_seconds,cursor_retention_seconds,revocation_access_policy)
    values('sandbox',$1,$2,$3,$4,$5,$6,true,false,clock_timestamp()+interval '1 day','synthetic_gcp_v1',$7,3600,3600,'deny_source_access')`,
    [applicationId,redirectUri,broker.name,enroller.name,webhook.name,kmsKeyResource,fingerprint]);
  const getBinding = client => client.query("select public.get_square_gcp_callback_binding_v1() as value");
  await rejects(()=>getBinding(broker.client),"no approval fails closed",true);
  await owner.query(`insert into private.square_gcp_callback_binding(deployment_key,project_ref,application_origin,environment,application_id,api_version,
    gcp_project_id,gcp_project_number,gcp_zone,gcp_instance_id,gcp_instance_name,service_account_email,service_account_subject,identity_audience,
    operator_id,workspace_id,business_entity_id,broker_login,enabled,provider_calls_enabled,approval_expires_at,policy_version,policy_fingerprint,
    kms_key_resource,app_secret_version_resource,database_secret_version_resource)
    values('square-gcp-sandbox-callback','oysjpoondtcrqpghhrbd',$1,'sandbox',$2,'2026-08-19','vaeroex-square-sandbox','123456789012','us-west1-a','1234567890123456',
    'square-sandbox-callback','square-broker@vaeroex-square-sandbox.iam.gserviceaccount.com','123456789012345678901',$3,$4,$5,$6,$7,true,true,clock_timestamp()+interval '1 day',
    'synthetic_gcp_v1',$8,$9,'projects/vaeroex-square-sandbox/secrets/square-app/versions/1','projects/vaeroex-square-sandbox/secrets/square-sandbox-callback-db/versions/1')`,
    [origin,applicationId,origin+"/_identity/square-callback",user,workspace,entity,broker.name,fingerprint,kmsKeyResource]);
  const binding = (await getBinding(broker.client)).rows[0].value;
  stage="oregon_recovery_constraint";
  const existingRow=(await owner.query("select to_jsonb(b) as value from private.square_gcp_callback_binding b")).rows;
  const recoverySql=fs.readFileSync(path.join(root,"supabase/migrations",recoveryMigration),"utf8"), recoveryEnd=recoverySql.lastIndexOf("commit;");
  let recoveryRollback=false;
  try { await owner.query(recoverySql.slice(0,recoveryEnd)+"select 1/0;\n"+recoverySql.slice(recoveryEnd)); }
  catch(error) { recoveryRollback=error.code==="22012"; await owner.query("rollback"); }
  ok(recoveryRollback,"recovery constraint change rolls back atomically");
  await assert.rejects(()=>owner.query("update private.square_gcp_callback_binding set gcp_zone='us-west1-b'"),{code:"23514"}); assertions++;
  await runtime.applyMigrations(owner,[recoveryMigration]);
  equal((await owner.query("select to_jsonb(b) as value from private.square_gcp_callback_binding b")).rows,existingRow,"migration preserves approval, identity, expiry and every existing field");
  equal(await runtime.sourceSchemaFingerprint(owner),sourceBefore,"recovery leaves QBO and non-Square metadata exact");
  equal(await squareMetadata(),squareBefore,"recovery leaves all existing Square routines exact");
  for(const zone of ["us-west1-b","us-west1-c"]) {
    await owner.query("update private.square_gcp_callback_binding set gcp_zone=$1",[zone]);
    equal((await getBinding(broker.client)).rows[0].value,{...binding,gcpZone:zone},"checked broker returns only the explicitly selected canonical zone");
  }
  for(const zone of ["us-east1-b","us-west2-a","us-west1-z","us-west1"]) {
    await assert.rejects(()=>owner.query("update private.square_gcp_callback_binding set gcp_zone=$1",[zone]),{code:"23514"}); assertions++;
  }
  await owner.query("update private.square_gcp_callback_binding set gcp_zone='us-west1-a'");
  equal((await getBinding(broker.client)).rows[0].value,binding,"original host binding remains supported without other authority changes");
  equal(binding.brokerLogin,broker.name,"actual configured broker obtains exact GCP host tuple");
  equal(binding.gcpInstanceId,"1234567890123456","instance numeric identity preserved as string");
  for(const login of [enroller,webhook,worker,locker]) await rejects(()=>getBinding(login.client),"wrong distinct LOGIN denied",true);
  await rejects(()=>getBinding(owner),"privileged owner is not runtime LOGIN",true);
  for(const login of [broker,enroller,webhook,worker]) {
    await rejects(()=>login.client.query("select * from private.square_gcp_callback_binding"),"no private table access",true);
    await rejects(()=>login.client.query("select private.square_gcp_callback_binding_v1()"),"private helper unavailable",true);
  }
  const acl = (await owner.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='private.square_gcp_callback_binding'::regclass")).rows[0];
  equal(acl,{relrowsecurity:true,relforcerowsecurity:true},"private approval RLS enabled and forced");
  for(const isolation of ["repeatable read","serializable"]) {
    await broker.client.query("begin isolation level "+isolation);
    try { await rejects(()=>getBinding(broker.client),"stale-snapshot isolation denied",true); }
    finally { await broker.client.query("rollback"); }
  }
  const call = async (operation,command,ctx=context,client=broker.client) => (await client.query("select public.square_gcp_callback_account_v1($1::jsonb,$2::text,$3::jsonb) as value",[JSON.stringify(ctx),operation,JSON.stringify(command)])).rows[0].value;
  for(const operation of ["confirm_mapping","acquire_refresh","read_credential","rotate_credential","refresh_boundary","acquire_revocation","unknown"])
    await rejects(()=>call(operation,{}),"callback wrapper cannot grow capabilities",true);
  await rejects(()=>call("prepare",{connectionId:uuid(),businessEntityId:foreignEntity,operation:"connect"}),"same workspace foreign entity denied",true);
  for(const mutation of [{...actor,actorId:uuid()},{...actor,sessionId:uuid()},{...actor,workspaceId:uuid()},{...actor,role:"admin"}])
    await rejects(()=>call("status",{},{...context,actor:mutation}),"current actor/session/workspace/role mismatch denied",true);
  equal((await call("status",{})).businessEntities.map(e=>e.id),[entity],"view confined to exact approved entity");

  // The production parser sees only a synthetic DSN; this constructor bridge can
  // connect exclusively through the harness's registered local connection set.
  const pg = require("pg"), OriginalClient = pg.Client;
  let abortOnQuery, storeWait=false, loseStoreAck=false, storedAwaitingCommit=false;
  const open = async signal => {
    pg.Client = class {
      constructor(options) { equal(options.ssl,{rejectUnauthorized:true,ca:publicCaFixture.ca},"production explicit CA and TLS verification remain enabled"); }
      on() {} async connect() { this.local = await runtime.connect(broker.connection); }
      async query(...args) { try {
        const storing=args[0].includes("square_gcp_callback_account_v1")&&args[1]?.[1]==="store_credential";
        let result;
        if(storing&&storeWait){
          storeWait=false;
          const id=JSON.parse(args[1][2]).command.oauthStateId;
          await owner.query("update private.square_account_oauth_states set expires_at=clock_timestamp()+interval '400 milliseconds' where state_id=$1",[id]);
          await locker.client.query("begin");await locker.client.query("select 1 from private.square_account_oauth_states where state_id=$1 for update",[id]);
          const pid=(await this.local.query("select pg_backend_pid() as pid")).rows[0].pid;
          const pending=this.local.query(...args).then(value=>({value}),error=>({error}));
          await waitForPid(pid);await new Promise(r=>setTimeout(r,500));await locker.client.query("commit");
          const outcome=await pending;if(outcome.error)throw outcome.error;result=outcome.value;
        }else result=await this.local.query(...args);
        if(storing&&loseStoreAck)storedAwaitingCommit=true;
        if(args[0]==="commit"&&storedAwaitingCommit){storedAwaitingCommit=false;loseStoreAck=false;throw new Error("synthetic_lost_ack");}
        if(abortOnQuery)abortOnQuery(args[0]);return result;
      } catch(error) {
        lastDatabaseFailure={code:/^[A-Z0-9_]+$/.test(error.code??"")?error.code:"fixed_failure",
          reason:/^square_[a-z_]+$/.test(error.message??"")?error.message:"fixed_failure"};throw error;
      } }
      async end() { if(this.local) await this.local.end(); }
    };
    try { return await openSquareGcpCallbackDatabase(`postgresql://${broker.name}:synthetic-not-real@db.oysjpoondtcrqpghhrbd.supabase.co:5432/postgres`,publicCaFixture.ca,signal); }
    finally { pg.Client = OriginalClient; }
  };
  const signal = new AbortController().signal;
  const alreadyAborted=new AbortController();alreadyAborted.abort();
  await rejects(()=>open(alreadyAborted.signal),"pre-aborted request cannot open a database connection");
  const abortDuringQuery=new AbortController(),abortDb=await open(abortDuringQuery.signal);
  abortOnQuery=sql=>{if(sql.includes("square_gcp_callback_account_v1"))abortDuringQuery.abort();};
  await rejects(()=>abortDb.client.rpc("square_account_connection_v1",{p_context:context,p_operation:"status",p_command:{}}),"abort after SQL response never acknowledges the transaction");
  abortOnQuery=undefined;
  await rejects(()=>abortDb.recheckBinding(),"aborted database stays closed");
  let secretCalls=0,encryptCalls=0,providerCalls=0,expiresAt;
  const secret = new ProviderApplicationSecret({schemaVersion:"provider_application_secret_v1",providerKey:"square",environment:"sandbox",clientId:applicationId,clientSecret:canary});
  const transport = async input => {
    providerCalls++;
    const url=new URL(input.url); equal(url.origin,"https://connect.squareupsandbox.com","synthetic transport remains Sandbox-bound");
    const location={id:"LOC_SYNTHETIC_1",name:"Synthetic location",status:"ACTIVE",merchant_id:"MERCHANT_SYNTHETIC_1",country:"US",currency:"USD",timezone:"America/Los_Angeles"};
    let value;
    if(url.pathname==="/oauth2/token") { expiresAt=new Date(Date.now()+86400_000).toISOString(); value={access_token:canary,refresh_token:"REFRESH_"+canary,token_type:"bearer",short_lived:true,merchant_id:"MERCHANT_SYNTHETIC_1",expires_at:expiresAt}; }
    else if(url.pathname==="/oauth2/token/status") value={scopes:[...SQUARE_OAUTH_SCOPES],client_id:applicationId,merchant_id:"MERCHANT_SYNTHETIC_1",expires_at:expiresAt};
    else if(url.pathname==="/v2/merchants/me") value={merchant:{id:"MERCHANT_SYNTHETIC_1",business_name:"Synthetic seller",status:"ACTIVE",country:"US",main_location_id:location.id}};
    else if(url.pathname==="/v2/locations") value={locations:[location]};
    else if(url.pathname==="/v2/locations/main") value={location};
    else throw new Error("synthetic_destination_denied");
    return {status:200,body:(async function*(){yield Buffer.from(JSON.stringify(value));})(),close(){}};
  };
  const service = db => createSquareAccountConnectionService({client:db.client,enrollmentClient:{async rpc(){throw new Error("no_enrollment");}},environment:"sandbox",applicationId,redirectUri,kmsKeyResource,transport,
    secrets:{async access(){await db.authorizeFirstConsent({purpose:"application_secret",signal});secretCalls++;await db.authorizeFirstConsent({purpose:"application_secret",signal});return secret;}},
    kms:{async encrypt(input){const aadContext=JSON.parse(Buffer.from(input.additionalAuthenticatedData).toString("utf8"));await db.authorizeFirstConsent({purpose:"credential_encrypt",aadContext,signal});encryptCalls++;
      const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(Buffer.from(input.additionalAuthenticatedData));
      const result=Buffer.concat([iv,cipher.update(input.plaintext),cipher.final(),cipher.getAuthTag()]);await db.authorizeFirstConsent({purpose:"credential_encrypt",aadContext,signal});return result;},async decrypt(){throw new Error("no_decryption");}}});
  stage="request_owned_first_consent";
  const initiateDb=await open();
  await rejects(()=>initiateDb.authorizeFirstConsent({purpose:"application_secret",signal}),"serialized caller cannot enable guard");
  stage="request_owned_initiation";
  const initiation=await service(initiateDb).initiate(actor,{operation:"connect",businessEntityId:entity},signal);
  const state=new URL(initiation.authorizationUrl).searchParams.get("state");
  await initiateDb.close();
  const completeDb=await open();
  stage="request_owned_completion";
  await service(completeDb).complete(actor,{state,code:"synthetic-code"},signal);
  equal(secretCalls,1,"one application-secret effect only after this request consumes state");
  equal(encryptCalls,1,"one encryption effect through current consumed-intent guard");
  equal(providerCalls,5,"only bounded injected exchange and discovery calls");
  equal((await owner.query("select state from private.square_account_connections")).rows[0].state,"mapping_required","first consent stops authorized_unmapped");
  equal((await owner.query("select count(*)::int as n from private.square_account_enrollments")).rows[0].n,0,"no enrollment activated");
  equal((await owner.query("select count(*)::int as n from private.square_ingestion_tasks")).rows[0].n,0,"no task/runtime created");
  await rejects(()=>completeDb.authorizeFirstConsent({purpose:"application_secret",signal}),"stored intent cannot reuse first-consent authority");
  await completeDb.close();
  const replayDb=await open();
  await rejects(()=>service(replayDb).complete(actor,{state,code:"synthetic-code"},signal),"duplicate callback cannot exchange again");
  equal(providerCalls,5,"replay has zero provider effects");
  await replayDb.close();

  stage="consent_predicate_and_lock_waits";
  const pendingDb=await open();
  const next=await service(pendingDb).initiate(actor,{operation:"connect",businessEntityId:entity},signal);
  const hash=oauthStateHash(new URL(next.authorizationUrl).searchParams.get("state"));
  const looked=await call("lookup_state",{stateHash:hash});
  const rest={...looked.command};
  for(const field of ["contractVersion","id","createdAt","expiresAt"])delete rest[field];
  const consumed=await call("consume_state",{...rest,consumedAt:new Date().toISOString()});
  const consent={stateId:consumed.stateId,connectionId:consumed.connectionId,connectionGeneration:consumed.connectionGeneration,expectedConnectionRowVersion:looked.rowVersion,consumedAt:consumed.consumedAt};
  const check=async (value=consent,ctx=context)=> (await broker.client.query("select public.check_square_gcp_callback_consent_v1($1::jsonb,$2::jsonb) as value",[JSON.stringify(ctx),JSON.stringify(value)])).rows[0].value;
  equal((await check()).gcpInstanceId,binding.gcpInstanceId,"checked consent binds exact host");
  await rejects(()=>pendingDb.authorizeFirstConsent({purpose:"application_secret",signal}),"another connection consume cannot arm request guard");
  await pendingDb.close();
  for(const changed of [{stateId:uuid()},{connectionId:uuid()},{connectionGeneration:2},{expectedConnectionRowVersion:2},{consumedAt:new Date(0).toISOString()}])
    await rejects(()=>check({...consent,...changed}),"state/generation/CAS/consumed-time mismatch denied",true);
  const mutate=async (table,column,value,run,where="true")=>{const previous=(await owner.query(`select ${column} as value from ${table} where ${where}`)).rows[0].value;
    await owner.query(`update ${table} set ${column}=$1 where ${where}`,[value]);try{await run();}finally{await owner.query(`update ${table} set ${column}=$1 where ${where}`,[previous]);}};
  for(const [table,column,value] of [["private.square_gcp_callback_binding","enabled",false],["private.square_gcp_callback_binding","provider_calls_enabled",false],
    ["private.square_gcp_callback_binding","approval_expires_at",new Date(0)],["private.square_account_configuration","blocked",true],
    ["private.square_account_configuration","source_retention_seconds",null],["public.workspace_members","status","disabled"],["auth.sessions","not_after",new Date(0)]])
    await mutate(table,column,value,()=>rejects(()=>check(),"current approval/session/member/policy loss denied",true));
  await mutate("private.square_account_connections","revocation_pending",true,()=>rejects(()=>check(),"local revocation fence denied",true),`connection_id='${consent.connectionId}'`);
  // Preserve PostgreSQL microseconds: a JavaScript Date round trip would truncate
  // and accidentally test an earlier revocation rather than exact equality.
  await owner.query("update private.square_account_connections set revoked_before=(select created_at from private.square_account_oauth_states where state_id=$1) where connection_id=$2",[consent.stateId,consent.connectionId]);
  try { await rejects(()=>check(),"equal-timestamp revocation fences consumed intent",true); }
  finally { await owner.query("update private.square_account_connections set revoked_before=null where connection_id=$1",[consent.connectionId]); }
  await mutate("private.square_account_oauth_states","status","cancelled",()=>rejects(()=>check(),"cancelled intent denied",true),`state_id='${consent.stateId}'`);
  await owner.query(`grant usage on schema private to ${quote(locker.name)}`);
  await owner.query(`grant select,update on private.square_account_oauth_states to ${quote(locker.name)}`);
  // RLS blocks the locker too; a narrowly scoped synthetic policy permits only
  // its fixture lock. This never grants application broker table access.
  await owner.query(`create policy synthetic_gcp_state_locker on private.square_account_oauth_states to ${quote(locker.name)} using(true) with check(true)`);
  const pid=(await broker.client.query("select pg_backend_pid() as pid")).rows[0].pid;
  async function waitForPid(id){for(let i=0;i<100;i++){const row=(await owner.query("select wait_event_type from pg_stat_activity where pid=$1",[id])).rows[0];if(row?.wait_event_type==="Lock")return;await new Promise(r=>setTimeout(r,10));}throw new Error("expected_lock_wait_missing");}
  const blocked=()=>waitForPid(pid);
  for(const change of ["positive_control","role_nologin","role_membership"]) {
    await locker.client.query("begin");
    await locker.client.query("select 1 from private.square_account_oauth_states where state_id=$1 for update",[consent.stateId]);
    let outcome;
    const running=check().then(value=>{outcome={value};},error=>{outcome={error};});
    await blocked();
    if(change==="role_nologin") await owner.query(`alter role ${quote(broker.name)} nologin`);
    if(change==="role_membership") await owner.query(`revoke square_account_broker_authority from ${quote(broker.name)}`);
    await blocked();
    await locker.client.query("commit");await running;
    if(change.startsWith("role_")){equal(outcome.error?.code,"42501","post-lock committed LOGIN/membership loss denies");}
    else ok(outcome.value,"held state lock positive control completes");
    if(change==="role_nologin") await owner.query(`alter role ${quote(broker.name)} login`);
    if(change==="role_membership") await owner.query(`grant square_account_broker_authority to ${quote(broker.name)}`);
  }
  for(const [table,column,where] of [["auth.sessions","not_after","true"],["private.square_gcp_callback_binding","approval_expires_at","true"],
    ["private.square_account_oauth_states","expires_at",`state_id='${consent.stateId}'`]]) {
    await mutate(table,column,new Date(Date.now()+400),async()=>{
      await locker.client.query("begin");await locker.client.query("select 1 from private.square_account_oauth_states where state_id=$1 for update",[consent.stateId]);
      const running=check().then(()=>({accepted:true}),error=>({error}));await blocked();await new Promise(r=>setTimeout(r,500));await locker.client.query("commit");
      equal((await running).error?.code,"42501","expiry during actual lock wait denies after release");
    },where);
  }
  equal((await check()).brokerLogin,broker.name,"authority restore positive control");
  await call("disconnect",{connectionId:consent.connectionId,confirmation:"disconnect"});
  await rejects(()=>check(),"disconnect permanently fences consumed intent",true);
  stage="store_final_wait_and_uncertain_commit";
  for(const fault of ["state_expiry","lost_ack"]) {
    const startDb=await open(),start=await service(startDb).initiate(actor,{operation:"connect",businessEntityId:entity},signal);await startDb.close();
    const rawState=new URL(start.authorizationUrl).searchParams.get("state");
    const accountId=(await owner.query("select connection_id from private.square_account_oauth_states where state_hash=$1",[oauthStateHash(rawState)])).rows[0].connection_id;
    const beforeProvider=providerCalls,beforeSecret=secretCalls,beforeEncrypt=encryptCalls;
    const callbackDb=await open();storeWait=fault==="state_expiry";loseStoreAck=fault==="lost_ack";
    await rejects(()=>service(callbackDb).complete(actor,{state:rawState,code:"synthetic-fault-code"},signal),"final-lock expiry or uncertain ACK is never accepted/retried");
    await callbackDb.close();
    equal(providerCalls-beforeProvider,5,"fault never re-exchanges code or repeats discovery");
    equal(secretCalls-beforeSecret,1,"fault never repeats secret access");equal(encryptCalls-beforeEncrypt,1,"fault never repeats encryption");
    const persisted=(await owner.query("select state,(select count(*)::int from private.square_account_credentials k where k.connection_id=a.connection_id) as credentials from private.square_account_connections a where connection_id=$1",[accountId])).rows[0];
    equal(persisted.credentials,fault==="lost_ack"?1:0,"expired final state rolls back; lost acknowledgement preserves exactly one committed ciphertext");
    const statusDb=await open(),status=await service(statusDb).snapshot(actor);await statusDb.close();
    equal(status.connections.find(row=>row.connectionId===accountId).state,fault==="lost_ack"?"mapping_required":"authorization_required","fresh checked status safely resolves actual committed state");
  }
  stage="real_portal_request_to_database_flow";
  const { createSquareSandboxPortal,PORTAL_PATH,CALLBACK_PATH }=require(path.join(root,"services/square-sandbox-callback/src/portal.ts"));
  const { SESSION_COOKIE }=require(path.join(root,"services/square-sandbox-callback/src/auth.ts"));
  const sessionValue="synthetic-current-operator-session",csrfCookie="__Host-vaeroex-square-csrf";
  const portal=createSquareSandboxPortal({async open(signal){const db=await open(signal);return {binding:db.binding,service:service(db),close:db.close,
    // Only the HTTP authentication issuer is injected. The actual broker LOGIN
    // and fresh PostgreSQL session/member predicates execute on every operation.
    auth:{async authenticate(value){return value===sessionValue?actor:null;},async login(email,password){if(email!=="synthetic@example.invalid"||password!=="synthetic-password")throw new Error("synthetic_login_denied");return sessionValue;},async logout(){}}};}});
  const request=(path,method="GET",cookie="",fields)=>new Request(origin+path,{method,headers:{host:"square-sandbox.vaeroex.com",cookie,
    ...(method==="POST"?{origin,"sec-fetch-site":"same-origin","content-type":"application/x-www-form-urlencoded"}:{})},
    ...(fields?{body:new URLSearchParams(fields)}:{})});
  let landing=await portal(request(PORTAL_PATH)),html=await landing.text();
  let csrf=/name="csrf" value="([A-Za-z0-9_-]{43})"/.exec(html)?.[1];ok(csrf,"real portal renders bounded CSRF form");
  const loginResponse=await portal(request("/actions/login","POST",`${csrfCookie}=${csrf}`,{csrf,email:"synthetic@example.invalid",password:"synthetic-password"}));
  equal(loginResponse.status,200,"portal login response succeeds through injected issuer");
  ok(loginResponse.headers.getSetCookie().some(value=>value.startsWith(SESSION_COOKIE+"=")&&value.includes("HttpOnly")&&value.includes("Secure")&&!value.includes("Max-Age")),"portal session cookie remains secure and session-duration");
  const sessionCookie=SESSION_COOKIE+"="+sessionValue;
  landing=await portal(request(PORTAL_PATH,"GET",sessionCookie));html=await landing.text();csrf=/name="csrf" value="([A-Za-z0-9_-]{43})"/.exec(html)?.[1];
  const cookie=sessionCookie+`; ${csrfCookie}=${csrf}`;
  const connectResponse=await portal(request("/actions/connect","POST",cookie,{csrf}));equal(connectResponse.status,200,"portal connect uses actual checked database");
  const outbound=new URL((await connectResponse.json()).navigate),portalState=outbound.searchParams.get("state");
  equal(portalState.length,43,"same opaque state format reaches portal navigation");
  const portalAccount=(await owner.query("select connection_id from private.square_account_oauth_states where state_hash=$1",[oauthStateHash(portalState)])).rows[0].connection_id;
  const beforePortal=providerCalls;
  const callbackResponse=await portal(request(CALLBACK_PATH+"?"+new URLSearchParams({state:portalState,code:"synthetic-portal-code"}),"GET",sessionCookie));
  equal(callbackResponse.status,303,"real portal callback completes synchronously then redirects");equal(callbackResponse.headers.get("location"),PORTAL_PATH,"callback redirect is fixed and queryless");
  equal(callbackResponse.headers.get("cache-control"),"no-store","callback is not cacheable");equal(callbackResponse.headers.get("referrer-policy"),"no-referrer","callback suppresses referrer");
  equal(await callbackResponse.text(),"","callback does not serialize protected values");equal(providerCalls-beforePortal,5,"real portal exercised one actual service exchange/discovery sequence");
  equal((await owner.query("select state from private.square_account_connections where connection_id=$1",[portalAccount])).rows[0].state,"mapping_required","real portal stops authorized_unmapped in PostgreSQL");
  equal((await owner.query("select count(*)::int as n from private.square_account_enrollments")).rows[0].n,0,"portal cannot enroll");
  const cleanPage=await portal(request(PORTAL_PATH,"GET",sessionCookie));ok((await cleanPage.text()).includes("authorized_unmapped"),"clean portal status reads actual authorized state");
  const disconnectResponse=await portal(request("/actions/disconnect","POST",cookie,{csrf,connectionId:portalAccount,confirmation:"disconnect"}));
  equal(disconnectResponse.status,200,"real portal local disconnect succeeds");
  equal((await owner.query("select state from private.square_account_connections where connection_id=$1",[portalAccount])).rows[0].state,"disconnected","portal disconnect fences actual database row");
  equal(providerCalls-beforePortal,5,"local disconnect makes no provider call");
  equal(await squareMetadata(),squareBefore,"existing Square routines remain untouched after all cases");
  console.log(`Square GCP callback database qualification passed (${assertions} assertions).`);
}
runAdditionalQualification(async runtime=>{
  publicCaFixture=require("./square-gcp-callback-ca-test-support.js").createSyntheticCallbackCa();
  await qualify(runtime);
}).catch(error=>{
  process.stderr.write(`Square GCP callback database qualification failed at ${stage} (${typeof error.code==="string"&&/^[A-Z0-9_]+$/.test(error.code)?error.code:"fixed_failure"}).\n`);
  if(error.code==="ERR_ASSERTION")process.stderr.write(String(error.message).split("\n")[0]+"\n");
  if(lastDatabaseFailure)process.stderr.write("Checked database failure: "+JSON.stringify(lastDatabaseFailure)+"\n");
  process.exitCode=1;
}).finally(()=>publicCaFixture?.close());
