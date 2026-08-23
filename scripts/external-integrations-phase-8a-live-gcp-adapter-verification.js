const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

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

const canonical = require("../lib/integrations/contracts/canonical.ts");
const credentialContracts = require("../lib/integrations/credentials/contracts.ts");
const credentialKms = require("../lib/integrations/credentials/kms.ts");
const credentialBroker = require("../lib/integrations/credentials/broker.ts");
const secretManager = require("../lib/integrations/credentials/secret-manager.ts");

const CONFIRMATION = "vaeroex-phase8a-disposable-nonproduction-only";
const projectId = required("GCP_PROJECT_ID");
const region = required("GCP_REGION");
const accessToken = required("GOOGLE_OAUTH_ACCESS_TOKEN");
const kmsKeyResource = required("KMS_KEY_RESOURCE");
const unauthorizedKmsKeyResource = required("UNAUTHORIZED_KMS_KEY_RESOURCE");
const secretVersionResource = required("SECRET_VERSION_RESOURCE");
const accessTokenCanary = required("LIVE_ACCESS_TOKEN_CANARY");
const refreshTokenCanary = required("LIVE_REFRESH_TOKEN_CANARY");
let verificationStage = "configuration";

if (required("VAEROEX_PHASE8A_CONFIRMATION") !== CONFIRMATION) {
  throw new Error("phase8a_confirmation_invalid");
}
if (!/^vaeroex-intg-dev-[0-9]{4,8}$/.test(projectId) || projectId === "vaeroex-document-worker") {
  throw new Error("phase8a_project_isolation_invalid");
}
if (region !== "us-west1") throw new Error("phase8a_region_invalid");
if (!kmsKeyResource.startsWith(`projects/${projectId}/locations/${region}/`)) {
  throw new Error("phase8a_kms_scope_invalid");
}
if (!/^projects\/[^/]+\/secrets\/[^/]+\/versions\/[1-9][0-9]*$/.test(secretVersionResource)) {
  throw new Error("phase8a_secret_version_invalid");
}
if (!secretVersionResource.startsWith(
  `projects/${projectId}/secrets/phase8a-synthetic-provider/versions/`
)) {
  throw new Error("phase8a_secret_scope_invalid");
}
const historicalSecretVersionResource = process.env.HISTORICAL_SECRET_VERSION_RESOURCE;
if (
  historicalSecretVersionResource &&
  !/^projects\/[^/]+\/secrets\/[^/]+\/versions\/[1-9][0-9]*$/.test(
    historicalSecretVersionResource
  )
) {
  throw new Error("phase8a_historical_secret_version_invalid");
}
if (
  historicalSecretVersionResource &&
  !historicalSecretVersionResource.startsWith(
    `projects/${projectId}/secrets/phase8a-synthetic-provider/versions/`
  )
) {
  throw new Error("phase8a_historical_secret_scope_invalid");
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_environment:${name}`);
  return value;
}

function id(value) {
  const hex = BigInt(value).toString(16).padStart(32, "0").slice(-32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

async function googleJson(url, init = {}) {
  const result = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });
  if (!result.ok) throw new Error(`google_api_request_failed:${result.status}`);
  return result.json();
}

function kmsTransport() {
  return {
    async encrypt(request) {
      return googleJson(
        `https://cloudkms.googleapis.com/v1/${request.name}:encrypt`,
        { method: "POST", body: JSON.stringify(request) }
      );
    },
    async decrypt(request) {
      return googleJson(
        `https://cloudkms.googleapis.com/v1/${request.name}:decrypt`,
        { method: "POST", body: JSON.stringify(request) }
      );
    }
  };
}

function secretTransport() {
  return {
    async accessSecretVersion(request) {
      return googleJson(
        `https://secretmanager.googleapis.com/v1/${request.name}:access`,
        { method: "GET" }
      );
    }
  };
}

function unavailable() {
  throw new Error("unexpected_credential_mutation");
}

