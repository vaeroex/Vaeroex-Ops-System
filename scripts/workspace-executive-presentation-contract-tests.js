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
const integrationResultAdditions = [
  'import { CurrentIntegrations } from "@/components/integrations/CurrentIntegrations";\n',
  'import { loadIntegrationDashboard } from "@/lib/integrations/dashboard/server";\n',
  '  const { dashboard, currentQboAccounting } = await loadIntegrationDashboard({ access, qbo: qboAccounting, eligibleKpis });\n',
  '      ...(currentQboAccounting.kpis.length ? {\n'
    + '        kpis: currentQboAccounting.kpis,\n'
    + '        evidenceManifests: currentQboAccounting.evidenceManifests\n'
    + '      } : {}),\n',
  '      <CurrentIntegrations key={workspaceId} initial={dashboard} />\n',
];
const workspaceAccessReplacements = [
  ['import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";\n',
    'import { requireWorkspacePage } from "@/lib/workspaces/page-context";\n'],
  ['  const access = await requireWorkspaceAccess();\n  const { supabase, workspaceId, context } = access;\n',
    '  const { supabase, workspaceId, context } = await requireWorkspacePage();\n'],
];
const qboAccountingAdditions = [
  'import { loadQboAccountingIntelligence } from "@/lib/integrations/qbo-customer/accounting-intelligence-server";\n',
  '  const qboAccounting = await loadQboAccountingIntelligence(workspaceId, snapshotAsOf);\n',
];

// Stage 4 separately qualifies source-parent completeness as a functional fix.
// Normalize only these three reviewed bindings; the original action and logic
// digests above remain unchanged, including every existing query and state guard.
const sourceParentCompletenessReplacements = [
  [
    '  const sourceParentResult = await loadSourceParentEligibilityResult({\n'
      + '    supabase,\n'
      + '    workspaceId,\n'
      + '    rows: [\n'
      + '      ...(kpisResult.data || []),\n'
      + '      ...(crmResult.data || []),\n'
      + '      ...(metricsResult.data || []),\n'
      + '      ...(memoryResult.data || [])\n'
      + '    ]\n'
      + '  });\n',
    '  const sourceParentResult = await loadSourceParentEligibilityResult({\n'
      + '    supabase,\n'
      + '    workspaceId,\n'
      + '    rows: [\n'
      + '      ...(kpisResult.data || []),\n'
      + '      ...(crmResult.data || []),\n'
      + '      ...(metricsResult.data || [])\n'
      + '    ]\n'
      + '  });\n',
  ],
  [
    '  const operationalInsights = buildOperationalEvidenceInsights({\n'
      + '    sourceParents: sourceParentResult.eligibility.records,\n',
    '  const operationalInsights = buildOperationalEvidenceInsights({\n',
  ],
  [
    '  const intelligence = buildIntelligenceLayer({\n'
      + '    sourceParents: sourceParentResult.eligibility.records,\n',
    '  const intelligence = buildIntelligenceLayer({\n',
  ],
];

function withoutSourceParentCompleteness(source) {
  for (const [current, original] of sourceParentCompletenessReplacements) {
    assert.equal(source.split(current).length, 2, "Require exactly the reviewed source-parent completeness binding");
    source = source.replace(current, original);
  }
  assert.doesNotMatch(source, /\bsourceParents\b/,
    "No additional source-parent consumer may escape the exact functional exception");
  return source;
}

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

// Explicitly approved Health relocation, independently qualified by the loader,
// presentation and authenticated-browser tests. Normalize only its exact reviewed
// hunks before applying the original frozen workflow hashes; neither hash is reset.
const healthConsolidation = require("./fixtures/health-consolidation-presentation-exception.json");
function withoutHealthConsolidation(file, source) {
  const entry = healthConsolidation.files.find(item => item.file === file);
  assert(entry, "Require a reviewed Health consolidation path");
  for (const { before, after } of entry.changes) {
    assert.equal(source.split(after).length, 2, "Require exactly the reviewed Health relocation binding");
    source = source.replace(after, before);
  }
  return source;
}

