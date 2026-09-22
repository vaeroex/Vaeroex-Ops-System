import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const PROJECT_ID = "vaeroex-integrations-prod";
const PRINCIPAL = "sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com";
const PROFILES = Object.freeze(["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"]);
const SECRET_PERMISSION = "secretmanager.versions.add";
const VERSION_PERMISSIONS = Object.freeze([
  "secretmanager.versions.access",
  "secretmanager.versions.get",
  "secretmanager.versions.disable",
]);
const MAX_INPUT_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 120_000;
const READ_ATTEMPTS = 2;
const GCLOUD_DIAGNOSTIC_ENVIRONMENT = /^(?:CLOUDSDK_CORE_LOG_HTTP|CLOUDSDK_LOG_HTTP|CLOUDSDK_CORE_VERBOSITY|CLOUDSDK_CORE_TRACE_TOKEN|CLOUDSDK_CORE_LOG_FILE)$/;

function reject(label) {
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

function secretTuple(projectNumber, profile) {
  const secretId = `square-production-${profile}-db`;
  const secretName = `projects/${projectNumber}/secrets/${secretId}`;
  return {
    profile,
    permission: SECRET_PERMISSION,
    fullResourceName: `//secretmanager.googleapis.com/${secretName}`,
    resourceName: secretName,
    resourceService: "secretmanager.googleapis.com",
    resourceType: "secretmanager.googleapis.com/Secret",
  };
}

function versionTuple(projectNumber, profile, version, permission) {
  const resourceName = `projects/${projectNumber}/secrets/square-production-${profile}-db/versions/${version}`;
  return {
    profile,
    permission,
    fullResourceName: `//secretmanager.googleapis.com/${resourceName}`,
    resourceName,
    resourceService: "secretmanager.googleapis.com",
    resourceType: "secretmanager.googleapis.com/SecretVersion",
  };
}

function runBounded(run, args, environment, failureLabel) {
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
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
      result = null;
    }
    if (!result?.error && result?.status === 0 && typeof result?.stdout === "string" &&
        Buffer.byteLength(result.stdout) <= MAX_RESPONSE_BYTES) return result.stdout;
  }
  reject(failureLabel);
}

function enumerateVersions(run, environment, projectNumber, profile) {
  const secretId = `square-production-${profile}-db`;
  const stdout = runBounded(run, [
    "secrets", "versions", "list", secretId,
    `--project=${PROJECT_ID}`,
    "--format=json(name)",
    "--quiet",
    "--verbosity=error",
  ], environment, "policy_troubleshooter_version_enumeration_failed");
  let response;
  try {
    response = JSON.parse(stdout);
  } catch {
    reject("policy_troubleshooter_version_enumeration_failed");
  }
  if (!Array.isArray(response)) reject("policy_troubleshooter_version_enumeration_failed");
  const versions = new Set();
  for (const entry of response) {
    const match = typeof entry?.name === "string" &&
      new RegExp(`^projects/(?:${PROJECT_ID}|${projectNumber})/secrets/${secretId}/versions/([1-9][0-9]{0,20})$`).exec(entry.name);
    if (!match || versions.has(match[1])) reject("policy_troubleshooter_version_enumeration_failed");
    versions.add(match[1]);
  }
  return [...versions].sort((left, right) => {
    const a = BigInt(left), b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function hasUnknownOrUnspecifiedState(value) {
  if (Array.isArray(value)) return value.some(hasUnknownOrUnspecifiedState);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    if (typeof child === "string" && /(?:UNKNOWN|UNSPECIFIED)/.test(child) &&
        /(?:state|membership|permission|relevance)$/i.test(key)) return true;
    if (key === "errors" && Array.isArray(child) && child.length > 0) return true;
    return hasUnknownOrUnspecifiedState(child);
  });
}

function hasOutcomeRelevantConditionAmbiguity(value) {
  if (Array.isArray(value)) return value.some(hasOutcomeRelevantConditionAmbiguity);
  if (!value || typeof value !== "object") return false;
  if (value.condition && value.relevance === "HEURISTIC_RELEVANCE_HIGH") {
    if (typeof value.conditionExplanation?.value !== "boolean" ||
        (Array.isArray(value.conditionExplanation?.errors) && value.conditionExplanation.errors.length > 0)) return true;
  }
  return Object.values(value).some(hasOutcomeRelevantConditionAmbiguity);
}

function verifyConditionContext(context, tuple, requestTime) {
  const echoedTime = context?.request?.receiveTime ?? context?.request?.time;
  return echoedTime === requestTime &&
    context?.resource?.name === tuple.resourceName &&
    context?.resource?.service === tuple.resourceService &&
    context?.resource?.type === tuple.resourceType;
}

function verifyResponse(response, tuple, expectedState, requestTime) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    reject("policy_troubleshooter_response_invalid");
  }
  if (
    response.accessTuple?.principal !== PRINCIPAL ||
    response.accessTuple?.fullResourceName !== tuple.fullResourceName ||
    response.accessTuple?.permission !== tuple.permission ||
    response.accessTuple?.permissionFqdn !== `secretmanager.googleapis.com/${tuple.permission.slice("secretmanager.".length)}` ||
    !verifyConditionContext(response.accessTuple?.conditionContext, tuple, requestTime)
  ) {
    reject("policy_troubleshooter_tuple_mismatch");
  }
  if (["UNKNOWN_INFO", "UNKNOWN_CONDITIONAL"].includes(response.overallAccessState)) {
    reject("policy_troubleshooter_analysis_incomplete");
  }
  if (!["CAN_ACCESS", "CANNOT_ACCESS"].includes(response.overallAccessState)) {
    reject("policy_troubleshooter_response_invalid");
  }
  if (response.overallAccessState !== expectedState) {
    reject("policy_troubleshooter_access_mismatch");
  }
  if (expectedState === "CAN_ACCESS" && (
    typeof response.allowPolicyExplanation !== "object" || response.allowPolicyExplanation === null ||
    typeof response.denyPolicyExplanation !== "object" || response.denyPolicyExplanation === null ||
    typeof response.pabPolicyExplanation !== "object" || response.pabPolicyExplanation === null ||
    hasUnknownOrUnspecifiedState(response) ||
    hasOutcomeRelevantConditionAmbiguity(response)
  )) {
    reject("policy_troubleshooter_analysis_incomplete");
  }
}

