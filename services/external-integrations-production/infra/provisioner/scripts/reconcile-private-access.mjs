import { spawnSync } from "node:child_process";

const PROJECT_ID = "vaeroex-integrations-prod";
const PROVISIONER_MEMBER = "serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com";
const PRIVATE_VERSIONS_ROLE = "projects/vaeroex-integrations-prod/roles/squareProductionPrivateVersions";
const CONDITION_TITLE = "bounded-native-provisioning";
const CONDITION_DESCRIPTION = "One exact database secret during the admitted maintenance window.";
const PROFILES = Object.freeze(["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"]);
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 20_000;
const GCLOUD_DIAGNOSTIC_ENVIRONMENT = /^(?:CLOUDSDK_CORE_LOG_HTTP|CLOUDSDK_LOG_HTTP|CLOUDSDK_CORE_VERBOSITY|CLOUDSDK_CORE_TRACE_TOKEN|CLOUDSDK_CORE_LOG_FILE)$/;

function reject(label = "private_access_exact_reconciliation_failed") {
  const error = new Error(label);
  error.fixedLabel = label;
  throw error;
}

function exactTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value.replace("Z", ".000Z")) return null;
  return milliseconds;
}

function sanitizedGcloudEnvironment(environment) {
  const sanitized = { ...environment };
  for (const name of Object.keys(sanitized)) {
    if (GCLOUD_DIAGNOSTIC_ENVIRONMENT.test(name)) delete sanitized[name];
  }
  return sanitized;
}

function defaultRun(command, args, options) {
  return spawnSync(command, args, options);
}

function runBounded(run, args, environment) {
  let result;
  try {
    result = run("gcloud", args, {
      env: environment,
      encoding: "utf8",
      input: undefined,
      maxBuffer: MAX_RESPONSE_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: QUERY_TIMEOUT_MS,
    });
  } catch {
    reject();
  }
  if (result?.error || result?.status !== 0 || typeof result?.stdout !== "string" ||
      Buffer.byteLength(result.stdout) > MAX_RESPONSE_BYTES) reject();
  return result.stdout;
}

function policyBindings(stdout) {
  let policy;
  try {
    policy = JSON.parse(stdout);
  } catch {
    reject();
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy) ||
      (policy.bindings !== undefined && !Array.isArray(policy.bindings))) reject();
  const bindings = policy.bindings ?? [];
  for (const binding of bindings) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding) ||
        typeof binding.role !== "string" || !Array.isArray(binding.members) ||
        binding.members.some(member => typeof member !== "string") ||
        (binding.condition !== undefined && (
          !binding.condition || typeof binding.condition !== "object" || Array.isArray(binding.condition) ||
          typeof binding.condition.title !== "string" || typeof binding.condition.expression !== "string" ||
          (binding.condition.description !== undefined && typeof binding.condition.description !== "string")
        ))) reject();
  }
  return bindings;
}

function readPolicy(run, environment, secretId) {
  return policyBindings(runBounded(run, [
    "secrets", "get-iam-policy", secretId,
    `--project=${PROJECT_ID}`,
    "--format=json",
    "--quiet",
    "--verbosity=error",
  ], environment));
}

function checkedRecoveryTuple(recovery) {
  const start = exactTimestamp(recovery?.windowStartsAt);
  const expiry = exactTimestamp(recovery?.windowExpiresAt);
  if (!PROFILES.includes(recovery?.profile) || start === null || expiry === null ||
      expiry <= start || expiry > start + 60 * 60 * 1000) reject();
  return Object.freeze({
    profile: recovery.profile,
    condition: Object.freeze({
      title: CONDITION_TITLE,
      description: CONDITION_DESCRIPTION,
      expression: `request.time >= timestamp('${recovery.windowStartsAt}') && request.time < timestamp('${recovery.windowExpiresAt}')`,
    }),
  });
}

function readAllPolicies(run, environment) {
  return new Map(PROFILES.map(profile => [
    profile,
    readPolicy(run, environment, `square-production-${profile}-db`),
  ]));
}

function provisionerBindings(policies) {
  return [...policies].flatMap(([profile, bindings]) => bindings
    .filter(binding => binding.members.includes(PROVISIONER_MEMBER))
    .map(binding => ({ profile, binding })));
}

function verifyInitialPolicies(policies, recovery) {
  const matches = provisionerBindings(policies);
  if (matches.length > 1) reject();
  if (matches.length === 1) {
    const [{ profile, binding }] = matches;
    if (profile !== recovery.profile || binding.role !== PRIVATE_VERSIONS_ROLE ||
        binding.condition?.title !== recovery.condition.title ||
        binding.condition?.description !== recovery.condition.description ||
        binding.condition?.expression !== recovery.condition.expression) reject();
  }
  return matches.length;
}

function verifyFinalPolicies(policies) {
  if (provisionerBindings(policies).length !== 0) reject();
}

function removeCondition(run, environment, secretId, condition) {
  return runBounded(run, [
    "secrets", "remove-iam-policy-binding", secretId,
    `--project=${PROJECT_ID}`,
    `--member=${PROVISIONER_MEMBER}`,
    `--role=${PRIVATE_VERSIONS_ROLE}`,
    `--condition=expression=${condition.expression},title=${condition.title},description=${condition.description}`,
    "--format=none",
    "--quiet",
    "--verbosity=error",
  ], environment);
}

export function reconcileExactPrivateAccess(recoveryInput, options = {}) {
  const recovery = checkedRecoveryTuple(recoveryInput);
  const run = options.run ?? defaultRun;
  const environment = sanitizedGcloudEnvironment(options.environment ?? process.env);
  const initial = readAllPolicies(run, environment);
  const matched = verifyInitialPolicies(initial, recovery);
  if (matched === 1) {
    try {
      removeCondition(run, environment, `square-production-${recovery.profile}-db`, recovery.condition);
    } catch {
      // A lost or failed mutation acknowledgment is resolved exclusively by
      // the mandatory exact six-policy readback below.
    }
  }
  const final = readAllPolicies(run, environment);
  verifyFinalPolicies(final);

  return Object.freeze({
    status: "private_access_exact_direct_binding_reconciliation_confirmed",
    checked_secrets: String(PROFILES.length),
    removed_bindings: String(matched),
  });
}
