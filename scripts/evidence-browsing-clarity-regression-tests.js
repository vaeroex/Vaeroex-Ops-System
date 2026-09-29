const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const source = read("components/evidence/EvidenceBatchList.tsx");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
let state;
function Selection(props) { return props.children; }
const loaded = { exports: {} };
Function("require", "module", "exports", compiled)((name) => {
  if (name === "react") return { useState(initial) { state ??= initial; return [state, (next) => { state = typeof next === "function" ? next(state) : next; }]; } };
  if (name === "@/components/evidence/EvidenceLifecycleSelection") return { EvidenceLifecycleSelection: Selection };
  return require(name);
}, loaded, loaded.exports);
const { EvidenceBatchList } = loaded.exports;
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join("");
  return tree?.props ? text(tree.props.children) : "";
}
const items = Array.from({ length: 357 }, (_, index) => ({ id: `item-${index}`, label: `Item ${index}`, approvable: index < 30, content: `Record ${index}` }));
const action = async () => ({ ok: true, message: "fixture only" });
for (const withSelection of [false, true]) {
  state = undefined;
  let previous = [];
  for (let expected = 25; ; expected = Math.min(expected + 25, items.length)) {
    const tree = EvidenceBatchList({ items, pluralLabel: "fixture records", selection: withSelection ? { singularLabel: "fixture record", action } : undefined });
    const elements = nodes(tree);
    const count = elements.find((node) => node.props?.role === "status");
    assert.equal(text(count), `Showing ${expected} of 357 loaded fixture records matching this view.`);
    const selection = elements.find((node) => node.type === Selection);
    const visible = withSelection ? selection.props.items : elements.filter((node) => node.key?.startsWith("item-")).map((node) => ({ id: node.key }));
    assert.deepEqual(visible.map((item) => item.id), items.slice(0, expected).map((item) => item.id));
    assert.deepEqual(visible.slice(0, previous.length).map((item) => item.id), previous, "loading more preserves all previously visible records");
    if (withSelection) {
      assert.equal(selection.props.action, action, "existing lifecycle action remains unchanged");
      assert.equal(selection.props.items.length, expected, "Select All must not target hidden records");
    }
    previous = visible.map((item) => item.id);
    const more = elements.find((node) => node.type === "button");
    if (expected === items.length) { assert.equal(more, undefined); break; }
    assert.equal(text(more), `Show ${Math.min(25, items.length - expected)} more fixture records`);
    more.props.onClick();
  }
}
state = undefined;
assert.match(text(EvidenceBatchList({ items: items.slice(0, 7), pluralLabel: "files" })), /Showing 7 of 7 loaded files/);
state = undefined;
assert.equal(nodes(EvidenceBatchList({ items: [], pluralLabel: "files" })).some((node) => node.type === "button"), false);

// Exercise the actual selection component's handlers, not just its batching
// props. The existing note/knowledge actions accept at most 100 IDs.
function selectionHarness(action, { archived = false } = {}) {
  const React = require("react");
  const slots = [];
  const transitions = [];
  let cursor = 0;
  let context;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useMemo: compute => compute(),
    useContext: () => context,
    useTransition: () => [false, fn => transitions.push(fn())],
  };
  const selectionSource = read("components/evidence/EvidenceLifecycleSelection.tsx");
  const selectionModule = { exports: {} };
  Function("require", "module", "exports", ts.transpileModule(selectionSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText)(name => {
    if (name === "react") return hooks;
    if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
    return require(name);
  }, selectionModule, selectionModule.exports);
  return {
    render(visibleItems) {
      cursor = 0;
      const tree = selectionModule.exports.EvidenceLifecycleSelection({ items: visibleItems, singularLabel: "fixture record", action, archived, children: null });
      context = tree.props.value;
      return tree;
    },
    checkbox(id) { return selectionModule.exports.EvidenceLifecycleCheckbox({ id, label: id }); },
    forceToggle(id) { context.toggle(id); },
    settled() { return Promise.all(transitions); },
  };
}
const findButton = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node).trim() === label);

