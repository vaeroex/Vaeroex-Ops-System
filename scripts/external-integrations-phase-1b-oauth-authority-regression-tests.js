const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request === "server-only") {
    return path.join(root, "scripts/test-stubs/server-only.js");
  }
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(
      this,
      path.join(root, request.slice(2)),
      parent,
      isMain,
      options
    );
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const credentials = require("../lib/integrations/credentials/index.ts");
const qboPolicy = require("../lib/integrations/provider-runtime/qbo/oauth-policy.ts");
const qboRuntimeOAuth = require("../lib/integrations/provider-runtime/qbo/oauth.ts");
const providerRegistry = require("../lib/integrations/control-plane/provider-registry.ts");
const qboDescriptor = require("../lib/integrations/providers/qbo/descriptor.ts");

let assertionCount = 0;
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function deepEqual(actual, expected, message) {
  assertionCount += 1;
  assert.deepEqual(actual, expected, message);
}
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function throws(callback, matcher, message) {
  assertionCount += 1;
  assert.throws(callback, matcher, message);
}
function doesNotMatch(value, matcher, message) {
  assertionCount += 1;
  assert.doesNotMatch(value, matcher, message);
}

const MODEL_CALL_COUNT = 0;
const EXPECTED_QBO_DESCRIPTOR_FINGERPRINT =
  "sha256:1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f";
const EXPECTED_QBO_REGISTRY_FINGERPRINT =
  "sha256:2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad";
const sensitiveCanaries = [
  "phase1b-access-token-canary",
  "phase1b-refresh-token-canary",
  "phase1b-authorization-code-canary",
  "phase1b-client-secret-canary",
  "phase1b-merchant-raw-identity",
  "phase1b-location-raw-identity"
];
const sensitivePattern = new RegExp(sensitiveCanaries.join("|"));
const policyDeniedPattern =
  /policy|denied|invalid|required|OAuth return|OAuth endpoint|OAuth callback|Zod/i;

const retailPolicy = credentials.ProviderOAuthPolicySchema.parse({
  contractVersion: "provider_oauth_policy_v1",
  policyVersion: "synthetic_retail_oauth_policy_v1",
  providerKey: "synthetic_retail",
  providerEnvironment: "sandbox",
  authorizationMode: "oauth2_confidential_authorization_code",
  authorizationEndpoint: "https://oauth.synthetic-retail.example/authorize",
  tokenEndpoint: "https://oauth.synthetic-retail.example/token",
  revocationEndpoint: "https://oauth.synthetic-retail.example/revoke",
  callbackUri: "https://oauth.synthetic-retail.example/oauth/callback",
  callbackPath: "/oauth/callback",
  defaultAuthorizationReturnPath: "/app/integrations",
  defaultReauthorizationReturnPath: "/app/settings",
  permittedReturnPaths: ["/app/integrations", "/app/settings"],
  requestedScopes: ["read_retail_orders"],
  tokenLifetime: {
    accessTokenMaximumSeconds: 86_400,
    requiredAccessTokenLifetimeSeconds: 86_400,
    providerShortLivedAccessTokenRequired: true
  },
  externalEntityAuthority: {
    requiredForAuthorization: true,
    authorizedEntityTypes: ["location", "merchant"],
    reauthorizationEntityTypes: ["merchant"]
  }
});

function envelope(policy, options = {}) {
  const now = options.now ?? "2026-09-03T12:00:00.000Z";
  const lifetimeSeconds = options.lifetimeSeconds ?? 86_400;
  return {
    schemaVersion: "oauth_credential_envelope_v1",
    providerKey: options.providerKey ?? policy.providerKey,
    environment: options.providerEnvironment ?? policy.providerEnvironment,
    externalAuthorizedEntityReference:
      options.externalAuthorizedEntityReference ?? "phase1b-merchant-ref",
    accessToken: options.accessToken ?? "phase1b-access-token-canary-0001",
    accessExpiresAt:
      options.accessExpiresAt ??
      new Date(Date.parse(now) + lifetimeSeconds * 1_000).toISOString(),
    refreshToken: options.refreshToken ?? "phase1b-refresh-token-canary-0001",
    refreshExpiresAt:
      options.refreshExpiresAt ??
      new Date(Date.parse(now) + 30 * 86_400_000).toISOString(),
    grantedScopes: options.grantedScopes ?? policy.requestedScopes,
    issuedAt: options.issuedAt ?? now,
    updatedAt: options.updatedAt ?? now
  };
}

