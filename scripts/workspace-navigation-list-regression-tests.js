const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
function loadSource(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith("@/")) return loadSource(name.slice(2) + ".ts", mocks);
    return require(name);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
  return loaded.exports;
}

const nav = loadSource("lib/presentation/app-navigation.ts");
const batching = loadSource("lib/presentation/list-batch.ts");
const primary = [
  { href: "/app", label: "Overview" },
  { href: "/app/intelligence", label: "Intelligence" },
  { href: "/app/kpis", label: "Performance" },
  { href: "/app/sources", label: "Evidence" },
  { href: "/app/reports", label: "Saved Analyses" },
  { href: "/app/settings", label: "Settings" },
];
const admin = [
  { href: "/app/admin", label: "Admin Dashboard" },
  { href: "/app/admin/customers", label: "Customers" },
];
const sections = [{ label: "Primary", collapsible: false, items: primary }, { label: "Admin", items: admin }];
const items = [...primary, ...admin];
const Link = ({ children, ...props }) => React.createElement("a", props, children);

function nodes(tree, predicate) {
  const found = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (predicate(value)) found.push(value);
    visit(value.props?.children);
  }
  visit(tree);
  return found;
}
function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join("");
  if (tree && typeof tree === "object") return content(tree.props?.children);
  return tree == null || typeof tree === "boolean" ? "" : String(tree);
}
const button = (tree, label) => nodes(tree, node => node.type === "button" && content(node) === label)[0];

test("workspace navigation matches path boundaries and labels the current destination without changing links", () => {
  for (const item of items) {
    assert.equal(nav.isWorkspacePathActive(item.href, item.href), true);
    assert.equal(nav.currentWorkspaceDestination(item.href, items).label, item.label);
    assert.equal(nav.workspacePageTitle(item.href, items), item.label);
  }
  assert.equal(nav.isWorkspacePathActive("/app/settings", "/app"), false);
  assert.equal(nav.isWorkspacePathActive("/app/admin/customers", "/app/admin"), false);
  assert.equal(nav.isWorkspacePathActive("/app/reports/analysis-300", "/app/reports"), true);
  assert.equal(nav.isWorkspacePathActive("/app/reports-other", "/app/reports"), false);
  assert.equal(nav.currentWorkspaceDestination("/app/admin/customers/customer-a", items).label, "Customers");
  assert.equal(nav.workspacePageTitle("/app/settings/integrations/square", items), "Square");
  assert.equal(nav.workspacePageTitle("/app/help", items), "Help Center");
  assert.equal(nav.workspacePageTitle("/app/support", items), "Support");
  assert.equal(nav.workspacePageTitle("/app/not-a-destination", items), "Workspace");
  assert.deepEqual(primary.map(item => item.href), ["/app", "/app/intelligence", "/app/kpis", "/app/sources", "/app/reports", "/app/settings"]);
});

