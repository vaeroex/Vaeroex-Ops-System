/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS harness executes the actual TypeScript consumers. */
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSource, React, renderToStaticMarkup } = require("./integrations-ui-test-support");

const { squareResultEvidence, squareResultVisibility } = loadSource("lib/integrations/square-direct/result-visibility.ts");
const { googleSheetsResultEvidence, googleSheetsResultVisibility } = loadSource("lib/integrations/google-sheets/result-visibility.ts");
const { integrationResultVisibility } = loadSource("lib/integrations/control-plane/result-visibility.ts");
const link = { __esModule: true, default: ({ children, ...props }) => {
  delete props.prefetch;
  return React.createElement("a", props, children);
} };
const { SquareSheetsResultsView } = loadSource("components/integrations/SquareSheetsResultsView.tsx", { "next/link": link });
const oldSync = "2020-01-01T01:00:00Z";
const squareAttempt = { connectionId: "square-attempt", businessEntityId: "entity-a", state: "consent_pending", sellerLabel: null,
  locations: [], locationId: null, lastSyncedAt: null, lastCompletedRead: null, lastError: null, activeRead: null,
  hasMore: false, revocationPending: false, recoveryRequired: false, payments: [] };
const sheetAttempt = { id: "sheet-attempt", display_name: "Daily operations", status: "pending_authorization", credential_version: 0,
  spreadsheet_id: null, active_approval_id: null, last_sync_at: null, last_sync_fact_count: 0,
  last_error_code: null, revocation_pending: false, authorization_uncertain: false };
const connectedSquare = { ...squareAttempt, state: "connected", sellerLabel: "North business", locationId: "location-a" };
const connectedSheet = { ...sheetAttempt, status: "connected", credential_version: 1, active_approval_id: "approval-a" };

function result(provider, connection, key = "connection") {
  const evidence = provider === "Square" ? squareResultEvidence(connection) : googleSheetsResultEvidence(connection);
  return { key, provider, label: "North business", href: "/app/integrations", hasImportedData: evidence.hasImportedData,
    visibility: integrationResultVisibility(evidence) };
}
const render = results => renderToStaticMarkup(React.createElement(SquareSheetsResultsView, { results }));

test("Square attempts never become business panels from status, staging, or lease expiry", () => {
  for (const state of ["consent_pending", "exchanging", "retry_required", "reauthorization_required", "disconnected", "connected"]) {
    const connection = { ...squareAttempt, state, lastError: state === "reauthorization_required" ? state : null,
      credentialVersion: 1, merchantId: "staged-only" };
    assert.equal(squareResultVisibility(connection).visible, false);
    assert.equal(render([result("Square", connection)]), "");
  }
  assert.equal(squareResultVisibility({ ...squareAttempt, recoveryRequired: true }).requiresReconnect, false);
});

test("Sheets first consent declined, failed, expired, or recovered stays invisible", () => {
  for (const status of ["pending_authorization", "reauthorization_required", "disconnected", "connected"]) {
    const connection = { ...sheetAttempt, status, generation: 4, last_error_code: "authorization_required" };
    assert.equal(googleSheetsResultVisibility(connection).visible, false);
    assert.equal(render([result("Google Sheets", connection)]), "");
  }
  assert.equal(googleSheetsResultVisibility({ ...sheetAttempt, authorization_uncertain: true }).visible, false);
});

test("successful connections awaiting their first import show concise status without zero metrics", () => {
  for (const [provider, connection] of [["Square", connectedSquare], ["Google Sheets", connectedSheet]]) {
    const html = render([result(provider, connection)]);
    assert.match(html, /Connected\. A completed sync has not been recorded yet/);
    assert.doesNotMatch(html, /Reconnect|Last successful import|>0(?:\s|<)|coverage|validation|technical|entity-a/i);
  }
  assert.match(render([result("Square", { ...connectedSquare, state: "mapping_required" })]), /Finish setup in Integrations/);
});

test("actual access failures warn only with historical eligibility and persisted authorization failure", () => {
  const square = { ...connectedSquare, state: "reauthorization_required", lastError: "reauthorization_required" };
  const sheet = { ...connectedSheet, status: "reauthorization_required" };
  for (const [provider, connection] of [["Square", square], ["Google Sheets", sheet]]) {
    const html = render([result(provider, connection)]);
    assert.match(html, /Reconnect to resume imports/);
    assert.match(html, /role="status"/);
    assert.match(html, /Review (Square|Google Sheets) access/);
  }
  assert.equal(squareResultVisibility({ ...square, lastError: null }).requiresReconnect, false);
  assert.equal(squareResultVisibility({ ...square, recoveryRequired: true }).requiresReconnect, false);
});

