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
function inboxHarness(props, runEffects = false, mocks = {}) {
  const slots = [];
  const effects = []; let mounted = false;
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
    useEffect: (effect) => { if (runEffects && !mounted) effects.push(effect); },
    useTransition: () => [false, (fn) => fn()],
  };
  const { IntelligenceSignalInbox } = loadSource("components/intelligence/IntelligenceSignalInbox.tsx", { ...sharedMocks, ...mocks, react: hooks });
  return () => { cursor = 0; const tree = IntelligenceSignalInbox(props); if (!mounted) { mounted = true; effects.forEach(effect => effect()); } return tree; };
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
    assert.match(html, /<time dateTime="2026-07-18T00:00:00Z">Jul 18, 2026 UTC<\/time>/);
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
    assert.equal(rows(tree).find(node => node.props["aria-current"] === "true").props["data-finding-key"], selected.props["data-finding-key"], "Back preserves the selected row without reopening detail");
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
    assert.equal(rows(tree)[0].props["aria-current"], "true");
    assert.match(nodes(tree, (node) => node.type === "aside")[0].props.className, /^hidden xl:block/);
    assert.match(content(nodes(tree, (node) => node.type === "aside")[0]), /Synthetic finding 0/);
    for (const checked of [true, false]) {
      nodes(tree, (node) => node.type === "input")[0].props.onChange({ currentTarget: { checked } });
      tree = render();
      assert.equal(rows(tree)[0].props["aria-current"], "true", "Back-to-list selection survives confidence changes without reopening detail");
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

test("the selected finding shows the complete approved investigation", () => {
  const action = "Examine the underlying reviews for the affected periods, group recurring complaint themes, and assign an owner to follow up on each verified theme. No review text accompanies this KPI record; obtain review text, dates, and identifiers from the source. Confirm how the KPI counts reviews before treating its value as unique reviews.";
  const insight = {
    id: "synthetic-review-risk", type: "Risk", title: "1-Star Reviews remained above target for 6 periods",
    summary: "Actual 37 vs target 0.", why: "The recorded KPI remains above its configured maximum.",
    impact: "The gap requires source review before business impact can be inferred.", recommendedAction: action,
    confidence: "Medium", evidence: [], evidenceCount: 1, supportingRecords: [], independentSourceCount: 1,
    contradictoryEvidence: [], missingEvidence: ["Review-level text, dates, and identifiers"], sourceTypes: ["KPIs"],
    sourceHref: "/app/kpis", priority: "High", lastUpdated: "2026-06-01", affectedArea: "Customer feedback",
    timePeriod: "2026-06-01", limitation: "The KPI aggregate does not establish a cause or unique-review count.", fingerprint: "synthetic-review-risk"
  };
  const selected = card(0, { insight, snapshot: { ...card(0).snapshot, title: insight.title, summary: insight.summary } });
  const { IntelligenceSignalInbox } = loadSource("components/intelligence/IntelligenceSignalInbox.tsx", sharedMocks);
  const html = renderToStaticMarkup(React.createElement(IntelligenceSignalInbox, { currentCards: [selected], historyCards: [], canManageLifecycle: false }));
  assert.match(html, /Confirm how the KPI counts reviews before treating its value as unique reviews/);
  assert.doesNotMatch(html, /Decide whether leadership should investigate/);
});


test("native Back/Forward restores workspace-local filter, batch, selection, panel and scroll", () => {
  const previousWindow = global.window;
  const listeners = new Map(); const entries = [{state: {next: "preserved"}, url: "https://example.test/app/intelligence?period=Monthly"}]; let position = 0;
  const scrolls = [];
  const location = {href: entries[0].url, search: "?period=Monthly"};
  function move() { location.href = entries[position].url; location.search = new URL(location.href).search; listeners.get("popstate")?.(); }
  global.window = {location, scrollY: 930, matchMedia: () => ({matches: false}), requestAnimationFrame: fn => fn(), scrollTo: v => scrolls.push(v), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), history: {
    get state() { return entries[position].state; },
    replaceState(state, _title, url) {entries[position] = {state, url: new URL(url, location.href).href}; location.href = entries[position].url; location.search = new URL(location.href).search;},
    pushState(state, _title, url) { entries.splice(++position); entries.push({state, url: new URL(url, location.href).href}); location.href = entries[position].url; location.search = new URL(location.href).search; },
    back() {if(position > 0) {position--; move();}}, forward() {if(position < entries.length - 1) {position++; move();}}
  }};
  try {
    const props = {workspaceId: "workspace-a", currentCards: Array.from({length:320},(_,i)=>card(i)), historyCards: [], canManageLifecycle: false};
    const render = inboxHarness(props, true); let tree = render();
    button(tree,"Opportunities").props.onClick(); tree=render();
    button(tree,"Load more").props.onClick(); tree=render();
    const chosen=rows(tree)[15].props["data-finding-key"];
    rows(tree)[15].props.onClick({currentTarget:{focus(){}}}); tree=render();
    assert.equal(global.window.history.state.next,"preserved");
    assert.match(location.search,/period=Monthly.*finding=id-/);
    global.window.history.back(); tree=render();
    assert.equal(rows(tree).length,20); assert.match(content(tree),/Showing 1-20 of 120/);
    assert.equal(rows(tree).find(row=>row.props["aria-current"]==="true").props["data-finding-key"],chosen);
    assert.match(nodes(tree,node=>node.type==="aside")[0].props.className,/^hidden xl:block/);
    assert.deepEqual(scrolls.at(-1),{top:930,behavior:"instant"});
    global.window.history.forward(); tree=render();
    assert.doesNotMatch(nodes(tree,node=>node.type==="aside")[0].props.className,/^hidden/);
    assert.equal(rows(tree).find(row=>row.props["aria-current"]==="true").props["data-finding-key"],chosen);
    // A second workspace never restores the first workspace's UI state or finding IDs.
    const other=inboxHarness({...props,workspaceId:"workspace-b",currentCards:[card(900)]},true); other();
    const isolated=other(); assert.equal(rows(isolated).length,1); assert.match(content(isolated),/Synthetic finding 900/);
    assert.doesNotMatch(nodes(isolated,node=>node.type==="aside")[0].props.className,/^block/);
  } finally {global.window=previousWindow;}
});