test("actual mobile menu and header expose the active destination before opening and preserve canonical navigation", () => {
  let pathname = "/app/settings";
  const mocks = { "next/navigation": { usePathname: () => pathname }, "next/link": { __esModule: true, default: Link } };
  const { AppNavigation } = loadSource("components/app/AppNavigation.tsx", mocks);
  const { WorkspacePageTitle } = loadSource("components/app/WorkspacePageTitle.tsx", mocks);
  const render = mobile => renderToStaticMarkup(React.createElement(AppNavigation, { sections, mobile }));
  let html = render(true);
  assert.match(html, /^<details[^>]*><summary/);
  assert.doesNotMatch(html, /^<details[^>]*\bopen(?:=|>)/);
  assert.match(html, /Menu <span[^>]*>\/<\/span> Settings/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /href="\/app\/settings" aria-current="page"/);
  for (const item of items) assert.ok(html.includes(`href="${item.href}"`));
  assert.doesNotMatch(html, /workspace_id|workspaceId=|<form|overflow-x-auto/);
  assert.match(render(false), /^<nav/);
  assert.match(render(false), /href="\/app\/settings" aria-current="page"/);
  pathname = "/app/kpis";
  assert.match(render(true), /Performance<\/span>/);
  assert.match(renderToStaticMarkup(React.createElement(WorkspacePageTitle, { items })), />Performance<\/p>/);
  pathname = "/app/settings/integrations/square";
  assert.match(renderToStaticMarkup(React.createElement(WorkspacePageTitle, { items })), />Square<\/p>/);
  pathname = "/app/admin/customers/customer-a";
  html = render(true);
  assert.match(html, /Menu <span[^>]*>\/<\/span> Customers/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
});

test("mobile navigation closes its menu only for a link activation without intercepting normal navigation", () => {
  const { AppNavigation } = loadSource("components/app/AppNavigation.tsx", {
    "next/navigation": { usePathname: () => "/app/settings" }, "next/link": { __esModule: true, default: Link },
  });
  const tree = AppNavigation({ sections, mobile: true });
  const container = nodes(tree, node => node.type === "div" && typeof node.props.onClick === "function")[0];
  let closed = 0;
  const originalElement = global.Element;
  class ElementStub {
    constructor(anchor) { this.anchor = anchor; }
    closest(selector) { assert.equal(selector, "a"); return this.anchor ? {} : null; }
  }
  global.Element = ElementStub;
  try {
    const currentTarget = { closest(selector) { assert.equal(selector, "details"); return { removeAttribute(name) { assert.equal(name, "open"); closed++; } }; } };
    container.props.onClick({ target: new ElementStub(false), currentTarget });
    assert.equal(closed, 0);
    container.props.onClick({ target: new ElementStub(true), currentTarget });
    assert.equal(closed, 1);
  } finally { global.Element = originalElement; }
});

test("numeric list batching is bounded and covers a 320-item list in six-row increments", () => {
  assert.equal(batching.listBatchCount(undefined, 320, 6), 6);
  for (const invalid of ["all", "-1", "1.5", "Infinity", "1000000", "", "6x"]) {
    assert.equal(batching.listBatchCount(invalid, 320, 6), 6);
  }
  assert.equal(batching.listBatchCount("0", 320, 6), 6);
  assert.equal(batching.listBatchCount("999999", 320, 6), 320);
  assert.equal(batching.listBatchCount("12", 4, 6), 4);
  assert.equal(batching.listBatchCount("12", 0, 6), 0);
  let displayed = batching.listBatchCount(undefined, 320, 6);
  while (displayed < 320) {
    const next = batching.listBatchCount(String(displayed + 6), 320, 6);
    assert.ok(next > displayed && next <= 320);
    displayed = next;
  }
  assert.equal(displayed, 320);
});

test("stale Performance detail selections fall back to overview while ordinary section precedence is preserved", () => {
  assert.equal(batching.performanceSection(undefined, ""), "overview");
  assert.equal(batching.performanceSection({ section: "detail", metric: "Removed metric" }, ""), "overview");
  assert.equal(batching.performanceSection({ section: "detail", metric: "Current metric" }, "Current metric"), "detail");
  assert.equal(batching.performanceSection({ section: "overview" }, "Current metric"), "overview");
  assert.equal(batching.performanceSection({ section: "records" }, ""), "records");
  assert.equal(batching.performanceSection({ section: "detail", sort: "name" }, "Current metric"), "records");
  assert.equal(batching.performanceSection({ section: "compare", sort: "name" }, ""), "compare");
  assert.equal(batching.performanceSection({ metric: "compare", section: "records" }, ""), "compare");
});

const analyses = Array.from({ length: 300 }, (_, index) => ({
  id: `analysis-${String(index).padStart(3, "0")}`, title: `Synthetic analysis ${String(index).padStart(3, "0")}`,
  analysisType: ["business_health", "finding_explanation", "weekly_briefing", "monthly_briefing"][index % 4],
  generatedAt: "2026-09-29T00:00:00Z", savedAt: "2026-09-29T01:00:00Z", confidence: "High", evidenceStatus: "Current synthetic evidence",
  dateRange: null, businessHealthState: null,
}));

function savedAnalysesHarness(records = analyses, loadLimitReached = records.length >= 300) {
  const slots = [];
  let cursor = 0;
  const neverMutate = () => { throw new Error("List browsing must not invoke mutations or refresh"); };
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useMemo: compute => compute(),
    useTransition: () => [false, neverMutate],
  };
  const { SavedAnalysisList } = loadSource("components/reports/SavedAnalysisList.tsx", {
    react: hooks,
    "next/navigation": { useRouter: () => ({ refresh: neverMutate }) },
    "next/link": { __esModule: true, default: Link },
    "@/app/app/reports/saved-analysis-actions": { deleteSavedAnalysesAction: neverMutate },
  });
  return () => { cursor = 0; return SavedAnalysisList({ analyses: records, loadLimitReached }); };
}
const analysisRows = tree => nodes(tree, node => node.type === "article");
const checkboxes = tree => nodes(tree, node => node.type === "input" && node.props.type === "checkbox");

