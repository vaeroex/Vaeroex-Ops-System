/* Owned disposable PostgreSQL only. No hosted target, real credentials or provider network. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { runAdditionalQualification } = require("./run-square-durable-page-qualification.js");

const root = path.resolve(__dirname, "..");
const migrationName = "20260910231437_square_gcp_mapped_runtime.sql";
const fencingMigration = "20260911000915_square_gcp_mapped_legacy_fencing.sql";
const applicationId = "sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw";
const origin = "https://square-sandbox.vaeroex.com";
const redirectUri = origin + "/api/integrations/square/callback";
const kmsKeyResource = "projects/vaeroex-square-sandbox/locations/us-west1/keyRings/synthetic/cryptoKeys/credential";
const CANARY = "SYNTHETIC_SEPARATE_BROKER_CREDENTIAL";
const uuid = () => crypto.randomUUID();
let assertions = 0, stage = "startup", lastFailure = null;
const equal = (actual, expected, label) => { assertions++; assert.deepEqual(actual, expected, label); };
const ok = (value, label) => { assertions++; assert.ok(value, label); };
async function denied(run, label, message) {
  let caught;
  try { await run(); } catch (error) { caught = error; }
  equal(caught?.code, "42501", label);
  if (message) equal(caught?.message, message, label+" reaches the intended checked predicate");
  ok(!String(caught?.message).includes(CANARY), "denial excludes credential material");
}
function rpc(client) {
  const allowed = new Set(["square_account_connection_v1", "enroll_square_verified_connection_v1", "enroll_square_verified_task_v1",
    "record_square_account_revocation_v1", "resolve_square_ingestion_authority_v1", "acquire_square_ingestion_page_v1",
    "commit_square_ingestion_page_v1", "release_square_ingestion_page_v1",
    "square_gcp_mapped_account_v1", "enroll_square_gcp_verified_connection_v1", "enroll_square_gcp_verified_task_v1",
    "resolve_square_gcp_ingestion_authority_v1", "acquire_square_gcp_ingestion_page_v1", "commit_square_gcp_ingestion_page_v1", "release_square_gcp_ingestion_page_v1"]);
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
  const { SQUARE_OAUTH_SCOPES } = require(path.join(root, "lib/integrations/providers/square/account-connection-oauth.ts"));
  const { squareCredentialReadLeaseId } = require(path.join(root, "lib/integrations/providers/square/account-connection-broker.ts"));
  const { createSquareDurablePageRepository } = require(path.join(root, "lib/integrations/providers/square/durable-page-repository.ts"));
  const { squareIngestionScopeFingerprint } = require(path.join(root, "lib/integrations/providers/square/ingestion-contracts.ts"));
  const { assertSquareReadOperation } = require(path.join(root, "lib/integrations/providers/square/request-validators.ts"));
  const { contractSha256 } = require(path.join(root, "lib/integrations/contracts/canonical.ts"));
  const files = runtime.migrationFiles(), baseline = files.filter(name => name < migrationName);
  equal(baseline.length, 108, "complete canonical callback baseline");
  equal(files.filter(name => name >= migrationName), [migrationName,fencingMigration,"20260911151334_square_verified_provider_observations.sql", "20260911205108_square_canonical_interpretation.sql", "20260911222230_square_workspace_evidence.sql", "20260912034447_square_workspace_card_contract.sql", "20260912150000_square_operational_intelligence.sql"], "exact mapped extension, inherited-entry fencing and separately qualified observation admission");
  const database = await runtime.createDatabase("broker_runtime");
  const owner = database.client;
  await runtime.applyMigrations(owner, baseline);
  const before = await runtime.sourceSchemaFingerprint(owner);
  const existing = async () => (await owner.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,
    pg_get_functiondef(p.oid) as body,p.proacl::text as acl,p.proowner
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like '%square%'
      and p.proname <> 'lock_square_broker_credential_authority_v1' order by 1,2,3`)).rows;
  const squareBefore = await existing();
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
  await owner.query(`insert into private.square_gcp_callback_binding(deployment_key,project_ref,application_origin,environment,application_id,api_version,
    gcp_project_id,gcp_project_number,gcp_zone,gcp_instance_id,gcp_instance_name,service_account_email,service_account_subject,identity_audience,
    operator_id,workspace_id,business_entity_id,broker_login,enabled,provider_calls_enabled,approval_expires_at,policy_version,policy_fingerprint,
    kms_key_resource,app_secret_version_resource,database_secret_version_resource)
    values('square-gcp-sandbox-callback','oysjpoondtcrqpghhrbd',$1,'sandbox',$2,'2026-08-19','vaeroex-square-sandbox','123456789012','us-west1-b','1234567890123456',
    'square-sandbox-callback','square-broker@vaeroex-square-sandbox.iam.gserviceaccount.com','123456789012345678901',$3,$4,$5,$6,$7,true,false,clock_timestamp()+interval '1 day',
    'synthetic_broker_v1',$8,$9,'projects/vaeroex-square-sandbox/secrets/square-app/versions/1','projects/vaeroex-square-sandbox/secrets/square-sandbox-callback-db/versions/1')`,
    [origin,applicationId,origin+"/_identity/square-callback",user,workspace,entity,broker.name,fingerprint,kmsKeyResource]);
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
  stage="atomic_dormant_install";
  const migration=fs.readFileSync(path.join(root,"supabase/migrations",migrationName),"utf8"), end=migration.lastIndexOf("commit;");
  await assert.rejects(()=>owner.query(migration.slice(0,end)+"select 1/0;\n"+migration.slice(end)),{code:"22012"}); assertions++;
  await owner.query("rollback");
  equal((await owner.query("select to_regclass('private.square_gcp_mapped_runtime_binding') as value")).rows[0].value,null,"failed install rolls back entirely");
  await runtime.applyMigrations(owner,[migrationName]);
  equal(await runtime.sourceSchemaFingerprint(owner),before,"QBO/non-Square metadata exact");
  equal((await existing()).filter(row=>!row.proname.includes("gcp_mapped")&&!row.proname.includes("square_gcp_verified")&&!row.proname.includes("square_gcp_ingestion")),squareBefore,"existing account, callback, page and Vercel APIs exact");
  equal((await owner.query("select count(*)::int as n from private.square_gcp_mapped_runtime_binding")).rows[0].n,0,"migration seeds no approval");
  const get=client=>client.query("select public.get_square_gcp_mapped_runtime_binding_v1() as value");
  await denied(()=>get(broker.client),"unconfigured mapped binding denies");
  const account=(await owner.query("select generation,discovery from private.square_account_connections where connection_id=$1",[connection.connectionId])).rows[0];
  await owner.query(`insert into private.square_gcp_mapped_runtime_binding(deployment_key,connection_id,connection_generation,operator_session_id,default_location_id,
    discovery_fingerprint,enroller_login,runtime_login,enroller_database_secret_version_resource,runtime_database_secret_version_resource,approval_expires_at)
    values('square-gcp-sandbox-callback',$1,$2,$3,'LOC_SYNTHETIC_1',$4,$5,$6,
    'projects/vaeroex-square-sandbox/secrets/square-sandbox-enroller-db/versions/1','projects/vaeroex-square-sandbox/secrets/square-sandbox-runtime-db/versions/1',clock_timestamp()+interval '1 day')`,
    [connection.connectionId,account.generation,session,account.discovery.fingerprint,enroller.name,worker.name]);
  await denied(()=>get(broker.client),"default disabled binding denies");
  await owner.query("update private.square_gcp_mapped_runtime_binding set enabled=true");
  const {checkedSquareGcpMappedBinding}=require(path.join(root,"lib/integrations/control-plane/square-gcp-mapped-contracts.ts"));
  for(const [login,capability] of [[broker,"broker"],[enroller,"enroller"],[worker,"runtime"]]) {
    const b=(await get(login.client)).rows[0].value;
    equal(checkedSquareGcpMappedBinding(b).capability,capability,"flat returned binding validates exact actual-role contract");
    equal(b.providerCallsEnabled,false,"consent stays disabled");
    equal(b.mappedProviderCallsEnabled,false,"provider calls separately disabled");
    await denied(()=>login.client.query("select * from private.square_gcp_mapped_runtime_binding"),"private binding cannot be queried directly");
  }
  equal((await owner.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='private.square_gcp_mapped_runtime_binding'::regclass")).rows[0],{relrowsecurity:true,relforcerowsecurity:true},"binding RLS forced");
  for(const login of [owner,other.client,webhook.client]) await denied(()=>get(login),"owner/foreign/session substitutes denied");
  const mappedRpc=client=>({rpc(name,args){
    const mapping={square_account_connection_v1:"square_gcp_mapped_account_v1",enroll_square_verified_connection_v1:"enroll_square_gcp_verified_connection_v1",
      enroll_square_verified_task_v1:"enroll_square_gcp_verified_task_v1",resolve_square_ingestion_authority_v1:"resolve_square_gcp_ingestion_authority_v1",
      acquire_square_ingestion_page_v1:"acquire_square_gcp_ingestion_page_v1",commit_square_ingestion_page_v1:"commit_square_gcp_ingestion_page_v1",
      release_square_ingestion_page_v1:"release_square_gcp_ingestion_page_v1"};
    if(!mapping[name]) throw new Error("fixture_rpc_denied");return rpc(client).rpc(mapping[name],args);
  }});
  const call=(operation,command,ctx=context,client=broker.client)=>client.query("select public.square_gcp_mapped_account_v1($1::jsonb,$2,$3::jsonb) as value",[JSON.stringify(ctx),operation,JSON.stringify(command)]);
  for(const op of ["prepare","consume_state","store_credential","acquire_refresh","rotate_credential","disconnect","status"])
    await denied(()=>call(op,{}),"mapping wrapper cannot reopen consent or refresh");
  const mapCommand={connectionId:connection.connectionId,businessEntityId:entity,locationIds:["LOC_SYNTHETIC_1"],confirmation:"map"};
  await denied(()=>call("confirm_mapping",{...mapCommand,locationIds:["FOREIGN_LOCATION"]}),"foreign location cannot be confirmed");
  await denied(()=>call("confirm_mapping",mapCommand,{...context,actor:{...actor,sessionId:uuid()}}),"different session denied");
  await denied(()=>call("confirm_mapping",mapCommand,context,enroller.client),"enroller cannot use broker mapping capability");
  stage="mapping_enrollment";
  equal((await call("confirm_mapping",mapCommand)).rows[0].value,{confirmed:true,generation:1},"mapping uses existing verified generation");
  const enrolled=await mappedRpc(enroller.client).rpc("enroll_square_verified_connection_v1",{p_context:context,p_command:{connectionId:connection.connectionId,generation:1}});
  equal(enrolled.error,null,"distinct native enroller enrolls checked mapping");
  equal((await owner.query("select mapped_by from private.square_location_mappings")).rows[0].mapped_by,enroller.name,"mapping persistence preserves actual enroller LOGIN");
  equal((await owner.query("select count(*)::int as n from private.square_remote_sandbox_binding")).rows[0].n,0,"no fabricated Vercel binding");
  const scope={workspaceId:workspace,businessEntityId:entity,connectionId:connection.connectionId,sellerId:"MERCHANT_SYNTHETIC_1",environment:"sandbox",authorizedLocationIds:["LOC_SYNTHETIC_1"],generation:1};
  const grant={scope,stream:"payments",operation:"list_payments",scanId:uuid(),expiresAt:Date.now()+1800_000,request:{method:"GET",url:"https://connect.squareupsandbox.com/v2/payments?location_id=LOC_SYNTHETIC_1",body:null}};
  const decision=assertSquareReadOperation({providerKey:"square",providerEnvironment:"sandbox",method:"GET",url:grant.request.url,headers:{"Square-Version":"2026-08-19"},body:null});
  const binding={scanKey:contractSha256({purpose:"square_ingestion_scan_v1",workspaceId:workspace,businessEntityId:entity,connectionId:connection.connectionId,stream:grant.stream,scanId:grant.scanId}),
    scopeFingerprint:squareIngestionScopeFingerprint(scope),queryFingerprint:contractSha256({request:decision.requestFingerprint,operation:grant.operation,resolvedDefaultLocationId:null}),cursorBindingFingerprint:decision.cursorBindingFingerprint,generation:1};
  const task={taskId:uuid(),leaseOwnerFingerprint:contractSha256(uuid())};
  const taskCommand={...task,connectionId:connection.connectionId,generation:1,runtimeLogin:worker.name,grant,binding};
  equal((await mappedRpc(enroller.client).rpc("enroll_square_verified_task_v1",{p_command:taskCommand})).error.code,"42501","provider-disabled task creation rejected");
  await owner.query("update private.square_gcp_mapped_runtime_binding set provider_calls_enabled=true");
  equal((await mappedRpc(enroller.client).rpc("enroll_square_verified_task_v1",{p_command:taskCommand})).error,null,"task enrollment uses distinct session_user");
  const repository=createSquareDurablePageRepository({...task,client:mappedRpc(worker.client)});
  const acquired=await repository.acquire(binding);equal(acquired.outcome,"leased","runtime acquires existing atomic lease");
  const readCommand={contractVersion:"integration_provider_credential_read_v1",...task,leaseId:squareCredentialReadLeaseId(acquired.lease.leaseId),
    expectedCredentialVersion:1,requiredScopes:[...SQUARE_OAUTH_SCOPES],minimumValiditySeconds:30,requestedAt:new Date().toISOString()};
  const read=()=>call("read_credential",readCommand);
  const result=(await read()).rows[0].value;
  equal(result.state,"available","separate GCP broker reads full-lease credential without Vercel authority");
  ok(typeof result.ciphertextBase64==="string"&&!result.ciphertextBase64.includes(CANARY),"only encrypted envelope returned");
  equal((await owner.query("select reader_login from private.square_account_credential_reads")).rows[0].reader_login,broker.name,"credential audit uses native broker identity");
  await denied(()=>call("read_credential",{...readCommand,taskId:uuid()}),"unknown task rejects before credential release");
  const stale=(await call("read_credential",{...readCommand,expectedCredentialVersion:2})).rows[0].value;
  equal(stale.state,"credential_version_stale","stale credential version preserves existing recovery contract");
  equal(stale.ciphertextBase64,undefined,"stale version releases no encrypted credential");
  stage="remote_mapped_coexistence";
  // The same broker may already serve a supported Vercel binding. A disabled
  // or enabled GCP row for another connection cannot intercept those tasks.
  await owner.query(`insert into private.square_remote_sandbox_binding(deployment_key,project_ref,vercel_team_id,vercel_team_slug,vercel_project_id,application_origin,environment,application_id,api_version,
    operator_id,workspace_id,business_entity_id,broker_login,enroller_login,webhook_login,runtime_login,enabled,approval_expires_at,policy_version,policy_fingerprint)
    values('vaeroex-square-sandbox','oysjpoondtcrqpghhrbd','team_uORtrMvad77Qz6HikOgD4cnp','vaeroex-2167s-projects','prj_SYNTHETICLOCALONLY1234',$1,'sandbox',$2,'2026-08-19',
    $3,$4,$5,$6,$7,$8,$9,true,clock_timestamp()+interval '1 day','synthetic_broker_v1',$10)`,
    [origin,applicationId,user,workspace,entity,broker.name,enroller.name,webhook.name,other.name,fingerprint]);
  const remoteAuthorization=await service.initiate(actor,{operation:"connect",businessEntityId:entity});
  await service.complete(actor,{state:new URL(remoteAuthorization.authorizationUrl).searchParams.get("state"),code:"synthetic-remote-authorization-code"});
  const remoteConnection=(await owner.query("select connection_id from private.square_account_connections where connection_id<>$1",[connection.connectionId])).rows[0].connection_id;
  await service.confirmMapping(actor,{connectionId:remoteConnection,businessEntityId:entity,locationIds:["LOC_SYNTHETIC_1"],confirmation:"map"});
  const remoteScope={...scope,connectionId:remoteConnection},remoteGrant={...grant,scope:remoteScope,scanId:uuid()};
  const remoteBinding={...binding,
    scanKey:contractSha256({purpose:"square_ingestion_scan_v1",workspaceId:workspace,businessEntityId:entity,connectionId:remoteConnection,stream:remoteGrant.stream,scanId:remoteGrant.scanId}),
    scopeFingerprint:squareIngestionScopeFingerprint(remoteScope)};
  const remoteTask={taskId:uuid(),leaseOwnerFingerprint:contractSha256(uuid())};
  equal((await rpc(enroller.client).rpc("enroll_square_verified_task_v1",{p_command:{...remoteTask,connectionId:remoteConnection,generation:1,runtimeLogin:other.name,grant:remoteGrant,binding:remoteBinding}})).error,null,"separate existing remote task enrolled");
  const remoteRepository=createSquareDurablePageRepository({...remoteTask,client:rpc(other.client)}),remotePage=await remoteRepository.acquire(remoteBinding);
  equal(remotePage.outcome,"leased","existing remote runtime acquires its own lease");
  const remoteReadCommand={...readCommand,...remoteTask,leaseId:squareCredentialReadLeaseId(remotePage.lease.leaseId)};
  const legacyRead=command=>broker.client.query("select public.square_account_connection_v1($1::jsonb,'read_credential',$2::jsonb) as value",[JSON.stringify(context),JSON.stringify(command)]);
  const currentHelper=(await owner.query("select pg_get_functiondef('private.lock_square_broker_credential_authority_v1(jsonb,uuid,text)'::regprocedure) as body")).rows[0].body;
  const originalDispatch=currentHelper.replace("join private.square_ingestion_tasks t on t.connection_id=m.connection_id\n      where b.broker_login=session_user::name and t.task_id=p_task_id","where b.broker_login=session_user::name");
  ok(originalDispatch!==currentHelper,"negative control restores exact prior shared-broker dispatch");
  await owner.query("begin");await owner.query(originalDispatch);await owner.query("commit");
  try {await denied(()=>legacyRead(remoteReadCommand),"original dispatch reproduces unrelated remote credential rejection");}
  finally {await owner.query(currentHelper);}
  for(const enabled of [false,true]) {
    await owner.query("update private.square_gcp_mapped_runtime_binding set enabled=$1",[enabled]);
    equal((await legacyRead(remoteReadCommand)).rows[0].value.state,"available","unrelated remote credential remains available with disabled/enabled mapped binding");
    if(!enabled)await denied(()=>legacyRead(readCommand),"disabled mapped task never falls back to existing remote host","square_gcp_mapped_runtime_denied");
  }
  await owner.query("update private.square_gcp_mapped_runtime_binding set connection_generation=2");
  await denied(()=>legacyRead(readCommand),"stale mapped generation cannot fall back","square_gcp_mapped_runtime_denied");
  equal((await legacyRead(remoteReadCommand)).rows[0].value.state,"available","unrelated remote task remains valid after mapped generation mismatch");
  await owner.query("update private.square_gcp_mapped_runtime_binding set connection_generation=1");
  await owner.query("update private.square_gcp_mapped_runtime_binding set runtime_login=$1",[other.name]);
  await denied(()=>legacyRead(readCommand),"mismatched mapped runtime cannot fall back","square_gcp_mapped_operation_denied");
  await owner.query("update private.square_gcp_mapped_runtime_binding set runtime_login=$1",[worker.name]);
  stage="mutable_authority_recovery";
  await owner.query("update private.square_gcp_mapped_runtime_binding set enabled=false");
  await denied(read,"disabled binding fences an existing broker session");
  equal((await mappedRpc(worker.client).rpc("resolve_square_ingestion_authority_v1",{p_task_id:task.taskId,p_lease_owner_fingerprint:task.leaseOwnerFingerprint})).error.code,"42501","disabled binding fences runtime session");
  const legacyResolve=()=>worker.client.query("select public.resolve_square_ingestion_authority_v1($1,$2) as value",[task.taskId,task.leaseOwnerFingerprint]);
  const legacyEnrollConnection=()=>enroller.client.query("select public.enroll_square_verified_connection_v1($1::jsonb,$2::jsonb) as value",[JSON.stringify(context),JSON.stringify({connectionId:connection.connectionId,generation:1})]);
  equal((await legacyResolve()).rows[0].value,grant,"negative control proves inherited runtime bypass before correction");
  equal((await legacyEnrollConnection()).rows[0].value.enrolled,true,"negative control proves inherited enroller bypass before correction");
  await enroller.client.query("begin");
  try {
    const beforeFenceTask=await enroller.client.query("select public.enroll_square_verified_task_v1($1::jsonb) as value",[JSON.stringify({...taskCommand,taskId:uuid()})]);
    ok(beforeFenceTask.rows[0].value,"negative control proves inherited task creation bypass before correction");
  } finally {await enroller.client.query("rollback");}
  const fenceSql=fs.readFileSync(path.join(root,"supabase/migrations",fencingMigration),"utf8"), fenceEnd=fenceSql.lastIndexOf("commit;");
  await assert.rejects(()=>owner.query(fenceSql.slice(0,fenceEnd)+"select 1/0;\n"+fenceSql.slice(fenceEnd)),{code:"22012"});assertions++;
  await owner.query("rollback");
  equal((await legacyResolve()).rows[0].value,grant,"failed correction install leaves original behavior atomically");
  const beforeFencingRoutines=await existing();
  await runtime.applyMigrations(owner,[fencingMigration]);
  const changedRoutines=new Set(["assert_square_verified_account_v1","enroll_square_verified_connection_v1"]);
  const afterFencingRoutines=(await existing()).filter(row=>row.proname!=="assert_square_gcp_mapped_connection_v1");
  equal(afterFencingRoutines.filter(row=>!changedRoutines.has(row.proname)),beforeFencingRoutines.filter(row=>!changedRoutines.has(row.proname)),"fencing changes only the two intended existing routine bodies");
  const withoutBody=row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=="body"));
  equal(afterFencingRoutines.filter(row=>changedRoutines.has(row.proname)).map(withoutBody),beforeFencingRoutines.filter(row=>changedRoutines.has(row.proname)).map(withoutBody),"changed routines retain exact owners and execution grants");
  const legacyRuntimeCalls=[
    ()=>legacyResolve(),
    ()=>worker.client.query("select public.acquire_square_ingestion_page_v1($1,$2,$3::jsonb)",[task.taskId,task.leaseOwnerFingerprint,JSON.stringify(binding)]),
    ()=>worker.client.query("select public.commit_square_ingestion_page_v1($1,$2,'{}'::jsonb)",[task.taskId,task.leaseOwnerFingerprint]),
    ()=>worker.client.query("select public.release_square_ingestion_page_v1($1,$2,'{}'::jsonb,'{}'::jsonb)",[task.taskId,task.leaseOwnerFingerprint])
  ];
  for(const run of legacyRuntimeCalls)await denied(run,"all inherited runtime endpoints honor mapped disabled gate","square_gcp_mapped_runtime_denied");
  await denied(legacyEnrollConnection,"inherited connection enrollment honors mapped gate","square_gcp_mapped_runtime_denied");
  const legacyEnrollTask=()=>enroller.client.query("select public.enroll_square_verified_task_v1($1::jsonb)",[JSON.stringify({...taskCommand,taskId:uuid()})]);
  await denied(legacyEnrollTask,"inherited task enrollment honors mapped gate","square_gcp_mapped_runtime_denied");
  equal((await legacyRead(remoteReadCommand)).rows[0].value.state,"available","correction preserves unrelated Vercel credential authority");
  equal((await other.client.query("select public.resolve_square_ingestion_authority_v1($1,$2) as value",[remoteTask.taskId,remoteTask.leaseOwnerFingerprint])).rows[0].value,remoteGrant,"unrelated remote runtime unaffected by mapped disabled gate");
  await owner.query("update private.square_gcp_mapped_runtime_binding set enabled=true");
  equal((await read()).rows[0].value.state,"available","recovery does not recreate consent or credential");
  equal((await legacyResolve()).rows[0].value,grant,"valid mapped legacy entry retains supported behavior");
  await owner.query("update private.square_gcp_mapped_runtime_binding set provider_calls_enabled=false");
  await denied(legacyResolve,"inherited runtime cannot bypass provider-call gate","square_gcp_mapped_runtime_denied");
  await denied(legacyEnrollTask,"inherited task enrollment cannot bypass provider-call gate","square_gcp_mapped_runtime_denied");
  equal((await legacyEnrollConnection()).rows[0].value.enrolled,true,"non-provider connection enrollment remains supported when provider gate closed");
  await owner.query("update private.square_gcp_mapped_runtime_binding set provider_calls_enabled=true");
  await owner.query(`alter role "${broker.name}" nologin`);
  await denied(read,"NOLOGIN fences existing broker connections");
  await owner.query(`alter role "${broker.name}" login`);
  await owner.query(`grant square_ingestion_runtime_authority to "${broker.name}"`);
  await denied(read,"combined broker/runtime membership denied");
  await owner.query(`revoke square_ingestion_runtime_authority from "${broker.name}"`);
  for(const isolation of ["repeatable read","serializable"]) {
    await broker.client.query("begin isolation level "+isolation);
    await denied(()=>get(broker.client),"stale snapshot transactions denied");await broker.client.query("rollback");
  }
  const lockerLogin=await runtime.login(database,"lock_probe",[],"square_sandbox"), locker=lockerLogin.client;
  await owner.query(`grant usage on schema auth to "${lockerLogin.name}"`);
  await owner.query(`grant select,update on auth.sessions to "${lockerLogin.name}"`);
  await locker.query("begin");await locker.query("select 1 from auth.sessions where id=$1 for update",[session]);
  const pending=read().then(()=>null,error=>error);
  const pid=(await owner.query("select pid from pg_stat_activity where usename=$1 and wait_event_type='Lock'",[broker.name])).rows;
  // Wait only for the exact owned backend's lock, never an arbitrary timer result.
  let waiting=pid.length>0;
  for(let i=0;!waiting&&i<100;i++){await new Promise(r=>setTimeout(r,10));waiting=(await owner.query("select 1 from pg_stat_activity where usename=$1 and wait_event_type='Lock'",[broker.name])).rowCount>0;}
  ok(waiting,"read reached actual session lock wait");
  await locker.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[session]);await locker.query("commit");
  equal((await pending)?.code,"42501","session expiration during lock wait fences credential read");await locker.end();
  await denied(legacyResolve,"inherited runtime honors expired operator session","square_gcp_mapped_runtime_denied");
  await denied(legacyEnrollConnection,"inherited enroller honors expired operator session","square_account_actor_denied");
  await owner.query("update auth.sessions set not_after=clock_timestamp()+interval '1 day' where id=$1",[session]);
  await owner.query(`alter role "${worker.name}" nologin`);
  await denied(legacyResolve,"inherited existing runtime session honors NOLOGIN","square_gcp_mapped_runtime_denied");
  await owner.query(`alter role "${worker.name}" login`);
  const scanLocker=await runtime.login(database,"scan_lock",[],"square_sandbox");
  await owner.query(`grant usage on schema private to "${scanLocker.name}"`);
  await owner.query(`grant select,update on private.square_ingestion_scans to "${scanLocker.name}"`);
  await owner.query(`create policy synthetic_mapped_scan_lock on private.square_ingestion_scans to "${scanLocker.name}" using(true) with check(true)`);
  const approval=(await owner.query("select approval_expires_at::text as value from private.square_gcp_mapped_runtime_binding")).rows[0].value;
  await scanLocker.client.query("begin");await scanLocker.client.query("select 1 from private.square_ingestion_scans where scan_key=$1 for update",[binding.scanKey]);
  await owner.query("update private.square_gcp_mapped_runtime_binding set approval_expires_at=clock_timestamp()+interval '600 milliseconds'");
  const pendingAcquire=legacyRuntimeCalls[1]().then(()=>null,error=>error);
  let scanWaiting=false;
  for(let i=0;!scanWaiting&&i<50;i++){await new Promise(r=>setTimeout(r,10));scanWaiting=(await owner.query("select 1 from pg_stat_activity where usename=$1 and wait_event_type='Lock'",[worker.name])).rowCount>0;}
  ok(scanWaiting,"original acquire reached actual scan lock wait");
  await new Promise(r=>setTimeout(r,650));await scanLocker.client.query("commit");
  equal((await pendingAcquire)?.code,"42501","mapped wall-time expiry rechecked after original scan lock wait");
  await owner.query("update private.square_gcp_mapped_runtime_binding set approval_expires_at=$1::timestamptz",[approval]);
  stage="atomic_page_and_recovery";
  await repository.release(acquired.lease,{now:Date.now(),retryAfterMs:0,blocked:false});
  const {createSquareDatabaseAuthority}=require(path.join(root,"lib/integrations/providers/square/durable-authority.ts"));
  const {createSquareDormantIngestionAdapter}=require(path.join(root,"lib/integrations/providers/square/ingestion-adapter.ts"));
  let capturedPage, readOnlyCalls=0;
  const adapter=createSquareDormantIngestionAdapter({
    authority:createSquareDatabaseAuthority({...task,client:mappedRpc(worker.client)}),
    repository:{...repository,async commitPage(command){capturedPage=command;await repository.commitPage(command);throw new Error("synthetic_lost_commit_ack");}},
    transport:async request=>{readOnlyCalls++;equal(request.url,grant.request.url,"only enrolled read request reaches synthetic transport");
      return {status:200,url:request.url,redirected:false,headers:{"content-type":"application/json"},body:(async function*(){yield Buffer.from('{"payments":[]}');})(),cancel(){}};}
  });
  await adapter.run({taskId:task.taskId});
  equal(readOnlyCalls,1,"exact single read-only synthetic page");
  ok(capturedPage,"real checked adapter produces complete atomic page command");
  equal((await repository.commitPage(capturedPage)).outcome,"replayed","lost acknowledgement reconciles immutable receipt");
  equal((await owner.query("select checkpoint_version::int as n from private.square_ingestion_scans where connection_id=$1",[connection.connectionId])).rows[0].n,1,"single atomic checkpoint after recovery");
  await owner.query("update private.square_account_connections set state='disconnected' where connection_id=$1",[connection.connectionId]);
  await denied(read,"local disconnect fences existing broker session");
  equal(providerCalls,10,"only two injected synthetic consent fixtures; no actual provider network");
  equal(await runtime.sourceSchemaFingerprint(owner),before,"QBO remains exact after mapped cases");
  console.log(`Square GCP mapped database qualification passed (${assertions} assertions).`);
}
runAdditionalQualification(qualify).catch(error=>{
  process.stderr.write(`Square GCP mapped database qualification failed at ${stage} (${typeof error.code==="string"&&/^[A-Z0-9_]+$/.test(error.code)?error.code:"fixed_failure"}).\n`);
  if(error.code==="ERR_ASSERTION")process.stderr.write(String(error.message).split("\n")[0]+"\n");
  if(lastFailure)process.stderr.write("Checked database failure: "+JSON.stringify(lastFailure)+"\n");
  process.exitCode=1;
});
