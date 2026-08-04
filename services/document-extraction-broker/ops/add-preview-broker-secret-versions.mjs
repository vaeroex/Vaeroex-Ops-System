#!/usr/bin/env node

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("broker_secret_provisioning_configuration_invalid");
  return value;
};

const project = required("GCP_PROJECT_ID");
const region = required("GCP_REGION");
const service = required("BROKER_SERVICE");
const workerId = required("WORKER_ID");
const workerKeyVersion = required("WORKER_KEY_VERSION");
const workerDeploymentId = required("WORKER_DEPLOYMENT_ID");
const confirmation = required("PHASE_C1_PREVIEW_CONFIRMATION");
const gcloud = process.env.GCLOUD_BIN?.trim() || "gcloud";
const workerSecret = process.env.WORKER_SECRET_NAME?.trim()
  || "vaeroex-document-worker-preview-ed25519";

if (
  project !== "vaeroex-document-worker"
  || region !== "us-west1"
  || confirmation !== "vaeroex-document-extraction-phase-c1-preview-only"
  || !/^vaeroex-doc-broker-pr265-[0-9a-f]{7,12}$/.test(service)
  || !/^[A-Za-z0-9._:-]{1,128}$/.test(workerId)
  || !/^[A-Za-z0-9._:-]{1,120}$/.test(workerKeyVersion)
  || !/^[A-Za-z0-9._:-]{1,128}$/.test(workerDeploymentId)
) {
  throw new Error("broker_secret_provisioning_scope_invalid");
}

const chunks = [];
let total = 0;
for await (const chunk of process.stdin) {
  total += chunk.byteLength;
  if (total > 4_096) throw new Error("preview_supabase_service_role_invalid");
  chunks.push(chunk);
}
const previewSupabaseServiceRole = Buffer.concat(chunks).toString("utf8").trim();
if (!previewSupabaseServiceRole || previewSupabaseServiceRole.length > 4_096) {
  throw new Error("preview_supabase_service_role_invalid");
}

const validatePreviewSupabaseServiceRole = async (value) => {
  if (value.startsWith("sb_secret_")) {
    if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error("preview_supabase_service_role_scope_invalid");
    }
    try {
      const response = await fetch(
        "https://zfpnhvcmuuvtswttmnjd.supabase.co/rest/v1/",
        {
          headers: {
            accept: "application/openapi+json",
            apikey: value,
            "user-agent": "vaeroex-preview-secret-provisioner/1.0"
          },
          redirect: "error",
          signal: AbortSignal.timeout(10_000)
        }
      );
      await response.body?.cancel();
      if (!response.ok) throw new Error();
      return;
    } catch {
      throw new Error("preview_supabase_service_role_scope_invalid");
    }
  }

  try {
    const [header, payload, signature, extra] = value.split(".");
    if (!header || !payload || !signature || extra) throw new Error();
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims.ref !== "zfpnhvcmuuvtswttmnjd" || claims.role !== "service_role") throw new Error();
  } catch {
    throw new Error("preview_supabase_service_role_scope_invalid");
  }
};

await validatePreviewSupabaseServiceRole(previewSupabaseServiceRole);

const run = (args, input) => {
  const result = spawnSync(gcloud, args, {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1_024,
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.status !== 0) throw new Error("broker_secret_provisioning_command_failed");
  return result.stdout.trim();
};

const addVersion = (secret, value) => {
  const name = run([
    "secrets", "versions", "add", secret,
    "--project", project,
    "--data-file=-",
    "--format=value(name)",
    "--quiet"
  ], value);
  const version = name.split("/").at(-1);
  if (!version || !/^\d+$/.test(version)) {
    throw new Error("broker_secret_version_invalid");
  }
  return version;
};

const destroyVersion = (secret, version) => {
  spawnSync(gcloud, [
    "secrets", "versions", "destroy", version,
    "--secret", secret,
    "--project", project,
    "--quiet"
  ], { stdio: "ignore" });
};

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const workerPrivateKey = Buffer.from(
  privateKey.export({ type: "pkcs8", format: "der" })
).toString("base64");
const workerPublicKey = Buffer.from(
  publicKey.export({ type: "spki", format: "der" })
).toString("base64");
const capabilityValue = randomBytes(32).toString("base64");
const telemetryValue = randomBytes(32).toString("base64");
const encryptionValue = randomBytes(32).toString("base64");
const values = {
  [`${service}-supabase-service-role`]: previewSupabaseServiceRole,
  [`${service}-worker-public-keys`]: JSON.stringify({
    [workerId]: {
      keyVersion: workerKeyVersion,
      publicKeySpkiBase64: workerPublicKey,
      environment: "preview",
      deploymentId: workerDeploymentId
    }
  }),
  [`${service}-capability-keys`]: JSON.stringify({
    "broker-capability-pr265-v1": capabilityValue
  }),
  [`${service}-telemetry-hmac`]: telemetryValue,
  [`${service}-encryption-keys`]: JSON.stringify({
    "cache-encryption-pr265-v1": encryptionValue
  }),
  [workerSecret]: workerPrivateKey
};
const created = [];

try {
  const versions = {};
  for (const [secret, value] of Object.entries(values)) {
    const version = addVersion(secret, value);
    created.push({ secret, version });
    versions[secret === workerSecret ? "worker-private-key" : secret.slice(service.length + 1)] = version;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, versions })}\n`);
} catch (error) {
  for (const { secret, version } of created.reverse()) destroyVersion(secret, version);
  throw error;
}
