import assert from "node:assert/strict";
import test from "node:test";
import { inspectCurrentTriggerContext, POLICY, validateTriggerContext } from "./verify-trigger-context.mjs";

const buildId = "01234567-89ab-cdef-0123-456789abcdef";
const triggerId = "fedcba98-7654-3210-fedc-ba9876543210";
const commit = "a".repeat(40);

function fixture() {
  const build = {
    id: buildId,
    projectId: POLICY.projectId,
    buildTriggerId: triggerId,
    serviceAccount: POLICY.serviceAccount,
    tags: ["production-image-build"],
    substitutions: {
      COMMIT_SHA: commit,
      REVISION_ID: commit,
      REPO_FULL_NAME: POLICY.repositoryFullName,
      REPO_NAME: POLICY.repositoryName,
      BRANCH_NAME: POLICY.branchName,
      TRIGGER_NAME: POLICY.triggerName,
      TRIGGER_BUILD_CONFIG_PATH: POLICY.buildConfigPath,
    },
    approval: { state: "APPROVED", result: { decision: "APPROVED" } },
    sourceProvenance: { resolvedRepoSource: { commitSha: commit } },
  };
  const trigger = {
    id: triggerId,
    resourceName: `projects/${POLICY.projectId}/locations/${POLICY.location}/triggers/${triggerId}`,
    name: POLICY.triggerName,
    serviceAccount: POLICY.serviceAccount,
    filename: POLICY.buildConfigPath,
    includedFiles: [...POLICY.includedFiles],
    tags: ["production-image-build"],
    github: { owner: POLICY.repositoryOwner, name: POLICY.repositoryName, push: { branch: POLICY.branchPattern } },
    approvalConfig: { approvalRequired: true },
  };
  return { build, trigger };
}

function rejected(change, expected) {
  const { build, trigger } = fixture();
  change(build, trigger);
  assert.throws(() => validateTriggerContext(build, trigger), new RegExp(expected));
}

test("accepts only the exact approved trigger context", () => {
  const { build, trigger } = fixture();
  assert.deepEqual(validateTriggerContext(build, trigger), {
    buildId,
    sourceCommit: commit,
    repository: POLICY.repositoryFullName,
    branch: POLICY.branchName,
  });
});

test("rejects manual, unapproved, foreign-source, wrong-revision and impersonated builds", () => {
  rejected((build) => { delete build.buildTriggerId; }, "trigger_id");
  rejected((build) => { build.approval.state = "PENDING"; }, "build_approval");
  rejected((build) => { build.serviceAccount = "projects/vaeroex-integrations-prod/serviceAccounts/human@example.invalid"; }, "build_identity");
  rejected((build) => { build.sourceProvenance.resolvedStorageSource = { bucket: "foreign" }; }, "foreign_source_transport");
  rejected((build) => { build.sourceProvenance.resolvedRepoSource.commitSha = "b".repeat(40); }, "resolved_source_commit");
  rejected((build) => { build.substitutions.REVISION_ID = "b".repeat(40); }, "source_revision");
  rejected((build) => { build.substitutions.REPO_FULL_NAME = "attacker/fork"; }, "source_repository");
  rejected((build) => { build.substitutions.BRANCH_NAME = "feature"; }, "source_branch");
  rejected((build) => { build.tags.push("unexpected"); }, "build_tags");
});

test("rejects trigger drift and broader source scope", () => {
  rejected((_, trigger) => { trigger.github.owner = "attacker"; }, "trigger_repository_owner");
  rejected((_, trigger) => {
    trigger.github.enterpriseConfigResourceName = "projects/vaeroex-integrations-prod/locations/us-west1/githubEnterpriseConfigs/foreign";
  }, "trigger_enterprise_repository");
  rejected((_, trigger) => { trigger.github.enterpriseConfigResourceName = ""; }, "trigger_enterprise_repository");
  rejected((_, trigger) => { trigger.resourceName = `projects/foreign/locations/${POLICY.location}/triggers/${triggerId}`; }, "trigger_resource_name");
  rejected((_, trigger) => { trigger.github.push.branch = ".*"; }, "trigger_branch");
  rejected((_, trigger) => { trigger.filename = "cloudbuild.yaml"; }, "trigger_build_config");
  rejected((_, trigger) => { trigger.serviceAccount = "projects/vaeroex-integrations-prod/serviceAccounts/other@example.invalid"; }, "trigger_identity_binding");
  rejected((_, trigger) => { trigger.includedFiles.push("**"); }, "trigger_file_scope");
  rejected((_, trigger) => { trigger.ignoredFiles = ["services/external-integrations-production/image-build/**"]; }, "trigger_ignored_file_scope");
  rejected((_, trigger) => { trigger.substitutions = { _UNREVIEWED_SOURCE: "true" }; }, "trigger_substitutions");
  rejected((_, trigger) => { trigger.approvalConfig.approvalRequired = false; }, "trigger_approval_config");
  rejected((_, trigger) => { trigger.disabled = true; }, "trigger_disabled");
  rejected((_, trigger) => { trigger.repositoryEventConfig = {}; }, "trigger_foreign_source");
});

test("reads the actual build and trigger records without exposing the metadata token", async () => {
  const { build, trigger } = fixture();
  const calls = [];
  const token = "synthetic-access-token-that-is-never-logged";
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), authorization: options.headers?.Authorization });
    if (String(url).includes("metadata.google.internal")) {
      assert.equal(options.headers["Metadata-Flavor"], "Google");
      return new Response(JSON.stringify({ access_token: token }), { status: 200 });
    }
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return new Response(JSON.stringify(String(url).includes("/builds/") ? build : trigger), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  assert.deepEqual(await inspectCurrentTriggerContext({ buildId, fetchImpl }), {
    buildId,
    sourceCommit: commit,
    repository: POLICY.repositoryFullName,
    branch: POLICY.branchName,
  });
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, new RegExp(`/projects/${POLICY.projectId}/locations/${POLICY.location}/builds/${buildId}$`));
  assert.match(calls[2].url, new RegExp(`/projects/${POLICY.projectId}/locations/${POLICY.location}/triggers/${triggerId}$`));
  assert.equal(JSON.stringify(calls).includes(token), true, "the token is used only as the outbound authorization header in memory");
});