require("node:test")("125 and 357 shown records retain a 100-ID action cap, truthful selection label, and one confirmed submission", async () => {
  const originalWindow = global.window;
  try {
    for (const count of [125, 357]) {
      state = count;
      const batch = EvidenceBatchList({ items, pluralLabel: "fixture records", selection: { singularLabel: "fixture record", action } });
      const displayed = nodes(batch).find(node => node.type === Selection).props.items;
      assert.equal(displayed.length, count, "browsing still displays the requested records beyond the action limit");
      const submissions = [];
      const confirmations = [];
      let confirmed = false;
      global.window = {
        confirm(message) { confirmations.push(message); return confirmed; },
        prompt() { throw new Error("Archive must not request delete confirmation"); },
      };
      const harness = selectionHarness(async input => {
        assert.ok(input.ids.length <= 100);
        submissions.push(input);
        return { ok: true, message: "Synthetic acknowledgement" };
      });
      let tree = harness.render(displayed);
      assert.match(text(tree), /Maximum 100 per action/);
      findButton(tree, "Select first 100 shown").props.onClick();
      tree = harness.render(displayed);
      assert.match(text(tree), /100 selected · Maximum 100 per action/);
      assert.equal(harness.checkbox(displayed[100].id).props.disabled, true);
      assert.equal(harness.checkbox(displayed[0].id).props.disabled, false, "selected records remain available to deselect");
      harness.forceToggle(displayed[100].id);
      tree = harness.render(displayed);
      assert.equal(tree.props.value.selected.size, 100, "a direct handler call cannot bypass the checkbox cap");
      assert.equal(tree.props.value.selected.has(displayed[100].id), false);

      harness.checkbox(displayed[0].id).props.onChange();
      tree = harness.render(displayed);
      assert.equal(harness.checkbox(displayed[count - 1].id).props.disabled, false);
      harness.checkbox(displayed[count - 1].id).props.onChange();
      tree = harness.render(displayed);
      assert.equal(tree.props.value.selected.size, 100);
      assert.equal(tree.props.value.selected.has(displayed[count - 1].id), true, "any shown record can replace a deselected item");
      findButton(tree, "Archive").props.onClick();
      await harness.settled();
      assert.equal(submissions.length, 0, "cancelled confirmation never submits");
      confirmed = true;
      findButton(tree, "Archive").props.onClick();
      await harness.settled();
      assert.equal(submissions.length, 1, "one explicit action is not chunked or retried");
      assert.equal(submissions[0].ids.length, 100);
      assert.equal(submissions[0].action, "archive");
      assert.deepEqual(submissions[0].ids, [...displayed.slice(1, 100).map(item => item.id), displayed[count - 1].id]);
      assert.ok(confirmations.every(message => message.startsWith("Archive 100 fixture records?")));
      tree = harness.render(displayed);
      assert.match(text(tree), /0 selected/, "successful existing action still clears selection");
    }
  } finally { global.window = originalWindow; }
});

require("node:test")("incremental selection stays capped as batches grow and subset lists keep Select All behavior", () => {
  const harness = selectionHarness(async () => { throw new Error("Selection must not submit"); });
  let visible = items.slice(0, 25);
  let tree = harness.render(visible);
  findButton(tree, "Select All").props.onClick();
  tree = harness.render(visible);
  assert.equal(tree.props.value.selected.size, 25);
  visible = items.slice(0, 125);
  tree = harness.render(visible);
  assert.equal(tree.props.value.selected.size, 25, "loading more does not automatically select new records");
  for (const item of visible.slice(25)) harness.forceToggle(item.id);
  tree = harness.render(visible);
  assert.equal(tree.props.value.selected.size, 100);
  assert.equal(tree.props.value.selected.has(visible[100].id), false);
  findButton(tree, "Clear Selection").props.onClick();
  tree = harness.render(visible);
  assert.equal(tree.props.value.selected.size, 0);
  harness.forceToggle("hidden-record");
  tree = harness.render(visible);
  assert.equal(tree.props.value.selected.size, 0, "only shown records can enter selection");
});

