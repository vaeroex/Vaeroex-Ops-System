const POLICY = Object.freeze({
  projectId: "vaeroex-integrations-prod",
  location: "us-west1",
  triggerName: "vaeroex-production-images",
  repositoryOwner: "vaeroex",
  repositoryName: "Vaeroex-Ops-System",
  repositoryFullName: "vaeroex/Vaeroex-Ops-System",
  branchName: "main",
  branchPattern: "^main$",
  buildConfigPath: "services/external-integrations-production/image-build/cloudbuild.yaml",
  serviceAccount: "projects/vaeroex-integrations-prod/serviceAccounts/vx-int-prod-build@vaeroex-integrations-prod.iam.gserviceaccount.com",
  includedFiles: Object.freeze([
    "services/external-integrations-production/bootstrap-runtime/**",
    "services/external-integrations-production/callback-edge/**",
    "services/external-integrations-production/image-build/**",
  ]),
});

function reject(code) {
  throw new Error(code);
}

function exactString(value, expected, code) {
  if (value !== expected) reject(code);
}

function exactStringSet(value, expected, code) {
  if (!Array.isArray(value)) reject(code);
  const actual = [...value].sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((entry, index) => entry !== wanted[index])) reject(code);
}

export function validateTriggerContext(build, trigger) {
  if (!build || typeof build !== "object" || !trigger || typeof trigger !== "object") reject("context_shape");
  exactString(build.projectId, POLICY.projectId, "build_project");
  exactString(build.serviceAccount, POLICY.serviceAccount, "build_identity");
  if (!/^[a-f0-9-]{16,64}$/.test(build.id ?? "")) reject("build_id");
  if (!/^[a-f0-9-]{16,64}$/.test(build.buildTriggerId ?? "")) reject("trigger_id");

  const substitutions = build.substitutions;
  if (!substitutions || typeof substitutions !== "object") reject("build_substitutions");
  const commitSha = substitutions.COMMIT_SHA;
  if (!/^[a-f0-9]{40}$/.test(commitSha ?? "")) reject("source_commit");
  exactString(substitutions.REVISION_ID, commitSha, "source_revision");
  exactString(substitutions.REPO_FULL_NAME, POLICY.repositoryFullName, "source_repository");
  exactString(substitutions.REPO_NAME, POLICY.repositoryName, "source_repository_name");
  exactString(substitutions.BRANCH_NAME, POLICY.branchName, "source_branch");
  exactString(substitutions.TRIGGER_NAME, POLICY.triggerName, "source_trigger_name");
  exactString(substitutions.TRIGGER_BUILD_CONFIG_PATH, POLICY.buildConfigPath, "source_build_config");

  if (build.approval?.state !== "APPROVED" || build.approval?.result?.decision !== "APPROVED") {
    reject("build_approval");
  }
  if (build.sourceProvenance?.resolvedStorageSource ||
      build.sourceProvenance?.resolvedStorageSourceManifest ||
      build.sourceProvenance?.resolvedGitSource ||
      build.sourceProvenance?.resolvedConnectedRepository) {
    reject("foreign_source_transport");
  }
  exactString(build.sourceProvenance?.resolvedRepoSource?.commitSha, commitSha, "resolved_source_commit");
  exactStringSet(build.tags, ["production-image-build"], "build_tags");

  exactString(trigger.id, build.buildTriggerId, "trigger_identity");
  exactString(trigger.name, POLICY.triggerName, "trigger_name");
  exactString(trigger.serviceAccount, POLICY.serviceAccount, "trigger_identity_binding");
  exactString(trigger.filename, POLICY.buildConfigPath, "trigger_build_config");
  exactString(trigger.github?.owner, POLICY.repositoryOwner, "trigger_repository_owner");
  exactString(trigger.github?.name, POLICY.repositoryName, "trigger_repository_name");
  exactString(trigger.github?.push?.branch, POLICY.branchPattern, "trigger_branch");
  exactStringSet(trigger.includedFiles, POLICY.includedFiles, "trigger_file_scope");
  exactStringSet(trigger.tags, ["production-image-build"], "trigger_tags");
  if (trigger.disabled === true) reject("trigger_disabled");
  if (trigger.approvalConfig?.approvalRequired !== true) reject("trigger_approval_config");
  if (trigger.repositoryEventConfig || trigger.sourceToBuild || trigger.pubsubConfig || trigger.webhookConfig) {
    reject("trigger_foreign_source");
  }

  return Object.freeze({
    buildId: build.id,
    sourceCommit: commitSha,
    repository: POLICY.repositoryFullName,
    branch: POLICY.branchName,
  });
}

export async function getMetadataAccessToken(fetchImpl = fetch) {
  const response = await fetchImpl(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) reject("metadata_token_unavailable");
  const payload = await response.json();
  if (typeof payload.access_token !== "string" || payload.access_token.length < 32 || payload.access_token.length > 8192) {
    reject("metadata_token_invalid");
  }
  return payload.access_token;
}

export async function fetchBoundedJson(url, accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) reject("google_api_rejected");
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(declaredLength) && declaredLength > 1_048_576) reject("google_api_response_oversized");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 1_048_576) reject("google_api_response_oversized");
  try {
    return JSON.parse(text);
  } catch {
    reject("google_api_response_invalid");
  }
}

export async function inspectCurrentTriggerContext({ buildId, fetchImpl = fetch }) {
  if (!/^[a-f0-9-]{16,64}$/.test(buildId ?? "")) reject("build_id");
  const accessToken = await getMetadataAccessToken(fetchImpl);
  const build = await fetchBoundedJson(
    `https://cloudbuild.googleapis.com/v1/projects/${POLICY.projectId}/locations/${POLICY.location}/builds/${buildId}`,
    accessToken,
    fetchImpl,
  );
  if (build.id !== buildId) reject("build_id_mismatch");
  if (!/^[a-f0-9-]{16,64}$/.test(build.buildTriggerId ?? "")) reject("trigger_id");
  const trigger = await fetchBoundedJson(
    `https://cloudbuild.googleapis.com/v1/projects/${POLICY.projectId}/locations/${POLICY.location}/triggers/${build.buildTriggerId}`,
    accessToken,
    fetchImpl,
  );
  return validateTriggerContext(build, trigger);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  inspectCurrentTriggerContext({ buildId: process.env.BUILD_ID }).then(
    (context) => {
      process.stdout.write(`production_image_trigger_context_verified\nsource_commit=${context.sourceCommit}\n`);
    },
    () => {
      process.stderr.write("production_image_trigger_context_rejected\n");
      process.exitCode = 1;
    },
  );
}

export { POLICY };
import { pathToFileURL } from "node:url";
