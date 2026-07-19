import "server-only";

import {
  EVIDENCE_CANDIDATE_VERSION,
  type EvidenceCandidate
} from "@/lib/ai/evidence-engine/contracts";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { buildEvidenceManifest } from "@/lib/ai/evidence-engine/manifest";
import { buildSourceRegistry } from "@/lib/ai/evidence-engine/source-registry";
import { verifyEvidenceManifestCitations } from "@/lib/ai/evidence-engine/citation-verification";
import type {
  BusinessHealthCitationView,
  BusinessHealthConfidence,
  BusinessHealthExplanationDriver,
  BusinessHealthExplanationFacts,
  BusinessHealthExplanationPackage,
  BusinessHealthExplanationSubmode
} from "@/lib/ai/business-health-explanation/contracts";
import {
  BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
  BUSINESS_HEALTH_EXPLANATION_CONTRACT_VERSION,
  BUSINESS_HEALTH_EXPLANATION_VALIDATOR_VERSION
} from "@/lib/ai/business-health-explanation/contracts";
import type { BusinessHealthSnapshotRow } from "@/lib/intelligence/business-health-history";
import type { ExecutiveHomepageModel } from "@/lib/intelligence/executive-homepage";
import type { IntelligenceEvidenceRecord, IntelligenceInsight, IntelligenceLayerResult } from "@/lib/intelligence/layer";

const MAX_DRIVERS = 4;
const MAX_RECORDS_PER_DRIVER = 2;
const MAX_EVIDENCE_RECORDS = 8;
const STALE_AFTER_DAYS = 45;

type WeightedInsight = {
  insight: IntelligenceInsight;
  kind: "risk" | "opportunity";
  scoreImpact: number;
  stableKey: string;
};

function compactText(value: string | null | undefined, maximum: number) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  const shortened = normalized.slice(0, maximum + 1).replace(/\s+\S*$/, "").trim();
  return `${shortened || normalized.slice(0, maximum).trim()}...`;
}

