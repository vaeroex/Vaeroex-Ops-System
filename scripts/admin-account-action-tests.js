const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const subscriptionId = "44444444-4444-4444-8444-444444444444";
const otherSubscriptionId = "55555555-5555-4555-8555-555555555555";
const detailPath = `/app/admin/customers/${workspaceId}?tab=overview`;
const forbidden = () => { throw new Error("Fixture test attempted an unmocked external operation"); };

// Execute the real exported actions, authorization gate, return-path validation,
// and confirmation component. Only fixture clients are available. The database
// queries, RPC outcomes, auth session and audit sink are mocked: these tests do
// not prove PostgreSQL transactions/RLS, provider behavior or browser submission.
// No environment file, credentials, network, running container or database is used.
function load(relativePath, mocks, cache = new Map(), browser = {}) {
  if (cache.has(relativePath)) return cache.get(relativePath).exports;
  const filename = path.join(root, relativePath);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    },
    fileName: filename
  }).outputText;
  const module = { exports: {} };
  cache.set(relativePath, module);
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === "server-only") return {};
    const allowed = new Set([
      "@/lib/admin/action-redirect", "@/lib/admin/vaeroex-admin",
      "@/lib/admin/admin-emails", "@/lib/billing/plans"
    ]);
    assert.ok(allowed.has(name), `Unmocked runtime import: ${name}`);
    return load(`${name.slice(2)}.ts`, mocks, cache, browser);
  };
  Function("require", "module", "exports", "process", "window", "fetch", output)(
    localRequire, module, module.exports,
    { env: { VAEROEX_ADMIN_EMAILS: "admin@example.invalid" } }, browser, forbidden
  );
  return module.exports;
}

function redirect(url) {
  const error = new Error("NEXT_REDIRECT");
  error.url = url;
  throw error;
}

function form(values = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ return_to: detailPath, ...values })) data.set(key, value);
  return data;
}

async function redirected(promise) {
  try {
    await promise;
    assert.fail("Expected an action redirect");
  } catch (error) {
    assert.equal(error.message, "NEXT_REDIRECT");
    return new URL(error.url, "https://fixture.invalid");
  }
}

function harness(options = {}) {
  const workspaces = [workspaceId, otherWorkspaceId].map((id) => ({
    id, name: id === workspaceId ? "Disposable fixture account" : "Unrelated fixture account",
    subscription_status: "expired", plan_slug: "vaeroex", subscription_required: true,
    manually_unlocked: false, created_by: "fixture-owner", primary_contact_email: "contact@example.invalid"
  }));
  const subscriptions = [
    { id: subscriptionId, workspace_id: workspaceId },
    { id: otherSubscriptionId, workspace_id: otherWorkspaceId }
  ].map((record) => ({
    ...record, status: "expired", plan_slug: "vaeroex", notes: "Original fixture note",
    customer_email: "member@example.invalid", user_id: "fixture-member", source: "stripe",
    billing_provider: "stripe", stripe_customer_id: `cus_fixture_${record.id}`,
    stripe_subscription_id: `sub_fixture_${record.id}`, manually_activated: false,
    raw_payload_json: { fixture: true }
  }));
  const state = {
    workspaces, subscriptions, lifecycle: [],
    authUsers: [{ id: "fixture-member", email: "member@example.invalid" }],
    memberships: [{ workspace_id: workspaceId, user_id: "fixture-member", role: "owner", status: "active" }],
    providerBilling: [{ customer: "cus_fixture", subscription: "sub_fixture", status: "active" }],
    connections: [{ workspace_id: workspaceId, provider: "fixture", credential_ref: "fixture-only" }],
    history: [{ workspace_id: workspaceId, agreement: "fixture-agreement", evidence: "fixture-source" }]
  };
  const before = structuredClone(state);
  const queries = [];
  const rpcCalls = [];
  const audits = [];
  const revalidations = [];
  let sessionReads = 0;
  const admin = {
    auth: new Proxy({}, { get: () => forbidden }),
    storage: new Proxy({}, { get: () => forbidden }),
    from(table) {
      assert.ok(["workspaces", "customer_subscriptions"].includes(table), `Unexpected table access: ${table}`);
      const filters = [];
      let operation = "select";
      let values;
      const query = {
        select() { return query; },
        update(next) { operation = "update"; values = next; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        maybeSingle() { return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            assert.ok(sessionReads > 0, "authorization must precede account queries");
            assert.equal(filters.length, 1, "account operations must identify one exact record");
            assert.equal(filters[0][0], "id", "workspace and subscription writes must use their record ID");
            const rows = table === "workspaces" ? state.workspaces : state.subscriptions;
            const row = rows.find((item) => item.id === filters[0][1]);
            assert.ok(row, "this fixture only permits its disposable account IDs");
            queries.push({ table, operation, values: structuredClone(values), filters: structuredClone(filters) });
            if (operation === "update") {
              const allowed = table === "workspaces"
                ? ["subscription_status", "plan_slug", "subscription_required", "manually_unlocked"]
                : ["status", "plan_slug", "notes"];
              assert.ok(Object.keys(values).every((key) => allowed.includes(key)), "unexpected account-field mutation");
              if (options.writeError) return { data: null, error: { message: "Fixture write rejected." } };
              Object.assign(row, values);
              return { data: { id: row.id }, error: null };
            }
            return { data: structuredClone(row), error: null };
          }).then(resolve, reject);
        }
      };
      return query;
    },
    async rpc(name, args) {
      assert.ok(sessionReads > 0, "authorization must precede lifecycle calls");
      assert.equal(name, "transition_workspace_admin_lifecycle");
      assert.deepEqual(Object.keys(args).sort(), ["p_action", "p_actor_id", "p_workspace_id"]);
      assert.equal(args.p_workspace_id, workspaceId);
      assert.equal(args.p_actor_id, actorId);
      rpcCalls.push({ name, args });
      if (options.rpcError) return { data: null, error: { message: options.rpcError } };
      // This models only the RPC's response/state contract. The existing SQL
      // regression suite separately inspects the real database guard clauses.
      const archived = state.lifecycle.some((item) => item.workspace_id === workspaceId && item.archived);
      const shouldArchive = args.p_action === "archive";
      const changed = archived !== shouldArchive;
      if (changed) state.lifecycle = [{ workspace_id: workspaceId, archived: shouldArchive }];
      return { data: { workspace_id: workspaceId, status: shouldArchive ? "archived" : "restored", changed }, error: null };
    }
  };
  const user = options.signedOut ? null : {
    id: actorId,
    email: options.nonAdmin ? "member@example.invalid" : "admin@example.invalid",
    app_metadata: {}
  };
  const mocks = {
    "next/navigation": { redirect },
    "next/cache": { revalidatePath: (value) => revalidations.push(value) },
    "@/lib/supabase/admin": { createSupabaseAdminClient: () => options.missingAdminClient ? null : admin },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({
      auth: { getUser: async () => { sessionReads++; return { data: { user } }; } }
    }) },
    "@/lib/security/tool-execution-gateway": { logSecurityAuditEvent: async ({ supabase, ...event }) => {
      assert.equal(supabase, admin);
      audits.push(event);
    } }
  };
  const actions = {
    ...load("app/app/admin/workspaces/actions.ts", mocks),
    ...load("app/app/admin/subscriptions/actions.ts", mocks)
  };
  const assertPreserved = () => {
    for (const key of ["authUsers", "memberships", "providerBilling", "connections", "history"]) {
      assert.deepEqual(state[key], before[key], `${key} must be preserved`);
    }
    assert.deepEqual(state.workspaces[1], before.workspaces[1], "unrelated workspace must be preserved");
    assert.deepEqual(state.subscriptions[1], before.subscriptions[1], "unrelated subscription must be preserved");
    for (const key of ["customer_email", "user_id", "source", "billing_provider", "stripe_customer_id", "stripe_subscription_id", "raw_payload_json"]) {
      assert.deepEqual(state.subscriptions[0][key], before.subscriptions[0][key], `subscription ${key} must be preserved`);
    }
  };
  return { actions, state, before, queries, rpcCalls, audits, revalidations, assertPreserved };
}