function withoutIntegrationResults(source) {
  source = withoutHealthConsolidation(intelligenceFile, source);
  // Strip only the reviewed dashboard bindings and restore the exact former
  // access binding. The original 75c3d61 workflow hashes stay frozen.
  assert.doesNotMatch(source, /QboIntelligenceDiagnostic|qboProductionCustomerConnectionsEnabled|qbo-customer\/intelligence-diagnostic/,
    "Never restore the attempt-driven diagnostic on the business-results page");
  assert.doesNotMatch(source, /\b(?:SquareSheetsResults|QboAccountingIntelligenceView)\b/,
    "The dashboard replaces the former integration sections");
  const tree = ts.createSourceFile(intelligenceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expectedUses = { CurrentIntegrations: 2, loadIntegrationDashboard: 2, dashboard: 2,
    currentQboAccounting: 4, requireWorkspaceAccess: 2, access: 3 };
  const uses = Object.fromEntries(Object.keys(expectedUses).map(name => [name, 0]));
  const visit = (node) => {
    if (ts.isIdentifier(node) && Object.hasOwn(uses, node.text)) uses[node.text]++;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.deepEqual(uses, expectedUses, "Dashboard and access bindings have only their reviewed usages");
  for (const addition of integrationResultAdditions) {
    assert.equal(source.split(addition).length, 2, "Require exactly the approved dashboard addition");
    source = source.replace(addition, "");
  }
  for (const [current, original] of workspaceAccessReplacements) {
    assert.equal(source.split(current).length, 2, "Require exactly the approved workspace access replacement");
    source = source.replace(current, original);
  }
  assert.doesNotMatch(source, /\b(?:CurrentIntegrations|loadIntegrationDashboard|dashboard|currentQboAccounting|requireWorkspaceAccess|access)\b/,
    "No extra dashboard or access uses may escape the exact addition contract");
  return withoutSourceParentCompleteness(withoutQboAccounting(source));
}

for (const [file, count, actionsDigest, logicDigest] of contracts) {
  test(`${file} preserves the inventoried workflow beneath its presentation`, () => {
    let source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    if (file === "components/intelligence/ExecutiveHomepage.tsx") {
      source = withoutHealthConsolidation(file, source);
      // User-requested visual comparison adds only a typed presentation prop.
      // Remove those two exact declarations before checking the original logic
      // fingerprint; calculations, imports and every action remain frozen.
      for (const declaration of ['  healthVisual?: "scorecard" | "arc";\n', '  healthVisual = "scorecard",\n']) {
        assert.equal(source.split(declaration).length, 2);
        source = source.replace(declaration, "");
      }
    }
    if (file === intelligenceFile) source = withoutIntegrationResults(source);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const actions = actionInventory(tree);
    assert.equal(actions.length, count, "No existing action or protected form binding may be lost or added by this presentation change");
    assert.equal(digest(actions.join("\n")), actionsDigest, "Preserve action targets, input values, handlers, disabled states, authorization conditions and return URLs");
    assert.equal(digest(nonPresentationLogic(tree)), logicDigest, "Presentation must preserve imports, queries, calculations, state and handler implementations");
  });
}

test("current integration dashboard rejects changed imports, authorization, scope, props and restored sections", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", intelligenceFile), "utf8");
  const mutations = [
    ["@/components/integrations/CurrentIntegrations", "@/components/integrations/UnreviewedResults"],
    ["@/lib/integrations/dashboard/server", "@/lib/integrations/dashboard/unreviewed-server"],
    ["@/lib/security/require-workspace-access", "@/lib/security/unreviewed-access"],
    ["await requireWorkspaceAccess()", 'await requireWorkspaceAccess({ workspaceId: "other-workspace" })'],
    ["const { supabase, workspaceId, context } = access;", "const { supabase, workspaceId, context } = adminAccess;"],
    ["loadIntegrationDashboard({ access,", "loadIntegrationDashboard({ access: adminAccess,"],
    ["qbo: qboAccounting, eligibleKpis", "qbo: otherAccounting, eligibleKpis"],
    ["qbo: qboAccounting, eligibleKpis", "qbo: qboAccounting, eligibleKpis: kpisResult.data"],
    ["key={workspaceId}", 'key={"other-workspace"}'],
    ["initial={dashboard}", "initial={unscopedDashboard}"],
    ["<CurrentIntegrations key={workspaceId}", "<CurrentIntegrations extra={true} key={workspaceId}"],
    [integrationResultAdditions[4], integrationResultAdditions[4] + "      <QboIntelligenceDiagnostic workspaceId={workspaceId} />\n"],
    [integrationResultAdditions[4], integrationResultAdditions[4] + "      <SquareSheetsResults supabase={supabase} workspaceId={workspaceId} isOwner={true} />\n"],
    [integrationResultAdditions[4], integrationResultAdditions[4] + "      <QboAccountingIntelligenceView result={qboAccounting} />\n"],
  ];
  for (const [before, after] of mutations) {
    assert(source.includes(before));
    assert.throws(() => withoutIntegrationResults(source.replace(before, after)), assert.AssertionError);
  }
});

test("dashboard exceptions reject missing, duplicate and extra bindings", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", intelligenceFile), "utf8");
  for (const binding of [...integrationResultAdditions, ...qboAccountingAdditions, ...workspaceAccessReplacements.map(([current]) => current)]) {
    assert(source.includes(binding));
    for (const replacement of ["", binding + binding]) {
      assert.throws(() => withoutIntegrationResults(source.replace(binding, replacement)), assert.AssertionError);
    }
  }
  for (const name of ["CurrentIntegrations", "loadIntegrationDashboard", "dashboard", "currentQboAccounting", "requireWorkspaceAccess", "access", "qboAccounting", "loadQboAccountingIntelligence"]) {
    assert.throws(() => withoutIntegrationResults(source + `\nconst unreviewedBinding = ${name};\n`), assert.AssertionError);
  }
});

