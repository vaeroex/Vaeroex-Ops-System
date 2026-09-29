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
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const actions = actionInventory(tree);
    assert.equal(actions.length, count, "No existing action or protected form binding may be lost or added by this presentation change");
    assert.equal(digest(actions.join("\n")), actionsDigest, "Preserve action targets, input values, handlers, disabled states, authorization conditions and return URLs");
    assert.equal(digest(nonPresentationLogic(tree)), logicDigest, "Presentation must preserve imports, queries, calculations, state and handler implementations");
  });
}
