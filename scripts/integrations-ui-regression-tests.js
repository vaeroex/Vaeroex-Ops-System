const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { root, harness, connection, loadSource, React, renderToStaticMarkup } = require("./integrations-ui-test-support");

const landing = "app/app/integrations/page.tsx";
const management = "app/app/settings/integrations/quickbooks/page.tsx";

test("only database-confirmed unconsented attempts offer cancellation on either management page", async () => {
  const { canOfferPendingCancellation } = loadSource("lib/integrations/control-plane/customer-status.ts");
  for (const status of ["pending_authorization", "error"]) {
    assert.equal(canOfferPendingCancellation({ ...connection(status), granted_scopes: [] }), false);
    assert.equal(canOfferPendingCancellation({ ...connection(status), can_cancel_pending: false }), false);
    assert.equal(canOfferPendingCancellation({ ...connection(status), can_cancel_pending: true }), true);
    for (const page of [management, "app/app/settings/integrations/quickbooks/disconnect/page.tsx"]) {
      const h = harness({ connections: [connection(status)], cancellations: [{ connection_id: "connection-a", can_cancel: true }] });
      assert.match(await h.render(page), /Cancel attempt/);
      assert.deepEqual(h.calls.filter(call => call === "cancellation-eligibility"), ["cancellation-eligibility"]);
      for (const options of [
        { cancellations: [{ connection_id: "connection-a", can_cancel: false }] },
        { cancellations: [] },
        { cancellations: [{ connection_id: "other-connection", can_cancel: true }] },
        { cancellations: [{ connection_id: "connection-a", can_cancel: "true" }] },
        { cancellations: [{ connection_id: "connection-a", can_cancel: true }], cancellationError: true }
      ]) {
        const denied = await harness({ connections: [connection(status)], ...options }).render(page);
        assert.doesNotMatch(denied, /Cancel attempt|private eligibility error/);
      }
    }
  }
  assert.equal(canOfferPendingCancellation({ ...connection("active"), can_cancel_pending: true }), false);
});

test("disabled integration gates skip provider queries; QBO management fails before workspace access", async () => {
  const h = harness({ qboEnabled: false, squareEnabled: false });
  const html = await h.render(landing);
  assert.match(html, /No integrations are available/);
  assert.doesNotMatch(html, /Connect QuickBooks|Manage QuickBooks|Connect Square|Manage Square/);
  assert.deepEqual(h.queries, []);
  assert.deepEqual(h.calls, ["workspace"]);
  await assert.rejects(h.render(management), /NOT_FOUND/);
  assert.deepEqual(h.calls, ["workspace"]);
  assert.equal(await h.load("app/app/integrations/_qbo.ts").readQuickBooksStatus({}), null);
});

test("Settings provides one Integrations entry without fetching provider data or rendering connection details", async () => {
  const h = harness();
  const html = await h.render("app/app/settings/page.tsx");
  assert.match(html, /href="\/app\/integrations"/);
  assert.doesNotMatch(html, /businessEntityId|\/api\/integrations\/|Synthetic company/);
  assert.deepEqual(h.queries, []);
  assert.deepEqual(h.calls, ["workspace"]);
});

test("provider cards are consistent links to management, never Connect forms", async () => {
  const h = harness();
  const html = await h.render(landing);
  assert.equal((html.match(/<article /g) || []).length, 2);
  assert.equal((html.match(/Not connected/g) || []).length, 2);
  assert.match(html, /href="\/app\/settings\/integrations\/square"/);
  assert.match(html, /href="\/app\/settings\/integrations\/quickbooks"/);
  assert.match(html, /Connect Square/);
  assert.match(html, /Connect QuickBooks/);
  assert.doesNotMatch(html, /<form|\/api\/integrations\/|businessEntityId/);
  assert.equal(h.calls.filter(call => call === "square").length, 1);
  assert.deepEqual(h.queries.map(query => query.table), ["integration_connection_summaries"]);
});