const accessFields = {
  workspace_id: workspaceId, subscription_status: "active", plan_slug: "vaeroex",
  subscription_required: "on", manually_unlocked: "on"
};
const subscriptionFields = { subscription_id: subscriptionId, status: "active", plan_slug: "vaeroex", notes: "Reviewed fixture" };

test("all admin actions deny signed-out, non-admin and unconfigured sessions before reading or changing accounts", async () => {
  for (const options of [{ signedOut: true }, { nonAdmin: true }, { missingAdminClient: true }]) {
    for (const name of ["updateWorkspaceAccessAction", "updateSubscriptionAction", "transitionWorkspaceLifecycleAction", "createManualSubscriptionAction", "reviewActivationRequestAction"]) {
      const fixture = harness(options);
      const url = await redirected(fixture.actions[name](form({ return_to: "/app/admin/workspaces" })));
      if (options.signedOut) assert.equal(url.pathname, "/login");
      else assert.match(url.searchParams.get("error"), /admin|service role/i);
      assert.deepEqual(fixture.state, fixture.before);
      assert.equal(fixture.queries.length + fixture.rpcCalls.length + fixture.audits.length, 0);
      assert.equal(fixture.revalidations.length, 0);
    }
  }
});

test("invalid account targets, statuses and lifecycle actions fail before mutation", async () => {
  for (const [action, fields, expected] of [
    ["updateWorkspaceAccessAction", {}, /Workspace is required/],
    ["updateWorkspaceAccessAction", { ...accessFields, subscription_status: "archived" }, /cannot be assigned/],
    ["updateSubscriptionAction", {}, /Subscription is required/],
    ["updateSubscriptionAction", { ...subscriptionFields, status: "archived" }, /cannot be assigned/],
    ["transitionWorkspaceLifecycleAction", { lifecycle_action: "archive" }, /invalid/],
    ["transitionWorkspaceLifecycleAction", { workspace_id: workspaceId, lifecycle_action: "delete" }, /invalid/]
  ]) {
    const fixture = harness();
    const url = await redirected(fixture.actions[action](form(fields)));
    assert.match(url.searchParams.get("error"), expected);
    assert.deepEqual(fixture.state, fixture.before);
    assert.equal(fixture.queries.length + fixture.rpcCalls.length + fixture.audits.length, 0);
  }
});

