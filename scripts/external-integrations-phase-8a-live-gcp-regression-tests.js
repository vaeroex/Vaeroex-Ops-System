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

const qbo = require("../lib/integrations/providers/qbo/index.ts");
const credentials = require("../lib/integrations/credentials/contracts.ts");
const runtime = require("../lib/integrations/runtime/contracts.ts");

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

const rawBody = Buffer.from(
  '[{"specversion":"1.0","id":"evt-1","source":"intuit","type":"qbo.invoice.updated.v1","time":"2026-08-22T00:00:00.000Z","intuitaccountid":"synthetic-realm","intuitentityid":"invoice-1"}]',
  "utf8"
);
const verifierSecret = Buffer.from("phase8a-verifier-token-2026", "utf8");
const expectedSignature = "WYTgTGEnZB34cLgo2qzbjHncjOi1rZEXoZtjF4ivn9E=";
const expectedDeliveryHash =
  "sha256:54c403ee04106a679fe74a14d7f5fa0e0604350fa7f13d7f86abfa4d6bb7e6d6";

equal(
  qbo.QBO_WEBHOOK_SIGNATURE_CONTRACT_VERSION,
  "qbo_webhook_signature_v1",
  "webhook signature boundary is explicitly versioned"
);
equal(qbo.QBO_WEBHOOK_SIGNATURE_HEADER, "intuit-signature", "official signature header is exact");
equal(qbo.QBO_WEBHOOK_MAX_RAW_BODY_BYTES, 2 * 1024 * 1024, "raw webhook bodies are bounded");
equal(
  qbo.verifyQboWebhookSignature({
    rawBody,
    intuitSignature: expectedSignature,
    verifierSecret
  }),
  undefined,
  "official HMAC-SHA256/Base64 contract accepts a deterministic vector"
);
equal(qbo.qboWebhookDeliveryHash(rawBody), expectedDeliveryHash, "delivery hash binds exact raw bytes");

const changedBody = Buffer.from(rawBody);
changedBody[changedBody.length - 2] ^= 1;
throws(
  () => qbo.verifyQboWebhookSignature({
    rawBody: changedBody,
    intuitSignature: expectedSignature,
    verifierSecret
  }),
  /signature_denied/,
  "one changed raw byte fails authentication"
);
throws(
  () => qbo.verifyQboWebhookSignature({
    rawBody,
    intuitSignature: `${expectedSignature.slice(0, -2)}AA`,
    verifierSecret
  }),
  /signature_denied/,
  "wrong digest fails authentication"
);
throws(
  () => qbo.verifyQboWebhookSignature({
    rawBody,
    intuitSignature: expectedSignature,
    verifierSecret: Buffer.from("different-verifier-token-2026", "utf8")
  }),
  /signature_denied/,
  "wrong verifier token fails authentication"
);
const whitespaceChangedBody = Buffer.from(` ${rawBody.toString("utf8")}\n`, "utf8");
throws(
  () => qbo.verifyQboWebhookSignature({
    rawBody: whitespaceChangedBody,
    intuitSignature: expectedSignature,
    verifierSecret
  }),
  /signature_denied/,
  "semantically equivalent JSON with different raw whitespace fails the original signature"
);
throws(
  () => qbo.verifyQboWebhookSignature({
    rawBody,
    intuitSignature: "not-base64",
    verifierSecret
  }),
  /signature_denied/,
  "malformed signature fails closed"
);
throws(
  () => qbo.verifyQboWebhookSignature({
    rawBody: Buffer.alloc(0),
    intuitSignature: expectedSignature,
    verifierSecret
  }),
  /raw_body_size_invalid/,
  "empty webhook payload fails closed"
);
throws(
  () => qbo.verifyQboWebhookSignature({
    rawBody: Buffer.alloc(qbo.QBO_WEBHOOK_MAX_RAW_BODY_BYTES + 1),
    intuitSignature: expectedSignature,
    verifierSecret
  }),
  /raw_body_size_invalid/,
  "oversized webhook payload fails closed"
);

const verified = qbo.verifyAndParseQboCloudEventsWebhook({
  rawBody,
  intuitSignature: expectedSignature,
  verifierSecret,
  expectedProvider: {
    providerKey: "quickbooks_online",
    realmId: "synthetic-realm",
    sourceEnvironment: "sandbox"
  }
});
equal(verified.deliveryHash, expectedDeliveryHash, "verified ingress returns the Phase 6 replay hash");
equal(verified.events.length, 1, "authenticated CloudEvents are parsed after verification");
equal(verified.events[0].signatureVerification, "verified_hmac_sha256", "parsed hint carries verified state");
equal(verified.events[0].hintOnly, true, "authenticated webhook remains a hint rather than numerical truth");

const malformedBody = Buffer.from("{not-json", "utf8");
throws(
  () => qbo.verifyAndParseQboCloudEventsWebhook({
    rawBody: malformedBody,
    intuitSignature: expectedSignature,
    verifierSecret
  }),
  /signature_denied/,
  "invalid signatures are rejected before malformed JSON is considered"
);
const malformedSignature = require("node:crypto")
  .createHmac("sha256", verifierSecret)
  .update(malformedBody)
  .digest("base64");
