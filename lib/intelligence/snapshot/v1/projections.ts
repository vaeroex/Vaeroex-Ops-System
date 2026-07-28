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

export type BusinessHealthExplanationProjectionV1 = ProjectionHeaderV1 & Readonly<{
  businessHealth: IntelligenceSnapshotV1["businessHealth"];
  dataQuality: IntelligenceSnapshotV1["dataQuality"];
  driverFindingIds: readonly string[];
  evidenceReferenceIds: readonly string[];
  limitations: readonly SnapshotLimitationV1[];
}>;

export function projectBusinessHealthExplanationV1(snapshot: IntelligenceSnapshotV1): BusinessHealthExplanationProjectionV1 {
  const drivers = snapshot.findings.slice(0, 8);
  return {
    ...header(snapshot),
    businessHealth: snapshot.businessHealth,
    dataQuality: snapshot.dataQuality,
    driverFindingIds: drivers.map((finding) => finding.id),
    evidenceReferenceIds: [...new Set(drivers.flatMap((finding) => finding.deterministicDependencies.evidenceReferenceIds))].slice(0, 24),
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