test("access editing changes only the submitted workspace access fields and emits its scoped audit", async () => {
  const fixture = harness();
  const url = await redirected(fixture.actions.updateWorkspaceAccessAction(form(accessFields)));
  assert.equal(url.pathname, `/app/admin/customers/${workspaceId}`);
  assert.equal(url.searchParams.get("tab"), "overview");
  assert.equal(url.searchParams.get("message"), "Workspace access updated.");
  assert.deepEqual(fixture.state.workspaces[0], { ...fixture.before.workspaces[0], subscription_status: "active", manually_unlocked: true });
  assert.deepEqual(fixture.state.subscriptions, fixture.before.subscriptions);
  assert.equal(fixture.queries.length, 1);
  assert.equal(fixture.audits[0].actionName, "admin.update_workspace_access");
  assert.equal(fixture.audits[0].workspaceId, workspaceId);
  assert.equal(fixture.audits[0].targetRecordId, workspaceId);
  assert.equal(fixture.audits[0].confirmationReceived, true);
  assert.ok(fixture.revalidations.includes(`/app/admin/customers/${workspaceId}`));
  fixture.assertPreserved();
});

test("subscription edits derive workspace from the stored subscription, preserving identity and provider billing fields", async () => {
  for (const status of ["active", "expired"]) {
    const fixture = harness();
    const url = await redirected(fixture.actions.updateSubscriptionAction(form({
      ...subscriptionFields, status, workspace_id: otherWorkspaceId
    })));
    assert.equal(url.searchParams.get("message"), "Subscription updated.");
    assert.deepEqual(fixture.state.subscriptions[0], { ...fixture.before.subscriptions[0], status, notes: "Reviewed fixture" });
    assert.deepEqual(fixture.state.workspaces[0], {
      ...fixture.before.workspaces[0], subscription_status: status, manually_unlocked: status === "active"
    });
    assert.equal(fixture.audits[0].workspaceId, workspaceId);
    assert.equal(fixture.audits[0].targetRecordId, subscriptionId);
    assert.equal(fixture.audits[0].actionName, "admin.update_subscription");
    fixture.assertPreserved();
  }
});

test("write failures surface errors without reporting success or altering fixture state", async () => {
  for (const [action, fields] of [["updateWorkspaceAccessAction", accessFields], ["updateSubscriptionAction", subscriptionFields]]) {
    const fixture = harness({ writeError: true });
    const url = await redirected(fixture.actions[action](form(fields)));
    assert.equal(url.searchParams.get("error"), "Fixture write rejected.");
    assert.deepEqual(fixture.state, fixture.before);
    assert.equal(fixture.audits.length, 0);
    assert.equal(fixture.revalidations.length, 0);
  }
});

test("external or malformed return targets fall back to the existing admin route", async () => {
  for (const returnTo of ["https://example.invalid/redirect", "//example.invalid/redirect", `/app/admin/customers/${workspaceId}/delete`, `${detailPath}&return_to=https://example.invalid`]) {
    const fixture = harness();
    const url = await redirected(fixture.actions.updateWorkspaceAccessAction(form({ ...accessFields, return_to: returnTo })));
    assert.equal(url.pathname, "/app/admin/workspaces");
    fixture.assertPreserved();
  }
});

test("archive and restore send exact workspace/actor targets and preserve access, subscriptions and account history", async () => {
  const fixture = harness();
  for (const [action, message] of [
    ["archive", "Workspace archived."], ["archive", "Workspace was already archived."],
    ["restore", "Workspace restored."], ["restore", "Workspace was already restored."]
  ]) {
    const url = await redirected(fixture.actions.transitionWorkspaceLifecycleAction(form({ workspace_id: workspaceId, lifecycle_action: action })));
    assert.equal(url.searchParams.get("message"), message);
    assert.equal(fixture.audits.at(-1).actionName, `admin.${action}_workspace`);
    assert.equal(fixture.audits.at(-1).requiredConfirmation, true);
    assert.equal(fixture.audits.at(-1).confirmationReceived, true);
    assert.equal(fixture.audits.at(-1).allowed, true);
    assert.deepEqual(fixture.state.workspaces, fixture.before.workspaces);
    assert.deepEqual(fixture.state.subscriptions, fixture.before.subscriptions);
    fixture.assertPreserved();
  }
  assert.equal(fixture.queries.length, 0);
  assert.equal(fixture.rpcCalls.length, 4);
});

test("lifecycle RPC rejections are surfaced with blocked audit metadata and no fixture changes", async () => {
  for (const message of ["Workspace must be inactive before it can be archived.", "Pending activation workspaces cannot be archived."]) {
    const fixture = harness({ rpcError: message });
    const url = await redirected(fixture.actions.transitionWorkspaceLifecycleAction(form({ workspace_id: workspaceId, lifecycle_action: "archive" })));
    assert.equal(url.searchParams.get("error"), message);
    assert.equal(fixture.audits[0].allowed, false);
    assert.equal(fixture.audits[0].reasonBlocked, "workspace_lifecycle_transition_rejected");
    assert.equal(fixture.revalidations.length, 0);
    assert.deepEqual(fixture.state, fixture.before);
  }
});

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}

