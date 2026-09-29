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

const page = read("app/app/sources/SourcesPage.tsx");
const notes = read("components/evidence/BusinessNotesPanel.tsx");
const entry = notes.slice(notes.indexOf("export function BusinessNoteEntry"), notes.indexOf("export function BusinessNotesPanel"));
assert.match(entry, /<details[\s\S]*Add business note[\s\S]*<form action=\{submitBusinessNoteForReviewAction\}/);
assert.doesNotMatch(entry, /\bopen=|useState|\?\s*<form/, "native collapsed details preserve the mounted draft when toggled");
assert.match(entry, /<BusinessNoteComposer disabled=\{!enabled\}/);
assert.match(entry, /name="observation_date" disabled=\{!enabled\}/);
assert.ok(page.indexOf("{!showNoteFeedback ? notesPanel : null}") > page.indexOf('>Source Files</h2>'), "ordinary saved-source browsing precedes the notes list");
assert.ok(page.indexOf("{showNoteFeedback ? notesPanel : actionFeedback}") < page.indexOf('>Source Files</h2>'), "action return feedback and note review must precede long file lists");
assert.match(page, /const showNoteFeedback = activeTab === "files" && Boolean\(errorMessage \|\| successMessage\)/);
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
assert.doesNotMatch(page, /Sensitive information reminder|LegalSafetyNotice/, "AppShell already provides the sensitive-information reminder");
for (const name of ["approveBusinessNoteAction", "cancelBusinessNoteReviewAction", "bulkManageBusinessNotesAction"]) assert.match(notes, new RegExp(name));
assert.match(page, /key=\{`\$\{archived\}:\$\{params\?\.q/, "knowledge filters reset their displayed batch");
assert.match(page, /selection=\{\{ singularLabel: "Learned Knowledge item", archived, action: bulkManageLearnedKnowledgeAction \}\}/);
assert.match(notes, /selection=\{\{ singularLabel: "Business Note", archived, action: bulkManageBusinessNotesAction \}\}/);
console.log("Evidence browsing clarity: 357-record batches, visible-only selection, mounted composer, filters, and lifecycle regressions passed.");
