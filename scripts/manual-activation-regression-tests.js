const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const actions = read("app/app/admin/subscriptions/actions.ts");
const gate = read("lib/billing/get-subscription-status.ts");
const migration = read("supabase/migrations/202607260001_manual_activation_entitlement.sql");
const types = read("lib/supabase/types.ts");

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
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

assert.match(actions, /rpc\("review_manual_activation_request"/);
assert.doesNotMatch(
  actions.slice(actions.indexOf("export async function reviewActivationRequestAction")),
  /\.from\("manual_activation_requests"\)[\s\S]{0,180}\.update\(/,
  "request review must not use a request-only application update"
);
assert.match(actions, /status === "approved" && \(!result\.access_granted \|\| !result\.subscription_id\)/);
assert.match(actions, /Activation request approved and access granted/);
assert.match(actions, /revalidatePath\("\/app\/setup"\)/);
assert.match(actions, /revalidatePath\("\/billing-required"\)/);

assert.match(migration, /create or replace function public\.review_manual_activation_request/);
assert.match(migration, /security invoker/);
assert.match(migration, /set search_path = ''/);
assert.match(migration, /for update;[\s\S]+if not found then/);
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(normalized_email, 0\)\)/);
assert.match(migration, /from public\.profiles[\s\S]+lower\(profile\.email\) = normalized_email/);
assert.match(migration, /from public\.customer_subscriptions[\s\S]+for update/);
assert.match(migration, /if existing_subscription\.id is null then[\s\S]+insert into public\.customer_subscriptions/);
assert.match(migration, /else[\s\S]+entitlement_id := existing_subscription\.id;[\s\S]+update public\.customer_subscriptions/);
assert.match(migration, /status = 'active'/);
assert.match(migration, /manually_activated = true/);
assert.match(migration, /billing_provider = 'manual'/);
assert.match(migration, /plan_slug = normalized_plan_slug/);
assert.match(migration, /membership\.status = 'active'/);
assert.match(migration, /membership\.role in \('owner', 'admin'\)/);
assert.match(migration, /update public\.workspaces[\s\S]+subscription_status = 'active'[\s\S]+manually_unlocked = true/);

const entitlementWrite = migration.indexOf("insert into public.customer_subscriptions");
const approvalWrite = migration.lastIndexOf("update public.manual_activation_requests");
assert.ok(entitlementWrite > -1 && approvalWrite > entitlementWrite, "the entitlement must be written before approval is recorded");

assert.match(migration, /if normalized_status <> 'approved' then[\s\S]+access_granted', false/);
assert.match(migration, /activation_request\.status = 'approved' and normalized_status <> 'approved'/);
assert.match(migration, /existing_subscription\.id is null/);
assert.match(migration, /reviewed_at = coalesce\(request\.reviewed_at, statement_timestamp\(\)\)/);
assert.match(migration, /do \$manual_activation_backfill\$/);
assert.match(migration, /request\.status = 'approved'/);
assert.match(migration, /request\.reviewed_by is not null/);
assert.match(migration, /not exists \([\s\S]+from public\.customer_subscriptions[\s\S]+lower\(subscription\.customer_email\) = lower\(request\.email\)/);
assert.match(migration, /perform public\.review_manual_activation_request\([\s\S]+request_to_repair\.id/);
assert.match(migration, /revoke all on function public\.review_manual_activation_request[\s\S]+from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.review_manual_activation_request[\s\S]+to service_role/);

assert.match(gate, /\.from\("customer_subscriptions"\)/);
assert.match(gate, /subscription\.manually_activated && \["active", "trialing"\]\.includes\(status\)/);
assert.doesNotMatch(gate, /unstable_cache|cacheTag|revalidateTag/, "subscription authorization must observe committed entitlement changes immediately");
assert.match(types, /review_manual_activation_request:/);

class FakeSubscriptionQuery {
  constructor(rows) {
    this.rows = rows;
  }

  select() {
    return this;
  }

  or() {
    return this;
  }

  order() {
    return Promise.resolve({ data: this.rows });
  }
}

async function verifyImmediateAuthorization() {
  const { getSubscriptionStatus } = require(path.join(root, "lib/billing/get-subscription-status.ts"));
  const activeManualEntitlement = {
    id: "entitlement-id",
    user_id: "user-id",
    workspace_id: null,
    customer_email: "owner@example.com",
    status: "active",
    manually_activated: true,
    current_period_end: null,
    plan_slug: "vaeroex",
    billing_provider: "manual",
    stripe_customer_id: null,
    subscription_plans: {
      name: "Vaeroex",
      slug: "vaeroex",
      features_json: [],
      max_workspaces: 1,
      max_users: 10,
      max_forms: null,
      max_checklists: null,
      max_ai_runs_per_month: 1000
    }
  };
  const allowedClient = {
    from(table) {
      assert.equal(table, "customer_subscriptions");
      return new FakeSubscriptionQuery([activeManualEntitlement]);
    }
  };
  const deniedClient = {
    from(table) {
      assert.equal(table, "customer_subscriptions");
      return new FakeSubscriptionQuery([]);
    }
  };

  const allowed = await getSubscriptionStatus({
    supabase: allowedClient,
    userId: "user-id",
    email: "owner@example.com"
  });
  const denied = await getSubscriptionStatus({
    supabase: deniedClient,
    userId: "denied-user-id",
    email: "denied@example.com"
  });

  assert.equal(allowed.allowed, true, "the committed manual entitlement must grant access immediately");
  assert.equal(allowed.source, "manual");
  assert.equal(denied.allowed, false, "a request without an entitlement must remain denied");
  assert.equal(denied.status, "missing");
}

verifyImmediateAuthorization()
  .then(() => console.log("Manual activation entitlement regressions passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
