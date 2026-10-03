const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
function loadSource(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = (name) => {
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
const neverMutate = () => { throw new Error("Browsing must not invoke a server action"); };
const sharedMocks = {
  "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
  "next/navigation": { useRouter: () => ({ refresh: neverMutate }) },
  "@/app/app/finding-explanation/actions": { explainFindingAction: neverMutate },
  "@/app/app/intelligence/lifecycle-actions": { mutateIntelligenceCardLifecycleAction: neverMutate },
  "@/app/app/intelligence/briefings/actions": { generateIntelligenceBriefingAction: neverMutate },
  "@/components/reports/SaveAnalysisButton": { SaveAnalysisButton: () => null },
  "@/components/spatial/SpatialSurface": { spatialSurfaceClassName: () => "spatial-surface" },
};

function card(index, overrides = {}) {
  return {
    findingKeyHash: `finding-${String(index).padStart(3, "0")}`, findingId: `id-${index}`, materialSignature: `material-${index}`,
    insight: null, snapshot: { version: "intelligence_card_lifecycle_v1", findingId: `id-${index}`, type: index < 200 ? "Risk" : "Opportunity",
      title: `Synthetic finding ${index}`, summary: "Synthetic evidence summary", priority: "High", confidence: index % 2 ? "Low" : "High",
      affectedArea: "Operations", lastUpdated: "2026-09-29T00:00:00Z" },
    lifecycleState: "active", pinned: false, view: "current", currentFeedStatus: "surfaced", reopenReason: null,
    reopenedFrom: null, reasonCode: null, reasonText: null, dismissedBy: null, recheckAfter: null, stateChangedAt: null, lifecycleToken: null,
    ...overrides,
  };
}

// Drive the actual component event handlers with stable hook slots. Browser
// qualification separately checks layout, focus, and scrolling in a real DOM.
function inboxHarness(props) {
  const slots = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo: (compute) => compute(),
    useEffect: () => {},
    useTransition: () => [false, (fn) => fn()],
  };
  const { IntelligenceSignalInbox } = loadSource("components/intelligence/IntelligenceSignalInbox.tsx", { ...sharedMocks, react: hooks });
  return () => { cursor = 0; return IntelligenceSignalInbox(props); };
}
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
const button = (tree, label) => nodes(tree, (node) => node.type === "button" && content(node.props.children).startsWith(label))[0];
const rows = (tree) => nodes(tree, (node) => node.props?.["data-finding-key"]);

test("Intelligence SSR dates match browser rendering across timezones and preserve reporting days", () => {
  // Exercise the actual component formatters in separate runtime environments,
  // rather than comparing a duplicate implementation of the formatting rules.
  const sources = [
    ["components/intelligence/IntelligenceSignalInbox.tsx", ["formatSignalDate", "formatLifecycleTimestamp"]],
    ["components/intelligence/IntelligenceBriefingCards.tsx", ["generatedLabel"]],
  ];
  const functions = sources.map(([relative, names]) => {
    const filename = path.join(root, relative);
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return source.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text)).map(statement => statement.getText(source)).join("\n");
  }).join("\n");
  const program = ts.transpileModule(functions + `
    console.log(JSON.stringify({
      reproduced: formatSignalDate("2026-07-18T00:00:00Z"),
      reportingDay: formatSignalDate("2026-05-04"),
      leapDay: formatSignalDate("2024-02-29"),
      offsetInstant: formatSignalDate("2026-05-04T23:30:00-07:00"),
      lifecycle: formatLifecycleTimestamp("2026-07-18T00:00:00Z"),
      generated: generatedLabel("2026-07-18T00:00:00Z"),
      invalid: [formatSignalDate("invalid"), formatLifecycleTimestamp("invalid"), generatedLabel("invalid")]
    }));`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const render = (zone) => JSON.parse(execFileSync(process.execPath, ["-e", program], { encoding: "utf8", env: { ...process.env, TZ: zone, LANG: "de_DE.UTF-8" } }));
  const server = render("UTC");
  assert.deepEqual(server, {
    reproduced: "Jul 18, 2026 UTC", reportingDay: "May 4, 2026", leapDay: "Feb 29, 2024",
    offsetInstant: "May 5, 2026 UTC", lifecycle: "Jul 18, 2026, 12:00 AM UTC", generated: "Jul 18, 2026, 12:00 AM UTC",
    invalid: ["Date unavailable", "Date unavailable", "Generation time unavailable"],
  });
  for (const zone of ["America/Los_Angeles", "Pacific/Honolulu", "Asia/Tokyo", "Pacific/Kiritimati"]) {
    assert.deepEqual(render(zone), server, `server/browser text must agree in ${zone}`);
  }
  const previousZone = process.env.TZ;
  try {
    const { IntelligenceSignalInbox } = loadSource("components/intelligence/IntelligenceSignalInbox.tsx", sharedMocks);
    const { IntelligenceBriefingCards } = loadSource("components/intelligence/IntelligenceBriefingCards.tsx", sharedMocks);
    const dated = card(0, { snapshot: { ...card(0).snapshot, lastUpdated: "2026-07-18T00:00:00Z" } });
    const props = { currentCards: [dated], historyCards: [], canManageLifecycle: false };
    const state = (briefingType) => ({ briefingType, status: "current", eligibility: "limited", confidence: "Low", artifact: { generatedAt: "2026-07-18T00:00:00Z" }, period: { start: "2026-07-11", end: "2026-07-18", dayCount: 7, cutoff: "2026-07-18T00:00:00Z", timeZone: "UTC" } });
    const renderMarkup = () => renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(IntelligenceSignalInbox, props),
      React.createElement(IntelligenceBriefingCards, { states: { weekly: state("weekly"), monthly: state("monthly") }, generationEnabled: false })));
    process.env.TZ = "UTC";
    const html = renderMarkup();
    assert.match(html, /<p class="mt-2 text-xs text-slate-500">Jul 18, 2026 UTC<\/p>/);
    assert.match(html, /Last generated Jul 18, 2026, 12:00 AM UTC/);
    process.env.TZ = "America/Los_Angeles";
    assert.equal(renderMarkup(), html, "the reproduced finding paragraph and briefing markup hydrate without text replacement");
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test("320 current findings are batched by ten in All, with truthful remaining-category text", () => {
  const render = inboxHarness({ currentCards: Array.from({ length: 320 }, (_, i) => card(i)), historyCards: [], canManageLifecycle: false });
  let tree = render();
  assert.equal(rows(tree).length, 10);
  assert.match(content(tree), /Showing 1-10 of 320/);
  assert.match(content(tree), /More improvement findings are available/);
  for (let count = 20; count <= 320; count += 10) {
    button(tree, "Load more").props.onClick();
    tree = render();
    assert.equal(rows(tree).length, count);
  }
  assert.equal(button(tree, "Load more"), undefined);
  assert.equal(new Set(rows(tree).map((node) => node.props["data-finding-key"])).size, 320);
});

test("default desktop selection uses the first sorted visible finding, while explicit deep links override it", () => {
  const cards = Array.from({ length: 24 }, (_, index) => {
    const item = card(index);
    return { ...item, snapshot: { ...item.snapshot, priority: index === 0 ? "Low" : "High", confidence: "High" } };
  });
  const props = { currentCards: cards, historyCards: [], canManageLifecycle: false };
  const render = inboxHarness(props);
  let tree = render();
  assert.equal(rows(tree).length, 10);
  assert.equal(rows(tree)[0].props["data-finding-key"], "finding-001");
  assert.equal(rows(tree)[0].props["aria-current"], "true", "the preview's selected row must be in the initial visible batch");
  assert.match(content(nodes(tree, (node) => node.type === "aside")[0]), /Synthetic finding 1/);
  button(tree, "Risks").props.onClick();
  tree = render();
  assert.equal(rows(tree)[0].props["aria-current"], "true", "filter defaults use the same sorted visible order");
  button(tree, "Current").props.onClick();
  tree = render();
  assert.equal(rows(tree)[0].props["aria-current"], "true", "view defaults use the same sorted visible order");
  const deep = inboxHarness({ ...props, initialFindingId: "id-0" })();
  assert.match(content(nodes(deep, (node) => node.type === "aside")[0]), /Synthetic finding 0/);
  assert.equal(rows(deep).some((node) => node.props["aria-current"] === "true"), false, "an explicit deep link may intentionally select beyond the first batch");
});

test("mobile selection and Back restore the list without resetting filters, batch, or scroll target", () => {
  const previousWindow = global.window;
  const scrolls = [];
  let focusRestored = false;
  global.window = { scrollY: 930, requestAnimationFrame: (fn) => fn(), scrollTo: (value) => scrolls.push(value) };
  try {
    const render = inboxHarness({ currentCards: Array.from({ length: 320 }, (_, i) => card(i)), historyCards: [], canManageLifecycle: false });
    let tree = render();
    button(tree, "Opportunities").props.onClick();
    tree = render();
    button(tree, "Load more").props.onClick();
    tree = render();
    const before = rows(tree).map((node) => node.props["data-finding-key"]);
    assert.equal(before.length, 20);
    const selected = rows(tree)[15];
    selected.props.onClick({ currentTarget: { focus: (options) => { assert.equal(options.preventScroll, true); focusRestored = true; } } });
    tree = render();
    assert.match(nodes(tree, (node) => node.props?.["data-finding-list"] !== undefined)[0].props.className, /^hidden xl:block/);
    assert.doesNotMatch(nodes(tree, (node) => node.type === "aside")[0].props.className, /^hidden/);
    button(tree, "← Back to list").props.onClick();
    tree = render();
    assert.deepEqual(rows(tree).map((node) => node.props["data-finding-key"]), before);
    assert.match(content(tree), /Showing 1-20 of 120/);
    assert.match(nodes(tree, (node) => node.type === "aside")[0].props.className, /^hidden xl:block/);
    assert.equal(nodes(tree, (node) => node.props?.["aria-current"] === "true").length, 0, "Back must not silently select the first finding again");
    assert.deepEqual(scrolls, [{ top: 930, behavior: "instant" }]);
    assert.equal(focusRestored, true);
  } finally { global.window = previousWindow; }
});

test("confidence and history changes reset the batch while deep links still open a finding beyond it", () => {
  const cards = Array.from({ length: 320 }, (_, i) => card(i));
  const render = inboxHarness({ currentCards: cards, historyCards: cards.slice(0, 24).map((item) => ({ ...item, view: "history" })), canManageLifecycle: false });
  let tree = render();
  button(tree, "Load more").props.onClick();
  tree = render();
  nodes(tree, (node) => node.type === "input")[0].props.onChange({ currentTarget: { checked: true } });
  tree = render();
  assert.equal(rows(tree).length, 10);
  assert.match(content(tree), /Showing 1-10 of 160/);
  button(tree, "History").props.onClick();
  tree = render();
  assert.match(content(tree), /Showing 1-10 of 12/);
  const deep = inboxHarness({ currentCards: cards, historyCards: [], canManageLifecycle: false, initialFindingId: "id-319" })();
  assert.equal(rows(deep).length, 10);
  assert.match(content(nodes(deep, (node) => node.type === "aside")[0]), /Synthetic finding 319/);
  assert.doesNotMatch(nodes(deep, (node) => node.type === "aside")[0].props.className, /^hidden/);
});

test("confidence-filter fallback becomes the selection and survives clearing the filter without reopening mobile Back", () => {
  const previousWindow = global.window;
  global.window = { scrollY: 0, requestAnimationFrame: (fn) => fn(), scrollTo: () => {} };
  try {
    const render = inboxHarness({ currentCards: [card(0), card(1), card(2)], historyCards: [], canManageLifecycle: false });
    let tree = render();
    rows(tree).find((node) => node.props["data-finding-key"] === "finding-001").props.onClick({ currentTarget: { focus: () => {} } });
    tree = render();
    assert.match(content(nodes(tree, (node) => node.type === "aside")[0]), /Synthetic finding 1/);
    nodes(tree, (node) => node.type === "input")[0].props.onChange({ currentTarget: { checked: true } });
    tree = render();
    assert.equal(rows(tree).length, 2);
    assert.equal(rows(tree)[0].props["aria-current"], "true");
    assert.match(content(nodes(tree, (node) => node.type === "aside")[0]), /Synthetic finding 0/);
    assert.doesNotMatch(content(nodes(tree, (node) => node.type === "aside")[0]), /Select a finding/);
    nodes(tree, (node) => node.type === "input")[0].props.onChange({ currentTarget: { checked: false } });
    tree = render();
    assert.equal(rows(tree).length, 3);
    assert.equal(rows(tree)[0].props["aria-current"], "true");
    assert.match(content(nodes(tree, (node) => node.type === "aside")[0]), /Synthetic finding 0/);
    assert.doesNotMatch(content(nodes(tree, (node) => node.type === "aside")[0]), /Synthetic finding 1/, "clearing the filter must not resurrect the excluded prior selection");
    rows(tree)[0].props.onClick({ currentTarget: { focus: () => {} } });
    tree = render();
    button(tree, "← Back to list").props.onClick();
    tree = render();
    assert.equal(rows(tree).some((node) => node.props["aria-current"] === "true"), false);
    assert.match(nodes(tree, (node) => node.type === "aside")[0].props.className, /^hidden xl:block/);
    assert.match(content(nodes(tree, (node) => node.type === "aside")[0]), /Select a finding/);
    for (const checked of [true, false]) {
      nodes(tree, (node) => node.type === "input")[0].props.onChange({ currentTarget: { checked } });
      tree = render();
      assert.equal(rows(tree).some((node) => node.props["aria-current"] === "true"), false, "an intentional Back-to-list empty selection remains empty across confidence changes");
      assert.match(nodes(tree, (node) => node.type === "aside")[0].props.className, /^hidden xl:block/);
    }
  } finally { global.window = previousWindow; }
});

test("unavailable briefings collapse only on request, retaining completed and generatable briefings", () => {
  const { IntelligenceBriefingCards } = loadSource("components/intelligence/IntelligenceBriefingCards.tsx", sharedMocks);
  const unavailable = (type) => ({ briefingType: type, status: "unavailable", eligibility: "no_eligible_evidence", confidence: "Low",
    artifact: null, message: "Add eligible information", period: { start: "2026-09-01", end: "2026-09-29", dayCount: 30, cutoff: "2026-09-29T00:00:00Z", timeZone: "UTC" } });
  const states = { weekly: unavailable("weekly"), monthly: unavailable("monthly") };
  const render = (next, compactUnavailable = true) => renderToStaticMarkup(React.createElement(IntelligenceBriefingCards, { states: next, generationEnabled: true, compactUnavailable }));
  assert.match(render(states), /<details[^>]*data-briefings-collapsed/);
  assert.doesNotMatch(render(states), /<details[^>]*\bopen=/);
  assert.match(render(states), /Add eligible information/);
  assert.doesNotMatch(render(states, false), /data-briefings-collapsed/);
  const complete = { ...states, weekly: { ...states.weekly, artifact: { generatedAt: "2026-09-29T00:00:00Z" } } };
  assert.doesNotMatch(render(complete), /data-briefings-collapsed/);
  assert.match(render(complete), /View Current Briefing/);
  assert.doesNotMatch(render({ ...states, monthly: { ...states.monthly, status: "ready", eligibility: "limited" } }), /data-briefings-collapsed/);
});

test("the main route places findings before briefings without changing their data loading", () => {
  const source = fs.readFileSync(path.join(root, "app/app/intelligence/page.tsx"), "utf8");
  assert.ok(source.indexOf("<IntelligenceSignalInbox") < source.indexOf("<IntelligenceBriefingCards"));
  assert.match(source, /<IntelligenceBriefingCards[\s\S]*compactUnavailable/);
});
