/* Synthetic provider + real checked LOGIN/RPC qualification. Never a hosted DB or Square call. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { runAdditionalQualification } = require("./run-square-durable-page-qualification.js");

const root = path.resolve(__dirname, "..");
const migrationName = "20260907174326_square_dormant_account_connection.sql";
const applicationId = "SYNTHETIC_ACCOUNT_CONNECTION_APPLICATION";
const redirectUri = "https://square-qualification.invalid/api/integrations/square/callback";
const kmsKeyResource = "projects/square-qualification/locations/global/keyRings/synthetic/cryptoKeys/credential";
const CANARY = "SYNTHETIC_PRIVATE_ACCOUNT_CONNECTION_CANARY";
const RAW_CANARY = "SYNTHETIC_RAW_LOCATION_CONTACT_CANARY";
const merchantId = "MERCHANT_SYNTHETIC_1";
let assertions = 0, scenarios = 0, stage = "startup", lastFailure = null, lastOperation = null, providerTrace = null;
const equal = (actual, expected, label) => { assertions++; assert.deepEqual(actual, expected, label); };
const ok = (value, label) => { assertions++; assert.ok(value, label); };
const uuid = () => crypto.randomUUID();
const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
const safeCode = error => /^[A-Z0-9_]{1,30}$/.test(String(error?.code)) ? String(error.code) : "test_failure";
async function denied(run, label) {
  let caught;
  try { await run(); } catch (error) { caught = error; }
  ok(caught, label);
  ok(!String(caught?.message).includes(CANARY) && !String(caught?.message).includes(RAW_CANARY), "failure is payload-free");
  scenarios++;
}
function barrier() {
  let arrived, release;
  const reached = new Promise(resolve => { arrived = resolve; });
  const opened = new Promise(resolve => { release = resolve; });
  return { reached, release, async wait() { arrived(); await opened; } };
}
async function reach(hold, pending) {
  await Promise.race([hold.reached, pending.then(() => { throw new Error("expected_provider_barrier_not_reached"); })]);
}

function rpc(client, hooks = {}) {
  return { async rpc(name, args) {
    if (!/^(square_account_[a-z_]+_v1|enroll_square_verified_[a-z_]+_v1|record_square_account_revocation_v1|resolve_square_ingestion_authority_v1|acquire_square_ingestion_page_v1|commit_square_ingestion_page_v1|release_square_ingestion_page_v1)$/.test(name) ||
        Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw new Error("qualification_rpc_not_allowlisted");
    try {
      lastOperation = { name, operation: args.p_operation ?? null };
      if (hooks.before) await hooks.before(name, args);
      const fields = Object.keys(args);
      const result = await client.query(`select public.${name}(${fields.map((key, index) => `${key} => $${index + 1}`).join(",")}) as value`,
        fields.map(key => args[key] !== null && typeof args[key] === "object" ? JSON.stringify(args[key]) : args[key]));
      if (hooks.after) await hooks.after(name, args, result.rows[0].value);
      return { data: result.rows[0].value, error: null };
    } catch (error) {
      lastFailure = { operation: name, action: args.p_operation ?? null, code: safeCode(error),
        reason: /^square_[a-z_]{1,80}$/.test(String(error.message)) ? error.message : null };
      return { data: null, error: { code: safeCode(error) } };
    }
  } };
}

function syntheticProvider(scopes) {
  const issued = new Map();
  const calls = [];
  providerTrace = calls;
  let tokenSerial = 0, tokenBarrier = null, refreshBarrier = null, nextMerchant = merchantId;
  let statusChange = null, discoveryChange = null, nextRefreshFailure = null, sharedTokens = false;
  const tokenFingerprints = [], tokenIssuanceTimes = [];
  function response(value, status = 200) {
    const bytes = Buffer.from(JSON.stringify(value));
    return { status, body: (async function*() {
      for (let offset = 0; offset < bytes.length; offset += 19) yield bytes.subarray(offset, offset + 19);
    })(), close() {} };
  }
  const transport = async input => {
    const url = new URL(input.url);
    assert.equal(url.origin, "https://connect.squareupsandbox.com", "injected requests stay exactly sandbox bound");
    const body = input.body === null ? null : JSON.parse(input.body);
    const operation = url.pathname === "/oauth2/token" ? body.grant_type : url.pathname;
    // Select the synthetic response when this invocation starts. An outstanding
    // sibling refresh must keep its own successful response while another fails.
    const refreshFailure = operation === "refresh_token" ? nextRefreshFailure : null;
    if (operation === "refresh_token") nextRefreshFailure = null;
    calls.push(operation);
    if (input.signal.aborted) throw new Error(CANARY);
    if (operation === "authorization_code" && tokenBarrier) { const hold = tokenBarrier; tokenBarrier = null; await hold.wait(); }
    if (operation === "refresh_token" && refreshBarrier) { const hold = refreshBarrier; refreshBarrier = null; await hold.wait(); }
    if (refreshFailure) return response({ errors: [{ category: refreshFailure === "INTERNAL_SERVER_ERROR" ? "API_ERROR" : "AUTHENTICATION_ERROR",
      code: refreshFailure, detail: CANARY }] }, refreshFailure === "INTERNAL_SERVER_ERROR" ? 503 : 401);
    if (url.pathname === "/oauth2/token") {
      const seller = nextMerchant;
      const expiresAt = new Date(Date.now() + 86400_000).toISOString();
      tokenIssuanceTimes.push(Date.parse(expiresAt) - 86400_000);
      const accessToken = `ACCESS_${CANARY}_${sharedTokens ? seller : ++tokenSerial}`;
      tokenFingerprints.push(crypto.createHash("sha256").update(accessToken).update(`REFRESH_${CANARY}_${seller}`).digest("hex"));
      issued.set(accessToken, { merchantId: seller, expiresAt });
      return response({ access_token: accessToken, refresh_token: `REFRESH_${CANARY}_${seller}`, token_type: "bearer",
        short_lived: true, merchant_id: seller, expires_at: expiresAt });
    }
    if (url.pathname === "/oauth2/revoke") return response({ success: true });
    const token = input.headers.Authorization?.replace(/^Bearer /, "");
    const context = issued.get(token);
    if (!context) return response({ errors: [{ detail: CANARY }] }, 401);
    if (url.pathname === "/oauth2/token/status") return response({ scopes, client_id: applicationId,
      merchant_id: context.merchantId, expires_at: context.expiresAt, ...statusChange });
    const location = (number, status = "ACTIVE") => ({ id: `LOC_SYNTHETIC_${number}`, name: `Synthetic location ${number}`,
      status, merchant_id: context.merchantId, country: "US", currency: "USD", timezone: "America/Los_Angeles", phone_number: RAW_CANARY,
      coordinates: { latitude: 33.7889, longitude: -84.3841 } });
    let value;
    if (url.pathname === "/v2/merchants/me") value = { merchant: { id: context.merchantId, business_name: "Synthetic seller",
      status: "ACTIVE", country: "US", main_location_id: "LOC_SYNTHETIC_1" } };
    else if (url.pathname === "/v2/locations") value = { locations: [location(1), location(2), location(3, "INACTIVE")] };
    else if (url.pathname === "/v2/locations/main") value = { location: location(1) };
    else throw new Error("unexpected_synthetic_provider_operation");
    return response(discoveryChange ? discoveryChange(url.pathname, value) : value);
  };
  return { transport, calls, tokenFingerprints, tokenIssuanceTimes,
    set merchant(value) { nextMerchant = value; }, set statusChange(value) { statusChange = value; },
    set discoveryChange(value) { discoveryChange = value; },
    set sharedTokens(value) { sharedTokens = value; },
    failNextRefresh(code) { assert.ok(["ACCESS_TOKEN_REVOKED", "ACCESS_TOKEN_EXPIRED", "INVALID_GRANT", "UNAUTHORIZED", "INTERNAL_SERVER_ERROR"].includes(code)); nextRefreshFailure = code; },
    holdCode() { tokenBarrier = barrier(); return tokenBarrier; }, holdRefresh() { refreshBarrier = barrier(); return refreshBarrier; }
  };
}

async function migrationTests(runtime) {
  stage = "migration_clean_install";
  const names = runtime.migrationFiles(), baseline = names.filter(name => name < migrationName);
  equal(names.filter(name => name >= migrationName), [migrationName, "20260907225626_square_remote_sandbox_binding.sql", "20260908014713_square_broker_runtime_credential_authority.sql", "20260908042529_square_gcp_callback_authority.sql", "20260910193429_square_gcp_callback_oregon_recovery.sql", "20260910231437_square_gcp_mapped_runtime.sql"],
    "account and separately qualified remote Sandbox and broker corrections are the exact additive tail");
  const clean = await runtime.createDatabase("account_clean");
  await runtime.applyMigrations(clean.client, baseline);
  const fingerprint = await runtime.sourceSchemaFingerprint(clean.client);
  await runtime.applyMigrations(clean.client, [migrationName]);
  equal(await runtime.sourceSchemaFingerprint(clean.client), fingerprint, "all non-Square functions, schema, roles, ACLs and QBO remain exact");
  equal((await clean.client.query("select count(*)::int as n from private.square_account_configuration")).rows[0].n, 0, "migration enables no application configuration");
  equal((await clean.client.query("select count(*)::int as n from private.square_qualification_gate")).rows[0].n, 0, "no synthetic enrollment marker reused or installed");
  scenarios++;

  stage = "migration_upgrade_rollback_retry";
  const upgrade = await runtime.createDatabase("account_upgrade");
  await runtime.applyMigrations(upgrade.client, baseline);
  await upgrade.client.query(fs.readFileSync(path.join(root, "supabase/tests/fixtures/square-durable-upgrade-history.sql"), "utf8"));
  const historySql = "select row_to_json(v) as value from private.external_source_record_versions v where source_record_id='99000000-0000-4000-8000-000000000004' order by immutable_version";
  const history = (await upgrade.client.query(historySql)).rows;
  const before = await runtime.sourceSchemaFingerprint(upgrade.client);
  const sql = fs.readFileSync(path.join(root, "supabase/migrations", migrationName), "utf8"), commit = sql.toLowerCase().lastIndexOf("commit;");
  ok(commit > 0, "migration has explicit COMMIT");
  let interrupted = false;
  try { await upgrade.client.query(sql.slice(0, commit) + "select 1/0;\n" + sql.slice(commit)); }
  catch (error) { interrupted = error.code === "22012"; await upgrade.client.query("rollback"); }
  ok(interrupted, "injected failure occurs immediately before COMMIT");
  equal((await upgrade.client.query("select to_regclass('private.square_account_connections') as value")).rows[0].value, null, "failed account migration leaves no partial table");
  equal(await runtime.sourceSchemaFingerprint(upgrade.client), before, "failed migration preserves existing non-Square definitions");
  await runtime.applyMigrations(upgrade.client, [migrationName]);
  equal(await runtime.sourceSchemaFingerprint(upgrade.client), before, "forward retry preserves QBO definitions");
  equal((await upgrade.client.query(historySql)).rows, history, "upgrade/rollback/retry preserve immutable historical bytes");
  equal((await upgrade.client.query("select current_version_id from private.external_source_records where id='99000000-0000-4000-8000-000000000004'")).rows[0].current_version_id,
    "99000000-0000-4000-8000-000000000007", "existing tombstone/current pointer remains exact");
  await denied(() => upgrade.client.query("update private.external_source_record_versions set normalized_schema_version='forbidden' where source_record_id='99000000-0000-4000-8000-000000000004'"), "historical mutation protection survives");
  // Historical account installation/rollback assertions above retain their
  // original baseline. Existing lifecycle/browser scenarios run the final chain.
  for (const tail of ["20260907225626_square_remote_sandbox_binding.sql", "20260908014713_square_broker_runtime_credential_authority.sql", "20260908042529_square_gcp_callback_authority.sql"]) {
    for (const database of [clean, upgrade]) {
      const prior = await runtime.sourceSchemaFingerprint(database.client);
      await runtime.applyMigrations(database.client, [tail]);
      equal(await runtime.sourceSchemaFingerprint(database.client), prior, "each explicit tail preserves non-Square and QBO definitions/ACLs");
    }
  }
  equal((await upgrade.client.query(historySql)).rows, history, "final migration chain preserves immutable historical bytes");
  return clean;
}

async function integratedTests(runtime, database) {
  runtime.installTypescriptLoader();
  const { createSquareAccountConnectionService } = require(path.join(root, "lib/integrations/providers/square/account-connection-service.ts"));
  const { ProviderApplicationSecret } = require(path.join(root, "lib/integrations/credentials/secret-manager.ts"));
  const { SQUARE_OAUTH_SCOPES, createSquareOAuthPolicy, createSquareOAuthCredentialProvider } = require(path.join(root, "lib/integrations/providers/square/account-connection-oauth.ts"));
  const { IntegrationCredentialBroker } = require(path.join(root, "lib/integrations/credentials/broker.ts"));
  const { createSquareAccountBrokerStore, squareCredentialReadLeaseId } = require(path.join(root, "lib/integrations/providers/square/account-connection-broker.ts"));
  const owner = database.client;
  const broker = await runtime.login(database, "account_broker", ["square_account_broker_authority", "square_ingestion_runtime_authority"]);
  const enrollment = await runtime.login(database, "account_enrollment", ["square_verified_enrollment_authority"]);
  const webhook = await runtime.login(database, "account_webhook", ["square_account_broker_authority"]);
  const outsider = await runtime.login(database, "account_outsider");
  const wrongLogin = await runtime.login(database, "account_wrong_login", ["square_account_broker_authority"]);
  const secondSession = await runtime.connect(broker.connection);
  const user = uuid(), session = uuid(), workspace = uuid(), entity = uuid(), foreignEntity = uuid(), foreignUser = uuid(), foreignSession = uuid();
  await owner.query("insert into auth.users(id,email) values($1,'square-account-fixture@example.invalid'),($2,'square-account-foreign@example.invalid')", [user, foreignUser]);
  await owner.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,clock_timestamp()+interval '1 day'),($3,$4,clock_timestamp()+interval '1 day')", [session, user, foreignSession, foreignUser]);
  await owner.query("insert into public.workspaces(id,name,created_by) values($1,'Disposable account connection',$2)", [workspace, user]);
  await owner.query("insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active'),($1,$3,'admin','active') on conflict(workspace_id,user_id) where user_id is not null do update set role=excluded.role,status=excluded.status", [workspace, user, foreignUser]);
  await owner.query("insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,status,created_by,updated_by) values($1,$2,'synthetic_account','Synthetic account entity','USD','UTC','active',$3,$3),($4,$2,'synthetic_account_other','Other synthetic entity','USD','UTC','active',$3,$3)", [entity, workspace, user, foreignEntity]);
  const actor = { actorId: user, workspaceId: workspace, sessionId: session, role: "owner" };
  const context = { actor, environment: "sandbox", applicationId, redirectUri };
  const provider = syntheticProvider([...SQUARE_OAUTH_SCOPES]);
  const key = crypto.randomBytes(32);
  const kms = {
    async encrypt(input) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(input.additionalAuthenticatedData));
      return Buffer.concat([iv, cipher.update(input.plaintext), cipher.final(), cipher.getAuthTag()]); },
    async decrypt(input) { const bytes = Buffer.from(input.ciphertext), decipher = crypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(input.additionalAuthenticatedData)); decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]); }
  };
  const secret = new ProviderApplicationSecret({ schemaVersion: "provider_application_secret_v1", providerKey: "square", environment: "sandbox", clientId: applicationId, clientSecret: CANARY });
  const secrets = { async access() { return secret; } };
  const makeService = (overrides = {}) => createSquareAccountConnectionService({ client: rpc(broker.client), enrollmentClient: rpc(enrollment.client),
    webhookClient: rpc(webhook.client), environment: "sandbox", applicationId, redirectUri, secrets, kms, kmsKeyResource,
    transport: provider.transport, ...overrides });
  const service = makeService(), concurrentService = makeService({ client: rpc(secondSession) });
  const policy = createSquareOAuthPolicy({ environment: "sandbox", applicationId, redirectUri, returnPath: "/app/settings/integrations/square" });
  const credentialBrokerFor = currentContext => new IntegrationCredentialBroker({
    store: createSquareAccountBrokerStore({ client: rpc(broker.client), context: currentContext }),
    kms, kmsKeyResource, secrets, providerOAuthPolicy: policy,
    provider: createSquareOAuthCredentialProvider({ policy, applicationId, transport: provider.transport })
  });
  const connectionRow = async connectionId => (await owner.query("select * from private.square_account_connections where connection_id=$1", [connectionId])).rows[0];
  const connectionFootprint = async connectionId => {
    const footprint = {};
    for (const table of ["square_account_connections", "square_account_oauth_states", "square_account_credentials", "square_account_credential_reads",
      "square_account_enrollments", "square_account_audit_events", "square_connections", "square_connection_generations", "square_location_mappings",
      "square_ingestion_tasks", "square_ingestion_scans", "square_ingestion_versions"]) {
      footprint[table] = (await owner.query(`select row_to_json(t) as value from private.${table} t where connection_id=$1 order by row_to_json(t)::text`, [connectionId])).rows;
    }
    return footprint;
  };
  async function assertDisconnectedRefreshUnavailable(connectionId) {
    const before = await connectionFootprint(connectionId), callsBefore = provider.calls.length;
    let secretCalls = 0;
    const unavailable = await makeService({ secrets: { async access() { secretCalls++; throw new Error(CANARY); } } }).refresh(actor, connectionId);
    equal(unavailable, { state: "credential_unavailable", refreshed: false, reasonCode: "refresh_not_acquired" }, "disconnected refresh returns the existing safe inactive-credential result");
    equal(provider.calls.length, callsBefore, "inactive credential performs no provider transport");
    equal(secretCalls, 0, "inactive credential performs no secret access");
    equal(await connectionFootprint(connectionId), before, "inactive refresh changes no state, version, credential or durable work");
  }
  const stateRow = async state => (await owner.query("select s.* from private.square_account_oauth_states s where state_hash=$1", [`sha256:${crypto.createHash("sha256").update(state).digest("hex")}`])).rows[0];
  const start = async (current = service, input = {}) => {
    const result = await current.initiate(actor, { operation: "connect", businessEntityId: entity, ...input });
    const url = new URL(result.authorizationUrl), state = url.searchParams.get("state"), row = await stateRow(state);
    ok(row, "initiation persisted hashed state through actual broker LOGIN");
    ok(!JSON.stringify(row).includes(state), "plaintext state is not stored");
    return { state, connectionId: row.connection_id, url };
  };
  const complete = (authorization, current = service) => current.complete(actor, { state: authorization.state, code: "synthetic-authorization-code" });
  const connected = async current => { const authorization = await start(current); await complete(authorization, current); return authorization; };

  stage = "closed_configuration_and_login_authority";
  await denied(() => service.snapshot(actor), "empty configuration blocks account routes/service");
  await owner.query(`insert into private.square_account_configuration(environment,application_id,redirect_uri,broker_login,enrollment_login,webhook_login,kms_key_resource,surface_enabled,enrollment_enabled,approval_expires_at)
    values('sandbox',$1,$2,$3,$4,$5,$6,true,false,clock_timestamp()+interval '1 day')`, [applicationId, redirectUri, broker.name, enrollment.name, webhook.name, kmsKeyResource]);
  equal((await service.snapshot(actor)).connections, [], "enabled synthetic surface exposes only empty safe state");
  for (const login of [outsider, wrongLogin]) await denied(() => login.client.query("select public.square_account_connection_v1($1::jsonb,'status','{}'::jsonb)", [JSON.stringify(context)]), "ordinary/foreign actual LOGIN cannot impersonate configured broker");
  await outsider.client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: session, role: "service_role" })]);
  await denied(() => outsider.client.query("select public.square_account_connection_v1($1::jsonb,'status','{}'::jsonb)", [JSON.stringify(context)]), "forged request GUC cannot grant account capability");
  await denied(() => broker.client.query("select * from private.square_account_credentials"), "broker cannot directly read encrypted credential table");
  await denied(() => broker.client.query(`set role ${quote(enrollment.name)}`), "broker cannot assume verified enrollment login");
  for (const changed of [{ ...actor, actorId: foreignUser }, { ...actor, workspaceId: uuid() }, { ...actor, sessionId: foreignSession }, { ...actor, role: "admin" }]) {
    await denied(() => service.snapshot(changed), "actor/workspace/session/role mismatch rejected by current database authority");
  }
  for (const overrides of [{ environment: "production" }, { applicationId: "FOREIGN_SYNTHETIC_APPLICATION" }, { redirectUri: "https://foreign.invalid/callback" }])
    await denied(() => makeService(overrides).snapshot(actor), "environment/application/redirect binding remains exact");

  stage = "authorization_discovery_mapping_retention";
  const primary = await connected();
  equal((await connectionRow(primary.connectionId)).state, "mapping_required", "OAuth alone does not enroll authority");
  equal((await service.snapshot(actor)).connections[0].sellerLabel, "Synthetic seller", "customer display derives from authenticated merchant response");
  const mapping = { connectionId: primary.connectionId, businessEntityId: entity, locationIds: ["LOC_SYNTHETIC_1", "LOC_SYNTHETIC_2"], confirmation: "map" };
  await denied(() => service.confirmMapping(actor, mapping), "missing explicit finite retention approval leaves enrollment closed");
  equal((await owner.query("select count(*)::int as n from private.square_connections")).rows[0].n, 0, "missing policy creates no durable connection");
  await owner.query("update private.square_account_configuration set enrollment_enabled=true,retention_policy_version='synthetic_test_retention_v1',retention_approval_fingerprint=$1,source_retention_seconds=3600,cursor_retention_seconds=3600,revocation_access_policy='deny_source_access'", [`sha256:${"a".repeat(64)}`]);
  for (const bad of [{ ...mapping, businessEntityId: foreignEntity }, { ...mapping, locationIds: ["FOREIGN_LOCATION"] },
    { ...mapping, locationIds: ["LOC_SYNTHETIC_3"] }, { ...mapping, confirmation: "not-confirmed" }])
    await denied(() => service.confirmMapping(actor, bad), "foreign entity/location, inactive location and missing confirmation cannot enroll");
  await service.confirmMapping(actor, mapping);
  equal((await connectionRow(primary.connectionId)).state, "authorized", "confirmed policy-backed mapping authorizes only dormant connection");
  const durable = (await owner.query("select c.*,g.identity_mode from private.square_connections c join private.square_connection_generations g on g.connection_id=c.connection_id and g.connection_generation=c.current_generation where c.connection_id=$1", [primary.connectionId])).rows[0];
  equal(durable.seller_id, merchantId); equal(durable.business_entity_id, entity); equal(durable.identity_mode, "oauth_verified");
  equal((await owner.query("select count(*)::int as n from private.square_qualification_gate")).rows[0].n, 0, "verified enrollment works without synthetic qualification marker");
  const safeView = await service.snapshot(actor);
  ok(!JSON.stringify(safeView).includes(CANARY) && !JSON.stringify(safeView).includes(RAW_CANARY), "safe view omits secrets/raw discovery contact fields");
  ok(!/Synced|Current|history_complete/.test(JSON.stringify(safeView)), "authorization does not imply qualified syncing/completeness");

  stage = "mapping_generation_handoff_race";
  const oldMapping = await connected(), enrollmentHold = barrier();
  const delayedMappingService = makeService({ enrollmentClient: rpc(enrollment.client, { async before(name) {
    if (name === "enroll_square_verified_connection_v1") await enrollmentHold.wait();
  } }) });
  const oldMappingCommand = { ...mapping, connectionId: oldMapping.connectionId };
  const delayedEnrollment = delayedMappingService.confirmMapping(actor, oldMappingCommand);
  await reach(enrollmentHold, delayedEnrollment);
  const newerAuthorization = await start(service, { operation: "reauthorize", connectionId: oldMapping.connectionId });
  await complete(newerAuthorization);
  equal((await connectionRow(oldMapping.connectionId)).mapped_locations, [], "new authorization clears previous generation location confirmation");
  enrollmentHold.release();
  await denied(() => delayedEnrollment, "old mapping handoff cannot enroll a newer generation");
  equal((await connectionRow(oldMapping.connectionId)).state, "mapping_required", "late enrollment does not authorize newer consent");
  equal((await owner.query("select count(*)::int as n from private.square_account_enrollments where connection_id=$1 and generation=2", [oldMapping.connectionId])).rows[0].n, 0, "no enrollment receipt fabricated for unconfirmed newer mapping");
  await service.confirmMapping(actor, oldMappingCommand);
  equal((await connectionRow(oldMapping.connectionId)).state, "authorized", "fresh explicit mapping can enroll current generation");

  stage = "verified_enrollment_to_atomic_pending_ingestion";
  const { createSquareDormantIngestionAdapter } = require(path.join(root, "lib/integrations/providers/square/ingestion-adapter.ts"));
  const { createSquareDatabaseAuthority } = require(path.join(root, "lib/integrations/providers/square/durable-authority.ts"));
  const { createSquareDurablePageRepository } = require(path.join(root, "lib/integrations/providers/square/durable-page-repository.ts"));
  const { squareIngestionScopeFingerprint } = require(path.join(root, "lib/integrations/providers/square/ingestion-contracts.ts"));
  const { assertSquareReadOperation } = require(path.join(root, "lib/integrations/providers/square/request-validators.ts"));
  const { contractSha256 } = require(path.join(root, "lib/integrations/contracts/canonical.ts"));
  const { squarePaymentFixture } = require(path.join(root, "lib/integrations/providers/square/fixtures/payment-responses.ts"));
  const scope = { workspaceId: workspace, businessEntityId: entity, connectionId: primary.connectionId,
    sellerId: merchantId, environment: "sandbox", authorizedLocationIds: ["LOC_SYNTHETIC_1", "LOC_SYNTHETIC_2"], generation: 1 };
  const grant = { scope, stream: "payments", operation: "list_payments", scanId: uuid(), expiresAt: Date.now() + 1800_000,
    request: { method: "GET", url: "https://connect.squareupsandbox.com/v2/payments?location_id=LOC_SYNTHETIC_1", body: null } };
  const decision = assertSquareReadOperation({ providerKey: "square", providerEnvironment: "sandbox", method: "GET",
    url: grant.request.url, headers: { "Square-Version": "2026-08-19" }, body: null });
  const binding = { scanKey: contractSha256({ purpose: "square_ingestion_scan_v1", workspaceId: workspace,
    businessEntityId: entity, connectionId: primary.connectionId, stream: grant.stream, scanId: grant.scanId }),
    scopeFingerprint: squareIngestionScopeFingerprint(scope), queryFingerprint: contractSha256({ request: decision.requestFingerprint,
      operation: grant.operation, resolvedDefaultLocationId: null }), cursorBindingFingerprint: decision.cursorBindingFingerprint, generation: 1 };
  const task = { taskId: uuid(), leaseOwnerFingerprint: contractSha256(uuid()) };
  const enrolledTask = await rpc(enrollment.client).rpc("enroll_square_verified_task_v1", { p_command: { ...task,
    connectionId: primary.connectionId, generation: 1, runtimeLogin: broker.name, grant, binding } });
  equal(enrolledTask.error, null, "verified task enrollment uses separately controlled capability");
  const cursorCanary = "PRIVATE_CURSOR_CANARY_".padEnd(4096, "x");
  let ingestionCalls = 0, capturedPage, activeLease, losePageAck = true;
  const pageClient = rpc(broker.client, { after(name) {
    if (name === "commit_square_ingestion_page_v1" && losePageAck) { losePageAck = false; throw new Error(CANARY); }
  } });
  const pageRepository = createSquareDurablePageRepository({ ...task, client: pageClient });
  const authority = createSquareDatabaseAuthority({ ...task, client: rpc(broker.client) });
  const pendingAdapter = createSquareDormantIngestionAdapter({ authority,
    repository: { ...pageRepository,
      async acquire(value) { const acquired = await pageRepository.acquire(value); if (acquired.outcome === "leased") activeLease = acquired.lease; return acquired; },
      async commitPage(command) { capturedPage = command; return pageRepository.commitPage(command); } },
    transport: async request => { ingestionCalls++;
      const access = await credentialBrokerFor(context).readProviderAccessCredential({ ...task,
        leaseId: squareCredentialReadLeaseId(activeLease.leaseId), expectedCredentialVersion: 1,
        requiredScopes: SQUARE_OAUTH_SCOPES, minimumValiditySeconds: 30, requestId: uuid() });
      equal(access.state, "available", "active checked task reads and decrypts bound credential through generic broker");
      await access.credential.use(({ accessToken }) => ok(accessToken.startsWith("ACCESS_" + CANARY), "synthetic-only transport receives exact scoped access token"));
      await denied(() => access.credential.use(() => {}), "access credential cannot be reused after injected request");
      const bytes = Buffer.from(JSON.stringify({ payments: [squarePaymentFixture()], cursor: cursorCanary }));
      return { status: 200, url: request.url, redirected: false, headers: { "content-type": "application/json" },
        body: (async function*() { for (let at = 0; at < bytes.length; at += 17) yield bytes.subarray(at, at + 17); })(), cancel() {} };
    } });
  await pendingAdapter.run({ taskId: task.taskId });
  equal(losePageAck, false, "pending ingestion lost ACK was injected after real atomic commit");
  equal((await owner.query("select count(*)::int as n from private.square_ingestion_versions where connection_id=$1", [primary.connectionId])).rows[0].n, 1, "lost page ACK retains exactly one pending version");
  const source = (await owner.query("select version from private.square_ingestion_versions where connection_id=$1", [primary.connectionId])).rows[0].version;
  equal(source.validation.state, "pending"); equal(source.trust, "untrusted_external_input");
  const scan = (await owner.query("select * from private.square_ingestion_scans where connection_id=$1", [primary.connectionId])).rows[0];
  equal(scan.cursor.value, cursorCanary, "4096-character cursor stays within private durable boundary");
  equal(Number(scan.checkpoint_version), 1, "source and cursor/checkpoint advance atomically despite lost ACK");
  const freshRepository = createSquareDurablePageRepository({ ...task, client: rpc(secondSession) });
  equal((await freshRepository.commitPage(capturedPage)).outcome, "replayed", "fresh session resolves lost ACK through immutable receipt");
  const readCommand = { contractVersion: "integration_provider_credential_read_v1", taskId: task.taskId,
    leaseId: squareCredentialReadLeaseId(capturedPage.lease.leaseId), leaseOwnerFingerprint: task.leaseOwnerFingerprint,
    expectedCredentialVersion: Number((await connectionRow(primary.connectionId)).credential_version),
    requiredScopes: [...SQUARE_OAUTH_SCOPES], minimumValiditySeconds: 30, requestedAt: new Date().toISOString() };
  const releasedRead = await rpc(broker.client).rpc("square_account_connection_v1", { p_context: context, p_operation: "read_credential", p_command: readCommand });
  ok(releasedRead.error, "ready scan with cleared lease cannot release ciphertext");
  const staleLease = await freshRepository.acquire(binding);
  equal(staleLease.outcome, "leased", "fresh session resumes private cursor");
  equal(staleLease.lease.cursor.value, cursorCanary);
  equal(ingestionCalls, 1);
  ok(!JSON.stringify(await service.snapshot(actor)).includes("PRIVATE_CURSOR_CANARY"), "customer status excludes private cursor");
  const excessiveCursor = await rpc(broker.client).rpc("commit_square_ingestion_page_v1", {
    p_task_id: task.taskId, p_lease_owner_fingerprint: task.leaseOwnerFingerprint,
    p_command: { ...capturedPage, lease: staleLease.lease, pageId: contractSha256("excessive_cursor_retention"),
      nextCursor: { ...capturedPage.nextCursor, expiresAt: Date.now() + 3600_001 }, now: Date.now() }
  });
  ok(excessiveCursor.error || excessiveCursor.data?.outcome === "conflict", "cursor beyond approved retention/authority deadline cannot commit");
  equal(Number((await owner.query("select checkpoint_version from private.square_ingestion_scans where connection_id=$1", [primary.connectionId])).rows[0].checkpoint_version), 1, "excessive cursor leaves atomic checkpoint unchanged");
  await owner.query("update private.square_account_configuration set cursor_retention_seconds=3599");
  equal(await authority.resolve({ taskId: task.taskId }), null, "changed approved policy cannot reuse prior enrollment evidence");
  await owner.query("update private.square_account_configuration set cursor_retention_seconds=3600");
  ok(await authority.resolve({ taskId: task.taskId }), "exact approved policy remains bound to immutable receipt");

  stage = "state_replay_expiry_denial_and_callback_races";
  const callsBeforeReplay = provider.calls.length;
  await denied(() => complete(primary), "callback replay rejected"); equal(provider.calls.length, callsBeforeReplay, "replay never re-exchanges code");
  const deniedAuthorization = await start();
  await service.complete(actor, { state: deniedAuthorization.state, error: "access_denied" });
  equal((await stateRow(deniedAuthorization.state)).status, "denied");
  const expired = await start();
  await owner.query("update private.square_account_oauth_states set expires_at=clock_timestamp()-interval '1 second' where connection_id=$1", [expired.connectionId]);
  await denied(() => complete(expired), "expired state rejected");
  const wrongActor = await start();
  await denied(() => service.complete({ actorId: foreignUser, workspaceId: workspace, sessionId: foreignSession, role: "admin" }, { state: wrongActor.state, code: "synthetic-code" }), "another authorized workspace actor cannot consume initiating session state");
  const raced = await start(), hold = provider.holdCode();
  const first = complete(raced); await reach(hold, first);
  await denied(() => complete(raced, concurrentService), "concurrent callback loses single-use state before provider exchange");
  hold.release(); await first;
  equal((await stateRow(raced.state)).status, "stored");

  stage = "storage_faults_uncertainty_and_lost_acknowledgement";
  const secretFailure = await start();
  await denied(() => complete(secretFailure, makeService({ secrets: { async access() { throw new Error(CANARY); } } })), "secret-store failure stays closed and redacted");
  equal((await connectionRow(secretFailure.connectionId)).state, "recovery_required");
  await denied(() => complete(secretFailure), "failed consumed authorization cannot blindly replay code");
  const encryptionFailure = await start();
  await denied(() => complete(encryptionFailure, makeService({ kms: { ...kms, async encrypt() { throw new Error(CANARY); } } })), "encryption failure cannot install discovered seller alone");
  equal((await connectionRow(encryptionFailure.connectionId)).credential_id, null);
  const scopeFailure = await start(); provider.statusChange = { scopes: [...SQUARE_OAUTH_SCOPES, "PAYMENTS_WRITE"] };
  await denied(() => complete(scopeFailure), "authoritative token status with foreign scopes cannot be stored"); provider.statusChange = null;
  equal((await connectionRow(scopeFailure.connectionId)).credential_id, null);
  const cancellation = await start(), cancellationHold = provider.holdCode(), cancellationController = new AbortController();
  const cancellationPending = service.complete(actor, { state: cancellation.state, code: "synthetic-authorization-code" }, cancellationController.signal);
  await reach(cancellationHold, cancellationPending); cancellationController.abort();
  await denied(() => cancellationPending, "cancellation during outstanding exchange stays bounded and recoverable"); cancellationHold.release();
  equal((await connectionRow(cancellation.connectionId)).credential_id, null);
  await denied(() => complete(cancellation), "cancelled uncertain exchange cannot blindly replay consumed code");
  const sqlFailure = await start();
  await owner.query("create function private.square_account_test_failure_v1() returns trigger language plpgsql set search_path='' as $$ begin raise exception using errcode='40001',message='synthetic_storage_failure';end;$$; create trigger square_account_test_failure before insert on private.square_account_credentials for each row execute function private.square_account_test_failure_v1()");
  await denied(() => complete(sqlFailure), "database failure after exchange rolls back credential plus discovery");
  await owner.query("drop trigger square_account_test_failure on private.square_account_credentials;drop function private.square_account_test_failure_v1()");
  equal((await connectionRow(sqlFailure.connectionId)).discovery, null);
  let lost = false;
  const ackService = makeService({ client: rpc(broker.client, { after(name, args) {
    if (!lost && name === "square_account_connection_v1" && args.p_operation === "store_credential") { lost = true; throw new Error(CANARY); }
  } }) });
  const ack = await start(ackService);
  try { await complete(ack, ackService); } catch (error) { ok(!String(error.message).includes(CANARY), "lost ACK exposed only safe failure"); }
  ok(lost, "lost acknowledgement injected after real SQL COMMIT");
  equal((await connectionRow(ack.connectionId)).state, "mapping_required", "durable stored callback survives lost acknowledgement");
  equal((await owner.query("select count(*)::int as n from private.square_account_credentials where connection_id=$1", [ack.connectionId])).rows[0].n, 1, "lost ACK does not duplicate credential history");
  const ackCalls = provider.calls.length; await denied(() => complete(ack), "lost ACK recovery must not re-exchange consumed code"); equal(provider.calls.length, ackCalls);

  stage = "refresh_and_connection_local_disconnect";
  const beforeRefresh = Number((await connectionRow(primary.connectionId)).credential_version);
  await service.refresh(actor, primary.connectionId);
  equal(Number((await connectionRow(primary.connectionId)).credential_version), beforeRefresh + 1, "refresh CAS appends one encrypted version");
  const groupCallback = await start(), groupCallbackHold = provider.holdCode(), groupCallbackPending = complete(groupCallback);
  await reach(groupCallbackHold, groupCallbackPending);
  const callbackBeforeDisconnect = await connectionFootprint(groupCallback.connectionId), racedBeforeDisconnect = await connectionFootprint(raced.connectionId);
  const refreshRace = provider.holdRefresh(), refreshInFlight = service.refresh(actor, primary.connectionId);
  await reach(refreshRace, refreshInFlight);
  const disconnectProviderCalls = provider.calls.length;
  let disconnectSecretCalls = 0;
  await makeService({ client: rpc(secondSession), secrets: { async access() { disconnectSecretCalls++; throw new Error(CANARY); } } })
    .disconnect(actor, { connectionId: primary.connectionId, confirmation: "disconnect" });
  equal(provider.calls.length, disconnectProviderCalls, "customer disconnect performs no provider call");
  equal(disconnectSecretCalls, 0, "local disconnect requires no application secret access");
  equal(await connectionFootprint(groupCallback.connectionId), callbackBeforeDisconnect, "another pending callback is untouched by local disconnect");
  equal(await connectionFootprint(raced.connectionId), racedBeforeDisconnect, "same seller account state and credential history remain byte-for-byte unchanged");
  refreshRace.release();
  try { await refreshInFlight; } catch (error) { ok(!String(error.message).includes(CANARY), "late refresh failure is redacted"); }
  equal((await owner.query("select state from private.square_connections where connection_id=$1", [primary.connectionId])).rows[0].state, "revoked", "disconnect promptly fences durable ingestion");
  equal((await connectionRow(primary.connectionId)).state, "disconnected", "late refresh cannot restore disconnected local authority");
  equal((await connectionRow(primary.connectionId)).revocation_pending, false, "local disconnect makes no provider revocation claim or retry");
  equal(Number((await connectionRow(primary.connectionId)).credential_version), beforeRefresh + 1, "late refresh does not install returned token");
  groupCallbackHold.release();
  await groupCallbackPending;
  equal((await connectionRow(groupCallback.connectionId)).state, "mapping_required", "another same-seller callback may finish after local disconnect");
  ok((await connectionRow(groupCallback.connectionId)).credential_id, "local disconnect never fences unknown-seller callback in another connection");
  const staleCommit = await rpc(broker.client).rpc("commit_square_ingestion_page_v1", {
    p_task_id: task.taskId, p_lease_owner_fingerprint: task.leaseOwnerFingerprint,
    p_command: { ...capturedPage, lease: staleLease.lease, pageId: contractSha256("late_revoked_page") }
  });
  ok(staleCommit.error, "in-flight pre-disconnect page cannot commit after local revocation fence");
  equal((await owner.query("select count(*)::int as n from private.square_ingestion_versions where connection_id=$1", [primary.connectionId])).rows[0].n, 1, "revocation preserves pending history without additional sources");
  const callbackRace = await start(), callbackHold = provider.holdCode(), callbackPending = complete(callbackRace);
  await reach(callbackHold, callbackPending);
  await concurrentService.disconnect(actor, { connectionId: callbackRace.connectionId, confirmation: "disconnect" });
  callbackHold.release(); await denied(() => callbackPending, "late callback cannot restore disconnected authority");
  equal((await connectionRow(callbackRace.connectionId)).credential_id, null);
  equal(typeof service.retryRevocation, "undefined", "customer service exposes no merchant revocation retry capability");
  for (const operation of ["acquire_revocation", "complete_revocation"]) {
    const attempt = await rpc(broker.client).rpc("square_account_connection_v1", { p_context: context, p_operation: operation,
      p_command: { connectionId: primary.connectionId, generation: 1, rowVersion: 1, leaseId: uuid(), outcome: "succeeded" } });
    ok(attempt.error, "configured customer broker cannot invoke a legacy merchant-revocation operation");
  }
  await assertDisconnectedRefreshUnavailable(primary.connectionId);
  await denied(() => service.confirmMapping(actor, mapping), "disconnected account cannot enroll mapping");
  ok((await owner.query("select count(*)::int as n from private.square_account_credentials where connection_id=$1", [primary.connectionId])).rows[0].n > 0, "disconnect does not purge encrypted historical credentials");

  stage = "reauthorization_and_authenticated_notification";
  const reauthorized = await start(service, { operation: "reauthorize", connectionId: primary.connectionId });
  await complete(reauthorized);
  equal((await connectionRow(primary.connectionId)).merchant_id, merchantId);
  equal(Number((await connectionRow(primary.connectionId)).generation), 2, "reconnect advances generation instead of reviving old tasks");
  await service.confirmMapping(actor, mapping);
  const foreignSeller = await start(service, { operation: "reauthorize", connectionId: primary.connectionId });
  provider.merchant = "FOREIGN_SYNTHETIC_SELLER";
  await denied(() => complete(foreignSeller), "reauthorization cannot silently replace connected seller"); provider.merchant = merchantId;
  equal((await connectionRow(primary.connectionId)).merchant_id, merchantId);
  const notified = await connected();
  const notificationUrl = "https://square-qualification.invalid/api/integrations/square/revocation";
  const signatureKey = "SYNTHETIC_WEBHOOK_SIGNATURE_KEY_000000";
  const event = { merchant_id: merchantId, type: "oauth.authorization.revoked", event_id: "synthetic-account-revocation-event",
    created_at: new Date().toISOString(), data: { type: "revocation", object: { revocation: { revoked_at: new Date().toISOString(), revoker_type: "MERCHANT" } } } };
  const rawBody = JSON.stringify(event);
  const notification = { rawBody, notificationUrl, signatureKey,
    signature: crypto.createHmac("sha256", signatureKey).update(notificationUrl).update(rawBody).digest("base64") };
  await denied(() => service.handleRevocationNotification({ ...notification, signature: "forged" }), "forged provider notification cannot revoke accounts");
  equal((await connectionRow(notified.connectionId)).state, "mapping_required");
  await service.handleRevocationNotification(notification);
  equal((await connectionRow(notified.connectionId)).state, "revoked", "authenticated merchant revocation fences matching app/environment");
  await service.handleRevocationNotification(notification);
  equal((await owner.query("select count(*)::int as n from private.square_account_revocation_events where event_id=$1", [event.event_id])).rows[0].n, 1, "durable event replay does not duplicate revocation evidence");

  stage = "real_database_shared_browser_flow";
  const { runSquareAccountBrowserQualification } = require("./square-account-browser-test-support.js");
  const browserLibrary = process.env.SQUARE_QUALIFICATION_PLAYWRIGHT_PATH;
  if (browserLibrary && !path.isAbsolute(browserLibrary)) throw new Error("explicit_browser_library_path_invalid");
  const { chromium } = require(browserLibrary || "playwright");
  const browserWorkspace = uuid(), browserEntity = uuid(), browserSession = uuid();
  await owner.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,clock_timestamp()+interval '1 day')", [browserSession, user]);
  await owner.query("insert into public.workspaces(id,name,created_by) values($1,'Disposable browser connection',$2)", [browserWorkspace, user]);
  await owner.query("insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active') on conflict(workspace_id,user_id) where user_id is not null do update set role=excluded.role,status=excluded.status", [browserWorkspace, user]);
  await owner.query("insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,status,created_by,updated_by) values($1,$2,'synthetic_browser','Synthetic browser entity','USD','America/Los_Angeles','active',$3,$3)", [browserEntity, browserWorkspace, user]);
  const browserActor = { actorId: user, sessionId: browserSession, workspaceId: browserWorkspace, role: "owner" };
  const browserContext = { ...context, actor: browserActor };
  const hostCookieName = "square_test_session", hostCookie = crypto.randomBytes(32).toString("base64url");
  const browserCode = "BROWSER_" + CANARY;
  let browserConnectionId, browserTask, browserPage, browserLease;
  const browserEvidence = await runSquareAccountBrowserQualification({
    chromium, browserExecutable: process.env.SQUARE_QUALIFICATION_BROWSER_EXECUTABLE,
    bootstrapPath: "/__square_host_session/start", sessionCookieName: hostCookieName,
    businessEntityId: browserEntity, locationLabel: "Synthetic location 1", disconnectLabel: "Disconnected from this workspace",
    privacyCanaries: [CANARY, RAW_CANARY, browserCode, "PRIVATE_CURSOR_CANARY"],
    createDependencies(origin) {
      return { qualification: "disposable_local_synthetic_only", applicationOrigin: origin, service,
        async authenticate(request) {
          if (new URL(request.url).origin !== origin || !(request.headers.get("cookie") ?? "").split(";").some(value => value.trim() === hostCookieName + "=" + hostCookie)) return null;
          const verified = await owner.query("select s.id from auth.sessions s join public.workspace_members m on m.user_id=s.user_id where s.id=$1 and s.user_id=$2 and s.not_after>clock_timestamp() and m.workspace_id=$3 and m.role='owner' and m.status='active'", [browserSession, user, browserWorkspace]);
          return verified.rowCount === 1 ? browserActor : null;
        },
        resolveAuthorizationNavigation(authorizationUrl) {
          const logical = new URL(authorizationUrl);
          equal(logical.origin, "https://connect.squareupsandbox.com"); equal(logical.pathname, "/oauth2/authorize");
          equal(logical.searchParams.get("client_id"), applicationId); equal(logical.searchParams.get("redirect_uri"), redirectUri);
          const state = logical.searchParams.get("state");
          ok(/^[A-Za-z0-9_-]{43}$/.test(state), "logical OAuth binding carries a bounded real hashed-state nonce");
          // Fixture transport mapping only. The real service/DB still bind the
          // exact HTTPS policy URI; no generic OAuth or production gate changes.
          return origin + "/__square_synthetic_provider/authorize?state=" + state;
        }
      };
    },
    async handleHostSession(request) {
      if (request.method !== "GET" || new URL(request.url).pathname !== "/__square_host_session/start") return new Response(null, { status: 404 });
      return new Response(null, { status: 303, headers: { location: "/app/settings/integrations/square", "cache-control": "no-store",
        "set-cookie": `${hostCookieName}=${hostCookie}; HttpOnly; SameSite=Lax; Path=/` } });
    },
    async handleSyntheticProvider(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/__square_synthetic_provider/authorize") return new Response(null, { status: 404 });
      if (request.method === "GET") {
        const state = url.searchParams.get("state");
        ok(/^[A-Za-z0-9_-]{43}$/.test(state));
        return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Synthetic Square provider</title></head><body><form method="post" action="/__square_synthetic_provider/authorize"><input type="hidden" name="state" value="${state}"><button name="decision" value="approve">Approve synthetic Square authorization</button><button name="decision" value="deny">Deny synthetic Square authorization</button></form></body></html>`, { headers: { "content-type": "text/html", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
      }
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const form = new URLSearchParams(await request.text()), state = form.get("state");
      ok(/^[A-Za-z0-9_-]{43}$/.test(state));
      const query = new URLSearchParams({ state, ...(form.get("decision") === "deny" ? { error: "access_denied" } : { code: browserCode }) });
      return new Response(null, { status: 303, headers: { location: "/api/integrations/square/callback?" + query.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    },
    async afterMapping() {
      const rows = (await owner.query("select * from private.square_account_connections where workspace_id=$1", [browserWorkspace])).rows;
      equal(rows.length, 1); equal(rows[0].state, "authorized"); browserConnectionId = rows[0].connection_id;
      const mappedScope = { ...scope, workspaceId: browserWorkspace, businessEntityId: browserEntity, connectionId: browserConnectionId,
        generation: Number(rows[0].generation), authorizedLocationIds: ["LOC_SYNTHETIC_1"] };
      const browserGrant = { ...grant, scope: mappedScope, scanId: uuid(), expiresAt: Date.now() + 1800_000 };
      const browserBinding = { ...binding, generation: mappedScope.generation,
        scopeFingerprint: squareIngestionScopeFingerprint(mappedScope), scanKey: contractSha256({ purpose: "square_ingestion_scan_v1",
          workspaceId: browserWorkspace, businessEntityId: browserEntity, connectionId: browserConnectionId, stream: browserGrant.stream, scanId: browserGrant.scanId }) };
      browserTask = { taskId: uuid(), leaseOwnerFingerprint: contractSha256(uuid()) };
      const enrolled = await rpc(enrollment.client).rpc("enroll_square_verified_task_v1", { p_command: { ...browserTask,
        connectionId: browserConnectionId, generation: mappedScope.generation, runtimeLogin: broker.name, grant: browserGrant, binding: browserBinding } });
      equal(enrolled.error, null, "browser-confirmed mapping yields actual checked task enrollment");
      const repository = createSquareDurablePageRepository({ ...browserTask, client: rpc(broker.client) });
      let readLease;
      const adapter = createSquareDormantIngestionAdapter({ authority: createSquareDatabaseAuthority({ ...browserTask, client: rpc(broker.client) }),
        repository: { ...repository,
          async acquire(value) { const result = await repository.acquire(value); if (result.outcome === "leased") readLease = result.lease; return result; },
          async commitPage(value) { browserPage = value; return repository.commitPage(value); } },
        async transport(request) {
          const access = await credentialBrokerFor(browserContext).readProviderAccessCredential({ ...browserTask,
            leaseId: squareCredentialReadLeaseId(readLease.leaseId), expectedCredentialVersion: 1,
            requiredScopes: SQUARE_OAUTH_SCOPES, minimumValiditySeconds: 30, requestId: uuid() });
          equal(access.state, "available");
          await access.credential.use(({ accessToken }) => ok(accessToken.startsWith("ACCESS_" + CANARY), "browser connection decrypts only for current checked read"));
          const bytes = Buffer.from(JSON.stringify({ payments: [squarePaymentFixture()], cursor: cursorCanary }));
          return { status: 200, url: request.url, redirected: false, headers: { "content-type": "application/json" },
            body: (async function*() { yield bytes; })(), cancel() {} };
        }
      });
      const outcome = await adapter.run({ taskId: browserTask.taskId });
      equal(outcome.outcome, "committed", "browser-confirmed account reaches atomic pending-only ingestion");
      const version = (await owner.query("select version from private.square_ingestion_versions where connection_id=$1", [browserConnectionId])).rows;
      equal(version.length, 1); equal(version[0].version.validation.state, "pending"); equal(version[0].version.trust, "untrusted_external_input");
      const renewed = await repository.acquire(browserBinding); equal(renewed.outcome, "leased"); browserLease = renewed.lease;
    },
    async afterDisconnect() {
      equal((await connectionRow(browserConnectionId)).state, "disconnected");
      const late = await rpc(broker.client).rpc("commit_square_ingestion_page_v1", { p_task_id: browserTask.taskId,
        p_lease_owner_fingerprint: browserTask.leaseOwnerFingerprint,
        p_command: { ...browserPage, lease: browserLease, pageId: contractSha256("browser_disconnected_late_page") } });
      ok(late.error, "browser disconnect fences outstanding checked page");
      equal((await owner.query("select count(*)::int as n from private.square_ingestion_versions where connection_id=$1", [browserConnectionId])).rows[0].n, 1, "browser disconnect never purges or duplicates history");
    },
    async afterDenial() { ok((await connectionRow(browserConnectionId)).state !== "authorized", "browser denial cannot restore authority"); },
    async afterReauthorization() {
      const row = await connectionRow(browserConnectionId);
      equal(row.state, "mapping_required"); equal(row.merchant_id, merchantId); ok(Number(row.generation) > 1);
      equal(row.mapped_locations, [], "browser reauthorization still requires fresh explicit mapping");
    }
  });
  console.log("Square account browser qualification: " + JSON.stringify(browserEvidence));
  scenarios += browserEvidence.scenarios.length;

  stage = "connection_local_disconnect_and_refresh_failure";
  const revokedMerchant = "MERCHANT_REFRESH_REVOKED", unrelatedMerchant = "MERCHANT_REFRESH_UNRELATED";
  provider.merchant = unrelatedMerchant;
  const unrelated = await connected();
  await service.confirmMapping(actor, { ...mapping, connectionId: unrelated.connectionId });
  const unrelatedBefore = await connectionRow(unrelated.connectionId);
  provider.merchant = revokedMerchant;
  provider.sharedTokens = true;
  const disconnectedMember = await connected();
  await service.confirmMapping(actor, { ...mapping, connectionId: disconnectedMember.connectionId });
  const reporting = await connected();
  await service.confirmMapping(actor, { ...mapping, connectionId: reporting.connectionId });
  const siblingStart = await service.initiate(browserActor, { operation: "connect", businessEntityId: browserEntity });
  const siblingState = new URL(siblingStart.authorizationUrl).searchParams.get("state");
  const sibling = { connectionId: (await stateRow(siblingState)).connection_id };
  await service.complete(browserActor, { state: siblingState, code: "synthetic-sibling-code" });
  await service.confirmMapping(browserActor, { ...mapping, connectionId: sibling.connectionId, businessEntityId: browserEntity });
  equal(new Set(provider.tokenFingerprints.slice(-3)).size, 1, "three independently authorized connections deliberately share exact access and refresh token bytes");
  ok((await connectionRow(reporting.connectionId)).workspace_id !== (await connectionRow(sibling.connectionId)).workspace_id,
    "local-isolation regression covers separately authorized workspaces");

  const siblingBeforeTransient = await connectionFootprint(sibling.connectionId);
  provider.failNextRefresh("INTERNAL_SERVER_ERROR");
  await service.refresh(actor, reporting.connectionId);
  equal((await connectionRow(reporting.connectionId)).state, "authorized", "ordinary transient refresh failure does not revoke reporting consent");
  equal((await connectionRow(sibling.connectionId)).state, "authorized", "ordinary transient refresh failure remains local to its attempt");
  equal(await connectionFootprint(sibling.connectionId), siblingBeforeTransient, "generic refresh failure leaves sibling credentials, generations and enrollment unchanged");
  await owner.query("update private.square_account_connections set refresh_not_before=clock_timestamp()-interval '1 second' where connection_id=$1", [reporting.connectionId]);

  async function captureMemberPage(member) {
    const account = await connectionRow(member.connectionId);
    const generation = Number(account.generation), credentialVersion = Number(account.credential_version);
    const sourceCount = (await owner.query("select count(*)::int as n from private.square_ingestion_versions where connection_id=$1", [member.connectionId])).rows[0].n;
    const memberScope = { ...scope, connectionId: member.connectionId, businessEntityId: member.businessEntityId,
      workspaceId: member.workspaceId, sellerId: revokedMerchant, generation };
    const memberGrant = { ...grant, scope: memberScope, scanId: uuid(), expiresAt: Date.now() + 1800_000 };
    const memberBinding = { ...binding, generation, scopeFingerprint: squareIngestionScopeFingerprint(memberScope),
      scanKey: contractSha256({ purpose: "square_ingestion_scan_v1", workspaceId: member.workspaceId,
        businessEntityId: member.businessEntityId, connectionId: member.connectionId, stream: memberGrant.stream, scanId: memberGrant.scanId }) };
    const memberTask = { taskId: uuid(), leaseOwnerFingerprint: contractSha256(uuid()) };
    const enrolled = await rpc(enrollment.client).rpc("enroll_square_verified_task_v1", { p_command: { ...memberTask,
      connectionId: member.connectionId, generation, runtimeLogin: broker.name, grant: memberGrant, binding: memberBinding } });
    equal(enrolled.error, null, "each independently authorized connection has a checked current task");
    const repository = createSquareDurablePageRepository({ ...memberTask, client: rpc(broker.client) });
    const memberAuthority = createSquareDatabaseAuthority({ ...memberTask, client: rpc(broker.client) });
    let heldLease, heldPage;
    const adapter = createSquareDormantIngestionAdapter({ authority: memberAuthority,
      repository: { ...repository,
        async acquire(value) { const acquired = await repository.acquire(value); if (acquired.outcome === "leased") heldLease = acquired.lease; return acquired; },
        async commitPage(command) {
          // Capture the actual validated, mapped command at its commit boundary;
          // do not send it until local or authenticated-provider fences are checked.
          heldPage = command;
          return { outcome: "conflict", completeness: null, continuation: false };
        } },
      async transport(request) {
        const access = await credentialBrokerFor(member.context).readProviderAccessCredential({ ...memberTask,
          leaseId: squareCredentialReadLeaseId(heldLease.leaseId), expectedCredentialVersion: credentialVersion,
          requiredScopes: SQUARE_OAUTH_SCOPES, minimumValiditySeconds: 30, requestId: uuid() });
        equal(access.state, "available", "each current task can decrypt before a local or provider signal");
        await access.credential.use(({ accessToken }) => ok(accessToken.startsWith("ACCESS_" + CANARY)));
        const bytes = Buffer.from(JSON.stringify({ payments: [squarePaymentFixture()], cursor: cursorCanary }));
        return { status: 200, url: request.url, redirected: false, headers: { "content-type": "application/json" },
          body: (async function*() { yield bytes; })(), cancel() {} };
      }
    });
    equal((await adapter.run({ taskId: memberTask.taskId })).outcome, "conflict");
    ok(heldPage && heldPage.sources.length === 1, "late page is captured after actual supported response validation and mapping");
    return { ...member, generation, credentialVersion, sourceCount, task: memberTask, authority: memberAuthority,
      lease: heldLease, page: heldPage, grant: memberGrant, binding: memberBinding };
  }
  const groupReads = [];
  for (const member of [
    { connectionId: disconnectedMember.connectionId, actor, context, businessEntityId: entity, workspaceId: workspace },
    { connectionId: reporting.connectionId, actor, context, businessEntityId: entity, workspaceId: workspace },
    { connectionId: sibling.connectionId, actor: browserActor, context: browserContext, businessEntityId: browserEntity, workspaceId: browserWorkspace }
  ]) groupReads.push(await captureMemberPage(member));
  const [disconnectedRead, reportingRead, siblingRead] = groupReads;
  async function assertFenced(member, label) {
    equal((await owner.query("select state from private.square_connections where connection_id=$1", [member.connectionId])).rows[0].state, "revoked", label + " durable authority is fenced");
    equal(await member.authority.resolve({ taskId: member.task.taskId }), null, label + " cannot resolve task authority");
    await denied(() => credentialBrokerFor(member.context).readProviderAccessCredential({ ...member.task,
      leaseId: squareCredentialReadLeaseId(member.lease.leaseId), expectedCredentialVersion: member.credentialVersion,
      requiredScopes: SQUARE_OAUTH_SCOPES, minimumValiditySeconds: 30, requestId: uuid() }), label + " cannot release credentials");
    const committed = await rpc(broker.client).rpc("commit_square_ingestion_page_v1", { p_task_id: member.task.taskId,
      p_lease_owner_fingerprint: member.task.leaseOwnerFingerprint, p_command: member.page });
    ok(committed.error, label + " rejects a genuine in-flight mapped page");
    const enrollmentAttempt = await rpc(enrollment.client).rpc("enroll_square_verified_task_v1", { p_command: {
      taskId: uuid(), leaseOwnerFingerprint: contractSha256(uuid()), connectionId: member.connectionId,
      generation: member.generation, runtimeLogin: broker.name, grant: member.grant, binding: member.binding } });
    ok(enrollmentAttempt.error, label + " cannot enroll another task");
    equal((await owner.query("select count(*)::int as n from private.square_ingestion_versions where connection_id=$1", [member.connectionId])).rows[0].n, member.sourceCount,
      label + " does not commit late pending sources");
  }
  const crossWorkspaceStart = await service.initiate(browserActor, { operation: "connect", businessEntityId: browserEntity });
  const crossWorkspaceState = new URL(crossWorkspaceStart.authorizationUrl).searchParams.get("state");
  const crossWorkspaceConnection = (await stateRow(crossWorkspaceState)).connection_id;
  const crossWorkspaceHold = provider.holdCode();
  const crossWorkspacePending = service.complete(browserActor, { state: crossWorkspaceState, code: "synthetic-independent-workspace-code" });
  const crossWorkspaceSettled = crossWorkspacePending.then(value => ({ value }), error => ({ error }));
  await reach(crossWorkspaceHold, crossWorkspacePending);
  const crossWorkspaceBeforeDisconnect = await connectionFootprint(crossWorkspaceConnection);
  const reportingBeforeDisconnect = await connectionFootprint(reporting.connectionId), siblingBeforeDisconnect = await connectionFootprint(sibling.connectionId);
  const callsBeforeLocalDisconnect = provider.calls.length;
  try {
    await service.disconnect(actor, { connectionId: disconnectedMember.connectionId, confirmation: "disconnect" });
    equal(provider.calls.length, callsBeforeLocalDisconnect, "even shared token bytes do not cause any provider revocation call");
    equal((await connectionRow(disconnectedMember.connectionId)).state, "disconnected");
    equal(await connectionFootprint(reporting.connectionId), reportingBeforeDisconnect, "same-workspace same-token sibling remains byte-for-byte unchanged");
    equal(await connectionFootprint(sibling.connectionId), siblingBeforeDisconnect, "cross-workspace same-token sibling, active lease and enrollment remain byte-for-byte unchanged");
    equal(await connectionFootprint(crossWorkspaceConnection), crossWorkspaceBeforeDisconnect, "another workspace's outstanding unknown-seller callback is not modified by local disconnect");
  } finally { crossWorkspaceHold.release(); }
  ok(!(await crossWorkspaceSettled).error, "same-seller authorization in another workspace can complete after local disconnect");
  equal((await connectionRow(crossWorkspaceConnection)).state, "mapping_required");
  await assertFenced(disconnectedRead, "locally disconnected connection");
  await assertDisconnectedRefreshUnavailable(disconnectedMember.connectionId);
  ok(await siblingRead.authority.resolve({ taskId: siblingRead.task.taskId }), "cross-workspace sibling retains current task authority after local disconnect");
  scenarios++;
  const unknownSeller = await start(), unknownHold = provider.holdCode();
  const unknownPending = complete(unknownSeller);
  const unknownSettled = unknownPending.then(value => ({ value }), error => ({ error }));
  await reach(unknownHold, unknownPending);
  equal((await connectionRow(unknownSeller.connectionId)).merchant_id, null, "outstanding callback seller is not known before exchange completes");
  const siblingHold = provider.holdRefresh(), siblingPending = service.refresh(browserActor, sibling.connectionId);
  const siblingSettled = siblingPending.then(value => ({ value }), error => ({ error }));
  await reach(siblingHold, siblingPending);
  const siblingVersion = Number((await connectionRow(sibling.connectionId)).credential_version);
  const siblingBeforeRevokedRefresh = await connectionFootprint(sibling.connectionId), unknownBeforeRevokedRefresh = await connectionFootprint(unknownSeller.connectionId);
  const revokeCalls = provider.calls.filter(value => value === "/oauth2/revoke").length;
  let revokedFailureArguments;
  const reportingService = makeService({ client: rpc(broker.client, { before(name, args) {
    if (name === "square_account_connection_v1" && args.p_operation === "fail_refresh") revokedFailureArguments = structuredClone(args);
  } }) });
  try {
    provider.failNextRefresh("ACCESS_TOKEN_REVOKED");
    const revokedRefresh = await reportingService.refresh(actor, reporting.connectionId);
    equal(revokedRefresh.state, "reauthorization_required", "terminal provider-revoked result must not report retry_required");
    equal((await connectionRow(reporting.connectionId)).state, "reauthorization_required", "provider-revoked reporting account requires fresh consent");
    equal(await connectionFootprint(sibling.connectionId), siblingBeforeRevokedRefresh, "provider_revoked refresh does not mutate sibling credential, generation, enrollment, task or outstanding lease");
    equal(await connectionFootprint(unknownSeller.connectionId), unknownBeforeRevokedRefresh, "generic token failure does not fence another pending unknown-seller callback");
    await assertFenced(reportingRead, "provider-revoked reporting connection");
    // Shared synthetic token bytes have one token-status record. Finish one
    // exchange before issuing the next, so the fixture cannot replace its expiry
    // between the response and status verification. Both still span the failure.
    siblingHold.release();
    ok(!(await siblingSettled).error, "independently authorized sibling refresh completes after another connection's token failure");
    unknownHold.release();
    ok(!(await unknownSettled).error, "unknown-seller callback in another connection may complete after local token failure");
    equal((await connectionRow(unknownSeller.connectionId)).state, "mapping_required");
    equal(Number((await connectionRow(sibling.connectionId)).credential_version), siblingVersion + 1, "legitimate late sibling refresh appends its own current credential");
    equal((await connectionRow(sibling.connectionId)).state, "authorized", "sibling remains authorized after its own successful refresh");
    ok(await siblingRead.authority.resolve({ taskId: siblingRead.task.taskId }), "sibling task authority remains valid after reporting connection failure");
    const siblingAccess = await credentialBrokerFor(browserContext).readProviderAccessCredential({ ...siblingRead.task,
      leaseId: squareCredentialReadLeaseId(siblingRead.lease.leaseId), expectedCredentialVersion: siblingVersion + 1,
      requiredScopes: SQUARE_OAUTH_SCOPES, minimumValiditySeconds: 30, requestId: uuid() });
    equal(siblingAccess.state, "available", "independent sibling can still use the shared credential bytes under its own authority");
    await siblingAccess.credential.use(() => {});
    const siblingCommit = await rpc(broker.client).rpc("commit_square_ingestion_page_v1", { p_task_id: siblingRead.task.taskId,
      p_lease_owner_fingerprint: siblingRead.task.leaseOwnerFingerprint, p_command: siblingRead.page });
    equal(siblingCommit.error, null); equal(siblingCommit.data.outcome, "committed", "actual in-flight sibling page commits after another account's token failure");
    equal(await connectionRow(unrelated.connectionId), unrelatedBefore, "different seller connection remains byte-for-byte unchanged");
    equal(provider.calls.filter(value => value === "/oauth2/revoke").length, revokeCalls,
      "token-level revocation evidence does not claim merchant provider revocation or call revoke");
    const oldNotificationAt = new Date().toISOString();
    ok(new Date((await connectionRow(unknownSeller.connectionId)).authorization_issued_at).getTime() <= Date.parse(oldNotificationAt), "old consent predates held authenticated event");
    const freshReporting = await start(service, { operation: "reauthorize", connectionId: reporting.connectionId });
    await complete(freshReporting);
    await service.confirmMapping(actor, { ...mapping, connectionId: reporting.connectionId });
    const newGeneration = await connectionRow(reporting.connectionId), siblingBeforeReplay = await connectionRow(sibling.connectionId);
    equal(Number(newGeneration.generation), 2); equal(newGeneration.state, "authorized");
    ok(revokedFailureArguments, "stale witness is the genuine prior failure command, not an invented caller");
    const staleFailure = await rpc(broker.client).rpc("square_account_connection_v1", revokedFailureArguments);
    ok(staleFailure.error, "old failure command cannot fence fresh consent after generation replacement");
    equal(await connectionRow(reporting.connectionId), newGeneration, "stale refresh failure preserves newly authorized generation exactly");
    equal(await connectionRow(sibling.connectionId), siblingBeforeReplay, "stale refresh failure cannot mutate sibling state either");
    for (const failure of ["INVALID_GRANT", "ACCESS_TOKEN_EXPIRED", "UNAUTHORIZED"]) {
      const siblingBeforeFailure = await connectionFootprint(sibling.connectionId), providerCallsBeforeFailure = provider.calls.filter(value => value === "/oauth2/revoke").length;
      provider.failNextRefresh(failure);
      equal((await service.refresh(actor, reporting.connectionId)).state, "reauthorization_required", failure + " closes only reporting consent");
      equal((await connectionRow(reporting.connectionId)).state, "reauthorization_required");
      equal((await owner.query("select state from private.square_connections where connection_id=$1", [reporting.connectionId])).rows[0].state, "revoked");
      equal(await connectionFootprint(sibling.connectionId), siblingBeforeFailure, failure + " leaves another workspace's same-token authority byte-for-byte unchanged");
      equal(provider.calls.filter(value => value === "/oauth2/revoke").length, providerCallsBeforeFailure, failure + " does not authorize provider revocation");
      const recovered = await start(service, { operation: "reauthorize", connectionId: reporting.connectionId });
      await complete(recovered); await service.confirmMapping(actor, { ...mapping, connectionId: reporting.connectionId });
      scenarios++;
    }
    const freshSiblingStart = await service.initiate(browserActor, { operation: "reauthorize", connectionId: sibling.connectionId, businessEntityId: browserEntity });
    await service.complete(browserActor, { state: new URL(freshSiblingStart.authorizationUrl).searchParams.get("state"), code: "synthetic-fresh-sibling-code" });
    await service.confirmMapping(browserActor, { ...mapping, connectionId: sibling.connectionId, businessEntityId: browserEntity });
    for (const connectionId of [reporting.connectionId, sibling.connectionId])
      ok(new Date((await connectionRow(connectionId)).authorization_issued_at).getTime() > Date.parse(oldNotificationAt), "fresh verified consent strictly postdates held notification");
    const reportingBeforeOldEvent = await connectionFootprint(reporting.connectionId), siblingBeforeOldEvent = await connectionFootprint(sibling.connectionId);
    const signedEvent = (eventId, revokedAt) => {
      const rawBody = JSON.stringify({ merchant_id: revokedMerchant, type: "oauth.authorization.revoked", event_id: eventId,
        created_at: revokedAt, data: { type: "revocation", object: { revocation: { revoked_at: revokedAt, revoker_type: "MERCHANT" } } } });
      return { rawBody, notificationUrl, signatureKey, signature: crypto.createHmac("sha256", signatureKey).update(notificationUrl).update(rawBody).digest("base64") };
    };
    const oldEvent = signedEvent("synthetic-delayed-first-delivery", oldNotificationAt);
    await service.handleRevocationNotification(oldEvent);
    equal((await connectionRow(unknownSeller.connectionId)).state, "revoked", "first delivery of old signed event still fences the matching older consent");
    equal(await connectionFootprint(reporting.connectionId), reportingBeforeOldEvent, "first delivery of stale signed event preserves newer verified connection exactly");
    equal(await connectionFootprint(sibling.connectionId), siblingBeforeOldEvent, "stale signed event preserves newer verified consent in another workspace exactly");
    await service.handleRevocationNotification(oldEvent);
    equal(await connectionFootprint(reporting.connectionId), reportingBeforeOldEvent, "old event replay cannot revoke a newer generation");
    equal(await connectionFootprint(sibling.connectionId), siblingBeforeOldEvent, "old event replay cannot affect another workspace's newer generation");
    const currentGroupReads = [];
    for (const member of [reportingRead, siblingRead]) currentGroupReads.push(await captureMemberPage(member));
    const signedCallback = await start(), signedCallbackHold = provider.holdCode();
    const signedCallbackPending = complete(signedCallback);
    const signedCallbackSettled = signedCallbackPending.then(value => ({ value }), error => ({ error }));
    await reach(signedCallbackHold, signedCallbackPending);
    equal((await connectionRow(signedCallback.connectionId)).merchant_id, null, "signed-event race starts with unknown seller and an outstanding token exchange");
    const currentRevokedAt = new Date().toISOString();
    ok(new Date((await stateRow(signedCallback.state)).created_at).getTime() <= Date.parse(currentRevokedAt), "pending callback state predates signed revocation");
    const currentEvent = signedEvent("synthetic-current-shared-revocation", currentRevokedAt);
    try { await service.handleRevocationNotification(currentEvent); }
    finally { signedCallbackHold.release(); }
    ok((await signedCallbackSettled).error, "signed group event rejects prior pending callback even when token exchange completes afterward");
    ok(provider.tokenIssuanceTimes.at(-1) > Date.parse(currentRevokedAt), "race actually mints the synthetic token after authenticated revocation");
    equal((await connectionRow(signedCallback.connectionId)).credential_id, null, "old pending callback installs no credential after signed revocation");
    equal((await owner.query("select count(*)::int as n from private.square_account_enrollments where connection_id=$1", [signedCallback.connectionId])).rows[0].n, 0,
      "old pending callback creates no enrollment after signed revocation");
    for (const connectionId of [reporting.connectionId, sibling.connectionId]) {
      equal((await connectionRow(connectionId)).state, "revoked", "authenticated current event fences matching seller/app/environment across workspaces");
      equal((await owner.query("select state from private.square_connections where connection_id=$1", [connectionId])).rows[0].state, "revoked");
    }
    for (const member of currentGroupReads) await assertFenced(member, "signed provider revocation of current-generation connection");
    // Symmetric delivery order: the same old pending state must not survive
    // merely because token storage/enrollment beat the first signed notification.
    const lateNotificationCallback = await start(service, { operation: "reauthorize", connectionId: signedCallback.connectionId });
    const lateNotificationHold = provider.holdCode(), lateNotificationPending = complete(lateNotificationCallback);
    const lateNotificationSettled = lateNotificationPending.then(value => ({ value }), error => ({ error }));
    await reach(lateNotificationHold, lateNotificationPending);
    const lateRevokedAt = new Date().toISOString();
    ok(new Date((await stateRow(lateNotificationCallback.state)).created_at).getTime() <= Date.parse(lateRevokedAt), "old pending state predates delayed first notification");
    // A bounded scheduling gap makes strict token-issuance ordering deterministic.
    await new Promise(resolve => setTimeout(resolve, 5));
    lateNotificationHold.release();
    ok(!(await lateNotificationSettled).error, "without the undelivered event the held callback can store its verified token");
    ok(provider.tokenIssuanceTimes.at(-1) > Date.parse(lateRevokedAt), "delayed-delivery regression really issues the token after revocation");
    await service.confirmMapping(actor, { ...mapping, connectionId: lateNotificationCallback.connectionId });
    const lateNotificationRead = await captureMemberPage({ connectionId: lateNotificationCallback.connectionId, actor, context,
      businessEntityId: entity, workspaceId: workspace });
    await service.refresh(actor, lateNotificationCallback.connectionId);
    const lateEvent = signedEvent("synthetic-revocation-after-pending-callback-stored", lateRevokedAt);
    await service.handleRevocationNotification(lateEvent);
    equal((await connectionRow(lateNotificationCallback.connectionId)).state, "revoked", "first notification after storage fences old pending consent despite newer token issuance and refresh");
    await assertFenced(lateNotificationRead, "delayed notification after old pending callback stored");
    await assertDisconnectedRefreshUnavailable(lateNotificationCallback.connectionId);
    const afterLateNotification = await connectionFootprint(lateNotificationCallback.connectionId);
    await service.handleRevocationNotification(lateEvent);
    equal(await connectionFootprint(lateNotificationCallback.connectionId), afterLateNotification, "duplicate delayed notification has no additional lifecycle effect");
    const freshAfterLateNotification = await start(service, { operation: "reauthorize", connectionId: lateNotificationCallback.connectionId });
    await complete(freshAfterLateNotification);
    await service.confirmMapping(actor, { ...mapping, connectionId: freshAfterLateNotification.connectionId });
    const freshAfterLateFootprint = await connectionFootprint(freshAfterLateNotification.connectionId);
    await service.handleRevocationNotification(lateEvent);
    equal(await connectionFootprint(freshAfterLateNotification.connectionId), freshAfterLateFootprint, "replayed older event preserves a new verified consent state and generation");
    await service.handleRevocationNotification(signedEvent("synthetic-second-delivery-id-old-revocation", lateRevokedAt));
    equal(await connectionFootprint(freshAfterLateNotification.connectionId), freshAfterLateFootprint, "first delivery under another event ID also preserves genuinely newer consent");
    // Hold the actual store transaction after SQL succeeds. A concurrently
    // delivered old event must wait on the merchant lock and inspect the newly
    // committed generation, not a snapshot from before its lock wait.
    const storedHold = barrier();
    const lockedStoreService = makeService({ client: rpc(secondSession, {
      async before(name, args) {
        if (name === "square_account_connection_v1" && args.p_operation === "store_credential") await secondSession.query("begin");
      },
      async after(name, args) {
        if (name === "square_account_connection_v1" && args.p_operation === "store_credential") {
          await storedHold.wait(); await secondSession.query("commit");
        }
      }
    }) });
    const lockWaitConsent = await start(lockedStoreService, { operation: "reauthorize", connectionId: lateNotificationCallback.connectionId });
    const lockWaitCallback = complete(lockWaitConsent, lockedStoreService);
    const lockWaitSettled = lockWaitCallback.then(value => ({ value }), error => ({ error }));
    let lockWaitEventSettled;
    try {
      await reach(storedHold, lockWaitCallback);
      const lockWaitEvent = service.handleRevocationNotification(signedEvent("synthetic-old-event-waits-for-new-consent-commit", lateRevokedAt));
      lockWaitEventSettled = lockWaitEvent.then(value => ({ value }), error => ({ error }));
      let observedLock = false;
      const lockDeadline = Date.now() + 5000;
      while (Date.now() < lockDeadline) {
        await owner.query("select pg_stat_clear_snapshot()");
        const activity = (await owner.query("select wait_event_type from pg_stat_activity where pid=$1", [webhook.client.processID])).rows[0];
        if (activity?.wait_event_type === "Lock") { observedLock = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      ok(observedLock, "authenticated event actually waits for the uncommitted callback store lock");
    } finally {
      storedHold.release();
      await lockWaitSettled;
      if (lockWaitEventSettled) await lockWaitEventSettled;
      await secondSession.query("rollback");
    }
    ok(!(await lockWaitSettled).error, "new verified callback commits during concurrent old notification");
    ok(!(await lockWaitEventSettled).error, "old notification completes safely after actual lock wait");
    equal((await connectionRow(lockWaitConsent.connectionId)).state, "mapping_required", "lock waiter preserves the committed newer generation");
    await service.confirmMapping(actor, { ...mapping, connectionId: lockWaitConsent.connectionId });
    equal((await connectionRow(lockWaitConsent.connectionId)).state, "authorized", "newer consent remains enrollable after concurrent old notification");
    await denied(() => complete(lockWaitConsent), "duplicate delayed callback cannot repeat the committed generation");
    // Preserve PostgreSQL microseconds in the signed event to hit exact consent
    // equality; do not round through a JavaScript Date or edit trusted timestamps.
    const exactStateTime = (await owner.query(`select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value
      from private.square_account_oauth_states where state_id=$1`, [(await stateRow(lockWaitConsent.state)).state_id])).rows[0].value;
    await service.handleRevocationNotification(signedEvent("synthetic-revocation-equals-consent-created-at", exactStateTime));
    equal((await connectionRow(lockWaitConsent.connectionId)).state, "revoked", "equal consent/revocation timestamps are not evidence of newer consent");
    const issuanceEqualityConsent = await start(service, { operation: "reauthorize", connectionId: lockWaitConsent.connectionId });
    await complete(issuanceEqualityConsent);
    const exactIssuedTime = new Date((await connectionRow(issuanceEqualityConsent.connectionId)).authorization_issued_at).toISOString();
    await service.handleRevocationNotification(signedEvent("synthetic-revocation-equals-original-issuance", exactIssuedTime));
    equal((await connectionRow(issuanceEqualityConsent.connectionId)).state, "revoked", "equal original issuance/revocation timestamps also fence unmapped consent");
    scenarios += 3;
    scenarios += 2;
    equal(await connectionRow(unrelated.connectionId), unrelatedBefore, "signed merchant event does not mutate an unrelated seller");
    equal(provider.calls.filter(value => value === "/oauth2/revoke").length, revokeCalls, "local actions and authenticated notifications never issue merchant revoke POST");
    scenarios += 2;
  } finally {
    siblingHold.release(); unknownHold.release();
    await Promise.all([siblingSettled, unknownSettled]);
    provider.merchant = merchantId;
    provider.sharedTokens = false;
  }
  scenarios++;

  stage = "stored_privacy_and_immutability";
  for (const table of ["square_account_connections", "square_account_oauth_states", "square_account_credentials", "square_account_enrollments", "square_account_revocation_events", "square_account_audit_events", "square_connections", "square_connection_generations", "square_location_mappings"]) {
    const stored = JSON.stringify((await owner.query(`select row_to_json(t) as value from private.${table} t`)).rows);
    ok(!stored.includes(CANARY) && !stored.includes(RAW_CANARY), "ordinary stored records contain no plaintext secret or raw private contact canaries");
  }
  await denied(() => owner.query("update private.square_account_credentials set access_expires_at=access_expires_at+interval '1 second'"), "encrypted credential history is immutable even to owner DML");
  await denied(() => owner.query("delete from private.square_account_enrollments"), "enrollment evidence has no purge path");
  equal((await owner.query("select count(*)::int as n from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where r.rolname in ('square_account_broker_authority','square_verified_enrollment_authority') and u.rolname in ('anon','authenticated','service_role')")).rows[0].n, 0, "no default customer/service role capability memberships");
  key.fill(0);
  scenarios++;
}

async function main() {
  await runAdditionalQualification(async runtime => {
    const database = await migrationTests(runtime);
    await integratedTests(runtime, database);
  });
  console.log(`Square account connection database qualification: ${assertions} assertions across ${scenarios} scenarios.`);
}
if (require.main === module) main().catch(error => {
  process.stderr.write(`Square account connection qualification failed at ${stage} (${safeCode(error)}).\n`);
  if (error.code === "ERR_ASSERTION") process.stderr.write(`Assertion: ${String(error.message).split("\n")[0]}\n`);
  if (lastFailure) process.stderr.write(`Last checked RPC failure: ${JSON.stringify(lastFailure)}\n`);
  if (lastOperation) process.stderr.write(`Last checked RPC operation: ${JSON.stringify(lastOperation)}\n`);
  if (providerTrace) process.stderr.write(`Synthetic provider operation trace: ${JSON.stringify(providerTrace.slice(-12))}\n`);
  process.exitCode = 1;
});
