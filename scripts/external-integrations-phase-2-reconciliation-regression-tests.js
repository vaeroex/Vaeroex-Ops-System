const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const reconciliation = require("../lib/integrations/reconciliation/index.ts");
const persistence = require("../lib/integrations/persistence/reconciliation-commands.ts");

let assertionCount = 0;
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function throws(callback, matcher, message) {
  assertionCount += 1;
  assert.throws(callback, matcher, message);
}
function id(value) {
  return `${value.toString(16).padStart(8, "0")}-0000-4000-8000-${value
    .toString(16)
    .padStart(12, "0")}`;
}
function hash(character) {
  return `sha256:${character.repeat(64)}`;
}

const ids = {
  workspace: id(1),
  entity: id(2),
  actor: id(3),
  policy: id(4),
  additiveFamily: id(5),
  controlFamily: id(6)
};
const at = "2026-08-20T20:00:00.000Z";

function policy(overrides = {}) {
  return {
    contractVersion: reconciliation.RECONCILIATION_CONTRACT_VERSIONS.sourceAuthorityPolicy,
    id: ids.policy,
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    policyVersion: "posted_revenue_authority_v1",
    domain: "posted_revenue",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    conflictBehavior: "hold_all",
    rules: [
      {
        ruleId: "connected_ledger",
        ruleVersion: "authority_rule_v1",
        domain: "posted_revenue",
        sourceClass: "connected_system",
        sourceAuthorityKey: "connected_ledger",
        authorityRole: "authoritative",
        priority: 1
      },
      {
        ruleId: "uploaded_actuals",
        ruleVersion: "authority_rule_v1",
        domain: "posted_revenue",
        sourceClass: "upload",
        sourceAuthorityKey: "upload",
        authorityRole: "supplemental",
        priority: 2
      },
      {
        ruleId: "manual_actuals",
        ruleVersion: "authority_rule_v1",
        domain: "posted_revenue",
        sourceClass: "manual",
        sourceAuthorityKey: "manual",
        authorityRole: "supplemental",
        priority: 3
      },
      {
        ruleId: "connected_report_control",
        ruleVersion: "authority_rule_v1",
        domain: "posted_revenue",
        sourceClass: "connected_system",
        sourceAuthorityKey: "connected_report",
        authorityRole: "control_only",
        priority: 4
      }
    ],
    decision: {
      authority: "customer_authorized_user",
      actorId: ids.actor,
      decidedAt: at,
      reasonCodes: ["customer_domain_authority"]
    },
    ...overrides
  };
}

function identity(overrides = {}) {
  return {
    domain: "posted_revenue",
    contributionFamilyKey: "recognized_revenue_transactions",
    contributionFamilyKind: "additive_transaction",
    measureKey: "recognized_revenue",
    aggregateKey: "recognized_revenue_actual",
    transactionIdentity: "transaction_001",
    effectiveTime: {
      effectiveAt: at,
      postingDate: "2026-08-20",
      periodStart: null,
      periodEnd: null
    },
    dimensions: [{ key: "department", value: "Operations" }],
    accountingBasis: "accrual",
    currency: "USD",
    ...overrides
  };
}

function representation(number, overrides = {}) {
  const sourceClass = overrides.sourceClass ?? "upload";
  const sourceAuthorityKey =
    overrides.sourceAuthorityKey ?? (sourceClass === "connected_system" ? "connected_ledger" : sourceClass);
  return {
    representationId: id(100 + number),
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    canonicalFactVersionId: id(200 + number),
    canonicalFactFingerprint: hash(number.toString(16).slice(-1)),
    factKind: "recognized_revenue",
    factKey: `recognized_revenue:${number}`,
    sourceRecordVersionId: id(300 + number),
    sourceVersionFingerprint: hash(((number + 1) % 16).toString(16)),
    sourceIdentityFingerprint: hash(((number + 2) % 16).toString(16)),
    sourceImmutableVersion: 1,
    sourceClass,
    sourceAuthorityKey,
    economicIdentity: identity(),
    value: "100000",
    validationState: "valid",
    reconciliationState: "accepted",
    lineage: { kind: "none" },
    similarityHints: [],
    ...overrides
  };
}

