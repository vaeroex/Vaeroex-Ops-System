/* Presentation contract qualification; no network, database, or browser access. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("legacy dormant scope permits only the nine authorized presentation paths, not neighboring or backend files", () => {
  const { withoutSquareQualificationPaths } = require("./square-dormant-scope-test-support.js");
  const approved = [
    "app/app/forms/page.tsx", "app/app/intelligence/briefings/page.tsx", "app/globals.css",
    "components/app/WorkspacePresentation.tsx", "components/intelligence/BusinessHealthInstrument.tsx",
    "components/intelligence/ExecutiveHomepage.tsx", "components/intelligence/IntelligenceBriefingViewer.tsx",
    "components/operations/DecisionPageHeader.tsx", "components/operations/SectionCard.tsx"
  ];
  for (const file of approved) {
    assert.equal(withoutSquareQualificationPaths(file), "");
    const neighbor = file.replace(/[^/]+$/, "Unrelated.tsx");
    assert.equal(withoutSquareQualificationPaths(neighbor), neighbor);
  }
  for (const file of ["app/app/forms/actions.ts", "app/app/intelligence/briefings/unrelated-actions.ts", "app/api/unrelated/route.ts", "lib/workspaces/unrelated.ts", "lib/supabase/unrelated.ts", "supabase/migrations/unrelated.sql", "services/unrelated/runtime.ts"]) {
    assert.equal(withoutSquareQualificationPaths(file), file);
  }
});

test("presentation scope excludes Admin while retaining customer workspace navigation", () => {
  const presentation = read("components/app/WorkspacePresentation.tsx");
  assert.match(presentation, /!pathname\.startsWith\("\/app\/admin"\)/);
  assert.match(presentation, /if \(pathname\.startsWith\("\/app\/admin"\)\) return/);
  const shell = read("components/app/AppShell.tsx");
  assert.match(shell, /href: "\/app\/sources", label: "Files & Notes"/);
  for (const action of ["selectWorkspaceAction", "signOutAction"]) assert.match(shell, new RegExp(`action=\\{${action}\\}`));
  for (const route of ["/app", "/app/intelligence", "/app/kpis", "/app/sources", "/app/reports", "/app/settings"]) assert.ok(shell.includes(`href: "${route}"`));
  assert.match(shell, /isVaeroexAdmin \? \[\.\.\.baseNavSections, adminNavSection\] : baseNavSections/);
});

test("standalone Square panel uses the same theme scope without substituting its handlers", () => {
  const source = read("components/integrations/SquareDirectCustomerPanel.tsx");
  assert.match(source, /vaeroex-app-shell vaeroex-customer-workspace/);
  assert.match(source, /← Back to Settings/);
  assert.doesNotMatch(source, /WorkspacePresentation/);
});

test("visual theme remains scoped, semantic and responsive", () => {
  const css = read("app/globals.css");
  for (const token of ["#0b1220", "#111827", "#253041", "#38bdf8"]) assert.ok(css.includes(token));
  assert.match(css, /\.vaeroex-customer-workspace[^}]*font-family:/);
  assert.match(css, /\.vaeroex-customer-workspace[^}]*:focus-visible/);
  assert.match(css, /@media \(max-width: 639px\)/);
  assert.match(css, /\.workspace-nav-link\[aria-current="page"\]/);
  assert.match(css, /\.vaeroex-customer-workspace \.workspace-tabs > a,[\s\S]*?\.vaeroex-customer-workspace \.workspace-tabs > a > span \{ flex-shrink: 0; \}/);
});

test("Light list surfaces have readable foregrounds without recoloring primary actions or dark detail panels", () => {
  const css = read("app/globals.css");
  const correction = css.slice(css.indexOf("/* Light-mode content"), css.indexOf("@keyframes vaeroex-fade-up"));
  for (const hook of [".workspace-files-notes .workspace-panel h2", ".workspace-panel .workspace-list-row h3", ".workspace-panel .workspace-list-row h4", ".workspace-saved-analyses .workspace-analysis-row h3", ".workspace-note-entry > summary"]) assert.ok(correction.includes(hook));
  for (const rule of correction.replace(/\/\*[\s\S]*?\*\//g, "").split("}").filter(rule => rule.trim())) {
    assert.match(rule.trim(), /^html:not\(\.pulsar\) \.vaeroex-customer-workspace/);
  }
  assert.doesNotMatch(correction, /\.workspace-sidebar|\.workspace-topbar|\.workspace-source-detail|\.bg-vaeroex-blue|\.text-white\b/);
  assert.doesNotMatch(correction, /background:\s*#08111f/, "Do not introduce dark note surfaces beneath the existing Light Evidence foreground mapping");
  assert.match(css, /\[data-theme="light"\] \.evidence-workspace \.text-slate-300,[\s\S]*?color: #526176 !important;/);
  assert.match(correction, /\.workspace-reports \.workspace-page-header > p:first-child \{ color: #2563eb; \}/);
  assert.match(correction, /\.workspace-saved-analyses \.workspace-toolbar input,[\s\S]*?\.workspace-saved-analyses > label > select \{ background: #ffffff; color: #0b1f4d; border-color: #64748b; \}/);
  assert.match(correction, /\.workspace-saved-analyses \.workspace-toolbar input::placeholder \{ color: #475569; opacity: 1; \}/);
  function luminance(hex) {
    const [r, g, b] = hex.match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  for (const foreground of ["0b1f4d", "475569", "2563eb", "b91c1c"]) {
    assert.ok(1.05 / (luminance(foreground) + 0.05) >= 4.5, `${foreground} must retain readable text contrast on the white list surface`);
  }
});

// Optional exact-release comparison. Not a permanent freeze on future features.
// Run: WORKSPACE_REDESIGN_BASE=75c3d61196db8536e97e066310d7fb785a8c51c2 node --test ...
if (process.env.WORKSPACE_REDESIGN_BASE) {
  const baseline = process.env.WORKSPACE_REDESIGN_BASE;
  assert.match(baseline, /^[a-f0-9]{40}$/);
  const files = [
    "components/app/AppShell.tsx", "app/app/forms/page.tsx", "components/intelligence/ExecutiveHomepage.tsx",
    "components/intelligence/IntelligenceSignalInbox.tsx", "components/intelligence/IntelligenceBriefingCards.tsx",
    "app/app/intelligence/page.tsx", "app/app/sources/SourcesPage.tsx",
    "components/evidence/BusinessNotesPanel.tsx", "app/app/settings/page.tsx",
    "components/integrations/SquareDirectCustomerPanel.tsx", "components/reports/SavedAnalysisList.tsx"
  ];
  // The additive Performance GET filters and return URLs are covered by the
  // more specific frozen business/query/mutation checks in performance-metric-list-tests.js.
  const printer = ts.createPrinter({ removeComments: true });
  function contracts(source, file) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const forms = [], inputs = [], functions = new Map();
    const print = node => printer.printNode(ts.EmitHint.Unspecified, node, ast);
    function hasJsx(node) { let yes = false; function visit(n) { if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) yes = true; ts.forEachChild(n, visit); } visit(node); return yes; }
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(ast);
        const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
        if (tag === "form") forms.push(attrs.filter(a => ["action", "method"].includes(a.name.text)).map(print).sort().join(";"));
        if (["input", "select", "textarea"].includes(tag) && attrs.some(a => a.name.text === "name")) {
          inputs.push(attrs.filter(a => ["name", "type", "value", "defaultValue", "required", "readOnly", "disabled"].includes(a.name.text)).map(print).sort().join(";"));
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name && /^[a-z]/.test(node.name.text) && !hasJsx(node)) functions.set(node.name.text, print(node));
      ts.forEachChild(node, visit);
    }
    visit(ast); return { forms: forms.sort(), inputs: inputs.sort(), functions };
  }
  for (const file of files) test(`release preserves form targets, named controls and pure business helpers: ${file}`, () => {
    const previous = cp.execFileSync("git", ["show", `${baseline}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    const before = contracts(previous, file), after = contracts(read(file), file);
    assert.deepEqual(after.forms, before.forms, "form action/method changed");
    assert.deepEqual(after.inputs, before.inputs, "named submitted fields or protections changed");
    for (const [name, source] of before.functions) assert.equal(after.functions.get(name), source, `${name} business helper changed`);
  });
}
