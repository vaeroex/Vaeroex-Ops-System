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

const contract = require("../lib/intelligence/snapshot/v1/index.ts");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function build(input = contract.foundationSnapshotBuildInput()) {
  return contract.buildIntelligenceSnapshotV1(input);
}

function metric(snapshot, id) {
  const value = snapshot.kpis.find((item) => item.id === id);
  assert.ok(value, `Missing KPI ${id}`);
  return value;
}

const baseInput = contract.foundationSnapshotBuildInput();
const first = build(baseInput);
const snapshot = first.snapshot;

assert.equal(snapshot.contract.id, "intelligence_snapshot_v1");
assert.equal(snapshot.contract.version, "1.0.0");
assert.equal(snapshot.versions.calculations.businessHealth, "business_health_calculation_v2");
assert.equal(snapshot.versions.calculations.dataQuality, "data_quality_calculation_v2");
assert.equal(snapshot.scope.workspaceId, contract.FOUNDATION_FIXTURE_WORKSPACE_ID);
assert.equal(snapshot.scope.asOf, contract.FOUNDATION_FIXTURE_AS_OF);
assert.equal(snapshot.scope.evaluationDate, contract.FOUNDATION_FIXTURE_EVALUATION_DATE);
assert.equal("generatedAt" in snapshot, false, "generatedAt must stay outside the semantic snapshot");
assert.equal("discrepancies" in snapshot, false, "shadow diagnostics must stay outside the semantic snapshot");
assert.equal(first.receipt.generatedAt, contract.FOUNDATION_FIXTURE_GENERATED_AT);
assert.equal(first.receipt.snapshotFingerprint, snapshot.fingerprints.snapshot);
assert.equal(first.receipt.validation.status, "passed");
assert.ok(first.receipt.validation.invariantCount > 20);
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(snapshot));
assert.ok(Object.isFrozen(snapshot.kpis));
assert.ok(Object.isFrozen(snapshot.kpis[0].observations.selectedRange.boundedObservations));
assert.doesNotThrow(() => contract.parseIntelligenceSnapshotV1(snapshot));
assert.doesNotThrow(() => contract.parseIntelligenceSnapshotBuildReceiptV1(first.receipt));

const second = build(contract.foundationSnapshotBuildInput());
assert.equal(second.snapshot.fingerprints.input, snapshot.fingerprints.input, "identical inputs must produce identical input fingerprints");
assert.equal(second.snapshot.fingerprints.snapshot, snapshot.fingerprints.snapshot, "identical inputs must produce identical snapshot fingerprints");
assert.deepEqual(second.snapshot, snapshot, "semantic construction must be deterministic");

const laterReceiptInput = clone(baseInput);
laterReceiptInput.generatedAt = "2026-07-28T13:00:00.000Z";
const laterReceipt = build(laterReceiptInput);
assert.equal(laterReceipt.snapshot.fingerprints.input, snapshot.fingerprints.input, "generatedAt must not change the input fingerprint");
assert.equal(laterReceipt.snapshot.fingerprints.snapshot, snapshot.fingerprints.snapshot, "generatedAt must not change the snapshot fingerprint");
assert.notEqual(laterReceipt.receipt.id, first.receipt.id, "separate build receipts retain their own generatedAt identity");

const presentationInput = clone(baseInput);
presentationInput.kpis.output[0].semantics.displayName = "Revenue display label";
presentationInput.kpis.output[0].semantics.originalSourceLabel = "Revenue source label";
presentationInput.intelligenceLayer.output.insights[0].title = "Presentation-only finding title";
presentationInput.intelligenceLayer.output.insights[0].summary = "Presentation-only summary";
const presentation = build(presentationInput);
assert.equal(presentation.snapshot.fingerprints.input, snapshot.fingerprints.input, "UI labels and render wording must not change the input fingerprint");
assert.equal(presentation.snapshot.fingerprints.snapshot, snapshot.fingerprints.snapshot, "render wording must not change the semantic snapshot fingerprint");