throws(
  () => qbo.verifyAndParseQboCloudEventsWebhook({
    rawBody: malformedBody,
    intuitSignature: malformedSignature,
    verifierSecret
  }),
  /raw_body_invalid/,
  "authenticated malformed JSON fails at the parsing boundary"
);

const signatureEntry = qbo.QBO_DOCUMENTATION_REGISTER.find(
  (entry) => entry.claimKey === "qbo_webhook_signature_hmac_sha256"
);
equal(signatureEntry.status, "confirmed_provider_behavior", "signature mechanism is no longer deferred");
equal(
  signatureEntry.sourceUrl,
  "https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/configure-webhooks",
  "signature contract cites current official Intuit documentation"
);
ok(
  qbo.QBO_PHASE_8A_WEBHOOK_DOCUMENTATION_LINKS.includes(
    "https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/best-practices"
  ),
  "official acknowledgement and retry guidance is registered"
);

const service = read("scripts/fixtures/external-integrations-phase-8a-live-gcp-service/server.js");
const iamProbe = read("scripts/fixtures/external-integrations-phase-8a-live-gcp-service/iam-probe.js");
const adapterHarness = read("scripts/external-integrations-phase-8a-live-gcp-adapter-verification.js");
deepEqual(
  require("../scripts/fixtures/external-integrations-phase-8a-live-gcp-service/package.json").dependencies,
  undefined,
  "disposable Cloud Run fixture has no third-party runtime dependencies"
);
ok(service.includes('keys[0] !== "protocolVersion"'), "live service enforces the minimal task envelope");
ok(service.includes('keys[1] !== "taskId"'), "live service accepts no task payload beyond opaque identity");
ok(service.includes('correctnessAuthority: "phase6_supabase_runtime_ledger"'), "transport fixture does not claim idempotency authority");
ok(service.includes("EXPECTED_QUEUE_NAME"), "live service binds delivery metadata to one exact queue");
ok(service.includes("expectedTaskName"), "live service binds the opaque task ID to its deterministic task name");
ok(!service.includes("cloudkms.googleapis.com"), "task handler has no KMS client path");
ok(!service.includes("secretmanager.googleapis.com"), "task handler has no Secret Manager client path");
ok(iamProbe.includes('EXPECTED_RESULT = required("EXPECTED_RESULT")'), "no-ingress IAM probe is expectation-bound");
ok(iamProbe.includes("metadata.google.internal"), "IAM probe uses its assigned Google-managed workload identity");
ok(!/createServer|\.listen\(/.test(iamProbe), "IAM probe exposes no request or decrypt-oracle surface");
ok(!/access.?token.?canary|refresh.?token.?canary|client.?secret.?canary/i.test(service), "service contains no credential canary material");
ok(adapterHarness.includes("GoogleCloudKmsCredentialAdapter"), "live harness exercises the merged KMS adapter");
ok(adapterHarness.includes("GoogleSecretManagerProviderSecrets"), "live harness exercises the merged Secret Manager adapter");
ok(adapterHarness.includes("readProviderAccessCredential"), "live harness exercises the merged provider-read boundary");
ok(adapterHarness.includes("vaeroex-phase8a-disposable-nonproduction-only"), "live harness requires explicit non-Production confirmation");
ok(adapterHarness.includes("vaeroex-document-worker"), "live harness explicitly rejects the existing document project");
ok(adapterHarness.includes("phase8a-synthetic-provider/versions/"), "live harness pins the exact disposable secret and numeric version");

const iamBoundary = require("../lib/integrations/credentials/iam.ts")
  .createPhase5CredentialIamBoundary({
    kmsKeyResource: "projects/phase8a-test/locations/us-west1/keyRings/test/cryptoKeys/test",
    providerSecretVersionResource: "projects/phase8a-test/secrets/test/versions/1"
  });
const brokerIam = iamBoundary.find((identity) => identity.identity === "connector_broker");
ok(
  brokerIam.databaseRpcs.includes("read_integration_provider_credential_v4"),
  "credential IAM architecture includes the converged provider-read RPC"
);

equal(credentials.PHASE_5_MODEL_CALL_COUNT, 0, "credential model-call count remains zero");
equal(credentials.PHASE_5_PROMOTION_AUTHORIZED, false, "credential promotion remains unauthorized");
equal(runtime.PHASE_6_MODEL_CALL_COUNT, 0, "runtime model-call count remains zero");
equal(runtime.PHASE_6_PROMOTION_AUTHORIZED, false, "runtime promotion remains unauthorized");
equal(qbo.QBO_MODEL_CALL_COUNT, 0, "QBO model-call count remains zero");

console.log(
  `External integration Phase 8A live-GCP readiness regressions: ${assertionCount} assertions passed; model calls 0; promotionAuthorized false.`
);
