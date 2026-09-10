/* Native DB and metadata bootstrap are injected synthetic seams. The real
 * runtime, credential broker, mapped KMS adapter, durable RPC bridges, decoder,
 * parser and pending-page model run together. This is not hosted qualification. */
const assert = require("node:assert/strict");
require("./square-account-browser-test-support.js").loadSquareBrowserModules();
const { credentialAadDigest } = require("../lib/integrations/credentials/kms.ts");
const { contractSha256 } = require("../lib/integrations/contracts/canonical.ts");
const { SQUARE_OAUTH_SCOPES } = require("../lib/integrations/providers/square/account-connection-oauth.ts");
const { createSquareSyntheticPageRepository } = require("../lib/integrations/providers/square/ingestion-page-repository.ts");
const { squareIngestionScopeFingerprint } = require("../lib/integrations/providers/square/ingestion-contracts.ts");
const callbackIdentity = require("../lib/integrations/control-plane/square-gcp-callback-identity.ts");
const callbackCredentials = require("../lib/integrations/control-plane/square-gcp-callback-credentials.ts");
const mappedCredentials = require("../lib/integrations/control-plane/square-gcp-mapped-credentials.ts");
const mappedDatabase = require("../lib/integrations/control-plane/square-gcp-mapped-database.ts");
const uuid = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const { syntheticMappedBinding: binding } = require("./external-integrations-square-gcp-mapped-credentials-regression-tests.js");
const canary = "SYNTHETIC_PIPELINE_ACCESS_NEVER_LOG";
const owner = `sha256:${"3".repeat(64)}`, taskId = uuid(20);
const originals = { identity: callbackIdentity.createSquareGcpCallbackIdentity, callbackSecret: callbackCredentials.readSquareGcpCallbackDatabaseSecret,
  mappedSecret: mappedCredentials.readSquareGcpMappedDatabaseSecret, database: mappedDatabase.openSquareGcpMappedDatabase, fetch: global.fetch };
let active, assertions = 0;
const eq = (a, b, message) => { assertions++; assert.deepEqual(a, b, message); };
callbackIdentity.createSquareGcpCallbackIdentity = () => ({ verify: async () => {}, withAccessToken: async consumeToken => consumeToken("SYNTHETIC_GOOGLE"), dispose: () => { active.identityDisposed++; } });
callbackCredentials.readSquareGcpCallbackDatabaseSecret = async () => "synthetic-broker-dsn";
mappedCredentials.readSquareGcpMappedDatabaseSecret = async input => { eq(input.binding.capability, "runtime"); return "synthetic-runtime-dsn"; };
mappedDatabase.openSquareGcpMappedDatabase = async role => active.open(role);
global.fetch = () => assert.fail("No default network permitted");
const { runNativeSquareGcpMappedPage, confirmNativeSquareGcpMappedLocation } = require("../lib/integrations/control-plane/square-gcp-mapped-runtime.ts");