const manualTargetInput = clone(baseInput);
const revenueInput = manualTargetInput.kpis.output.find((item) => item.id === "kpi-revenue");
revenueInput.manualTarget = 130;
revenueInput.effectiveAuthoritativeTarget = { kind: "scalar", value: 130, source: "manual" };
manualTargetInput.kpis.semanticInputFingerprint = `sha256:${"1".repeat(64)}`;
const changedManualTarget = build(manualTargetInput);
assert.notEqual(changedManualTarget.snapshot.fingerprints.input, snapshot.fingerprints.input, "manual target changes are semantic input changes");
assert.notEqual(changedManualTarget.snapshot.fingerprints.snapshot, snapshot.fingerprints.snapshot);

const changedProducerInput = clone(baseInput);
changedProducerInput.kpis.semanticInputFingerprint = `sha256:${"2".repeat(64)}`;
const changedProducerFingerprint = build(changedProducerInput);
assert.notEqual(changedProducerFingerprint.snapshot.fingerprints.input, snapshot.fingerprints.input, "producer semantic input identity must change the input fingerprint");
assert.notEqual(changedProducerFingerprint.snapshot.fingerprints.snapshot, snapshot.fingerprints.snapshot, "producer semantic input identity is part of snapshot provenance");

const changedAsOfInput = clone(baseInput);
changedAsOfInput.asOf = "2026-07-29T12:00:00.000Z";
changedAsOfInput.intelligenceLayer.asOf = changedAsOfInput.asOf;
changedAsOfInput.kpis.asOf = changedAsOfInput.asOf;
changedAsOfInput.coverage.asOf = changedAsOfInput.asOf;
changedAsOfInput.evidenceManifests.asOf = changedAsOfInput.asOf;
const changedAsOf = build(changedAsOfInput);
assert.notEqual(changedAsOf.snapshot.fingerprints.input, snapshot.fingerprints.input, "asOf is a semantic cutoff");

const permutedInput = clone(baseInput);
permutedInput.kpis.output.reverse();
permutedInput.intelligenceLayer.output.insights.reverse();
permutedInput.evidenceManifests.output[0].evidence.reverse();
permutedInput.evidenceManifests.output[0].sourceRegistry.entries.reverse();
const permuted = build(permutedInput);
assert.equal(permuted.snapshot.fingerprints.input, snapshot.fingerprints.input, "input permutation must not change the input fingerprint");
assert.equal(permuted.snapshot.fingerprints.snapshot, snapshot.fingerprints.snapshot, "input permutation must not change canonical output");
assert.deepEqual(permuted.snapshot, snapshot);

const maximize = metric(snapshot, "kpi-revenue");
assert.equal(maximize.semantics.state, "available");
assert.equal(maximize.semantics.value.desiredDirection, "maximize");
assert.equal(maximize.performance.value.latestPerformanceEffect, "favorable");
assert.equal(maximize.manualTarget.value.value, 125);
assert.deepEqual(maximize.effectiveAuthoritativeTarget.value, { kind: "scalar", value: 125, source: "manual" });
assert.equal(maximize.recommendedNextTarget.state, "available");
assert.notEqual(maximize.effectiveAuthoritativeTarget.value.source, "recommended", "an unapplied recommendation cannot become authoritative");

const minimize = metric(snapshot, "kpi-checkout-wait");
assert.equal(minimize.semantics.value.desiredDirection, "minimize");
assert.equal(minimize.performance.value.latestPerformanceEffect, "favorable");
assert.equal(minimize.manualTarget.value.value, 4);
assert.deepEqual(minimize.effectiveAuthoritativeTarget.value, { kind: "scalar", value: 4, source: "manual" });

const targetRange = metric(snapshot, "kpi-utilization-range");
assert.equal(targetRange.semantics.value.desiredDirection, "target_range");
assert.deepEqual(targetRange.configuredSemanticTarget.value, { kind: "range", min: 72, max: 85, source: "semantic" });
assert.equal(targetRange.performance.value.targetStatus, "within_range");