test("old sync timestamps and transient failures never turn into reauthorization", () => {
  for (const [provider, connection] of [
    ["Square", { ...connectedSquare, lastSyncedAt: oldSync }],
    ["Square", { ...connectedSquare, lastSyncedAt: oldSync, state: "retry_required", lastError: "retry_required" }],
    ["Google Sheets", { ...connectedSheet, last_sync_at: oldSync }],
    ["Google Sheets", { ...connectedSheet, last_sync_at: oldSync, last_error_code: "provider_request_failed" }]
  ]) {
    const html = render([result(provider, connection)]);
    assert.match(html, /Last successful import/);
    assert.doesNotMatch(html, /Reconnect|Review .* access/);
  }
});

test("declining a replacement Sheets consent retains history without claiming the old access just expired", () => {
  const connection = { ...sheetAttempt, status: "reauthorization_required", last_sync_at: oldSync,
    last_sync_fact_count: 12, spreadsheet_id: "previous-sheet", generation: 2 };
  assert.equal(googleSheetsResultVisibility(connection).visible, true);
  assert.equal(googleSheetsResultVisibility(connection).requiresReconnect, false);
  assert.match(render([result("Google Sheets", connection)]), /Finish setup in Integrations/);
});

test("intentional disconnect retains historical presentation without resurrecting active results", () => {
  const html = render([
    result("Square", { ...connectedSquare, state: "disconnected", paymentCount: 4, lastSyncedAt: oldSync }, "square-old"),
    result("Google Sheets", { ...connectedSheet, status: "disconnected", last_sync_at: oldSync, last_sync_fact_count: 5 }, "sheet-old")
  ]);
  assert.equal((html.match(/Disconnected\. New imports are stopped\. Saved data is retained\./g) ?? []).length, 2);
  assert.doesNotMatch(html, /Reconnect|>[45]\s+(?:saved )?(?:Payments|metrics)/);
  assert.match(html, /View saved Payments/);
  assert.match(html, /these are not accounting totals/);
});

test("historical-only Square reads preserve their own completion time without inventing a checkpoint", () => {
  const historical = { ...connectedSquare, lastCompletedRead: { start: "2020-01-01T00:00:00Z", end: "2020-01-02T00:00:00Z",
    kind: "created", completedAt: oldSync }, paymentCount: 1 };
  const evidence = squareResultEvidence(historical);
  assert.equal(evidence.lastSuccessfulSyncAt, oldSync);
  assert.equal(evidence.freshness, "unknown");
  assert.equal(historical.lastSyncedAt, null);
  assert.match(render([result("Square", historical)]), /Last successful import/);
});

test("legitimate connections keep distinct rows and imported values are never summed", () => {
  const rows = [result("Square", { ...connectedSquare, paymentCount: 5 }, "square-a"),
    result("Square", { ...connectedSquare, sellerLabel: "Another company", paymentCount: 9 }, "square-b"),
    result("Google Sheets", { ...connectedSheet, last_sync_at: oldSync, last_sync_fact_count: 8 }, "sheet-a")];
  const html = render(rows);
  assert.equal((html.match(/<li /g) ?? []).length, 3);
  assert.doesNotMatch(html, />(?:14|22|0)(?:\s|<)|entity-a|approval-a/);
});

function loaderFixture({ owner = true, squareEnabled = true, sheetsEnabled = true, square = null, sheets = [], sheetsError = null } = {}) {
  const calls = [];
  const supabase = { from(table) {
    assert.equal(table, "google_sheets_connections", "presentation never reads or republishes archived KPI observations");
    const query = { select(fields) { assert.doesNotMatch(fields, /token|ciphertext|\*/); calls.push(["select", fields]); return query; },
      eq(key, value) { assert.equal(key, "workspace_id"); assert.equal(value, "workspace-a"); calls.push(["workspace", value]); return query; },
      order() { return query; }, then(resolve) { return Promise.resolve({ data: sheets, error: sheetsError }).then(resolve); } };
    return query;
  } };
  const api = loadSource("components/integrations/SquareSheetsResults.tsx", {
    "next/link": link,
    "@/lib/integrations/square-direct/server": { squareDirectEnabled: () => squareEnabled,
      squareDirectPayments: async (query, expectedWorkspaceId) => {
        assert.equal(owner, true); assert.deepEqual(query, {}); assert.equal(expectedWorkspaceId, "workspace-a");
        calls.push(["saved-square", expectedWorkspaceId]); return square;
      },
      squareSettingsPath: "/app/settings/integrations/square" },
    "@/lib/integrations/google-sheets/server": { sheetsEnabled: () => sheetsEnabled }
  });
  return { calls, load: () => api.loadSquareSheetsResults({ supabase, workspaceId: "workspace-a", isOwner: owner }) };
}

