import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { INTELLIGENCE_SNAPSHOT_LIMITS } from "@/lib/intelligence/snapshot/v1/versions";
import type {
  EvidenceReferenceV1,
  FindingSnapshotV1,
  IntelligenceSnapshotV1,
  KpiSnapshotV1,
  PrioritySnapshotV1,
  SnapshotLimitationV1,
  SnapshotState
} from "@/lib/intelligence/snapshot/v1/types";

type ProjectionHeaderV1 = Readonly<{
  contractVersion: "1.0.0";
  snapshotFingerprint: string;
  workspaceId: string;
  asOf: string;
}>;

function header(snapshot: IntelligenceSnapshotV1): ProjectionHeaderV1 {
  return {
    contractVersion: snapshot.contract.version,
    snapshotFingerprint: snapshot.fingerprints.snapshot,
    workspaceId: snapshot.scope.workspaceId,
    asOf: snapshot.scope.asOf
  };
}

function findingByPriority(snapshot: IntelligenceSnapshotV1, role: PrioritySnapshotV1["role"]) {
  const findingId = snapshot.priorities.find((priority) => priority.role === role)?.findingId;
  return findingId ? snapshot.findings.find((finding) => finding.id === findingId) || null : null;
}

export type ExecutiveOverviewProjectionV1 = ProjectionHeaderV1 & Readonly<{
  businessHealth: IntelligenceSnapshotV1["businessHealth"];
  dataQuality: IntelligenceSnapshotV1["dataQuality"];
  coverage: IntelligenceSnapshotV1["readiness"]["coverage"];
  topRisk: FindingSnapshotV1 | null;
  topOpportunity: FindingSnapshotV1 | null;
  topRecommendation: FindingSnapshotV1 | null;
}>;

export function projectExecutiveOverviewV1(snapshot: IntelligenceSnapshotV1): ExecutiveOverviewProjectionV1 {
  return {
    ...header(snapshot),
    businessHealth: snapshot.businessHealth,
    dataQuality: snapshot.dataQuality,
    coverage: snapshot.readiness.coverage,
    topRisk: findingByPriority(snapshot, "top_risk"),
    topOpportunity: findingByPriority(snapshot, "top_opportunity"),
    topRecommendation: findingByPriority(snapshot, "top_recommendation")
  };
}

export type IntelligenceInboxProjectionV1 = ProjectionHeaderV1 & Readonly<{
  findings: readonly FindingSnapshotV1[];
  priorities: readonly PrioritySnapshotV1[];
}>;

export function projectIntelligenceInboxV1(snapshot: IntelligenceSnapshotV1): IntelligenceInboxProjectionV1 {
  return { ...header(snapshot), findings: snapshot.findings, priorities: snapshot.priorities };
}

export type KpiOverviewProjectionV1 = ProjectionHeaderV1 & Readonly<{
  kpis: readonly KpiSnapshotV1[];
  forecastReadiness: IntelligenceSnapshotV1["readiness"]["forecast"];
}>;

export function projectKpiOverviewV1(snapshot: IntelligenceSnapshotV1): KpiOverviewProjectionV1 {
  return {
    ...header(snapshot),
    kpis: snapshot.kpis.slice(0, 12),
    forecastReadiness: snapshot.readiness.forecast
  };
}

export type KpiPageProjectionV1 = ProjectionHeaderV1 & Readonly<{
  kpis: readonly KpiSnapshotV1[];
  forecastReadiness: IntelligenceSnapshotV1["readiness"]["forecast"];
}>;

export function projectKpiPageV1(snapshot: IntelligenceSnapshotV1, kpiIds?: readonly string[]): KpiPageProjectionV1 {
  const selectedIds = kpiIds ? new Set(kpiIds) : null;
  const kpis = selectedIds ? snapshot.kpis.filter((kpi) => selectedIds.has(kpi.id)) : snapshot.kpis;
  if (selectedIds && kpis.length !== selectedIds.size) {
    throw new Error("A requested KPI does not resolve in IntelligenceSnapshotV1.");
  }
  return { ...header(snapshot), kpis, forecastReadiness: snapshot.readiness.forecast };
}