async function main() {
  verificationStage = "kms_primary";
  const aadContext = credentialContracts.CredentialAadContextSchema.parse({
    schemaVersion: credentialContracts.CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAad,
    purpose: "provider_oauth_credential",
    environment: "test",
    workspaceId: id(801),
    connectionId: id(802),
    connectionGeneration: 1,
    providerKey: "synthetic",
    credentialId: id(803)
  });
  const envelope = credentialContracts.CredentialEnvelopeSchema.parse({
    schemaVersion: credentialContracts.CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope,
    providerKey: "synthetic",
    environment: "test",
    externalAuthorizedEntityReference: "phase8a-synthetic-entity",
    accessToken: accessTokenCanary,
    accessExpiresAt: "2026-08-23T00:00:00.000Z",
    refreshToken: refreshTokenCanary,
    refreshExpiresAt: "2026-09-22T00:00:00.000Z",
    grantedScopes: ["read_synthetic_business_data"],
    issuedAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z"
  });
  const adapter = new credentialKms.GoogleCloudKmsCredentialAdapter({
    transport: kmsTransport(),
    allowedKeyResource: kmsKeyResource
  });
  const aad = credentialKms.credentialAad(aadContext);
  const plaintext = Buffer.from(canonical.canonicalContractJson(envelope), "utf8");
  const ciphertext = await adapter.encrypt({
    keyResource: kmsKeyResource,
    plaintext,
    additionalAuthenticatedData: aad
  });
  const decrypted = await adapter.decrypt({
    keyResource: kmsKeyResource,
    ciphertext,
    additionalAuthenticatedData: aad
  });
  assert.deepEqual(decrypted, plaintext);
  decrypted.fill(0);

  let historicalCiphertextResult = null;
  if (process.env.HISTORICAL_CIPHERTEXT && process.env.HISTORICAL_AAD) {
    verificationStage = "kms_historical";
    const historicalCiphertext = Buffer.from(process.env.HISTORICAL_CIPHERTEXT, "base64");
    const historicalAad = Buffer.from(process.env.HISTORICAL_AAD, "base64");
    if (process.env.HISTORICAL_DECRYPT_EXPECTED === "allowed") {
      const historicalPlaintext = await adapter.decrypt({
        keyResource: kmsKeyResource,
        ciphertext: historicalCiphertext,
        additionalAuthenticatedData: historicalAad
      });
      historicalPlaintext.fill(0);
      historicalCiphertextResult = "allowed";
    } else if (process.env.HISTORICAL_DECRYPT_EXPECTED === "denied") {
      await assert.rejects(
        () => adapter.decrypt({
          keyResource: kmsKeyResource,
          ciphertext: historicalCiphertext,
          additionalAuthenticatedData: historicalAad
        }),
        /credential_kms_decrypt_failed/
      );
      historicalCiphertextResult = "denied";
    } else {
      throw new Error("historical_decrypt_expectation_invalid");
    }
    historicalCiphertext.fill(0);
    historicalAad.fill(0);
  }

  verificationStage = "kms_aad";
  for (const changed of [
    { ...aadContext, workspaceId: id(811) },
    { ...aadContext, connectionId: id(812) },
    { ...aadContext, connectionGeneration: 2 },
    { ...aadContext, environment: "sandbox" }
  ]) {
    await assert.rejects(
      () => adapter.decrypt({
        keyResource: kmsKeyResource,
        ciphertext,
        additionalAuthenticatedData: credentialKms.credentialAad(changed)
      }),
      /credential_kms_decrypt_failed/
    );
  }
  await assert.rejects(
    () => adapter.decrypt({
      keyResource: unauthorizedKmsKeyResource,
      ciphertext,
      additionalAuthenticatedData: aad
    }),
    /credential_kms_key_not_allowed/
  );
  verificationStage = "kms_wrong_key";
  const unauthorizedKeyAdapter = new credentialKms.GoogleCloudKmsCredentialAdapter({
    transport: kmsTransport(),
    allowedKeyResource: unauthorizedKmsKeyResource
  });
  await assert.rejects(
    () => unauthorizedKeyAdapter.decrypt({
      keyResource: unauthorizedKmsKeyResource,
      ciphertext,
      additionalAuthenticatedData: aad
    }),
    /credential_kms_decrypt_failed/
  );

  verificationStage = "secret_manager";
  const providerSecrets = new secretManager.GoogleSecretManagerProviderSecrets({
    resources: { "synthetic:test": secretVersionResource },
    transport: secretTransport()
  });
  const applicationSecret = await providerSecrets.access("synthetic", "test");
  assert.equal(applicationSecret.providerKey, "synthetic");
  assert.equal(applicationSecret.environment, "test");
  assert.equal(JSON.stringify(applicationSecret).includes("clientSecret"), false);
  assert.equal(
    applicationSecret.use((value) => typeof value.clientSecret === "string" && value.clientSecret.length >= 16),
    true
  );
  assert.throws(
    () => new secretManager.GoogleSecretManagerProviderSecrets({
      resources: {
        "synthetic:test": `projects/${projectId}/secrets/phase8a-synthetic-provider/versions/latest`
      },
      transport: secretTransport()
    }),
    /Invalid string|invalid_string|invalid_format/
  );
  let historicalSecretResult = null;
  if (historicalSecretVersionResource) {
    const historicalSecrets = new secretManager.GoogleSecretManagerProviderSecrets({
      resources: { "synthetic:test": historicalSecretVersionResource },
      transport: secretTransport()
    });
    if (process.env.HISTORICAL_SECRET_ACCESS_EXPECTED === "allowed") {
      await historicalSecrets.access("synthetic", "test");
      historicalSecretResult = "allowed";
    } else if (process.env.HISTORICAL_SECRET_ACCESS_EXPECTED === "denied") {
      await assert.rejects(
        () => historicalSecrets.access("synthetic", "test"),
        /provider_application_secret_access_failed/
      );
      historicalSecretResult = "denied";
    } else {
      throw new Error("historical_secret_expectation_invalid");
    }
  }

  verificationStage = "provider_read";
  let providerReadCount = 0;
  const readResult = {
    state: "available",
    credentialId: aadContext.credentialId,
    credentialVersion: 1,
    providerKey: "synthetic",
    providerEnvironment: "test",
    accessExpiresAt: envelope.accessExpiresAt,
    ciphertextBase64: Buffer.from(ciphertext).toString("base64"),
    aadDigest: credentialKms.credentialAadDigest(aadContext),
    kmsKeyResource,
    aadContext,
    grantedScopes: ["read_synthetic_business_data"]
  };
  const store = {
    createOAuthState: unavailable,
    consumeOAuthState: unavailable,
    storeCredential: unavailable,
    async readProviderCredential() {
      providerReadCount += 1;
      return readResult;
    },
    acquireRefreshLease: unavailable,
    rotateCredential: unavailable,
    completeRefreshFailure: unavailable,
    revokeCredential: unavailable,
    completeCredentialRevocation: unavailable,
    destroyCredential: unavailable,
    recordAuthorizationEvent: unavailable
  };
  const broker = new credentialBroker.IntegrationCredentialBroker({
    store,
    kms: adapter,
    kmsKeyResource,
    secrets: { access: unavailable },
    provider: {
      providerKey: "synthetic",
      environment: "test",
      exchangeAuthorizationCode: unavailable,
      refreshCredential: unavailable,
      revokeCredential: unavailable
    },
    clock: () => new Date("2026-08-22T12:00:00.000Z")
  });
  const readCommand = {
    taskId: id(821),
    leaseId: id(822),
    leaseOwnerFingerprint: canonical.contractSha256({ owner: "phase8a-live" }),
    expectedCredentialVersion: 1,
    requiredScopes: ["read_synthetic_business_data"],
    minimumValiditySeconds: 300,
    requestId: "phase8a-live-provider-read"
  };
  const [firstRead, secondRead] = await Promise.all([
    broker.readProviderAccessCredential(readCommand),
    broker.readProviderAccessCredential({ ...readCommand, requestId: "phase8a-live-provider-read-2" })
  ]);
  assert.equal(providerReadCount, 2);
  assert.equal(firstRead.state, "available");
  assert.equal(secondRead.state, "available");
  assert.equal(
    await firstRead.credential.use((value) => value.accessToken === accessTokenCanary),
    true
  );
  assert.deepEqual(Object.keys(await secondRead.credential.use((value) => value)), ["accessToken"]);
  assert.equal(JSON.stringify([firstRead, secondRead]).includes(refreshTokenCanary), false);

  verificationStage = "serialization";
  const output = {
    assertions:
      20 +
      (historicalCiphertextResult === null ? 0 : 1) +
      (historicalSecretResult === null ? 0 : 1),
    kms: {
      encrypt: "passed",
      decrypt: "passed",
      wrongAadCasesDenied: 4,
      wrongKeyRejectedBeforeTransport: true,
      wrongLiveKeyDenied: true,
      historicalCiphertextResult,
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      additionalAuthenticatedData: Buffer.from(aad).toString("base64")
    },
    secretManager: {
      exactNumericVersion: secretVersionResource.split("/").at(-1),
      access: "passed",
      latestRejected: true,
      historicalSecretResult
    },
    providerRead: {
      concurrentReads: 2,
      refreshTokenCrossedBoundary: false
    }
  };
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes(accessTokenCanary), false);
  assert.equal(serialized.includes(refreshTokenCanary), false);
  process.stdout.write(`${serialized}\n`);
  plaintext.fill(0);
  ciphertext.fill(0);
  aad.fill(0);
}

main().catch((error) => {
  const code = error instanceof Error && /^[a-z0-9_:.-]+$/i.test(error.message)
    ? error.message
    : `phase8a_live_adapter_verification_failed:${verificationStage}`;
  process.stderr.write(`${code}\n`);
  process.exit(1);
});