test("300 saved analyses render in 25-row batches without changing or skipping a saved record", () => {
  const original = JSON.stringify(analyses);
  const render = savedAnalysesHarness();
  let tree = render();
  assert.equal(analysisRows(tree).length, 25);
  const typeFilter = nodes(tree, node => node.type === "select" && node.props["aria-label"] === "Analysis type")[0];
  assert.ok(typeFilter, "the compact native filter retains an accessible label");
  assert.deepEqual(nodes(typeFilter, node => node.type === "option").map(node => node.props.value), ["all", "business_health", "finding_explanation", "weekly_briefing", "monthly_briefing"]);
  assert.ok(analysisRows(tree).every(row => row.props.className.includes("workspace-list-row")), "saved content renders as compact rows without dropping records");
  assert.match(content(tree), /Showing 25 of 300 matching loaded analyses/);
  assert.match(content(tree), /Search covers this loaded set \(up to 300 recent analyses\), not older history/);
  for (let expected = 50; expected <= 300; expected += 25) {
    button(tree, "Load more analyses").props.onClick();
    tree = render();
    assert.equal(analysisRows(tree).length, expected);
  }
  assert.equal(button(tree, "Load more analyses"), undefined);
  assert.equal(new Set(analysisRows(tree).map(row => row.key)).size, 300);
  assert.equal(JSON.stringify(analyses), original);
  assert.match(content(savedAnalysesHarness(analyses.slice(0, 7), true)()), /not older history/, "server limit warning survives a smaller parsed result set");
  assert.doesNotMatch(content(savedAnalysesHarness(analyses.slice(0, 7), false)()), /not older history/);
});

test("Saved Analyses Select all visible never selects unloaded cards and filtering clears selection and resets the batch", () => {
  const render = savedAnalysesHarness();
  let tree = render();
  button(tree, "Select all visible").props.onClick();
  tree = render();
  assert.match(content(tree), /25 selected/);
  assert.equal(checkboxes(tree).filter(input => input.props.checked).length, 25);
  button(tree, "Load more analyses").props.onClick();
  tree = render();
  assert.equal(checkboxes(tree).length, 50);
  assert.equal(checkboxes(tree).filter(input => input.props.checked).length, 25);
  assert.equal(button(tree, "Select all visible").props.disabled, false);
  button(tree, "Select all visible").props.onClick();
  tree = render();
  assert.match(content(tree), /50 selected/);
  nodes(tree, node => node.type === "select" && node.props["aria-label"] === "Analysis type")[0].props.onChange({ currentTarget: { value: "weekly_briefing" } });
  tree = render();
  assert.match(content(tree), /Showing 25 of 75 matching loaded analyses/);
  assert.match(content(tree), /0 selected/);
  assert.equal(checkboxes(tree).filter(input => input.props.checked).length, 0);
  assert.ok(analysisRows(tree).every(row => Number(row.key.split("-")[1]) % 4 === 2));
  button(tree, "Load more analyses").props.onClick();
  tree = render();
  assert.equal(analysisRows(tree).length, 50);
  nodes(tree, node => node.type === "select" && node.props["aria-label"] === "Analysis type")[0].props.onChange({ currentTarget: { value: "all" } });
  tree = render();
  assert.equal(analysisRows(tree).length, 25);
});

test("Saved Analyses search includes records beyond the first batch and empty states distinguish no records from no match", () => {
  const render = savedAnalysesHarness();
  let tree = render();
  button(tree, "Select all visible").props.onClick();
  tree = render();
  const search = () => nodes(tree, node => node.type === "input" && node.props.placeholder === "Search saved analyses")[0];
  search().props.onChange({ currentTarget: { value: "Synthetic analysis 299" } });
  tree = render();
  assert.equal(analysisRows(tree).length, 1);
  assert.equal(analysisRows(tree)[0].key, "analysis-299");
  assert.match(content(tree), /0 selected/);
  assert.equal(button(tree, "Load more analyses"), undefined);
  search().props.onChange({ currentTarget: { value: "No such analysis" } });
  tree = render();
  assert.match(content(tree), /No saved analyses match this view/);
  assert.match(content(tree), /Showing 0 of 0 matching loaded analyses/);
  assert.match(content(savedAnalysesHarness([])()), /No saved analyses yet/);
});
