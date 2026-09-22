import assert from "node:assert/strict";
import { verifyPrivateAccessPlan } from "../scripts/verify-private-access-plan.mjs";

const PRIOR_START = "2099-01-01T00:00:00Z";
const PRIOR_EXPIRY = "2099-01-01T01:00:00Z";
const NEXT_START = "2099-01-02T00:00:00Z";
const NEXT_EXPIRY = "2099-01-02T01:00:00Z";

const generationInput = (enabled, overrides = {}) => ({
  enabled,
  profiles: enabled ? ["oauth"] : [],
  starts_at: enabled ? NEXT_START : PRIOR_START,
  expires_at: enabled ? NEXT_EXPIRY : PRIOR_EXPIRY,
  checkpoint_expires_at: enabled ? NEXT_EXPIRY : PRIOR_EXPIRY,
  ...overrides,
});

const generation = (before, after, actions = ["update"], overrides = {}) => ({
  address: "terraform_data.private_access_generation",
  type: "terraform_data",
  name: "private_access_generation",
  change: {
    actions,
    before: before === null ? null : { input: generationInput(before, overrides.before) },
    after: after === null ? null : { input: generationInput(after, overrides.after) },
  },
});

const grantValue = (profile, overrides = {}) => {
  const startsAt = overrides.starts_at ?? NEXT_START;
  const expiresAt = overrides.expires_at ?? NEXT_EXPIRY;
  return {
    project: "vaeroex-integrations-prod",
    secret_id: `square-production-${profile}-db`,
    role: "projects/vaeroex-integrations-prod/roles/squareProductionPrivateVersions",
    member: "serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com",
    condition: [{
      title: "bounded-native-provisioning",
      description: "One exact database secret during the admitted maintenance window.",
      expression: `request.time >= timestamp('${startsAt}') && request.time < timestamp('${expiresAt}')`,
    }],
    ...overrides,
  };
};

const grant = (profile, before, after, actions, overrides = {}) => ({
  address: `google_secret_manager_secret_iam_member.private_versions["${profile}"]`,
  type: "google_secret_manager_secret_iam_member",
  name: "private_versions",
  index: profile,
  change: {
    actions,
    before: before ? grantValue(profile, overrides.before) : null,
    after: after ? grantValue(profile, overrides.after) : null,
  },
});

function plan(...resourceChanges) {
  return { format_version: "1.2", resource_changes: resourceChanges };
}

function rejects(candidate, label) {
  assert.throws(() => verifyPrivateAccessPlan(candidate), error => error.fixedLabel === label);
}

assert.equal(
  verifyPrivateAccessPlan(plan(generation(false, true), grant("oauth", false, true, ["create"]))),
  "private_access_closed_to_one_grant_confirmed",
);
assert.equal(
  verifyPrivateAccessPlan(plan(generation(true, false, ["delete", "create"], {
    after: { checkpoint_expires_at: NEXT_EXPIRY },
  }), grant("oauth", true, false, ["delete"]))),
  "private_access_one_grant_to_closed_confirmed",
);
assert.equal(
  verifyPrivateAccessPlan(plan(generation(null, false, ["create"]))),
  "private_access_plan_closed_bootstrap_confirmed",
);
assert.equal(
  verifyPrivateAccessPlan(plan(generation(false, false, ["no-op"]))),
  "private_access_plan_closed_no_transition_confirmed",
);
assert.equal(
  verifyPrivateAccessPlan(plan(generation(true, false, ["delete", "create"], {
    after: { checkpoint_expires_at: NEXT_EXPIRY },
  }))),
  "private_access_open_generation_without_grant_to_closed_recovery_confirmed",
);
rejects(
  plan(generation(true, true, ["no-op"]), grant("oauth", true, true, ["no-op"])),
  "private_access_open_no_transition_rejected",
);

rejects(
  plan(generation(true, true), grant("oauth", true, true, ["delete", "create"])),
  "private_access_direct_open_to_open_rejected",
);
rejects(
  plan(generation(true, true), grant("oauth", true, false, ["delete"]), grant("broker", false, true, ["create"])),
  "private_access_direct_open_to_open_rejected",
);
rejects(
  plan(generation(null, true, ["create"]), grant("oauth", false, true, ["create"])),
  "private_access_open_requires_applied_closed_checkpoint",
);
rejects(
  plan(generation(false, true), grant("oauth", false, true, ["create"]), grant("broker", false, true, ["create"])),
  "private_access_plan_multiple_managed_grants",
);
rejects(
  plan(generation(true, false)),
  "private_access_closed_recovery_transition_invalid",
);
rejects(
  plan(generation(true, false, ["delete", "create"], {
    after: { checkpoint_expires_at: "2098-12-31T23:00:00Z" },
  })),
  "private_access_close_must_preserve_expiry",
);
rejects(
  plan(generation(true, true, ["no-op"])),
  "private_access_closed_plan_omits_managed_grant",
);
rejects(
  plan(generation(true, false, ["delete", "create"], { after: { checkpoint_expires_at: "2098-12-31T23:00:00Z" } }), grant("oauth", true, false, ["delete"])),
  "private_access_close_must_preserve_expiry",
);
rejects(
  plan(generation(false, true, ["update"], {
    before: { checkpoint_expires_at: NEXT_EXPIRY },
    after: { starts_at: NEXT_START, checkpoint_expires_at: NEXT_EXPIRY },
  }), grant("oauth", false, true, ["create"])),
  "private_access_successor_starts_before_checkpoint_expiry",
);
rejects(
  plan(generation(false, false, ["update"], { after: { checkpoint_expires_at: "2098-12-31T23:00:00Z" } })),
  "private_access_closed_checkpoint_rewrite_rejected",
);
rejects(
  plan(generation(true, true, ["update"]), grant("oauth", true, true, ["no-op"])),
  "private_access_open_no_transition_rejected",
);
rejects(
  plan(
    generation(true, false, ["delete", "create"], { after: { checkpoint_expires_at: NEXT_EXPIRY } }),
    grant("oauth", true, false, ["delete"], {
      before: {
        condition: [{
          title: "bounded-native-provisioning",
          description: "One exact database secret during the admitted maintenance window.",
          expression: "request.time >= timestamp('2099-01-02T00:00:00Z') && request.time < timestamp('2099-01-03T01:00:00Z')",
        }],
      },
    }),
  ),
  "private_access_managed_grant_contract_mismatch",
);

process.stdout.write("private_access_saved_plan_transition_guard_confirmed\n");