function family(number, kind, overrides = {}) {
  const control = kind === "non_additive_control";
  return {
    contractVersion: reconciliation.RECONCILIATION_CONTRACT_VERSIONS.contributionFamily,
    id: number === 1 ? ids.additiveFamily : ids.controlFamily,
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    registryVersion: "financial_contribution_registry_v1",
    familyVersion: control ? "revenue_report_control_v1" : "revenue_transactions_v1",
    domain: "posted_revenue",
    familyKey: control ? "recognized_revenue_report_control" : "recognized_revenue_transactions",
    familyKind: kind,
    measureKey: "recognized_revenue",
    aggregateKey: "recognized_revenue_actual",
    allowedAccountingBases: ["accrual"],
    currencyMode: "required",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    ...overrides
  };
}

function classify(number, representations, policyValue = policy()) {
  return reconciliation.classifyReconciliationCase({
    id: id(400 + number),
    policy: policyValue,
    representations,
    classifiedAt: at
  });
}

function plan(number, reconciliationCase, families = [family(1, "additive_transaction")], priorEvents = []) {
  return reconciliation.planFactContributionBatch({
    id: id(500 + number),
    reconciliationCase,
    registryVersion: "financial_contribution_registry_v1",
    families,
    priorEvents,
    plannedAt: at
  });
}

const upload = representation(1);
const connectedDuplicate = representation(2, {
  sourceClass: "connected_system",
  sourceAuthorityKey: "connected_ledger"
});
const duplicateCase = classify(1, [upload, connectedDuplicate]);
equal(duplicateCase.classification, "same_fact_represented_twice", "upload plus connected-shaped duplicate is classified deterministically");
equal(duplicateCase.decision.selectedRepresentationIds[0], connectedDuplicate.representationId, "domain authority selects the connected-shaped representation");
const duplicateBatch = plan(1, duplicateCase);
equal(duplicateBatch.events.length, 1, "one economic fact establishes one numerical contribution");
equal(reconciliation.aggregateActiveContributions(duplicateBatch.events), "100000", "$100k duplicate representations aggregate to $100k");
equal(duplicateBatch.events[0].sourceRecordVersionIds.length, 2, "both immutable source provenance paths remain attached");

const independentA = representation(3, { economicIdentity: identity({ transactionIdentity: "transaction_a" }) });
const independentB = representation(4, {
  sourceClass: "connected_system",
  sourceAuthorityKey: "connected_ledger",
  economicIdentity: identity({ transactionIdentity: "transaction_b" })
});
const independentCase = classify(2, [independentA, independentB]);
equal(independentCase.classification, "independent_facts", "distinct exact transaction identities remain independent");
const independentBatch = plan(2, independentCase);
equal(independentBatch.events.length, 2, "two independent facts establish two contributions");
equal(reconciliation.aggregateActiveContributions(independentBatch.events), "200000", "two independent $100k facts aggregate to $200k");

const duplicateEvidence = classify(3, [
  representation(5),
  representation(6, { canonicalFactVersionId: id(205), canonicalFactFingerprint: hash("5") })
]);
equal(duplicateEvidence.classification, "duplicate_evidence", "two sources for one immutable fact are duplicate evidence");

const excludedPolicy = policy({
  rules: policy().rules.map((rule) =>
    rule.ruleId === "uploaded_actuals" ? { ...rule, authorityRole: "excluded" } : rule
  )
});
equal(classify(4, [upload, connectedDuplicate], excludedPolicy).classification, "authority_excluded_representation", "domain policy can exclude a representation without erasing it");

const conflicting = classify(5, [upload, { ...connectedDuplicate, value: "100001" }]);
equal(conflicting.classification, "conflicting_sources", "same identity with different exact values conflicts");
equal(conflicting.decision.selectedRepresentationIds.length, 0, "hold-all conflicts contribute nothing");
equal(plan(5, conflicting).events.length, 0, "held conflicts emit no contribution events");

const authoritativeConflictPolicy = policy({ conflictBehavior: "allow_authoritative_and_flag" });
const authoritativeConflict = classify(6, [upload, { ...connectedDuplicate, value: "100001" }], authoritativeConflictPolicy);
equal(authoritativeConflict.decision.selectedRepresentationIds.length, 1, "explicit authoritative-and-flag policy selects exactly one conflict representation");