test("real lifecycle controls require confirmation, cancel without submission and disable while pending", async () => {
  const jsx = (type, props) => ({ type, props });
  for (const lifecycle of ["inactive", "archived"]) {
    const fixture = harness();
    let pending = false;
    let accepted = false;
    const prompts = [];
    const mocks = {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-dom": { useFormStatus: () => ({ pending }) },
      react: { useState: (value) => [value, () => {}], useRef: (value) => ({ current: value }), useEffect() {} },
      "@/components/app/ActivityProvider": { useActivitySignal() {} },
      "@/app/app/admin/workspaces/actions": fixture.actions
    };
    const browser = { confirm: (message) => { prompts.push(message); return accepted; } };
    const { PendingSubmitButton } = load("components/operations/PendingSubmitButton.tsx", mocks, new Map(), browser);
    mocks["@/components/operations/PendingSubmitButton"] = { PendingSubmitButton };
    const { AdminWorkspaceLifecycleActions } = load("components/admin/AdminWorkspaceLifecycleActions.tsx", mocks, new Map(), browser);
    const tree = AdminWorkspaceLifecycleActions({ workspaceId, companyName: "Disposable fixture account", lifecycle, returnTo: detailPath });
    const renderedForm = nodes(tree, (node) => node.type === "form")[0];
    assert.ok(renderedForm);
    assert.equal(renderedForm.props.action, fixture.actions.transitionWorkspaceLifecycleAction);
    const payload = form(Object.fromEntries(nodes(tree, (node) => node.type === "input").map((node) => [node.props.name, node.props.value])));
    assert.equal(payload.get("workspace_id"), workspaceId);
    assert.equal(payload.get("lifecycle_action"), lifecycle === "inactive" ? "archive" : "restore");
    const submit = nodes(tree, (node) => node.type === PendingSubmitButton)[0];
    assert.ok(submit, "the lifecycle form must retain its pending submit control");
    assert.equal(typeof renderedForm.props.onSubmitCapture, "function", "confirmation must run before the pending submit handler");
    let prevented = false;
    renderedForm.props.onSubmitCapture({ preventDefault: () => { prevented = true; } });
    assert.match(prompts[0], /Disposable fixture account/);
    assert.equal(prevented, true);
    assert.equal(fixture.rpcCalls.length, 0, "cancel must leave the server action undispatched");
    assert.deepEqual(fixture.state, fixture.before);
    accepted = true;
    prevented = false;
    renderedForm.props.onSubmitCapture({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, false);
    await redirected(renderedForm.props.action(payload));
    assert.equal(fixture.rpcCalls.length, 1);
    assert.equal(prompts.length, 2);
    pending = true;
    const pendingButton = nodes(PendingSubmitButton(submit.props), (node) => node.type === "button")[0];
    assert.equal(pendingButton.props.disabled, true);
    assert.equal(pendingButton.props["aria-busy"], true);
    fixture.assertPreserved();
    for (const disallowed of ["active", "pending_activation"]) {
      const unavailable = AdminWorkspaceLifecycleActions({ workspaceId, companyName: "Disposable fixture account", lifecycle: disallowed, returnTo: detailPath });
      assert.equal(nodes(unavailable, (node) => node.type === "form").length, 0, `${disallowed} must not expose an archive form`);
      assert.equal(nodes(unavailable, (node) => node.type === "button")[0].props.disabled, true);
      if (disallowed === "pending_activation") {
        assert.match(content(unavailable), /workspace or a linked subscription is in manual review/);
        assert.doesNotMatch(content(unavailable), /Resolve the activation request/, "manual review does not imply an activation request exists");
      }
    }
  }
});

async function overviewFixture(options = {}) {
  const jsx = (type, props) => ({ type, props });
  const queries = [];
  let authorized = false;
  const members = Array.from({ length: options.emptyMembers ? 0 : 105 }, (_, index) => ({
    id: `membership-${index}`, user_id: index === 0 ? null : `member-${index}`,
    role: index === 0 ? "member" : "owner", status: index === 0 ? "invited" : "active",
    invited_email: index === 0 ? "invitation@example.invalid" : null,
    created_at: "2026-09-29T00:00:00Z"
  }));
  const company = {
    workspace_id: workspaceId, company_name: "Disposable fixture account", lifecycle_status: "inactive",
    subscription_status: "expired", subscription_plan_slug: "vaeroex", billing_provider: "stripe",
    primary_contact_name: "Fixture contact", primary_contact_email: options.activationRequests ? "contact@example.invalid" : null
  };
  const admin = {
    auth: new Proxy({}, { get: () => forbidden }),
    from(table) {
      assert.equal(authorized, true, "page must authorize before account reads");
      const query = { table, columns: null, filters: [], maximum: null };
      const builder = {
        select(columns, settings) { query.columns = columns; query.settings = settings; return builder; },
        eq(key, value) { query.filters.push(["eq", key, value]); return builder; },
        ilike(key, value) { query.filters.push(["ilike", key, value]); return builder; },
        in(key, value) { query.filters.push(["in", key, value]); return builder; },
        is(key, value) { query.filters.push(["is", key, value]); return builder; },
        contains(key, value) { query.filters.push(["contains", key, value]); return builder; },
        order(key, value) { query.order = [key, value]; return builder; },
        limit(value) { query.maximum = value; return builder; },
        maybeSingle() { return builder; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            queries.push(structuredClone(query));
            const error = options.errors?.includes(table) ? { message: "Fixture read unavailable." } : null;
            if (["manual_activation_requests", "subscription_events"].includes(table)) {
              assert.ok(query.filters.some(([kind, key, value]) => kind === "ilike" && key === (table === "manual_activation_requests" ? "email" : "customer_email") && value === company.primary_contact_email));
              if (error) return { data: null, error };
              const statuses = query.filters.find(([kind, key]) => kind === "in" && key === "status")?.[2];
              const rows = table === "manual_activation_requests" ? options.activationRequests : [];
              return { data: rows.filter((row) => !statuses || statuses.includes(row.status)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, query.maximum), error: null };
            }
            if (table === "profiles") {
              assert.equal(query.columns, "id,full_name,email", "profile reads must use only the needed identity fields");
              assert.equal(query.filters.length, 1);
              assert.equal(query.filters[0][0], "in");
              assert.equal(query.filters[0][1], "id");
              const ids = query.filters[0][2];
              assert.ok(ids.length <= 100);
              assert.ok(ids.every((id) => members.slice(0, 100).some((member) => member.user_id === id)), "profiles must come only from this workspace's returned memberships");
              return { data: error ? null : ids.map((id) => ({ id, full_name: `Fixture ${id}`, email: `${id}@example.invalid` })), error };
            }
            const scope = query.filters.find(([kind, key]) => kind === "eq" && key === (table === "workspaces" ? "id" : "workspace_id"));
            assert.equal(scope?.[2], workspaceId, `${table} must stay scoped to the requested workspace`);
            if (error) return { data: null, count: null, error };
            if (table === "admin_company_directory_v1") return { data: company, error: null };
            if (table === "workspaces") return { data: { id: workspaceId, created_at: "2026-09-29", updated_at: "2026-09-29" }, error: null };
            if (table === "workspace_members") return { data: members.slice(0, query.maximum), count: members.length, error: null };
            if (table === "customer_subscriptions") return { data: [], error: null };
            if (table === "workspace_agreements") return { data: null, error: null };
            assert.ok(["kpis", "file_uploads", "reports", "ai_agent_runs"].includes(table), `Unexpected read: ${table}`);
            return { data: null, count: options.nullCounts ? null : 0, error: null };
          }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
  const mocks = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/link": { default: "a" },
    "next/navigation": { notFound: () => { throw new Error("FIXTURE_NOT_FOUND"); } },
    "@/lib/admin/vaeroex-admin": { requireVaeroexAdmin: async (returnTo) => { assert.equal(returnTo, "/app"); authorized = true; return { admin }; } },
    "@/lib/admin/company-directory": { companyAttentionReasons: () => [], formatAdminDate: (value) => value || "Unavailable" },
    "@/lib/ai/active-agent-artifacts": { ACTIVE_AI_AGENT_RUN_TYPES: ["fixture-analysis"] },
    "@/lib/reports/release-channel": { currentSavedAnalysisReleaseChannel: () => "fixture" },
    "@/lib/reports/saved-analysis": { SAVED_ANALYSIS_TYPES: ["fixture"], SAVED_ANALYSIS_ENVELOPE_VERSION: 1 }
  };
  for (const name of ["AdminActivationRequestReview", "AdminAccountOverview", "AdminCompanyTabs", "AdminLifecycleBadge", "AdminManualActivationForm", "AdminSubscriptionEditor", "AdminSubscriptionEventDetails", "AdminWorkspaceAccessForm", "AdminWorkspaceLifecycleActions"]) {
    mocks[`@/components/admin/${name}`] = { [name]: name };
  }
  for (const name of ["CreateDrawer", "EmptyState", "ErrorNotice", "PageHeader", "SectionCard", "StatusBadge"]) {
    mocks[`@/components/operations/${name}`] = { [name]: name };
  }
  mocks["@/components/legal/WorkspaceAgreementActions"] = { WorkspaceAgreementActions: "WorkspaceAgreementActions" };
  const { default: Page } = load("app/app/admin/customers/[workspaceId]/page.tsx", mocks);
  const tree = await Page({ params: Promise.resolve({ workspaceId }), searchParams: Promise.resolve({ tab: options.tab || "overview" }) });
  const props = nodes(tree, (node) => node.type === "AdminAccountOverview")[0]?.props;
  let overview;
  if (props) {
    const { AdminAccountOverview } = load("components/admin/AdminAccountOverview.tsx", mocks);
    overview = AdminAccountOverview(props);
  }
  return { queries, tree, props, overview };
}

function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join("");
  if (tree && typeof tree === "object") return content(tree.props?.children);
  return tree == null || typeof tree === "boolean" ? "" : String(tree);
}

test("older pending requests remain actionable after twelve newer resolved requests", async () => {
  const activationRequests = [
    { id: "older-pending", status: "pending", email: "contact@example.invalid", created_at: "2026-09-01" },
    { id: "older-needs-info", status: "needs_more_info", email: "contact@example.invalid", created_at: "2026-09-02" },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `resolved-${index}`, status: index % 2 ? "approved" : "denied", email: "contact@example.invalid", created_at: "2026-09-29" }))
  ];
  const fixture = await overviewFixture({ activationRequests });
  const requests = fixture.queries.filter((query) => query.table === "manual_activation_requests");
  assert.equal(requests.length, 2);
  assert.ok(requests.every((query) => query.maximum === 12));
  assert.deepEqual(requests.map((query) => query.filters.find(([kind, key]) => kind === "in" && key === "status")[2]), [["pending", "needs_more_info"], ["approved", "denied"]]);
  assert.deepEqual(nodes(fixture.tree, (node) => node.type === "AdminActivationRequestReview").map((node) => node.props.request.id), ["older-needs-info", "older-pending"]);
  const failed = await overviewFixture({ activationRequests, errors: ["manual_activation_requests"] });
  assert.match(nodes(failed.tree, (node) => node.type === "ErrorNotice")[0].props.message, /pending activation requests/);
  assert.equal(nodes(failed.tree, (node) => node.type === "AdminActivationRequestReview").length, 0);
});