function evidence(policy, entityType, options = {}) {
  return {
    providerKey: options.providerKey ?? policy.providerKey,
    providerEnvironment:
      options.providerEnvironment ?? policy.providerEnvironment,
    externalAuthorizedEntityReference:
      options.externalAuthorizedEntityReference ?? "phase1b-merchant-ref",
    providerEntityType: entityType,
    safeDisplayName: "Synthetic Retail Merchant",
    verificationFingerprint:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  };
}

function minimalBrokerInput(overrides = {}) {
  const unavailable = async () => {
    throw new Error("unreachable");
  };
  return {
    store: {
      createOAuthState: unavailable,
      consumeOAuthState: unavailable,
      storeCredential: unavailable,
      createReauthorizationState: unavailable,
      consumeReauthorizationState: unavailable,
      storeReauthorizedCredential: unavailable,
      readProviderCredential: unavailable,
      recordProviderCredentialReadFailure: unavailable,
      acquireRefreshLease: unavailable,
      reclaimExpiredRefreshLease: unavailable,
      rotateCredential: unavailable,
      completeRefreshFailure: unavailable,
      revokeCredential: unavailable,
      completeCredentialRevocation: unavailable,
      destroyCredential: unavailable,
      recordAuthorizationEvent: unavailable,
      recordRefreshBoundaryEvent: unavailable
    },
    kms: { encrypt: unavailable, decrypt: unavailable },
    kmsKeyResource:
      "projects/vaeroex-phase1b-test/locations/us-central1/keyRings/test/cryptoKeys/oauth",
    secrets: { access: unavailable },
    provider: {
      providerKey: "synthetic_retail",
      environment: "sandbox",
      refreshTokenRotationPolicy: "returned_token_authoritative",
      tokenType: "bearer",
      exchangeAuthorizationCode: unavailable,
      refreshCredential: unavailable,
      revokeCredential: unavailable
    },
    providerOAuthPolicy: retailPolicy,
    ...overrides
  };
}

function captureError(callback) {
  try {
    callback();
    return null;
  } catch (error) {
    return error;
  }
}

function testPolicyRegistry() {
  const registry = credentials.createProviderOAuthPolicyRegistry([
    qboPolicy.QBO_PRODUCTION_OAUTH_POLICY,
    retailPolicy,
    qboPolicy.QBO_PHASE_8B_OAUTH_POLICY
  ]);
  equal(registry.contractVersion, "provider_oauth_policy_registry_v1", "OAuth policy registry has a versioned contract");
  deepEqual(
    registry.policies.map((policy) => `${policy.providerKey}:${policy.providerEnvironment}`),
    [
      "quickbooks_online:production",
      "quickbooks_online:sandbox",
      "synthetic_retail:sandbox"
    ],
    "policy registry is deterministic by exact provider and environment"
  );
  equal(
    credentials.providerOAuthPolicy(registry, "synthetic_retail", "sandbox")
      .policyVersion,
    "synthetic_retail_oauth_policy_v1",
    "static policy lookup succeeds for exact provider/environment"
  );
  throws(
    () => credentials.providerOAuthPolicy(registry, "synthetic_retail", "production"),
    /not_registered/,
    "unknown provider environment fails closed"
  );
  throws(
    () => credentials.providerOAuthPolicy(registry, "square", "sandbox"),
    /not_registered/,
    "unregistered provider fails closed"
  );
  throws(
    () => credentials.createProviderOAuthPolicyRegistry([
      retailPolicy,
      { ...retailPolicy, policyVersion: "synthetic_retail_duplicate_v1" }
    ]),
    /unique/i,
    "duplicate provider/environment policy registration fails closed"
  );
  throws(
    () => credentials.assertProviderOAuthPolicyBinding(retailPolicy, {
      providerKey: "quickbooks_online",
      providerEnvironment: "sandbox"
    }),
    /binding_invalid/,
    "provider mismatch cannot reuse another provider OAuth policy"
  );
  throws(
    () => credentials.assertProviderOAuthPolicyBinding(retailPolicy, {
      providerKey: "synthetic_retail",
      providerEnvironment: "production"
    }),
    /binding_invalid/,
    "environment mismatch cannot reuse another environment OAuth policy"
  );
  throws(
    () => new credentials.IntegrationCredentialBroker({
      ...minimalBrokerInput(),
      providerOAuthPolicy: undefined
    }),
    policyDeniedPattern,
    "broker construction fails closed when policy is missing"
  );
  throws(
    () => new credentials.IntegrationCredentialBroker({
      ...minimalBrokerInput(),
      providerOAuthPolicy: qboPolicy.QBO_PHASE_8B_OAUTH_POLICY
    }),
    /binding_invalid/,
    "broker construction fails closed when provider and policy disagree"
  );
}

