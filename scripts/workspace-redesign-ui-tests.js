/* Focused local render/boundary tests. No browser, backend, network or DB execution. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { build, createServer } = require("./workspace-redesign-preview.cjs");
function loadFixture(relative) {
  const filename = path.join(__dirname, "workspace-redesign-fixture", relative);
  const loaded = { exports: {} };
  Function("require", "module", "exports", ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(require, loaded, loaded.exports);
  return loaded.exports;
}
async function verifyNoteSubmissionBoundary() {
  const { classifyFixtureSubmission, preserveSyntheticNoteOnReset } = loadFixture("form-boundary.ts");
  const { fixtureAction } = loadFixture("actions.ts");
  const origin = "http://127.0.0.1:3186";
  const reactAction = "javascript:throw new Error('React function action')";
  assert.equal(classifyFixtureSubmission(null, reactAction, origin).kind, "react-action", "default DOM method must not turn a React action into GET navigation");
  assert.equal(classifyFixtureSubmission("get", reactAction, origin).kind, "react-action");
  assert.equal(classifyFixtureSubmission("get", "/app/sources", origin).kind, "get");
  for (const [method, action] of [[null, "/app/sources"], ["get", "https://example.invalid/app/sources"], ["get", "/api/search"], ["post", "/app/sources"], ["get", "//example.invalid/app"]]) {
    assert.equal(classifyFixtureSubmission(method, action, origin).kind, "blocked");
  }
  const listeners = new Map(), values = new Map([["note_text", "Synthetic operations note: review the Friday handoff."], ["observation_date", "2026-09-29"]]);
  let resets = 0;
  const form = { querySelector: selector => selector === 'textarea[name="note_text"]' ? {} : null, addEventListener(name, listener) { assert.ok(!listeners.has(name)); listeners.set(name, listener); }, reset() { const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; listeners.get("reset")?.(event); if (!event.defaultPrevented) { values.clear(); resets++; } } };
  preserveSyntheticNoteOnReset(form);
  preserveSyntheticNoteOnReset(form);
  const note = new FormData(); for (const [key, value] of values) note.set(key, value);
  const oldWindow = global.window, feedback = [];
  global.window = { dispatchEvent(event) { feedback.push(event.detail); } };
  try {
    const result = await fixtureAction("submitBusinessNoteForReviewAction")(note);
    assert.equal(result.ok, false);
    assert.match(result.message, /unavailable.*Nothing was sent or saved.*preserved/);
    assert.ok(feedback.includes(result.message), "readable unavailable message reaches the fixture status region");
    form.reset(); // Model React's post-resolution uncontrolled-form reset.
    assert.equal(resets, 0);
    assert.equal(values.get("note_text"), note.get("note_text"));
    assert.equal(values.get("observation_date"), "2026-09-29");
  } finally { global.window = oldWindow; }
}
async function main() {
  await verifyNoteSubmissionBoundary();
  const result = await build({ test: true });
  const screens = require(path.join(result.output, "render.cjs"));
  const { renderToStaticMarkup } = require("react-dom/server");
  const alternatives = await Promise.all(["scorecard", "arc"].map(async variant => renderToStaticMarkup(await screens.renderScreen("/app", "populated", "owner", new URLSearchParams({ healthVisual: variant })))));
  const withoutInstrument = html => {
    const start = html.indexOf('<div class="workspace-health-instrument ');
    const end = html.indexOf('<dl class="workspace-health-facts', start);
    assert.ok(start >= 0 && end > start);
    return html.slice(0, start) + html.slice(end);
  };
  assert.equal(withoutInstrument(alternatives[0]), withoutInstrument(alternatives[1]), "Both visuals must use identical breakdown, assessment, actions, trend history and other screen content");
  for (const healthVisual of ["scorecard", "arc"]) {
    const emptyBody = await screens.renderScreen("/app", "empty", "owner", new URLSearchParams({ healthVisual }));
    const emptyHtml = renderToStaticMarkup(emptyBody);
    const { model, businessHealthAnalysis } = emptyBody.props;
    assert.match(emptyHtml, /Business Health unavailable\. Limited evidence\./);
    assert.doesNotMatch(emptyHtml, /87%|95%|Order fulfillment|Watch|Improving|Up 4 points/);
    assert.equal(model.health.trend, null);
    assert.equal(model.health.confidence, "Low");
    // Verify the actual props passed to the closed analysis drawer too: SSR
    // alone does not render its facts until the existing View analysis opens it.
    assert.deepEqual(businessHealthAnalysis.facts, {
      available: false, score: null, status: "Limited evidence", trajectory: null,
      comparison: "No valid previous review is available for comparison.", comparisonDelta: null,
      dataQualityBase: 50, riskPenalty: 0, opportunityAdjustment: 0, confidence: "Low",
      freshness: "unavailable", latestEvidenceAt: null, deterministicSummary: model.health.summary,
      drivers: [], limitations: ["Synthetic preview; not a business assessment."]
    });
    assert.equal(businessHealthAnalysis.state.artifact, null);
    assert.equal(businessHealthAnalysis.requestToken, null);
  }
  let rendered = 0;
  for (const route of screens.routes) for (const state of ["populated", "empty", "loading", "error"]) for (const role of ["owner", "viewer"]) {
    try {
      const body = await screens.renderScreen(route.href, state, role);
      const html = renderToStaticMarkup(screens.wrapScreen(body, role, route.href));
      if (route.href === "/app/settings/integrations/square") {
        assert.doesNotMatch(html, /workspace-content|workspace-sidebar|workspace-topbar|aria-label="Vaeroex Overview"|aria-label="Workspace switcher"/, "Square is standalone, matching its real route group; its own theme wrapper is allowed");
        if (state === "populated" || state === "empty") assert.match(html, /Back to Settings/);
      } else {
        assert.ok(html.includes("Harbor Supply"), `${route.label}: real shell workspace`);
        assert.ok(html.includes("vaeroex-app-shell"), `${route.label}: actual shell`);
      }
      assert.ok(!html.includes("Fixture boundary needs an adapter"));
      if (route.href === "/app/intelligence") assert.doesNotMatch(html, /QuickBooks admitted posted revenue subtotal|QuickBooks accounting summary unavailable|aria-label="Connected data"/,
        "real integration views stay hidden without established connections in this closed workspace fixture");
      if (state === "loading") assert.match(html, /aria-busy|animate-pulse/);
      if (state === "error") assert.match(html, /Synthetic unavailable state/);
      rendered++;
    } catch (error) { throw new Error(`${route.label}/${state}/${role}: ${error.stack}`); }
  }
  const boundary = JSON.parse(fs.readFileSync(path.join(result.output, "boundary.json"), "utf8"));
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/components/app/AppShell.tsx")));
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/app/app/kpis/page.tsx")));
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/app/app/sources/SourcesPage.tsx")));
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/lib/integrations/qbo-customer/accounting-intelligence-view.tsx")), "render the real accounting view, not a component stub");
  assert.ok(!boundary.moduleFiles.some(file => file.endsWith("/lib/integrations/qbo-customer/accounting-intelligence-server.ts")), "no operational accounting loader enters the synthetic preview");
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/components/integrations/SquareSheetsResultsView.tsx")), "render the real integration result view with empty synthetic results");
  assert.ok(!boundary.moduleFiles.some(file => file.endsWith("/components/integrations/SquareSheetsResults.tsx")), "no operational result loader enters the synthetic preview");
  assert.ok(!boundary.moduleFiles.some(file => /\/lib\/supabase\/(server|client|admin)\./.test(file)));
  assert.throws(() => createServer({ ...result, port: 3000 }), /comparison ports/);
  console.log(`Workspace preview: note form classification, readable unavailable result and reset preservation passed; ${rendered} route/state/role server renders passed (six AppShell routes + standalone Square); live-client import boundary verified. No browser/backend authorization testing claimed.`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
