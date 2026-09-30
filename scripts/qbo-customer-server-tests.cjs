/* eslint-disable @typescript-eslint/no-require-imports -- Mock only identity and persistence capabilities, then run the actual server/page. */
const assert = require("node:assert/strict"), test = require("node:test"), fs = require("node:fs"), path = require("node:path");
const { installLoader, ids, timestamp, root } = require("./qbo-customer-test-support.cjs");
let role = "owner", memberUser = ids.actor, memberStatus = "active", sub = ids.actor, session = ids.session;
let calls = [], authCalls = 0, rpcError = null, rpcData, redirect = false;
const empty = { contractVersion: "qbo_customer_source_browse_v1", provider: "quickbooks_online", environment: "production",
  additive: false, coverage: "unknown", readAt: timestamp, connectionId: null, kind: "all", pageSize: 25,
  nextAfter: null, sources: [], detail: null, connections: [],
  metrics: { scope: "selected_connection_and_category_current_sources", currentSources: "0", reportObservations: "0", transactionRecords: "0",
    validation: { pending: "0", valid: "0", invalid: "0", quarantined: "0" }, lifecycle: { active: "0", voided: "0", deleted: "0", unavailable: "0" },
    validationWork: { absent: "0", pending: "0", claimed: "0", valid: "0", quarantined: "0", superseded: "0", conflict: "0" },
    missingCurrency: "0", unknownAccountingBasis: "0", missingSourceTimeZone: "0", missingTransactionPostingDate: "0",
    earliestPostingDate: null, latestPostingDate: null, earliestObservedAt: null, latestObservedAt: null, latestSynchronizedAt: null, byType: [] } };
const mocks = {
  "@/lib/security/require-auth": { requireAuth: async () => {
    authCalls++; if (redirect) throw Error("AUTH_REDIRECT");
    return { user: { id: ids.actor }, supabase: {
      auth: { getClaims: async () => ({ data: { claims: { sub, session_id: session } }, error: null }) },
      rpc: async (name, payload) => { calls.push({ name, payload }); return { data: rpcData ?? empty, error: rpcError }; }
    } };
  } },
  "@/lib/security/get-current-workspace": { getCurrentWorkspace: async (...args) => {
    assert.deepEqual(args, []); return { workspaceId: ids.workspace, membership: {
      role, user_id: memberUser, status: memberStatus, workspace_id: ids.workspace
    } };
  } },
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => { throw Error("Forbidden service-role access"); } },
  "next/navigation": { notFound: () => { throw Error("NOT_FOUND"); } },
  "@/components/operations/PageHeader": { PageHeader: () => null }
};
installLoader(mocks);
global.fetch = async () => { throw Error("Unexpected provider, model or network call"); };
const { qboCustomerStoredData } = require("../lib/integrations/qbo-customer/server.ts");
const Page = require("../app/app/settings/integrations/quickbooks/data/page.tsx").default;
const { renderToStaticMarkup } = require("react-dom/server");
const { QboIntelligenceDiagnostic } = require("../lib/integrations/qbo-customer/intelligence-diagnostic.tsx");

test("QBO gate stays fail-closed before identity or source access", async () => {
  process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED = "false";
  assert.equal(await qboCustomerStoredData({}), null);
  await assert.rejects(() => Page({}), /NOT_FOUND/);
  assert.equal(authCalls, 0); assert.deepEqual(calls, []);
});
test("authenticated RPC receives current workspace and only validated browsing arguments", async () => {
  process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED = "true"; calls = [];
  await qboCustomerStoredData({ connectionId: ids.connection, kind: "reports", workspaceId: "attacker", actorId: "attacker", sessionId: "attacker", pageSize: "999" });
  assert.deepEqual(calls, [{ name: "qbo_customer_source_browse_v1", payload: {
    p_workspace_id: ids.workspace, p_connection_id: ids.connection, p_after_id: null, p_source_id: null, p_kind: "reports"
  } }]);
});
test("non-owners, changed claims, invalid sessions and invalid queries never reach persistence", async () => {
  for (const situation of ["admin", "foreign-member", "inactive", "claims", "session", "query"]) {
    role = situation === "admin" ? "admin" : "owner"; memberUser = situation === "foreign-member" ? "other" : ids.actor;
    memberStatus = situation === "inactive" ? "inactive" : "active"; sub = situation === "claims" ? "other" : ids.actor;
    session = situation === "session" ? "invalid" : ids.session; calls = [];
    await assert.rejects(() => qboCustomerStoredData(situation === "query" ? { connectionId: [ids.connection] } : {}));
    assert.deepEqual(calls, []);
  }
  role = "owner"; memberUser = ids.actor; memberStatus = "active"; sub = ids.actor; session = ids.session;
});
test("missing RPC, schema drift and owner denial show honest unavailable state without diagnostics or zero-count fabrication", async () => {
  rpcError = { message: "PRIVATE_DATABASE_DETAILS", code: "PGRST202" };
  let html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  assert.match(html, /record counts are unavailable/); assert.doesNotMatch(html, /PRIVATE_DATABASE_DETAILS|Current sources/);
  rpcError = null; rpcData = { ...empty, realmId: "SECRET" };
  await assert.rejects(() => qboCustomerStoredData({}), /unavailable/); rpcData = null;
  role = "admin"; html = renderToStaticMarkup(await Page({})); assert.match(html, /Workspace owner access/); role = "owner";
  redirect = true; await assert.rejects(() => Page({}), /AUTH_REDIRECT/); redirect = false;
});
test("new module and migration boundaries exclude AI, provider, credential, checkpoint and economic mutation APIs", () => {
  const server = fs.readFileSync(path.join(root, "lib/integrations/qbo-customer/server.ts"), "utf8");
  assert.doesNotMatch(server, /createSupabaseAdminClient|\.from\(|fetch\(|credential|checkpoint|generateText|evidence-index/);
  const sql = fs.readFileSync(path.join(root, "supabase/production-migrations/20260930003000_qbo_customer_source_browse.sql"), "utf8");
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update\s+private\.|delete\s+from|alter\s+table|create\s+policy)\b/i);
  assert.doesNotMatch(sql, /private\.(?:credential|.*checkpoint|.*economic|.*authority)/i);
  const route = fs.readFileSync(path.join(root, "app/app/settings/integrations/quickbooks/data/page.tsx"), "utf8");
  assert.match(route, /force-dynamic/); assert.match(route, /revalidate = 0/);
});

