import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { INTELLIGENCE_SNAPSHOT_LIMITS } from "@/lib/intelligence/snapshot/v1/versions";
import type {
  ContextualEvidenceSnapshotV1,
  EvidenceReferenceV1,
  FindingSnapshotV1,
  IntelligenceSnapshotV1,
  KpiSnapshotV1,
  PrioritySnapshotV1,
  SnapshotLimitationV1,
  SnapshotState
} from "@/lib/intelligence/snapshot/v1/types";

const CONTEXT_STOP_WORDS = new Set([
  "about", "after", "again", "against", "been", "before", "business", "current", "during", "evidence",
  "finding", "from", "into", "leadership", "more", "note", "reported", "should", "that", "their", "these",
  "this", "those", "through", "under", "what", "when", "where", "which", "while", "with", "without"
]);

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

function contextTerms(value: string) {
  return new Set(value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 4 && !CONTEXT_STOP_WORDS.has(term)));
}

function contextualEvidenceText(record: ContextualEvidenceSnapshotV1) {
  return [
    record.title,
    record.summary,
    ...record.departments,
    ...record.topics,
    ...record.entities.flatMap((entity) => [entity.kind, entity.name]),
    ...record.statements.flatMap((statement) => [statement.kind, statement.text]),
    ...record.userAddedContext.flatMap((item) => [item.label, item.value])
  ].join(" ");
}

