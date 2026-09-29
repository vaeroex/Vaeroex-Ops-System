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

const { SquareDirectCustomerPanel, squarePaymentAmount } = loadTsx("components/integrations/SquareDirectCustomerPanel.tsx");
const render = view => renderToStaticMarkup(React.createElement(SquareDirectCustomerPanel, { view }));
const connection = {
  connectionId: "connection-owner-a", businessEntityId: "entity-owner-a", state: "connected", sellerLabel: "Owner A seller",
  locations: [{ id: "location-a", label: "Owner A location" }], locationId: "location-a", lastSyncedAt: "2026-09-29T01:02:03.000Z",
  lastError: null, hasMore: false, revocationPending: false, recoveryRequired: false,
  payments: [{ id: "payment-a", locationId: "location-a", status: "COMPLETED", createdAt: "2026-09-29T01:01:00.000Z", updatedAt: "2026-09-29T01:01:00.000Z", amountMinor: "12345", currency: "USD" }],
};
const view = { available: true, businessEntities: [{ id: "entity-owner-a", label: "Owner A business" }], connections: [connection] };

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
  assert.match(html, /2026-09-29 01:02:03 UTC/);
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
    "@/components/integrations/SquareDirectCustomerPanel": { SquareDirectCustomerPanel },
    "@/components/integrations/SquareConnectionPanel": { SquareConnectionPanel: () => { throw new Error("LEGACY_RENDER"); } },
    "@/components/integrations/SquareProductionCustomerPanel": { SquareProductionCustomerPanel: () => { throw new Error("LEGACY_RENDER"); } },
    "@/lib/integrations/square-direct/server": { squareDirectEnabled: () => true, squareDirectView: async () => { directReads++; return returned; } },
    "@/lib/integrations/control-plane/square-production-customer": { productionSquareCustomerEnabled: () => { throw new Error("LEGACY_GATE"); } },
    "@/lib/integrations/control-plane/square-customer-availability": {},
    "@/lib/integrations/control-plane/square-customer-routes": { SQUARE_CUSTOMER_SETTINGS_PATH: "/app/settings/integrations/square" },
    "@/lib/seo/public-seo": { PUBLIC_SITE_URL: "https://www.vaeroex.com" },
  });
  assert.equal((await page()).type, SquareDirectCustomerPanel);
  assert.equal(directReads, 1);
  for (const headers of [
    { host: "evil.invalid", "x-forwarded-proto": "https" },
    { host: "www.vaeroex.com", "x-forwarded-proto": "http" },
    { host: "www.vaeroex.com", "x-forwarded-proto": "https", "x-forwarded-host": "evil.invalid" },
    { host: "www.vaeroex.com" },
  ]) {
    incoming = new Headers(headers);
    await assert.rejects(page(), /NOT_FOUND/);
  }
  assert.equal(directReads, 1);
  incoming = new Headers({ host: "www.vaeroex.com", "x-forwarded-proto": "https" });
  returned = null;
  await assert.rejects(page(), /NOT_FOUND/);
  assert.equal(directReads, 2);
});

test("workspace settings exposes canonical Square navigation only to enabled owners", async () => {
  let enabled = false, role = "owner", evidenceReads = 0;
  const supabase = { from() { throw new Error("UNEXPECTED_DATABASE_READ"); } };
  const { SectionCard } = loadTsx("components/operations/SectionCard.tsx");
  const empty = () => null;
  const { default: settingsPage } = loadTsx("app/app/settings/page.tsx", {
    "next/headers": { headers: async () => new Headers() },
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/components/auth/AuthMessage": { AuthMessage: empty },
    "@/components/app/ThemeControls": { ThemeControls: empty },
    "@/components/integrations/ConnectionStatusPanel": { ConnectionStatusPanel: empty },
    "@/components/integrations/SquareEvidenceCard": { SquareEvidenceCard: empty },
    "@/components/operations/PageHeader": { PageHeader: empty },
    "@/components/operations/SectionCard": { SectionCard },
    "@/lib/auth/actions": { changePasswordAction: "/synthetic-account-security" },
    "@/lib/integrations/control-plane/qbo-customer-availability": { qboProductionCustomerConnectionsEnabled: () => false },
    "@/lib/integrations/square-direct/server": { squareDirectEnabled: () => enabled },
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
  assert.match(owner, /Square connection/);
  assert.match(owner, /href="\/app\/settings\/integrations\/square"/);
  assert.match(owner, /Manage Square/);
  for (role of ["admin", "manager", "member"]) {
    assert.doesNotMatch(await renderSettings(), /Manage Square|href="\/app\/settings\/integrations\/square"/);
  }
  assert.equal(evidenceReads, 5, "existing evidence reader remains intact");
});