const ambiguous = classify(7, [
  upload,
  representation(7, { economicIdentity: identity({ dimensions: [{ key: "department", value: "Sales" }] }) })
]);
equal(ambiguous.classification, "ambiguous_review", "non-exact matches fail closed to review");
equal(ambiguous.decision.selectedRepresentationIds.length, 0, "review cases cannot establish numerical truth");

const fuzzy = classify(8, [upload, {
  ...connectedDuplicate,
  similarityHints: [{ kind: "amount_similarity", score: "1", hintVersion: "similarity_hint_v1" }]
}]);
equal(fuzzy.classification, "ambiguous_review", "fuzzy hints remain review-only even beside an exact candidate");

for (const [label, economicIdentity] of [
  ["accounting basis", identity({ accountingBasis: "cash" })],
  ["currency", identity({ currency: "EUR" })],
  ["period", identity({ effectiveTime: { effectiveAt: null, postingDate: null, periodStart: "2026-08-01", periodEnd: "2026-08-31" } })],
  ["dimension", identity({ dimensions: [{ key: "department", value: "Sales" }] })]
]) {
  equal(classify(20 + assertionCount, [upload, representation(20 + assertionCount, { economicIdentity })]).classification, "ambiguous_review", `${label} mismatch cannot establish identity`);
}

throws(() => classify(30, [upload, { ...connectedDuplicate, workspaceId: id(999) }]), /source_authority_scope_mismatch/, "cross-workspace matching is denied");
throws(() => classify(31, [upload, { ...connectedDuplicate, businessEntityId: id(998) }]), /source_authority_scope_mismatch/, "cross-entity matching is denied");

for (const [state, representationState] of [
  ["invalid", { validationState: "invalid" }],
  ["conflicted", { reconciliationState: "conflicted" }],
  ["tombstone", { reconciliationState: "tombstone" }]
]) {
  equal(classify(40 + assertionCount, [upload, representation(40 + assertionCount, representationState)]).classification, "ambiguous_review", `${state} facts cannot contribute`);
}

const prior = representation(50, { value: "90000" });
const priorDuplicate = representation(51, {
  value: "90000",
  sourceClass: "connected_system",
  sourceAuthorityKey: "connected_ledger"
});
const priorBatch = plan(50, classify(50, [prior, priorDuplicate]));
const corrected = representation(52, {
  value: "100000",
  economicIdentity: prior.economicIdentity,
  lineage: {
    kind: "correction",
    priorSourceRecordVersionId: priorDuplicate.sourceRecordVersionId,
    priorCanonicalFactVersionId: priorDuplicate.canonicalFactVersionId
  },
  sourceClass: "connected_system",
  sourceAuthorityKey: "connected_ledger"
});
const correctionCase = classify(51, [priorDuplicate, corrected]);
equal(correctionCase.classification, "source_correction", "explicit immutable lineage classifies a source correction");
const correctionBatch = plan(51, correctionCase, [family(1, "additive_transaction")], priorBatch.events);
equal(correctionBatch.events[0].eventKind, "retract", "correction retracts the prior immutable contribution first");
equal(correctionBatch.events[1].eventKind, "establish", "correction establishes the new immutable contribution second");
equal(reconciliation.aggregateActiveContributions([...priorBatch.events, ...correctionBatch.events]), "100000", "correction history resolves to the corrected exact amount");

const override = representation(53, {
  lineage: {
    kind: "manual_override",
    overriddenCanonicalFactVersionId: upload.canonicalFactVersionId,
    actorId: ids.actor
  },
  sourceClass: "manual",
  sourceAuthorityKey: "manual"
});
equal(classify(52, [upload, override]).classification, "manual_override", "explicit actor-bound lineage classifies a manual override");

const controlRepresentation = representation(60, {
  sourceClass: "connected_system",
  sourceAuthorityKey: "connected_report",
  economicIdentity: identity({
    contributionFamilyKey: "recognized_revenue_report_control",
    contributionFamilyKind: "non_additive_control",
    transactionIdentity: null
  })
});
const controlCase = classify(60, [connectedDuplicate, controlRepresentation]);
equal(controlCase.classification, "control_observation_vs_additive_detail", "report totals are classified as controls beside transaction detail");
const controlBatch = plan(60, controlCase, [family(1, "additive_transaction"), family(2, "non_additive_control")]);
equal(controlBatch.events.filter((event) => event.eventKind === "establish").length, 1, "only transaction detail is additive");
equal(controlBatch.events.filter((event) => event.eventKind === "control_observation").length, 1, "report total remains a non-additive observation");
equal(reconciliation.contributionBatchNetValue(controlBatch), "100000", "control observations do not double the aggregate");