function compactContextText(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, Math.max(1, maximum - 3)).trim()}...`;
}

export type ProjectedContextualEvidenceV1 = Readonly<{
  contextRef: string;
  contextVersion: ContextualEvidenceSnapshotV1["contractVersion"];
  sourceVersion: number;
  sourceTextHash: string;
  validationState: ContextualEvidenceSnapshotV1["validationState"];
  title: string;
  summary: string;
  noteType: ContextualEvidenceSnapshotV1["noteType"];
  sourceClassification: ContextualEvidenceSnapshotV1["sourceClassification"];
  departments: readonly string[];
  topics: readonly string[];
  entities: readonly Readonly<{
    kind: ContextualEvidenceSnapshotV1["entities"][number]["kind"];
    name: string;
    sourceQuoteExcerpt: string;
  }>[];
  statements: readonly Readonly<{
    kind: ContextualEvidenceSnapshotV1["statements"][number]["kind"];
    text: string;
    sourceQuoteExcerpt: string;
    confidence: number;
  }>[];
  userAddedContext: ContextualEvidenceSnapshotV1["userAddedContext"];
  applicability: ContextualEvidenceSnapshotV1["applicability"];
  extractionConfidence: number;
  approvedAt: string;
  observedAt: string | null;
  provenance: ContextualEvidenceSnapshotV1["provenance"];
}>;

export type ContextualEvidenceAuthorityV1 = Readonly<{
  role: "supporting_context";
  deterministicIntelligenceWins: true;
  originalEvidenceEligible: false;
  automaticReconciliation: false;
}>;

const CONTEXTUAL_EVIDENCE_AUTHORITY_V1: ContextualEvidenceAuthorityV1 = {
  role: "supporting_context",
  deterministicIntelligenceWins: true,
  originalEvidenceEligible: false,
  automaticReconciliation: false
};

function projectRelevantContext(snapshot: IntelligenceSnapshotV1, subject: string) {
  const subjectTerms = contextTerms(subject);
  const scored = (snapshot.contextualEvidence || []).flatMap((record) => {
    const recordText = contextualEvidenceText(record);
    const recordTerms = contextTerms(recordText);
    const exactMatches = [...subjectTerms].filter((term) => recordTerms.has(term)).length;
    const relevance = exactMatches * 4;
    return relevance > 0 ? [{ record, relevance }] : [];
  }).sort((left, right) =>
    right.relevance - left.relevance
    || right.record.approvedAt.localeCompare(left.record.approvedAt)
    || left.record.id.localeCompare(right.record.id)
  );

  return scored.slice(0, INTELLIGENCE_SNAPSHOT_LIMITS.projectedContextRecords).map(({ record }) => ({
    contextRef: record.id,
    contextVersion: record.contractVersion,
    sourceVersion: record.sourceVersion,
    sourceTextHash: record.sourceTextHash,
    validationState: record.validationState,
    title: record.title,
    summary: compactContextText(record.summary, INTELLIGENCE_SNAPSHOT_LIMITS.projectedContextSummaryCharacters),
    noteType: record.noteType,
    sourceClassification: record.sourceClassification,
    departments: record.departments,
    topics: record.topics,
    entities: record.entities.slice(0, INTELLIGENCE_SNAPSHOT_LIMITS.projectedContextEntitiesPerRecord).map((entity) => ({
      kind: entity.kind,
      name: entity.name,
      sourceQuoteExcerpt: compactContextText(entity.sourceQuote, INTELLIGENCE_SNAPSHOT_LIMITS.projectedContextQuoteExcerptCharacters)
    })),
    statements: record.statements.slice(0, INTELLIGENCE_SNAPSHOT_LIMITS.projectedContextStatementsPerRecord).map((statement) => ({
      kind: statement.kind,
      text: compactContextText(statement.text, INTELLIGENCE_SNAPSHOT_LIMITS.projectedContextStatementCharacters),
      sourceQuoteExcerpt: compactContextText(statement.sourceQuote, INTELLIGENCE_SNAPSHOT_LIMITS.projectedContextQuoteExcerptCharacters),
      confidence: statement.confidence
    })),
    userAddedContext: record.userAddedContext,
    applicability: record.applicability,
    extractionConfidence: record.extractionConfidence,
    approvedAt: record.approvedAt,
    observedAt: record.observedAt,
    provenance: record.provenance
  })) satisfies ProjectedContextualEvidenceV1[];
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
  contextualEvidence: readonly ProjectedContextualEvidenceV1[];
  contextAuthority: ContextualEvidenceAuthorityV1;
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
  const contextualSubject = drivers.flatMap((driver) => [
    driver.finding.title,
    driver.finding.summary,
    driver.finding.why,
    driver.finding.impact,
    driver.finding.recommendedAction,
    driver.finding.affectedArea,
    driver.finding.timePeriod
  ]).join(" ");
  return {
    ...header(snapshot),
    businessHealth: snapshot.businessHealth,
    dataQuality: snapshot.dataQuality,
    drivers,
    priorities: snapshot.priorities,
    evidenceReferences,
    citations: snapshot.evidence.citations.filter((citation) => projectedEvidenceIds.has(citation.evidenceReferenceId)).slice(0, 24),
    limitations: snapshot.limitations.filter((limitation) => limitation.scope === "business_health" || limitation.scope === "data_quality"),
    contextualEvidence: projectRelevantContext(snapshot, contextualSubject),
    contextAuthority: CONTEXTUAL_EVIDENCE_AUTHORITY_V1
  };
}

export type FindingExplanationProjectionV1 = ProjectionHeaderV1 & Readonly<{
  finding: SnapshotState<FindingSnapshotV1>;
  evidenceReferences: readonly EvidenceReferenceV1[];
  contextualEvidence: readonly ProjectedContextualEvidenceV1[];
  contextAuthority: ContextualEvidenceAuthorityV1;
}>;

export function projectFindingExplanationV1(snapshot: IntelligenceSnapshotV1, findingId: string): FindingExplanationProjectionV1 {
  const finding = snapshot.findings.find((candidate) => candidate.id === findingId);
  if (!finding) {
    return {
      ...header(snapshot),
      finding: { state: "unavailable", reason: { code: "source_not_available" } },
      evidenceReferences: [],
      contextualEvidence: [],
      contextAuthority: CONTEXTUAL_EVIDENCE_AUTHORITY_V1
    };
  }
  const evidenceIds = new Set(finding.deterministicDependencies.evidenceReferenceIds);
  const contextualSubject = [
    finding.title,
    finding.summary,
    finding.why,
    finding.impact,
    finding.recommendedAction,
    finding.limitation,
    finding.affectedArea,
    finding.timePeriod
  ].join(" ");
  return {
    ...header(snapshot),
    finding: { state: "available", value: finding },
    evidenceReferences: snapshot.evidence.references.filter((reference) => evidenceIds.has(reference.id)).slice(0, 24),
    contextualEvidence: projectRelevantContext(snapshot, contextualSubject),
    contextAuthority: CONTEXTUAL_EVIDENCE_AUTHORITY_V1
  };
}