const exactTarget = metric(snapshot, "kpi-inventory-variance");
assert.equal(exactTarget.semantics.value.desiredDirection, "exact_target");
assert.equal(exactTarget.performance.value.targetStatus, "achieved");

const maintain = metric(snapshot, "kpi-staffing-coverage");
assert.equal(maintain.semantics.value.desiredDirection, "maintain");
assert.equal(maintain.performance.value.targetStatus, "achieved");

const unknown = metric(snapshot, "kpi-ambiguous");
assert.equal(unknown.semantics.state, "unknown_semantics");
assert.equal(unknown.performance.state, "unknown_semantics");
assert.equal(unknown.recommendationAvailability, "unavailable");
assert.equal(unknown.recommendedNextTarget.state, "unknown_semantics");
assert.equal(unknown.manualTarget.value.value, 50, "unknown semantics must not discard a manual target");
assert.deepEqual(unknown.effectiveAuthoritativeTarget.value, { kind: "scalar", value: 50, source: "manual" });

assert.equal(snapshot.businessHealth.state, "available");
assert.equal(snapshot.businessHealth.value.score, 42);
assert.equal(snapshot.businessHealth.value.status, "At Risk");
assert.equal(snapshot.businessHealth.value.trajectory, "Holding steady");
assert.equal(snapshot.businessHealth.value.components.state, "available", "the adapter must expose producer-owned score components");
assert.deepEqual(
  {
    dataQualityBase: snapshot.businessHealth.value.components.value.dataQualityBase,
    riskPenalty: snapshot.businessHealth.value.components.value.riskPenalty,
    opportunityAdjustment: snapshot.businessHealth.value.components.value.opportunityAdjustment
  },
  { dataQualityBase: 50, riskPenalty: 12, opportunityAdjustment: 4 }
);
assert.equal(snapshot.dataQuality.value.score, 92);
assert.equal(snapshot.dataQuality.value.confidence, "High");
assert.equal(snapshot.readiness.forecast.value.state, "ready");
assert.equal(snapshot.readiness.coverage.value.overallCoverage, 89);
assert.deepEqual(snapshot.priorities.map((item) => item.role), ["top_risk", "top_opportunity", "top_recommendation"]);
assert.deepEqual(snapshot.findingIndex.riskFindingIds, ["finding-checkout-wait"]);
assert.deepEqual(snapshot.findingIndex.opportunityFindingIds, ["finding-revenue"]);
assert.ok(snapshot.findings.every((finding) => finding.origin === "deterministic" && finding.producerId === "intelligence_layer"));

const legacyV1Snapshot = clone(snapshot);
legacyV1Snapshot.versions.calculations.businessHealth = "business_health_calculation_v1";
legacyV1Snapshot.versions.calculations.dataQuality = "data_quality_calculation_v1";
legacyV1Snapshot.businessHealth.value.score = 78;
legacyV1Snapshot.businessHealth.value.status = "Strong";
legacyV1Snapshot.businessHealth.value.components.value.dataQualityBase = 92;
assert.doesNotThrow(() => contract.parseIntelligenceSnapshotV1(legacyV1Snapshot), "historical V1 snapshots must remain parsable");

const originalEvidence = snapshot.evidence.references.find((item) => item.recordId === "candidate-original");
const contextualEvidence = snapshot.evidence.references.find((item) => item.recordId === "candidate-context");
assert.equal(originalEvidence.authorityRole, "original");
assert.equal(originalEvidence.originalEvidenceEligible, true);
assert.equal(contextualEvidence.authorityRole, "supporting_context");
assert.equal(contextualEvidence.originalEvidenceEligible, false);
const serializedSnapshot = JSON.stringify(snapshot);
assert.doesNotMatch(serializedSnapshot, /unrestricted fixture excerpt|Contextual fixture content/);
assert.doesNotMatch(serializedSnapshot, /embedding|prompt/i, "the base snapshot must not contain prompts or embeddings");
assert.equal(snapshot.evidence.references.some((item) => Object.hasOwn(item, "excerpt") || Object.hasOwn(item, "displayFact")), false);

