import { canonicalKpiIdentity } from "@/lib/intelligence/snapshot/v1/ordering";
import { fingerprintSemanticSnapshot, fingerprintSnapshotInputs } from "@/lib/intelligence/snapshot/v1/fingerprints";
import { INTELLIGENCE_SNAPSHOT_LIMITS, SUPPORTED_PRODUCER_VERSIONS } from "@/lib/intelligence/snapshot/v1/versions";
import type { EvidenceReferenceV1, IntelligenceSnapshotV1, KpiSnapshotV1 } from "@/lib/intelligence/snapshot/v1/types";

export class IntelligenceSnapshotInvariantError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`IntelligenceSnapshotV1 invariant validation failed: ${issues.join("; ")}`);
    this.name = "IntelligenceSnapshotInvariantError";
    this.issues = issues;
  }
}

function duplicateValues(values: readonly string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function contextualSource(reference: EvidenceReferenceV1) {
  return reference.authorityRole === "supporting_context"
    || /business[ _-]?(?:note|memory)/i.test(`${reference.recordType} ${reference.sourceType}`);
}

function businessNoteContextSource(reference: EvidenceReferenceV1) {
  return reference.authorityRole === "supporting_context"
    || /business[ _-]?note/i.test(`${reference.recordType} ${reference.sourceType}`);
}

function savedAnalysisSource(reference: EvidenceReferenceV1) {
  return /saved[ _-]?analysis/i.test(`${reference.recordType} ${reference.sourceType} ${reference.recordId}`);
}

function validateKpi(kpi: KpiSnapshotV1, issues: string[]) {
  const selected = kpi.observations.selectedRange.boundedObservations;
  if (selected.length > INTELLIGENCE_SNAPSHOT_LIMITS.observationsPerKpi) {
    issues.push(`KPI ${kpi.id} exceeds the bounded observation limit`);
  }
  if (new Set(selected.map((observation) => observation.observationId)).size !== selected.length) {
    issues.push(`KPI ${kpi.id} has duplicate bounded observation IDs`);
  }
  if (kpi.observations.selectedRange.totalObservationCount < selected.length) {
    issues.push(`KPI ${kpi.id} reports fewer total observations than its bounded representation`);
  }

  if (kpi.semantics.state === "unknown_semantics") {
    if (kpi.performance.state !== "unknown_semantics") {
      issues.push(`KPI ${kpi.id} exposes directional performance with unknown semantics`);
    }
    if (kpi.recommendationAvailability !== "unavailable" || kpi.recommendedNextTarget.state === "available") {
      issues.push(`KPI ${kpi.id} exposes a recommendation with unknown semantics`);
    }
    if (kpi.configuredSemanticTarget.state === "available") {
      issues.push(`KPI ${kpi.id} exposes a semantic target with unknown semantics`);
    }
  }
  if (kpi.semantics.state === "available" && kpi.semantics.value.desiredDirection === "unknown") {
    issues.push(`KPI ${kpi.id} must use the unknown_semantics state for an unknown direction`);
  }

  if (kpi.manualTarget.state === "available") {
    if (
      kpi.effectiveAuthoritativeTarget.state !== "available"
      || kpi.effectiveAuthoritativeTarget.value.kind !== "scalar"
      || kpi.effectiveAuthoritativeTarget.value.source !== "manual"
      || kpi.effectiveAuthoritativeTarget.value.value !== kpi.manualTarget.value.value
    ) {
      issues.push(`KPI ${kpi.id} does not preserve its manual target as authoritative`);
    }
  }
  if (
    kpi.configuredSemanticTarget.state === "available"
    && kpi.configuredSemanticTarget.value.kind !== "none"
    && kpi.configuredSemanticTarget.value.source !== "semantic"
  ) {
    issues.push(`KPI ${kpi.id} has a non-semantic configured target`);
  }
  if ((kpi.recommendationAvailability === "available") !== (kpi.recommendedNextTarget.state === "available")) {
    issues.push(`KPI ${kpi.id} has inconsistent recommendation availability`);
  }

  for (const state of [kpi.configuredSemanticTarget, kpi.effectiveAuthoritativeTarget]) {
    if (state.state === "available" && state.value.kind === "range" && state.value.min > state.value.max) {
      issues.push(`KPI ${kpi.id} has an inverted target range`);
    }
  }
  if (
    kpi.recommendedNextTarget.state === "available"
    && kpi.recommendedNextTarget.value.target.kind === "range"
    && kpi.recommendedNextTarget.value.target.min > kpi.recommendedNextTarget.value.target.max
  ) {
    issues.push(`KPI ${kpi.id} has an inverted recommended range`);
  }

  if (kpi.performance.state === "available") {
    const checks = [
      ["current", kpi.observations.current?.value ?? null, kpi.performance.value.latestValue],
      ["previous", kpi.observations.previous?.value ?? null, kpi.performance.value.previousValue],
      ["range start", kpi.observations.rangeStart?.value ?? null, kpi.performance.value.rangeStartValue]
    ] as const;
    for (const [label, observation, evaluation] of checks) {
      if (observation !== evaluation) issues.push(`KPI ${kpi.id} ${label} observation disagrees with its producer evaluation`);
    }
  }
}

export function assertIntelligenceSnapshotV1Invariants(snapshot: IntelligenceSnapshotV1) {
  const issues: string[] = [];
  let invariantCount = 0;
  const check = (condition: boolean, issue: string) => {
    invariantCount += 1;
    if (!condition) issues.push(issue);
  };

  check(Boolean(snapshot.scope.workspaceId), "workspaceId is required");
  check(snapshot.kpis.length <= INTELLIGENCE_SNAPSHOT_LIMITS.kpis, "KPI limit exceeded");
  check(snapshot.findings.length <= INTELLIGENCE_SNAPSHOT_LIMITS.findings, "finding limit exceeded");
  check(snapshot.evidence.references.length <= INTELLIGENCE_SNAPSHOT_LIMITS.evidenceReferences, "evidence reference limit exceeded");
  check(snapshot.evidence.citations.length <= INTELLIGENCE_SNAPSHOT_LIMITS.citations, "citation limit exceeded");
  check((snapshot.contextualEvidence?.length || 0) <= INTELLIGENCE_SNAPSHOT_LIMITS.contextualEvidenceRecords, "contextual evidence limit exceeded");

  for (const receipt of snapshot.provenance) {
    check(receipt.workspaceId === snapshot.scope.workspaceId, `producer ${receipt.producerId} belongs to another workspace`);
    check(receipt.asOf === snapshot.scope.asOf, `producer ${receipt.producerId} used a different asOf cutoff`);
    check(SUPPORTED_PRODUCER_VERSIONS[receipt.producerId] === receipt.producerVersion, `producer ${receipt.producerId} has an unsupported version`);
  }
  check(
    duplicateValues(snapshot.provenance.map((receipt) => receipt.producerId)).length === 0,
    "producer receipts must be unique"
  );

  const kpiIds = new Set(snapshot.kpis.map((kpi) => kpi.id));
  check(kpiIds.size === snapshot.kpis.length, "KPI IDs must be unique");
  check(
    duplicateValues(snapshot.kpis.map(canonicalKpiIdentity)).length === 0,
    "canonical KPI identities must be unique while preserving scale and metric role"
  );
  snapshot.kpis.forEach((kpi) => validateKpi(kpi, issues));

  const findingIds = new Set(snapshot.findings.map((finding) => finding.id));
  check(findingIds.size === snapshot.findings.length, "finding IDs must be unique");
  check(
    duplicateValues(snapshot.findings.map((finding) => finding.fingerprint)).length === 0,
    "finding fingerprints must be unique"
  );
  for (const finding of snapshot.findings) {
    check(finding.origin === "deterministic", `finding ${finding.id} is not deterministic`);
    check(
      finding.producerId === "intelligence_layer" || finding.producerId === "operational_evidence",
      `finding ${finding.id} has an unauthorized producer`
    );
    for (const kpiId of finding.deterministicDependencies.kpiIds) {
      check(kpiIds.has(kpiId), `finding ${finding.id} references missing KPI ${kpiId}`);
    }
  }

  const contextualRecords = snapshot.contextualEvidence || [];
  check(new Set(contextualRecords.map((record) => record.id)).size === contextualRecords.length, "contextual evidence IDs must be unique");
  check(new Set(contextualRecords.map((record) => record.sourceNoteId)).size === contextualRecords.length, "contextual evidence source-note IDs must be unique");
  for (const record of contextualRecords) {
    check(record.workspaceId === snapshot.scope.workspaceId, `contextual evidence ${record.id} belongs to another workspace`);
    check(record.authorityRole === "supporting_context", `contextual evidence ${record.id} has deterministic authority`);
    check(!record.originalEvidenceEligible, `contextual evidence ${record.id} was promoted to original evidence`);
    check(record.lifecycle === "active" && record.validationState === "approved_review", `contextual evidence ${record.id} is not approved and active`);
    check(Date.parse(record.approvedAt) <= Date.parse(snapshot.scope.asOf), `contextual evidence ${record.id} was approved after asOf`);
    check(
      !record.applicability.start || !record.applicability.end || record.applicability.start <= record.applicability.end,
      `contextual evidence ${record.id} has an inverted applicable period`
    );
    check(!record.applicability.end || record.applicability.end >= snapshot.scope.evaluationDate, `contextual evidence ${record.id} is expired`);
    const expectedTemporalStatus = !record.applicability.start && !record.applicability.end
      ? "undated"
      : record.applicability.start && record.applicability.start > snapshot.scope.evaluationDate
        ? "upcoming"
        : "applicable";
    check(record.applicability.temporalStatus === expectedTemporalStatus, `contextual evidence ${record.id} has inconsistent temporal attribution`);
  }

  const priorityRoles = snapshot.priorities.map((priority) => priority.role);
  check(new Set(priorityRoles).size === priorityRoles.length, "priority roles must be unique");
  for (const priority of snapshot.priorities) {
    check(findingIds.has(priority.findingId), `priority ${priority.role} references a missing finding`);
  }
  const expectedFindingIndex = {
    riskFindingIds: snapshot.findings.filter((finding) => ["Risk", "Bottleneck", "Anomaly"].includes(finding.type)).map((finding) => finding.id),
    opportunityFindingIds: snapshot.findings.filter((finding) => finding.type === "Opportunity").map((finding) => finding.id),
    recommendationFindingIds: snapshot.findings.filter((finding) => finding.type === "Recommendation").map((finding) => finding.id),
    forecastFindingIds: snapshot.findings.filter((finding) => finding.type === "Forecast").map((finding) => finding.id)
  };
  check(JSON.stringify(snapshot.findingIndex) === JSON.stringify(expectedFindingIndex), "finding index must exactly classify canonical findings");
  for (const findingId of Object.values(snapshot.findingIndex).flat()) {
    check(findingIds.has(findingId), `finding index references missing finding ${findingId}`);
  }

  const evidenceIds = new Set(snapshot.evidence.references.map((reference) => reference.id));
  check(evidenceIds.size === snapshot.evidence.references.length, "evidence reference IDs must be unique");
  for (const reference of snapshot.evidence.references) {
    check(reference.workspaceId === snapshot.scope.workspaceId, `evidence ${reference.id} belongs to another workspace`);
    check(reference.lifecycle === "active", `evidence ${reference.id} is not active`);
    check(!savedAnalysisSource(reference), `Saved Analysis ${reference.id} cannot become snapshot evidence`);
    if (reference.authorityRole === "original") {
      check(reference.originalEvidenceEligible, `original evidence ${reference.id} is not eligible`);
      check(!contextualSource(reference), `contextual evidence ${reference.id} was promoted to original authority`);
    } else {
      check(!reference.originalEvidenceEligible, `non-original evidence ${reference.id} was marked original-evidence eligible`);
    }
  }
  for (const finding of snapshot.findings) {
    for (const evidenceId of finding.deterministicDependencies.evidenceReferenceIds) {
      check(evidenceIds.has(evidenceId), `finding ${finding.id} references missing evidence ${evidenceId}`);
      const reference = snapshot.evidence.references.find((candidate) => candidate.id === evidenceId);
      check(!reference || !businessNoteContextSource(reference), `finding ${finding.id} depends on Business Note context ${evidenceId}`);
    }
  }
  for (const kpi of snapshot.kpis) {
    for (const evidenceId of kpi.evidenceReferenceIds) {
      check(evidenceIds.has(evidenceId), `KPI ${kpi.id} references missing evidence ${evidenceId}`);
      const reference = snapshot.evidence.references.find((candidate) => candidate.id === evidenceId);
      check(!reference || !businessNoteContextSource(reference), `KPI ${kpi.id} depends on Business Note context ${evidenceId}`);
    }
  }

  const citationIds = new Set(snapshot.evidence.citations.map((citation) => citation.id));
  check(citationIds.size === snapshot.evidence.citations.length, "citation IDs must be unique");
  for (const citation of snapshot.evidence.citations) {
    check(evidenceIds.has(citation.evidenceReferenceId), `citation ${citation.id} references missing evidence`);
  }
  for (const finding of snapshot.findings) {
    for (const citationId of finding.citationIds) {
      check(citationIds.has(citationId), `finding ${finding.id} references missing citation ${citationId}`);
    }
  }

  if (snapshot.businessHealth.state === "available") {
    check(snapshot.businessHealth.value.score >= 0 && snapshot.businessHealth.value.score <= 100, "Business Health score is out of bounds");
    if (snapshot.businessHealth.value.components.state === "available") {
      const components = snapshot.businessHealth.value.components.value;
      const impactFindingIds = components.driverImpacts.map((impact) => impact.findingId);
      check(new Set(impactFindingIds).size === impactFindingIds.length, "Business Health driver impacts must reference unique findings");
      for (const impact of components.driverImpacts) {
        check(findingIds.has(impact.findingId), `Business Health driver impact references missing finding ${impact.findingId}`);
        check(
          (impact.kind === "risk" && impact.scoreImpact < 0) || (impact.kind === "opportunity" && impact.scoreImpact > 0),
          `Business Health driver impact ${impact.findingId} has an invalid sign`
        );
      }
      check(
        Math.abs(components.driverImpacts.filter((impact) => impact.kind === "risk").reduce((sum, impact) => sum + impact.scoreImpact, 0)) === components.riskPenalty,
        "Business Health driver impacts disagree with the authoritative risk penalty"
      );
      check(
        components.driverImpacts.filter((impact) => impact.kind === "opportunity").reduce((sum, impact) => sum + impact.scoreImpact, 0) === components.opportunityAdjustment,
        "Business Health driver impacts disagree with the authoritative opportunity adjustment"
      );
    }
  }
  if (snapshot.dataQuality.state === "available") {
    check(snapshot.dataQuality.value.score >= 0 && snapshot.dataQuality.value.score <= 100, "data-quality score is out of bounds");
  }

  if (/^sha256:[a-f0-9]{64}$/.test(snapshot.fingerprints.input)) {
    check(snapshot.fingerprints.input === fingerprintSnapshotInputs(snapshot), "input fingerprint does not match semantic inputs");
  }
  if (/^sha256:[a-f0-9]{64}$/.test(snapshot.fingerprints.snapshot)) {
    check(snapshot.fingerprints.snapshot === fingerprintSemanticSnapshot(snapshot), "snapshot fingerprint does not match semantic content");
  }

  if (issues.length) throw new IntelligenceSnapshotInvariantError(issues);
  return invariantCount;
}