test("the integration exception still detects changes to existing Intelligence imports, queries and state", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", intelligenceFile), "utf8");
  const originalDigest = contracts.find(([file]) => file === intelligenceFile)[3];
  for (const [before, after] of [
    ['import Link from "next/link";', 'import Link from "other-link";'],
    ['.eq("workspace_id", workspaceId)', '.eq("workspace_id", "other-workspace")'],
    [".limit(2000)", ".limit(2001)"],
    ["const snapshotAsOf = new Date().toISOString();", 'const snapshotAsOf = "fixed-time";'],
  ]) {
    assert(source.includes(before));
    assert.throws(() => {
      const changed = withoutIntegrationResults(source.replace(before, after));
      const tree = ts.createSourceFile(intelligenceFile, changed, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      assert.equal(digest(nonPresentationLogic(tree)), originalDigest, "Original non-presentation logic remains protected");
    }, assert.AssertionError, "Reject the mutation either at the exact addition boundary or the frozen original logic hash");
  }
});

test("accounting exception rejects changed scope, timing and current evidence bindings", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", intelligenceFile), "utf8");
  for (const [before, after] of [
    ["qbo-customer/accounting-intelligence-server", "qbo-customer/unreviewed-server"],
    ["loadQboAccountingIntelligence(workspaceId, snapshotAsOf)", "loadQboAccountingIntelligence(otherWorkspace, snapshotAsOf)"],
    ["loadQboAccountingIntelligence(workspaceId, snapshotAsOf)", "loadQboAccountingIntelligence(workspaceId, anotherTime)"],
    ["currentQboAccounting.kpis.length ?", "qboAccounting.state === \"available\" ?"],
    ["currentQboAccounting.kpis.length ?", "!currentQboAccounting.kpis.length ?"],
    ["kpis: currentQboAccounting.kpis", "kpis: qboAccounting.data.kpis"],
    ["evidenceManifests: currentQboAccounting.evidenceManifests", "evidenceManifests: qboAccounting.data.evidenceManifests"],
    [qboAccountingAdditions[1], qboAccountingAdditions[1] + "  publish(qboAccounting);\n"],
  ]) {
    assert(source.includes(before));
    assert.throws(() => withoutIntegrationResults(source.replace(before, after)), assert.AssertionError);
  }
});