const foreignEnvelope = clone(baseInput);
foreignEnvelope.kpis.workspaceId = "workspace-foreign";
assert.throws(() => build(foreignEnvelope), /different workspace/);
const foreignMetric = clone(baseInput);
foreignMetric.kpis.output[0].workspaceId = "workspace-foreign";
assert.throws(() => build(foreignMetric), /belongs to another workspace/);
const foreignManifest = clone(baseInput);
foreignManifest.evidenceManifests.output[0].workspaceId = "workspace-foreign";
assert.throws(() => build(foreignManifest), /belongs to another workspace/);
const foreignRegistry = clone(baseInput);
foreignRegistry.evidenceManifests.output[0].sourceRegistry.workspaceId = "workspace-foreign";
assert.throws(() => build(foreignRegistry), /foreign source registry/);

const sharedKpiEvidence = clone(baseInput);
sharedKpiEvidence.intelligenceLayer.output.insights[1].supportingRecords[0] = {
  ...sharedKpiEvidence.intelligenceLayer.output.insights[0].supportingRecords[0],
  recordType: "Imported KPI measurement"
};
const sharedKpiSnapshot = build(sharedKpiEvidence).snapshot;
assert.equal(
  sharedKpiSnapshot.evidence.references.filter((reference) => reference.id === "intelligence-layer:kpi:checkout-wait-latest").length,
  1,
  "the same physical KPI row may support multiple findings without creating conflicting evidence identity"
);
assert.equal(
  sharedKpiSnapshot.evidence.references.find((reference) => reference.id === "intelligence-layer:kpi:checkout-wait-latest")?.recordType,
  "KPI record",
  "KPI evidence identity must not depend on finding-specific presentation labels"
);

const derivedBusinessMemory = clone(baseInput);
derivedBusinessMemory.intelligenceLayer.output.insights[0].supportingRecords.push({
  ...clone(derivedBusinessMemory.intelligenceLayer.output.insights[0].supportingRecords[0]),
  id: "memory:file-derived-context",
  recordType: "Business Memory citation",
  classification: "Derived",
  sourceKey: "source-file:fixture-file"
});
const derivedBusinessMemorySnapshot = build(derivedBusinessMemory).snapshot;
const derivedBusinessMemoryReference = derivedBusinessMemorySnapshot.evidence.references.find(
  (reference) => reference.id === "intelligence-layer:memory:file-derived-context"
);
assert.equal(derivedBusinessMemoryReference?.authorityRole, "derived", "file-derived Business Memory retains derived authority");
assert.equal(derivedBusinessMemoryReference?.originalEvidenceEligible, false);

const businessNoteFindingDependency = clone(baseInput);
businessNoteFindingDependency.intelligenceLayer.output.insights[0].supportingRecords.push({
  ...clone(businessNoteFindingDependency.intelligenceLayer.output.insights[0].supportingRecords[0]),
  id: "business-note:context",
  recordType: "Business Note context",
  classification: "Derived",
  sourceKey: "business-note:fixture-note"
});
assert.throws(
  () => build(businessNoteFindingDependency),
  /depends on Business Note context/,
  "actual Business Note context must remain unable to drive deterministic findings"
);

const oversizedFindingDependencies = clone(baseInput);
const dependencyTemplate = oversizedFindingDependencies.intelligenceLayer.output.insights[0].supportingRecords[0];
oversizedFindingDependencies.intelligenceLayer.output.insights[0].supportingRecords = Array.from({ length: 30 }, (_, index) => ({
  ...clone(dependencyTemplate),
  id: `operational-record-${String(index + 1).padStart(2, "0")}`,
  sourceKey: `source-file:fixture-${String(index + 1).padStart(2, "0")}`
}));
const oversizedFindingSnapshot = build(oversizedFindingDependencies).snapshot;
assert.equal(
  oversizedFindingSnapshot.findings[0].deterministicDependencies.evidenceReferenceIds.length,
  24,
  "snapshot finding dependencies must respect the existing contract bound"
);

