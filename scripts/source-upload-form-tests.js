const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");

const source = fs.readFileSync(path.join(__dirname, "../components/evidence/UploadSourceForm.tsx"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

test("legacy dormant check exempts only the exact upload/feedback paths", () => {
  const { withoutSquareQualificationPaths } = require("./square-dormant-scope-test-support.js");
  for (const file of ["app/app/files/actions.ts", "components/evidence/UploadSourceForm.tsx", "components/app/ToastRegion.tsx", "components/operations/AnalysisProgressSubmit.tsx", "components/operations/FormControls.tsx", "components/operations/PendingSubmitButton.tsx"]) {
    assert.equal(withoutSquareQualificationPaths(file), "");
  }
  for (const file of ["app/app/files/unrelated.ts", "components/evidence/Unrelated.tsx", "lib/supabase/unrelated.ts", "supabase/migrations/unrelated.sql", "services/unrelated/runtime.ts"]) {
    assert.equal(withoutSquareQualificationPaths(file), file);
  }
});
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
}
function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join("");
  return tree && typeof tree === "object" ? content(tree.props?.children) : tree == null || typeof tree === "boolean" ? "" : String(tree);
}
function fixture(server) {
  const slots = [];
  const effects = [];
  const timers = [];
  let index = 0;
  let running;
  let pending = false;
  let actionState = { error: null };
  const hooks = {
    ...React,
    startTransition: (callback) => callback(),
    useState(initial) { const key = index++; if (!(key in slots)) slots[key] = initial; return [slots[key], (next) => { slots[key] = next; }]; },
    useRef(initial) { const key = index++; return slots[key] ||= { current: initial }; },
    useEffect(callback, deps) {
      const key = index++;
      if (!slots[key] || deps.some((value, i) => !Object.is(value, slots[key].deps[i]))) {
        effects.push(() => { slots[key]?.cleanup?.(); slots[key] = { deps, cleanup: callback() }; });
      }
    },
    useActionState(action) { return [actionState, (data) => { pending = true; running = action(actionState, data).then((state) => { actionState = state; }).finally(() => { pending = false; }); }, pending]; }
  };
  const loaded = { exports: {} };
  Function("require", "module", "exports", compiled)((name) => {
    if (name === "react") return hooks;
    if (name === "next/link") return { default: "a" };
    if (name === "@/app/app/files/actions") return { uploadSourceAction: server };
    return require(name);
  }, loaded, loaded.exports);
  return {
    render() { index = 0; const tree = loaded.exports.UploadSourceForm({ folders: [{ id: "folder-one", name: "Monthly review" }] }); effects.splice(0).forEach((callback) => callback()); return tree; },
    finish: () => running,
    timers,
    get state() { return actionState; }
  };
}
async function withEnvironment(run) {
  const oldWindow = global.window;
  const oldFormData = global.FormData;
  const file = new File(["date,amount\n2026-09-01,42\n"], "synthetic.csv", { type: "text/csv" });
  const values = new Map([["file", file], ["display_name", "September review"], ["folder_id", "folder-one"]]);
  let resets = 0;
  const form = { values, reset() { resets++; } };
  global.FormData = class { constructor(element) { this.values = new Map(element.values); } get(key) { return this.values.get(key); } };
  global.window = { setTimeout() { return 1; }, clearTimeout() {} };
  try { await run({ form, file, get resets() { return resets; } }); }
  finally { global.window = oldWindow; global.FormData = oldFormData; }
}
const submit = (tree, form) => tree.props.onSubmit({ preventDefault() {}, currentTarget: form });

test("first submit acknowledges immediately and blocks a repeated submission", () => withEnvironment(async ({ form, file }) => {
  let calls = 0;
  let resolve;
  const view = fixture(async (_state, data) => { calls++; assert.equal(data.get("file"), file); return new Promise((done) => { resolve = done; }); });
  const initial = view.render();
  submit(initial, form);
  submit(initial, form);
  assert.equal(calls, 1);
  const busy = view.render();
  assert.match(content(busy), /Request received/);
  assert.equal(nodes(busy).find((node) => node.type === "fieldset").props.disabled, true);
  resolve({ error: "Correct the selected folder." });
  await view.finish();
}));

test("recoverable validation preserves file and entered fields without resetting the form", () => withEnvironment(async (context) => {
  const view = fixture(async () => ({ error: "That folder is unavailable." }));
  submit(view.render(), context.form);
  await view.finish();
  view.render();
  const result = view.render();
  assert.match(content(result), /That folder is unavailable/);
  assert.equal(context.form.values.get("file"), context.file);
  assert.equal(context.form.values.get("display_name"), "September review");
  assert.equal(context.form.values.get("folder_id"), "folder-one");
  assert.equal(context.resets, 0);
  assert.equal(nodes(result).find((node) => node.type === "fieldset").props.disabled, undefined);
  assert.equal(result.props.action, undefined, "manual submission must not invoke React's automatic form reset");
}));

test("lost transport acknowledgment stays readable and blocked without automatic retry", () => withEnvironment(async (context) => {
  let calls = 0;
  const view = fixture(async () => { calls++; throw new TypeError("Failed to fetch"); });
  submit(view.render(), context.form);
  await view.finish();
  view.render();
  const result = view.render();
  assert.equal(view.state.blocked, true);
  assert.match(content(result), /Check saved sources before another upload/);
  submit(result, context.form);
  assert.equal(calls, 1);
  assert.equal(context.form.values.get("file"), context.file);
  assert.equal(context.resets, 0);
}));

test("framework authentication redirects retain their control flow", () => withEnvironment(async ({ form }) => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
  const view = fixture(async () => { throw redirect; });
  submit(view.render(), form);
  await assert.rejects(view.finish(), (error) => error === redirect);
}));