test("Overview redirect retains query values and ordinary auth defaults preserve deliberate destinations", async () => {
  const {safeAuthRedirectPath}=loadSource("lib/auth/safe-redirect.ts");
  assert.equal(safeAuthRedirectPath(null),"/app/intelligence");
  for(const target of ["/app/sources?file=test#review","/app/intelligence?finding=id-7","/onboarding","/checkout/legal","/app?view=Operations%20View"]) assert.equal(safeAuthRedirectPath(target),target);
  let authorized=0;
  const Overview=loadSource("app/app/page.tsx",{"@/lib/workspaces/page-context":{requireWorkspacePage:async()=>{authorized++;}},"next/navigation":{redirect: value=>{throw new Error(value);}}}).default;
  await assert.rejects(Overview({}),{message:"/app/intelligence"});
  await assert.rejects(Overview({searchParams:Promise.resolve({finding:"id-7",period:"Monthly",tag:["a","b"]})}),{message:"/app/intelligence?finding=id-7&period=Monthly&tag=a&tag=b"});
  assert.equal(authorized,2,"legacy redirects retain the existing workspace guard");
  const Denied=loadSource("app/app/page.tsx",{"@/lib/workspaces/page-context":{requireWorkspacePage:async()=>{throw new Error("access denied");}},"next/navigation":{redirect:()=>assert.fail("cannot redirect before workspace authorization")}}).default;
  await assert.rejects(Denied({}),{message:"access denied"});
  const shell=fs.readFileSync(path.join(root,"components/app/AppShell.tsx"),"utf8");
  assert.doesNotMatch(shell,/href: "\/app", label: "Overview"/);
  const page=fs.readFileSync(path.join(root,"app/app/intelligence/page.tsx"),"utf8");
  assert.match(page,/await requireWorkspaceAccess\(\)/);
  assert.ok(page.includes('key={`findings-${workspaceId}`}'), "workspace inbox key must be distinct from the integration sibling key");
  assert.doesNotMatch(page, /from\("operational_assignments"\)/, "retired assignment panels must not add a database read to Intelligence");
  for(const table of ["record_shares"]) assert.ok(page.includes(`from("${table}").select("*").eq("workspace_id", workspaceId).is("deleted_at", null)`));
});

test("readiness renders existing coverage and expandable source guidance without estimating missing scores", () => {
  const {IntelligenceReadiness}=loadSource("components/intelligence/IntelligenceReadiness.tsx",sharedMocks);
  const readiness={available:true,coverage:68,label:"Partial",strongestArea:"Operations",strongestCoverage:78,largestGap:"Financial history",recommendedNextSource:"Latest monthly financial summary",showAddInformation:true};
  const html=renderToStaticMarkup(React.createElement(IntelligenceReadiness,{readiness}));
  for(const text of ["68","Partial understanding","Operations","78%","Financial history","Latest monthly financial summary","Readiness details","Information coverage is separate from business performance."]) assert.ok(html.includes(text));
  assert.match(html,/href="\/app\/sources"/); assert.match(html,/<details/);
  const empty=renderToStaticMarkup(React.createElement(IntelligenceReadiness,{readiness:{...readiness,available:false,coverage:0}}));
  assert.match(empty,/until enough eligible original evidence/); assert.doesNotMatch(empty,/0<span/);
  const unavailable=renderToStaticMarkup(React.createElement(IntelligenceReadiness,{readiness:null}));
  assert.match(unavailable,/No score has been estimated/);
});


