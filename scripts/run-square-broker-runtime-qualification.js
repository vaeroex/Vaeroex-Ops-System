/* Owned disposable PostgreSQL only. No hosted target, real credentials or provider network. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { runAdditionalQualification } = require("./run-square-durable-page-qualification.js");

const root = path.resolve(__dirname, "..");
const migrationName = "20260908014713_square_broker_runtime_credential_authority.sql";
const applicationId = "sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw";
const origin = "https://square-sandbox.vaeroex.com";
const redirectUri = origin + "/api/integrations/square/callback";
const kmsKeyResource = "projects/square-qualification/locations/global/keyRings/synthetic/cryptoKeys/credential";
const CANARY = "SYNTHETIC_SEPARATE_BROKER_CREDENTIAL";
const uuid = () => crypto.randomUUID();
let assertions = 0, stage = "startup", lastFailure = null;
const equal = (actual, expected, label) => { assertions++; assert.deepEqual(actual, expected, label); };
const ok = (value, label) => { assertions++; assert.ok(value, label); };
async function denied(run, label, message) {
  let caught;
  try { await run(); } catch (error) { caught = error; }
  equal(caught?.code, "42501", label);
  if (message) equal(caught?.message, message, "denial reaches the intended checked predicate");
  ok(!String(caught?.message).includes(CANARY), "denial excludes credential material");
}
function rpc(client) {
  const allowed = new Set(["square_account_connection_v1", "enroll_square_verified_connection_v1", "enroll_square_verified_task_v1",
    "record_square_account_revocation_v1", "resolve_square_ingestion_authority_v1", "acquire_square_ingestion_page_v1",
    "commit_square_ingestion_page_v1", "release_square_ingestion_page_v1"]);
  return { async rpc(name, args) {
    if (!allowed.has(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw new Error("fixture_rpc_denied");
    try {
      const fields = Object.keys(args);
      const result = await client.query(`select public.${name}(${fields.map((key, i) => `${key} => $${i + 1}`).join(",")}) as value`,
        fields.map(key => args[key] !== null && typeof args[key] === "object" ? JSON.stringify(args[key]) : args[key]));
      return { data: result.rows[0].value, error: null };
    } catch (error) {
      lastFailure={operation:name,action:args.p_operation??null,code:/^[A-Z0-9_]{1,30}$/.test(error.code)?error.code:"fixture_failure",
        reason:/^square_[a-z_]{1,100}$/.test(error.message)?error.message:null};
      return { data: null, error: { code:lastFailure.code } };
    }
  } };
}

async function qualify(runtime) {
  runtime.installTypescriptLoader();
  const { createSquareAccountConnectionService } = require(path.join(root, "lib/integrations/providers/square/account-connection-service.ts"));
  const { ProviderApplicationSecret } = require(path.join(root, "lib/integrations/credentials/secret-manager.ts"));
  const { SQUARE_OAUTH_SCOPES,createSquareOAuthPolicy,createSquareOAuthCredentialProvider } = require(path.join(root, "lib/integrations/providers/square/account-connection-oauth.ts"));
  const { squareCredentialReadLeaseId,createSquareAccountBrokerStore } = require(path.join(root, "lib/integrations/providers/square/account-connection-broker.ts"));
  const { IntegrationCredentialBroker } = require(path.join(root, "lib/integrations/credentials/broker.ts"));
  const { createSquareDurablePageRepository } = require(path.join(root, "lib/integrations/providers/square/durable-page-repository.ts"));
  const { squareIngestionScopeFingerprint } = require(path.join(root, "lib/integrations/providers/square/ingestion-contracts.ts"));
  const { assertSquareReadOperation } = require(path.join(root, "lib/integrations/providers/square/request-validators.ts"));
  const { contractSha256 } = require(path.join(root, "lib/integrations/contracts/canonical.ts"));
  const files = runtime.migrationFiles(), baseline = files.filter(name => name < migrationName);
  equal(baseline.length, 105, "complete canonical remote-binding baseline");
  equal(files.filter(name => name >= migrationName), [migrationName], "sole reviewed corrective tail");
  const database = await runtime.createDatabase("broker_runtime");
  const owner = database.client;
  await runtime.applyMigrations(owner, baseline);
  const before = await runtime.sourceSchemaFingerprint(owner);
  const existing = async () => (await owner.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,
    pg_get_functiondef(p.oid) as body,p.proacl::text as acl,p.proowner
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like '%square%'
      and p.proname not in ('square_account_connection_v1','lock_square_broker_credential_authority_v1') order by 1,2,3`)).rows;
  const squareBefore = await existing();
  const originalFunction = (await owner.query("select pg_get_functiondef('public.square_account_connection_v1(jsonb,text,jsonb)'::regprocedure) as body,proacl::text as acl,proowner from pg_proc where oid='public.square_account_connection_v1(jsonb,text,jsonb)'::regprocedure")).rows[0];
  const broker = await runtime.login(database, "broker", ["square_account_broker_authority"], "square_sandbox");
  const enroller = await runtime.login(database, "enroller", ["square_verified_enrollment_authority"], "square_sandbox");
  const webhook = await runtime.login(database, "webhook", ["square_account_broker_authority"], "square_sandbox");
  const worker = await runtime.login(database, "runtime", ["square_ingestion_runtime_authority"], "square_sandbox");
  const other = await runtime.login(database, "foreign_runtime", ["square_ingestion_runtime_authority"], "square_sandbox");
  for (const login of [broker,enroller,webhook,worker]) equal((await login.client.query("select session_user as login")).rows[0].login, login.name, "actual distinct LOGIN connection");
  equal(new Set([broker.name,enroller.name,webhook.name,worker.name]).size, 4, "all four intended LOGINs are distinct");
  const user = uuid(), session = uuid(), workspace = uuid(), entity = uuid();
  await owner.query("insert into auth.users(id,email) values($1,'square-broker-runtime@example.invalid')", [user]);
  await owner.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,clock_timestamp()+interval '1 day')", [session,user]);
  await owner.query("insert into public.workspaces(id,name,created_by) values($1,'Disposable separate broker',$2)", [workspace,user]);
  await owner.query("insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active') on conflict(workspace_id,user_id) where user_id is not null do update set role=excluded.role,status=excluded.status", [workspace,user]);
  await owner.query("insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,status,created_by,updated_by) values($1,$2,'synthetic_broker','Synthetic broker entity','USD','UTC','active',$3,$3)", [entity,workspace,user]);
  const actor = { actorId:user,sessionId:session,workspaceId:workspace,role:"owner" };
  const context = { actor,environment:"sandbox",applicationId,redirectUri };
  const fingerprint = "sha256:" + "a".repeat(64);
  await owner.query(`insert into private.square_account_configuration(environment,application_id,redirect_uri,broker_login,enrollment_login,webhook_login,kms_key_resource,
    surface_enabled,enrollment_enabled,approval_expires_at,retention_policy_version,retention_approval_fingerprint,source_retention_seconds,cursor_retention_seconds,revocation_access_policy)
    values('sandbox',$1,$2,$3,$4,$5,$6,true,true,clock_timestamp()+interval '1 day','synthetic_broker_v1',$7,3600,3600,'deny_source_access')`,
    [applicationId,redirectUri,broker.name,enroller.name,webhook.name,kmsKeyResource,fingerprint]);
  await owner.query(`insert into private.square_remote_sandbox_binding(deployment_key,project_ref,vercel_team_id,vercel_team_slug,vercel_project_id,application_origin,environment,application_id,api_version,
    operator_id,workspace_id,business_entity_id,broker_login,enroller_login,webhook_login,runtime_login,enabled,approval_expires_at,policy_version,policy_fingerprint)
    values('vaeroex-square-sandbox','oysjpoondtcrqpghhrbd','team_uORtrMvad77Qz6HikOgD4cnp','vaeroex-2167s-projects','prj_SYNTHETICLOCALONLY1234',$1,'sandbox',$2,'2026-08-19',
    $3,$4,$5,$6,$7,$8,$9,true,clock_timestamp()+interval '1 day','synthetic_broker_v1',$10)`,
    [origin,applicationId,user,workspace,entity,broker.name,enroller.name,webhook.name,worker.name,fingerprint]);
  const key = crypto.randomBytes(32);
  const kms = {
    async encrypt(input) { const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv("aes-256-gcm",key,iv); cipher.setAAD(Buffer.from(input.additionalAuthenticatedData)); return Buffer.concat([iv,cipher.update(input.plaintext),cipher.final(),cipher.getAuthTag()]); },
    async decrypt(input) { const bytes=Buffer.from(input.ciphertext), cipher=crypto.createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12)); cipher.setAAD(Buffer.from(input.additionalAuthenticatedData)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]); }
  };
  const secret = new ProviderApplicationSecret({ schemaVersion:"provider_application_secret_v1",providerKey:"square",environment:"sandbox",clientId:applicationId,clientSecret:CANARY });
  const secrets = { async access() { return secret; } };
  let providerCalls = 0;
  let expiresAt;
  const transport = async input => {
    providerCalls++;
    stage="synthetic_provider_"+providerCalls;
    const url = new URL(input.url);
    equal(url.origin,"https://connect.squareupsandbox.com","injected provider stays Sandbox-bound");
    const location = { id:"LOC_SYNTHETIC_1",name:"Synthetic location",status:"ACTIVE",merchant_id:"MERCHANT_SYNTHETIC_1",country:"US",currency:"USD",timezone:"America/Los_Angeles" };
    let value;
    if (url.pathname==="/oauth2/token") { expiresAt=new Date(Date.now()+86400_000).toISOString(); value={access_token:CANARY,refresh_token:"REFRESH_"+CANARY,token_type:"bearer",short_lived:true,merchant_id:"MERCHANT_SYNTHETIC_1",expires_at:expiresAt}; }
    else if(url.pathname==="/oauth2/token/status") value={scopes:[...SQUARE_OAUTH_SCOPES],client_id:applicationId,merchant_id:"MERCHANT_SYNTHETIC_1",expires_at:expiresAt};
    else if(url.pathname==="/v2/merchants/me") value={merchant:{id:"MERCHANT_SYNTHETIC_1",business_name:"Synthetic seller",status:"ACTIVE",country:"US",main_location_id:location.id}};
    else if(url.pathname==="/v2/locations") value={locations:[location]};
    else if(url.pathname==="/v2/locations/main") value={location};
    else throw new Error("unapproved_fixture_operation");
    const bytes=Buffer.from(JSON.stringify(value));
    return {status:200,body:(async function*(){yield bytes;})(),close(){}};
  };
  const service = createSquareAccountConnectionService({ client:rpc(broker.client),enrollmentClient:rpc(enroller.client),webhookClient:rpc(webhook.client),
    environment:"sandbox",applicationId,redirectUri,secrets,kms,kmsKeyResource,transport });
  stage="synthetic_authorization";
  const authorization = await service.initiate(actor,{operation:"connect",businessEntityId:entity});
  const state = new URL(authorization.authorizationUrl).searchParams.get("state");
  stage="synthetic_callback";
  await service.complete(actor,{state,code:"synthetic-authorization-code"});
  const connection = (await service.snapshot(actor)).connections[0];
  stage="synthetic_mapping";
  await service.confirmMapping(actor,{connectionId:connection.connectionId,businessEntityId:entity,locationIds:["LOC_SYNTHETIC_1"],confirmation:"map"});
  equal((await owner.query("select count(*)::int as n from private.square_qualification_gate")).rows[0].n,0,"no synthetic marker creates authority");
  const makeTask = async (login=worker,generation=1) => {
    const scope={workspaceId:workspace,businessEntityId:entity,connectionId:connection.connectionId,sellerId:"MERCHANT_SYNTHETIC_1",environment:"sandbox",authorizedLocationIds:["LOC_SYNTHETIC_1"],generation};
    const grant={scope,stream:"payments",operation:"list_payments",scanId:uuid(),expiresAt:Date.now()+1800_000,request:{method:"GET",url:"https://connect.squareupsandbox.com/v2/payments?location_id=LOC_SYNTHETIC_1",body:null}};
    const decision=assertSquareReadOperation({providerKey:"square",providerEnvironment:"sandbox",method:"GET",url:grant.request.url,headers:{"Square-Version":"2026-08-19"},body:null});
    const binding={scanKey:contractSha256({purpose:"square_ingestion_scan_v1",workspaceId:workspace,businessEntityId:entity,connectionId:connection.connectionId,stream:grant.stream,scanId:grant.scanId}),
      scopeFingerprint:squareIngestionScopeFingerprint(scope),queryFingerprint:contractSha256({request:decision.requestFingerprint,operation:grant.operation,resolvedDefaultLocationId:null}),cursorBindingFingerprint:decision.cursorBindingFingerprint,generation};
    const task={taskId:uuid(),leaseOwnerFingerprint:contractSha256(uuid())};
    const enrolled=await rpc(enroller.client).rpc("enroll_square_verified_task_v1",{p_command:{...task,connectionId:connection.connectionId,generation,runtimeLogin:login.name,grant,binding}});
    equal(enrolled.error,null,"checked separate enroller creates exact runtime-owned task");
    const repository=createSquareDurablePageRepository({...task,client:rpc(login.client)});
    const acquired=await repository.acquire(binding);
    equal(acquired.outcome,"leased","only actual runtime acquires page lease");
    return {task,binding,repository,lease:acquired.lease};
  };
  const active=await makeTask();
  const commandFor = current => ({contractVersion:"integration_provider_credential_read_v1",...current.task,
    leaseId:squareCredentialReadLeaseId(current.lease.leaseId),expectedCredentialVersion:1,requiredScopes:[...SQUARE_OAUTH_SCOPES],minimumValiditySeconds:30,requestedAt:new Date().toISOString()});
  const read = async (command=commandFor(active),login=broker,currentContext=context) => (await login.client.query("select public.square_account_connection_v1($1::jsonb,'read_credential',$2::jsonb) as value",[JSON.stringify(currentContext),JSON.stringify(command)])).rows[0].value;
  stage="original_four_login_failure";
  await denied(()=>read(),"canonical baseline cannot read separate runtime credential","square_ingestion_runtime_authority_required");
  equal((await owner.query("select count(*)::int as n from private.square_account_credential_reads")).rows[0].n,0,"original failure creates no read evidence");
  stage="atomic_migration_rollback_retry";
  const sql=fs.readFileSync(path.join(root,"supabase/migrations",migrationName),"utf8"), commit=sql.toLowerCase().lastIndexOf("commit;");
  let rolledBack=false;
  try { await owner.query(sql.slice(0,commit)+"select 1/0;\n"+sql.slice(commit)); }
  catch(error) { rolledBack=error.code==="22012"; await owner.query("rollback"); }
  ok(rolledBack,"injected failure before COMMIT rolls back correction");
  equal((await owner.query("select to_regprocedure('private.lock_square_broker_credential_authority_v1(jsonb,uuid,text)') as value")).rows[0].value,null,"rollback leaves no helper");
  equal((await owner.query("select pg_get_functiondef('public.square_account_connection_v1(jsonb,text,jsonb)'::regprocedure) as body")).rows[0].body,originalFunction.body,"rollback preserves original account function");
  await runtime.applyMigrations(owner,[migrationName]);
  equal(await runtime.sourceSchemaFingerprint(owner),before,"QBO/non-Square definitions and ACLs remain exact");
  equal(await existing(),squareBefore,"all other Square routines, owners and ACLs remain exact");
  const corrected=(await owner.query("select pg_get_functiondef(oid) as body,proacl::text as acl,proowner from pg_proc where oid='public.square_account_connection_v1(jsonb,text,jsonb)'::regprocedure")).rows[0];
  equal(corrected.acl,originalFunction.acl,"account execution ACL remains unchanged");
  equal(corrected.proowner,originalFunction.proowner,"account function owner remains unchanged");
  equal(corrected.body.replace("private.lock_square_broker_credential_authority_v1(p_context,","private.lock_square_ingestion_authority_v1("),originalFunction.body,"the read authority call is the sole account-body change");
  stage="corrected_read_and_negative_boundaries";
  const available=await read();
  equal(available.state,"available","configured broker reads configured runtime credential");
  ok(typeof available.ciphertextBase64==="string","only the checked read releases encrypted credential");
  equal((await owner.query("select reader_login from private.square_account_credential_reads where evidence_id=$1",[available.credentialReadEvidenceId])).rows[0].reader_login,broker.name,"read evidence records actual broker LOGIN");
  const policy=createSquareOAuthPolicy({environment:"sandbox",applicationId,redirectUri,returnPath:"/app/settings/integrations/square"});
  const credentialBroker=new IntegrationCredentialBroker({store:createSquareAccountBrokerStore({client:rpc(broker.client),context}),kms,kmsKeyResource,secrets,
    providerOAuthPolicy:policy,provider:createSquareOAuthCredentialProvider({policy,applicationId,transport})});
  const checkedAccess=await credentialBroker.readProviderAccessCredential({...active.task,leaseId:squareCredentialReadLeaseId(active.lease.leaseId),expectedCredentialVersion:1,
    requiredScopes:SQUARE_OAUTH_SCOPES,minimumValiditySeconds:30,requestId:uuid()});
  equal(checkedAccess.state,"available","existing credential broker decrypts through distinct configured broker LOGIN");
  await checkedAccess.credential.use(value=>equal(value.accessToken,CANARY,"one-use synthetic credential preserves exact AAD and token"));
  for (const login of [enroller,webhook,worker,other]) await denied(()=>read(undefined,login),"other actual LOGIN cannot read broker credential");
  for(const mutation of [{taskId:uuid()},{leaseOwnerFingerprint:contractSha256(uuid())},{leaseId:uuid()},{requiredScopes:["PAYMENTS_WRITE"]}])
    await denied(()=>read({...commandFor(active),...mutation}),"task, full lease, owner and scopes stay checked");
  for(const mutation of [{actor:{...actor,workspaceId:uuid()}},{actor:{...actor,sessionId:uuid()}},{actor:{...actor,actorId:uuid()}},{actor:{...actor,role:"admin"}}])
    await denied(()=>read(undefined,broker,{...context,...mutation}),"foreign workspace, actor, session and role deny");
  const stale=await read({...commandFor(active),expectedCredentialVersion:2});
  equal(stale.state,"credential_version_stale","credential version CAS remains unchanged");
  equal(stale.ciphertextBase64,undefined,"stale version receives no ciphertext");
  const foreign=await makeTask(other);
  await denied(()=>read(commandFor(foreign)),"another valid runtime-owned task cannot use configured broker binding");
  const changed = async (table,column,value,run) => {
    const previous=(await owner.query(`select ${column} as value from ${table}`)).rows[0].value;
    await owner.query(`update ${table} set ${column}=$1`,[value]);
    try { await run(); } finally { await owner.query(`update ${table} set ${column}=$1`,[previous]); }
  };
  for(const [table,column,value] of [
    ["private.square_remote_sandbox_binding","enabled",false],
    ["private.square_remote_sandbox_binding","approval_expires_at",new Date(0)],
    ["private.square_remote_sandbox_binding","runtime_login",other.name],
    ["private.square_account_configuration","cursor_retention_seconds",3599],
    ["private.square_account_configuration","enrollment_enabled",false],
    ["public.workspace_members","status","disabled"],
    ["public.business_entities","status","inactive"],
    ["auth.sessions","not_after",new Date(0)]
  ]) await changed(table,column,value,()=>denied(()=>read(),"current host, policy, membership, entity and session gates remain mandatory"));
  await active.repository.release(active.lease,{now:Date.now(),retryAfterMs:0,blocked:false});
  await denied(()=>read(),"released page lease cannot release ciphertext");
  const replacement=await active.repository.acquire(active.binding);
  equal(replacement.outcome,"leased","runtime can reacquire without granting broker writes");
  await denied(()=>read(),"old lease cannot read after replacement");
  active.lease=replacement.lease;
  equal((await read()).state,"available","new full lease authorizes broker read");
  stage="expiry_after_actual_scan_lock_wait";
  const brokerPid=(await broker.client.query("select pg_backend_pid() as pid")).rows[0].pid;
  const expiryAfterLock=async (table,column,expectedMessage) => {
    const previous=(await owner.query(`select ${column} as value from ${table}`)).rows[0].value;
    const evidenceBefore=(await owner.query("select count(*)::int as n from private.square_account_credential_reads")).rows[0].n;
    await owner.query(`update ${table} set ${column}=clock_timestamp()+interval '2 seconds'`);
    await owner.query("begin");
    let pending;
    try {
      await owner.query("select 1 from private.square_ingestion_scans where scan_key=$1 for update",[active.binding.scanKey]);
      pending=read().then(value=>({value}),error=>({error}));
      let blocked=false;
      const deadline=Date.now()+1500;
      while(Date.now()<deadline) {
        await owner.query("select pg_stat_clear_snapshot()");
        const observed=(await owner.query("select wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0 as blocked from pg_stat_activity where pid=$1",[brokerPid])).rows[0];
        if(observed?.blocked) {blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      ok(blocked,"broker actually waits on the held scan lock");
      equal((await owner.query(`select ${column}>clock_timestamp() as valid from ${table}`)).rows[0].valid,true,"session/host expiry was future when read began");
      await owner.query(`select pg_sleep(greatest(0,extract(epoch from ${column}-clock_timestamp()))::double precision+0.025) from ${table}`);
      equal((await owner.query(`select ${column}<=clock_timestamp() as expired from ${table}`)).rows[0].expired,true,"database wall time crossed expiry while broker waited");
    } finally { await owner.query("rollback"); }
    try {
      const result=await pending;
      equal(result.error?.code,"42501","expiry after scan wait denies ciphertext");
      equal(result.error?.message,expectedMessage,"post-wait denial identifies the expired boundary");
      equal((await owner.query("select count(*)::int as n from private.square_account_credential_reads")).rows[0].n,evidenceBefore,"expired invocation creates no credential-read evidence");
    } finally { await owner.query(`update ${table} set ${column}=$1`,[previous]); }
  };
  await expiryAfterLock("auth.sessions","not_after","square_account_actor_denied");
  await expiryAfterLock("private.square_remote_sandbox_binding","approval_expires_at","square_ingestion_authority_denied");
  equal((await read()).state,"available","restored live session and host approval permit current lease");
  stage="privileges_and_generation_fences";
  const privileges=(await owner.query(`select pg_has_role($1,'square_ingestion_runtime_authority','MEMBER') as runtime,
    has_function_privilege($1,'public.commit_square_ingestion_page_v1(uuid,text,jsonb)','EXECUTE') as commit,
    has_function_privilege($1,'private.lock_square_broker_credential_authority_v1(jsonb,uuid,text)','EXECUTE') as helper,
    has_table_privilege($1,'private.square_account_credentials','SELECT,INSERT,UPDATE,DELETE') as direct`,[broker.name])).rows[0];
  equal(privileges,{runtime:false,commit:false,helper:false,direct:false},"broker gains no runtime, direct-data or private-helper capability");
  await denied(()=>broker.client.query("select public.commit_square_ingestion_page_v1($1,$2,'{}'::jsonb)",[active.task.taskId,active.task.leaseOwnerFingerprint]),"broker cannot commit a page");
  await denied(()=>broker.client.query("select public.acquire_square_ingestion_page_v1($1,$2,$3::jsonb)",[active.task.taskId,active.task.leaseOwnerFingerprint,JSON.stringify(active.binding)]),"broker cannot acquire a page");
  const nextAuthorization=await service.initiate(actor,{operation:"reauthorize",businessEntityId:entity,connectionId:connection.connectionId});
  await denied(()=>read(),"reauthorization immediately fences old-generation broker access");
  await service.complete(actor,{state:new URL(nextAuthorization.authorizationUrl).searchParams.get("state"),code:"synthetic-second-authorization-code"});
  await service.confirmMapping(actor,{connectionId:connection.connectionId,businessEntityId:entity,locationIds:["LOC_SYNTHETIC_1"],confirmation:"map"});
  await denied(()=>read(),"fresh verified generation cannot revive an old task");
  const currentGeneration=await makeTask(worker,2);
  equal((await read(commandFor(currentGeneration))).state,"available","fresh current-generation runtime task can use broker read");
  await service.disconnect(actor,{connectionId:connection.connectionId,confirmation:"disconnect"});
  await denied(()=>read(commandFor(currentGeneration)),"disconnect fences current broker credential access");
  equal((await owner.query("select count(*)::int as n from private.square_account_credentials")).rows[0].n,2,"denials and disconnect preserve both immutable encrypted generations");
  equal(providerCalls,10,"provider responses are only two sets of five injected authorization/discovery calls");
  key.fill(0);
}
if(require.main===module) runAdditionalQualification(qualify).then(()=>console.log(`Square separate broker/runtime qualification: ${assertions} assertions.`)).catch(error=>{
  process.stderr.write(`Square broker/runtime qualification failed at ${stage} (${/^[A-Z0-9_]{1,30}$/.test(error?.code)?error.code:"test_failure"}).\n`);
  if(/^[a-z_]{1,100}$/.test(error?.message)) process.stderr.write(`Reason: ${error.message}\n`);
  if(lastFailure) process.stderr.write(`Checked RPC: ${JSON.stringify(lastFailure)}\n`);
  if(error?.code==="ERR_ASSERTION") process.stderr.write(`Assertion: ${String(error.message).split("\n")[0]}\n`);
  process.exitCode=1;
});
