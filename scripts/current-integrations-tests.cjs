/* eslint-disable @typescript-eslint/no-require-imports -- Offline contract tests with forbidden live I/O. */
const test = require("node:test"), assert = require("node:assert/strict");
const { loadSource, React, renderToStaticMarkup } = require("./integrations-ui-test-support");
const { integrationDashboardStatus, selectLogicalConnections, dashboardTimestamp, IntegrationDashboardSchema } = loadSource("lib/integrations/dashboard/model.ts");
const link = { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
const { CurrentIntegrations } = loadSource("components/integrations/CurrentIntegrations.tsx", { "next/link": link });
const workspaceId = "10000000-0000-4000-8000-000000000001";
const now = "2026-10-02T18:05:00.000Z";
const entry = (overrides = {}) => ({ key: `square:${"a".repeat(64)}`, provider: "Square", name: "Example company",
  href: "/app/settings/integrations/square", connectionState: "connected", lastSuccessfulRefreshAt: "2026-10-02T18:00:00.000Z",
  currentUntil: "2026-10-02T18:15:00.000Z", freshness: "current", unchangedCheck: false,
  cadence: "Automatic checks every 15 minutes.", hidden: false,
  results: [{ label: "Approved result", value: "USD 125.20", period: "2026-09-01 to 2026-09-30", href: "/app/integrations", limitation: "Partial coverage." }], ...overrides });
const dashboard = entries => ({ workspaceId, observedAt: now, timeZone: "America/Los_Angeles", timeZoneConfirmed: true, preferencesAvailable: true, entries, unavailable: [] });
const render = entries => renderToStaticMarkup(React.createElement(CurrentIntegrations, { initial: dashboard(entries) }));

test("current and confirmed unchanged checks are separate from missing data", () => {
  assert.equal(integrationDashboardStatus(entry(), now).label, "Up to date");
  assert.equal(integrationDashboardStatus(entry({ unchangedCheck: true }), now).label, "Up to date - no new data since the last successful check");
  const empty = render([entry({ results: [] })]);
  assert.match(empty, /No validated business results/);
  assert.doesNotMatch(empty, /no new data|USD 0|zero activity/);
});
test("cadence expiry makes values last-known, not current or a reauthorization request", () => {
  const stale = entry({ currentUntil: "2026-10-02T18:04:59.000Z" });
  assert.deepEqual(integrationDashboardStatus(stale, now), { label: "Stale", current: false, tone: "warning" });
  const html = render([stale]);
  assert.match(html, /Last-known values, not included in current totals/);
  assert.match(html, /USD 125.20/); assert.match(html, /Last successful refresh/);
  assert.doesNotMatch(html, /Reconnect required|>Up to date</);
});
test("first import, manual refresh, expired access and explicit disconnect remain distinct", () => {
  assert.equal(integrationDashboardStatus(entry({ lastSuccessfulRefreshAt: null, results: [] }), now).label, "Awaiting first successful import");
  assert.equal(integrationDashboardStatus(entry({ currentUntil: null, freshness: "unknown" }), now).label, "Last-known data");
  assert.equal(integrationDashboardStatus(entry({ connectionState: "reauthorization_required" }), now).label, "Reconnect required");
  assert.equal(integrationDashboardStatus(entry({ connectionState: "disconnected" }), now).label, "Disconnected");
});
test("all-disconnected shows only compact reconnect entries, never values or historical coverage", () => {
  const html = render([entry({ connectionState: "disconnected" })]);
  assert.match(html, /No active integrations/); assert.match(html, /Previously connected/);
  assert.match(html, /Hide from this page/); assert.match(html, /Reconnect/); assert.match(html, /Manage integrations/);
  assert.doesNotMatch(html, /USD 125.20|Approved result|2026-09-01|Partial coverage|Last successful refresh/);
});
test("hidden history can be restored and a hidden preference cannot hide a connected company", () => {
  const hidden = render([entry({ connectionState: "disconnected", hidden: true })]);
  assert.doesNotMatch(hidden, /Previously connected/); assert.match(hidden, /Hidden integrations \(1\)/); assert.match(hidden, /Restore/);
  const reconnected = render([entry({ hidden: true })]);
  assert.match(reconnected, /Approved result/); assert.doesNotMatch(reconnected, /Hidden integrations|No active integrations/);
});
test("no established connections renders no provider-specific notice or discovery cards", () => {
  const html = render([]);
  assert.match(html, /No active integrations/); assert.doesNotMatch(html, /QuickBooks|Square|Google Sheets|Reconnect|coverage/);
});
test("logical grouping selects an attempt without combining values, labels are never identity", () => {
  const old = { ...entry({ connectionState: "disconnected" }), createdAt: "2026-09-01", connectionId: "old", hasImportedData: true, amount: "10" };
  const failed = { ...old, connectionId: "new", createdAt: "2026-10-01", hasImportedData: false, lastSuccessfulRefreshAt: null, amount: "20" };
  assert.deepEqual(selectLogicalConnections([failed, old]), [old]);
  const active = { ...failed, connectionState: "connected" };
  assert.deepEqual(selectLogicalConnections([old, active]), [active]);
  assert.equal(selectLogicalConnections([old, { ...old, key: `square:${"b".repeat(64)}`, connectionId: "different-company" }]).length, 2);
  assert.equal(selectLogicalConnections([old, { ...old, key: `square:${"c".repeat(64)}`, connectionId: "different-location" }]).length, 2);
});
test("refresh timestamps use explicit workspace timezone without changing reporting dates", () => {
  assert.match(dashboardTimestamp(now, "America/Los_Angeles"), /11:05 AM PDT/);
  assert.match(render([entry()]), /2026-09-01 to 2026-09-30/);
  assert.throws(() => IntegrationDashboardSchema.parse({ ...dashboard([]), timeZone: "Untrusted/Zone" }));
});

function loaderFixture({ squares = [], sheets = [], kpis = [], preferences = [], qbo = { state: "hidden" }, qboMetadata = [] } = {}) {
  const calls = [], user = { id: "10000000-0000-4000-8000-000000000002" };
  const supabase = { from(table) {
    assert.equal(table, "google_sheets_connections", "only readonly metadata table");
    const filters = [];
    const query = { select(fields) { assert.doesNotMatch(fields, /ciphertext|token|secret|\*/); return this; }, eq(...args) { filters.push(args); return this; }, order() { return this; }, limit() { return this; },
      then(resolve) { assert(filters.some(([key, value]) => key === "workspace_id" && value === workspaceId));
        return Promise.resolve({ data: sheets, error: null }).then(resolve); } };
    return query;
  }, async rpc(name, args) { assert.equal(name, "read_qbo_dashboard_metadata_v1"); assert.deepEqual(args, { p_workspace_id: workspaceId });
    calls.push("qbo-saved-metadata"); return { data: qboMetadata, error: null }; } };
  const api = loadSource("lib/integrations/dashboard/server.ts", {
    "@/lib/security/require-workspace-access": {},
    "@/lib/integrations/qbo-customer/accounting-intelligence-server": { loadQboAccountingIntelligence: async () => qbo },
    "@/lib/integrations/square-direct/server": { squareSettingsPath: "/app/settings/integrations/square", squareDirectEnabled: () => true,
      squareDirectPayments: async (query, expected) => { assert.deepEqual(query, {}); assert.equal(expected, workspaceId); calls.push("stored-payments"); return { connections: squares, currentConnection: null }; } },
    "@/lib/integrations/google-sheets/server": { sheetsEnabled: () => true },
    "@/lib/kpis/load-workspace-kpis": {}, "@/lib/intelligence/source-parent-eligibility": {},
    "./preferences-server": { readIntegrationSummaryPreferences: async access => {
      assert.equal(access.user.id, user.id); assert.equal(access.workspaceId, workspaceId);
      return { state: "ready", preferences }; } }
  });
  return { calls, run: () => api.loadIntegrationDashboard({ access: { supabase, workspaceId, workspace: { id: workspaceId, reporting_timezone: "America/Los_Angeles" }, user, membership: { role: "owner", user_id: user.id, workspace_id: workspaceId, status: "active" } }, eligibleKpis: kpis }) };
}
test("readonly loader excludes unconsented attempts and collapses only verified Square identity", async () => {
  const attempt = { connectionId: "10000000-0000-4000-8000-000000000010", businessEntityLabel: "North", sellerLabel: null, locationLabel: null,
    state: "disconnected", paymentCount: 0, createdAt: now, logicalIdentityKey: null };
  const established = { ...attempt, connectionId: "10000000-0000-4000-8000-000000000011", sellerLabel: "North", locationLabel: "North", paymentCount: 5,
    lastSyncedAt: now, logicalIdentityKey: "a".repeat(64) };
  const f = loaderFixture({ squares: [attempt, established, { ...established, connectionId: "10000000-0000-4000-8000-000000000012", paymentCount: 0, lastSyncedAt: null }] });
  const result = await f.run();
  assert.equal(result.dashboard.entries.length, 1); assert.equal(result.dashboard.entries[0].name, "North");
  assert.deepEqual(result.dashboard.entries[0].results, []); assert.equal(result.currentQboAccounting.kpis.length, 0);
  assert.deepEqual(f.calls, ["stored-payments"]);
});

test("QBO current producer excludes stale/disconnected attempts, groups exact lineage and withholds ambiguous shared-entity totals", async () => {
  const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const refresh = new Date(Date.now() - 60_000).toISOString(), deadline = new Date(Date.now() + 3_600_000).toISOString();
  const make = (number, state, entity = number, hash = String(number).repeat(64)) => ({
    connection: { connectionId: id(number), label: `Company ${number}`, updatedAt: refresh,
      evidence: { successfulAuthorization: true, hasImportedData: true, connectionState: state, lastSuccessfulSyncAt: refresh, freshness: "current" },
      visibility: { visible: true, lastSuccessfulSyncAt: refresh } },
    meta: { connectionId: id(number), logicalIdentityKey: hash, lastSuccessfulRefreshAt: refresh, currentUntil: deadline, freshness: "current" },
    summary: { contractVersion: "qbo_customer_accounting_summary_v1", workspaceId, businessEntityId: id(entity + 100), businessEntityName: "Example entity",
      connectionId: id(number), authorityId: id(number + 200), authorityEnabled: true, coverage: "partial", fullPostedRevenue: false, calculationState: "current",
      counts: { mapped: "1", reviewRequired: "0", nonContributing: "0", withdrawn: "0" }, calculatedAt: "2026-10-01T00:00:00Z", watermark: `sha256:${"a".repeat(64)}`,
      months: [{ stateId: id(number + 300), periodStart: "2026-09-01", periodEnd: "2026-09-30", currency: "USD", valueCanonical: "10.25",
        supportingContributionCount: "1", stateFingerprint: `sha256:${"b".repeat(64)}`, provenance: [{ factVersionId: id(number + 400), sourceVersionId: id(number + 500), sourceRecordId: id(number + 600), factFingerprint: `sha256:${"c".repeat(64)}` }] }] }
  });
  const first = make(1, "connected"), old = make(2, "disconnected", 1, first.meta.logicalIdentityKey), other = make(3, "connected");
  const run = async rows => loaderFixture({ qbo: { state: "available", connectionsTruncated: false, connections: rows.map(row => row.connection),
    data: { summaries: rows.map(row => row.summary) } }, qboMetadata: rows.map(row => row.meta) }).run();
  const current = await run([old, first, other]);
  assert.equal(current.dashboard.entries.length, 2); assert.equal(current.currentQboAccounting.kpis.length, 2);
  assert.deepEqual(current.currentQboAccounting.kpis.map(row => row.observations.current.value), [10.25, 10.25]);
  first.meta.currentUntil = "2026-09-01T00:00:00Z";
  const stale = await run([first, other]);
  assert.equal(stale.currentQboAccounting.kpis.length, 1); assert.equal(stale.dashboard.entries[0].results[0].value, "USD 10.25");
  first.meta.currentUntil = deadline;
  other.summary.businessEntityId = first.summary.businessEntityId;
  const ambiguous = await run([first, other]);
  assert.equal(ambiguous.dashboard.entries.length, 2); assert.equal(ambiguous.currentQboAccounting.kpis.length, 0);
  assert(ambiguous.dashboard.unavailable.includes("Shared-entity QuickBooks totals"));
  const euro = { ...first.summary.months[0], currency: "EUR", stateId: id(999), provenance: [{ ...first.summary.months[0].provenance[0], factVersionId: id(998) }] };
  first.summary.months.push(euro);
  const mixed = await run([first, other]);
  assert.equal(mixed.currentQboAccounting.kpis.length, 1); assert.equal(mixed.currentQboAccounting.kpis[0].semantics.unit, "EUR");
  first.summary.calculatedAt = "2099-10-01T00:00:00Z";
  const future = await run([first]);
  assert.equal(future.currentQboAccounting.kpis.length, 0); assert.deepEqual(future.dashboard.entries[0].results, []);
  assert(future.dashboard.unavailable.includes("QuickBooks calculation status"));
});

test("large Square history is explicitly bounded without hiding other provider results", async () => {
  const squares = Array.from({ length: 350 }, (_, index) => ({
    connectionId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    businessEntityLabel: "Company", sellerLabel: `Company ${index}`, locationLabel: "Location",
    state: "disconnected", paymentCount: 1, createdAt: now, lastSyncedAt: now,
    logicalIdentityKey: index.toString(16).padStart(64, "0")
  }));
  const sheets = [{ id: "10000000-0000-4000-8000-000000000999", business_entity_id: "entity",
    display_name: "Retained Sheets company", status: "connected", credential_version: 1,
    spreadsheet_id: "sheet", sheet_id: 0, active_approval_id: "approval", last_sync_at: now,
    last_sync_fact_count: 0, last_error_code: null, revocation_pending: false,
    authorization_uncertain: false, automatic_refresh_enabled: true, created_at: now }];
  const result = await loaderFixture({ squares, sheets }).run();
  assert.equal(result.loadFailed, false);
  assert.equal(result.dashboard.entries.filter(row => row.provider === "Square").length, 100);
  assert.equal(result.dashboard.entries.filter(row => row.provider === "Google Sheets").length, 1);
  assert(result.dashboard.unavailable.includes("Additional Square connections"));
  assert.equal(new Set(result.dashboard.entries.map(row => row.key)).size, 101);
});

test("saved-status GET is workspace-bound, no-store and never performs mutations", async () => {
  let reads = 0, access = { workspaceId };
  const route = loadSource("app/api/integrations/dashboard/route.ts", {
    "@/lib/security/require-workspace-access": { requireWorkspaceAccess: async () => access },
    "@/lib/integrations/dashboard/server": { loadIntegrationDashboard: async ({ access: bound }) => {
      assert.equal(bound.workspaceId, workspaceId); reads++; return { dashboard: dashboard([]) }; } }
  });
  assert.equal((await route.GET(new Request("https://vaeroex.test/api/integrations/dashboard"))).status, 400);
  access = { workspaceId: "10000000-0000-4000-8000-000000000099" };
  const url = `https://vaeroex.test/api/integrations/dashboard?workspaceId=${workspaceId}`;
  assert.equal((await route.GET(new Request(url))).status, 409); assert.equal(reads, 0);
  access = { workspaceId };
  const response = await route.GET(new Request(url));
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("vary"), "Cookie"); assert.equal(reads, 1);
});
test("stored Sheets facts are shown only for the exact valid current approval, never disconnected", async () => {
  const id = "10000000-0000-4000-8000-000000000020";
  const sheet = { id, business_entity_id: "entity", display_name: "Operations", status: "connected", credential_version: 1,
    spreadsheet_id: "sheet", sheet_id: 0, active_approval_id: "approval", last_sync_at: now, last_sync_fact_count: 4,
    last_error_code: null, revocation_pending: false, authorization_uncertain: false, automatic_refresh_enabled: true, created_at: now };
  const kpi = { id: "metric", workspace_id: workspaceId, name: "Completed jobs", metric_date: "2026-10-01", actual_value: 12,
    archived_at: null, deleted_at: null, raw_data_json: { googleSheets: { connectionId: id, approvalId: "approval", metricName: "jobs", unit: "jobs", validation: "valid", admission: "owner_approved_mapping" } } };
  const result = (await loaderFixture({ sheets: [sheet], kpis: [kpi, { ...kpi, id: "bad", actual_value: 99, raw_data_json: { googleSheets: { ...kpi.raw_data_json.googleSheets, approvalId: "wrong" } } }] }).run()).dashboard;
  assert.equal(result.entries[0].results.length, 1); assert.equal(result.entries[0].results[0].value, "12 jobs");
  assert.equal(result.entries[0].unchangedCheck, false, "same counts do not prove no changes");
  const disconnected = (await loaderFixture({ sheets: [{ ...sheet, status: "disconnected" }], kpis: [kpi] }).run()).dashboard;
  assert.deepEqual(disconnected.entries[0].results, []);
  const longName = "M".repeat(80), location = "L".repeat(120);
  const long = { ...kpi, name: `${longName} / entity / internal-id / ${location}`, raw_data_json: { googleSheets: { ...kpi.raw_data_json.googleSheets, metricName: longName, location } } };
  const longResult = await loaderFixture({ sheets: [sheet], kpis: [long] }).run();
  assert.equal(longResult.dashboard.entries[0].results[0].label, `${longName} / ${location}`);
  assert.doesNotMatch(longResult.dashboard.entries[0].results[0].label, /internal-id/);
  const malformed = await loaderFixture({ sheets: [{ ...sheet, last_sync_at: "not-a-time" }] }).run();
  assert.equal(malformed.loadFailed, false, "invalid sync timestamps remain unconfirmed rather than zero activity");
  const unavailable = await loaderFixture({ sheets: [{ ...sheet, display_name: null }] }).run();
  assert.equal(unavailable.loadFailed, true); assert.deepEqual(unavailable.dashboard.entries, []);
  assert.deepEqual(unavailable.currentQboAccounting.kpis, []);
  assert.match(renderToStaticMarkup(React.createElement(CurrentIntegrations, { initial: unavailable.dashboard })), /Active integration status is unavailable/);
});