function fixture(options = {}) {
  const abort = new AbortController(), now = Date.now(), persisted = new Date(now).toISOString(), expiry = new Date(now + 86400_000).toISOString();
  const b = JSON.parse(JSON.stringify(binding));
  const aad = { schemaVersion: "oauth_credential_aad_v1", purpose: "provider_oauth_credential", environment: "sandbox", providerKey: "square",
    workspaceId: b.workspaceId, connectionId: b.connectionId, connectionGeneration: b.connectionGeneration, credentialId: uuid(5) };
  const envelope = { schemaVersion: "oauth_credential_envelope_v1", providerKey: "square", environment: "sandbox", externalAuthorizedEntityReference: "SYNTHETIC_SELLER",
    accessToken: canary, accessExpiresAt: expiry, refreshToken: "SYNTHETIC_REFRESH_NEVER_USED", refreshExpiresAt: null,
    grantedScopes: [...SQUARE_OAUTH_SCOPES], issuedAt: persisted, updatedAt: persisted };
  const read = { state: "available", credentialId: aad.credentialId, credentialVersion: 1, providerKey: "square", providerEnvironment: "sandbox", accessExpiresAt: expiry,
    credentialReadEvidenceId: uuid(25), ciphertextBase64: Buffer.from("synthetic-encrypted-envelope").toString("base64"), ciphertextPersistedAt: persisted,
    aadDigest: credentialAadDigest(aad), kmsKeyResource: b.kmsKeyResource, aadContext: aad, grantedScopes: [...SQUARE_OAUTH_SCOPES], refreshExpiresAt: null,
    externalEntityReferenceFingerprint: contractSha256({ fingerprintPurpose: "provider_authorized_entity_reference",
      fingerprintVersion: "provider_authorized_entity_reference_fingerprint_v1", value: "SYNTHETIC_SELLER" }) };
  const grant = { scope: { workspaceId: b.workspaceId, businessEntityId: b.businessEntityId, connectionId: b.connectionId, sellerId: "SYNTHETIC_SELLER",
    environment: "sandbox", authorizedLocationIds: [b.defaultLocationId], generation: b.connectionGeneration }, stream: "payments", operation: "list_payments",
    scanId: uuid(21), expiresAt: now + 3600_000, request: { method: "GET", url: `https://connect.squareupsandbox.com/v2/payments?location_id=${b.defaultLocationId}`, body: null } };
  const model = createSquareSyntheticPageRepository(); model.setCurrentGeneration(squareIngestionScopeFingerprint(grant.scope), grant.scope.generation);
  let reads = 0, resolves = 0, provider = 0, kms = 0, commits = 0, releases = 0, rechecks = 0;
  const closed = [], operations = [];
  const f = { abort, model, identityDisposed: 0, options,
    counts: () => ({ reads, resolves, provider, kms, commits, releases, rechecks }), closed, operations,
    async open(role) {
      eq(["runtime", "broker"].includes(role), true);
      return { binding: { ...b, capability: role }, async close() { closed.push(role); }, async recheckBinding() {
        rechecks++; if (options.revokeBindingAt === rechecks) throw Error(canary);
        return { ...b, capability: role };
      }, client: { async rpc(name, args) {
        operations.push(name === "square_account_connection_v1" ? args.p_operation : name);
        if (name === "square_account_connection_v1") {
          eq(role, "broker");
          if (args.p_operation === "confirm_mapping") {
            eq(args.p_context.actor, { actorId: b.operatorId, workspaceId: b.workspaceId, sessionId: b.operatorSessionId, role: b.operatorRole });
            eq(args.p_command, { connectionId: b.connectionId, businessEntityId: b.businessEntityId, locationIds: [b.defaultLocationId], confirmation: "map" });
            return { data: { confirmed: true, generation: options.wrongMappingGeneration ? b.connectionGeneration + 1 : b.connectionGeneration }, error: null };
          }
          if (args.p_operation === "credential_metadata") return { data: { connectionId: b.connectionId, businessEntityId: b.businessEntityId,
            generation: b.connectionGeneration, credentialId: aad.credentialId, credentialVersion: 1 }, error: null };
          if (args.p_operation === "read_credential") {
            reads++; if (options.revokeReadAt === reads) throw Error(canary);
            return { data: { ...read, credentialReadEvidenceId: uuid(30 + reads) }, error: null };
          }
          if (args.p_operation === "read_failure") return { data: {
            credentialReadFailureEvidenceId: uuid(90), credentialReadEvidenceId: args.p_command.credentialReadEvidenceId,
            diagnosticClass: args.p_command.diagnosticClass, failedAt: new Date().toISOString(), idempotent: false
          }, error: null };
          assert.fail("Only credential metadata/read/failure permitted");
        }
        eq(role, "runtime"); eq(args.p_task_id, taskId); eq(args.p_lease_owner_fingerprint, owner);
        if (name === "resolve_square_ingestion_authority_v1") { resolves++; return { data: options.denyAuthority ? null : grant, error: null }; }
        if (name === "acquire_square_ingestion_page_v1") return { data: await model.repository.acquire(args.p_binding, Date.now()), error: null };
        if (name === "commit_square_ingestion_page_v1") {
          commits++; const result = await model.repository.commitPage(args.p_command);
          if (options.lostAck) throw Error(canary);
          return { data: result, error: null };
        }
        if (name === "release_square_ingestion_page_v1") { releases++; await model.repository.release(args.p_lease, args.p_release); return { data: null, error: null }; }
        assert.fail("Only fixed read-only page RPCs permitted");
      } } };
    },
    async network(url, init) {
      if (url === `https://cloudkms.googleapis.com/v1/${b.kmsKeyResource}:decrypt`) {
        kms++; eq(init.headers.Authorization, "Bearer SYNTHETIC_GOOGLE");
        if (options.abortKms) abort.abort();
        return new Response(JSON.stringify({ plaintext: Buffer.from(JSON.stringify(envelope)).toString("base64"), protectionLevel: "SOFTWARE" }));
      }
      provider++; eq(url, grant.request.url); eq(init.method, "GET"); eq(init.headers.Authorization, `Bearer ${canary}`);
      eq(init.redirect, "manual"); eq(init.cache, "no-store"); eq(init.credentials, "omit");
      if (options.abortProvider) abort.abort();
      if (options.providerFailure) throw Error(canary);
      return new Response(JSON.stringify({ payments: [] }), { status: options.status ?? 200 });
    },
    async run() { active = f; return runNativeSquareGcpMappedPage({ binding: b, databaseCa: "synthetic-ca", network: f.network }, { taskId, leaseOwnerFingerprint: owner }, abort.signal); },
    async map() { active = f; return confirmNativeSquareGcpMappedLocation({ binding: b, databaseCa: "synthetic-ca", network: f.network }, abort.signal); }
  };
  return f;
}
async function main() {
  try {
    const success = fixture(), result = await success.run();
    eq(result.outcome, "committed"); eq(result.sourceCount, 0); eq(result.completeness.economic, "blocked"); eq(result.completeness.historical, "unknown");
    eq(success.counts().provider, 1); eq(success.counts().kms, 1); eq(success.counts().commits, 1); eq(success.counts().reads, 5);
    eq(success.closed.sort(), ["broker", "runtime"]); eq(JSON.stringify(result).includes(canary), false);
    eq(success.operations.some(v => /refresh|rotate|enroll|consume_state|create_state/.test(v)), false);
    for (const options of [{ denyAuthority: true }, { revokeReadAt: 2 }, { revokeReadAt: 4 }, { revokeBindingAt: 1 }, { abortKms: true }]) {
      const f = fixture(options), value = await f.run(); eq(value.outcome === "committed", false); eq(f.counts().provider, 0); eq(f.counts().commits, 0);
      eq(f.closed.sort(), ["broker", "runtime"]); eq(JSON.stringify(value).includes(canary), false);
    }
    for (const options of [{ providerFailure: true }, { abortProvider: true }, { status: 302 }]) {
      const f = fixture(options), value = await f.run(); eq(value.outcome === "committed", false); eq(f.counts().provider, 1); eq(f.counts().commits, 0);
      eq(f.closed.sort(), ["broker", "runtime"]);
    }
    const uncertain = fixture({ lostAck: true }), first = await uncertain.run();
    eq(first.outcome, "retry"); eq(uncertain.counts().provider, 1); eq(uncertain.counts().commits, 1);
    const recovered = await uncertain.run(); eq(recovered.outcome, "finished"); eq(uncertain.counts().provider, 1); eq(uncertain.counts().commits, 1);
    const mapping = fixture(); eq(await mapping.map(), { confirmed: true, generation: binding.connectionGeneration });
    eq(mapping.operations, ["confirm_mapping"]); eq(mapping.counts().provider, 0); eq(mapping.counts().kms, 0); eq(mapping.closed, ["broker"]);
    const wrongMapping = fixture({ wrongMappingGeneration: true });
    await assert.rejects(() => wrongMapping.map(), e => e.message === "square_gcp_mapped_runtime_denied"); eq(wrongMapping.closed, ["broker"]);
    process.stdout.write(`square_gcp_mapped_runtime_passed ${assertions}\n`);
  } finally {
    callbackIdentity.createSquareGcpCallbackIdentity = originals.identity; callbackCredentials.readSquareGcpCallbackDatabaseSecret = originals.callbackSecret;
    mappedCredentials.readSquareGcpMappedDatabaseSecret = originals.mappedSecret; mappedDatabase.openSquareGcpMappedDatabase = originals.database; global.fetch = originals.fetch;
  }
}
main().catch(() => { process.stderr.write("square_gcp_mapped_runtime_failed\n"); process.exitCode = 1; });