function testQboPolicyParity() {
  equal(qboPolicy.QBO_ACCOUNTING_SCOPE, "com.intuit.quickbooks.accounting", "QBO accounting scope stays QBO-owned");
  equal(qboRuntimeOAuth.QBO_ACCOUNTING_SCOPE, qboPolicy.QBO_ACCOUNTING_SCOPE, "legacy QBO runtime export remains available");
  equal(qboPolicy.QBO_AUTHORIZATION_ENDPOINT, "https://appcenter.intuit.com/connect/oauth2", "QBO authorization endpoint is unchanged");
  equal(qboPolicy.QBO_TOKEN_ENDPOINT, "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", "QBO token endpoint is unchanged");
  equal(qboPolicy.QBO_REVOCATION_ENDPOINT, "https://developer.api.intuit.com/v2/oauth2/tokens/revoke", "QBO revocation endpoint is unchanged");
  equal(qboPolicy.QBO_PRODUCTION_OAUTH_POLICY.callbackUri, "https://integrations.vaeroex.com/oauth/callback", "QBO Production callback URI is unchanged");
  equal(qboPolicy.QBO_PHASE_8B_OAUTH_POLICY.callbackUri, "https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback", "QBO Phase 8B callback URI is unchanged");
  equal(qboPolicy.QBO_PHASE_8B_OAUTH_POLICY.defaultReauthorizationReturnPath, "/phase8b/sandbox/reauthorized", "QBO Phase 8B reauthorization return path is unchanged");
  deepEqual(qboPolicy.QBO_PRODUCTION_OAUTH_POLICY.externalEntityAuthority.authorizedEntityTypes, ["company"], "QBO provider entity authority remains company-only");
  equal(qboPolicy.QBO_PRODUCTION_OAUTH_POLICY.tokenLifetime.accessTokenMaximumSeconds, 86_400, "QBO keeps the 24-hour access-token ceiling");
  const authorizationUrl = qboRuntimeOAuth.createQboAuthorizationUrl({
    clientId: "quickbooks-production-client",
    redirectUri: qboPolicy.QBO_PRODUCTION_CALLBACK_URI,
    state: "A".repeat(43)
  });
  ok(authorizationUrl.startsWith(`${qboPolicy.QBO_AUTHORIZATION_ENDPOINT}?`), "QBO authorization URL still uses the exact endpoint");
  ok(authorizationUrl.includes("scope=com.intuit.quickbooks.accounting"), "QBO authorization URL still requests only accounting scope");

  const registry = providerRegistry.assertProviderDescriptorRegistry(
    qboDescriptor.QBO_PHASE_7_PROVIDER_REGISTRY
  );
  equal(registry.descriptors[0].descriptorFingerprint, EXPECTED_QBO_DESCRIPTOR_FINGERPRINT, "QBO descriptor fingerprint is unchanged");
  equal(registry.registryFingerprint, EXPECTED_QBO_REGISTRY_FINGERPRINT, "QBO registry fingerprint is unchanged");
}

