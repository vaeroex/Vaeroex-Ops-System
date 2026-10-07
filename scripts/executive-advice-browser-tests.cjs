/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic browser fixture; no provider or database access. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { chromium } = require("playwright");
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const { root, loadSource } = require("./integrations-ui-test-support");

const stub = loadSource("scripts/test-stubs/executive-advice-browser-stubs.tsx");
const mocks = {
  "next/link": { __esModule: true, default: stub.default },
  "next/navigation": { useRouter: stub.useRouter },
  "@/app/app/finding-explanation/actions": stub,
  "@/app/app/intelligence/lifecycle-actions": stub,
  "@/app/app/business-health-analysis/actions": stub,
  "@/components/reports/SaveAnalysisButton": stub,
  "@/components/spatial/SpatialSurface": stub
};
const { IntelligenceSignalInbox } = loadSource("components/intelligence/IntelligenceSignalInbox.tsx", mocks);
const { BusinessHealthAnalysisPanel } = loadSource("components/intelligence/BusinessHealthAnalysisPanel.tsx", mocks);
const action = "Now examine the underlying reviews for the affected periods, group recurring complaint themes, and assign an owner to follow up on each verified theme. No review text accompanies this KPI record; obtain review text, dates, and identifiers from the source. Confirm how the KPI counts reviews before treating its value as unique reviews.";
const insight = {
  id: "synthetic-review-risk", type: "Risk", title: "1-Star Reviews remained above target for 6 periods",
  summary: "Actual 37 vs target 0.", why: "The recorded KPI is above its confirmed maximum.",
  impact: "The gap needs source review before a cause or business effect is inferred.", recommendedAction: action,
  confidence: "Medium", evidence: [], evidenceCount: 1, supportingRecords: [], independentSourceCount: 1,
  contradictoryEvidence: [], missingEvidence: ["Review-level text, dates, and identifiers"], sourceTypes: ["KPIs"],
  sourceHref: "/app/kpis", priority: "High", lastUpdated: "2026-06-01", affectedArea: "Customer feedback",
  timePeriod: "2026-06-01", limitation: "The aggregate does not establish a cause or unique-review count.", fingerprint: "synthetic-review-risk"
};
const card = {
  findingKeyHash: "synthetic-review-risk", findingId: "synthetic-review-risk", materialSignature: "material-review-risk",
  insight, snapshot: { version: "intelligence_card_lifecycle_v1", findingId: insight.id, type: "Risk", title: insight.title,
    summary: insight.summary, priority: "High", confidence: "Medium", affectedArea: insight.affectedArea, lastUpdated: insight.lastUpdated },
  lifecycleState: "active", pinned: false, view: "current", currentFeedStatus: "surfaced", reopenReason: null,
  reopenedFrom: null, reasonCode: null, reasonText: null, dismissedBy: null, recheckAfter: null, stateChangedAt: null, lifecycleToken: null
};
function additionalCard(id, type, title, recommendedAction) {
  const next = { ...insight, id, type, title, recommendedAction, fingerprint: id, priority: type === "Opportunity" ? "Medium" : "High" };
  return { ...card, findingKeyHash: id, findingId: id, materialSignature: `material-${id}`, insight: next,
    snapshot: { ...card.snapshot, findingId: id, type, title, priority: next.priority } };
}
const coldAction = "Now inspect Cold-chain excursion rate KPI source measurements for 2026-04-01 to 2026-06-01. Compare dated values with the maximum target and prior periods (percent). Obtain dated shipment-level numerator and denominator source rows with IDs; verify the calculation before assigning a cause. Assign an owner to verify the largest gap and document follow-up or unknowns.";
const anomalyAction = "Now inspect Pick log · row 14 and Pick log · row 21 for 2026-06-10 to 2026-06-11. Compare dated records by Site, Shift, Status where comparable groups exist; otherwise obtain them. Obtain pick event timestamps and reason codes before assigning a cause. Assign an owner to verify each affected record and document resolution, escalation, or unknowns.";
const opportunityAction = "Inspect Billable utilization KPI source measurements for 2026-04-01 to 2026-06-01. Compare dated records by Team where comparable groups exist; otherwise obtain them. Obtain dated numerator and denominator source rows with IDs; verify the calculation before assigning a cause. Assign an owner to verify repeatability and document what, if anything, should be preserved or tested.";
const healthFacts = {
  score: 50, status: "Watch", trajectory: "Holding steady", comparison: "Unchanged", dataQualityBase: 50,
  riskPenalty: 18, opportunityAdjustment: 18, confidence: "Medium", freshness: "stale",
  limitations: ["The newest supporting evidence is older than 45 days."], available: true, comparisonDelta: 0,
  latestEvidenceAt: "2026-06-01T00:00:00Z", deterministicSummary: "The score is watch; the review KPI is a negative driver.",
  drivers: [{ kind: "risk", label: insight.title, fact: insight.summary, scoreImpact: -18, citationIds: [1],
    limitation: insight.limitation, investigationNext: "Refresh the review KPI and source records now; then examine the underlying reviews." }]
};
const citation = { citationId: 1, title: "1-Star Reviews", sourceLabel: "Synthetic KPI workbook", sourceType: "KPI",
  excerpt: "A review KPI value was recorded.", recordedAt: "2026-06-01T00:00:00Z" };
