/* eslint-disable @typescript-eslint/no-require-imports -- Offline fixtures exercise the actual UI without customer data. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "..");

function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = require.resolve.paths("react");
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
  return loaded.exports;
}
const link = { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
const policy = load("lib/storage-capacity/policy.ts");
const { StorageUsageOverview } = load("components/storage-capacity/StorageUsageOverview.tsx", { "next/link": link, "@/lib/storage-capacity/policy": policy });
const { StorageFileList } = load("components/storage-capacity/StorageFileList.tsx", { "next/link": link, "next/navigation": { useRouter: () => ({ refresh() {} }) }, "@/lib/storage-capacity/policy": policy });
const { CapacityPurchase } = load("components/storage-capacity/CapacityPurchase.tsx", { "next/link": link, "next/navigation": { useRouter: () => ({ refresh() {} }) }, "@/lib/storage-capacity/policy": policy });
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const emptyGroup = { bytes: 0, files: 0 };
function usage(overrides = {}) {
  return { workspaceId: "workspace-a", includedBytes: 15e9, includedFiles: 500, paidPacks: 0, allowanceBytes: 15e9, allowanceFiles: 500,
    usedBytes: 0, usedFiles: 0, reservedBytes: 0, reservedFiles: 0, availableBytes: 15e9, availableFiles: 500,
    active: emptyGroup, archived: emptyGroup, trash: emptyGroup, historicalTrash: emptyGroup, unlinkedBytes: 0, missingFiles: 0,
    measuredAt: "2026-10-12T12:00:00Z", largestFiles: [], separateData: [{ label: "Google Sheets", estimatedBytes: null, records: null }], ...overrides };
}
const billing = { purchasesEnabled: true, mode: "test", maxPacks: 10, subscriptions: [] };

test("refunded subscriptions distinguish payment-provider status from currently paid capacity", () => {
  const html = render(CapacityPurchase, { workspaceId: "workspace-a", workspaceName: "Synthetic A", currentPacks: 1,
    billing: { ...billing, subscriptions: [{ id: "sub-refunded", packs: 2, status: "active", paidThrough: null, cancelAtPeriodEnd: true, monthlyCents: 1000 }] } });
  assert.match(html, /No current paid capacity/);
  assert.match(html, /Payment provider status: active/);
  assert.match(html, /Renewal stopped/);
  assert.doesNotMatch(html, /Ends Not confirmed|Paid through Not confirmed/);
});

function sourceQueryFixture(tables, { failPage = 0 } = {}) {
  const calls = [];
  const valueAt = (row, field) => field.split(/->>?/).reduce((value, key) => value?.[key], row);
  return { calls, from(table) {
    const call = { table, filters: [], columns: "*", limit: 1000, order: null }; calls.push(call);
    const query = {
      select(columns) { call.columns = columns; return query; },
      eq(field, value) { call.filters.push(row => valueAt(row, field) === value); return query; },
      is(field, value) { return query.eq(field, value); },
      gt(field, value) { call.filters.push(row => row[field] > value); return query; },
      in(field, values) { call.filters.push(row => values.includes(row[field])); return query; },
      order(field, options) { call.order = { field, ...options }; return query; },
      limit(value) { call.limit = value; return query; },
      async maybeSingle() { const result = await query; return { ...result, data: result.data?.[0] || null }; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (failPage && calls.length === failPage) return { data: null, error: { message: "Synthetic page unavailable" } };
        let rows = (tables[table] || []).filter(row => call.filters.every(filter => filter(row)));
        if (call.order) rows.sort((a, b) => String(a[call.order.field]).localeCompare(String(b[call.order.field])) * (call.order.ascending ? 1 : -1));
        rows = rows.slice(0, Math.min(1000, call.limit));
        if (call.columns !== "*") rows = rows.map(row => Object.fromEntries(call.columns.split(",").map(column => {
          const [alias, field] = column.includes(":") ? column.split(":") : [column, column];
          return [alias, valueAt(row, field) ?? null];
        })));
        return { data: rows, error: null };
      }).then(resolve, reject); }
    };
    return query;
  } };
}

test("source browser reaches all 5,500 retained files beyond the server row ceiling, without loading deleted history or extracted content", async () => {
  const { loadSourceFiles } = load("lib/files/source-browse.ts");
  const files = Array.from({ length: 5500 }, (_, index) => ({ id: String(index).padStart(5, "0"), workspace_id: "a", display_name: `Source ${index}`, original_name: `Source ${index}`, deleted_at: null, archived_at: index % 2 ? "2026-10-12" : null, metadata_json: { extracted_text: "private extracted text", latest_analysis_output: { findings: "private details" }, analysis_review_status: "approved" } }));
  const db = sourceQueryFixture({ file_uploads: [...files, { ...files[0], id: "99998", deleted_at: "2026-10-12" }, { ...files[0], id: "99999", workspace_id: "b" }] });
  const result = await loadSourceFiles(db, "a");
  assert.equal(result.error, null);
  assert.equal(result.data.length, 5500);
  assert.equal(result.data.filter(file => file.archived_at).length, 2750);
  assert.equal(result.data.at(-1).display_name, "Source 5499");
  assert.equal(new Set(result.data.map(file => file.id)).size, 5500);
  assert.equal(db.calls.length, 12, "an exact page boundary requires the empty final page");
  assert.equal(result.data.at(-1).metadata_json.analysis_review_status, "approved");
  assert.doesNotMatch(JSON.stringify(result.data), /private extracted text|private details/);
  assert.ok(db.calls.every(call => call.limit === 500 && call.columns !== "*"));
  const failing = sourceQueryFixture({ file_uploads: files }, { failPage: 3 });
  const failed = await loadSourceFiles(failing, "a");
  assert.equal(failed.data.length, 0, "failed paging cannot claim partial list counts are complete");
  assert.match(failed.error.message, /unavailable/);
});

test("direct source detail and analysis history are workspace/file scoped before limiting, including old files", async () => {
  const { loadSourceFiles, loadSourceRuns } = load("lib/files/source-browse.ts");
  const file = { id: "old-source", workspace_id: "a", deleted_at: null, metadata_json: { extracted_text: "selected file text" } };
  const oldRun = { id: "00000", workspace_id: "a", agent_type: "file_analysis", status: "completed", created_at: "2025-01-01", deleted_at: null, archived_at: null, input_json: { extra_inputs: { file: { id: file.id } } } };
  const runs = Array.from({ length: 1200 }, (_, index) => ({ ...oldRun, id: String(index + 1).padStart(5, "0"), created_at: "2026-10-12", input_json: { extra_inputs: { file: { id: "other-file" } } } }));
  const db = sourceQueryFixture({ file_uploads: [file], ai_agent_runs: [oldRun, ...runs, { ...oldRun, id: "foreign", workspace_id: "b" }] });
  assert.deepEqual((await loadSourceFiles(db, "a", file.id)).data, [file]);
  assert.deepEqual((await loadSourceFiles(db, "b", file.id)).data, []);
  assert.deepEqual((await loadSourceRuns(db, "a", file.id)).data, [oldRun]);
  const page = fs.readFileSync(path.join(root, "app/app/sources/SourcesPage.tsx"), "utf8");
  assert.match(page, /loadSourceFiles\(supabase, workspaceId, options\.sourceDetail \? params\.file : undefined\)/);
  assert.match(page, /eq\("source_file_id", params\.file\)/);
});

test("an abandoned active run cannot hide a newer persisted analysis result in source lists", () => {
  const { currentSourceRuns } = load("lib/files/source-browse.ts");
  const file = { id: "file-a", metadata_json: { latest_analysis_at: "2026-10-12T12:00:00Z" } };
  const stale = { id: "stale", created_at: "2026-10-12T10:00:00Z", status: "running", input_json: { extra_inputs: { file: { id: file.id } } } };
  const newer = { ...stale, id: "newer", created_at: "2026-10-12T13:00:00Z" };
  assert.deepEqual(currentSourceRuns([file], [newer, stale]), [newer]);
  assert.deepEqual(currentSourceRuns([file], [stale]), []);
});

test("allowances are exact decimal GB per workspace and only qualified pack quantities are accepted", () => {
  assert.deepEqual(policy.capacityAllowance(0), { bytes: 15e9, files: 500, monthlyCents: 0 });
  assert.deepEqual(policy.capacityAllowance(3), { bytes: 45e9, files: 2000, monthlyCents: 1500 });
  assert.deepEqual(policy.capacityAllowance(10), { bytes: 115e9, files: 5500, monthlyCents: 5000 });
  for (const invalid of [-1, 0.5, 11, NaN, Infinity]) assert.throws(() => policy.capacityAllowance(invalid), RangeError);
  assert.equal(policy.MAX_UPLOAD_BYTES, 26214400);
});

test("warnings start exactly at 80 and 95 percent, include reservations, and preserve access at the limit", () => {
  assert.equal(policy.storageWarning(799, 1000), null);
  assert.equal(policy.storageWarning(800, 1000), "warning");
  assert.equal(policy.storageWarning(949, 1000), "warning");
  assert.equal(policy.storageWarning(950, 1000), "critical");
  assert.equal(policy.storageWarning(1000, 1000), "full");
  const html = render(StorageUsageOverview, { usage: usage({ usedBytes: 11e9, reservedBytes: 1e9, availableBytes: 3e9 }) });
  assert.match(html, /At least 80% committed/);
  assert.match(html, /1 GB reserved for uploads in progress/);
  assert.match(html, /3 GB.*available/);
  assert.match(html, /existing files remain available to view, download, search, export, and restore/);
  assert.match(html, /no automatic purchases or overage charges/);
});

test("unknown database measurements, missing originals, and protected historical Trash are never represented as empty data", () => {
  const html = render(StorageUsageOverview, { usage: usage({ historicalTrash: { bytes: 1200, files: 2 }, missingFiles: 3 }) });
  assert.match(html, /15 GB and 500 file slots/);
  assert.match(html, /never pooled across businesses/);
  assert.equal((html.match(/Not measured/g) ?? []).length, 2);
  assert.match(html, /outside the paid uploaded-file quota/);
  assert.match(html, /protected from permanent deletion/);
  assert.match(html, /3 file records have no matching stored original/);
  assert.match(html, /Every retained original uses both bytes and a file slot, including archived files and Trash/);
  assert.match(html, /can be restored even when the workspace is over its allowance/);
  assert.match(html, /Only new uploads that need unavailable capacity are blocked/);
  assert.doesNotMatch(html.slice(html.indexOf(">Google Sheets</th>")), />0 bytes<\/td>/);
});

test("missing originals cannot download or restore, and non-editors never receive lifecycle controls", () => {
  const file = { id: "file-a", displayName: "Synthetic original", bytes: 4000, state: "historical_trash", deletedAt: null, purgeAfter: null, legacyProtected: true, storageMissing: true };
  let html = render(StorageFileList, { workspaceId: "workspace-a", files: [file], canManage: true });
  assert.doesNotMatch(html, />Download<|>Restore</);
  assert.doesNotMatch(html, /Delete permanently/);
  assert.match(html, /Protected pending retention notice/);
  html = render(StorageFileList, { workspaceId: "workspace-b", files: [{ ...file, storageMissing: false }], canManage: false });
  assert.match(html, /workspaceId=workspace-b/);
  assert.doesNotMatch(html, />Restore<|>Archive<|>Delete permanently</);
  assert.match(html, /No automatic deletion scheduled/);
});

test("owner Buy capacity is always visible at zero usage, full usage, the pack limit, and a temporarily unavailable checkout", () => {
  for (const config of [{ currentPacks: 0 }, { currentPacks: 10 }, { currentPacks: 1, billing: { ...billing, purchasesEnabled: false } }]) {
    const html = render(CapacityPurchase, { workspaceId: "workspace-a", workspaceName: "Synthetic A", billing, ...config });
    assert.match(html, />Buy capacity<\/button>/);
    assert.match(html, /Buy at any usage level/);
    assert.doesNotMatch(html, /type="checkbox"/, "a collapsed purchase cannot imply accepted recurring terms");
  }
});

test("page loads only current-workspace aggregates, and never reads billing or renders purchase controls for a non-owner", async () => {
  const calls = [];
  const context = { workspaceId: "workspace-b", workspace: { name: "Synthetic B" }, membership: { role: "member" }, user: { id: "member-b" } };
  const { default: Page } = load("app/app/settings/storage/page.tsx", {
    "next/link": link,
    "@/components/operations/PageHeader": { PageHeader: ({ title }) => React.createElement("h1", null, title) },
    "@/components/storage-capacity/CapacityPurchase": { CapacityPurchase: () => { throw new Error("non-owner purchase rendered"); } },
    "@/components/storage-capacity/StorageFileList": { StorageFileList: () => null },
    "@/components/storage-capacity/StorageTrash": { StorageTrash: () => null },
    "@/components/storage-capacity/StorageUsageOverview": { StorageUsageOverview },
    "@/lib/storage-capacity/access": { requireStorageAccess: async options => { assert.equal(options.allowExpired, true); return context; } },
    "@/lib/storage-capacity/server": { getWorkspaceStorageUsage: async access => { assert.equal(access, context); calls.push(access.workspaceId); return usage({ workspaceId: access.workspaceId }); } },
    "@/lib/storage-capacity/billing": { getWorkspaceCapacityBilling: () => { throw new Error("non-owner billing read"); } },
  });
  const html = renderToStaticMarkup(await Page({}));
  assert.deepEqual(calls, ["workspace-b"]);
  assert.doesNotMatch(html, />Buy capacity<\/button>/);
  assert.match(html, /A workspace owner can buy capacity/);
});

function interactionFixture(relative, componentName, props) {
  const slots = [];
  let index = 0;
  let refreshes = 0;
  const hooks = { ...React, useEffect() {}, useRef(value) { const key = index++; return slots[key] ??= { current: value }; },
    useState(value) { const key = index++; if (!(key in slots)) slots[key] = value; return [slots[key], next => { slots[key] = typeof next === "function" ? next(slots[key]) : next; }]; } };
  const component = load(relative, { react: hooks, "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) }, "next/link": link, "@/lib/storage-capacity/policy": policy })[componentName];
  return { render() { index = 0; return component(props); }, get refreshes() { return refreshes; } };
}
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : []; }
function text(tree) { return Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : tree == null || typeof tree === "boolean" ? "" : String(tree); }
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);

test("purchase requires an explicit reviewed recurring authorization, binds the workspace, and rejects a stale quote", async () => {
  const oldFetch = global.fetch, oldWindow = global.window;
  const calls = [];
  const quote = { quoteId: "quote-a", workspaceId: "workspace-a", packs: 2, currentPacks: 0, totalPacks: 2, totalBytes: 35e9, totalFiles: 1500,
    currency: "usd", monthlyCents: 1000, existingMonthlyCents: 0, amountDueTodayCents: 1000, renewalDate: "2026-11-12T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z",
    cancellationEffect: "Capacity ends after the paid period. Existing files remain.", checkoutTerms: "Recurring until canceled.", termsVersion: "storage-capacity-v1" };
  global.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => url.endsWith("quote") ? quote : { url: "https://checkout.stripe.com/c/pay/synthetic" } }; };
  let destination;
  global.window = { location: { assign(url) { destination = url; } } };
  try {
    const fixture = interactionFixture("components/storage-capacity/CapacityPurchase.tsx", "CapacityPurchase", { workspaceId: "workspace-a", workspaceName: "Synthetic A", currentPacks: 0, billing });
    button(fixture.render(), "Buy capacity").props.onClick();
    const select = nodes(fixture.render()).find(node => node.type === "select");
    select.props.onChange({ target: { value: "2" } });
    await button(fixture.render(), "Review purchase").props.onClick();
    let tree = fixture.render();
    assert.match(text(tree), /35 GB · 1,500 files/);
    assert.match(text(tree), /Amount due today\$10.00 USD/);
    assert.equal(button(tree, "Continue to secure payment").props.disabled, true);
    await button(tree, "Continue to secure payment").props.onClick();
    assert.equal(calls.length, 1, "calling the handler before acceptance cannot begin checkout");
    nodes(tree).find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } });
    tree = fixture.render();
    assert.equal(button(tree, "Continue to secure payment").props.disabled, false);
    await button(tree, "Continue to secure payment").props.onClick();
    assert.deepEqual(calls[0].body, { workspaceId: "workspace-a", packs: 2 });
    assert.deepEqual(calls[1].body, { workspaceId: "workspace-a", quoteId: "quote-a", acceptedTerms: true });
    assert.equal(destination, "https://checkout.stripe.com/c/pay/synthetic");
    quote.expiresAt = "2000-01-01T00:00:00Z";
    const stale = interactionFixture("components/storage-capacity/CapacityPurchase.tsx", "CapacityPurchase", { workspaceId: "workspace-a", workspaceName: "Synthetic A", currentPacks: 0, billing });
    button(stale.render(), "Buy capacity").props.onClick();
    await button(stale.render(), "Review purchase").props.onClick();
    nodes(stale.render()).find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } });
    await button(stale.render(), "Continue to secure payment").props.onClick();
    assert.equal(calls.length, 3, "expired review makes no checkout request");
    assert.match(text(stale.render()), /purchase review expired/);
  } finally { global.fetch = oldFetch; global.window = oldWindow; }
});

test("permanent deletion is explicitly confirmed before a workspace-bound mutation", async () => {
  const oldFetch = global.fetch, oldWindow = global.window;
  const calls = [];
  let consent = false;
  global.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ pending: true }) }; };
  global.window = { confirm(message) { assert.match(message, /cannot be recovered/); return consent; } };
  try {
    const fixture = interactionFixture("components/storage-capacity/StorageFileList.tsx", "StorageFileList", { workspaceId: "workspace-b", canManage: true,
      files: [{ id: "file-b", displayName: "Synthetic B", bytes: 1234, state: "trash", storageMissing: false, legacyProtected: false }] });
    await button(fixture.render(), "Delete permanently").props.onClick();
    assert.equal(calls.length, 0);
    consent = true;
    await button(fixture.render(), "Delete permanently").props.onClick();
    assert.deepEqual(calls[0].body, { workspaceId: "workspace-b", fileId: "file-b", action: "purge" });
    assert.match(text(fixture.render()), /Permanent deletion is pending/);
    assert.equal(fixture.refreshes, 1);
  } finally { global.fetch = oldFetch; global.window = oldWindow; }
});

test("canceling a paid pack requires explicit confirmation and discloses the retained-file downgrade", async () => {
  const oldFetch = global.fetch, oldWindow = global.window;
  const calls = [], messages = [];
  let consent = false;
  global.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ endsAt: "2026-11-12T00:00:00Z" }) }; };
  global.window = { confirm(message) { messages.push(message); return consent; } };
  try {
    const fixture = interactionFixture("components/storage-capacity/CapacityPurchase.tsx", "CapacityPurchase", { workspaceId: "workspace-a", workspaceName: "Synthetic A", currentPacks: 2,
      billing: { ...billing, subscriptions: [{ id: "sub-a", packs: 2, status: "active", paidThrough: "2026-11-12T00:00:00Z", cancelAtPeriodEnd: false, monthlyCents: 1000 }] } });
    await button(fixture.render(), "Cancel renewal").props.onClick();
    assert.equal(calls.length, 0);
    assert.match(messages[0], /15 GB and 500 file slots/);
    assert.match(messages[0], /Existing files are retained/);
    consent = true;
    await button(fixture.render(), "Cancel renewal").props.onClick();
    assert.deepEqual(calls, [{ url: "/api/storage/capacity/cancel", body: { workspaceId: "workspace-a", subscriptionId: "sub-a", confirmed: true } }]);
    assert.match(text(fixture.render()), /Renewal canceled/);
    assert.equal(fixture.refreshes, 1);
  } finally { global.fetch = oldFetch; global.window = oldWindow; }
});

test("refunded renewable packs reserve purchase slots, and canceling them does not remove another purchase's capacity", async () => {
  const oldFetch = global.fetch, oldWindow = global.window;
  const messages = [], calls = [];
  global.window = { confirm(message) { messages.push(message); return true; } };
  global.fetch = async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ endsAt: null }) }; };
  try {
    const fixture = interactionFixture("components/storage-capacity/CapacityPurchase.tsx", "CapacityPurchase", { workspaceId: "workspace-a", workspaceName: "Synthetic A", currentPacks: 1,
      billing: { ...billing, committedPacks: 9, subscriptions: [{ id: "refunded", packs: 8, status: "active", paidThrough: null, cancelAtPeriodEnd: false, monthlyCents: 4000 }] } });
    button(fixture.render(), "Buy capacity").props.onClick();
    const tree = fixture.render();
    assert.equal(nodes(tree).filter(node => node.type === "option").length, 1);
    assert.match(text(tree), /9 packs are committed/);
    await button(tree, "Cancel renewal").props.onClick();
    assert.match(messages[0], /stops its next \$40\.00\/month renewal/);
    assert.match(messages[0], /does not reduce the current allowance/);
    assert.doesNotMatch(messages[0], /Not confirmed|15 GB and 500/);
    assert.equal(calls[0].subscriptionId, "refunded");
    assert.match(text(fixture.render()), /This purchase has no current paid capacity/);
  } finally { global.fetch = oldFetch; global.window = oldWindow; }
});

test("Trash loads the API's first page, exposes every page, and disables navigation at the boundaries", async () => {
  const prior = global.fetch;
  const requests = [], slots = [], effects = [];
  let index = 0;
  const hooks = { ...React,
    useState(initial) { const key = index++; if (!(key in slots)) slots[key] = initial; return [slots[key], next => { slots[key] = typeof next === "function" ? next(slots[key]) : next; }]; },
    useEffect(callback, dependencies) {
      const key = index++;
      if (!slots[key] || dependencies.some((value, position) => !Object.is(value, slots[key].dependencies[position]))) {
        effects.push(() => { slots[key]?.cleanup?.(); slots[key] = { dependencies, cleanup: callback() }; });
      }
    },
  };
  global.fetch = async url => {
    const request = new URL(url, "https://workspace.invalid");
    const page = Number(request.searchParams.get("page"));
    assert.equal(request.searchParams.get("workspaceId"), "workspace-b");
    assert.ok(page >= 1 && page <= 2, "public Trash endpoint uses one-based pages");
    requests.push(page);
    return { ok: true, json: async () => ({ files: [{ id: `file-${page}` }], total: 26, page, pageSize: 25 }) };
  };
  try {
    const { StorageTrash } = load("components/storage-capacity/StorageTrash.tsx", { react: hooks, "@/components/storage-capacity/StorageFileList": { StorageFileList: () => null } });
    const renderTrash = () => { index = 0; const tree = StorageTrash({ workspaceId: "workspace-b", canManage: true }); effects.splice(0).forEach(effect => effect()); return tree; };
    renderTrash(); await new Promise(resolve => setImmediate(resolve));
    let tree = renderTrash();
    assert.match(text(tree), /Page 1 of 2/);
    assert.equal(button(tree, "Previous").props.disabled, true);
    assert.equal(button(tree, "Next").props.disabled, false);
    button(tree, "Next").props.onClick(); renderTrash(); await new Promise(resolve => setImmediate(resolve));
    tree = renderTrash();
    assert.match(text(tree), /Page 2 of 2/);
    assert.equal(button(tree, "Previous").props.disabled, false);
    assert.equal(button(tree, "Next").props.disabled, true);
    assert.deepEqual(requests, [1, 2]);
  } finally { global.fetch = prior; slots.forEach(slot => slot?.cleanup?.()); }
});