test("source-parent completeness exception rejects altered scope, rows and consumer evidence", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", intelligenceFile), "utf8");
  for (const [before, after] of [
    ['loadSourceParentEligibilityResult({\n    supabase,\n    workspaceId,', 'loadSourceParentEligibilityResult({\n    supabase,\n    workspaceId: "other-workspace",'],
    ['loadSourceParentEligibilityResult({\n    supabase,', 'loadSourceParentEligibilityResult({\n    supabase: adminClient,'],
    ['...(memoryResult.data || [])', '...(unscopedMemory.data || [])'],
    ['...(metricsResult.data || []),\n      ...(memoryResult.data || [])', '...(metricsResult.data || []),\n      ...(memoryResult.data || []),\n      ...unreviewedRows'],
    ['sourceParents: sourceParentResult.eligibility.records', 'sourceParents: otherWorkspaceParents'],
    ['sourceParents: sourceParentResult.eligibility.records', 'sourceParents: []'],
    ['sourceParents: sourceParentResult.eligibility.records', 'sourceParents: sourceParentResult.eligibility'],
    ['const operationalInsights = buildOperationalEvidenceInsights({', 'const operationalInsights = buildUnreviewedEvidenceInsights({'],
    ['const intelligence = buildIntelligenceLayer({', 'const intelligence = buildUnreviewedIntelligenceLayer({'],
  ]) {
    assert(source.includes(before));
    assert.throws(() => withoutIntegrationResults(source.replace(before, after)), assert.AssertionError);
  }
  const originalDigest = contracts.find(([file]) => file === intelligenceFile)[3];
  for (const [before, after] of [
    ['kpis: eligibleKpis,', 'kpis: kpisResult.data || [],'],
    ['operationalMetrics: eligibleOperationalMetrics,', 'operationalMetrics: metricsResult.data || [],'],
    ['memoryChunks: eligibleMemoryChunks,', 'memoryChunks: memoryResult.data || [],'],
    ['crmLeads: eligibleCustomerEvidence,', 'crmLeads: crmResult.data || [],'],
  ]) {
    assert(source.includes(before));
    const changed = withoutIntegrationResults(source.replace(before, after));
    const tree = ts.createSourceFile(intelligenceFile, changed, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.notEqual(digest(nonPresentationLogic(tree)), originalDigest, "Source-parent exception must not permit existing eligibility bypasses");
  }
});

test("source-parent completeness exception rejects missing, duplicate and extra bindings", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", intelligenceFile), "utf8");
  for (const [current, original] of sourceParentCompletenessReplacements) {
    assert(source.includes(current));
    for (const replacement of [original, current + current]) {
      assert.throws(() => withoutIntegrationResults(source.replace(current, replacement)), assert.AssertionError);
    }
  }
  for (const addition of [
    '\nconst unreviewedParents = sourceParents;\n',
    '\nconst extraConsumer = buildIntelligenceLayer({ sourceParents: sourceParentResult.eligibility.records });\n',
  ]) {
    assert.throws(() => withoutIntegrationResults(source + addition), assert.AssertionError);
  }
});


test("Health relocation exception rejects missing, duplicate and altered reviewed hunks", () => {
  for (const { file, changes } of healthConsolidation.files) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    for (const { after } of changes) {
      for (const replacement of ["", after + after, after.replace(/\S/, "!")]) {
        assert.throws(() => withoutHealthConsolidation(file, source.replace(after, replacement)), assert.AssertionError);
      }
    }
  }
});