const unsupportedVersion = clone(baseInput);
unsupportedVersion.kpis.producerVersion = "kpi_semantics_v0";
assert.throws(() => build(unsupportedVersion), /Unsupported canonical_kpi_semantics producer version/);
const unsupportedAdapterVersion = clone(baseInput);
unsupportedAdapterVersion.versions.adapters.kpis = "canonical_kpi_snapshot_adapter_v2";
assert.throws(() => build(unsupportedAdapterVersion), /Unsupported IntelligenceSnapshotV1 .* version map/);

const malformedProducerOutput = clone(baseInput);
malformedProducerOutput.intelligenceLayer.output.dataQuality.confidence = "Certain";
assert.throws(() => build(malformedProducerOutput), "malformed producer output must fail runtime schema validation");

const duplicateKpi = clone(baseInput);
duplicateKpi.kpis.output.push({ ...clone(duplicateKpi.kpis.output[0]), id: "kpi-revenue-duplicate" });
assert.throws(() => build(duplicateKpi), /canonical KPI identities must be unique/);
const scaledKpi = clone(baseInput);
const scaledRevenue = { ...clone(scaledKpi.kpis.output[0]), id: "kpi-revenue-millions" };
scaledRevenue.semantics.displayName = "Revenue ($M)";
scaledRevenue.semantics.originalSourceLabel = "Revenue ($M)";
scaledRevenue.semantics.scale = 1_000_000;
scaledKpi.kpis.output.push(scaledRevenue);
assert.doesNotThrow(() => build(scaledKpi), "scaled KPI identities must remain distinct");

const tooManyObservations = clone(baseInput);
const observationMetric = tooManyObservations.kpis.output[0];
observationMetric.observations.selectedRange.boundedObservations.push({
  observationId: "seventh",
  observedAt: "2026-07-02",
  value: 121
});
observationMetric.observations.selectedRange.totalObservationCount = 7;
assert.throws(() => build(tooManyObservations), /Array must contain at most 6 element/);

const savedAnalysisInput = clone(baseInput);
savedAnalysisInput.intelligenceLayer.output.insights[0].supportingRecords[0].recordType = "Saved Analysis";
assert.throws(() => build(savedAnalysisInput), /Saved Analysis/);
const promotedContext = clone(baseInput);
promotedContext.evidenceManifests.output[0].evidence[1].evidenceRole = "original";
promotedContext.evidenceManifests.output[0].evidence[1].originalEvidenceEligible = true;
promotedContext.evidenceManifests.output[0].sourceRegistry.entries[1].evidenceRole = "original";
assert.throws(() => build(promotedContext), /contextual evidence .* was promoted/);
const unresolvedSource = clone(baseInput);
unresolvedSource.evidenceManifests.output[0].sourceRegistry.entries.splice(0, 1);
assert.throws(() => build(unresolvedSource), /does not resolve source ordinal/);
const inconsistentEvidenceRole = clone(baseInput);
inconsistentEvidenceRole.evidenceManifests.output[0].sourceRegistry.entries[1].evidenceRole = "original";
assert.throws(() => build(inconsistentEvidenceRole), /inconsistent evidence roles/);
const inconsistentCandidateMapping = clone(baseInput);
inconsistentCandidateMapping.evidenceManifests.output[0].sourceRegistry.candidateToSourceOrdinal["candidate-context"] = "S1";
assert.throws(() => build(inconsistentCandidateMapping), /inconsistent candidate-to-source mapping/);
const unknownWithSemanticTarget = clone(baseInput);
const ambiguousInput = unknownWithSemanticTarget.kpis.output.find((item) => item.id === "kpi-ambiguous");
ambiguousInput.configuredSemanticTarget = { kind: "scalar", value: 50, source: "semantic" };
assert.throws(() => build(unknownWithSemanticTarget), /semantic target with unknown semantics/);