const artifact = { analysis: {
  executive_interpretation: "1-Star Reviews is the main negative driver of the recorded Business Health score.",
  why_it_matters: "Leadership should prioritize checking the review KPI while treating the stale score as historical.",
  leadership_consideration: "Refresh the review KPI and source records now; then inspect the underlying reviews and assign an owner for verified complaint themes.",
  provisional_hypothesis: null
}, facts: healthFacts, citations: [citation], fingerprint: "synthetic-health", generatedAt: "2026-07-15T00:00:00Z" };
const fixture = { findings: { currentCards: [card,
  additionalCard("synthetic-cold-risk", "Risk", "Cold-chain excursion rate remained above target for 3 periods", coldAction),
  additionalCard("synthetic-pick-anomaly", "Anomaly", "Warehouse pick exceptions", anomalyAction),
  additionalCard("synthetic-utilization-opportunity", "Opportunity", "Billable utilization is on or above target", opportunityAction)
], historyCards: [], canManageLifecycle: false },
  health: { initialState: { status: "current", artifact, message: null }, requestToken: null, currentFacts: healthFacts, currentCitations: [citation] } };

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "executive-advice-browser-"));
  const webpack = require("next/dist/compiled/webpack/webpack"); webpack.init();
  const stubPath = path.join(root, "scripts/test-stubs/executive-advice-browser-stubs.tsx");
  await new Promise((resolve, reject) => webpack.webpack({ mode: "development", context: root, target: "web", devtool: false, optimization: { minimize: false },
    entry: path.join(root, "scripts/test-stubs/executive-advice-browser-entry.tsx"), output: { path: output, filename: "fixture.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], alias: Object.fromEntries([
      "next/link", "next/navigation", "@/app/app/finding-explanation/actions", "@/app/app/intelligence/lifecycle-actions",
      "@/app/app/business-health-analysis/actions", "@/components/reports/SaveAnalysisButton", "@/components/spatial/SpatialSurface"
    ].map(name => [name + "$", stubPath]).concat([["@", root]])) },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "scripts/test-stubs/qbo-browser-typescript-loader.cjs") }] }
  }, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const config = loadSource("tailwind.config.ts").default;
  const css = (await postcss([tailwind({ ...config, content: [
    path.join(root, "components/intelligence/IntelligenceSignalInbox.tsx"),
    path.join(root, "components/intelligence/BusinessHealthAnalysisPanel.tsx")
  ] })]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="vaeroex-customer-workspace bg-[#07101f]"><main class="mx-auto max-w-6xl p-4"><div id="findings">${renderToString(React.createElement(IntelligenceSignalInbox, fixture.findings))}</div><div id="health" class="mt-8">${renderToString(React.createElement(BusinessHealthAnalysisPanel, fixture.health))}</div></main><script id="fixture-data" type="application/json">${JSON.stringify(fixture)}</script><script src="/fixture.js"></script></body></html>`;
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") { response.writeHead(200, { "content-type": "application/javascript" }); response.end(fs.readFileSync(path.join(output, "fixture.js"))); return; }
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); response.end(html);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    browser = await chromium.launch({ headless: true, ...(fs.existsSync(localChrome) ? { executablePath: localChrome } : {}), args: ["--disable-background-networking"] });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
      const page = await context.newPage(); const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.goto(origin, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /1-Star Reviews remained above target/ }).click();
      const detail = page.getByRole("complementary", { name: "Selected finding" });
      await detail.getByText(/Confirm how the KPI counts reviews before treating its value as unique reviews/).waitFor();
      assert.equal(await detail.getByText(/Decide whether leadership should investigate/).count(), 0);
      for (const [title, actionText] of [
        ["Cold-chain excursion rate remained above target for 3 periods", /shipment-level numerator and denominator/],
        ["Warehouse pick exceptions", /Pick log · row 14 and Pick log · row 21/],
        ["Billable utilization is on or above target", /verify repeatability and document what/]
      ]) {
        if (width === 390) await detail.getByRole("button", { name: /Back to list/ }).click();
        await page.getByRole("button", { name: new RegExp(title) }).click();
        await detail.getByText(actionText).waitFor();
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `findings overflow at ${width}px`);
      await page.getByRole("button", { name: "View analysis" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText(/Refresh the review KPI and source records now/).waitFor();
      await dialog.getByText("The newest supporting evidence is older than 45 days.").waitFor();
      await dialog.locator("summary").filter({ hasText: /^Supporting evidence/ }).click();
      await dialog.getByText("Synthetic KPI workbook").waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Health dialog overflow at ${width}px`);
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("Executive advice browser PASS: hydrated synthetic Intelligence and Health at 1440px and 390px; no external requests. Artifacts:", output);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