const rerankedPolicy = policy({
  policyVersion: "posted_revenue_authority_v2",
  rules: policy().rules.map((rule) =>
    rule.ruleId === "uploaded_actuals"
      ? { ...rule, authorityRole: "authoritative", priority: 1 }
      : rule.ruleId === "connected_ledger"
        ? { ...rule, authorityRole: "supplemental", priority: 2 }
        : rule
  )
});
equal(classify(61, [upload, connectedDuplicate], rerankedPolicy).decision.selectedRepresentationIds[0], upload.representationId, "a later policy can deterministically re-rank sources");
equal(duplicateCase.policyVersion, "posted_revenue_authority_v1", "the original case retains its original policy lineage");

throws(
  () => classify(70, [upload, representation(70, { value: "1234567890123456789012" })]),
  /./,
  "out-of-bounds decimals are rejected before planning or hashing"
);

const shadow = reconciliation.projectLegacyKpiShadowCandidate({
  id: id(700),
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  legacyKpiId: id(701),
  kpiKey: "recognized_revenue",
  exactValue: "100000",
  economicIdentity: identity(),
  provenance: {
    sourceKind: "upload",
    sourceFileId: id(702),
    sourceFileFingerprint: hash("a"),
    importId: id(703),
    importRowId: id(704),
    rowNumber: 10
  },
  projectedAt: at
});
ok(shadow.shadowOnly && !shadow.promotionAuthorized, "legacy upload projection is irrevocably shadow-only in Phase 2");
equal(shadow.exactValue, "100000", "shadow projection preserves the canonical decimal string");
ok(Boolean(shadow.candidateFingerprint), "shadow projection has deterministic provenance fingerprinting");

throws(() => persistence.SourceAuthorityPolicyCommitSchema.parse({}), /./, "database authority commands reject incomplete policy payloads");
throws(() => persistence.FactContributionBatchCommitSchema.parse({}), /./, "database contribution commands reject incomplete event payloads");

const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260821064333_external_integrations_phase_2_reconciliation.sql"),
  "utf8"
);
const reconciliationSource = fs
  .readdirSync(path.join(root, "lib/integrations/reconciliation"))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => fs.readFileSync(path.join(root, "lib/integrations/reconciliation", name), "utf8"))
  .join("\n");
equal((migration.match(/create table private\./g) ?? []).length, 7, "Phase 2 creates only the seven approved private tables");
equal((migration.match(/force row level security/g) ?? []).length, 1, "one table loop forces RLS across the exact Phase 2 table registry");
ok(/revoke all on table private\.%I from public, anon, authenticated, service_role, external_integrations_authority/.test(migration), "all direct Phase 2 table authority is revoked");
ok(!/grant execute[\s\S]{0,160}service_role/.test(migration), "service_role receives no Phase 2 RPC shortcut");
ok(/pg_advisory_xact_lock[\s\S]{0,500}v_economic_identity/.test(migration), "active contribution serialization is keyed by economic identity");
ok(/fuzzy_fail_closed_check/.test(migration), "the database persists fuzzy proposals only as held review cases");
ok(!/business_state_delta|dirty_node|dependency_graph|aggregate_state_cache/i.test(migration), "Phase 3 persistence is absent");
ok(!/client_secret|refresh_token|google_cloud|cloud_tasks|cloud_run|secret_manager|webhook_delivery/i.test(`${migration}\n${reconciliationSource}`), "provider control-plane and cloud infrastructure remain absent");
ok(!/openai|anthropic|language model|\bllm\b/i.test(reconciliationSource), "no model receives reconciliation authority");
ok(/shadowOnly: z\.literal\(true\)[\s\S]*promotionAuthorized: z\.literal\(false\)/.test(reconciliationSource), "legacy projections are structurally shadow-only");

process.stdout.write(`External integrations Phase 2 reconciliation regression tests passed (${assertionCount} assertions).\n`);