export type KpiDetailProjectionV1 = ProjectionHeaderV1 & Readonly<{
  kpi: SnapshotState<KpiSnapshotV1>;
}>;

export function projectKpiDetailV1(snapshot: IntelligenceSnapshotV1, kpiId: string): KpiDetailProjectionV1 {
  const kpi = snapshot.kpis.find((candidate) => candidate.id === kpiId);
  return {
    ...header(snapshot),
    kpi: kpi
      ? { state: "available", value: kpi }
      : { state: "unavailable", reason: { code: "source_not_available" } }
  };
}

export type KpiCompareProjectionV1 = ProjectionHeaderV1 & Readonly<{
  kpis: readonly KpiSnapshotV1[];
}>;

export function projectKpiCompareV1(snapshot: IntelligenceSnapshotV1, kpiIds: readonly string[]): KpiCompareProjectionV1 {
  const selectedIds = new Set(kpiIds);
  const kpis = snapshot.kpis.filter((kpi) => selectedIds.has(kpi.id));
  if (kpis.length !== selectedIds.size) throw new Error("A compared KPI does not resolve in IntelligenceSnapshotV1.");
  return { ...header(snapshot), kpis };
}

export type BusinessHealthExplanationProjectionV1 = ProjectionHeaderV1 & Readonly<{
  businessHealth: IntelligenceSnapshotV1["businessHealth"];
  dataQuality: IntelligenceSnapshotV1["dataQuality"];
  drivers: readonly Readonly<{
    finding: FindingSnapshotV1;
    kind: "risk" | "opportunity";
    scoreImpact: number;
    stableKey: string;
  }>[];
  priorities: readonly PrioritySnapshotV1[];
  evidenceReferences: readonly EvidenceReferenceV1[];
  citations: IntelligenceSnapshotV1["evidence"]["citations"];
  limitations: readonly SnapshotLimitationV1[];
}>;

export function businessHealthDriverStableKey(kind: "risk" | "opportunity", findingFingerprint: string) {
  return evidenceEngineHash({ kind, fingerprint: findingFingerprint });
}

export function projectBusinessHealthExplanationV1(snapshot: IntelligenceSnapshotV1): BusinessHealthExplanationProjectionV1 {
  const impacts = snapshot.businessHealth.state === "available" && snapshot.businessHealth.value.components.state === "available"
    ? snapshot.businessHealth.value.components.value.driverImpacts
    : [];
  const keyedImpacts = impacts.map((impact) => {
    const finding = snapshot.findings.find((candidate) => candidate.id === impact.findingId);
    if (!finding) throw new Error(`Business Health driver ${impact.findingId} does not resolve to a canonical finding.`);
    return { ...impact, finding, stableKey: businessHealthDriverStableKey(impact.kind, finding.fingerprint) };
  });
  const ordered = [...keyedImpacts].sort((left, right) => {
    const weightDelta = Math.abs(right.scoreImpact) - Math.abs(left.scoreImpact);
    return weightDelta || left.stableKey.localeCompare(right.stableKey);
  });
  const firstRisk = ordered.find((item) => item.kind === "risk");
  const firstOpportunity = ordered.find((item) => item.kind === "opportunity");
  const selectedImpacts = [firstRisk, firstOpportunity, ...ordered]
    .filter((item): item is (typeof ordered)[number] => Boolean(item))
    .filter((item, index, items) => items.findIndex((candidate) => candidate.stableKey === item.stableKey) === index)
    .slice(0, 4);
  const drivers = selectedImpacts.map((impact) => {
    return { finding: impact.finding, kind: impact.kind, scoreImpact: impact.scoreImpact, stableKey: impact.stableKey };
  });
  const findingEvidenceIds = new Set(drivers.flatMap((driver) => driver.finding.deterministicDependencies.evidenceReferenceIds));
  const citationEvidenceIds = new Set(snapshot.evidence.citations.map((citation) => citation.evidenceReferenceId));
  const citationEvidenceReferences = snapshot.evidence.references
    .filter((reference) => citationEvidenceIds.has(reference.id))
    .slice(0, 24);
  const retainedCitationEvidenceIds = new Set(citationEvidenceReferences.map((reference) => reference.id));
  const evidenceReferences = [
    ...citationEvidenceReferences,
    ...snapshot.evidence.references
      .filter((reference) => findingEvidenceIds.has(reference.id) && !retainedCitationEvidenceIds.has(reference.id))
      .slice(0, 24 - citationEvidenceReferences.length)
  ];
  const projectedEvidenceIds = new Set(evidenceReferences.map((reference) => reference.id));
  return {
    ...header(snapshot),
    businessHealth: snapshot.businessHealth,
    dataQuality: snapshot.dataQuality,
    drivers,
    priorities: snapshot.priorities,
    evidenceReferences,
    citations: snapshot.evidence.citations.filter((citation) => projectedEvidenceIds.has(citation.evidenceReferenceId)).slice(0, 24),
    limitations: snapshot.limitations.filter((limitation) => limitation.scope === "business_health" || limitation.scope === "data_quality")
  };
}

