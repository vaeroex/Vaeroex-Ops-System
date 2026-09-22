import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const GENERATION_ADDRESS = "terraform_data.private_access_generation";
const GRANT_TYPE = "google_secret_manager_secret_iam_member";
const GRANT_NAME = "private_versions";
const PROJECT_ID = "vaeroex-integrations-prod";
const PROVISIONER_MEMBER = "serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com";
const PRIVATE_VERSIONS_ROLE = "projects/vaeroex-integrations-prod/roles/squareProductionPrivateVersions";
const CONDITION_TITLE = "bounded-native-provisioning";
const CONDITION_DESCRIPTION = "One exact database secret during the admitted maintenance window.";
const PROFILES = Object.freeze(["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"]);

function reject(label) {
  const error = new Error(label);
  error.fixedLabel = label;
  throw error;
}

function enabled(resource, side) {
  const value = resource?.change?.[side]?.input?.enabled;
  return value === true ? true : value === false ? false : null;
}

function exactTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value.replace("Z", ".000Z")) return null;
  return milliseconds;
}

function input(resource, side) {
  return resource?.change?.[side]?.input ?? null;
}

function isNoOp(resource) {
  const actions = resource?.change?.actions;
  return Array.isArray(actions) && actions.length === 1 && actions[0] === "no-op";
}

function verifyOpenGenerationInput(value) {
  const start = exactTimestamp(value?.starts_at);
  const expiry = exactTimestamp(value?.expires_at);
  const checkpointExpiry = exactTimestamp(value?.checkpoint_expires_at);
  if (
    value?.enabled !== true || !Array.isArray(value?.profiles) || value.profiles.length !== 1 ||
    !PROFILES.includes(value.profiles[0]) || start === null || expiry === null || checkpointExpiry === null ||
    expiry <= start || expiry > start + 60 * 60 * 1000 || checkpointExpiry !== expiry
  ) {
    reject("private_access_open_generation_invalid");
  }
}

function verifyPreservedCloseCheckpoint(beforeInput, afterInput) {
  verifyOpenGenerationInput(beforeInput);
  if (!Array.isArray(afterInput?.profiles) || afterInput.profiles.length !== 0 ||
      exactTimestamp(afterInput?.checkpoint_expires_at) !== exactTimestamp(beforeInput.expires_at)) {
    reject("private_access_close_must_preserve_expiry");
  }
}

export function privateAccessRecoveryTuple(plan) {
  if (!plan || !Array.isArray(plan.resource_changes)) {
    reject("private_access_plan_invalid");
  }
  const generations = plan.resource_changes.filter(change => change.address === GENERATION_ADDRESS);
  if (generations.length !== 1) {
    reject("private_access_generation_missing_or_ambiguous");
  }
  const generation = generations[0];
  const beforeInput = input(generation, "before");
  const afterInput = input(generation, "after");
  if (enabled(generation, "before") !== true || enabled(generation, "after") !== false ||
      !isDeepStrictEqual(generation.change?.actions, ["delete", "create"])) {
    reject("private_access_closed_recovery_transition_invalid");
  }
  verifyPreservedCloseCheckpoint(beforeInput, afterInput);
  return Object.freeze({
    profile: beforeInput.profiles[0],
    windowStartsAt: beforeInput.starts_at,
    windowExpiresAt: beforeInput.expires_at,
  });
}

export function privateAccessOpeningTuple(plan) {
  if (!plan || !Array.isArray(plan.resource_changes)) {
    reject("private_access_plan_invalid");
  }
  const generations = plan.resource_changes.filter(change => change.address === GENERATION_ADDRESS);
  if (generations.length !== 1) {
    reject("private_access_generation_missing_or_ambiguous");
  }
  const generation = generations[0];
  const afterInput = input(generation, "after");
  if (enabled(generation, "before") !== false || enabled(generation, "after") !== true ||
      !isDeepStrictEqual(generation.change?.actions, ["delete", "create"])) {
    reject("private_access_open_generation_invalid");
  }
  verifyOpenGenerationInput(afterInput);
  return Object.freeze({
    profile: afterInput.profiles[0],
    windowStartsAt: afterInput.starts_at,
    windowExpiresAt: afterInput.expires_at,
  });
}

function verifyGrantContract(grant, side, generationInput) {
  const value = grant?.change?.[side];
  const profile = grant?.index;
  const start = generationInput?.starts_at;
  const expiry = generationInput?.expires_at;
  const checkpointExpiry = generationInput?.checkpoint_expires_at;
  const condition = Array.isArray(value?.condition) && value.condition.length === 1 ? value.condition[0] : null;
  if (
    generationInput?.enabled !== true ||
    !Array.isArray(generationInput?.profiles) || generationInput.profiles.length !== 1 || generationInput.profiles[0] !== profile ||
    exactTimestamp(start) === null || exactTimestamp(expiry) === null || checkpointExpiry !== expiry ||
    value?.project !== PROJECT_ID || value?.secret_id !== `square-production-${profile}-db` ||
    value?.role !== PRIVATE_VERSIONS_ROLE || value?.member !== PROVISIONER_MEMBER ||
    condition?.title !== CONDITION_TITLE || condition?.description !== CONDITION_DESCRIPTION ||
    condition?.expression !== `request.time >= timestamp('${start}') && request.time < timestamp('${expiry}')`
  ) {
    reject("private_access_managed_grant_contract_mismatch");
  }
}

