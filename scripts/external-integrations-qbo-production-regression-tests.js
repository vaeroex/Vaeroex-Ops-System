const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
let assertionCount = 0;
const ok = (value, message) => {
  assertionCount += 1;
  assert.ok(value, message);
};
const matches = (value, pattern, message) => {
  assertionCount += 1;
  assert.match(value, pattern, message);
};
const excludes = (value, pattern, message) => {
  assertionCount += 1;
  assert.doesNotMatch(value, pattern, message);
};

const migration = read("supabase/migrations/20260827033058_qbo_production_convergence.sql");
const connect = read("app/api/integrations/qbo/connect/route.ts");
const reauthorize = read("app/api/integrations/qbo/reauthorize/route.ts");
const oauth = read("lib/integrations/control-plane/qbo-customer-oauth.ts");
const repository = read("lib/integrations/persistence/qbo-production-repository.ts");
const database = read("services/external-integrations-qbo/src/database.ts");
const server = read("services/external-integrations-qbo/src/server.ts");
const delivery = read("services/external-integrations-qbo/src/cloud-task-delivery.ts");
const executor = read("services/external-integrations-qbo/src/executor.ts");
const companyVerifier = read("lib/integrations/provider-runtime/qbo/company-verification.ts");
const callbackHandoff = read("lib/integrations/provider-runtime/qbo/callback-handoff.ts");
const webhookSignature = read("lib/integrations/providers/qbo/webhook-signature.ts");
const edgeCallback = read("services/external-integrations-qbo/edge/callback.go");
const edgePlugin = read("services/external-integrations-qbo/edge/plugin/main.go");
const edgeTests = read("services/external-integrations-qbo/edge/callback_test.go");
const terraform = read("services/external-integrations-qbo/infra/main.tf");
const variables = read("services/external-integrations-qbo/infra/variables.tf");
const terraformVersions = read("services/external-integrations-qbo/infra/versions.tf");
const terraformLock = read("services/external-integrations-qbo/infra/.terraform.lock.hcl");
const dockerfile = read("services/external-integrations-qbo/Dockerfile");
const descriptor = read("lib/integrations/providers/qbo/descriptor.ts");
const status = read("lib/integrations/control-plane/customer-status.ts");
const schedulerRepositoryCall = repository.match(
  /"schedule_qbo_initialization_v2",\s*\{([\s\S]*?)\},\s*client/
)?.[1] ?? "";
const publicCallbackGrant = terraform.match(
  /resource "google_cloud_run_v2_service_iam_member" "public_callback" \{([\s\S]*?)\n\}/
)?.[1] ?? "";

matches(connect, /requireWorkspaceAccess\(\)/, "connect derives workspace authority from the server session");
matches(connect, /\.eq\("workspace_id", access\.workspaceId\)/, "connect binds the entity to the authorized workspace");
matches(connect, /\.eq\("status", "active"\)/, "connect requires an active business entity");
matches(connect, /\['owner', 'admin', 'manager'\]/, "connect requires a management role");
matches(connect, /assertQboCustomerRequestOrigin\(request\)/, "connect enforces same-origin request provenance");
excludes(connect, /input\.workspaceId/, "connect never trusts a caller workspace ID");
excludes(connect, /input\.providerEnvironment/, "connect never trusts a caller provider environment");
matches(connect, /randomBytes\(32\)\.toString\("base64url"\)/, "OAuth state uses server-generated entropy");
matches(connect, /`i1_\$\{randomBytes\(32\)\.toString\("base64url"\)\}`/, "initial OAuth state has an unambiguous server-owned namespace");
matches(connect, /createQboCustomerOAuthState/, "connect persists state through the customer-bound V2 RPC");
matches(connect, /NextResponse\.redirect/, "the browser receives only the provider redirect");
excludes(connect, /accessToken|refreshToken|clientSecret/, "connect does not expose credential material");