test("account overview reads at most 100 workspace memberships and only those members' profile identities", async () => {
  const fixture = await overviewFixture();
  const membershipQuery = fixture.queries.find((query) => query.table === "workspace_members");
  assert.equal(membershipQuery.columns, "id,user_id,role,status,invited_email,created_at");
  assert.equal(membershipQuery.settings.count, "exact");
  assert.deepEqual(membershipQuery.filters, [["eq", "workspace_id", workspaceId]]);
  assert.equal(membershipQuery.maximum, 100);
  assert.equal(fixture.props.memberCount, 105);
  assert.equal(fixture.props.members.length, 100);
  assert.equal(fixture.props.members[0].email, "invitation@example.invalid");
  const profileQuery = fixture.queries.find((query) => query.table === "profiles");
  assert.equal(profileQuery.filters[0][2].length, 99);
  assert.match(content(fixture.overview), /Showing the first 100 of 105 membership records/);
  assert.match(content(fixture.overview), /Login-account deactivation\/reactivation/);
  assert.equal(nodes(fixture.overview, (node) => node.type === "form").length, 0, "overview identity information must remain read-only");
  const empty = await overviewFixture({ emptyMembers: true });
  assert.equal(empty.queries.some((query) => query.table === "profiles"), false, "empty membership sets must not scan profiles");
  assert.match(content(empty.overview), /No membership records/);
  assert.equal(empty.props.memberCount, 0);
});