function parseQuery(query, now) {
  const start = exactTimestamp(query?.window_starts_at);
  const expiry = exactTimestamp(query?.window_expires_at);
  const projectNumber = query?.project_number;
  const phase = query?.phase;
  const activeProfile = query?.active_profile ?? "";
  if (
    query?.project_id !== PROJECT_ID ||
    typeof projectNumber !== "string" || !/^[1-9][0-9]{5,19}$/.test(projectNumber) ||
    !["closed", "open"].includes(phase) ||
    start === null || expiry === null || expiry <= start ||
    (phase === "closed" && activeProfile !== "") ||
    (phase === "open" && !PROFILES.includes(activeProfile))
  ) {
    reject("policy_troubleshooter_input_invalid");
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs) || nowMs < start || (phase === "open" && nowMs >= expiry)) {
    reject("policy_troubleshooter_window_inactive");
  }
  const requestTime = new Date(Math.floor(nowMs / 1000) * 1000).toISOString().replace(".000Z", "Z");
  if (exactTimestamp(requestTime) === null) reject("policy_troubleshooter_clock_invalid");
  return { projectNumber, phase, activeProfile, requestTime };
}

export function verifyEffectivePrivateAccess(query, options = {}) {
  const run = options.run ?? defaultRun;
  const now = options.now ?? new Date();
  const environment = sanitizedGcloudEnvironment(options.environment ?? process.env);
  const { projectNumber, phase, activeProfile, requestTime } = parseQuery(query, now);
  const seen = new Set();
  let checkedVersions = 0;

  for (const profile of PROFILES) {
    const versions = enumerateVersions(run, environment, projectNumber, profile);
    checkedVersions += versions.length;
    const tuples = [
      secretTuple(projectNumber, profile),
      ...versions.flatMap(version => VERSION_PERMISSIONS.map(permission =>
        versionTuple(projectNumber, profile, version, permission))),
    ];
    for (const tuple of tuples) {
      const { permission } = tuple;
      const key = `${tuple.fullResourceName}\u0000${permission}`;
      if (seen.has(key)) reject("policy_troubleshooter_matrix_invalid");
      seen.add(key);
      const expectedState = phase === "open" && profile === activeProfile ? "CAN_ACCESS" : "CANNOT_ACCESS";
      const args = [
        "beta", "policy-intelligence", "troubleshoot-policy", "iam", tuple.fullResourceName,
        `--principal-email=${PRINCIPAL}`,
        `--permission=${permission}`,
        `--request-time=${requestTime}`,
        `--resource-name=${tuple.resourceName}`,
        `--resource-service=${tuple.resourceService}`,
        `--resource-type=${tuple.resourceType}`,
        `--project=${PROJECT_ID}`,
        "--format=json",
        "--quiet",
        "--verbosity=error",
      ];
      const stdout = runBounded(run, args, environment, "policy_troubleshooter_process_failed");
      let response;
      try {
        response = JSON.parse(stdout);
      } catch {
        reject("policy_troubleshooter_response_invalid");
      }
      verifyResponse(response, tuple, expectedState, requestTime);
    }
  }
  if (seen.size !== PROFILES.length + checkedVersions * VERSION_PERMISSIONS.length) {
    reject("policy_troubleshooter_matrix_invalid");
  }

  return {
    status: phase === "closed"
      ? "policy_troubleshooter_closed_all_denied"
      : `policy_troubleshooter_${activeProfile}_only_confirmed`,
    checked_secrets: String(PROFILES.length),
    checked_versions: String(checkedVersions),
    checked_tuples: String(seen.size),
  };
}

async function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > MAX_INPUT_BYTES) reject("policy_troubleshooter_input_invalid");
  }
  let query;
  try {
    query = JSON.parse(input);
  } catch {
    reject("policy_troubleshooter_input_invalid");
  }
  process.stdout.write(`${JSON.stringify(verifyEffectivePrivateAccess(query))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error?.fixedLabel || "policy_troubleshooter_process_failed"}\n`);
    process.exitCode = 1;
  });
}