test("QBO reads use the authenticated tenant, production provider, and only that tenant's connection IDs", async () => {
  for (const workspaceId of ["workspace-a", "workspace-b"]) {
    const h = harness({ workspaceId, connections: [connection()], freshness: [
      { connection_id: "connection-a", scope_key: "accounting", status: "current", last_successful_sync_at: null, calculated_at: "2026-10-01T00:00:00Z" }
    ] });
    assert.match(await h.render(landing), />Current</);
    assert.deepEqual(h.queries.map(query => query.table), ["integration_connection_summaries", "integration_freshness_summaries"]);
    assert(h.queries[0].calls.some(call => call[0] === "not" && call[1] === "status" && call[3] === '("deleted","disconnected")'));
  }
});

test("overview reuses the canonical QBO status projection, including pending states", async () => {
  const { customerConnectionStatus } = loadSource("lib/integrations/control-plane/customer-status.ts");
  for (const status of ["pending_authorization", "authorized_unmapped", "initializing", "reauthorization_required", "error", "disconnecting"]) {
    const row = connection(status);
    const html = await harness({ connections: [row] }).render(landing);
    assert(html.includes(customerConnectionStatus(row, []).status));
    assert.match(html, /Manage QuickBooks/);
    assert.doesNotMatch(html, /Synthetic company|Connect QuickBooks|businessEntityId/);
  }
});

test("query failures remain unknown, with no false disconnected state or exposed errors", async () => {
  for (const errorTable of ["integration_connection_summaries", "integration_freshness_summaries"]) {
    const h = harness({ errorTable, connections: [connection()], square: null });
    const html = await h.render(landing);
    assert.equal((html.match(/Status unavailable/g) || []).length, 2);
    assert.doesNotMatch(html, /Not connected|Connect QuickBooks|Connect Square|private database error/);
    const details = await h.render(management);
    assert.match(details, /QuickBooks connection status is unavailable/);
    assert.doesNotMatch(details, /No QuickBooks company is connected|name="businessEntityId"/);
  }
});

test("non-owner roles never read Square or business entities or receive connection mutation controls", async () => {
  for (const role of ["admin", "manager", "member", "viewer", null]) {
    const h = harness({ role, connections: [connection("reauthorization_required")] });
    const html = await h.render(landing);
    assert.doesNotMatch(html, /Connect QuickBooks|Connect Square|Manage Square/);
    assert.match(html, /Manage QuickBooks/);
    const details = await h.render(management);
    assert.match(details, /Synthetic company/);
    assert.doesNotMatch(details, /<form|businessEntityId|Accounting authority/);
    assert(!h.calls.includes("square"));
    assert(!h.calls.includes("cancellation-eligibility"));
    assert(!h.queries.some(query => query.table === "business_entities"));
    for (const status of ["pending_authorization", "error"]) {
      const pending = harness({ role, connections: [connection(status)],
        cancellations: [{ connection_id: "connection-a", can_cancel: true }] });
      for (const page of [management, "app/app/settings/integrations/quickbooks/disconnect/page.tsx"]) {
        const html = await pending.render(page);
        assert.match(html, /Synthetic company/);
        assert.doesNotMatch(html, /Cancel attempt|<form/);
      }
      assert(!pending.calls.includes("cancellation-eligibility"));
    }
  }
});

test("management retains the real panel and owner entity selector, data and accounting links", async () => {
  const h = harness({ connections: [connection()] });
  const html = await h.render(management);
  assert.match(html, /Synthetic company/);
  assert.match(html, /name="businessEntityId"/);
  assert.match(html, /Connect QuickBooks/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*?Connect QuickBooks<\/button>/);
  assert.match(html, /href="\/app\/settings\/integrations\/quickbooks\/data"/);
  assert.match(html, /href="\/app\/settings\/integrations\/quickbooks\/accounting"/);
  assert.match(html, /aria-label="Back to integrations"/);
  assert.equal(h.queries.filter(query => query.table === "business_entities").length, 1);
});

