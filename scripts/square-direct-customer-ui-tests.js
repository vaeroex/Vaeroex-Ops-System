const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function loadTsx(relative, mocks = {}) {
  const filename = path.resolve(__dirname, "..", relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
  return loaded.exports;
}

const { SquareDirectCustomerPanel, squarePaymentAmount, squareBusinessTime, squarePaymentsHref } = loadTsx("components/integrations/SquareDirectCustomerPanel.tsx", {
  "next/link": { __esModule: true, default: ({ children, prefetch, ...props }) => { assert.equal(prefetch, false); return React.createElement("a", props, children); } },
});
const render = (view, props = {}) => renderToStaticMarkup(React.createElement(SquareDirectCustomerPanel, { view, ...props }));
const connection = {
  connectionId: "connection-owner-a", businessEntityId: "entity-owner-a", state: "connected", sellerLabel: "Owner A seller",
  locations: [{ id: "location-a", label: "Owner A location" }], locationId: "location-a", lastSyncedAt: "2026-09-29T01:02:03.000Z",
  checkpointAt: "2026-09-29T01:00:00.000Z", activeRead: null, lastCompletedRead: null,
  lastError: null, hasMore: false, revocationPending: false, recoveryRequired: false,
  payments: [{ id: "payment-a", locationId: "location-a", status: "COMPLETED", createdAt: "2026-09-29T01:01:00.000Z", updatedAt: "2026-09-29T01:01:00.000Z", amountMinor: "12345", currency: "USD" }],
};
const view = { available: true, historyAvailable: true, businessEntities: [{ id: "entity-owner-a", label: "Owner A business" }], connections: [connection] };
const connectionMetadata = item => ({
  connectionId: item.connectionId, businessEntityId: item.businessEntityId, businessEntityLabel: "Owner A business",
  sellerLabel: item.sellerLabel, locationLabel: "Owner A location", state: item.state, timeZone: "America/Los_Angeles", timeZoneFallback: false,
  createdAt: "2026-09-29T00:00:00.000Z", paymentCount: item.payments.length,
});
const browserFor = (overrides = {}) => ({
  connectionId: connection.connectionId, currentConnection: connection, timeZone: "America/Los_Angeles", timeZoneFallback: false, page: 1, pageSize: 25,
  totalCount: 1, totalPages: 1, payments: connection.payments, connections: [connectionMetadata(connection)],
  filters: { startDate: null, endDate: null, status: "all" }, ...overrides,
});

test("direct Settings navigation is present for every connection state without browser Back or workspace switching", () => {
  for (const state of ["consent_pending", "exchanging", "mapping_required", "connected", "syncing", "retry_required", "reauthorization_required", "disconnected"]) {
    for (const available of [true, false]) {
      const html = render({ ...view, available, connections: [{ ...connection, state }] });
      assert.match(html, /<a href="\/app\/settings"[^>]*>← Back to Settings<\/a>/);
      assert.doesNotMatch(html, /history\.back|router\.back|javascript:|name="workspaceId"|workspaceId=/);
    }
  }
  assert.match(render({ ...view, connections: [] }), /← Back to Settings/);
  assert.match(render(view), /<div class="vaeroex-app-shell vaeroex-customer-workspace min-h-dvh"><main class="workspace-page workspace-square/);
});

test("one compact current connection and collapsed historical rows replace repeated cards and tables", () => {
  const old = { ...connection, connectionId: "old-connection", state: "disconnected", sellerLabel: "Old seller" };
  const unused = { ...old, connectionId: "unused-attempt", sellerLabel: null, payments: [] };
  const browser = browserFor({ connections: [connectionMetadata(connection), connectionMetadata(old), connectionMetadata(unused)] });
  const html = render({ ...view, connections: [connection, old, unused] }, { browser });
  assert.equal((html.match(/id="current-square-connection"/g) ?? []).length, 1);
  assert.equal((html.match(/<table /g) ?? []).length, 1);
  const history = html.slice(html.indexOf("Connection history"));
  assert.match(history, /Old seller/);
  assert.match(history, /Unused Square attempt/);
  assert.match(history, /connectionId=old-connection/);
  assert.match(history, /connectionId=unused-attempt/);
  assert.doesNotMatch(history, /<table|<form/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|>)/);
  assert.doesNotMatch(html, /name="locationId"/);
});

test("history includes all browser connections and current context is not limited by the old status preview", () => {
  const old = Array.from({ length: 42 }, (_, index) => ({ ...connection, connectionId: `old-${index}`, state: "disconnected", sellerLabel: `Archived ${index}`, payments: [] }));
  const browser = browserFor({ connections: [connectionMetadata(connection), ...old.map(connectionMetadata)] });
  const html = render({ ...view, connections: old.slice(0, 32) }, { browser });
  assert.match(html, /id="current-square-connection"/);
  assert.match(html, /Owner A seller/);
  assert.match(html, /Archived 41/);
  assert.equal((html.match(/>View saved Payments<\/a>/g) ?? []).length, 42);
  assert.doesNotMatch(html, /action="\/api\/integrations\/square\/connect"/);
});

test("archive browsing changes only the stored-payment panel, not the current connection or action target", () => {
  const old = { ...connection, connectionId: "old-connection", state: "disconnected", sellerLabel: "Old seller", payments: [{ ...connection.payments[0], id: "old-payment" }] };
  const html = render({ ...view, connections: [connection, old] }, { browser: browserFor({
    connectionId: old.connectionId, payments: old.payments, connections: [connectionMetadata(connection), connectionMetadata(old)],
  }) });
  assert.match(html, /Previous connection/);
  assert.match(html, /old-payment/);
  for (const form of html.matchAll(/<form\b[^>]*method="post"[^>]*>[\s\S]*?<\/form>/g)) {
    assert.match(form[0], /name="connectionId" value="connection-owner-a"/);
    assert.doesNotMatch(form[0], /value="old-connection"/);
  }
});

test("legacy unavailable browsing preserves selected archived records with an honest limited-preview label", () => {
  const old = { ...connection, connectionId: "old-connection", state: "disconnected", sellerLabel: "Old seller", payments: [{ ...connection.payments[0], id: "old-payment" }] };
  const html = render({ ...view, connections: [connection, old] }, { browseConnectionId: old.connectionId });
  assert.match(html, /old-payment/);
  assert.match(html, /saved-record preview only/);
  assert.match(html, /not all matching stored Payments/);
  assert.doesNotMatch(html, /Filter saved Payments|aria-label="Saved Payments pagination"/);
  assert.match(render({ ...view, connections: [old] }), /old-payment/);
  const unknown = render({ ...view, connections: [old] }, { browseConnectionId: "foreign-connection" });
  assert.doesNotMatch(unknown, /old-payment/);
});

test("Manage connection and Disconnect are nested closed disclosures before required confirmation", () => {
  const html = render(view, { browser: browserFor() });
  const manage = html.slice(html.indexOf(">Manage connection</summary>"), html.indexOf("<section id=\"saved-payments\""));
  assert.match(manage, /<details[^>]*>[\s\S]*>Disconnect Square<\/summary>[\s\S]*<form/);
  assert.match(manage, /type="checkbox" required=""[^>]*name="confirmation" value="disconnect"/);
  assert.match(manage, /Confirm disconnect/);
  assert.doesNotMatch(manage, /\bopen=/);
});

test("configured business timezone renders readable dates while full IDs and exact UTC remain in payment details", () => {
  const payment = { ...connection.payments[0], id: "full-provider-payment-identifier", createdAt: "2026-05-05T04:43:11.000Z", updatedAt: "2026-05-05T04:43:12.000Z", amountMinor: "400000" };
  const html = render(view, { browser: browserFor({ payments: [payment] }) });
  assert.match(html, /Dates in America\/Los_Angeles · Business timezone/);
  assert.match(html, /May 4, 2026, 9:43 PM/);
  assert.match(html, /USD 4,000\.00/);
  const row = html.match(/<tr[^>]*data-payment-row="true"[\s\S]*?<\/tr>/)?.[0];
  assert.ok(row);
  const beforeDetails = row.slice(0, row.indexOf("<details"));
  assert.doesNotMatch(beforeDetails, /full-provider-payment-identifier|2026-05-05 04:43:11 UTC/);
  assert.match(row, /<details[\s\S]*full-provider-payment-identifier[\s\S]*2026-05-05 04:43:11 UTC[\s\S]*2026-05-05 04:43:12 UTC/);
  assert.equal(squareBusinessTime("2026-05-05T04:43:11Z", "America/Los_Angeles"), "May 4, 2026, 9:43 PM");
  assert.equal(squareBusinessTime("2026-05-05T04:43:11Z", "Invalid/Timezone"), "Time unavailable");
});

test("an unrecognized stored business timezone is labeled as UTC fallback without hiding saved browsing or controls", () => {
  const html = render(view, { browser: browserFor({ timeZone: "UTC", timeZoneFallback: true,
    connections: [{ ...connectionMetadata(connection), timeZone: "UTC", timeZoneFallback: true }] }) });
  assert.match(html, /Dates in UTC · Fallback; business timezone unavailable/);
  assert.match(html, /Last successful update[\s\S]*UTC · Fallback; business timezone unavailable/);
  assert.match(html, /Filter saved Payments/);
  assert.match(html, /payment-a/);
  assert.match(html, /Update Payments/);
  assert.doesNotMatch(html, /Dates in UTC · Business timezone|saved-record preview only/);
});

test("an archived fallback timezone does not relabel the valid current connection", () => {
  const old = { ...connection, connectionId: "old-connection", state: "disconnected" };
  const html = render(view, { browser: browserFor({ connectionId: old.connectionId, timeZone: "UTC", timeZoneFallback: true,
    connections: [connectionMetadata(connection), { ...connectionMetadata(old), timeZone: "UTC", timeZoneFallback: true }] }) });
  const currentPanel = html.slice(0, html.indexOf('id="saved-payments"'));
  assert.match(currentPanel, /America\/Los_Angeles/);
  assert.doesNotMatch(currentPanel, /Fallback/);
  assert.match(html, /Dates in UTC · Fallback; business timezone unavailable/);
});

test("failed and canceled attempts cannot be mistaken for completed-payment badges or totals", () => {
  const payments = ["COMPLETED", "FAILED", "CANCELED", "PENDING", "APPROVED"].map((status, index) => ({ ...connection.payments[0], id: `status-${index}`, status }));
  const html = render(view, { browser: browserFor({ payments, totalCount: payments.length }) });
  assert.match(html, /bg-emerald-50 text-emerald-800">Completed<\/span>/);
  assert.match(html, /bg-red-50 text-red-800">Failed attempt<\/span>/);
  assert.match(html, /bg-red-50 text-red-800">Canceled attempt<\/span>/);
  assert.match(html, /Failed and canceled attempts are not additional successful payments/);
  assert.match(html, /approved and pending records are not yet completed/);
  assert.doesNotMatch(html, /Total revenue|Total Payments amount/);
});

test("mobile rows keep date amount status and Details visible in two columns without a fixed table width", () => {
  const html = render(view, { browser: browserFor() });
  assert.doesNotMatch(html, /min-w-\[420px\]/);
  assert.match(html, /<table class="block w-full text-left text-sm sm:table"/);
  assert.match(html, /<thead class="sr-only[^\"]*sm:not-sr-only"/);
  const row = html.match(/<tr[^>]*data-payment-row="true"[\s\S]*?<\/tr>/)?.[0];
  assert.match(row, /grid grid-cols-2[^\"]*sm:table-row/);
  for (const order of [1, 2, 3, 4]) assert.match(row, new RegExp(`order-${order} min-w-0`));
  assert.equal((row.match(/sm:order-none/g) ?? []).length, 4);
  assert.match(row, /<details class="text-xs">/);
  assert.match(row, /<summary[^>]*>Details/);
  assert.match(html, /<th scope="col"[^>]*>Date/);
  assert.match(html, /<th scope="col"[^>]*>Status/);
  assert.match(html, /<th scope="col"[^>]*>Amount/);
});

test("25-row browsing renders every page of 413 server-selected records without importing or losing filters", () => {
  const all = Array.from({ length: 413 }, (_, index) => ({ ...connection.payments[0], id: `stored-payment-${index}` }));
  const ids = [];
  const filters = { startDate: "2026-05-01", endDate: "2026-09-30", status: "COMPLETED" };
  for (let page = 1; page <= 17; page++) {
    const payments = all.slice((page - 1) * 25, page * 25);
    const html = render(view, { browser: browserFor({ payments, page, totalPages: 17, totalCount: all.length, filters }) });
    assert.equal((html.match(/data-payment-row="true"/g) ?? []).length, page === 17 ? 13 : 25);
    assert.match(html, new RegExp(`Page ${page} of 17`));
    ids.push(...[...html.matchAll(/<dd class="break-all">(stored-payment-\d+)<\/dd>/g)].map(match => match[1]));
    const browse = html.match(/<form\b[^>]*method="get"[^>]*>[\s\S]*?<\/form>/)?.[0];
    assert.ok(browse);
    assert.match(browse, /action="\/app\/settings\/integrations\/square#saved-payments"/);
    assert.doesNotMatch(browse, /\/api\/integrations|name="page"|name="workspaceId"/);
    const nav = html.slice(html.indexOf('<nav aria-label="Saved Payments pagination"'));
    for (const href of nav.matchAll(/href="([^"]+)"/g)) {
      const url = new URL(href[1].replaceAll("&amp;", "&"), "https://example.invalid");
      assert.equal(url.pathname, "/app/settings/integrations/square");
      assert.equal(url.searchParams.get("connectionId"), connection.connectionId);
      assert.equal(url.searchParams.get("startDate"), filters.startDate);
      assert.equal(url.searchParams.get("endDate"), filters.endDate);
      assert.equal(url.searchParams.get("status"), filters.status);
      assert.equal(url.hash, "#saved-payments");
    }
  }
  assert.deepEqual(ids, all.map(payment => payment.id));
  assert.equal(new Set(ids).size, 413);
});

test("filter date coverage and zero-match text distinguish stored browsing from provider imports", () => {
  const html = render(view, { browser: browserFor({ payments: [], totalCount: 0, totalPages: 1,
    filters: { startDate: "2026-05-04", endDate: "2026-05-05", status: "FAILED" },
  }) });
  assert.match(html, /0 matching saved Payments/);
  assert.match(html, /No saved Payments match these filters/);
  assert.match(html, /Searched stored creation dates: 2026-05-04 through 2026-05-05, inclusive \(America\/Los_Angeles\)/);
  assert.match(html, /They do not search Square for new records/);
  assert.doesNotMatch(html, /aria-label="Saved Payments pagination"/);
  assert.equal(squarePaymentsHref(connection.connectionId), "/app/settings/integrations/square?connectionId=connection-owner-a#saved-payments");
});

test("invalid saved-payment filters offer a safe reset using only the known selected connection", () => {
  const html = render(view, { browseError: "Choose valid saved-payment filters.", browseConnectionId: connection.connectionId });
  assert.match(html, /Choose valid saved-payment filters/);
  assert.match(html, /href="\/app\/settings\/integrations\/square\?connectionId=connection-owner-a#saved-payments"[^>]*>Reset saved-payment filters/);
  assert.match(html, /saved-record preview only/);
  const unknown = render({ ...view, connections: [] }, { browseError: "Choose valid saved-payment filters.", browseConnectionId: "foreign-connection" });
  assert.match(unknown, /href="\/app\/settings\/integrations\/square"[^>]*>Reset saved-payment filters/);
  assert.doesNotMatch(unknown, /foreign-connection/);
});

test("unavailable workspace without a connection renders no actions", () => {
  const html = render({ ...view, available: false, connections: [] });
  assert.match(html, /updates are unavailable for this workspace/);
  assert.doesNotMatch(html, /<form|payment-a|Owner A seller/);
});

test("unavailable workspace retains saved status and disconnect without granting new reads or mapping", () => {
  for (const state of ["connected", "mapping_required"]) {
    const html = render({ ...view, available: false, connections: [{ ...connection, state }] });
    assert.match(html, /Owner A seller/);
    assert.match(html, /payment-a/);
    assert.match(html, /action="\/api\/integrations\/square\/disconnect"/);
    assert.doesNotMatch(html, /action="\/api\/integrations\/square\/(connect|mapping|read)"/);
  }
  const closed = render({ ...view, available: false, connections: [{ ...connection, state: "disconnected" }] });
  assert.doesNotMatch(closed, /action="\/api\/integrations\/square\/connect"/);
});

test("owner view renders exact Square amounts, source and sync time without another workspace", () => {
  const html = render(view);
  assert.match(html, /Owner A seller/);
  assert.match(html, /USD 123\.45/);
  assert.match(html, /Source: Square Production/);
  assert.match(html, /Sep 29, 2026, 1:02 AM/);
  assert.match(html, /value="connection-owner-a"/);
  assert.doesNotMatch(html, /name="workspaceId"|internal.permit|Owner B|revenue:|profit:/i);
  assert.match(html, /not revenue, profit/);
});

test("money formatting retains integer precision and currency-specific minor units", () => {
  assert.equal(squarePaymentAmount("90071992547409931", "USD"), "USD 900,719,925,474,099.31");
  assert.equal(squarePaymentAmount("12345", "JPY"), "JPY 12,345");
  assert.equal(squarePaymentAmount("12345", "KWD"), "KWD 12.345");
  assert.equal(squarePaymentAmount("-1", "USD"), "USD -0.01");
  assert.equal(squarePaymentAmount("0", "USD"), "USD 0.00");
  for (const invalid of [null, "NaN", "1.5", "1e3", "01"]) assert.equal(squarePaymentAmount(invalid, "USD"), "Amount unavailable");
  assert.equal(squarePaymentAmount("100", null), "Amount unavailable");
});

test("mapping submits the owned connection and exact selected location, not an internal permit", () => {
  const html = render({ ...view, connections: [{ ...connection, state: "mapping_required", locationId: null, payments: [] }] });
  assert.match(html, /action="\/api\/integrations\/square\/mapping" method="post"/);
  assert.match(html, /name="locationId"/);
  assert.match(html, /value="location-a"/);
  assert.doesNotMatch(html, /locationFingerprint|permitId|action="\/api\/integrations\/square\/read"/);
});

test("pagination, retry and reauthorization have distinct actionable states", () => {
  assert.match(render({ ...view, connections: [{ ...connection, hasMore: true }] }), /Read next Payments page/);
  assert.match(render(view), /Update Payments/);
  assert.match(render({ ...view, connections: [{ ...connection, lastSyncedAt: null }] }), /Read Payments/);
  const retry = render({ ...view, connections: [{ ...connection, state: "retry_required", lastError: "fixed_read_failure" }] });
  assert.match(retry, /Payments update needs another attempt/);
  assert.match(retry, /last successfully saved Payments remain below/);
  const renew = render({ ...view, connections: [{ ...connection, state: "reauthorization_required" }] });
  assert.match(renew, /Disconnect this connection, then connect again/);
  assert.doesNotMatch(renew, /action="\/api\/integrations\/square\/(read|connect)"/);
});

test("historical import submits inclusive UTC dates with the existing owned connection", () => {
  for (const state of ["connected", "retry_required"]) {
    const html = render({ ...view, connections: [{ ...connection, state }] });
    const forms = [...html.matchAll(/<form\b[^>]*action="\/api\/integrations\/square\/read"[^>]*>[\s\S]*?<\/form>/g)].map(match => match[0]);
    assert.equal(forms.length, 2);
    assert.doesNotMatch(forms[0], /name="(?:startDate|endDate)"/);
    const history = forms.find(form => /name="startDate"/.test(form));
    assert.ok(history);
    assert.match(history, /method="post"/);
    assert.match(history, /name="connectionId" value="connection-owner-a"/);
    for (const name of ["startDate", "endDate"]) {
      const input = history.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
      assert.ok(input);
      assert.match(input, /type="date"/);
      assert.match(input, /required=""/);
      assert.match(input, /aria-describedby="history-dates-connection-owner-a"/);
    }
    assert.match(history, /Start date \(UTC\)/);
    assert.match(history, /End date \(UTC\)/);
    assert.match(history, /1–31 calendar days, including both dates, in UTC/);
    assert.match(history, /when Payments were created at the selected location/);
    assert.match(history, /keeps the saved checkpoint for ongoing updates/);
    assert.match(history, /one page of up to 100 Payments/);
    assert.doesNotMatch(history, /name="(?:workspaceId|locationId|checkpointAt|readKind|cursor)"/);
  }
});

test("historical import respects every existing read eligibility boundary", () => {
  for (const partial of [
    { state: "mapping_required" }, { state: "syncing" }, { state: "exchanging" },
    { state: "reauthorization_required" }, { state: "disconnected" },
    { recoveryRequired: true }, { revocationPending: true }, { locationId: null },
    { hasMore: true },
  ]) {
    const html = render({ ...view, connections: [{ ...connection, ...partial }] });
    assert.doesNotMatch(html, /name="startDate"|name="endDate"|Import historical Payments/);
  }
  assert.doesNotMatch(render({ ...view, available: false }), /name="startDate"|name="endDate"/);
});

test("older backend capability keeps normal updates available and hides historical imports", () => {
  for (const historyAvailable of [false, undefined]) {
    const html = render({ ...view, historyAvailable });
    assert.doesNotMatch(html, /name="startDate"|name="endDate"|Import historical Payments/);
    assert.match(html, /Update Payments/);
    assert.match(html, /action="\/api\/integrations\/square\/read" method="post"/);
  }
});

test("active coverage distinguishes creation and update dates and continues the same search", () => {
  for (const kind of ["created", "updated"]) {
    for (const hasMore of [true, false]) {
      const html = render({ ...view, connections: [{ ...connection, state: "retry_required", hasMore,
        activeRead: { kind, start: "2026-05-04T00:00:00.000Z", end: "2026-05-05T00:00:00.000Z" }, payments: [],
      }] });
      assert.ok(html.includes(`Current search: Payments ${kind} from 2026-05-04 00:00:00 UTC ${kind === "created" ? "up to (not including)" : "through"} 2026-05-05 00:00:00 UTC`));
      assert.match(html, /search is incomplete until every page has been read/);
      assert.match(html, /This search is still incomplete/);
      assert.match(html, hasMore ? /Read next Payments page/ : /Continue Payments read/);
      assert.doesNotMatch(html, /name="startDate"|name="endDate"|Import historical Payments/);
      const form = html.match(/<form\b[^>]*action="\/api\/integrations\/square\/read"[^>]*>[\s\S]*?<\/form>/)?.[0];
      assert.ok(form);
      assert.deepEqual([...form.matchAll(/<input[^>]*name="([^"]+)"/g)].map(match => match[1]), ["connectionId"]);
    }
  }
});

test("empty completed searches show actual date coverage without claiming all history", () => {
  for (const kind of ["created", "updated"]) {
    const html = render({ ...view, connections: [{ ...connection, payments: [], lastCompletedRead: {
      kind, start: "2026-05-04T00:00:00.000Z", end: "2026-05-05T00:00:00.000Z", completedAt: "2026-09-29T01:02:03.000Z",
    } }] });
    assert.ok(html.includes(`Last completed search: Payments ${kind} from 2026-05-04 00:00:00 UTC ${kind === "created" ? "up to (not including)" : "through"} 2026-05-05 00:00:00 UTC`));
    assert.match(html, /Completed: 2026-09-29 01:02:03 UTC/);
    assert.match(html, /This covers only that date window and the selected location/);
    assert.match(html, new RegExp(`The last completed search checked Payments ${kind} from`));
    assert.match(html, /Older Payments may be outside these dates/);
    assert.match(html, /Ongoing Payments updates resume from: 2026-09-29 01:00:00 UTC/);
    assert.doesNotMatch(html, /all Payments have been imported|complete payment history|no Payments exist/i);
  }
});

test("missing legacy coverage stays unknown and never infers dates from a sync time", () => {
  const legacy = { ...connection, payments: [] };
  delete legacy.activeRead;
  delete legacy.lastCompletedRead;
  delete legacy.checkpointAt;
  const html = render({ ...view, connections: [legacy] });
  assert.match(html, /No completed search dates are available/);
  assert.match(html, /does not establish whether older Payments exist in Square/);
  assert.doesNotMatch(html, /Last completed search:|Current search:|updates resume from:/);
  assert.match(html, /Import historical Payments/);
});

test("historical saved payments retain their actual creation date and exact amount", () => {
  const html = render({ ...view, connections: [{ ...connection, payments: [{ ...connection.payments[0],
    id: "historical-payment-a", createdAt: "2026-05-04T16:15:00.000Z", amountMinor: "400000", currency: "USD",
  }] }] });
  assert.match(html, /historical-payment-a/);
  assert.match(html, /2026-05-04 16:15:00 UTC/);
  assert.match(html, /USD 4,000\.00/);
  assert.doesNotMatch(html, /No Payments have been saved/);
});

test("disconnect requires explicit confirmation and pending revocation blocks reconnect", () => {
  const checkbox = render(view).match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
  assert.ok(checkbox);
  assert.match(checkbox, /name="confirmation"/);
  assert.match(checkbox, /required=""/);
  assert.match(checkbox, /value="disconnect"/);
  const pending = render({ ...view, connections: [{ ...connection, state: "disconnected", revocationPending: true }] });
  assert.match(pending, /revocation is still pending/);
  assert.match(pending, /Retry Square revocation/);
  assert.doesNotMatch(pending, /action="\/api\/integrations\/square\/connect"/);
  const closed = render({ ...view, connections: [{ ...connection, state: "disconnected" }] });
  assert.match(closed, /action="\/api\/integrations\/square\/connect" method="post"/);
  assert.doesNotMatch(closed, /action="\/api\/integrations\/square\/(read|disconnect)"/);
});

test("provider display strings are escaped and raw failure values are not displayed", () => {
  const html = render({ ...view, connections: [{ ...connection, sellerLabel: "<script>seller</script>", lastError: "PRIVATE_ERROR_CANARY" }] });
  assert.match(html, /&lt;script&gt;seller&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|PRIVATE_ERROR_CANARY/);
});

test("a live connection or pending revocation blocks connecting a second Business Entity", () => {
  const multipleEntities = [...view.businessEntities, { id: "entity-owner-b", label: "Second business" }];
  for (const existing of [connection, { ...connection, state: "disconnected", revocationPending: true }]) {
    const html = render({ ...view, businessEntities: multipleEntities, connections: [existing] });
    assert.doesNotMatch(html, /action="\/api\/integrations\/square\/connect"/);
    assert.doesNotMatch(html, /value="entity-owner-b"/);
  }
  const closed = render({ ...view, businessEntities: multipleEntities, connections: [{ ...connection, state: "disconnected" }] });
  assert.match(closed, /action="\/api\/integrations\/square\/connect"/);
  assert.match(closed, /value="entity-owner-b"/);
});

test("unconfirmed authorization requires checked recovery without provider actions or closed claims", () => {
  for (const state of ["exchanging", "reauthorization_required", "connected", "mapping_required", "disconnected"]) {
    const html = render({ ...view, connections: [{ ...connection, state, recoveryRequired: true }] });
    assert.match(html, /Authorization recovery required/);
    assert.match(html, /Square authorization outcome and this workspace’s account connection are unconfirmed\. Contact support for checked recovery before taking any further connection action\./);
    assert.doesNotMatch(html, /action="\/api\/integrations\/square\/(connect|disconnect|mapping|read)"/);
    assert.doesNotMatch(html, /Disconnected locally|>Disconnected<|Disconnect this connection, then connect again|revoke Vaeroex|Square[’']s app permissions/i);
  }
  const known = render({ ...view, connections: [{ ...connection, state: "reauthorization_required", recoveryRequired: false }] });
  assert.match(known, /action="\/api\/integrations\/square\/disconnect"/);
});

test("direct page rejects host/protocol mismatch before workspace authority and has no legacy fallback", async () => {
  let incoming = new Headers({ host: "www.vaeroex.com", "x-forwarded-proto": "https" });
  let directReads = 0;
  let returned = view;
  const { default: page } = loadTsx("app/(square-connection)/app/settings/integrations/square/page.tsx", {
    "next/headers": { headers: async () => incoming },
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
    "@/lib/integrations/square-direct/payment-browse": { parseDirectPaymentBrowseQuery: () => ({ connectionId: null, page: 1, startDate: null, endDate: null, status: "all" }) },
    "@/components/integrations/SquareDirectCustomerPanel": { SquareDirectCustomerPanel },
    "@/components/integrations/SquareConnectionPanel": { SquareConnectionPanel: () => { throw new Error("LEGACY_RENDER"); } },
    "@/components/integrations/SquareProductionCustomerPanel": { SquareProductionCustomerPanel: () => { throw new Error("LEGACY_RENDER"); } },
    "@/lib/integrations/square-direct/server": { squareDirectEnabled: () => true, squareDirectView: async () => { directReads++; return returned; }, squareDirectPayments: async () => ({ browser: null, error: null }) },
    "@/lib/integrations/control-plane/square-production-customer": { productionSquareCustomerEnabled: () => { throw new Error("LEGACY_GATE"); } },
    "@/lib/integrations/control-plane/square-customer-availability": {},
    "@/lib/integrations/control-plane/square-customer-routes": { SQUARE_CUSTOMER_SETTINGS_PATH: "/app/settings/integrations/square" },
    "@/lib/seo/public-seo": { PUBLIC_SITE_URL: "https://www.vaeroex.com" },
  });
  const readPage = () => page({ searchParams: Promise.resolve({}) });
  assert.equal((await readPage()).type, SquareDirectCustomerPanel);
  assert.equal(directReads, 1);
  for (const headers of [
    { host: "evil.invalid", "x-forwarded-proto": "https" },
    { host: "www.vaeroex.com", "x-forwarded-proto": "http" },
    { host: "www.vaeroex.com", "x-forwarded-proto": "https", "x-forwarded-host": "evil.invalid" },
    { host: "www.vaeroex.com" },
  ]) {
    incoming = new Headers(headers);
    await assert.rejects(readPage(), /NOT_FOUND/);
  }
  assert.equal(directReads, 1);
  incoming = new Headers({ host: "www.vaeroex.com", "x-forwarded-proto": "https" });
  returned = null;
  await assert.rejects(readPage(), /NOT_FOUND/);
  assert.equal(directReads, 2);
});

test("workspace Integrations exposes canonical Square navigation only to enabled owners", async () => {
  let enabled = false, role = "owner", evidenceReads = 0;
  const supabase = { from() { throw new Error("UNEXPECTED_DATABASE_READ"); } };
  const { SectionCard } = loadTsx("components/operations/SectionCard.tsx");
  const empty = () => null;
  const { default: settingsPage } = require("./integrations-ui-test-support").loadSource("app/app/integrations/page.tsx", {
    "next/headers": { headers: async () => new Headers() },
    "next/link": { __esModule: true, default: ({ children, prefetch, ...props }) => { assert.equal(prefetch, false); return React.createElement("a", props, children); } },
    "@/components/auth/AuthMessage": { AuthMessage: empty },
    "@/components/app/ThemeControls": { ThemeControls: empty },
    "@/components/integrations/ConnectionStatusPanel": { ConnectionStatusPanel: empty },
    "@/components/integrations/SquareEvidenceCard": { SquareEvidenceCard: empty },
    "@/components/operations/PageHeader": { PageHeader: empty },
    "@/components/operations/SectionCard": { SectionCard },
    "@/lib/auth/actions": { changePasswordAction: "/synthetic-account-security" },
    "@/lib/integrations/control-plane/qbo-customer-availability": { qboProductionCustomerConnectionsEnabled: () => false },
    "@/lib/integrations/square-direct/server": { squareDirectEnabled: () => enabled,
      squareDirectView: async () => { assert.equal(enabled, true); assert.equal(role, "owner"); return view; },
      squareSettingsPath: "/app/settings/integrations/square" },
    "@/lib/integrations/control-plane/square-workspace-evidence": { readSquareWorkspaceEvidence: async (client, workspaceId) => {
      assert.equal(client, supabase); assert.equal(workspaceId, "workspace-a"); evidenceReads++; return null;
    } },
    "@/lib/workspaces/page-context": { requireWorkspacePage: async () => ({
      supabase, workspaceId: "workspace-a", context: { membership: { role }, activeWorkspace: { name: "Workspace A" } },
    }) },
  });
  const renderSettings = async () => renderToStaticMarkup(await settingsPage({ searchParams: Promise.resolve({}) }));
  assert.doesNotMatch(await renderSettings(), /Manage Square|href="\/app\/settings\/integrations\/square"/);
  enabled = true;
  const owner = await renderSettings();
  assert.match(owner, /aria-label="Square"/);
  assert.match(owner, /href="\/app\/settings\/integrations\/square"/);
  assert.match(owner, /Manage Square/);
  for (role of ["admin", "manager", "member"]) {
    assert.doesNotMatch(await renderSettings(), /Manage Square|href="\/app\/settings\/integrations\/square"/);
  }
  assert.equal(evidenceReads, 5, "existing evidence reader remains intact");
});
