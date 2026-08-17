import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import type { EvidenceManifest } from "@/lib/ai/evidence-engine/contracts";
import { intelligenceBriefingKpiEvidenceKey } from "@/lib/ai/intelligence-briefing/identity";
import {
  INTELLIGENCE_BRIEFING_CONTRACT_ID,
  INTELLIGENCE_BRIEFING_CONTRACT_VERSION,
  INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION,
  INTELLIGENCE_BRIEFING_MATERIALITY_VERSION,
  INTELLIGENCE_BRIEFING_PROMPT_VERSION,
  INTELLIGENCE_BRIEFING_SCHEMA_VERSION,
  INTELLIGENCE_BRIEFING_SECTION_IDS,
  INTELLIGENCE_BRIEFING_SECTION_LABELS,
  INTELLIGENCE_BRIEFING_VALIDATOR_VERSION,
  type IntelligenceBriefingCitation,
  type IntelligenceBriefingConfidence,
  type IntelligenceBriefingContextReference,
  type IntelligenceBriefingEvidencePeriod,
  type IntelligenceBriefingFreshness,
  type IntelligenceBriefingPackage,
  type IntelligenceBriefingSectionId,
  type IntelligenceBriefingSignal,
  type IntelligenceBriefingType
} from "@/lib/ai/intelligence-briefing/contracts";
import { dateFallsInBriefingPeriod } from "@/lib/ai/intelligence-briefing/period";
import type { IntelligenceSnapshotV1, KpiSnapshotV1, SnapshotState } from "@/lib/intelligence/snapshot/v1/types";

const MAX_KPI_SIGNALS = 12;
const MAX_FINDING_SIGNALS = 12;
const MAX_CONTEXT_SIGNALS = 6;
const MAX_LIMITATIONS = 12;

const SECTION_TERMS: ReadonlyArray<Readonly<{ id: IntelligenceBriefingSectionId; terms: readonly string[] }>> = [
  { id: "quality_risk_compliance", terms: ["quality", "risk", "compliance", "safety", "incident", "issue", "anomaly", "defect"] },
  { id: "workforce_organizational_performance", terms: ["workforce", "staff", "employee", "people", "labor", "capacity", "organization", "team"] },
  { id: "customers_market", terms: ["customer", "client", "retention", "satisfaction", "market", "conversion", "support", "account"] },
  { id: "financial_performance", terms: ["margin", "profit", "cost", "expense", "cash", "budget", "financial", "payroll", "loss"] },
  { id: "revenue_growth", terms: ["revenue", "sales", "growth", "funding", "pipeline", "booking", "income", "arr", "mrr"] },
  { id: "operations_delivery", terms: ["operation", "delivery", "service", "volume", "store", "process", "utilization", "inventory", "fulfillment"] }
];

const COVERAGE_LABELS: Record<string, string> = {
  revenue: "Revenue",
  financials: "Financials",
  operations: "Operations",
  customers: "Customers",
  sales_pipeline: "Customer Revenue Context",
  processes: "Processes",
  staffing: "Staffing",
  issues_risks: "Issues and Risks",
  historical_trends: "Historical Trends",
  business_memory: "Business Memory"
};

