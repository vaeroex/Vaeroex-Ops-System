/* Local-only actual Performance SSR and exact business-contract preservation. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { renderToStaticMarkup } = require("react-dom/server");
const { build } = require("./workspace-redesign-preview.cjs");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app/app/kpis/page.tsx"), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter({ removeComments: true });
const print = (node) => printer.printNode(ts.EmitHint.Unspecified, node, ast);
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

// Frozen from main 75c3d61. Only the read-only list/timeline presentation
// helpers and the overview-only search/category/count statements are outside
// these checks. Existing status filtering for records and comparison is frozen.
// No new whole-file hash is accepted in place of the original business logic.
const protectedFunctions = ["lower", "explicitKpiDirection", "metricTone", "statusLabel", "kpiStatusText", "statusForTone", "toneClasses", "formatMetricValue", "formatNumericValue", "formatSettingValue", "formatTargetReference", "monthSpan", "recommendedTargetForMetric", "KpiStatusBadge", "SuccessNotice", "MetricCard", "SummaryStat", "KpiDetailPanel", "metricDetailsHref", "formatShortDate", "average", "isKpiTimeline", "isComparisonMode", "isKpiStatusFilter", "statusFilterLabel", "matchesStatusFilter", "kpiHref", "timelineQueryParams", "dateOnly", "startOfDay", "addDays", "addMonths", "startOfYear", "validDateParam", "timelineRange", "filterKpisByTimeline", "compareHref", "formatLongDate", "timeframeDisplay", "getTrendRows", "getMetricHistoryRows", "latestRowsByMetric", "trendLabelForRows", "updatedThisMonth", "buildTrends", "defaultComparisonMode", "trendDeltaLabel", "targetHitRate", "TrendSummaryCard", "TrendChart", "normalizedPointValue", "comparisonPointValue", "OverlayTrendChart", "comparisonContext", "percentChangeLabel", "comparisonNotes", "ComparisonAnalysis", "kpiDetailReturnPath", "KpiSettingHiddenFields", "KpiTargetRecommendationPanel", "TargetUndoNotice", "KpiValueEditForm", "KpiChartSettingsForm"];
const protectedStatements = ["params", "{ supabase, workspaceId }", "[\n    kpiResult,\n    folderResult,\n    peopleResult,\n    shareResult,\n    fileResult,\n    kpiSettingsResult\n  ]", "today", "rawKpis", "sourceParentResult", "sourceParentEligibility", "eligibleKpis", "sourceFiles", "kpiSettings", "adjustedKpis", "timeline", "selectedTimelineRange", "activeStatusFilter", "kpis", "allVisibleKpis", "people", "shares", "metricNames", "kpiSnapshotAsOf", "kpiSnapshot", "kpiPageStates", "if:metricNames.length > INTELLIGENCE_SNAPSHOT_LIMITS.kpis", "kpiPageStatesByName", "kpiStateForName", "latestKpiRows", "kpiTone", "filteredLatestKpiRows", "filteredMetricNames", "filteredKpis", "selectedMetrics", "primaryMetric", "selectedTrends", "hasComparison", "comparisonMode", "selectedComparisonContext", "activeSection", "selectedMetricRows", "selectedMetricActualValues", "selectedLatestKpi", "selectedSourceFile", "selectedKpiSetting", "selectedKpiState", "if:kpiSnapshot && selectedKpiState", "selectedKpiDirection", "selectedKpiSemantics", "selectedManualTarget", "selectedTargetReference", "selectedKpiEvaluation", "selectedRecommendation", "comparisonSnapshotRows", "selectedComparisonStatesByName", "if:comparisonSnapshotRows.length", "undoMetricName", "undoSetting", "undoLatestKpi", "managedKpis"];

test("existing KPI business, value, history, comparison and edit helpers remain byte-equivalent after TypeScript printing", () => {
  const functions = ast.statements.filter(ts.isFunctionDeclaration).filter((node) => protectedFunctions.includes(node.name?.text));
  assert.deepEqual(functions.map((node) => node.name.text), protectedFunctions);
  assert.equal(digest(functions.map(print).join("\n")), "ac0c6ee2d573d73f1c1f0c59bf851762e6c00eb53b4b2e715bb17af0783df2db");
});

test("the original workspace-scoped queries, eligibility, canonical calculations and detail data statements are unchanged", () => {
  const page = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "KpisPage");
  const statementKey = (node) => ts.isVariableStatement(node)
    ? node.declarationList.declarations.map((declaration) => declaration.name.getText(ast)).join(",")
    : ts.isIfStatement(node) ? `if:${node.expression.getText(ast)}` : `syntax:${node.kind}`;
  const statements = page.body.statements.filter((node) => protectedStatements.includes(statementKey(node)));
  assert.deepEqual(statements.map(statementKey).sort(), [...protectedStatements].sort());
  assert.equal(digest(statements.map(print).join("\n")), "c721daa2fc9e882e88215726c00eda7c23677987145ade107f829d4fabd0bc83");
});

test("all seven existing mutation forms preserve targets, named fields and safeguards", () => {
  const protectedAttributes = new Set(["action", "method", "name", "type", "value", "defaultValue", "defaultChecked", "checked", "required", "disabled", "min", "max", "maxLength", "step", "multiple", "form", "returnPath", "return_path", "requestToken", "analysisType", "fingerprint", "generatedAt"]);
  const forms = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "form" && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === "action" && attribute.initializer && ts.isJsxExpression(attribute.initializer))) {
      const records = [];
      function collect(child) {
        if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
          const props = child.attributes.properties.filter(ts.isJsxAttribute).filter((attribute) => protectedAttributes.has(attribute.name.text) || /^on[A-Z]/.test(attribute.name.text)).map(print).sort();
          if (props.length) records.push(JSON.stringify({ tag: child.tagName.getText(ast), props }));
        }
        ts.forEachChild(child, collect);
      }
      collect(node); forms.push(records.sort());
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(forms.length, 7);
  assert.equal(digest(JSON.stringify(forms.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))), "8fdd6391134eef5f26d9aa2d8521619a9283f42b12a70ff0d9cafbc2cf567235");
});

const decode = (value) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const text = (html) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const hrefs = (html) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({ href: decode(match[1]), label: text(match[2]) }));
const counts = (html) => {
  const panel = html.match(/<p\b[^>]*data-performance-counts[^>]*>/)?.[0];
  assert.ok(panel, "the list must expose truthful total, matching and shown counts");
  return Object.fromEntries(["total", "matching", "shown"].map((name) => [name, Number(panel.match(new RegExp(`data-${name}="(\\d+)"`))?.[1])]));
};
const rows = (html) => [...html.matchAll(/<li\b[^>]*class="[^"]*workspace-metric-row[^\"]*"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => {
  const anchor = hrefs(match[1])[0];
  assert.ok(anchor, "each metric row retains a real detail link");
  return { html: match[1], text: text(match[1]), href: anchor.href, name: new URL(anchor.href, "https://fixture.invalid").searchParams.get("metric") };
});
let screens;
let RealDate;
test.before(async () => {
  const result = await build({ test: true });
  screens = require(path.join(result.output, "render.cjs"));
  RealDate = global.Date;
  const FixedDate = function(...args) { return new.target ? Reflect.construct(RealDate, args.length ? args : [screens.AS_OF], new.target) : new RealDate(screens.AS_OF).toString(); };
  Object.setPrototypeOf(FixedDate, RealDate);
  FixedDate.prototype = RealDate.prototype;
  Object.defineProperty(FixedDate, "now", { value: () => RealDate.parse(screens.AS_OF) });
  global.Date = FixedDate;
});
test.after(() => { if (RealDate) global.Date = RealDate; });
async function render(params = {}, state = "populated") {
  const body = await screens.renderScreen("/app/kpis", state, "owner", new URLSearchParams(params));
  return renderToStaticMarkup(body);
}

test("actual Performance renders bounded six-row batches over the full 112-metric fixture", async () => {
  const all = rows(await render({ show: "999999" }));
  assert.equal(all.length, 112);
  assert.equal(new Set(all.map((row) => row.name)).size, 112);
  assert.equal(rows(await render({ show: "all" })).length, 6, "the existing nonnumeric batch guard is unchanged");
  for (const show of [undefined, "12", "54", "108", "114"]) {
    const html = await render(show ? { show } : {});
    const visible = rows(html);
    const expected = Math.min(show ? Number(show) : 6, all.length);
    assert.equal(visible.length, expected);
    assert.deepEqual(counts(html), { total: 112, matching: 112, shown: expected });
    assert.deepEqual(visible.map((row) => row.name), all.slice(0, expected).map((row) => row.name));
    const next = hrefs(html).find((link) => /^Show next /.test(link.label));
    if (expected < all.length) {
      assert.ok(next);
      assert.equal(new URL(next.href, "https://fixture.invalid").searchParams.get("show"), String(expected + 6));
    } else assert.equal(next, undefined);
  }
});

test("search, category and existing status combine across the complete loaded set before six-row batching", async () => {
  const all = rows(await render({ metricSearch: "  NET SALES  ", category: "Financial", show: "999999" }));
  assert.equal(all.length, 8);
  assert.ok(all.every((row) => row.name.startsWith("Net sales —")));
  assert.equal(rows(await render({ metricSearch: "Net sales", category: "Operations", show: "999999" })).length, 0);
  assert.deepEqual(counts(await render({ metricSearch: "Net sales", category: "Financial" })), { total: 112, matching: 8, shown: 6 });
  const onTrack = rows(await render({ metricSearch: "Net sales", category: "Financial", status: "on-track", show: "999999" }));
  assert.ok(onTrack.some((row) => row.name === "Net sales — Flagship store"));
  assert.ok(onTrack.every((row) => /On Track/i.test(row.text)));
  assert.ok(!onTrack.some((row) => row.name === "Net sales — North district"));
  const behind = rows(await render({ metricSearch: "Net sales", category: "Financial", status: "behind-target", show: "999999" }));
  assert.ok(behind.some((row) => row.name === "Net sales — North district"));
  assert.ok(!behind.some((row) => row.name === "Net sales — Flagship store"));
  assert.deepEqual(counts(await render({ metricSearch: "Net sales", category: "Financial", status: "behind-target", show: "999999" })), { total: 112, matching: behind.length, shown: behind.length });
});

test("zero remains a value, null remains unavailable, and long metric identities remain intact", async () => {
  const zero = rows(await render({ metricSearch: "Net sales — West district" }));
  const missing = rows(await render({ metricSearch: "Net sales — Online store" }));
  assert.equal(zero.length, 1); assert.equal(missing.length, 1);
  assert.match(zero[0].text, /\$0(?:\.00)?\b/);
  assert.doesNotMatch(zero[0].text, /Not set|No current value/);
  assert.match(missing[0].text, /Not set|No current value|Missing Data/i);
  assert.doesNotMatch(missing[0].text, /\$0(?:\.00)?\b/);
  const long = rows(await render({ metricSearch: "Special-order fulfillment and interbranch replenishment", show: "999999" }));
  assert.equal(long.length, 14);
  assert.ok(long.every((row) => row.text.includes(row.name)));
});

test("the existing deterministic status and category populations are neither merged nor reclassified", async () => {
  for (const [params, expected] of [
    [{ status: "on-track" }, 30], [{ status: "behind-target" }, 44],
    [{ status: "missing-data" }, 18], [{ category: "Financial" }, 48],
    [{ category: "Operations" }, 64],
  ]) {
    const html = await render({ ...params, show: "999999" });
    assert.equal(rows(html).length, expected);
    assert.deepEqual(counts(html), { total: 112, matching: expected, shown: expected });
  }
  assert.match(rows(await render({ metricSearch: "Service capacity index — Flagship store" }))[0].text, /Direction not set/);
  assert.match(rows(await render({ metricSearch: "Returns processed — Flagship store" }))[0].text, /Target not set/);
});

test("detail and Back retain search/category/status/batch and the exact custom date range", async () => {
  const context = { metricSearch: "Net sales", category: "Financial", status: "behind-target", show: "12", timeline: "Custom Range", start: "2026-09-01", end: "2026-09-29" };
  const overview = await render(context);
  const selected = rows(overview).find((row) => row.name === "Net sales — North district");
  assert.ok(selected);
  const detailParams = new URL(selected.href, "https://fixture.invalid").searchParams;
  for (const [key, value] of Object.entries(context)) assert.equal(detailParams.get(key), value);
  assert.equal(detailParams.get("section"), "detail");
  const detail = await render(Object.fromEntries(detailParams));
  const back = hrefs(detail).find((link) => link.label === "← Back to Performance");
  assert.ok(back);
  const backParams = new URL(back.href, "https://fixture.invalid").searchParams;
  for (const [key, value] of Object.entries(context)) assert.equal(backParams.get(key), value);
  assert.equal(backParams.has("metric"), false);
  assert.equal(backParams.has("section"), false);
  assert.equal(rows(detail).length, 0, "detail should not duplicate the overview metric list");
});

test("the filter form is GET-only and empty results retain a bounded path back", async () => {
  const html = await render({ metricSearch: "No synthetic metric matches this", category: "Financial", status: "on-track" });
  assert.equal(rows(html).length, 0);
  assert.deepEqual(counts(html), { total: 112, matching: 0, shown: 0 });
  const form = html.match(/<form\b[^>]*aria-label="Filter metrics"[^>]*>[\s\S]*?<\/form>/)?.[0];
  assert.ok(form);
  assert.match(form, /method="get"/);
  for (const name of ["metricSearch", "category", "status"]) assert.match(form, new RegExp(`name="${name}"`));
  assert.doesNotMatch(form, /\$ACTION_|method="post"/);
  assert.match(text(html), /No metrics|No KPIs/i);
  assert.ok(hrefs(html).some((link) => /Clear filters|Reset filters|Show all metrics/i.test(link.label)));
  assert.equal(rows(await render({ metric: "No such metric", section: "detail" })).length, 6, "unknown metric must preserve the existing overview fallback");
});

test("category selection remounts when available options change and preserves an unavailable selected value", async () => {
  const categorySelects = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "select"
      && node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
        && attribute.name.text === "name" && attribute.initializer?.getText(ast) === '"category"')) categorySelects.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(categorySelects.length, 1);
  const attributes = categorySelects[0].attributes.properties.filter(ts.isJsxAttribute);
  assert.equal(attributes.find((attribute) => attribute.name.text === "key")?.initializer?.getText(ast), "{JSON.stringify([categoryFilter, metricCategories])}");
  assert.equal(attributes.find((attribute) => attribute.name.text === "defaultValue")?.initializer?.getText(ast), "{categoryFilter}");

  for (const [state, category, label] of [
    ["populated", "Operations", "Operations"],
    ["empty", "Operations", "Operations (not available)"],
    ["populated", "Retired category", "Retired category (not available)"],
  ]) {
    const html = await render({ category }, state);
    const select = html.match(/<select\b[^>]*name="category"[^>]*>[\s\S]*?<\/select>/)?.[0];
    assert.ok(select);
    const selected = [...select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)]
      .filter((match) => /\bselected(?:=|\s|$)/.test(match[1]));
    assert.equal(selected.length, 1);
    assert.equal(decode(selected[0][1].match(/\bvalue="([^"]*)"/)?.[1] ?? ""), category);
    assert.equal(text(selected[0][2]), label);
    if (state === "empty") assert.deepEqual(counts(html), { total: 0, matching: 0, shown: 0 });
  }
});

test("timeline controls retain list filters and custom-range fields without changing recorded-value semantics", async () => {
  const context = { metricSearch: "Net sales", category: "Financial", status: "behind-target", timeline: "Custom Range", start: "2026-09-01", end: "2026-09-29", show: "12" };
  const html = await render(context);
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map((match) => match[0]);
  const custom = forms.find((form) => /type="date"/.test(form));
  const filters = forms.find((form) => /aria-label="Filter metrics"/.test(form));
  assert.ok(custom); assert.ok(filters);
  for (const form of [custom, filters]) {
    assert.match(form, /method="get"/);
    assert.match(form, /action="\/app\/kpis"/);
    assert.doesNotMatch(form, /\$ACTION_|method="post"/);
    for (const [key, value] of Object.entries(context).filter(([key]) => key !== "show")) {
      if (form === filters && ["category", "status"].includes(key)) continue;
      assert.ok(form.includes(`name="${key}"`) && form.includes(`value="${value}"`), `${key} remains in the ${form === custom ? "custom date" : "filter"} form`);
    }
  }
  const dateLink = hrefs(html).find((link) => link.label === "30D");
  assert.ok(dateLink);
  const next = new URL(dateLink.href, "https://fixture.invalid").searchParams;
  for (const key of ["metricSearch", "category", "status"]) assert.equal(next.get(key), context[key]);
  assert.equal(next.get("timeline"), "30D");
  const recorded = await render({ metricSearch: "Special-order fulfillment and interbranch replenishment", timeline: "7D", show: "999999" });
  assert.equal(rows(recorded).length, 14, "the existing list retains latest recorded metrics even outside the selected chart date range");
});