function testTokenLifetimePolicy() {
  const exact = credentials.assertCredentialEnvelopeMatchesProviderOAuthPolicy(
    retailPolicy,
    envelope(retailPolicy, { lifetimeSeconds: 86_400 })
  );
  equal(exact.accessExpiresAt, "2026-09-04T12:00:00.000Z", "synthetic 24-hour policy accepts exact short-lived access tokens");
  throws(
    () => credentials.assertCredentialEnvelopeMatchesProviderOAuthPolicy(
      retailPolicy,
      envelope(retailPolicy, { lifetimeSeconds: 86_401 })
    ),
    /lifetime_invalid/,
    "longer access-token lifetime is rejected"
  );
  throws(
    () => credentials.assertCredentialEnvelopeMatchesProviderOAuthPolicy(
      retailPolicy,
      envelope(retailPolicy, { lifetimeSeconds: 3_600 })
    ),
    /lifetime_required/,
    "short-lived policy can require an exact 24-hour access token"
  );
  const missingExpiry = envelope(retailPolicy);
  delete missingExpiry.accessExpiresAt;
  throws(
    () => credentials.assertCredentialEnvelopeMatchesProviderOAuthPolicy(
      retailPolicy,
      missingExpiry
    ),
    policyDeniedPattern,
    "missing access-token expiry is rejected"
  );
  throws(
    () => credentials.assertCredentialEnvelopeMatchesProviderOAuthPolicy(
      retailPolicy,
      envelope(retailPolicy, { accessExpiresAt: "not-a-date" })
    ),
    policyDeniedPattern,
    "malformed access-token expiry is rejected"
  );
  throws(
    () => credentials.assertCredentialEnvelopeMatchesProviderOAuthPolicy(
      retailPolicy,
      envelope(retailPolicy, { providerKey: "quickbooks_online" })
    ),
    /binding_invalid/,
    "token response provider mismatch is rejected"
  );
  throws(
    () => credentials.assertCredentialEnvelopeMatchesProviderOAuthPolicy(
      retailPolicy,
      envelope(retailPolicy, { providerEnvironment: "production" })
    ),
    /binding_invalid/,
    "token response environment mismatch is rejected"
  );
  credentials.assertCredentialEnvelopeMatchesProviderOAuthPolicy(
    qboPolicy.QBO_PRODUCTION_OAUTH_POLICY,
    envelope(qboPolicy.QBO_PRODUCTION_OAUTH_POLICY, { lifetimeSeconds: 3_600 })
  );
  credentials.assertCredentialEnvelopeMatchesProviderOAuthPolicy(
    qboPolicy.QBO_PRODUCTION_OAUTH_POLICY,
    envelope(qboPolicy.QBO_PRODUCTION_OAUTH_POLICY, { lifetimeSeconds: 86_400 })
  );
  throws(
    () => credentials.assertCredentialEnvelopeMatchesProviderOAuthPolicy(
      qboPolicy.QBO_PRODUCTION_OAUTH_POLICY,
      envelope(qboPolicy.QBO_PRODUCTION_OAUTH_POLICY, { lifetimeSeconds: 86_401 })
    ),
    /lifetime_invalid/,
    "QBO policy also retains the universal 24-hour ceiling"
  );
}

function testEntityAuthority() {
  for (const entityType of ["merchant", "location"]) {
    equal(
      credentials.assertAuthorizedProviderEntityEvidence(
        retailPolicy,
        evidence(retailPolicy, entityType),
        {
          externalAuthorizedEntityReference: "phase1b-merchant-ref",
          purpose: "authorization"
        }
      ).providerEntityType,
      entityType,
      `${entityType} authority is accepted only when statically declared`
    );
  }
  throws(
    () => credentials.assertAuthorizedProviderEntityEvidence(
      retailPolicy,
      evidence(retailPolicy, "customer"),
      {
        externalAuthorizedEntityReference: "phase1b-merchant-ref",
        purpose: "authorization"
      }
    ),
    /entity_type_denied/,
    "entity types outside the provider allowlist are rejected"
  );
  credentials.assertAuthorizedProviderEntityEvidence(
    retailPolicy,
    evidence(retailPolicy, "merchant"),
    {
      externalAuthorizedEntityReference: "phase1b-merchant-ref",
      purpose: "reauthorization"
    }
  );
  throws(
    () => credentials.assertAuthorizedProviderEntityEvidence(
      retailPolicy,
      evidence(retailPolicy, "location"),
      {
        externalAuthorizedEntityReference: "phase1b-merchant-ref",
        purpose: "reauthorization"
      }
    ),
    /entity_type_denied/,
    "reauthorization entity types also come from static provider policy"
  );
  throws(
    () => credentials.assertAuthorizedProviderEntityEvidence(
      retailPolicy,
      evidence(retailPolicy, "merchant", { providerKey: "quickbooks_online" }),
      {
        externalAuthorizedEntityReference: "phase1b-merchant-ref",
        purpose: "authorization"
      }
    ),
    /entity_authority_binding_invalid/,
    "cross-provider entity authority substitution is rejected"
  );
  throws(
    () => credentials.assertAuthorizedProviderEntityEvidence(
      retailPolicy,
      evidence(retailPolicy, "merchant", { providerEnvironment: "production" }),
      {
        externalAuthorizedEntityReference: "phase1b-merchant-ref",
        purpose: "authorization"
      }
    ),
    /entity_authority_binding_invalid/,
    "cross-environment entity authority substitution is rejected"
  );
  throws(
    () => credentials.assertAuthorizedProviderEntityEvidence(
      retailPolicy,
      evidence(retailPolicy, "merchant", {
        externalAuthorizedEntityReference: "phase1b-location-raw-identity"
      }),
      {
        externalAuthorizedEntityReference: "phase1b-merchant-raw-identity",
        purpose: "authorization"
      }
    ),
    /entity_authority_binding_invalid/,
    "raw external identity cannot be swapped across entity authorities"
  );
}