test("Intelligence diagnostic is gated, owner-only, workspace-bound and performs exactly one bounded authenticated browse", async () => {
  calls = []; const before = authCalls;
  process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED = "false";
  assert.equal(await QboIntelligenceDiagnostic({ workspaceId: ids.workspace }), null);
  assert.equal(authCalls, before); assert.deepEqual(calls, []);
  process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED = "true";
  for (const forbiddenRole of ["admin", "manager", "member"]) {
    role = forbiddenRole;
    assert.equal(await QboIntelligenceDiagnostic({ workspaceId: ids.workspace }), null);
  }
  role = "owner";
  assert.equal(await QboIntelligenceDiagnostic({ workspaceId: "other-workspace" }), null);
  assert.deepEqual(calls, []);
  const html = renderToStaticMarkup(await QboIntelligenceDiagnostic({ workspaceId: ids.workspace }));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, { p_workspace_id: ids.workspace, p_connection_id: null,
    p_after_id: null, p_source_id: null, p_kind: "all" });
  assert.match(html, /QuickBooks record status/); assert.match(html, /Coverage: unknown/);
  assert.match(html, /Combined Square\/QuickBooks revenue is unavailable/);
  assert.match(html, /No stored records does not mean no business activity/);
  assert.doesNotMatch(html, /corroborating evidence|economic authority|intelligence generation|KPI changes/);
  assert.match(html, /href="\/app\/settings\/integrations\/quickbooks\/data\?kind=all"/);
});

test("Intelligence diagnostic keeps unavailable distinct from zero, strips source details, and does not swallow auth redirects", async () => {
  const { qboCoverageDiagnostic } = require("../lib/integrations/qbo-customer/diagnostic-view.tsx");
  const projected = qboCoverageDiagnostic({ ...empty, sources: ["DO_NOT_PASS_SOURCE_ROWS"], detail: "DO_NOT_PASS_PREVIEW" });
  assert(!JSON.stringify(projected).includes("DO_NOT_PASS"));
  rpcError = { message: "SECRET_RPC_DIAGNOSTIC" };
  const html = renderToStaticMarkup(await QboIntelligenceDiagnostic({ workspaceId: ids.workspace }));
  assert.match(html, /Coverage and counts are unknown/);
  assert.doesNotMatch(html, /SECRET_RPC|Stored sources|<dd/); rpcError = null;
  redirect = true;
  await assert.rejects(() => QboIntelligenceDiagnostic({ workspaceId: ids.workspace }), /AUTH_REDIRECT/);
  redirect = false;
});

test("Intelligence page integrates the isolated gated diagnostic without supplying it to economic, evidence, snapshot or model producers", () => {
  const ts = require("typescript");
  const text = fs.readFileSync(path.join(root, "app/app/intelligence/page.tsx"), "utf8");
  assert.match(text, /qboProductionCustomerConnectionsEnabled\(\) && context.membership\?\.role === "owner"\s*\? <QboIntelligenceDiagnostic workspaceId=\{workspaceId\}/);
  const file = ts.createSourceFile("intelligence.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const occurrences = [];
  const visit = node => {
    if (ts.isCallExpression(node) && /build|loadWorkspaceIntelligenceBriefing|trySeal/.test(node.expression.getText(file))) {
      assert.doesNotMatch(node.arguments.map(argument => argument.getText(file)).join(" "), /qbo|Qbo|QuickBooks/);
      occurrences.push(node.expression.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file); assert(occurrences.includes("buildIntelligenceSnapshotFromProducersV1"));
  const diagnostic = fs.readFileSync(path.join(root, "lib/integrations/qbo-customer/intelligence-diagnostic.tsx"), "utf8");
  assert.doesNotMatch(diagnostic, /EvidenceCandidate|generateText|generateObject|fetch\(|\.from\(|createSupabaseAdminClient/);
  const settings = fs.readFileSync(path.join(root, "app/app/settings/page.tsx"), "utf8");
  assert.match(settings, /context.membership\?\.role === "owner"[\s\S]*?href="\/app\/settings\/integrations\/quickbooks\/data"/);
  const settingsFile = ts.createSourceFile("settings.tsx", settings, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const panels = [];
  const inspect = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(settingsFile) === "ConnectionStatusPanel") {
      panels.push(node.attributes.properties.find(attribute => attribute.name?.getText(settingsFile) === "canManage")?.initializer?.getText(settingsFile));
    }
    ts.forEachChild(node, inspect);
  };
  inspect(settingsFile); assert.deepEqual(panels, ['{context.membership?.role === "owner"}']);
  assert.match(settings, /const canManage = \["owner", "admin", "manager"\]\.includes/);
});
