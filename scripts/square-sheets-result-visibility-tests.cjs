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
const oldSync = "2020-01-01T01:00:00Z";
const squareAttempt = { connectionId: "square-attempt", businessEntityId: "entity-a", state: "consent_pending", sellerLabel: null,
  locations: [], locationId: null, lastSyncedAt: null, lastCompletedRead: null, lastError: null, activeRead: null,
  hasMore: false, revocationPending: false, recoveryRequired: false, payments: [] };
const sheetAttempt = { id: "sheet-attempt", display_name: "Daily operations", status: "pending_authorization", credential_version: 0,
  spreadsheet_id: null, active_approval_id: null, last_sync_at: null, last_sync_fact_count: 0,
  last_error_code: null, revocation_pending: false, authorization_uncertain: false };
const connectedSquare = { ...squareAttempt, state: "connected", sellerLabel: "North business", locationId: "location-a" };
const connectedSheet = { ...sheetAttempt, status: "connected", credential_version: 1, active_approval_id: "approval-a" };

// Provider eligibility remains shared by the active dashboard and detail surfaces.
// Rendering and loader contracts now execute CurrentIntegrations/dashboard/server
// in current-integrations-tests.cjs; the replaced result-strip pair is removed.
function visibility(provider, connection) {
  return integrationResultVisibility(provider === "Square" ? squareResultEvidence(connection) : googleSheetsResultEvidence(connection));
}

test("Square attempts never become business panels from status, staging, or lease expiry", () => {
  for (const state of ["consent_pending", "exchanging", "retry_required", "reauthorization_required", "disconnected", "connected"]) {
    const connection = { ...squareAttempt, state, lastError: state === "reauthorization_required" ? state : null,
      credentialVersion: 1, merchantId: "staged-only" };
    assert.equal(squareResultVisibility(connection).visible, false);
  }
  assert.equal(squareResultVisibility({ ...squareAttempt, recoveryRequired: true }).requiresReconnect, false);
});

test("Sheets first consent declined, failed, expired, or recovered stays invisible", () => {
  for (const status of ["pending_authorization", "reauthorization_required", "disconnected", "connected"]) {
    const connection = { ...sheetAttempt, status, generation: 4, last_error_code: "authorization_required" };
    assert.equal(googleSheetsResultVisibility(connection).visible, false);
  }
  assert.equal(googleSheetsResultVisibility({ ...sheetAttempt, authorization_uncertain: true }).visible, false);
});

test("successful connections awaiting their first import show concise status without zero metrics", () => {
  for (const [provider, connection] of [["Square", connectedSquare], ["Google Sheets", connectedSheet]]) {
    const state = visibility(provider, connection);
    assert.match(state.status, /Connected\. A completed sync has not been recorded yet/);
    assert.equal(state.lastSuccessfulSyncAt, null);
    assert.equal(state.requiresReconnect, false);
  }
  assert.match(visibility("Square", { ...connectedSquare, state: "mapping_required" }).status, /Finish setup in Integrations/);
});

test("actual access failures warn only with historical eligibility and persisted authorization failure", () => {
  const square = { ...connectedSquare, state: "reauthorization_required", lastError: "reauthorization_required" };
  const sheet = { ...connectedSheet, status: "reauthorization_required" };
  for (const [provider, connection] of [["Square", square], ["Google Sheets", sheet]]) {
    const state = visibility(provider, connection);
    assert.equal(state.requiresReconnect, true);
    assert.match(state.status, /Reconnect to resume imports/);
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
    const state = visibility(provider, connection);
    assert.equal(state.lastSuccessfulSyncAt, oldSync);
    assert.equal(state.requiresReconnect, false);
  }
});

test("declining a replacement Sheets consent retains history without claiming the old access just expired", () => {
  const connection = { ...sheetAttempt, status: "reauthorization_required", last_sync_at: oldSync,
    last_sync_fact_count: 12, spreadsheet_id: "previous-sheet", generation: 2 };
  assert.equal(googleSheetsResultVisibility(connection).visible, true);
  assert.equal(googleSheetsResultVisibility(connection).requiresReconnect, false);
  assert.match(visibility("Google Sheets", connection).status, /Finish setup in Integrations/);
});

test("intentional disconnect retains historical presentation without resurrecting active results", () => {
  for (const [provider, connection] of [
    ["Square", { ...connectedSquare, state: "disconnected", paymentCount: 4, lastSyncedAt: oldSync }],
    ["Google Sheets", { ...connectedSheet, status: "disconnected", last_sync_at: oldSync, last_sync_fact_count: 5 }]
  ]) {
    const state = visibility(provider, connection);
    assert.equal(state.visible, true);
    assert.equal(state.requiresReconnect, false);
    assert.equal(state.status, "Disconnected. New imports are stopped. Saved data is retained.");
  }
});

test("historical-only Square reads preserve their own completion time without inventing a checkpoint", () => {
  const historical = { ...connectedSquare, lastCompletedRead: { start: "2020-01-01T00:00:00Z", end: "2020-01-02T00:00:00Z",
    kind: "created", completedAt: oldSync }, paymentCount: 1 };
  const evidence = squareResultEvidence(historical);
  assert.equal(evidence.lastSuccessfulSyncAt, oldSync);
  assert.equal(evidence.freshness, "unknown");
  assert.equal(historical.lastSyncedAt, null);
  assert.equal(visibility("Square", historical).lastSuccessfulSyncAt, oldSync);
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