function testReturnPathAndCallbackSafety() {
  equal(
    credentials.normalizeProviderOAuthReturnPath(retailPolicy, "/app/integrations"),
    "/app/integrations",
    "safe allowlisted return path is accepted"
  );
  equal(
    credentials.normalizeProviderOAuthReturnPath(retailPolicy, "/app/settings"),
    "/app/settings",
    "second safe allowlisted return path is accepted"
  );
  const deniedReturnPaths = [
    "https://attacker.example/app/integrations",
    "http://attacker.example/app/integrations",
    "//attacker.example/app/integrations",
    "/app/%2e%2e/settings",
    "/app//settings",
    "/app\\settings",
    "/app/settings#fragment",
    "/app/settings?next=/app/integrations",
    "/app/settings@attacker",
    "/app/settings:443",
    "/app/settings.",
    "/app/../settings",
    " /app/settings",
    "/app/phase1b-access-token-canary"
  ];
  for (const value of deniedReturnPaths) {
    const error = captureError(() =>
      credentials.normalizeProviderOAuthReturnPath(retailPolicy, value)
    );
    ok(error, `unsafe return path is denied: ${value}`);
    doesNotMatch(String(error), sensitivePattern, "return-path error is redacted");
  }
  equal(
    credentials.validateProviderOAuthCallbackUri(
      retailPolicy,
      retailPolicy.callbackUri
    ),
    retailPolicy.callbackUri,
    "exact callback URI is accepted"
  );
  const deniedCallbacks = [
    "https://oauth.synthetic-retail.example:443/oauth/callback",
    "https://user:pass@oauth.synthetic-retail.example/oauth/callback",
    "https://oauth.synthetic-retail.example./oauth/callback",
    "https://oauth.synthetic-retail.example/oauth/%63allback",
    "https://oauth.synthetic-retail.example/oauth//callback",
    "https://oauth.synthetic-retail.example/oauth/callback?code=phase1b-authorization-code-canary",
    "https://oauth.synthetic-retail.example/oauth/callback#fragment",
    "https://attacker.example/oauth/callback",
    "http://oauth.synthetic-retail.example/oauth/callback"
  ];
  for (const value of deniedCallbacks) {
    const error = captureError(() =>
      credentials.validateProviderOAuthCallbackUri(retailPolicy, value)
    );
    ok(error, `unsafe callback URI is denied: ${value}`);
    doesNotMatch(String(error), sensitivePattern, "callback error is redacted");
  }
  const malformedRedirectError = captureError(() =>
    credentials.ReauthorizationRedirectUriSchema.parse("https://")
  );
  ok(malformedRedirectError, "malformed reauthorization redirect URI is rejected");
  doesNotMatch(
    String(malformedRedirectError),
    sensitivePattern,
    "malformed redirect URI error is redacted"
  );
}

