const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

// Frozen from main 75c3d61 before the customer presentation redesign. These
// contracts deliberately ignore layout, styling, text and DOM order, while
// retaining action targets, form inputs, gating conditions and non-JSX logic.
// This suite never loads a page, calls an action, or accesses workspace data.
const contracts = [
  ["components/intelligence/ExecutiveHomepage.tsx", 4, "05eb10ae904d32cbee647c36f39e07966fd847b0cc5ccd254010d94015eac263", "0c4d7a3c8aac314730473b32958b237dc9e7627f72a18ba669fbbb8efcb4d96b"],
  ["components/intelligence/IntelligenceSignalInbox.tsx", 31, "014e053ef9e632b29178b1d9f8b19499dc42f562b59394e35014053298fcd8c2", "00d73a5fa2cfdc793a87b2efb9d670fb7418a6d2d77a4de4de5eb7ff02f83153"],
  ["components/intelligence/IntelligenceBriefingCards.tsx", 3, "e169f19cd954d4cc4eeb92ecd55f2e192716eae7c19d0df56ce2e27d75243a51", "f5d450e5527cccc6c222a2c5855afa4fe86f4dcbf6e4948b9fd58012782534ec"],
  ["components/intelligence/IntelligenceBriefingViewer.tsx", 4, "fef1131de86d2a6686e912e95ede0b141f94ef758bd181a9022db813eed35433", "2aa8aea4c41e2607f0db118de38dd7db7bcf3cab298dc2cd878977abccb0e054"],
  ["app/app/intelligence/page.tsx", 1, "edadc1a1eeb3483f87ec570494cf2cbb56eb38889686b23ca325dbb86cb96002", "95aef36f602bd02dd8110bbecdca003be4ffed41958ac03406afa6cdc6563f98"],
  ["app/app/intelligence/briefings/page.tsx", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "43f12ff66aaa0adb352107144abc5173dd62f63e32d2a8983e85dfefb539af9c"],
];
// Performance now adds read-only search/category controls and list return URLs.
// performance-metric-list-tests.js preserves its original 63 helpers, 57 data
// statements and seven mutation forms against this same main baseline instead
// of accepting a replacement whole-file logic/action fingerprint.
const protectedAttributes = new Set([
  "action", "href", "method", "type", "name", "value", "defaultValue",
  "defaultChecked", "checked", "required", "disabled", "min", "max",
  "maxLength", "step", "multiple", "form", "returnPath", "return_path",
  "requestToken", "analysisType", "fingerprint", "generatedAt", "tabs",
]);
const printer = ts.createPrinter({ removeComments: true });
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function actionInventory(tree) {
  const entries = [];
  const format = (node) => printer.printNode(ts.EmitHint.Unspecified, node, tree).trim();
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const props = node.attributes.properties
        .filter((prop) => ts.isJsxAttribute(prop)
          && (protectedAttributes.has(prop.name.getText(tree)) || /^on[A-Z]/.test(prop.name.getText(tree))))
        .map(format)
        .sort();
      if (props.length) {
        const conditions = [];
        for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
          if (ts.isConditionalExpression(ancestor)) conditions.push(format(ancestor.condition));
        }
        entries.push(JSON.stringify({ tag: node.tagName.getText(tree), props, conditions }));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return entries.sort();
}

function nonPresentationLogic(tree) {
  const transformed = ts.transform(tree, [(context) => {
    const visit = (node) => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
      ? ts.factory.createIdentifier("PRESENTATION")
      : ts.visitEachChild(node, visit, context);
    return (root) => ts.visitNode(root, visit);
  }]);
  try {
    return printer.printFile(transformed.transformed[0]);
  } finally {
    transformed.dispose();
  }
}

const intelligenceFile = "app/app/intelligence/page.tsx";
const qboDiagnosticAdditions = [
  'import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";\n',
  'import { QboIntelligenceDiagnostic } from "@/lib/integrations/qbo-customer/intelligence-diagnostic";\n',
  '      {qboProductionCustomerConnectionsEnabled() && context.membership?.role === "owner"\n'
    + '        ? <QboIntelligenceDiagnostic workspaceId={workspaceId} /> : null}\n',
];
const qboAccountingAdditions = [
  'import { loadQboAccountingIntelligence } from "@/lib/integrations/qbo-customer/accounting-intelligence-server";\n',
  'import { QboAccountingIntelligenceView } from "@/lib/integrations/qbo-customer/accounting-intelligence-view";\n',
  '  const qboAccounting = await loadQboAccountingIntelligence(workspaceId, snapshotAsOf);\n',
  '      ...(qboAccounting.state === "available" && qboAccounting.data.kpis.length ? {\n'
    + '        kpis: qboAccounting.data.kpis,\n'
    + '        evidenceManifests: qboAccounting.data.evidenceManifests\n'
    + '      } : {}),\n',
  '      <QboAccountingIntelligenceView result={qboAccounting} />\n',
];

function withoutQboAccounting(source) {
  // The separately qualified owner-authorized producer is an additive product
  // change, not a presentation refactor. Preserve all preexisting workflow hashes.
  for (const addition of qboAccountingAdditions) {
    assert.equal(source.split(addition).length, 2, "Require exactly the approved accounting producer binding");
    source = source.replace(addition, "");
  }
  assert.doesNotMatch(source, /\b(?:qboAccounting|loadQboAccountingIntelligence|QboAccountingIntelligenceView)\b/,
    "No extra accounting producer uses may escape the exact addition contract");
  return source;
}