test("management displays only allowlisted native cancellation feedback", async () => {
  const h = harness();
  const render = params => h.render(management, { searchParams: Promise.resolve(params) });
  assert.match(await render({ result: "cancelled" }), /The QuickBooks connection attempt was cancelled/);
  assert.match(await render({ error: "cancel_failed" }), /This QuickBooks attempt could not be cancelled/);
  for (const params of [{ result: "private-sentinel", error: "private-sentinel" }, { result: ["cancelled"], error: ["cancel_failed"] }, {}]) {
    assert.doesNotMatch(await render(params), /private-sentinel|connection attempt was cancelled|attempt could not be cancelled/);
  }
});

test("Sandbox details move to management with the same authorized evidence reader and no added role access", async () => {
  const time = "2026-10-01T00:00:00Z";
  const squareEvidence = { version: "square_workspace_evidence_v1", source: "Square Sandbox", status: "verified_non_economic",
    policy: "square_canonical_interpretation_v1", counts: { payment: 1, refund: 0, order: 0, catalog: 0, inventory: 0 },
    relationships: { unresolvedLocation: 0, conflict: 0, idMatch: 0, otherUncertain: 0 }, historical: "unknown", economic: "blocked",
    checkpointRevision: 1, interpretedAt: time, lastObservedAt: time, checkedAt: time, syncStatus: "unknown",
    provenance: [{ kind: "payment", sourceVersion: 1, observedAt: time, scope: "mapped_location_or_explicitly_unresolved" }] };
  const sandbox = "app/app/integrations/square/page.tsx";
  for (const role of ["owner", "admin", "manager", "member", "viewer"]) {
    const h = harness({ role, qboEnabled: false, squareEnabled: false, squareEvidence });
    const html = await h.render(landing);
    assert.match(html, /href="\/app\/integrations\/square"/);
    assert.doesNotMatch(html, /Source-version provenance|Interpretation checkpoint|<table|No integrations are available/);
    const details = await h.render(sandbox);
    assert.match(details, /Source-version provenance|Interpretation checkpoint/);
    assert.doesNotMatch(details, /<form|\/api\/integrations\//);
    await assert.rejects(harness({ role, qboEnabled: false, squareEnabled: false }).render(sandbox), /NOT_FOUND/);
  }
});

test("desktop/mobile navigation marks Integrations active for both providers and Settings remains separate", () => {
  const shell = fs.readFileSync(path.join(root, "components/app/AppShell.tsx"), "utf8");
  assert.match(shell, /href: "\/app\/integrations", label: "Integrations"/);
  assert.match(shell, /<AppNavigation sections=\{navSections\} \/>/);
  assert.match(shell, /<AppNavigation sections=\{navSections\} mobile \/>/);
  const nav = loadSource("lib/presentation/app-navigation.ts");
  const items = [{ href: "/app/integrations", label: "Integrations" }, { href: "/app/settings", label: "Settings" }];
  for (const pathname of ["/app/integrations", "/app/settings/integrations/quickbooks", "/app/settings/integrations/quickbooks/data", "/app/settings/integrations/square"]) {
    const h = harness({ pathname });
    const { AppNavigation } = h.load("components/app/AppNavigation.tsx");
    for (const mobile of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(AppNavigation, { mobile, sections: [{ label: "Primary", collapsible: false, items }] }));
      assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
      assert.match(html, /href="\/app\/integrations" aria-current="page"/);
    }
    assert.equal(nav.currentWorkspaceDestination(pathname, items).label, "Integrations");
  }
  assert.equal(nav.workspacePageTitle("/app/settings/integrations/quickbooks/data", items), "QuickBooks Online");
  assert.equal(nav.workspacePageTitle("/app/settings/integrations/square", items), "Square");
  assert.equal(nav.isWorkspacePathActive("/app/settings", "/app/integrations"), false);
  assert.equal(nav.isWorkspacePathActive("/app/settings", "/app/settings"), true);
  assert.equal(nav.isWorkspacePathActive("/app/integrations-other", "/app/integrations"), false);
});
