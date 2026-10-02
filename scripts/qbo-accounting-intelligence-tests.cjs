/* eslint-disable @typescript-eslint/no-require-imports -- Focused offline tests of the actual producer and authenticated loader. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { installLoader, id, ids, root } = require("./qbo-customer-test-support.cjs");
const now = "2026-09-30T12:00:00.000Z", fingerprint = digit => `sha256:${digit.repeat(64)}`;
let enabled, authCalls, workspaceCalls, claimCalls, browseCalls, rpcCalls, member, claims, summaries, connections, rpcFailure, browseFailure, freshnessRows, importedIds;
function emptyBrowser(connectionId) {
  return { contractVersion: "qbo_customer_source_browse_v1", provider: "quickbooks_online", environment: "production", additive: false,
    coverage: "unknown", readAt: now, connectionId, kind: "all", pageSize: 25, nextAfter: null, sources: [], detail: null,
    connections: connections.map(c => ({ connectionId: c.connectionId, label: c.label ?? "QuickBooks company", entityLabel: "Example entity", state: c.status ?? "active" })),
    metrics: { scope: "selected_connection_and_category_current_sources", currentSources: importedIds?.has(connectionId) ? "1" : "0", reportObservations: "0", transactionRecords: "0",
      validation: { pending: "0", valid: "0", invalid: "0", quarantined: "0" }, lifecycle: { active: "0", voided: "0", deleted: "0", unavailable: "0" },
      validationWork: { absent: "0", pending: "0", claimed: "0", valid: "0", quarantined: "0", superseded: "0", conflict: "0" },
      missingCurrency: "0", unknownAccountingBasis: "0", missingSourceTimeZone: "0", missingTransactionPostingDate: "0",
      earliestPostingDate: null, latestPostingDate: null, earliestObservedAt: null, latestObservedAt: null, latestSynchronizedAt: null, byType: [] } };
}
function month(number = 1, overrides = {}) {
  return { stateId: id(100 + number), periodStart: "2026-09-01", periodEnd: "2026-09-30", currency: "USD",
    valueCanonical: "100.25", supportingContributionCount: "1", stateFingerprint: fingerprint("a"),
    provenance: [{ factVersionId: id(200 + number), sourceVersionId: id(300 + number), sourceRecordId: id(400 + number), factFingerprint: fingerprint("b") }], ...overrides };
}
function summary(overrides = {}) {
  return { contractVersion: "qbo_customer_accounting_summary_v1", workspaceId: ids.workspace, businessEntityId: ids.entity,
    businessEntityName: "Example entity", connectionId: ids.connection, authorityId: id(7), authorityEnabled: true,
    coverage: "partial", fullPostedRevenue: false, calculationState: "current",
    counts: { mapped: "1", reviewRequired: "2", nonContributing: "0", withdrawn: "0" }, months: [month()],
    calculatedAt: "2026-09-30T11:00:00.000Z", watermark: fingerprint("c"), ...overrides };
}
function reset() {
  enabled = true; authCalls = workspaceCalls = claimCalls = browseCalls = 0; rpcCalls = [];
  member = { workspaceId: ids.workspace, membership: { role: "owner", user_id: ids.actor, status: "active", workspace_id: ids.workspace } };
  claims = { data: { claims: { sub: ids.actor, session_id: ids.session } }, error: null };
  summaries = new Map([[ids.connection, summary()]]); connections = [{ connectionId: ids.connection }]; rpcFailure = browseFailure = false;
  freshnessRows = []; importedIds = new Set();
}
installLoader({
  "@/lib/integrations/control-plane/qbo-customer-availability": { qboProductionCustomerConnectionsEnabled: () => enabled },
  "@/lib/security/require-auth": { requireAuth: async () => {
    authCalls++; return { user: { id: ids.actor }, supabase: { auth: { getClaims: async () => { claimCalls++; return claims; } },
      from: table => {
        assert.ok(["integration_connection_summaries", "integration_freshness_summaries"].includes(table));
        const filters = [];
        const query = { select: () => query, eq: (column, value) => { filters.push([column, value]); return query; },
          in: async (column, values) => {
            assert.ok(filters.some(([k,v]) => k === "workspace_id" && v === ids.workspace));
            assert.ok(filters.some(([k,v]) => k === "provider_key" && v === "quickbooks_online"));
            assert.deepEqual(values, connections.map(c => c.connectionId));
            return { error: null, data: table === "integration_freshness_summaries" ? freshnessRows : connections.map(c => ({
              id: c.connectionId, status: c.status ?? "active", granted_scopes: c.scopes ?? ["com.intuit.quickbooks.accounting"] })) };
          } }; return query;
      },
      rpc: async (name, args) => { rpcCalls.push({ name, args }); return rpcFailure ? { data: null, error: new Error("private-never-display") }
        : { data: name === "qbo_customer_source_browse_v1" ? emptyBrowser(args.p_connection_id) : summaries.get(args.p_connection_id), error: null }; } } };
  } },
  "@/lib/security/get-current-workspace": { getCurrentWorkspace: async () => { workspaceCalls++; return member; } },
  "@/lib/integrations/qbo-customer/server": { qboCustomerStoredData: async (params, workspace) => {
    browseCalls++; assert.deepEqual(params, {}); assert.equal(workspace, ids.workspace);
    if (browseFailure) throw new Error("private-never-display");
    return { browser: emptyBrowser(connections[0]?.connectionId ?? null) };
  } }
});
const { parseQboAccountingSummary, buildQboAccountingIntelligence, exactQboAccountingNumber } = require("../lib/integrations/qbo-customer/accounting-intelligence.ts");
const { loadQboAccountingIntelligence } = require("../lib/integrations/qbo-customer/accounting-intelligence-server.ts");
const { QboAccountingIntelligenceView } = require("../lib/integrations/qbo-customer/accounting-intelligence-view.tsx");
const { integrationResultVisibility } = require("../lib/integrations/control-plane/result-visibility.ts");
const { QboStoredDataView } = require("../lib/integrations/qbo-customer/view.tsx");
const { buildIntelligenceSnapshotFromProducersV1 } = require("../lib/intelligence/snapshot/v1/composition.ts");
const { foundationIntelligenceLayerOutput } = require("../lib/intelligence/snapshot/v1/fixtures.ts");
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const produce = (values = [summary()]) => buildQboAccountingIntelligence({ workspaceId: ids.workspace, summaries: values, asOf: now });
const snapshot = data => buildIntelligenceSnapshotFromProducersV1({ workspaceId: ids.workspace, asOf: now, kpis: data.kpis, evidenceManifests: data.evidenceManifests }).snapshot;
const render = result => renderToStaticMarkup(React.createElement(QboAccountingIntelligenceView, { result: result.state !== "available" ? result : {
  ...result, connections: result.connections ?? result.data.summaries.map(s => ({ connectionId: s.connectionId, label: "Example company", visibility: {
    visible: true, status: null, requiresReconnect: false, lastSuccessfulSyncAt: now } })) } }));

test("synthetic accounting summary stays truthful and navigable at desktop, tablet and mobile widths", {
  skip: !process.argv.includes("--browser"), timeout: 45000
}, async () => {
  const { chromium } = require("playwright");
  const postcss = require("postcss"), tailwind = require("tailwindcss");
  const config = require("../tailwind.config.ts").default;
  const css = (await postcss([tailwind({ ...config,
    content: [path.join(root, "lib/integrations/qbo-customer/accounting-intelligence-view.tsx")] })])
    .process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  const executablePath = process.env.QBO_TEST_CHROME_EXECUTABLE;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.abort());
    const display = result => page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#111827"><main style="padding:16px">${render(result)}</main></body></html>`);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await display({ state: "available", data: produce(), connectionsTruncated: false });
      await page.getByRole("heading", { name: "QuickBooks", exact: true }).waitFor();
      assert.match(await page.locator("body").innerText(), /USD 100\.25/);
      assert.match(await page.locator("body").innerText(), /Partial posted revenue subtotal/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator("summary").focus(); await page.keyboard.press("Enter");
      assert.equal(await page.locator("details").getAttribute("open"), "");
      const href = await page.getByRole("link", { name: "Stored source 1", exact: true }).getAttribute("href");
      assert.ok(href.startsWith("/app/settings/integrations/quickbooks/data?"));
      assert.ok(href.includes(ids.connection) && href.includes(id(401)));
      const overflow = await page.locator("h2,h3,p,summary,a,span").evaluateAll(elements =>
        elements.filter(element => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
          .map(element => element.textContent));
      assert.deepEqual(overflow, []);
      await page.screenshot({ path: `/tmp/qbo-accounting-intelligence-${width}.png`, fullPage: true });
      for (const state of ["pending", "disabled"]) {
        await display({ state: "available", connectionsTruncated: false, data: produce([summary({
          calculationState: state, authorityEnabled: state !== "disabled", months: [], calculatedAt: null, watermark: null
        })]) });
        assert.doesNotMatch(await page.locator("body").innerText(), /USD|100\.25/);
      }
      await display({ state: "unavailable" });
      assert.match(await page.locator("body").innerText(), /No subtotal is shown/);
      await display({ state: "hidden" }); assert.equal(await page.locator("section").count(), 0);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("real snapshot accepts exact admitted subtotal, derived native lineage, unknown performance and no targets", () => {
  const result = produce(), output = snapshot(result), kpi = output.kpis[0];
  assert.equal(kpi.observations.current.value, 100.25);
  assert.match(kpi.identity.canonicalName, /^qbo_admitted_posted_revenue:/);
  assert.ok(kpi.id.includes(ids.entity)); assert.ok(kpi.id.includes(ids.connection)); assert.ok(kpi.id.endsWith(":USD"));
  assert.match(kpi.identity.displayName, /Example entity \(USD\).*subtotal \(partial\)/);
  assert.equal(kpi.semantics.state, "unknown_semantics"); assert.equal(kpi.performance.state, "unknown_semantics");
  assert.equal(kpi.recommendationAvailability, "unavailable"); assert.notEqual(kpi.manualTarget.state, "available");
  assert.notEqual(kpi.effectiveAuthoritativeTarget.state, "available");
  assert.equal(result.kpis[0].evaluation.latestPerformanceEffect, "indeterminate");
  assert.equal(output.findings.length, 0);
  const evidence = output.evidence.references;
  assert.equal(evidence.length, 2);
  assert.ok(evidence.every(ref => ref.authorityRole === "derived" && !ref.originalEvidenceEligible));
  assert.ok(evidence.some(ref => ref.recordId === id(201) && ref.sourceIds.includes(id(301)) && ref.sourceIds.includes(id(401))));
  assert.ok(evidence.some(ref => ref.recordId === id(101)));
  assert.equal(result.evidenceManifests[0].sourceRegistry.independentOriginalSourceCount, 0);
  assert.deepEqual(snapshot(result), snapshot(produce()));
});

test("separate entity and currency identities cannot combine or collide", () => {
  const other = summary({ connectionId: id(51), businessEntityId: id(41), businessEntityName: "Second entity", months: [month(2)] });
  const multi = summary({ months: [month(), month(3, { currency: "EUR" })] });
  const output = snapshot(produce([other, multi]));
  assert.equal(output.kpis.length, 3); assert.equal(new Set(output.kpis.map(k => k.identity.canonicalName)).size, 3);
  assert.throws(() => produce([summary(), { ...other, businessEntityId: ids.entity }]), /summary_invalid/);
  assert.throws(() => produce([summary(), summary()]), /summary_invalid/);
});

test("QBO producer cannot recalculate Business Health, create findings, or change existing readiness", () => {
  const intelligence = foundationIntelligenceLayerOutput(), data = produce();
  const baseline = buildIntelligenceSnapshotFromProducersV1({ workspaceId: ids.workspace, asOf: now, intelligence }).snapshot;
  const withQbo = buildIntelligenceSnapshotFromProducersV1({ workspaceId: ids.workspace, asOf: now, intelligence,
    kpis: data.kpis, evidenceManifests: data.evidenceManifests }).snapshot;
  assert.deepEqual(withQbo.businessHealth, baseline.businessHealth);
  assert.deepEqual(withQbo.findings, baseline.findings);
  assert.deepEqual(withQbo.forecastReadiness, baseline.forecastReadiness);
});
test("native order does not change producer identity and inputs remain untouched", () => {
  const first = month(1, { periodStart: "2026-08-01", periodEnd: "2026-08-31" }), second = month(2);
  const value = summary({ months: [second, first] }), before = JSON.stringify(value);
  assert.deepEqual(produce([value]), produce([summary({ months: [first, second] })]));
  assert.equal(JSON.stringify(value), before);
});

for (const state of ["disabled", "pending"]) test(`${state} has no observations or derived authority, never a zero fallback`, () => {
  const data = produce([summary({ calculationState: state, authorityEnabled: state !== "disabled", months: [], calculatedAt: null, watermark: null })]);
  assert.deepEqual(data.kpis, []); assert.deepEqual(data.evidenceManifests, []);
  const html = render({ state: "available", data, connectionsTruncated: false });
  assert.doesNotMatch(html, /100\.25|USD 0/);
});

test("empty current calculation is not an invented zero; a native zero after withdrawal is retained", () => {
  assert.equal(produce([summary({ months: [] })]).kpis.length, 0);
  const data = produce([summary({ months: [month(1, { valueCanonical: "0", supportingContributionCount: "0", provenance: [] })] })]);
  assert.equal(snapshot(data).kpis[0].observations.current.value, 0);
  assert.equal(data.evidenceManifests[0].evidence.length, 1);
});

for (const value of ["100.25", "80.25", "100.01", "0.1", "-100.01", "0", "-0.5", "9007199254740991", "0.0000001", "-0.0000001", "0.0000001234567890123456"]) test(`lossless decimal round trip ${value} is admitted for presentation`, () => assert.equal(exactQboAccountingNumber(value), Number(value)));
for (const value of ["9007199254740991.01", "-9007199254740991.01", "9007199254740992", "9007199254740993", "100.0100000000000001", "0.0000001234567890123456789", "1e3", "-0", "NaN", "Infinity", "1" + "0".repeat(309)]) {
  test(`unsafe or noncanonical number ${value} is withheld`, () => assert.equal(exactQboAccountingNumber(value), null));
}
test("normal cents survive the real Executive snapshot despite not being binary-rationally exact", () => {
  const data = produce([summary({ months: [month(1, { valueCanonical: "100.01" })] })]);
  assert.equal(snapshot(data).kpis[0].observations.current.value.toString(), "100.01");
  assert.equal(data.summaries[0].months[0].valueCanonical, "100.01");
  assert.deepEqual(data.withheldMetricIds, []);
  assert.equal(Number("0.0000001").toString(), "1e-7");
  assert.equal(exactQboAccountingNumber("0.0000001"), 1e-7);
  assert.notEqual(Number("9007199254740991.01").toString(), "9007199254740991.01");
});
test("unsafe latest month withholds the metric rather than presenting an older safe month as current", () => {
  const data = produce([summary({ months: [month(1, { periodStart: "2026-08-01", periodEnd: "2026-08-31" }), month(2, { valueCanonical: "9007199254740991.01" })] })]);
  assert.equal(data.kpis.length, 0); assert.equal(data.evidenceManifests.length, 0); assert.equal(data.withheldMetricIds.length, 1);
  const html = render({ state: "available", data, connectionsTruncated: false });
  assert.match(html, /9007199254740991\.01/); assert.match(html, /withheld to preserve decimal precision/);
});
test("open month uses partial calculation-as-of instead of month-start or a future month-end", () => {
  const calculatedAt = "2026-09-29T11:00:00.000Z", data = produce([summary({ calculatedAt })]);
  const kpi = snapshot(data).kpis[0];
  assert.equal(kpi.observations.current.observedAt, "2026-09-29");
  assert.deepEqual(kpi.freshness.value, { status: "current", ageDays: 1, latestMeasurementAt: "2026-09-29" });
  assert.match(kpi.identity.displayName, /\(partial\), as of 2026-09-29/);
  assert.equal(data.evidenceManifests[0].generatedAt, calculatedAt);
  assert.match(data.evidenceManifests[0].evidence[0].excerpt, /not total posted revenue or provider-sync freshness/);
});
test("fresh recalculation does not make an old accounting period fresh", () => {
  const data = produce([summary({ months: [month(1, { periodStart: "2026-03-01", periodEnd: "2026-03-31" })] })]);
  const kpi = snapshot(data).kpis[0];
  assert.equal(kpi.observations.current.observedAt, "2026-03-31");
  assert.equal(kpi.freshness.value.latestMeasurementAt, "2026-03-31");
  assert.equal(kpi.freshness.value.status, "old");
  assert.equal(kpi.freshness.value.ageDays, 183);
});
test("unchanged native calculation ages truthfully instead of borrowing the page request date", () => {
  const data = buildQboAccountingIntelligence({ workspaceId: ids.workspace, summaries: [summary()], asOf: "2026-11-30T12:00:00.000Z" });
  assert.equal(data.kpis[0].freshness.status, "stale"); assert.equal(data.kpis[0].freshness.ageDays, 61);
  assert.equal(data.kpis[0].observations.current.observedAt, "2026-09-30");
});
test("calculation cutoff uses the actual UTC day and never precedes the accounting period", () => {
  const data = produce([summary({ calculatedAt: "2026-09-30T00:30:00+02:00" })]);
  assert.equal(data.kpis[0].observations.current.observedAt, "2026-09-29");
  assert.throws(() => produce([summary({ calculatedAt: "2026-09-01T00:30:00+02:00" })]), /summary_invalid/);
});

const invalidChanges = [
  { coverage: "complete" }, { fullPostedRevenue: true }, { realm: "do-not-retain" }, { providerPayload: {} },
  { counts: { mapped: 1, reviewRequired: "0", nonContributing: "0", withdrawn: "0" } },
  { counts: { mapped: "01", reviewRequired: "0", nonContributing: "0", withdrawn: "0" } },
  { authorityId: null }, { authorityEnabled: false }, { calculatedAt: null }, { watermark: "not-a-fingerprint" },
  { months: [month(1, { periodStart: "2026-02-30", periodEnd: "2026-03-31" })] },
  { months: [month(1, { periodEnd: "2026-09-29" })] },
  { months: [month(1, { periodStart: "2026-10-01", periodEnd: "2026-10-31" })] },
  { months: [month(1, { valueCanonical: "100.00" })] },
  { months: [month(1, { provenance: [] })] },
  { months: [month(1, { supportingContributionCount: "0" })] },
  { months: [month(), month()] }, { months: [month(1, { provenance: [month().provenance[0], month().provenance[0]] })] },
  { calculationState: "pending" }, { months: Array.from({ length: 25 }, (_, i) => month(i + 1)) }
];
invalidChanges.forEach((change, i) => test(`strict native contract rejects malformed/contradictory summary ${i + 1}`, () => {
  assert.throws(() => parseQboAccountingSummary(summary(change), ids.workspace, ids.connection), /summary_invalid/);
}));
test("binding and freshness failures are redacted and fail closed", () => {
  assert.throws(() => parseQboAccountingSummary(summary(), id(999), ids.connection), /summary_invalid/);
  assert.throws(() => parseQboAccountingSummary(summary(), ids.workspace, id(999)), /summary_invalid/);
  assert.throws(() => produce([summary({ calculatedAt: "2026-10-01T00:00:00Z" })]), /summary_invalid/);
});

test("24 native months remain browseable; latest six observations and <=24 references fit real snapshot bounds", () => {
  const months = Array.from({ length: 24 }, (_, i) => {
    const start = new Date(Date.UTC(2024, 9 + i, 1)), end = new Date(Date.UTC(2024, 10 + i, 0));
    return month(i + 1, { periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10),
      supportingContributionCount: "50", provenance: Array.from({ length: 32 }, (_, j) => ({ factVersionId: id(1000 + i * 32 + j),
        sourceVersionId: id(5000 + i * 32 + j), sourceRecordId: id(9000 + i * 32 + j), factFingerprint: fingerprint("b") })) });
  });
  const data = produce([summary({ months })]), output = snapshot(data);
  assert.equal(data.summaries[0].months.length, 24); assert.equal(output.kpis[0].observations.selectedRange.boundedObservations.length, 6);
  assert.equal(output.kpis[0].observations.selectedRange.startAt, "2026-04-30");
  assert.equal(output.kpis[0].evidenceReferenceIds.length, 24); assert.equal(output.evidence.references.length, 24);
});

test("dormant gate denies before auth, workspace, claims, browse or RPC", async () => {
  reset(); enabled = false; assert.deepEqual(await loadQboAccountingIntelligence(ids.workspace, now), { state: "hidden" });
  assert.equal(authCalls + workspaceCalls + claimCalls + browseCalls + rpcCalls.length, 0);
});
for (const field of ["role", "user_id", "status", "workspace_id", "workspaceId", "sub", "session_id", "claims_error"]) {
  test(`owner live-session fence rejects ${field} without reading financial data`, async () => {
    reset();
    if (field === "workspaceId") member.workspaceId = id(999);
    else if (field === "sub" || field === "session_id") claims.data.claims[field] = "invalid";
    else if (field === "claims_error") claims.error = new Error("denied");
    else member.membership[field] = "invalid";
    assert.deepEqual(await loadQboAccountingIntelligence(ids.workspace, now), { state: "hidden" });
    assert.equal(browseCalls, 0); assert.equal(rpcCalls.length, 0);
  });
}
test("authenticated loader uses only own-connection summary RPC and returns real producers", async () => {
  reset(); const result = await loadQboAccountingIntelligence(ids.workspace, now);
  assert.equal(result.state, "available"); assert.equal(snapshot(result.data).kpis[0].observations.current.value, 100.25);
  assert.deepEqual(rpcCalls, [{ name: "read_qbo_customer_accounting_summary_v1", args: { p_connection_id: ids.connection } }]);
});
test("connection cap bounds work and reports partial coverage", async () => {
  reset(); connections = Array.from({ length: 6 }, (_, i) => ({ connectionId: id(50 + i) }));
  summaries = new Map(connections.map((c, i) => [c.connectionId, summary({ connectionId: c.connectionId, businessEntityId: id(60 + i), months: [month(i + 1)] })]));
  const result = await loadQboAccountingIntelligence(ids.workspace, now);
  assert.equal(result.state, "available"); assert.equal(result.connectionsTruncated, true);
  assert.equal(rpcCalls.length, 5); assert.equal(browseCalls, 1);
  assert.equal(snapshot(result.data).kpis.length, 5);
});
for (const failure of ["rpc", "browse", "workspace", "connection", "duplicate", "partial"]) test(`loader ${failure} failure never falls back to zero or exposes internal errors`, async () => {
  reset();
  if (failure === "rpc") rpcFailure = true;
  if (failure === "browse") browseFailure = true;
  if (failure === "workspace") summaries.set(ids.connection, summary({ workspaceId: id(999) }));
  if (failure === "connection") summaries.set(ids.connection, summary({ connectionId: id(999) }));
  if (failure === "duplicate") connections.push(connections[0]);
  if (failure === "partial") connections.push({ connectionId: id(99) });
  assert.deepEqual(await loadQboAccountingIntelligence(ids.workspace, now), { state: ["browse", "duplicate"].includes(failure) ? "hidden" : "unavailable" });
});
test("view escapes labels and provides internal native provenance links, not provider payloads or aggregate business-health claims", () => {
  const data = produce([summary({ businessEntityName: '<script>alert("x")</script>' })]);
  const html = render({ state: "available", data, connectionsTruncated: false });
  assert.doesNotMatch(html, /<script>|realm|access_token|refresh_token|target achieved|Business Health/i);
  assert.match(html, /&lt;script&gt;/); assert.match(html, /Partial posted revenue subtotal/); assert.match(html, /not total posted revenue/);
  assert.match(html, /Square payments are not combined/); assert.match(html, /USD<!-- --> <!-- -->100\.25|USD 100\.25/);
  assert.match(html, new RegExp(`connectionId=${ids.connection}`)); assert.match(html, new RegExp(`sourceId=${id(401)}`));
  assert.doesNotMatch(html, new RegExp(id(301))); assert.doesNotMatch(html, new RegExp(id(201)));
  assert.doesNotMatch(html, /Entity |Mapped |Review required|Non-contributing|Accounting authority is disabled/);
  assert.equal(render({ state: "hidden" }), ""); assert.doesNotMatch(render({ state: "unavailable" }), /USD|100\.25/);
});
test("page loads the actual producers before snapshot build, not a browse-only diagnostic", () => {
  const page = fs.readFileSync(path.join(root, "app/app/intelligence/page.tsx"), "utf8");
  assert.ok(page.indexOf("await loadQboAccountingIntelligence(workspaceId, snapshotAsOf)") < page.indexOf("const snapshotBuild = buildIntelligenceSnapshotFromProducersV1"));
  assert.match(page, /kpis: qboAccounting\.data\.kpis/); assert.match(page, /evidenceManifests: qboAccounting\.data\.evidenceManifests/);
  assert.match(page, /<QboAccountingIntelligenceView result=\{qboAccounting\}/);
});
test("new scope has no privileged client, mutation, provider transport, or model execution path", () => {
  for (const file of ["accounting-intelligence.ts", "accounting-intelligence-server.ts", "accounting-intelligence-view.tsx"]) {
    const source = fs.readFileSync(path.join(root, "lib/integrations/qbo-customer", file), "utf8");
    assert.doesNotMatch(source, /service_role|createAdminClient|\.insert\(|\.update\(|\.delete\(|\bfetch\(|generateText\(|generateObject\(|NEXT_PUBLIC_/);
  }
});

for (const provider of ["QuickBooks", "Square", "Google Sheets", "future provider"]) {
  test(`${provider}: an attempt or its age is not a successful connection`, () => {
    for (const connectionState of ["setup", "sync_error", "disconnected", "reauthorization_required"]) {
      const visibility = integrationResultVisibility({ successfulAuthorization: false, hasImportedData: false,
        connectionState, lastSuccessfulSyncAt: null, freshness: "stale" });
      assert.equal(visibility.visible, false); assert.equal(visibility.requiresReconnect, false); assert.equal(visibility.status, null);
    }
  });
}
test("shared presentation distinguishes first import, stale data, revoked access and intentional disconnect", () => {
  const base = { successfulAuthorization: true, hasImportedData: false, connectionState: "connected", lastSuccessfulSyncAt: null, freshness: "unknown" };
  assert.match(integrationResultVisibility(base).status, /A completed sync has not been recorded yet/);
  const old = { ...base, hasImportedData: true, lastSuccessfulSyncAt: "2020-01-01T00:00:00Z", freshness: "stale" };
  assert.equal(integrationResultVisibility(old).requiresReconnect, false);
  assert.match(integrationResultVisibility(old).status, /Sync is delayed/);
  const disconnected = integrationResultVisibility({ ...old, connectionState: "disconnected" });
  assert.equal(disconnected.visible, true); assert.equal(disconnected.requiresReconnect, false);
  assert.match(disconnected.status, /Disconnected/); assert.equal(disconnected.lastSuccessfulSyncAt, old.lastSuccessfulSyncAt);
  assert.equal(integrationResultVisibility({ ...old, connectionState: "reauthorization_required" }).requiresReconnect, true);
});
for (const status of ["pending_authorization", "error", "disconnected", "reauthorization_required"]) {
  test(`unconsented ${status} attempts never request accounting summaries or produce empty panels`, async () => {
    reset(); connections = Array.from({ length: 7 }, (_, i) => ({ connectionId: id(50 + i), status, scopes: [] }));
    const result = await loadQboAccountingIntelligence(ids.workspace, now);
    assert.deepEqual(result, { state: "hidden" }); assert.equal(render(result), "");
    assert.equal(rpcCalls.filter(c => c.name === "read_qbo_customer_accounting_summary_v1").length, 0);
  });
}
test("unsuccessful attempts cannot consume the business-result connection limit", async () => {
  reset(); connections = [...Array.from({ length: 99 }, (_, i) => ({ connectionId: id(500 + i), status: "disconnected", scopes: [] })),
    { connectionId: ids.connection, label: "Real company" }];
  const result = await loadQboAccountingIntelligence(ids.workspace, now);
  assert.equal(result.state, "available"); assert.equal(result.connectionsTruncated, false); assert.equal(result.data.summaries.length, 1);
  assert.deepEqual(rpcCalls.filter(c => c.name === "read_qbo_customer_accounting_summary_v1").map(c => c.args.p_connection_id), [ids.connection]);
  assert.equal(rpcCalls.length, 1); assert.equal(browseCalls, 1);
});
test("successful connection awaiting import shows a concise status, never zero financial activity", async () => {
  reset(); summaries.set(ids.connection, summary({ authorityEnabled: false, authorityId: null, calculationState: "disabled", months: [], calculatedAt: null, watermark: null }));
  const result = await loadQboAccountingIntelligence(ids.workspace, now), html = render(result);
  assert.match(html, /A completed sync has not been recorded yet/);
  assert.doesNotMatch(html, /Mapped|Entity |Coverage|USD|Partial posted revenue|Accounting authority is disabled/);
  assert.equal(result.data.kpis.length, 0);
});
test("stored source history remains browseable without inventing current accounting authority", async () => {
  reset(); connections = [{ connectionId: ids.connection, status: "disconnected", scopes: [] }];
  summaries.set(ids.connection, summary({ authorityEnabled: false, authorityId: null, calculationState: "disabled", months: [], calculatedAt: null, watermark: null }));
  importedIds.add(ids.connection);
  const result = await loadQboAccountingIntelligence(ids.workspace, now);
  assert.equal(result.state, "available"); assert.equal(result.connections.length, 1);
  assert.match(result.connections[0].visibility.status, /Disconnected/);
  assert.match(render(result), /View imported data/); assert.deepEqual(result.data.kpis, []);
});
test("expired access and disconnected history retain navigation and truthful sync time, not current financial authority", async () => {
  for (const status of ["reauthorization_required", "disconnected", "active"]) {
    reset(); connections = [{ connectionId: ids.connection, status }];
    if (status !== "active") summaries.set(ids.connection, summary({ authorityEnabled: false, authorityId: null, calculationState: "disabled", months: [], calculatedAt: null, watermark: null }));
    freshnessRows = [{ connection_id: ids.connection, status: "stale", last_successful_sync_at: "2026-01-01T00:00:00Z" }];
    const result = await loadQboAccountingIntelligence(ids.workspace, now), html = render(result);
    if (status === "active") assert.match(html, /100\.25/);
    else { assert.doesNotMatch(html, /100\.25/); assert.deepEqual(result.data.kpis, []); }
    assert.match(html, /View imported data/); assert.match(html, /Last successful sync/); assert.match(html, /2026-01-01T00:00:00Z/);
    assert.equal(result.connections[0].visibility.requiresReconnect, status === "reauthorization_required");
    if (status === "disconnected") assert.match(html, /Disconnected/);
    if (status === "active") assert.match(html, /Sync is delayed/);
  }
});
test("legitimate distinct companies stay separate; no financial combining or technical ID wall", async () => {
  reset(); connections = [{ connectionId: ids.connection, label: "First company" }, { connectionId: id(51), label: "Second company" }];
  summaries.set(id(51), summary({ connectionId: id(51), businessEntityId: id(61), businessEntityName: "Second entity", months: [month(2, { valueCanonical: "80.25" })] }));
  const result = await loadQboAccountingIntelligence(ids.workspace, now), html = render(result);
  assert.equal(result.data.kpis.length, 2); assert.equal(result.data.summaries.length, 2);
  assert.match(html, /First company/); assert.match(html, /Second company/); assert.match(html, /100\.25/); assert.match(html, /80\.25/);
  assert.doesNotMatch(html, /180\.50|Entity |Fact |Source version /);
  assert.match(html, new RegExp(`connectionId=${id(51)}`)); assert.match(html, new RegExp(`connectionId=${ids.connection}`));
});
test("empty provider detail has setup navigation without zero counts or coverage warnings", () => {
  reset(); connections = [{ connectionId: ids.connection, status: "disconnected", scopes: [] }];
  const html = renderToStaticMarkup(React.createElement(QboStoredDataView, { browser: emptyBrowser(ids.connection),
    query: { connectionId: ids.connection, kind: "all", after: null, sourceId: null } }));
  assert.match(html, /No imported QuickBooks data/); assert.match(html, /Manage QuickBooks connections and setup/);
  assert.doesNotMatch(html, /Stored-data coverage|Unknown basis|Missing currency|<dd|Combined Square/);
  assert.match(html, /does not mean zero activity/);
});