test("overview read errors and unknown counts stay unavailable instead of being reported as zero or absent", async () => {
  const fixture = await overviewFixture({ errors: ["workspace_members", "customer_subscriptions", "workspace_agreements", "kpis", "file_uploads", "reports", "ai_agent_runs"] });
  assert.equal(fixture.props.memberCount, null);
  assert.equal(fixture.props.subscriptionLabel, "Unavailable");
  assert.equal(fixture.props.agreementLabel, "Unavailable");
  assert.match(fixture.props.memberError, /could not be loaded/);
  assert.ok(fixture.props.footprint.filter(({ label }) => !["Created", "Last workspace update"].includes(label)).every(({ value }) => value === "Unavailable"));
  assert.doesNotMatch(content(fixture.overview), /No membership records/);
  assert.match(content(fixture.overview), /Workspace members · unavailable/);
  assert.equal(fixture.queries.some((query) => query.table === "profiles"), false);
  const profileError = await overviewFixture({ errors: ["profiles"] });
  assert.equal(profileError.props.memberCount, 105);
  assert.match(profileError.props.memberError, /identities could not be loaded/);
  assert.doesNotMatch(content(profileError.overview), /No membership records/);
  const nullCounts = await overviewFixture({ nullCounts: true });
  assert.equal(nullCounts.props.footprint.find(({ label }) => label === "KPIs").value, "Unavailable");
  const workspaceError = await overviewFixture({ errors: ["workspaces"] });
  assert.equal(workspaceError.props, undefined, "unverified workspace must not expose account controls");
  assert.match(nodes(workspaceError.tree, (node) => node.type === "ErrorNotice")[0].props.message, /No access settings/);
});