matches(reauthorize, /requireWorkspaceAccess\(\)/, "reauthorization derives workspace authority from the server session");
matches(reauthorize, /createQboCustomerReauthorizationState/, "reauthorization uses the Production V2 state contract");
matches(reauthorize, /expectedConnectionRowVersion/, "reauthorization carries an exact connection CAS snapshot");
excludes(reauthorize, /input\.workspaceId/, "reauthorization cannot substitute caller workspace authority");
excludes(reauthorize, /input\.mappingId/, "reauthorization cannot substitute a caller mapping");
excludes(reauthorize, /input\.credentialId/, "reauthorization cannot substitute a caller credential");

matches(oauth, /request\.arrayBuffer\(\)/, "customer OAuth request limits are enforced on actual bytes");
matches(oauth, /bytes\.byteLength > maximumBytes/, "oversized customer requests fail closed");
matches(oauth, /new URL\(origin\)\.origin !== applicationOrigin\(\)/, "customer OAuth requires the exact configured origin");
matches(oauth, /QBO_PRODUCTION_CLIENT_ID/, "Production client ID is environment-driven");
matches(oauth, /QBO_PRODUCTION_CALLBACK_URI/, "Production callback is environment-driven");
matches(oauth, /QBO_PRODUCTION_RETURN_INTENT/, "Production return intent is environment-driven");
excludes(oauth, /https:\/\/[^"']*(?:sslip\.io|p8b|phase8b)/i, "customer OAuth contains no qualification endpoint constants");

matches(migration, /create or replace function private\.is_phase_8a0_provider_descriptor_v1/, "Production pins reviewed descriptor fingerprints");
matches(migration, /2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad/, "Production registry fingerprint is exact");
matches(migration, /1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f/, "Production QBO descriptor fingerprint is exact");
matches(migration, /integration_qbo_runtime_configurations/, "runtime configuration is database registered");
matches(migration, /authorization_redirect_uri not ilike '%sslip\.io%'/, "Production callback rejects disposable hosts");
matches(migration, /queue_name not ilike 'p8b-%'/, "Production configuration rejects Phase 8B queues");
matches(migration, /create_qbo_customer_oauth_state_v2/, "customer OAuth V2 is forward-only");
matches(migration, /public\.can_edit_operations\(v_connection\.workspace_id\)/, "OAuth state creation rechecks customer workspace authority in Postgres");
matches(migration, /expected_connection_row_version/, "OAuth state binds the exact connection row snapshot");
matches(migration, /state\.expires_at > v_now/, "OAuth state enforces bounded usability");
matches(migration, /qbo_customer_oauth_state_pending/, "one usable OAuth state per connection is enforced");
matches(migration, /state_replayed/, "OAuth state replay is explicitly denied");
matches(migration, /create_qbo_customer_reauthorization_state_v2/, "Production reauthorization has a distinct V2 contract");
matches(migration, /store_qbo_customer_reauthorized_credential_v2/, "Production credential replacement is atomic in the database");
matches(migration, /invalid_grant/, "invalid grant evidence remains a reauthorization blocker");
matches(migration, /provider_revoked/, "provider revocation remains a reauthorization blocker");

matches(migration, /schedule_qbo_initialization_v2\(/, "Production has a database-derived initialization scheduler");
matches(migration, /integration_task_scheduler_authority/, "initialization uses a dedicated scheduler authority");
matches(migration, /p_limit not between 1 and 25/, "initialization scheduling is bounded");
matches(migration, /for update of connection skip locked/, "concurrent schedulers use row-locked ownership");
matches(migration, /not exists \([\s\S]*existing_run[\s\S]*mode = 'initialization'/, "a connection generation receives at most one initialization run");
matches(migration, /v_task_count <> 24/, "the initial Production stream set is exact");
matches(migration, /foreach v_stream_key in array v_streams/, "scheduler creates each stream from a database-owned allowlist");
ok(schedulerRepositoryCall.length > 0, "scheduler repository call is statically inspectable");
excludes(schedulerRepositoryCall, /p_(?:workspace|business_entity|connection|generation)/, "scheduler API accepts no caller tenant override");

matches(migration, /discover_qbo_runtime_dispatch_v2/, "Production uses V2 database-derived dispatch discovery");
matches(migration, /row_number\(\) over \([\s\S]*partition by task\.workspace_id, task\.connection_id/, "fairness gives each connection an ordinal");
matches(migration, /eligible\.connection_ordinal,[\s\S]*last_served_at nulls first/, "dispatch is round-robin before serving additional connection work");
matches(migration, /task\.delivery_attribution_state <> 'legacy_unattributed'/, "legacy unattributed delivery remains quarantined");
matches(migration, /private\.qbo_provider_endpoint_binding_v1\(task\.stream_key\) is not null/, "unknown streams cannot be dispatched");
matches(migration, /discover_qbo_runtime_dispatch_reconciliation_v2/, "never-delivered reservations have a database-derived reconciliation path");
matches(migration, /last_delivery_dispatch_generation is distinct from[\s\S]*task\.dispatch_generation/, "reconciliation is limited to the current generation without delivery evidence");
matches(migration, /qbo_cloud_task_staged_dispatch_generation is distinct from[\s\S]*task\.dispatch_generation/, "confirmed current-generation envelopes are excluded from reconciliation");
matches(migration, /confirm_qbo_runtime_cloud_task_staged_v2/, "Cloud Task creation has a narrow durable staging-confirmation contract");
matches(migration, /qbo_runtime_cloud_task_staging_stale/, "staging confirmation is CAS protected");
excludes(migration.match(/discover_qbo_runtime_dispatch_reconciliation_v2[\s\S]*?\$function\$;/)?.[0] ?? "", /interval|updated_at\s*[<>]=?\s*v_now/, "dispatch reconciliation never uses age as task-recovery authority");

matches(server, /z\.object\(\{\s*maximumConnections:/, "scheduler HTTP input contains only a batch bound");
matches(server, /z\.object\(\{\s*maximumTasks:[\s\S]*queueClass:/, "dispatcher HTTP input contains only bounded non-tenant controls");
matches(server, /CloudTaskEnvelopeSchema\.parse/, "runtime parses the canonical task-only Cloud Tasks envelope");
excludes(server, /envelope\.workspaceId|envelope\.connectionId|envelope\.businessEntityId/, "runtime never accepts envelope tenant identity");
matches(server, /readQboRuntimeTaskDelivery/, "runtime derives tenant authority from the authoritative task");
matches(server, /discoverQboRuntimeDispatchReconciliation/, "dispatcher reconciles durable reservations before new dispatch work");
matches(server, /confirmQboRuntimeCloudTaskStaged/, "dispatcher confirms external envelope creation through the database authority boundary");
matches(server, /canonicalTaskName\(reservation\.dispatcherTaskName\)/, "reservation reconciliation revalidates the exact configured Cloud Task identity");
matches(server, /remainingCapacity = body\.maximumTasks - reservations\.length/, "reconciliation and new staging share one strict batch bound");
matches(server, /if \(result\.created\) reconciledCreated \+= 1;[\s\S]*reconciledExisting \+= 1/, "idempotent Cloud Tasks create distinguishes recreated and already-existing envelopes");
matches(repository, /"confirm_qbo_runtime_cloud_task_staged_v2"/, "repository exposes only the typed staging-confirmation RPC");
matches(server, /parseQboProductionCloudTaskDelivery/, "runtime validates Cloud Tasks delivery headers");
matches(server, /qbo_production_oauth_state_namespace_invalid/, "broker rejects OAuth state namespaces it did not issue");
matches(server, /\^\(\?:i1_\|r1_\)\[A-Za-z0-9_-\]\{43\}\$/, "broker accepts only exact initial and reauthorization state namespaces");
matches(terraform, /google_cloud_run_v2_service_iam_member" "task_to_runtime"[\s\S]*roles\/run\.invoker[\s\S]*task_invoker/, "Cloud Run admits task delivery only from the dedicated OIDC identity");
matches(publicCallbackGrant, /service\["oauth_ingress"\]/, "the only public invoker grant targets OAuth ingress");
excludes(publicCallbackGrant, /provider_runtime/, "the public callback grant cannot reach the provider runtime");
matches(server, /BoundedIdentifierSchema\.parse\(credential\.externalAuthorizedEntityReference\)/, "QBO runtime requires the broker-authorized realm");
matches(server, /externalReferenceFingerprint\(realmId\) !== authority\.providerTenantReferenceFingerprint/, "decrypted realm is compared by fingerprint");
matches(companyVerifier, /qbo_sandbox_company_verification_v1/, "generic verifier preserves the historical sandbox fingerprint contract");
matches(companyVerifier, /qbo_production_company_verification_v1/, "Production verification uses a distinct environment-bound fingerprint contract");
matches(server, /if \(!decision\.acquired\)[\s\S]*leaseAcquired: false/, "non-owners stop before provider execution");
excludes(server, /PHASE8B_|P8B_/, "Production runtime has no qualification process constants");
excludes(database, /service_role/, "Production database roles do not include service_role");
matches(database, /set local role/, "every Production RPC transaction assumes one explicit narrow role");

matches(callbackHandoff, /x-vaeroex-oauth-handoff-version/, "callback handoff uses reserved internal headers");
excludes(server, /url\.searchParams/, "Cloud Run never parses sensitive OAuth callback query parameters");
matches(server, /parseQboOAuthCallbackHandoff\(\{[\s\S]*headers: request\.headers[\s\S]*\}\)/, "Cloud Run accepts only the sanitized edge handoff");
matches(edgeCallback, /len\(parts\) != 3/, "callback edge requires exactly code, state, and realmId");
matches(edgeCallback, /path != CallbackPath/, "callback edge requires the exact callback path");
matches(edgeCallback, /IsWebhookRequest/, "callback edge has an exact queryless webhook pass-through");
matches(edgePlugin, /ReplaceHttpRequestHeader\(":path", callbackedge\.CallbackPath\)/, "edge strips the OAuth query before forwarding");
matches(edgePlugin, /clearReservedHandoffHeaders/, "edge removes caller-forged callback handoff headers");
matches(edgePlugin, /fail|invalid integration callback/i, "edge fails malformed callbacks closed");
matches(edgeTests, /TestCallbackHandoffIsExactAndQueryStripping/, "edge query stripping has focused tests");
matches(webhookSignature, /timingSafeEqual/, "webhook verification uses constant-time HMAC comparison");
matches(server, /verifyAndParseQboCloudEventsWebhook/, "broker verifies signed QBO webhook bytes");
matches(server, /recordVerifiedWebhookEvent/, "verified webhooks become bounded hint-only ledger evidence");
excludes(server, /rawBody.*safeEvent|safeEvent.*rawBody/, "raw webhook bytes are never logged");

matches(migration, /v_credential\.external_entity_reference_fingerprint <>[\s\S]*v_mapping\.provider_entity_reference_fingerprint/, "task delivery binds credential realm to mapping realm");
matches(migration, /v_credential\.granted_scopes <>[\s\S]*com\.intuit\.quickbooks\.accounting/, "task delivery binds the exact accounting scope");
matches(migration, /record_qbo_provider_result_v2/, "provider results remain task-bound evidence");
matches(migration, /record_qbo_report_parser_result_v2/, "report parser results remain provider-result-bound evidence");
matches(migration, /complete_qbo_runtime_task_v2/, "Production completion uses an environment-generic V2 contract");
matches(executor, /credentialReadEvidenceId/, "provider reads propagate task-bound credential evidence");
matches(executor, /providerResultObserver/, "every QBO request records bounded provider evidence");
matches(executor, /recordQboReportParserResult/, "reports record bounded parser evidence");

matches(server, /request\.headers\["x-cloudtasks-queuename"\]/, "runtime supplies the authenticated delivery queue header to validation");
matches(server, /request\.headers\["x-cloudtasks-taskretrycount"\]/, "runtime supplies the canonical retry header to validation");
matches(server, /request\.headers\["x-cloudtasks-taskexecutioncount"\]/, "runtime supplies the canonical execution header to validation");
matches(delivery, /input\.queueHeader !== input\.expectedQueueName/, "delivery validation requires the exact configured queue name");

matches(terraform, /task_scheduler\s+= "task_scheduler"/, "IaC deploys a distinct task scheduler mode");
matches(terraform, /dispatch_scheduler\s+= "qbo-dispatch-scheduler"/, "dispatcher invocation has a distinct identity");
matches(terraform, /initialization_scheduler\s+= "qbo-initialization-scheduler"/, "initialization invocation has a distinct identity");
matches(terraform, /google_cloud_scheduler_job" "initializer"/, "initialization scheduling is permanent IaC");
matches(terraform, /google_cloud_scheduler_job" "dispatcher"/, "dispatch scheduling is permanent IaC");
matches(terraform, /roles\/cloudtasks\.enqueuer[\s\S]*task_dispatcher/, "only the dispatcher is a Cloud Tasks enqueuer");
matches(terraform, /roles\/cloudkms\.cryptoKeyEncrypterDecrypter[\s\S]*credential_broker/, "only the broker receives KMS authority");
matches(terraform, /provider_secret_version/, "provider secret access is version pinned");
matches(terraform, /webhook_secret_version/, "webhook verification secret access is version pinned");
matches(terraform, /google_secret_manager_secret_iam_member" "webhook"[\s\S]*credential_broker/, "only the broker can read the webhook verifier secret");
matches(terraform, /task_invoker/, "Cloud Tasks uses a dedicated runtime invoker");
matches(terraform, /oauth_ingress" \? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"/, "direct callback service ingress is closed outside the load balancer");
matches(terraform, /google_network_services_wasm_plugin" "callback"/, "Production callback uses a managed immutable edge plugin");
matches(terraform, /google_network_services_lb_edge_extension" "callback"[\s\S]*fail_open\s+= false/, "callback edge extension fails closed");
matches(terraform, /forward_headers = \[[\s\S]*content-length[\s\S]*x-vaeroex-oauth-state[\s\S]*\]/, "callback edge receives only the headers required for body and handoff fencing");
matches(terraform, /google_compute_backend_service" "callback"[\s\S]*log_config \{[\s\S]*enable = false/, "callback load-balancer request logging is disabled");
matches(terraform, /google_network_services_wasm_plugin" "callback"[\s\S]*log_config \{[\s\S]*enable = false/, "callback plugin logging is disabled");
matches(terraform, /deletion_policy\s+= "PREVENT"/, "callback edge artifacts cannot be deleted accidentally");
matches(terraformVersions, /version = "7\.34\.0"/, "Google provider version is pinned for the reviewed edge resources");
matches(terraformLock, /provider "registry\.terraform\.io\/hashicorp\/google"/, "the Terraform dependency lock pins the exact Google provider source");
matches(terraformLock, /version\s+= "7\.34\.0"[\s\S]*constraints = "7\.34\.0"/, "the Terraform dependency lock pins the reviewed Google provider version");
matches(terraformLock, /hashes = \[[\s\S]*"zh:[a-f0-9]{64}"/, "the Terraform dependency lock records provider package checksums");
matches(variables, /image_digest must be an immutable sha256 image reference/, "IaC requires an immutable image digest");
matches(variables, /source_commit must be a full Git commit SHA/, "IaC records the exact source commit");
excludes(terraform, /p8b-qbo|canary|sslip\.io|sandbox-quickbooks|intuit.*development/i, "deployable IaC contains no qualification resource binding");
matches(dockerfile, /FROM node:22\.23\.1-bookworm-slim@sha256:/, "build image is digest pinned");
matches(dockerfile, /FROM gcr\.io\/distroless\/nodejs22-debian12@sha256:/, "runtime image is digest pinned");

matches(descriptor, /qbo_production_read_only_v1/, "descriptor uses the Production read-only gate");
matches(descriptor, /accounting_writes/, "Production continues to prohibit accounting writes");
matches(descriptor, /requiredForActivation: true/, "activation streams remain explicit descriptor data");
matches(migration, /integration_stream_freshness_domain_v1/, "activation uses an explicit stream-to-domain mapping");
matches(migration, /integration_connection_activation_gate_unsatisfied/, "missing or stale required streams block activation");
matches(status, /lastSuccessfulSyncAt/, "customer status reports last successful sync");
matches(status, /freshness/, "customer status reports freshness");
excludes(status, /credential|lease|ciphertext|kms/i, "customer status hides internal security implementation");

ok(assertionCount >= 120, "Production boundary has broad focused regression coverage");
console.log(`QBO Production multi-tenant regressions: ${assertionCount} assertions passed; model calls 0; promotionAuthorized false.`);