test("finding controls retain token-bound actions and require the explicit dismissal confirmation", async () => {
  const requests=[]; let refreshes=0;
  const props={currentCards:[card(0,{lifecycleToken:"synthetic-workspace-bound-token"})],historyCards:[],canManageLifecycle:true};
  const mocks={"next/navigation":{useRouter:()=>({refresh:()=>refreshes++})},"@/app/app/intelligence/lifecycle-actions":{mutateIntelligenceCardLifecycleAction:async request=>{requests.push(request);return {ok:true,message:"Synthetic success"};}}};
  const render=inboxHarness(props,false,mocks); let tree=render();
  button(tree,"Acknowledge").props.onClick(); await Promise.resolve(); tree=render();
  button(tree,"Pin").props.onClick(); await Promise.resolve(); tree=render();
  button(tree,"Dismiss").props.onClick(); tree=render(); assert.equal(requests.length,2,"opening dismissal is not a mutation");
  nodes(tree,node=>node.type==="select")[0].props.onChange({currentTarget:{value:"duplicate"}});
  nodes(tree,node=>node.type==="textarea")[0].props.onChange({currentTarget:{value:"Synthetic duplicated observation"}}); tree=render();
  button(tree,"Move to History").props.onClick(); await Promise.resolve();
  assert.deepEqual(requests,[
    {token:"synthetic-workspace-bound-token",action:"acknowledge",reasonCode:null,reasonText:null},
    {token:"synthetic-workspace-bound-token",action:"pin",reasonCode:null,reasonText:null},
    {token:"synthetic-workspace-bound-token",action:"dismiss",reasonCode:"duplicate",reasonText:"Synthetic duplicated observation"}
  ]); assert.equal(refreshes,3);
  const pinned=inboxHarness({...props,currentCards:[card(0,{pinned:true,lifecycleToken:"synthetic-workspace-bound-token"})]},false,mocks)();
  button(pinned,"Unpin").props.onClick(); await Promise.resolve(); assert.equal(requests.at(-1).action,"unpin");
  for(const restricted of [{...props,canManageLifecycle:false},{...props,currentCards:[card(0)]}]) {
    const tree=inboxHarness(restricted)(); for(const label of ["Acknowledge","Pin","Dismiss"]) assert.equal(button(tree,label),undefined);
  }
});

test("workspace selection keeps active membership and authentication checks before changing the default destination", async () => {
  let membership={id:"member-a",workspaces:{id:"workspace-a",name:"Synthetic workspace",subscription_status:"active"}};
  let user={id:"user-a",email:"synthetic@example.invalid"}; const filters=[]; const cookies=[];
  const query={select:()=>query,eq:(...args)=>{filters.push(args);return query;},maybeSingle:async()=>({data:membership})};
  const {selectWorkspaceAction}=loadSource("lib/workspaces/actions.ts",{
    "next/navigation":{redirect:value=>{throw new Error(value);}},
    "next/headers":{cookies:async()=>({set:(...args)=>cookies.push(args)})},
    "@/lib/admin/admin-emails":{isVaeroexAdminUser:()=>false},
    "@/lib/workspaces/demo-compatibility":{isDemoWorkspaceRecord:()=>false},
    "@/lib/supabase/server":{createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user}})},from:table=>{assert.equal(table,"workspace_members");return query;}})}
  });
  const form=new FormData();form.set("workspace_id","workspace-a");
  await assert.rejects(selectWorkspaceAction(form),{message:"/app/intelligence?message=Switched%20to%20Synthetic%20workspace."});
  assert.deepEqual(filters,[["workspace_id","workspace-a"],["user_id","user-a"],["status","active"]]);assert.equal(cookies.length,1);assert.equal(cookies[0][1],"workspace-a");
  membership=null; await assert.rejects(selectWorkspaceAction(form),/only have access to workspaces where you are an active member/);assert.equal(cookies.length,1);
  user=null; await assert.rejects(selectWorkspaceAction(form),{message:"/login"});assert.equal(cookies.length,1);
});