test("manual subscription partial failure is a persistent error, never confirmed access or a blind retry", async () => {
  for (const existing of [false, true]) {
    const workspace = { id: workspaceId, subscription_status: "expired", manually_unlocked: false };
    const originalWorkspace = structuredClone(workspace);
    let savedRecord = null;
    let workspaceAttempts = 0;
    const writes = [];
    const admin = {
      from(table) {
        assert.ok(["profiles", "customer_subscriptions", "workspaces"].includes(table));
        let payload;
        const filters = [];
        const query = {
          select() { return query; },
          eq(key, value) { filters.push([key, value]); return query; },
          order() { return query; },
          limit() { return query; },
          async maybeSingle() {
            if (payload) return await query;
            if (table === "profiles") return { data: { id: "fixture-member" }, error: null };
            if (table === "workspaces") return { data: { id: workspaceId }, error: null };
            assert.equal(table, "customer_subscriptions");
            assert.deepEqual(filters, [["customer_email", "member@example.invalid"], ["billing_provider", "manual"], ["manually_activated", true], ["workspace_id", workspaceId]]);
            return { data: existing ? { id: subscriptionId, workspace_id: workspaceId } : null, error: null };
          },
          async insert(value) {
            assert.equal(table, "customer_subscriptions");
            savedRecord = structuredClone(value);
            writes.push("subscription saved");
            return { data: null, error: null };
          },
          update(value) { payload = value; return query; },
          then(resolve, reject) {
            return Promise.resolve().then(() => {
              if (table === "customer_subscriptions") {
                assert.deepEqual(filters, [["id", subscriptionId]]);
                savedRecord = structuredClone(payload);
                writes.push("subscription saved");
                return { data: null, error: null };
              }
              assert.equal(table, "workspaces");
              assert.deepEqual(filters, [["id", workspaceId]]);
              assert.equal(payload.manually_unlocked, true);
              workspaceAttempts++;
              writes.push("workspace rejected");
              return { data: null, error: { message: "Synthetic workspace update rejected." } };
            }).then(resolve, reject);
          }
        };
        return query;
      }
    };
    const { createManualSubscriptionAction } = load("app/app/admin/subscriptions/actions.ts", {
      "next/navigation": { redirect },
      "next/cache": { revalidatePath() {} },
      "@/lib/admin/vaeroex-admin": { requireVaeroexAdmin: async () => ({ admin, user: { id: actorId } }) },
      "@/lib/security/tool-execution-gateway": { logSecurityAuditEvent: async () => {} }
    });
    const url = await redirected(createManualSubscriptionAction(form({ customer_email: "member@example.invalid", workspace_id: workspaceId, plan_slug: "vaeroex", status: "active" })));
    assert.deepEqual(writes, ["subscription saved", "workspace rejected"]);
    assert.equal(workspaceAttempts, 1);
    assert.equal(savedRecord.status, "active");
    assert.equal(savedRecord.billing_provider, "manual");
    assert.deepEqual(workspace, originalWorkspace, "failed workspace write must not be mistaken for confirmed access");
    assert.equal(url.searchParams.has("message"), false);
    assert.match(url.searchParams.get("error"), /record saved, but the workspace update failed/);
    assert.match(url.searchParams.get("error"), /Access is not confirmed/);

    const jsx = (type, props) => ({ type, props });
    const { AdminManualActivationForm } = load("components/admin/AdminManualActivationForm.tsx", {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "@/components/operations/PendingSubmitButton": { PendingSubmitButton: "PendingSubmitButton" },
      "@/app/app/admin/subscriptions/actions": { createManualSubscriptionAction }
    });
    const rendered = AdminManualActivationForm({ returnTo: detailPath, workspaceId, customerEmail: "member@example.invalid" });
    assert.match(content(rendered), /Saves a manual subscription record/);
    assert.match(content(rendered), /Stripe records and other workspaces are not converted or moved/);
    assert.match(content(rendered), /no automatic end date/);
    assert.doesNotMatch(content(rendered), /Saves manual access|access (?:is|was) granted/i);
    const submit = nodes(rendered, (node) => node.type === "PendingSubmitButton")[0];
    assert.equal(content(submit), "Save manual subscription record");
    assert.equal(submit.props.pendingLabel, "Saving manual subscription record...");
  }
  const page = await overviewFixture({ tab: "subscription", emptyMembers: true });
  const drawer = nodes(page.tree, (node) => node.type === "CreateDrawer")[0];
  assert.equal(drawer.props.title, "Manual subscription record");
  assert.equal(drawer.props.triggerLabel, "Manage manual subscription");
  assert.match(drawer.props.description, /without a purchase or charge/);
  assert.doesNotMatch(drawer.props.description, /Record manually approved access/);
});