const projections = {
  overview: contract.projectExecutiveOverviewV1(snapshot),
  inbox: contract.projectIntelligenceInboxV1(snapshot),
  health: contract.projectBusinessHealthExplanationV1(snapshot),
  finding: contract.projectFindingExplanationV1(snapshot, "finding-checkout-wait"),
  missingFinding: contract.projectFindingExplanationV1(snapshot, "missing"),
};
assert.equal(projections.overview.topRisk.id, "finding-checkout-wait");
assert.equal(projections.inbox.findings.length, snapshot.findings.length);
assert.equal(projections.health.businessHealth.value.score, 42);
assert.deepEqual(projections.health.drivers.map((driver) => driver.finding.id), ["finding-checkout-wait", "finding-revenue"]);
assert.ok(projections.health.evidenceReferences.length <= 24);
assert.ok(projections.health.citations.length <= 24);
assert.equal(projections.finding.finding.state, "available");
assert.equal(projections.missingFinding.finding.state, "unavailable");

const parity = contract.compareIntelligenceSnapshotV1({
  snapshot,
  intelligenceLayer: baseInput.intelligenceLayer.output,
  kpis: baseInput.kpis.output,
  coverage: baseInput.coverage.output,
  evidenceManifests: baseInput.evidenceManifests.output,
  generatedAt: contract.FOUNDATION_FIXTURE_GENERATED_AT
});
assert.equal(parity.status, "exact", "authoritative Business Health score components must preserve exact snapshot parity");
assert.equal(parity.counts.missing_producer_field, 0);
assert.equal(parity.counts.adapter_defect, 0);
assert.equal(parity.counts.genuine_deterministic_disagreement, 0);
assert.equal(parity.counts.unavailable_for_comparison, 0);
assert.equal(parity.differences.some((item) => item.severity === "blocking" || item.severity === "fatal"), false);
assert.equal("differences" in snapshot, false, "shadow parity must not alter the semantic snapshot");

const presentationSnapshot = clone(snapshot);
presentationSnapshot.findings[0].title = "Changed presentation";
const presentationParity = contract.compareIntelligenceSnapshotV1({
  snapshot: presentationSnapshot,
  intelligenceLayer: baseInput.intelligenceLayer.output,
  kpis: baseInput.kpis.output,
  coverage: baseInput.coverage.output,
  evidenceManifests: baseInput.evidenceManifests.output,
  generatedAt: contract.FOUNDATION_FIXTURE_GENERATED_AT
});
assert.ok(presentationParity.differences.some((item) => item.classification === "presentation_only"));

const orderingLayer = clone(baseInput.intelligenceLayer.output);
orderingLayer.insights.reverse();
const orderingParity = contract.compareIntelligenceSnapshotV1({
  snapshot,
  intelligenceLayer: orderingLayer,
  kpis: baseInput.kpis.output,
  coverage: baseInput.coverage.output,
  evidenceManifests: baseInput.evidenceManifests.output,
  generatedAt: contract.FOUNDATION_FIXTURE_GENERATED_AT
});
assert.ok(orderingParity.differences.some((item) => item.classification === "ordering_only"));

const legacyParity = contract.compareIntelligenceSnapshotV1({
  snapshot,
  intelligenceLayer: baseInput.intelligenceLayer.output,
  kpis: baseInput.kpis.output,
  coverage: baseInput.coverage.output,
  evidenceManifests: baseInput.evidenceManifests.output,
  generatedAt: contract.FOUNDATION_FIXTURE_GENERATED_AT,
  legacyDuplicates: [{ path: "legacy.businessHealth", authoritative: 78, legacy: 74 }]
});
assert.equal(legacyParity.counts.legacy_duplicate, 1);