function withoutQboDiagnostic(source) {
  // 2b7650dd adds only these four lines to its parent Intelligence page.
  // Require the exact gate, owner check and workspace prop before excluding
  // this isolated diagnostic; retain the original 75c3d61 logic/action hashes.
  const tree = ts.createSourceFile(intelligenceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const uses = { qboProductionCustomerConnectionsEnabled: 0, QboIntelligenceDiagnostic: 0 };
  const visit = (node) => {
    if (ts.isIdentifier(node) && Object.hasOwn(uses, node.text)) uses[node.text]++;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.deepEqual(Object.values(uses), [2, 2], "Each QBO binding is used only by its import and the single gated diagnostic");
  for (const addition of qboDiagnosticAdditions) {
    assert.equal(source.split(addition).length, 2, "Require exactly the approved QBO import/component addition");
    source = source.replace(addition, "");
  }
  return withoutQboAccounting(source);
}

for (const [file, count, actionsDigest, logicDigest] of contracts) {
  test(`${file} preserves the inventoried workflow beneath its presentation`, () => {
    let source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    if (file === "components/intelligence/ExecutiveHomepage.tsx") {
      // User-requested visual comparison adds only a typed presentation prop.
      // Remove those two exact declarations before checking the original logic
      // fingerprint; calculations, imports and every action remain frozen.
      for (const declaration of ['  healthVisual?: "scorecard" | "arc";\n', '  healthVisual = "scorecard",\n']) {
        assert.equal(source.split(declaration).length, 2);
        source = source.replace(declaration, "");
      }
    }
    if (file === intelligenceFile) source = withoutQboDiagnostic(source);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const actions = actionInventory(tree);
    assert.equal(actions.length, count, "No existing action or protected form binding may be lost or added by this presentation change");
    assert.equal(digest(actions.join("\n")), actionsDigest, "Preserve action targets, input values, handlers, disabled states, authorization conditions and return URLs");
    assert.equal(digest(nonPresentationLogic(tree)), logicDigest, "Presentation must preserve imports, queries, calculations, state and handler implementations");
  });
}

test("the additive QBO diagnostic exception rejects changed imports, authorization, scope and extra usages", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", intelligenceFile), "utf8");
  const mutations = [
    ["qbo-customer/intelligence-diagnostic", "qbo-customer/other-diagnostic"],
    ["qboProductionCustomerConnectionsEnabled() && ", ""],
    ['context.membership?.role === "owner"', 'context.membership?.role === "admin"'],
    ["workspaceId={workspaceId}", 'workspaceId={"other-workspace"}'],
    ["<QboIntelligenceDiagnostic workspaceId={workspaceId} />", "<QboIntelligenceDiagnostic workspaceId={workspaceId} extra={true} />"],
    [qboDiagnosticAdditions[2], qboDiagnosticAdditions[2] + "      <QboIntelligenceDiagnostic workspaceId={workspaceId} />\n"],
    [qboDiagnosticAdditions[0], qboDiagnosticAdditions[0] + "const extraQboRead = qboProductionCustomerConnectionsEnabled();\n"],
  ];
  for (const [before, after] of mutations) {
    assert(source.includes(before));
    assert.throws(() => withoutQboDiagnostic(source.replace(before, after)), assert.AssertionError);
  }
});

test("the QBO exception still detects changes to existing Intelligence imports, queries and state", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", intelligenceFile), "utf8");
  const originalDigest = contracts.find(([file]) => file === intelligenceFile)[3];
  for (const [before, after] of [
    ['import Link from "next/link";', 'import Link from "other-link";'],
    ['.eq("workspace_id", workspaceId)', '.eq("workspace_id", "other-workspace")'],
    [".limit(2000)", ".limit(2001)"],
    ["const snapshotAsOf = new Date().toISOString();", 'const snapshotAsOf = "fixed-time";'],
  ]) {
    assert(source.includes(before));
    const changed = withoutQboDiagnostic(source.replace(before, after));
    const tree = ts.createSourceFile(intelligenceFile, changed, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.notEqual(digest(nonPresentationLogic(tree)), originalDigest, "Original non-presentation logic remains protected");
  }
});

test("accounting exception rejects changed scope, timing, data and extra producer usages", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", intelligenceFile), "utf8");
  for (const [before, after] of [
    ["qbo-customer/accounting-intelligence-server", "qbo-customer/unreviewed-server"],
    ["loadQboAccountingIntelligence(workspaceId, snapshotAsOf)", "loadQboAccountingIntelligence(otherWorkspace, snapshotAsOf)"],
    ["loadQboAccountingIntelligence(workspaceId, snapshotAsOf)", "loadQboAccountingIntelligence(workspaceId, anotherTime)"],
    ['qboAccounting.state === "available"', 'qboAccounting.state !== "hidden"'],
    ["kpis: qboAccounting.data.kpis", "kpis: qboAccounting.data.rawSources"],
    ["evidenceManifests: qboAccounting.data.evidenceManifests", "evidenceManifests: qboAccounting.data.summaries"],
    ["result={qboAccounting}", "result={unscopedAccounting}"],
    [qboAccountingAdditions[2], qboAccountingAdditions[2] + "  publish(qboAccounting);\n"],
  ]) {
    assert(source.includes(before));
    assert.throws(() => withoutQboDiagnostic(source.replace(before, after)), assert.AssertionError);
  }
});