export function verifyPrivateAccessPlan(plan) {
  if (!plan || !Array.isArray(plan.resource_changes)) {
    reject("private_access_plan_invalid");
  }

  const generations = plan.resource_changes.filter(change => change.address === GENERATION_ADDRESS);
  if (generations.length !== 1) {
    reject("private_access_generation_missing_or_ambiguous");
  }

  const grants = plan.resource_changes.filter(change => change.type === GRANT_TYPE && change.name === GRANT_NAME);
  const beforeGrants = grants.filter(change => change.change?.before !== null && change.change?.before !== undefined);
  const afterGrants = grants.filter(change => change.change?.after !== null && change.change?.after !== undefined);
  const mutatingGrants = grants.filter(change => {
    const actions = change.change?.actions;
    return !Array.isArray(actions) || actions.length !== 1 || actions[0] !== "no-op";
  });

  if (beforeGrants.length > 1 || afterGrants.length > 1) {
    reject("private_access_plan_multiple_managed_grants");
  }

  const generation = generations[0];
  const beforeEnabled = enabled(generation, "before");
  const afterEnabled = enabled(generation, "after");
  const beforeInput = input(generation, "before");
  const afterInput = input(generation, "after");

  if (mutatingGrants.length === 0) {
    if (beforeGrants.length !== afterGrants.length) {
      reject("private_access_plan_state_inconsistent");
    }
    if (afterGrants.length === 0) {
      if (afterEnabled !== false || exactTimestamp(afterInput?.checkpoint_expires_at) === null) {
        reject("private_access_closed_plan_omits_managed_grant");
      }
      if (beforeEnabled === null) {
        const actions = generation.change?.actions;
        if (!Array.isArray(actions) || actions.length !== 1 || actions[0] !== "create") {
          reject("private_access_closed_bootstrap_invalid");
        }
        return "private_access_plan_closed_bootstrap_confirmed";
      }
      if (beforeEnabled === true) {
        privateAccessRecoveryTuple(plan);
        return "private_access_open_generation_without_grant_to_closed_recovery_confirmed";
      }
      if (beforeEnabled !== false || !isNoOp(generation) || !isDeepStrictEqual(beforeInput, afterInput)) {
        reject("private_access_closed_checkpoint_rewrite_rejected");
      }
      return "private_access_plan_closed_no_transition_confirmed";
    }
    // A live open-state plan cannot prove that its grant was created by the
    // reviewed closed-to-open transition rather than left behind out of band.
    // Only close plans are supported once temporary authority exists.
    reject("private_access_open_no_transition_rejected");
  }

  // A plan may either close an existing grant or open one from a previously
  // applied closed checkpoint. It must never carry managed authority on both
  // sides of the plan, even if the profile or condition changes.
  if (beforeGrants.length > 0 && afterGrants.length > 0) {
    reject("private_access_direct_open_to_open_rejected");
  }

  if (afterGrants.length === 1) {
    if (beforeGrants.length !== 0 || beforeEnabled !== false || afterEnabled !== true) {
      reject("private_access_open_requires_applied_closed_checkpoint");
    }
    const checkpointExpiry = exactTimestamp(beforeInput?.checkpoint_expires_at);
    const successorStart = exactTimestamp(afterInput?.starts_at);
    const successorExpiry = exactTimestamp(afterInput?.checkpoint_expires_at);
    const successorConditionExpiry = exactTimestamp(afterInput?.expires_at);
    if (checkpointExpiry === null || successorStart === null || successorExpiry === null || successorConditionExpiry === null) {
      reject("private_access_timestamp_invalid");
    }
    if (successorExpiry !== successorConditionExpiry) {
      reject("private_access_open_checkpoint_must_match_condition_expiry");
    }
    if (successorStart < checkpointExpiry) {
      reject("private_access_successor_starts_before_checkpoint_expiry");
    }
    verifyGrantContract(afterGrants[0], "after", afterInput);
    return "private_access_closed_to_one_grant_confirmed";
  }

  if (beforeGrants.length === 1) {
    if (afterGrants.length !== 0 || afterEnabled !== false) {
      reject("private_access_close_plan_inconsistent");
    }
    privateAccessRecoveryTuple(plan);
    verifyGrantContract(beforeGrants[0], "before", beforeInput);
    return "private_access_one_grant_to_closed_confirmed";
  }

  reject("private_access_mutation_without_managed_grant_rejected");
}

async function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 128 * 1024 * 1024) reject("private_access_plan_too_large");
  }
  const plan = JSON.parse(input);
  process.stdout.write(`${verifyPrivateAccessPlan(plan)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const label = error?.fixedLabel || "private_access_plan_invalid";
    process.stderr.write(`${label}\n`);
    process.exitCode = 1;
  });
}
