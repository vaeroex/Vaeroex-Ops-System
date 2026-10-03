const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");

const root = path.resolve(__dirname, "..");
function loadSource(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
  return loaded.exports;
}

// Exercise the actual components and effects with the same stable-hook approach
// used by the workspace interaction tests. No server, browser, or network access.
function harness() {
  const slots = [];
  const effects = [];
  const timers = new Map();
  let cursor = 0;
  let nextTimer = 0;
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
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && dependencies?.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
      effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { dependencies, cleanup: effect() };
      });
    },
  };
  return {
    hooks,
    window: {
      location: { href: "http://localhost/app/sources?folder=one&message=Saved#current" },
      history: { state: { fixture: true }, replaceState(state, _title, url) { this.state = state; this.url = url; } },
      setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    render(component, props) { cursor = 0; return component(props); },
    effects() { effects.splice(0).forEach((effect) => effect()); },
    elapse(ms) { for (const [id, timer] of [...timers]) if (timer.delay <= ms) { timers.delete(id); timer.fn(); } },
  };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((node) => nodes(node, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join("");
  if (tree && typeof tree === "object") return content(tree.props?.children);
  return tree == null || typeof tree === "boolean" ? "" : String(tree);
}
const activity = { useActivitySignal() {} };
const button = (tree) => nodes(tree, (node) => node.type === "button")[0];

function withWindow(run) {
  const previous = global.window;
  const fixture = harness();
  global.window = fixture.window;
  try { return run(fixture); } finally { global.window = previous; }
}

test("security feedback remains explicit without trapping workspace navigation", () => withWindow((fixture) => {
  const { ToastRegion } = loadSource("components/app/ToastRegion.tsx", {
    react: fixture.hooks,
    "next/navigation": { useSearchParams: () => new URLSearchParams({ error: "Synthetic permission denial" }) },
    "@/components/security/SecurityResponseNotice": { SecurityResponseNotice: () => null },
    "@/lib/security/security-response": { isSecurityResponseMessage: () => true },
  });
  const ToastContent = ToastRegion().props.children.type;
  let tree = fixture.render(ToastContent);
  fixture.effects();
  fixture.elapse(7_000);
  tree = fixture.render(ToastContent);
  assert.match(content(tree), /Return to workspace/);
  button(tree).props.onClick();
  assert.equal(fixture.render(ToastContent), null);
}));

for (const kind of ["error", "message"]) {
  test(`${kind} feedback stays readable until explicitly dismissed`, () => withWindow((fixture) => {
    const searchParams = new URLSearchParams({ [kind]: `Synthetic ${kind}` });
    const { ToastRegion } = loadSource("components/app/ToastRegion.tsx", {
      react: fixture.hooks,
      "next/navigation": { useSearchParams: () => searchParams },
      "@/components/security/SecurityResponseNotice": { SecurityResponseNotice: () => null },
      "@/lib/security/security-response": { isSecurityResponseMessage: () => false },
    });
    const ToastContent = ToastRegion().props.children.type;
    let tree = fixture.render(ToastContent);
    fixture.effects();
    fixture.elapse(7_000);
    tree = fixture.render(ToastContent);
    assert.match(content(tree), new RegExp(`Synthetic ${kind}`), "the result must not disappear on a timer");
    button(tree).props.onClick();
    assert.equal(fixture.render(ToastContent), null, "explicit dismissal still works");
    assert.equal(fixture.window.history.url, "/app/sources?folder=one#current", "dismissal preserves view state and clears only feedback");
    searchParams.delete(kind);
    fixture.render(ToastContent);
    fixture.effects();
    searchParams.set(kind, `Synthetic ${kind}`);
    fixture.render(ToastContent);
    fixture.effects();
    assert.match(content(fixture.render(ToastContent)), new RegExp(`Synthetic ${kind}`), "a later identical outcome is visible again");
  }));
}

function pendingFixture(run) {
  return withWindow((fixture) => {
    const previousElement = global.HTMLElement;
    class Element {}
    global.HTMLElement = Element;
    const listeners = new Set();
    const form = {
      addEventListener(type, fn) { if (type === "submit") listeners.add(fn); },
      removeEventListener(type, fn) { if (type === "submit") listeners.delete(fn); },
    };
    const submitter = Object.assign(new Element(), { form });
    let pending = false;
    const { PendingSubmitButton } = loadSource("components/operations/PendingSubmitButton.tsx", {
      react: fixture.hooks,
      "react-dom": { useFormStatus: () => ({ pending }) },
      "@/components/app/ActivityProvider": activity,
    });
    const render = () => fixture.render(PendingSubmitButton, { children: "Save", pendingLabel: "Saving...", className: "approved-style" });
    const submit = (overrides = {}) => {
      const event = { submitter, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...overrides };
      listeners.forEach((listener) => listener(event));
      return event;
    };
    try {
      button(render()).props.ref.current = submitter;
      fixture.effects();
      return run({ fixture, render, submit, setPending(value) { pending = value; } });
    } finally { global.HTMLElement = previousElement; }
  });
}

test("first submission is acknowledged and a repeated submit before render is blocked", () => pendingFixture(({ render, submit }) => {
  assert.equal(submit().defaultPrevented, false, "the first valid submit must reach its action");
  assert.equal(submit().defaultPrevented, true, "a repeated submit must not start another action");
  const tree = render();
  assert.equal(button(tree).props.disabled, true);
  assert.match(content(tree), /Saving\.\.\./);
}));

test("cancelled submissions do not lock the form", () => pendingFixture(({ render, submit }) => {
  submit({ defaultPrevented: true });
  assert.equal(button(render()).props.disabled, false);
}));

test("an uncertain timeout keeps the submission locked without inviting a blind retry", () => pendingFixture(({ fixture, render, submit }) => {
  submit();
  render();
  fixture.effects();
  fixture.elapse(120_000);
  const tree = render();
  assert.equal(button(tree).props.disabled, true, "elapsed time does not prove that the action stopped");
  assert.match(content(tree), /longer than expected/);
  assert.doesNotMatch(content(tree), /try again|retry/i);
  assert.equal(submit().defaultPrevented, true);
}));

test("a completed action releases the submission lock for a subsequent intentional submission", () => pendingFixture(({ fixture, render, submit, setPending }) => {
  submit();
  setPending(true);
  render();
  fixture.effects();
  setPending(false);
  render();
  fixture.effects();
  assert.equal(button(render()).props.disabled, false);
  assert.equal(submit().defaultPrevented, false);
}));

test("primary and analysis actions use the guarded submit control without changing their button styles", () => withWindow((fixture) => {
  function PendingSubmitButton() {}
  const shared = { "@/components/operations/PendingSubmitButton": { PendingSubmitButton } };
  const { PrimaryButton } = loadSource("components/operations/FormControls.tsx", shared);
  const primary = PrimaryButton({ children: "Save KPI" });
  assert.equal(primary.type, PendingSubmitButton);
  assert.match(primary.props.className, /min-h-11 rounded-lg bg-vaeroex-blue/);
  const { AnalysisProgressSubmit } = loadSource("components/operations/AnalysisProgressSubmit.tsx", {
    ...shared,
    react: fixture.hooks,
    "react-dom": { useFormStatus: () => ({ pending: true }) },
    "@/components/app/ActivityProvider": activity,
  });
  const props = { children: "Analyze", pendingLabel: "Analyzing...", className: "approved-style", timeoutMs: 60_000 };
  let tree = fixture.render(AnalysisProgressSubmit, props);
  fixture.effects();
  fixture.elapse(60_000);
  tree = fixture.render(AnalysisProgressSubmit, props);
  const guarded = nodes(tree, (node) => node.type === PendingSubmitButton)[0];
  assert.equal(guarded.props.className, "approved-style");
  assert.equal(guarded.props.timeoutMs, 60_000);
  assert.match(content(guarded.props.pendingContent), /Request received/);
  assert.match(content(guarded.props.pendingContent), /not live step-by-step status/);
  assert.doesNotMatch(content(guarded.props.pendingContent), /try again|retry/i);
}));
