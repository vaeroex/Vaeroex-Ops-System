const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const main = read("services/external-integrations-production/infra/activation/main.tf");
const outputs = read("services/external-integrations-production/infra/activation/outputs.tf");
const readme = read("services/external-integrations-production/infra/activation/README.md");
const cloudbuild = read("services/external-integrations-production/image-build/cloudbuild.yaml");
const context = read("services/external-integrations-production/image-build/verify-trigger-context.mjs");
const scans = read("services/external-integrations-production/image-build/qualify-image-scans.mjs");
const codeowners = read(".github/CODEOWNERS");

const trigger = main.match(/resource "google_cloudbuild_trigger" "production_images" \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.match(trigger, /project\s*=\s*var\.project_id/);
assert.match(trigger, /location\s*=\s*var\.region/);
assert.match(trigger, /name\s*=\s*"vaeroex-production-images"/);
assert.match(trigger, /service_account\s*=\s*google_service_account\.build\.id/);
assert.match(trigger, /filename\s*=\s*"services\/external-integrations-production\/image-build\/cloudbuild\.yaml"/);
assert.match(trigger, /owner\s*=\s*"vaeroex"[\s\S]*name\s*=\s*"Vaeroex-Ops-System"/);
assert.match(trigger, /branch\s*=\s*"\^main\$"/);
for (const scope of ["bootstrap-runtime/\\*\\*", "callback-edge/\\*\\*", "image-build/\\*\\*"]) {
  assert.match(trigger, new RegExp(`services/external-integrations-production/${scope}`));
}
assert.match(trigger, /approval_required\s*=\s*true/);
assert.match(trigger, /prevent_destroy\s*=\s*true/);

assert.match(main, /resource "google_project_iam_member" "operator_build_approver"[\s\S]*role\s*=\s*"roles\/cloudbuild\.builds\.approver"[\s\S]*member\s*=\s*"user:\$\{var\.operator_email\}"/);
assert.doesNotMatch(main, /roles\/cloudbuild\.builds\.editor/);
assert.doesNotMatch(main, /resource "google_service_account_iam_member" "operator/);
assert.match(main, /resource "google_storage_bucket_iam_member" "build_candidate_writer"[\s\S]*roles\/storage\.objectCreator[\s\S]*release-candidates\//);
assert.doesNotMatch(main, /build_source_reader|roles\/storage\.objectViewer/);
for (const role of [
  "roles/artifactregistry.writer",
  "roles/cloudbuild.builds.viewer",
  "roles/containeranalysis.occurrences.viewer",
  "roles/logging.logWriter",
  "roles/serviceusage.serviceUsageConsumer",
]) assert.match(main, new RegExp(role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

assert.match(context, /sourceProvenance\?\.resolvedGitSource\?\.url[\s\S]*POLICY\.repositoryUrl/);
assert.match(context, /sourceProvenance\?\.resolvedGitSource\?\.revision[\s\S]*commitSha/);
assert.match(context, /production-image-build[\s\S]*trigger-\$\{build\.buildTriggerId\}/);
assert.match(context, /Object\.hasOwn\(trigger\.github \?\? \{\}, "enterpriseConfigResourceName"\)/);
assert.match(context, /approval\?\.state !== "APPROVED"/);
assert.match(context, /resolvedStorageSource[\s\S]*resolvedStorageSourceManifest[\s\S]*resolvedRepoSource[\s\S]*resolvedConnectedRepository/);
assert.match(context, /REPO_FULL_NAME[\s\S]*REPO_NAME[\s\S]*BRANCH_NAME[\s\S]*TRIGGER_NAME[\s\S]*TRIGGER_BUILD_CONFIG_PATH/);
assert.match(context, /trigger\.resourceName[\s\S]*projects\/\$\{POLICY\.projectId\}\/locations\/\$\{POLICY\.location\}\/triggers/);
assert.match(context, /Object\.keys\(trigger\.substitutions \?\? \{\}\)/);
assert.match(context, /trigger\.triggerTemplate[\s\S]*trigger\.repositoryEventConfig[\s\S]*trigger\.developerConnectEventConfig[\s\S]*trigger\.sourceToBuild/);
assert.match(context, /projects\/\$\{POLICY\.projectId\}\/locations\/\$\{POLICY\.location\}\/builds/);

for (const image of ["square-callback-edge", "production-bootstrap"]) {
  assert.match(cloudbuild, new RegExp(`${image}:\\$COMMIT_SHA`));
  assert.match(cloudbuild, new RegExp(`${image}@sha256:\\[a-f0-9\\]\\{64\\}`));
}
assert.match(cloudbuild, /id: verify-trigger-context[\s\S]*id: require-completed-scans/);
assert.match(cloudbuild, /id: test-callback-edge[\s\S]*go test -count=1 \.\/\.\.\./, "the approved repository-bound build runs parser and plugin orchestration tests");
assert.match(cloudbuild, /sourceProvenanceHash: \[SHA256\]/);
assert.match(scans, /FINISHED_SUCCESS/);
assert.match(scans, /vulnerabilityDiscoveryNote: "projects\/goog-analysis\/notes\/PACKAGE_VULNERABILITY"/);
assert.match(scans, /requiredStableScanReads: 3/);
assert.match(scans, /scanEvidenceFingerprint/);
assert.match(scans, /ifGenerationMatch: "0"/);
assert.match(scans, /release-candidates\/\$\{manifest\.source\.commit\}\/\$\{manifest\.build\.id\}\.json/);
assert.match(scans, /secretAnalysisQualified: false[\s\S]*secretAnalysisRequiredBeforeEligibility: true/);
assert.match(scans, /deploymentEligible: false[\s\S]*requiresReviewedDigestPin: true[\s\S]*automaticRuntimeRollout: false/);
assert.match(scans, /bootstrapException: "CVE-2026-85091"/);
assert.match(scans, /bootstrapDockerfileSha256: "628ac2a6fd58b0ac33ca95c1af9a5717f2c3b26f6bf353853c0d56a6ca57e35f"/);
assert.match(scans, /bootstrapServerSha256: "c724529d24e8338bdfff14b51557a72cedb332abddc6d705a0cecca07e08c110"/);
assert.match(scans, /runtimeDependenciesEmpty[\s\S]*compressionPathAbsent/);
assert.match(outputs, /image_build_approval\s*=\s*true[\s\S]*automatic_rollout\s*=\s*false/);

for (const prohibited of [
  /gcloud\s+builds\s+submit/i,
  /gsutil\s+(?:cp|rsync)/i,
  /gcloud\s+run\s+(?:deploy|services\s+update)/i,
  /terraform\s+(?:apply|destroy)/i,
  /supabase\s+db/i,
  /secretmanager\.versions\.access/i,
  /connect\.squareup(?:sandbox)?\.com/i,
]) assert.doesNotMatch(cloudbuild, prohibited);

assert.match(codeowners, /^\/services\/external-integrations-production\/ @vaeroex$/m);
assert.match(readme, /Direct human build submission remains closed/);
assert.match(readme, /mandatory approval/);
assert.match(readme, /deploymentEligible = false/);
assert.match(readme, /secretAnalysisQualified = false/);
assert.match(readme, /automaticRuntimeRollout = false/);
assert.match(readme, /separate reviewed PR/);

console.log("Production repository-bound image trigger regression tests passed.");
