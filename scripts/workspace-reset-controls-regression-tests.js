const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const actions = read("app/app/settings/workspace-reset-actions.ts");
const panel = read("components/settings/WorkspaceResetPanel.tsx");
const settings = read("app/app/settings/page.tsx");
const setupActions = read("app/app/setup/actions.ts");
const stagingHarness = read("scripts/workspace-reset-staging-harness.js");

assert.match(actions, /signInWithPassword/, "reset and restore must require password reauthentication");
assert.match(actions, /OAuth-only accounts cannot use this control yet/, "OAuth-only reset attempts must fail with an understandable message");
assert.match(actions, /requireWorkspaceRole\(\["owner", "admin"\]/, "server actions must require owner/admin");
assert.match(actions, /workspaceId !== access\.workspaceId/, "destructive forms must match the already-active workspace instead of selecting one from form input");
assert.match(actions, /requireToolExecution/, "destructive reset actions must pass through the Tool Execution Gateway");
assert.match(actions, /begin_workspace_data_reset[\s\S]+buildWorkspaceResetStorageManifest[\s\S]+reset_workspace_data/, "manifesting must complete before the database reset");
assert.match(actions, /databaseResetCompleted/, "partial failure handling must distinguish pre-reset from post-reset errors");
assert.match(actions, /anotherPurgeOwnsOperation/, "an action that did not acquire the purge claim must not overwrite another worker's state");
assert.match(actions, /markResetOperationPartial/, "post-database failures must remain visibly retryable");
assert.match(actions, /manifestCleanupFailed/, "restore must surface incomplete manifest minimization rather than silently claiming success");

assert.match(panel, /Confirmation \{confirmationStep\} of 2/, "the UI must have two confirmation steps");
assert.match(panel, /Recoverable for 30 days/, "recoverable reset must be the visible default");
assert.match(panel, /Permanently delete now/, "permanent reset must be clearly labeled");
assert.match(panel, /current-password/, "the UI must request current-password reauthentication");
assert.match(panel, /OAuth-only accounts cannot use workspace reset yet/, "the UI must disclose the password-only reauthentication limitation");
assert.match(panel, /type="button"[\s\S]+Review reset/, "the initial danger control must not submit accidentally");
assert.match(settings, /canResetWorkspace/, "Settings must hide reset controls from non-admin members");
assert.match(setupActions, /complete_workspace_reset_guided_setup/, "guided reset setup must target the preserved workspace transactionally");

assert.match(stagingHarness, /VAEROEX_STAGING_CONFIRM/, "the staging harness must require an explicit destructive-test confirmation");
assert.match(stagingHarness, /connectedRef === productionRef|stagingRef === productionRef/, "the staging harness must refuse the production project");
assert.match(stagingHarness, /knownProductionUrls\.includes|knownProductionServiceRoleKey/, "the staging harness must reject production credentials already present in the shell");
assert.match(stagingHarness, /workspace_reset_operations[\s\S]+\.in\("workspace_id", cleanup\.workspaceIds\)/, "staging reset-ledger cleanup must remain workspace scoped");
assert.match(stagingHarness, /RESETTABLE_TABLES/, "the staging harness must inventory every resettable table");
assert.match(stagingHarness, /assertWorkspaceCounts/, "the staging harness must verify target and isolated workspace counts");
assert.match(stagingHarness, /anonymous callers must be denied/, "the staging harness must test anonymous denial");
assert.match(stagingHarness, /concurrent reset must be denied/, "the staging harness must test concurrency protection");
assert.match(stagingHarness, /direct authenticated Storage uploads must be denied/, "the staging harness must test direct Storage manifest races");
assert.match(stagingHarness, /retained reset storage must be quarantined/, "the staging harness must test recoverable object quarantine");
assert.match(stagingHarness, /soft-deleted source storage must leave normal product access immediately/, "the staging harness must test normal source retention isolation");
assert.match(stagingHarness, /regular members must not call the source lifecycle RPC directly/, "the staging harness must test direct lifecycle authorization");
assert.match(stagingHarness, /authenticated workspace users must not invoke the service-only source purge claim/, "the staging harness must test source purge RPC grants");
assert.match(stagingHarness, /a current source purge claim must not be duplicated/, "the staging harness must test source purge claim idempotency");
assert.match(stagingHarness, /workspace reset preparation must stop while a source purge claim is active/, "the staging harness must test reset and retention-purge concurrency");
assert.match(stagingHarness, /permanent reset must stop before database deletion when storage is under legal hold/, "the staging harness must test legal-hold blocking before permanent reset");

process.stdout.write("Workspace reset controls and staging regression tests passed.\n");