const page = read("app/app/sources/SourcesPage.tsx");
const notes = read("components/evidence/BusinessNotesPanel.tsx");
const entry = notes.slice(notes.indexOf("export function BusinessNoteEntry"), notes.indexOf("export function BusinessNotesPanel"));
assert.match(entry, /<details[\s\S]*Add business note[\s\S]*<form action=\{submitBusinessNoteForReviewAction\}/);
assert.doesNotMatch(entry, /\bopen=|useState|\?\s*<form/, "native collapsed details preserve the mounted draft when toggled");
assert.match(entry, /<BusinessNoteComposer disabled=\{!enabled\}/);
assert.match(entry, /name="observation_date" disabled=\{!enabled\}/);
assert.ok(page.indexOf("{!showNoteFeedback ? notesPanel : null}") > page.indexOf('>Source Files</h2>'), "ordinary saved-source browsing precedes the notes list");
assert.ok(page.indexOf("{showNoteFeedback ? notesPanel : actionFeedback}") < page.indexOf('>Source Files</h2>'), "action return feedback and note review must precede long file lists");
assert.match(page, /const showNoteFeedback = activeTab === "files" && params\.feedback === "business-notes" && Boolean\(errorMessage \|\| successMessage\)/);
assert.match(page, /feedback=\{showNoteFeedback \? actionFeedback : undefined\}/);
const noteExports = { exports: {} };
Function("require", "module", "exports", ts.transpileModule(notes, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText)((name) => name === "react/jsx-runtime" ? require(name) : {}, noteExports, noteExports.exports);
for (const label of ["Business Note extraction failed", "Business Note ready for review"]) {
  const feedback = require("react").createElement("p", { role: "status" }, label);
  const tree = noteExports.exports.BusinessNotesPanel({ notes: [], feedback });
  assert.equal(tree.props.id, "business-notes", "the original action fragment remains the review target");
  assert.equal(text(tree.props.children[0]), label, "the result must render inside the hash landing target, before note content");
  assert.equal(nodes(tree).filter((node) => node === feedback).length, 1);
}
assert.doesNotMatch(page, /Sensitive information reminder|LegalSafetyNotice/, "file upload owns the single inline sensitive-information reminder; browsing must not duplicate it");
for (const name of ["approveBusinessNoteAction", "cancelBusinessNoteReviewAction", "bulkManageBusinessNotesAction"]) assert.match(notes, new RegExp(name));
assert.match(page, /key=\{`\$\{archived\}:\$\{params\?\.q/, "knowledge filters reset their displayed batch");
assert.match(page, /selection=\{\{ singularLabel: "Learned Knowledge item", archived, action: bulkManageLearnedKnowledgeAction \}\}/);
assert.match(notes, /selection=\{\{ singularLabel: "Business Note", archived, action: bulkManageBusinessNotesAction \}\}/);

// Exercise the actual note return URL and the actual page discriminator. A
// fragment alone is unavailable to a server-rendered page, so note actions
// explicitly identify their return surface without classifying message text.
const noteActions = read("app/app/sources/business-notes/actions.ts");
const actionAst = ts.createSourceFile("actions.ts", noteActions, ts.ScriptTarget.Latest, true);
const noticeDeclaration = actionAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "noticeUrl");
assert.ok(noticeDeclaration);
const noticeExports = {};
Function("exports", ts.transpileModule(`${noticeDeclaration.getText(actionAst)}\nexports.noticeUrl = noticeUrl;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(noticeExports);
const pageAst = ts.createSourceFile("SourcesPage.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let feedbackExpression;
function findFeedback(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(pageAst) === "showNoteFeedback") feedbackExpression = node.initializer.getText(pageAst);
  ts.forEachChild(node, findFeedback);
}
findFeedback(pageAst);
assert.ok(feedbackExpression);
const placesNoteFeedback = Function("activeTab", "params", "errorMessage", "successMessage", `return ${feedbackExpression};`);
for (const kind of ["error", "message"]) {
  const message = kind === "error" ? "Business context extraction failed" : "Business Note approved";
  const url = new URL(noticeExports.noticeUrl(kind, message), "https://example.invalid");
  assert.equal(url.pathname, "/app/sources");
  assert.equal(url.hash, "#business-notes");
  assert.equal(url.searchParams.get(kind), message);
  assert.equal(url.searchParams.get("feedback"), "business-notes");
  assert.equal(placesNoteFeedback("files", Object.fromEntries(url.searchParams), kind === "error" ? message : null, kind === "message" ? message : null), true);
}
for (const message of ["File uploaded", "File archived", "Business Note appears in this file title"]) {
  assert.equal(placesNoteFeedback("files", { message }, null, message), false, "generic upload/lifecycle feedback stays at the source-page return");
  assert.equal(placesNoteFeedback("files", { error: message }, message, null), false);
}
assert.equal(placesNoteFeedback("files", { feedback: "file" }, "File failed", null), false);
assert.equal(placesNoteFeedback("files", { feedback: "business-notes" }, null, null), false);
assert.equal(placesNoteFeedback("archived", { feedback: "business-notes" }, "Error", null), false);
console.log("Evidence browsing clarity: 357-record batches, visible-only selection, mounted composer, filters, and lifecycle regressions passed.");