test("business loader uses tenant-scoped read-only summaries and all saved Square connection options", async () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ connectionId: `history-${i}`, businessEntityLabel: "North business",
    sellerLabel: "North seller", locationLabel: "North", state: "disconnected", paymentCount: 1 }));
  const pending = { ...squareAttempt, businessEntityLabel: "North business", locationLabel: null, paymentCount: 0 };
  const fixture = loaderFixture({ square: { connections: [pending, ...history], currentConnection: squareAttempt },
    sheets: [sheetAttempt, { ...connectedSheet, id: "connected-sheet" }] });
  const rows = await fixture.load();
  assert.equal(rows.length, 41);
  assert.equal(rows.some(row => row.key.includes("attempt")), false);
  assert.deepEqual(fixture.calls.filter(([name]) => name === "saved-square"), [["saved-square", "workspace-a"]]);
  assert.equal(fixture.calls.filter(([name]) => name === "workspace").length, 1);
});

test("non-owners never invoke Square's owner-only reader; disabled and failed queries stay silent", async () => {
  const viewer = loaderFixture({ owner: false, sheets: [connectedSheet] });
  assert.equal((await viewer.load()).length, 1);
  assert.equal(viewer.calls.some(([name]) => name === "saved-square"), false);
  const disabled = loaderFixture({ squareEnabled: false, sheetsEnabled: false });
  assert.deepEqual(await disabled.load(), []);
  assert.equal(disabled.calls.length, 0);
  assert.deepEqual(await loaderFixture({ sheets: [connectedSheet], sheetsError: { message: "private diagnostic" } }).load(), []);
});

test("Square never-completed detail stays concise while completed empty reads retain coverage", () => {
  const { SquareDirectCustomerPanel } = loadSource("components/integrations/SquareDirectCustomerPanel.tsx", { "next/link": link });
  const view = { available: true, historyAvailable: true, businessEntities: [], connections: [squareAttempt] };
  const html = renderToStaticMarkup(React.createElement(SquareDirectCustomerPanel, { view }));
  assert.match(html, /Square setup has not completed/);
  assert.doesNotMatch(html, /0 matching|No completed search dates|Search coverage|Last successful update|Filter saved Payments/);
  const old = { ...connectedSquare, state: "disconnected", lastCompletedRead: { start: oldSync, end: "2020-01-02T01:00:00Z", kind: "created", completedAt: oldSync } };
  const completed = renderToStaticMarkup(React.createElement(SquareDirectCustomerPanel, { view: { ...view, connections: [old] }, browseConnectionId: old.connectionId }));
  assert.match(completed, /last completed search checked/);
});

test("Sheets failed-consent detail preserves setup controls without zero-sync diagnostics", async () => {
  const connection = { ...sheetAttempt, status: "reauthorization_required", tabs: [], headers: [], field_mapping: null,
    sync_lease_expires_at: null, oauth_lease_expires_at: null, last_sync_rejected_count: 0, last_sync_conflict_count: 0 };
  const query = table => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    then(resolve) { return Promise.resolve({ data: table === "google_sheets_connections" ? [connection] : [], error: null }).then(resolve); } });
  const { default: Page } = loadSource("app/app/settings/integrations/google-sheets/page.tsx", {
    "next/link": link,
    "@/lib/integrations/google-sheets/server": { sheetsEnabled: () => true },
    "@/lib/workspaces/page-context": { requireWorkspacePage: async () => ({ context: { membership: { role: "owner" } }, workspaceId: "workspace-a", supabase: { from: query } }) },
    "@/components/operations/PageHeader": { PageHeader: ({ title }) => React.createElement("h1", null, title) }
  });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  assert.match(html, /Authorization not completed/);
  assert.match(html, /No spreadsheet data has been imported/);
  assert.match(html, /action="\/api\/integrations\/google-sheets\/reconnect"/);
  assert.doesNotMatch(html, /Never synced|Last successful sync|Rows read|Validated metrics|Reauthorization required/);
});