function compact(value: string | null | undefined, maximum: number) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, Math.max(1, maximum - 3)).trim()}...`;
}

function unique(values: readonly (string | null | undefined)[], maximum = Number.POSITIVE_INFINITY) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const text = compact(value, 360);
    const key = text.toLowerCase();
    if (!text || seen.has(key) || seen.size >= maximum) return [];
    seen.add(key);
    return [text];
  });
}

export function intelligenceBriefingSectionForDomain(value: string): IntelligenceBriefingSectionId {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return SECTION_TERMS.find((section) => section.terms.some((term) => normalized.includes(term)))?.id || "operations_delivery";
}

function availableValue<T>(state: SnapshotState<T>) {
  return state.state === "available" ? state.value : null;
}

function targetText(target: KpiSnapshotV1["effectiveAuthoritativeTarget"]) {
  const value = availableValue(target);
  if (!value) return "no authoritative target is configured";
  if (value.kind === "scalar") return `the authoritative target is ${value.value}`;
  if (value.kind === "range") return `the authoritative range is ${value.min} to ${value.max}`;
  return "no authoritative target is configured";
}

function confidenceCeiling(
  confidence: IntelligenceBriefingConfidence,
  independentSourceCount: number,
  limited: boolean
): IntelligenceBriefingConfidence {
  if (independentSourceCount <= 1) return "Low";
  if (limited && confidence === "High") return "Medium";
  return confidence;
}

function signalConfidence(value: string): IntelligenceBriefingConfidence {
  return value === "High" || value === "Medium" ? value : "Low";
}

function latestEvidenceState(manifest: EvidenceManifest, period: IntelligenceBriefingEvidencePeriod) {
  const latestEvidenceAt = manifest.evidence
    .map((entry) => entry.recordedAt || entry.indexedAt)
    .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) || null;
  if (!latestEvidenceAt) return { latestEvidenceAt: null, freshness: "unavailable" as const };
  return {
    latestEvidenceAt,
    freshness: dateFallsInBriefingPeriod(latestEvidenceAt, period) ? "current" as const : "stale" as const
  };
}

function contextApplies(record: NonNullable<IntelligenceSnapshotV1["contextualEvidence"]>[number], period: IntelligenceBriefingEvidencePeriod) {
  if (record.applicability.temporalStatus === "upcoming") return false;
  if (dateFallsInBriefingPeriod(record.observedAt, period) || dateFallsInBriefingPeriod(record.approvedAt, period)) return true;
  if (record.applicability.start && record.applicability.start > period.end) return false;
  if (record.applicability.end && record.applicability.end < period.start) return false;
  return record.applicability.temporalStatus === "applicable" && Boolean(record.applicability.start || record.applicability.end);
}

function candidateIdsForCitations(citationIds: readonly number[], manifest: EvidenceManifest) {
  const selected = new Set(citationIds);
  return manifest.evidence.filter((entry) => selected.has(entry.citationId)).map((entry) => entry.candidateId);
}

function sectionDomainForCitations(citationIds: readonly number[], manifest: EvidenceManifest, fallback: string) {
  const selected = new Set(citationIds);
  const domain = manifest.evidence.find((entry) => selected.has(entry.citationId))?.domain || fallback;
  return intelligenceBriefingSectionForDomain(domain);
}

function kpiSignals({
  snapshot,
  period,
  manifest,
  citationIdsByMetric
}: {
  snapshot: IntelligenceSnapshotV1;
  period: IntelligenceBriefingEvidencePeriod;
  manifest: EvidenceManifest;
  citationIdsByMetric: ReadonlyMap<string, readonly number[]>;
}) {
  const signals: IntelligenceBriefingSignal[] = [];
  for (const kpi of snapshot.kpis) {
    if (signals.length >= MAX_KPI_SIGNALS) break;
    const semantics = availableValue(kpi.semantics);
    const performance = availableValue(kpi.performance);
    const current = kpi.observations.current;
    if (!semantics || semantics.desiredDirection === "unknown" || kpi.identity.metricRole !== "actual" || !performance || !current) continue;
    if (!dateFallsInBriefingPeriod(current.observedAt, period)) continue;
    const citationIds = citationIdsByMetric.get(intelligenceBriefingKpiEvidenceKey(kpi.identity)) || [];
    if (!citationIds.length) continue;
    const unit = kpi.identity.unit ? ` ${kpi.identity.unit}` : "";
    const fact = [
      `${kpi.identity.displayName} was ${current.value}${unit} on ${current.observedAt.slice(0, 10)}.`,
      `The deterministic period evaluation classifies movement as ${performance.rawMovement}, performance as ${performance.latestPerformanceEffect}, and target status as ${performance.targetStatus}; ${targetText(kpi.effectiveAuthoritativeTarget)}.`
    ].join(" ");
    const sectionId = sectionDomainForCitations(citationIds, manifest, kpi.identity.canonicalName);
    const stableKey = evidenceEngineHash({
      kind: "kpi",
      identity: kpi.identity,
      desiredDirection: semantics.desiredDirection,
      targetBehavior: semantics.targetBehavior,
      target: kpi.effectiveAuthoritativeTarget,
      current: { value: current.value, observedAt: current.observedAt },
      previous: kpi.observations.previous
        ? { value: kpi.observations.previous.value, observedAt: kpi.observations.previous.observedAt }
        : null,
      rawMovement: performance.rawMovement,
      performanceEffect: performance.latestPerformanceEffect,
      selectedRangeTrend: performance.selectedRangeTrend,
      targetStatus: performance.targetStatus,
      freshness: kpi.freshness
    });
    signals.push({
      ref: `K${signals.length + 1}`,
      stableKey,
      kind: "kpi",
      authority: "measured_evidence",
      sectionId,
      label: kpi.identity.displayName,
      fact,
      confidence: signalConfidence(semantics.classificationConfidence !== null && semantics.classificationConfidence >= 0.85 ? "High" : "Medium"),
      citationIds,
      evidenceReferenceIds: kpi.evidenceReferenceIds,
      limitation: kpi.freshness.state === "available" && kpi.freshness.value.status !== "current"
        ? "The latest KPI observation is not current under the canonical freshness policy."
        : null,
      periodRelation: kpi.observations.previous ? "new_or_changed" : "current_state",
      semanticState: {
        desiredDirection: semantics.desiredDirection,
        targetStatus: performance.targetStatus,
        performanceEffect: performance.latestPerformanceEffect,
        metricRole: kpi.identity.metricRole
      }
    });
  }
  return signals;
}

function findingSignals({
  snapshot,
  period,
  manifest,
  citationIdsByFinding
}: {
  snapshot: IntelligenceSnapshotV1;
  period: IntelligenceBriefingEvidencePeriod;
  manifest: EvidenceManifest;
  citationIdsByFinding: ReadonlyMap<string, readonly number[]>;
}) {
  const priority = { High: 0, Medium: 1, Low: 2 } as const;
  return [...snapshot.findings]
    .sort((left, right) => priority[left.priority] - priority[right.priority] || right.lastUpdated.localeCompare(left.lastUpdated) || left.fingerprint.localeCompare(right.fingerprint))
    .flatMap((finding) => {
      const citationIds = citationIdsByFinding.get(finding.id) || [];
      if (!citationIds.length) return [];
      const sectionId = sectionDomainForCitations(citationIds, manifest, finding.affectedArea);
      const stableKey = evidenceEngineHash({
        kind: "finding",
        fingerprint: finding.fingerprint,
        type: finding.type,
        priority: finding.priority,
        confidence: finding.confidence,
        dependencies: finding.deterministicDependencies
      });
      return [{
        ref: "",
        stableKey,
        kind: "finding",
        authority: "deterministic_result",
        sectionId,
        label: finding.title,
        fact: compact(`${finding.summary} ${finding.why} ${finding.impact}`, 760),
        confidence: signalConfidence(finding.confidence),
        citationIds,
        evidenceReferenceIds: candidateIdsForCitations(citationIds, manifest).map((candidateId) => `manifest:${manifest.manifestId}:${candidateId}`),
        limitation: compact(finding.limitation, 320) || null,
        periodRelation: dateFallsInBriefingPeriod(finding.lastUpdated, period) ? "new_or_changed" : "continuing"
      } satisfies IntelligenceBriefingSignal];
    })
    .slice(0, MAX_FINDING_SIGNALS)
    .map((signal, index) => ({ ...signal, ref: `F${index + 1}` }));
}

function contextSignals(snapshot: IntelligenceSnapshotV1, period: IntelligenceBriefingEvidencePeriod) {
  const selected = (snapshot.contextualEvidence || [])
    .filter((record) => contextApplies(record, period))
    .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt) || left.id.localeCompare(right.id))
    .slice(0, MAX_CONTEXT_SIGNALS);
  const references: IntelligenceBriefingContextReference[] = selected.map((record, index) => ({
    ref: `C${index + 1}`,
    sourceNoteId: record.sourceNoteId,
    sourceVersion: record.sourceVersion,
    title: record.title,
    summary: compact(record.summary, 420),
    approvedAt: record.approvedAt,
    observedAt: record.observedAt,
    applicabilityStart: record.applicability.start,
    applicabilityEnd: record.applicability.end
  }));
  const signals: IntelligenceBriefingSignal[] = selected.map((record, index) => ({
    ref: `C${index + 1}`,
    stableKey: evidenceEngineHash({ sourceNoteId: record.sourceNoteId, sourceVersion: record.sourceVersion, sourceTextHash: record.sourceTextHash }),
    kind: "reported_context",
    authority: "reported_context",
    sectionId: "business_updates_context",
    label: record.title,
    fact: `An approved Business Note reports: ${compact(record.summary, 520)} This reported context does not establish causation or override measured evidence.`,
    confidence: signalConfidence(record.extractionConfidence >= 0.85 ? "High" : record.extractionConfidence >= 0.65 ? "Medium" : "Low"),
    citationIds: [],
    evidenceReferenceIds: [],
    limitation: "Business Notes are approved reported context, not independently measured proof.",
    periodRelation: "reported_context"
  }));
  return { signals, references };
}

function businessHealthSignal(snapshot: IntelligenceSnapshotV1, findingSignalsInput: readonly IntelligenceBriefingSignal[]) {
  const health = availableValue(snapshot.businessHealth);
  if (!health) return null;
  const citationIds = [...new Set(findingSignalsInput.slice(0, 4).flatMap((signal) => signal.citationIds))].sort((a, b) => a - b);
  if (!citationIds.length) return null;
  return {
    ref: "BH",
    stableKey: evidenceEngineHash({ score: health.score, status: health.status, trajectory: health.trajectory, confidence: health.confidence, components: health.components }),
    kind: "business_health",
    authority: "deterministic_result",
    sectionId: null,
    label: "Business Health",
    fact: `Business Health is ${health.score} out of 100, with status ${health.status}, trajectory ${health.trajectory}, and ${health.confidence} deterministic confidence.`,
    confidence: signalConfidence(health.confidence),
    citationIds,
    evidenceReferenceIds: findingSignalsInput.slice(0, 4).flatMap((signal) => signal.evidenceReferenceIds),
    limitation: null,
    periodRelation: "current_state"
  } satisfies IntelligenceBriefingSignal;
}

function citations({
  manifest,
  hrefByCandidateId,
  sourceLabelByCandidateId
}: {
  manifest: EvidenceManifest;
  hrefByCandidateId: ReadonlyMap<string, `/app/${string}`>;
  sourceLabelByCandidateId: ReadonlyMap<string, string>;
}) {
  const sourceByOrdinal = new Map(manifest.sourceRegistry.entries.map((entry) => [entry.sourceOrdinal, entry]));
  return manifest.evidence.map((entry) => {
    const source = sourceByOrdinal.get(entry.sourceOrdinal);
    return {
      citationId: entry.citationId,
      title: entry.title,
      sourceLabel: sourceLabelByCandidateId.get(entry.candidateId) || source?.title || "Eligible business evidence",
      sourceType: source?.sourceType || "Business evidence",
      excerpt: entry.excerpt,
      recordedAt: entry.recordedAt,
      href: hrefByCandidateId.get(entry.candidateId) || "/app/sources"
    } satisfies IntelligenceBriefingCitation;
  });
}

export function projectIntelligenceBriefingV1({
  snapshot,
  briefingType,
  period,
  manifest,
  citationIdsByMetric,
  citationIdsByFinding,
  hrefByCandidateId,
  sourceLabelByCandidateId,
  previousBriefing = null
}: {
  snapshot: IntelligenceSnapshotV1;
  briefingType: IntelligenceBriefingType;
  period: IntelligenceBriefingEvidencePeriod;
  manifest: EvidenceManifest;
  citationIdsByMetric: ReadonlyMap<string, readonly number[]>;
  citationIdsByFinding: ReadonlyMap<string, readonly number[]>;
  hrefByCandidateId: ReadonlyMap<string, `/app/${string}`>;
  sourceLabelByCandidateId: ReadonlyMap<string, string>;
  previousBriefing?: IntelligenceBriefingPackage["previousBriefing"];
}): IntelligenceBriefingPackage {
  if (manifest.workspaceId !== snapshot.scope.workspaceId) throw new Error("Intelligence briefing manifest belongs to another workspace.");
  if (snapshot.scope.asOf !== period.cutoff) throw new Error("Intelligence briefing period cutoff must match the canonical snapshot as-of time.");
  const kpis = kpiSignals({ snapshot, period, manifest, citationIdsByMetric });
  const findings = findingSignals({ snapshot, period, manifest, citationIdsByFinding });
  const context = contextSignals(snapshot, period);
  const health = businessHealthSignal(snapshot, findings);
  const measuredSignals = [...kpis, ...findings];
  const allSignals = [...(health ? [health] : []), ...measuredSignals, ...context.signals];
  const sectionSignals = [...measuredSignals, ...context.signals];
  const sections = INTELLIGENCE_BRIEFING_SECTION_IDS.flatMap((id) => {
    const signalRefs = sectionSignals.filter((signal) => signal.sectionId === id).map((signal) => signal.ref);
    return signalRefs.length ? [{ id, label: INTELLIGENCE_BRIEFING_SECTION_LABELS[id], signalRefs }] : [];
  });
  const originalEvidenceCount = manifest.evidence.filter((entry) => entry.originalEvidenceEligible && entry.evidenceRole === "original").length;
  const independentSourceCount = manifest.sourceRegistry.independentOriginalSourceCount;
  const coverage = availableValue(snapshot.readiness.coverage);
  const sufficientCoverageLabels = new Set(["Good", "Strong", "High Confidence"]);
  const eligibility = originalEvidenceCount === 0 || measuredSignals.length === 0
    ? "no_eligible_evidence" as const
    : independentSourceCount >= 2 && coverage && sufficientCoverageLabels.has(coverage.overallConfidenceLabel)
      ? "sufficient" as const
      : "limited" as const;
  const baseConfidence = health?.confidence || signalConfidence(availableValue(snapshot.dataQuality)?.confidence || "Low");
  const confidence = confidenceCeiling(baseConfidence, independentSourceCount, eligibility !== "sufficient");
  const latest = latestEvidenceState(manifest, period);
  const includedDomains = sections.map((section) => section.label);
  const weakCoverageLabels = new Set(["Very Limited", "Learning", "Partial"]);
  const missingOrWeakDomains = coverage
    ? coverage.categories.filter((category) => weakCoverageLabels.has(category.confidenceLabel)).map((category) => COVERAGE_LABELS[category.id] || category.id)
    : ["Intelligence coverage is unavailable"];
  const limitationTexts = unique([
    ...snapshot.limitations.map((limitation) => limitation.message),
    ...allSignals.map((signal) => signal.limitation),
    eligibility === "limited" ? "This briefing is supported by limited eligible evidence and may omit parts of the business." : null,
    latest.freshness === "stale" ? "The newest supporting evidence is stale under the canonical freshness policy." : null,
    ...missingOrWeakDomains.map((domain) => `${domain} has limited evidence coverage.`)
  ], MAX_LIMITATIONS);
  const limitations = limitationTexts.map((text, index) => ({ ref: `L${index + 1}`, text }));
  const requiredSignalRefs = [...new Set([
    health?.ref,
    findings[0]?.ref,
    kpis[0]?.ref,
    context.signals[0]?.ref
  ].filter((value): value is string => Boolean(value)))].slice(0, 5);
  const evidenceFingerprint = evidenceEngineHash({
    workspaceId: snapshot.scope.workspaceId,
    briefingType,
    period,
    snapshotContract: snapshot.contract,
    snapshotVersions: snapshot.versions,
    manifestId: manifest.manifestId,
    signals: allSignals,
    eligibility,
    promptVersion: INTELLIGENCE_BRIEFING_PROMPT_VERSION,
    schemaVersion: INTELLIGENCE_BRIEFING_SCHEMA_VERSION,
    materialityVersion: INTELLIGENCE_BRIEFING_MATERIALITY_VERSION
  });
  const effectiveEvidenceFingerprint = evidenceEngineHash({
    workspaceId: snapshot.scope.workspaceId,
    briefingType,
    snapshotContract: snapshot.contract,
    snapshotVersions: snapshot.versions,
    manifestId: manifest.manifestId,
    signalFacts: allSignals.map((signal) => ({ ref: signal.ref, stableKey: signal.stableKey, fact: signal.fact, citationIds: signal.citationIds })),
    eligibility,
    context: context.references.map((record) => ({ sourceNoteId: record.sourceNoteId, sourceVersion: record.sourceVersion })),
    promptVersion: INTELLIGENCE_BRIEFING_PROMPT_VERSION,
    schemaVersion: INTELLIGENCE_BRIEFING_SCHEMA_VERSION
  });
  const materialStateFingerprint = evidenceEngineHash({
    workspaceId: snapshot.scope.workspaceId,
    briefingType,
    snapshotContractVersion: snapshot.contract.version,
    businessHealth: health?.stableKey || null,
    signalKeys: allSignals.map((signal) => signal.stableKey).sort(),
    sectionIds: sections.map((section) => section.id),
    confidence,
    freshness: latest.freshness,
    coverageLabel: coverage?.overallConfidenceLabel || "Unavailable",
    includedDomains,
    missingOrWeakDomains,
    promptVersion: INTELLIGENCE_BRIEFING_PROMPT_VERSION,
    schemaVersion: INTELLIGENCE_BRIEFING_SCHEMA_VERSION,
    materialityVersion: INTELLIGENCE_BRIEFING_MATERIALITY_VERSION
  });
  const generationKey = evidenceEngineHash({
    workspaceId: snapshot.scope.workspaceId,
    briefingType,
    materialStateFingerprint,
    promptVersion: INTELLIGENCE_BRIEFING_PROMPT_VERSION,
    schemaVersion: INTELLIGENCE_BRIEFING_SCHEMA_VERSION,
    validatorVersion: INTELLIGENCE_BRIEFING_VALIDATOR_VERSION,
    generationPolicyVersion: INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION
  });
  const trustBinding = {
    version: "trust_projection_binding_v1" as const,
    snapshotFingerprint: snapshot.fingerprints.snapshot,
    projectionFingerprint: evidenceEngineHash({ briefingType, allSignals, sections, limitations, evidenceFingerprint }),
    projectionAsOf: snapshot.scope.asOf
  };
  const healthValue = availableValue(snapshot.businessHealth);

  return {
    contractId: INTELLIGENCE_BRIEFING_CONTRACT_ID,
    contractVersion: INTELLIGENCE_BRIEFING_CONTRACT_VERSION,
    schemaVersion: INTELLIGENCE_BRIEFING_SCHEMA_VERSION,
    validatorVersion: INTELLIGENCE_BRIEFING_VALIDATOR_VERSION,
    promptVersion: INTELLIGENCE_BRIEFING_PROMPT_VERSION,
    generationPolicyVersion: INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION,
    materialityVersion: INTELLIGENCE_BRIEFING_MATERIALITY_VERSION,
    workspaceId: snapshot.scope.workspaceId,
    briefingType,
    period,
    eligibility,
    confidence,
    evidenceCoverage: {
      supportingRecordCount: originalEvidenceCount,
      independentSourceCount,
      freshness: latest.freshness as IntelligenceBriefingFreshness,
      latestEvidenceAt: latest.latestEvidenceAt,
      overallCoverage: coverage?.overallCoverage ?? null,
      coverageLabel: coverage?.overallConfidenceLabel || "Unavailable",
      includedDomains,
      missingOrWeakDomains: unique(missingOrWeakDomains)
    },
    evidenceFingerprint,
    effectiveEvidenceFingerprint,
    materialStateFingerprint,
    generationKey,
    snapshotFingerprint: snapshot.fingerprints.snapshot,
    businessHealth: {
      available: Boolean(healthValue),
      score: healthValue?.score ?? null,
      status: healthValue?.status || "Insufficient Data",
      trajectory: healthValue?.trajectory || null,
      confidence: signalConfidence(healthValue?.confidence || "Low")
    },
    signals: allSignals,
    sections,
    contextReferences: context.references,
    limitations,
    manifest,
    citations: citations({ manifest, hrefByCandidateId, sourceLabelByCandidateId }),
    requiredSignalRefs,
    previousBriefing,
    trustBinding
  };
}
