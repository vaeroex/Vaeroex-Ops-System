/* Focused local render/boundary tests. No browser, backend, network or DB execution. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { build, createServer, actionModules, actionExportContracts } = require("./workspace-redesign-preview.cjs");
function loadFixture(relative) {
  const filename = path.join(__dirname, "workspace-redesign-fixture", relative);
  const loaded = { exports: {} };
  Function("require", "module", "exports", ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(require, loaded, loaded.exports);
  return loaded.exports;
}
function verifyIntelligenceRenderBoundary() {
  const filename = path.join(__dirname, "..", "app/app/intelligence/page.tsx");
  const source = fs.readFileSync(filename, "utf8");
  const loader = require("./workspace-redesign-fixture/loader.cjs");
  const adapt = value => loader.call({ resourcePath: filename, getOptions: () => ({ intelligencePage: filename,
    readRuntime: path.join(__dirname, "workspace-redesign-fixture/read-adapters.ts"), allowedActions: [] }) }, value);
  const output = adapt(source);
  assert.match(output, /import \{ CurrentIntegrations \} from "@\/components\/integrations\/CurrentIntegrations"/);
  assert.doesNotMatch(output, /requireWorkspaceAccess|requireWorkspacePage|loadIntegrationDashboard|loadQboAccountingIntelligence|supabase/,
    "Only the final render and static fixture inputs survive the server page adapter");
  const binding = '<CurrentIntegrations key={workspaceId} initial={dashboard} />';
  assert.ok(source.includes(binding));
  for (const replacement of ["", binding + binding, '<CurrentIntegrations initial={dashboard} />', '<CurrentIntegrations key={workspaceId} initial={otherDashboard} />']) {
    assert.throws(() => adapt(source.replace(binding, replacement)), /dashboard binding changed/);
  }
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
async function verifyReportingTimezoneActionBoundary() {
  const relative = "app/app/settings/reporting-timezone-action.ts";
  const filename = path.join(__dirname, "..", relative);
  const runtime = path.join(__dirname, "workspace-redesign-fixture/actions.ts");
  const source = fs.readFileSync(filename, "utf8");
  const loader = require("./workspace-redesign-fixture/loader.cjs");
  const options = { allowedActions: actionModules.map(file => path.join(__dirname, "..", file)),
    allowedActionExports: Object.fromEntries(Object.entries(actionExportContracts).map(([file, names]) => [path.join(__dirname, "..", file), names])),
    actionRuntime: runtime };
  assert.deepEqual(options.allowedActionExports[filename], ["saveReportingTimezoneAction"]);
  assert.equal(options.allowedActions.filter(file => file === filename).length, 1);
  const adapt = (value, resourcePath = filename) => loader.call({ resourcePath, getOptions: () => options }, value);
  const output = adapt(source);
  assert.doesNotMatch(output, /requireWorkspaceAccess|revalidatePath|supabase|reporting_timezone|next\/cache/,
    "The action body and operational imports must be removed, not executed with relaxed auth stubs");
  for (const changed of [
    source.replaceAll("saveReportingTimezoneAction", "unreviewedTimezoneAction"),
    source + "\nexport async function anotherAction() {}",
    source + "\nexport const anotherAction = async () => {};",
    source + "\nexport default async function anotherAction() {}",
    source + "\nexport { saveReportingTimezoneAction as anotherAction };",
    source + '\nexport * from "./other-action";',
    source.replace("export async function saveReportingTimezoneAction", "async function saveReportingTimezoneAction"),
  ]) assert.throws(() => adapt(changed), /Unreviewed server-action exports/);
  assert.throws(() => adapt(source, path.join(path.dirname(filename), "unreviewed-action.ts")), /Unreviewed server-action import/);
  const { fixtureAction } = loadFixture("actions.ts");
  const generated = { exports: {} }, names = [];
  const compiled = ts.transpileModule(output, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  Function("require", "module", "exports", compiled)(specifier => {
    assert.equal(specifier, runtime, "The generated action may import only the inert fixture runtime");
    return { fixtureAction(name) { names.push(name); return fixtureAction(name); } };
  }, generated, generated.exports);
  assert.deepEqual(names, ["saveReportingTimezoneAction"]);
  assert.deepEqual(Object.keys(generated.exports), ["saveReportingTimezoneAction"]);
  const data = new FormData();
  data.set("expectedWorkspaceId", "00000000-0000-4000-8000-000000000001");
  data.set("reportingTimezone", "America/Los_Angeles");
  const result = await generated.exports.saveReportingTimezoneAction({ status: "idle" }, data);
  assert.equal(result.status, "error");
  assert.match(result.message, /Synthetic preview: timezone saving is unavailable\. No workspace setting was changed\./);
  assert.equal(data.get("reportingTimezone"), "America/Los_Angeles");
}
function findElements(node, name) {
  if (Array.isArray(node)) return node.flatMap(child => findElements(child, name));
  if (!node || typeof node !== "object") return [];
  return [...(node.type?.name === name ? [node] : []), ...findElements(node.props?.children, name)];
}
async function main() {
  verifyIntelligenceRenderBoundary();
  await verifyReportingTimezoneActionBoundary();
  await verifyNoteSubmissionBoundary();
  const result = await build({ test: true });
  const screens = require(path.join(result.output, "render.cjs"));
  const { renderToStaticMarkup } = require("react-dom/server");
  const overviewHtml = renderToStaticMarkup(await screens.renderScreen("/app", "populated", "owner"));
  assert.match(overviewHtml, /href="\/app\/intelligence#business-health"/, "Overview retains a direct path to Health");
  assert.doesNotMatch(overviewHtml, /id="business-health"|View analysis/, "Health review controls belong to Intelligence");
  for (const role of ["owner", "viewer"]) {
    const emptyBody = await screens.renderScreen("/app/intelligence", "empty", role);
    const emptyHtml = renderToStaticMarkup(emptyBody);
    const snapshot = findElements(emptyBody, "IntelligenceHealthSnapshot")[0];
    assert.ok(snapshot, "the actual Intelligence render contains its Health snapshot");
    const { health, facts, analysis } = snapshot.props;
    const model = { health };
    const businessHealthAnalysis = { facts, ...analysis };
    assert.match(emptyHtml, /Business Health score unavailable/);
    assert.doesNotMatch(emptyHtml, /87%|95%|Order fulfillment|Up 4 points/);
    assert.equal(health.trend, null);
    assert.equal(health.confidence, "Low");
    // Inspect the actual immutable props forwarded to the unchanged analysis drawer.
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
        assert.doesNotMatch(html, /workspace-content|workspace-sidebar|workspace-topbar|aria-label="Vaeroex (?:Overview|Intelligence)"|aria-label="Workspace switcher"/, "Square is standalone, matching its real route group; its own theme wrapper is allowed");
        if (state === "populated" || state === "empty") assert.match(html, /Back to Settings/);
      } else {
        assert.ok(html.includes("Harbor Supply"), `${route.label}: real shell workspace`);
        assert.ok(html.includes("vaeroex-app-shell"), `${route.label}: actual shell`);
      }
      assert.ok(!html.includes("Fixture boundary needs an adapter"));
      if (route.href === "/app/intelligence") {
        assert.doesNotMatch(html, /QuickBooks admitted posted revenue subtotal|QuickBooks accounting summary unavailable|aria-label="Connected data"/,
          "Former integration sections stay absent from the dashboard fixture");
        if (state === "populated" || state === "empty") {
          const integrations = body.props.children.find(child => child?.type?.name === "CurrentIntegrations");
          assert.ok(integrations, "The unchanged page JSX renders the real CurrentIntegrations client");
          assert.deepEqual(integrations.props.initial, {
            workspaceId: "00000000-0000-4000-8000-000000000001", observedAt: screens.AS_OF,
            timeZone: "UTC", timeZoneConfirmed: false, preferencesAvailable: false, entries: [], unavailable: []
          }, "Every role/state receives the same safe, static empty dashboard");
          assert.equal(integrations.key, integrations.props.initial.workspaceId, "The dashboard retains its workspace remount key");
          for (const value of [integrations.props.initial, integrations.props.initial.entries, integrations.props.initial.unavailable]) assert.ok(Object.isFrozen(value));
          assert.match(html, /id="current-integrations-heading"/);
          assert.match(html, /No active integrations/);
          assert.match(html, /href="\/app\/integrations"/);
          assert.match(html, /aria-label="Refresh integration status"/);
          assert.match(html, /Current findings and history/);
          assert.match(html, /id="intelligence-briefings-heading"/);
          assert.match(html, /href="\/app\/intelligence\/briefings"/);
          assert.doesNotMatch(html, /Previously connected|Hidden integrations|View supporting data/);
        }
      }
      if (route.href === "/app/settings" && (state === "populated" || state === "empty")) {
        const forms = findElements(body, "ReportingTimezoneForm");
        assert.equal(forms.length, role === "owner" ? 1 : 0, "Only the owner sees the real timezone form");
        assert.match(html, /Reporting timezone/);
        assert.match(html, /Not configured \(UTC\)/);
        assert.match(html, /name="password"/);
        assert.match(html, /name="confirm_password"/);
        if (role === "owner") {
          const form = forms[0];
          assert.equal(form.props.workspaceId, "00000000-0000-4000-8000-000000000001");
          assert.equal(form.key, form.props.workspaceId);
          assert.equal(form.props.reportingTimezone, null);
          assert.ok(form.props.timeZones.includes("UTC"));
          assert.ok(form.props.timeZones.includes("America/Los_Angeles"));
          assert.equal(new Set(form.props.timeZones).size, form.props.timeZones.length);
          assert.match(html, /name="expectedWorkspaceId" value="00000000-0000-4000-8000-000000000001"/);
          assert.match(html, /<select name="reportingTimezone"/);
          assert.match(html, /<option value="" selected="">Not configured \(UTC\)<\/option>/);
          assert.match(html, /Save timezone/);
        } else assert.doesNotMatch(html, /name="expectedWorkspaceId"|name="reportingTimezone"|Save timezone/);
      }
      if (state === "loading") assert.match(html, /aria-busy|animate-pulse/);
      if (state === "error") assert.match(html, /Synthetic unavailable state/);
      rendered++;
    } catch (error) { throw new Error(`${route.label}/${state}/${role}: ${error.stack}`); }
  }
  const boundary = JSON.parse(fs.readFileSync(path.join(result.output, "boundary.json"), "utf8"));
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/components/app/AppShell.tsx")));
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/app/app/kpis/page.tsx")));
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/app/app/sources/SourcesPage.tsx")));
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/components/integrations/CurrentIntegrations.tsx")), "render the real dashboard client, not a component stub");
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/lib/integrations/dashboard/model.ts")), "use the real dashboard client model");
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/components/settings/ReportingTimezoneForm.tsx")), "render the real Settings form, not a component stub");
  assert.ok(boundary.moduleFiles.some(file => file.endsWith("/app/app/settings/reporting-timezone-action.ts")), "the reviewed action resource passes through the inert export adapter");
  for (const file of [
    "/lib/integrations/dashboard/server.ts", "/lib/integrations/qbo-customer/accounting-intelligence-server.ts",
    "/lib/security/require-workspace-access.ts", "/lib/workspaces/page-context.ts",
    "/node_modules/next/cache.js",
    "/components/integrations/SquareSheetsResults.tsx", "/components/integrations/SquareSheetsResultsView.tsx",
    "/lib/integrations/qbo-customer/accounting-intelligence-view.tsx"
  ]) assert.ok(!boundary.moduleFiles.some(moduleFile => moduleFile.endsWith(file)), `No operational loader or replaced integration view enters the synthetic preview: ${file}`);
  assert.ok(!boundary.moduleFiles.some(file => /\/lib\/supabase\/(server|client|admin)\./.test(file)));
  assert.throws(() => createServer({ ...result, port: 3000 }), /comparison ports/);
  console.log(`Workspace preview: note form classification, readable unavailable result and reset preservation passed; ${rendered} route/state/role server renders passed (six AppShell routes + standalone Square); real CurrentIntegrations empty dashboard, inbox/briefings, owner-only Settings timezone form, exact inert action export and live-client import boundary verified. No browser/backend authorization testing claimed.`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