export type FindingExplanationProjectionV1 = ProjectionHeaderV1 & Readonly<{
  finding: SnapshotState<FindingSnapshotV1>;
  evidenceReferences: readonly EvidenceReferenceV1[];
}>;

export function projectFindingExplanationV1(snapshot: IntelligenceSnapshotV1, findingId: string): FindingExplanationProjectionV1 {
  const finding = snapshot.findings.find((candidate) => candidate.id === findingId);
  if (!finding) {
    return {
      ...header(snapshot),
      finding: { state: "unavailable", reason: { code: "source_not_available" } },
      evidenceReferences: []
    };
  }
  const evidenceIds = new Set(finding.deterministicDependencies.evidenceReferenceIds);
  return {
    ...header(snapshot),
    finding: { state: "available", value: finding },
    evidenceReferences: snapshot.evidence.references.filter((reference) => evidenceIds.has(reference.id)).slice(0, 24)
  };
}

export type PeoplePrestigeProjectionV1 = ProjectionHeaderV1 & Readonly<{
  authoritativeBusinessHealth: IntelligenceSnapshotV1["businessHealth"];
  priorityFindingIds: readonly string[];
  legacyPrestigeAuthorityAllowed: false;
}>;

export function projectPeoplePrestigeV1(snapshot: IntelligenceSnapshotV1): PeoplePrestigeProjectionV1 {
  return {
    ...header(snapshot),
    authoritativeBusinessHealth: snapshot.businessHealth,
    priorityFindingIds: snapshot.priorities.map((priority) => priority.findingId),
    legacyPrestigeAuthorityAllowed: false
  };
}

export type ExecutiveReasoningProjectionV1 = ProjectionHeaderV1 & Readonly<{
  businessHealth: IntelligenceSnapshotV1["businessHealth"];
  kpis: readonly KpiSnapshotV1[];
  findings: readonly FindingSnapshotV1[];
  evidenceReferences: readonly EvidenceReferenceV1[];
  limitations: readonly SnapshotLimitationV1[];
  rawEvidenceIncluded: false;
}>;

export function projectExecutiveReasoningV1(snapshot: IntelligenceSnapshotV1): ExecutiveReasoningProjectionV1 {
  const kpis = snapshot.kpis.slice(0, INTELLIGENCE_SNAPSHOT_LIMITS.executiveReasoningKpis);
  const findings = snapshot.findings.slice(0, INTELLIGENCE_SNAPSHOT_LIMITS.executiveReasoningFindings);
  const evidenceIds = new Set([
    ...kpis.flatMap((kpi) => kpi.evidenceReferenceIds),
    ...findings.flatMap((finding) => finding.deterministicDependencies.evidenceReferenceIds)
  ]);
  return {
    ...header(snapshot),
    businessHealth: snapshot.businessHealth,
    kpis,
    findings,
    evidenceReferences: snapshot.evidence.references
      .filter((reference) => evidenceIds.has(reference.id))
      .slice(0, INTELLIGENCE_SNAPSHOT_LIMITS.executiveReasoningEvidenceReferences),
    limitations: snapshot.limitations.slice(0, INTELLIGENCE_SNAPSHOT_LIMITS.executiveReasoningLimitations),
    rawEvidenceIncluded: false
  };
}