// Execute the real actions and entitlement evaluator over disposable in-memory
// rows. This is not a claim of Auth signup, PostgREST or RLS qualification.
function pilotFixture(options = {}) {
  const email = "ordinary-owner@example.invalid";
  const state = {
    profiles: [{ id: "ordinary-owner", email }],
    workspaces: [{ id: workspaceId, subscription_required: true, manually_unlocked: false, subscription_status: "manual_review", plan_slug: "vaeroex" }],
    customer_subscriptions: [
      { id: "other-manual", customer_email: email, user_id: "ordinary-owner", workspace_id: otherWorkspaceId, billing_provider: "manual", manually_activated: true, status: "expired" },
      { id: "other-stripe", customer_email: email, user_id: "ordinary-owner", workspace_id: otherWorkspaceId, billing_provider: "stripe", manually_activated: false, status: "active" }
    ]
  };
  const preserved = structuredClone(state.customer_subscriptions);
  const writes = [];
  const admin = { from(table) {
    assert.ok(Object.hasOwn(state, table));
    let filters = [], payload, operation = "read", maximum;
    const q = {
      select() { return q; }, eq(key, value) { filters.push([key, value]); return q; },
      is(key, value) { filters.push([key, value]); return q; },
      or() { return q; }, order() { return q; }, limit(value) { maximum = value; return q; },
      maybeSingle() { return execute(true); },
      insert(value) { payload = value; operation = "insert"; return q; },
      update(value) { payload = value; operation = "update"; return q; },
      then(resolve, reject) { return execute(false).then(resolve, reject); }
    };
    async function execute(single) {
      if (options.readError === table && operation === "read") return { data: null, error: { message: "Synthetic read rejected" } };
      let rows = state[table].filter((row) => filters.every(([key, value]) => row[key] === value));
      if (maximum) rows = rows.slice(0, maximum);
      if (operation !== "read") {
        writes.push({ table, operation, filters: structuredClone(filters) });
        if (options.workspaceWriteFailure && table === "workspaces") return { data: null, error: { message: "Synthetic workspace failure" } };
        if (operation === "insert") {
          const row = { id: `manual-${state[table].length}`, ...payload };
          state[table].push(row); rows = [row];
        } else rows.forEach((row) => Object.assign(row, payload));
      }
      return { data: structuredClone(single ? rows[0] || null : rows), error: null };
    }
    return q;
  } };
  const actions = load("app/app/admin/subscriptions/actions.ts", {
    "next/navigation": { redirect }, "next/cache": { revalidatePath() {} },
    "@/lib/admin/vaeroex-admin": { requireVaeroexAdmin: async () => ({ admin, user: { id: actorId } }) },
    "@/lib/security/tool-execution-gateway": { logSecurityAuditEvent: async () => {} }
  });
  const { getSubscriptionStatus } = load("lib/billing/get-subscription-status.ts", {});
  const eligibility = (selectedWorkspace) => getSubscriptionStatus({ supabase: admin, userId: "ordinary-owner", email, workspaceId: selectedWorkspace });
  const fields = { customer_email: email, workspace_id: workspaceId, plan_slug: "vaeroex", status: "active" };
  return { state, writes, preserved, fields, actions, eligibility };
}

test("ordinary non-admin pilot: manual grant targets one workspace, preserves Stripe/other workspace, and can end without disabling login", async () => {
  const f = pilotFixture();
  assert.equal((await f.eligibility(workspaceId)).allowed, false);
  let result = await redirected(f.actions.createManualSubscriptionAction(form(f.fields)));
  assert.match(result.searchParams.get("message"), /record and workspace settings saved/);
  assert.equal((await f.eligibility(workspaceId)).allowed, true);
  assert.equal((await f.eligibility(workspaceId)).source, "manual", "must not use admin bypass");
  assert.deepEqual(f.state.customer_subscriptions.slice(0, 2), f.preserved);
  result = await redirected(f.actions.createManualSubscriptionAction(form({ ...f.fields, status: "expired" })));
  assert.equal(result.searchParams.has("error"), false);
  assert.equal(f.state.customer_subscriptions.length, 3, "repeat save updates the exact manual record, not another record");
  assert.equal((await f.eligibility(workspaceId)).allowed, false);
  assert.equal(f.state.workspaces[0].manually_unlocked, false);
  assert.equal(f.state.workspaces[0].subscription_required, true);
  assert.equal(f.state.profiles[0].email, f.fields.customer_email, "login identity retained");
  assert.deepEqual(f.state.customer_subscriptions.slice(0, 2), f.preserved);
});

test("first-time manual pilot record is unlinked for setup, never moves an existing workspace record", async () => {
  const f = pilotFixture();
  const result = await redirected(f.actions.createManualSubscriptionAction(form({ ...f.fields, workspace_id: "" })));
  assert.match(result.searchParams.get("message"), /continue to workspace setup/);
  assert.equal(f.state.customer_subscriptions.at(-1).workspace_id, null);
  assert.equal((await f.eligibility()).allowed, true);
  assert.equal((await f.eligibility(workspaceId)).allowed, false, "unlinked setup access does not unlock an existing workspace");
  assert.deepEqual(f.state.customer_subscriptions.slice(0, 2), f.preserved);
  assert.equal(f.writes.some((write) => write.table === "workspaces"), false);
});

test("manual lookup failures or unknown workspace cause no writes; a rejected second write stops with exact partial-result feedback", async () => {
  for (const readError of ["profiles", "workspaces", "customer_subscriptions"]) {
    const f = pilotFixture({ readError });
    const result = await redirected(f.actions.createManualSubscriptionAction(form(f.fields)));
    assert.match(result.searchParams.get("error"), /Nothing was saved/);
    assert.equal(f.writes.length, 0);
  }
  const absent = pilotFixture();
  assert.match((await redirected(absent.actions.createManualSubscriptionAction(form({ ...absent.fields, workspace_id: "missing" })))).searchParams.get("error"), /Workspace could not be verified/);
  assert.equal(absent.writes.length, 0);
  const failed = pilotFixture({ workspaceWriteFailure: true });
  const result = await redirected(failed.actions.createManualSubscriptionAction(form(failed.fields)));
  assert.match(result.searchParams.get("error"), /record saved, but the workspace update failed/);
  assert.equal(failed.writes.length, 2, "no retry or compensating mutation");
  assert.equal((await failed.eligibility(workspaceId)).allowed, false);
});