const dataQualityMismatch = clone(snapshot);
dataQualityMismatch.dataQuality.value.score = 91;
const dataQualityParity = contract.compareIntelligenceSnapshotV1({
  snapshot: dataQualityMismatch,
  intelligenceLayer: baseInput.intelligenceLayer.output,
  kpis: baseInput.kpis.output,
  coverage: baseInput.coverage.output,
  evidenceManifests: baseInput.evidenceManifests.output,
  generatedAt: contract.FOUNDATION_FIXTURE_GENERATED_AT
});
assert.ok(dataQualityParity.differences.some((item) => item.path === "dataQuality" && item.severity === "blocking"));

const priorityMismatch = clone(snapshot);
priorityMismatch.priorities.pop();
const priorityParity = contract.compareIntelligenceSnapshotV1({
  snapshot: priorityMismatch,
  intelligenceLayer: baseInput.intelligenceLayer.output,
  kpis: baseInput.kpis.output,
  coverage: baseInput.coverage.output,
  evidenceManifests: baseInput.evidenceManifests.output,
  generatedAt: contract.FOUNDATION_FIXTURE_GENERATED_AT
});
assert.ok(priorityParity.differences.some((item) => item.path === "priorities" && item.severity === "blocking"));

const coverageMismatch = clone(snapshot);
coverageMismatch.readiness.coverage.value.overallCoverage = 88;
const coverageParity = contract.compareIntelligenceSnapshotV1({
  snapshot: coverageMismatch,
  intelligenceLayer: baseInput.intelligenceLayer.output,
  kpis: baseInput.kpis.output,
  coverage: baseInput.coverage.output,
  evidenceManifests: baseInput.evidenceManifests.output,
  generatedAt: contract.FOUNDATION_FIXTURE_GENERATED_AT
});
assert.ok(coverageParity.differences.some((item) => item.path === "readiness.coverage" && item.severity === "blocking"));

const evidenceMismatch = clone(snapshot);
evidenceMismatch.evidence.references[0].authorityRole = "derived";
const evidenceParity = contract.compareIntelligenceSnapshotV1({
  snapshot: evidenceMismatch,
  intelligenceLayer: baseInput.intelligenceLayer.output,
  kpis: baseInput.kpis.output,
  coverage: baseInput.coverage.output,
  evidenceManifests: baseInput.evidenceManifests.output,
  generatedAt: contract.FOUNDATION_FIXTURE_GENERATED_AT
});
assert.ok(evidenceParity.differences.some((item) => item.path === "evidence" && item.severity === "blocking"));

const sourceFiles = fs.readdirSync(path.join(root, "lib/intelligence/snapshot/v1"), { recursive: true })
  .filter((file) => typeof file === "string" && file.endsWith(".ts"))
  .map((file) => fs.readFileSync(path.join(root, "lib/intelligence/snapshot/v1", file), "utf8"))
  .join("\n");
assert.doesNotMatch(sourceFiles, /runStructuredAI|openai-provider|nvidia-provider|provider-manager|createClient\(|\.from\(/, "snapshot construction must not invoke providers or query the database");
assert.doesNotMatch(sourceFiles, /from ["']@\/app\//, "snapshot construction must not import page-level code");
assert.doesNotMatch(sourceFiles, /SnapshotState<unknown>/, "readiness contracts must remain concrete");

assert.ok(first.receipt.performance.totalMs >= 0);
assert.ok(first.receipt.performance.adapterMs >= 0);
assert.ok(first.receipt.performance.orderingMs >= 0);
assert.ok(first.receipt.performance.validationMs >= 0);
assert.ok(first.receipt.performance.hashingMs >= 0);
assert.ok(first.receipt.performance.serializationMs >= 0);
assert.equal(first.receipt.fixtureSizes.kpis, 6);
assert.equal(first.receipt.fixtureSizes.findings, 2);
assert.ok(first.receipt.fixtureSizes.evidenceReferences >= 4);
assert.ok(first.receipt.fixtureSizes.serializedBytes > 0);

console.log("IntelligenceSnapshotV1 regression tests passed.");
console.log(JSON.stringify({ fixtureSizes: first.receipt.fixtureSizes, performance: first.receipt.performance }, null, 2));