function testDeterministicAndRedactedDiagnostics() {
  const left = credentials.providerOAuthPolicyFingerprint(retailPolicy);
  const right = credentials.providerOAuthPolicyFingerprint(
    credentials.ProviderOAuthPolicySchema.parse({ ...retailPolicy })
  );
  equal(left, right, "provider OAuth policy fingerprints are deterministic");
  doesNotMatch(left, sensitivePattern, "policy fingerprint contains no sensitive values");
  const diagnostics = [
    captureError(() =>
      credentials.normalizeProviderOAuthReturnPath(
        retailPolicy,
        "/app/phase1b-access-token-canary"
      )
    ),
    captureError(() =>
      credentials.assertCredentialEnvelopeMatchesProviderOAuthPolicy(
        retailPolicy,
        envelope(retailPolicy, {
          accessToken: "phase1b-access-token-canary",
          refreshToken: "phase1b-refresh-token-canary",
          lifetimeSeconds: 86_401
        })
      )
    ),
    captureError(() =>
      credentials.assertAuthorizedProviderEntityEvidence(
        retailPolicy,
        evidence(retailPolicy, "merchant", {
          externalAuthorizedEntityReference: "phase1b-location-raw-identity"
        }),
        {
          externalAuthorizedEntityReference: "phase1b-merchant-raw-identity",
          purpose: "authorization"
        }
      )
    ),
    captureError(() =>
      new credentials.IntegrationCredentialBroker({
        ...minimalBrokerInput(),
        provider: {
          ...minimalBrokerInput().provider,
          providerKey: "quickbooks_online"
        }
      })
    )
  ].filter(Boolean);
  const diagnosticText = JSON.stringify(
    diagnostics.map((error) => ({
      name: error.name,
      message: error.message
    }))
  );
  doesNotMatch(
    diagnosticText,
    sensitivePattern,
    "credentials, tokens, authorization codes, and raw identity values are absent from diagnostics"
  );
  const policySource = read("lib/integrations/credentials/oauth-policy.ts");
  const brokerSource = read("lib/integrations/credentials/broker.ts");
  doesNotMatch(
    `${policySource}\n${brokerSource}`,
    /console\.(?:log|error|warn)|modelCall|generateText|openai|anthropic/i,
    "OAuth policy and broker changes add no logs or model calls"
  );
  equal(MODEL_CALL_COUNT, 0, "Phase 1B performs zero model calls");
}

function testStaticArchitectureBoundaries() {
  const contractsSource = read("lib/integrations/credentials/contracts.ts");
  const stateSource = read("lib/integrations/credentials/oauth-state.ts");
  const brokerSource = read("lib/integrations/credentials/broker.ts");
  const qboPolicySource = read("lib/integrations/provider-runtime/qbo/oauth-policy.ts");
  doesNotMatch(
    `${contractsSource}\n${stateSource}\n${brokerSource}`,
    /p8b-oauth-34-120-247-116|phase8b\/sandbox\/reauthorized|appcenter\.intuit|oauth\.platform\.intuit|developer\.api\.intuit/,
    "provider-neutral credential code contains no QBO redirect or endpoint constants"
  );
  ok(
    /QBO_PHASE_8B_CALLBACK_URI/.test(qboPolicySource) &&
      /QBO_PHASE_8B_REAUTHORIZATION_RETURN_PATH/.test(qboPolicySource),
    "QBO redirect and return-path constants live in the QBO-owned policy module"
  );
  ok(
    /providerOAuthPolicy: QBO_PHASE_8B_OAUTH_POLICY/.test(
      read("services/external-integrations-qbo-sandbox/src/server.ts")
    ),
    "Phase 8B sandbox broker receives reviewed static QBO policy"
  );
  ok(
    /providerOAuthPolicy: QBO_PRODUCTION_OAUTH_POLICY/.test(
      read("services/external-integrations-qbo/src/server.ts")
    ),
    "QBO Production broker receives reviewed static QBO policy"
  );
}

testPolicyRegistry();
testQboPolicyParity();
testTokenLifetimePolicy();
testEntityAuthority();
testReturnPathAndCallbackSafety();
testDeterministicAndRedactedDiagnostics();
testStaticArchitectureBoundaries();

console.log(
  `External integration Phase 1B OAuth authority regressions: ${assertionCount} assertions passed.`
);