function safeDate(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function confidenceScore(confidence: IntelligenceInsight["confidence"]) {
  if (confidence === "High") return 90;
  if (confidence === "Medium") return 70;
  return 45;
}

function confidenceCeiling(
  confidence: BusinessHealthConfidence,
  independentSourceCount: number
): BusinessHealthConfidence {
  if (!independentSourceCount) return "Low";
  if (independentSourceCount === 1 && confidence === "High") return "Medium";
  return confidence;
}

function weightedInsights(intelligence: IntelligenceLayerResult) {
  const riskKinds = new Set(["Risk", "Bottleneck", "Anomaly"]);
  const risks = intelligence.insights.filter((insight) => riskKinds.has(insight.type));
  const opportunities = intelligence.insights.filter((insight) => insight.type === "Opportunity");
  const weighted: WeightedInsight[] = [];
  let remainingRiskPenalty = 45;

  for (const insight of risks) {
    const rawPenalty = insight.priority === "High" ? 12 : insight.priority === "Medium" ? 6 : 0;
    const appliedPenalty = Math.min(rawPenalty, remainingRiskPenalty);
    remainingRiskPenalty -= appliedPenalty;
    if (!appliedPenalty) continue;
    weighted.push({
      insight,
      kind: "risk",
      scoreImpact: -appliedPenalty,
      stableKey: evidenceEngineHash({ kind: "risk", fingerprint: insight.fingerprint || insight.id })
    });
  }

  let remainingOpportunityAdjustment = 15;
  for (const insight of opportunities) {
    const appliedAdjustment = Math.min(4, remainingOpportunityAdjustment);
    remainingOpportunityAdjustment -= appliedAdjustment;
    if (!appliedAdjustment) continue;
    weighted.push({
      insight,
      kind: "opportunity",
      scoreImpact: appliedAdjustment,
      stableKey: evidenceEngineHash({ kind: "opportunity", fingerprint: insight.fingerprint || insight.id })
    });
  }

  return weighted;
}

function selectDrivers(weighted: WeightedInsight[]) {
  const ordered = [...weighted].sort((left, right) => {
    const weightDelta = Math.abs(right.scoreImpact) - Math.abs(left.scoreImpact);
    if (weightDelta) return weightDelta;
    return left.stableKey.localeCompare(right.stableKey);
  });
  const firstRisk = ordered.find((item) => item.kind === "risk");
  const firstOpportunity = ordered.find((item) => item.kind === "opportunity");
  const selected = [firstRisk, firstOpportunity, ...ordered]
    .filter((item): item is WeightedInsight => Boolean(item))
    .filter((item, index, items) => items.findIndex((candidate) => candidate.stableKey === item.stableKey) === index)
    .slice(0, MAX_DRIVERS);

  return selected;
}

function eligibleSupportingRecords(driver: WeightedInsight) {
  return [...driver.insight.supportingRecords]
    .filter((record) => record.classification !== "Derived")
    .sort((left, right) => {
      const dateDelta = (safeDate(right.date) || "").localeCompare(safeDate(left.date) || "");
      return dateDelta || left.id.localeCompare(right.id);
    })
    .slice(0, MAX_RECORDS_PER_DRIVER);
}

function candidateFromRecord({
  workspaceId,
  driver,
  record,
  baseRank
}: {
  workspaceId: string;
  driver: WeightedInsight;
  record: IntelligenceEvidenceRecord;
  baseRank: number;
}): EvidenceCandidate {
  const recordedAt = safeDate(record.date);
  const candidateId = `BHE-${evidenceEngineHash({ recordId: record.id, sourceKey: record.sourceKey }).slice(0, 24)}`;
  const sourceKey = `business-health-source:${evidenceEngineHash(record.sourceKey)}`;

  return {
    version: EVIDENCE_CANDIDATE_VERSION,
    candidateId,
    workspaceId,
    domain: compactText(driver.insight.affectedArea || record.groupHint || "Operations", 80),
    recordType: compactText(record.recordType, 80),
    title: compactText(record.title, 180),
    excerpt: compactText(`${record.value}. ${record.support}`, 780),
    summary: compactText(driver.insight.summary, 360) || null,
    evidenceRole: "original",
    source: {
      sourceType: compactText(record.recordType, 80),
      sourceId: null,
      sourceFileId: null,
      parentSourceId: null,
      canonicalSourceKey: sourceKey,
      independentSourceKey: sourceKey
    },
    provenance: {
      recordId: candidateId,
      indexedAt: recordedAt || "1970-01-01T00:00:00.000Z",
      recordedAt,
      lineageVersion: "business_health_driver_lineage_v1"
    },
    eligibility: {
      eligible: true,
      lifecycleState: "active",
      originalEvidenceEligible: true,
      decisionVersion: "business_health_driver_eligibility_v1"
    },
    quality: record.classification === "Original" ? "high" : "medium",
    confidenceScore: confidenceScore(driver.insight.confidence),
    retrieval: {
      mode: "structured",
      baseRank,
      score: null,
      embeddingVersion: null
    }
  };
}

function selectSubmode({
  available,
  status,
  trend,
  trendDelta,
  stale
}: {
  available: boolean;
  status: string;
  trend: string | null;
  trendDelta: number | null;
  stale: boolean;
}): BusinessHealthExplanationSubmode {
  if (!available) return "evidence_limited";
  if (stale) return "evidence_stale";
  const normalizedStatus = status.toLowerCase();
  const normalizedTrend = (trend || "").toLowerCase();
  const improving = normalizedTrend.includes("improving") || (trendDelta !== null && trendDelta > 0);
  const worsening = normalizedTrend.includes("declining") || (trendDelta !== null && trendDelta < 0);

  if (normalizedStatus.includes("healthy") && improving) return "healthy_improving";
  if (normalizedStatus.includes("healthy") && worsening) return "healthy_slowing";
  if ((normalizedStatus.includes("watch") || normalizedStatus.includes("critical")) && improving) return "watch_recovering";
  if (normalizedStatus.includes("critical") && worsening) return "at_risk_worsening";
  return "stable";
}

function evidenceFreshness(candidates: readonly EvidenceCandidate[], now: Date) {
  const latestEvidenceAt = candidates
    .map((candidate) => candidate.provenance.recordedAt || candidate.provenance.indexedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  if (!latestEvidenceAt) return { freshness: "unavailable" as const, latestEvidenceAt: null, stale: false };
  const ageDays = Math.floor((now.getTime() - Date.parse(latestEvidenceAt)) / 86_400_000);
  return {
    freshness: ageDays > STALE_AFTER_DAYS ? "stale" as const : "current" as const,
    latestEvidenceAt,
    stale: ageDays > STALE_AFTER_DAYS
  };
}

function uniqueStrings(values: Array<string | null | undefined>, maximum = 4) {
  const normalized = values
    .map((value) => compactText(value, 260))
    .filter(Boolean);
  return normalized.filter((value, index) => normalized.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index).slice(0, maximum);
}

function sourceLabelForCitation(
  sourceOrdinal: string,
  sourceEntries: Map<string, { title: string; sourceType: string }>
) {
  const source = sourceEntries.get(sourceOrdinal);
  return {
    sourceLabel: source?.title || "Eligible business evidence",
    sourceType: source?.sourceType || "Business evidence"
  };
}

export function buildBusinessHealthExplanationPackage({
  workspaceId,
  intelligence,
  homepage,
  snapshots,
  sourceLabelsByKey = {},
  now = new Date()
}: {
  workspaceId: string;
  intelligence: IntelligenceLayerResult;
  homepage: ExecutiveHomepageModel;
  snapshots: readonly BusinessHealthSnapshotRow[];
  sourceLabelsByKey?: Readonly<Record<string, string>>;
  now?: Date;
}): BusinessHealthExplanationPackage {
  const weighted = weightedInsights(intelligence);
  const selected = selectDrivers(weighted);
  const candidateDriverKeys = new Map<string, Set<string>>();
  const candidateById = new Map<string, EvidenceCandidate>();
  const sourceLabelByCandidateId = new Map<string, string>();
  for (const driver of selected) {
    for (const record of eligibleSupportingRecords(driver)) {
      const candidate = candidateFromRecord({
        workspaceId,
        driver,
        record,
        baseRank: candidateById.size + 1
      });
      if (!candidateById.has(candidate.candidateId) && candidateById.size >= MAX_EVIDENCE_RECORDS) continue;
      candidateById.set(candidate.candidateId, candidateById.get(candidate.candidateId) || candidate);
      sourceLabelByCandidateId.set(
        candidate.candidateId,
        compactText(sourceLabelsByKey[record.sourceKey] || record.title, 180)
      );
      const driverKeys = candidateDriverKeys.get(candidate.candidateId) || new Set<string>();
      driverKeys.add(driver.stableKey);
      candidateDriverKeys.set(candidate.candidateId, driverKeys);
    }
  }
  const candidates = Array.from(candidateById.values());
  const sourceRegistry = buildSourceRegistry({ workspaceId, candidates });
  const manifest = buildEvidenceManifest({
    workspaceId,
    queryText: "Explain the current deterministic Business Health score.",
    candidates,
    sourceRegistry,
    generatedAt: now.toISOString(),
    candidateRetrieverVersion: "business_health_structured_driver_retriever_v1",
    embeddingVersion: null,
    rerankerVersion: "deterministic_noop_reranker_v1",
    signalPlannerVersion: "business_health_driver_planner_v1"
  });
  const citationIdsByDriver = new Map<string, number[]>();
  for (const entry of manifest.evidence) {
    const driverKeys = candidateDriverKeys.get(entry.candidateId);
    if (!driverKeys) continue;
    for (const driverKey of driverKeys) {
      citationIdsByDriver.set(driverKey, [...(citationIdsByDriver.get(driverKey) || []), entry.citationId]);
    }
  }
  const drivers: BusinessHealthExplanationDriver[] = selected.map((driver) => ({
    kind: driver.kind,
    label: compactText(driver.insight.title, 180),
    fact: compactText(`${driver.insight.summary} ${driver.insight.why}`, 420),
    scoreImpact: driver.scoreImpact,
    citationIds: citationIdsByDriver.get(driver.stableKey) || [],
    limitation: compactText(driver.insight.limitation, 240) || null
  })).filter((driver) => driver.citationIds.length > 0);
  const requiredCitationIds = Array.from(new Set(drivers.flatMap((driver) => driver.citationIds))).sort((a, b) => a - b);
  const citationVerification = verifyEvidenceManifestCitations({
    manifest,
    citationIds: requiredCitationIds,
    requiredCitationIds
  });
  if (!citationVerification.valid) {
    throw new Error("Business Health evidence citations could not be verified.");
  }
  const sourceEntries = new Map(sourceRegistry.entries.map((entry) => [entry.sourceOrdinal, entry]));
  const citations: BusinessHealthCitationView[] = manifest.evidence
    .filter((entry) => requiredCitationIds.includes(entry.citationId))
    .map((entry) => ({
      citationId: entry.citationId,
      title: entry.title,
      sourceLabel: sourceLabelByCandidateId.get(entry.candidateId) || sourceLabelForCitation(entry.sourceOrdinal, sourceEntries).sourceLabel,
      sourceType: sourceLabelForCitation(entry.sourceOrdinal, sourceEntries).sourceType,
      excerpt: entry.excerpt,
      recordedAt: entry.recordedAt
    }));
  const freshness = evidenceFreshness(candidates, now);
  const available = homepage.health.available && drivers.length > 0 && requiredCitationIds.length > 0;
  const submode = selectSubmode({
    available,
    status: homepage.health.status,
    trend: homepage.health.trend,
    trendDelta: homepage.health.trendDelta,
    stale: freshness.stale
  });
  const riskPenalty = Math.abs(weighted.filter((item) => item.kind === "risk").reduce((sum, item) => sum + item.scoreImpact, 0));
  const opportunityAdjustment = weighted.filter((item) => item.kind === "opportunity").reduce((sum, item) => sum + item.scoreImpact, 0);
  const expectedScore = Math.max(10, Math.min(100, intelligence.dataQuality.score - riskPenalty + opportunityAdjustment));
  if (homepage.health.available && homepage.health.score !== expectedScore) {
    throw new Error("The Business Health explanation package does not match the authoritative score calculation.");
  }
  const independentSourceCount = new Set(
    sourceRegistry.entries
      .filter((entry) => entry.evidenceRole === "original")
      .map((entry) => entry.independentSourceKey)
      .filter(Boolean)
  ).size;
  const limitations = uniqueStrings([
    ...drivers.map((driver) => driver.limitation),
    intelligence.dataQuality.reason,
    freshness.stale ? "The newest supporting evidence is older than 45 days." : null,
    snapshots.length < 2 ? "A reliable score trajectory requires at least two stored Business Health reviews." : null
  ]);
  const comparison = homepage.health.trendDelta === null
    ? "No valid previous review is available for comparison."
    : `${homepage.health.trendDelta > 0 ? "Up" : homepage.health.trendDelta < 0 ? "Down" : "Unchanged"} ${Math.abs(homepage.health.trendDelta)} point${Math.abs(homepage.health.trendDelta) === 1 ? "" : "s"} since the previous stored review.`;
  const facts: BusinessHealthExplanationFacts = {
    available,
    score: available ? homepage.health.score : null,
    status: available ? homepage.health.status : "Limited evidence",
    trajectory: available ? homepage.health.trend : null,
    comparison,
    comparisonDelta: homepage.health.trendDelta,
    dataQualityBase: intelligence.dataQuality.score,
    riskPenalty,
    opportunityAdjustment,
    confidence: confidenceCeiling(homepage.health.confidence, independentSourceCount),
    freshness: freshness.freshness,
    latestEvidenceAt: freshness.latestEvidenceAt,
    deterministicSummary: homepage.health.summary,
    drivers,
    limitations
  };
  const fingerprint = evidenceEngineHash({
    contractId: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
    contractVersion: BUSINESS_HEALTH_EXPLANATION_CONTRACT_VERSION,
    validatorVersion: BUSINESS_HEALTH_EXPLANATION_VALIDATOR_VERSION,
    submode,
    facts: {
      score: facts.score,
      status: facts.status,
      trajectory: facts.trajectory,
      comparisonDelta: facts.comparisonDelta,
      dataQualityBase: facts.dataQualityBase,
      riskPenalty: facts.riskPenalty,
      opportunityAdjustment: facts.opportunityAdjustment,
      confidence: facts.confidence,
      freshness: facts.freshness,
      latestEvidenceAt: facts.latestEvidenceAt,
      drivers: selected
        .filter((driver) => citationIdsByDriver.get(driver.stableKey)?.length)
        .map((driver) => ({
          stableKey: driver.stableKey,
          kind: driver.kind,
          label: compactText(driver.insight.title, 180),
          fact: compactText(`${driver.insight.summary} ${driver.insight.why}`, 420),
          scoreImpact: driver.scoreImpact,
          limitation: compactText(driver.insight.limitation, 240) || null
        }))
    },
    evidence: candidates
      .map((candidate) => ({
        candidateId: candidate.candidateId,
        title: candidate.title,
        excerpt: candidate.excerpt,
        sourceLabel: sourceLabelByCandidateId.get(candidate.candidateId) || candidate.title,
        sourceType: candidate.source.sourceType,
        canonicalSourceKey: candidate.source.canonicalSourceKey,
        independentSourceKey: candidate.source.independentSourceKey,
        recordedAt: candidate.provenance.recordedAt,
        lineageVersion: candidate.provenance.lineageVersion,
        evidenceRole: candidate.evidenceRole,
        originalEvidenceEligible: candidate.eligibility.originalEvidenceEligible,
        lifecycleState: candidate.eligibility.lifecycleState,
        eligibilityDecisionVersion: candidate.eligibility.decisionVersion
      }))
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
  });

  return {
    contractId: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
    contractVersion: BUSINESS_HEALTH_EXPLANATION_CONTRACT_VERSION,
    validatorVersion: BUSINESS_HEALTH_EXPLANATION_VALIDATOR_VERSION,
    fingerprint,
    submode,
    facts,
    manifest,
    requiredCitationIds,
    citations,
    hypothesisAllowed: false
  };
}
