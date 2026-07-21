import "server-only";

import {
  EVIDENCE_CANDIDATE_VERSION,
  type EvidenceCandidate
} from "@/lib/ai/evidence-engine/contracts";
import { verifyEvidenceManifestCitations } from "@/lib/ai/evidence-engine/citation-verification";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { buildEvidenceManifest } from "@/lib/ai/evidence-engine/manifest";
import { buildSourceRegistry } from "@/lib/ai/evidence-engine/source-registry";
import {
  EXECUTIVE_BRIEF_CONTRACT_ID,
  EXECUTIVE_BRIEF_CONTRACT_VERSION,
  EXECUTIVE_BRIEF_VALIDATOR_VERSION,
  type ExecutiveBriefCitationView,
  type ExecutiveBriefConfidence,
  type ExecutiveBriefMaterialChange,
  type ExecutiveBriefPackage,
  type ExecutiveBriefSignal,
  type ExecutiveBriefSignalRole,
  type ExecutiveBriefSubmode
} from "@/lib/ai/executive-brief/contracts";
import type { ExecutiveHomepageModel } from "@/lib/intelligence/executive-homepage";
import type { IntelligenceEvidenceRecord, IntelligenceInsight, IntelligenceLayerResult } from "@/lib/intelligence/layer";

const MAX_SIGNALS = 5;
const MAX_RECORDS_PER_SIGNAL = 2;
const MAX_EVIDENCE_RECORDS = 10;
const STALE_AFTER_DAYS = 45;

type SelectedInsight = {
  stableKey: string;
  insight: IntelligenceInsight;
  roles: Set<ExecutiveBriefSignalRole>;
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

function stableInsightKey(insight: IntelligenceInsight) {
  return evidenceEngineHash({ fingerprint: insight.fingerprint || insight.id });
}

function signalClassification(insight: IntelligenceInsight): ExecutiveBriefSignal["classification"] {
  if (["Risk", "Bottleneck", "Anomaly"].includes(insight.type)) return "risk";
  if (insight.type === "Opportunity") return "opportunity";
  return "neutral";
}

function confidenceScore(confidence: IntelligenceInsight["confidence"]) {
  if (confidence === "High") return 90;
  if (confidence === "Medium") return 70;
  return 45;
}

function eligibleRecords(insight: IntelligenceInsight) {
  return [...insight.supportingRecords]
    .filter((record) => record.classification !== "Derived")
    .sort((left, right) => {
      const dateDelta = (safeDate(right.date) || "").localeCompare(safeDate(left.date) || "");
      return dateDelta || left.id.localeCompare(right.id);
    })
    .slice(0, MAX_RECORDS_PER_SIGNAL);
}

function candidateFromRecord({
  workspaceId,
  insight,
  record,
  baseRank
}: {
  workspaceId: string;
  insight: IntelligenceInsight;
  record: IntelligenceEvidenceRecord;
  baseRank: number;
}): EvidenceCandidate {
  const recordedAt = safeDate(record.date);
  const candidateId = `EB-${evidenceEngineHash({ recordId: record.id, sourceKey: record.sourceKey }).slice(0, 24)}`;
  const sourceKey = `executive-brief-source:${evidenceEngineHash(record.sourceKey)}`;

  return {
    version: EVIDENCE_CANDIDATE_VERSION,
    candidateId,
    workspaceId,
    domain: compactText(insight.affectedArea || record.groupHint || "Operations", 80),
    recordType: compactText(record.recordType, 80),
    title: compactText(record.title, 180),
    excerpt: compactText(`${record.value}. ${record.support}`, 720),
    summary: compactText(insight.summary, 360) || null,
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
      lineageVersion: "executive_brief_signal_lineage_v1"
    },
    eligibility: {
      eligible: true,
      lifecycleState: "active",
      originalEvidenceEligible: true,
      decisionVersion: "executive_brief_signal_eligibility_v1"
    },
    quality: record.classification === "Original" ? "high" : "medium",
    confidenceScore: confidenceScore(insight.confidence),
    retrieval: {
      mode: "structured",
      baseRank,
      score: null,
      embeddingVersion: null
    }
  };
}

function selectInsights(intelligence: IntelligenceLayerResult) {
  const selected = new Map<string, SelectedInsight>();
  const add = (insight: IntelligenceInsight | undefined, role: ExecutiveBriefSignalRole) => {
    if (!insight) return;
    const stableKey = stableInsightKey(insight);
    const current = selected.get(stableKey);
    if (current) {
      current.roles.add(role);
      return;
    }
    selected.set(stableKey, { stableKey, insight, roles: new Set([role]) });
  };

  add(intelligence.topRisk, "primary_concern");
  add(intelligence.topOpportunity, "positive_signal");
  add(intelligence.topRecommendation, "leadership_focus");
  for (const insight of intelligence.insights) {
    if (selected.size >= MAX_SIGNALS) break;
    if (insight.type === "Forecast" || !eligibleRecords(insight).length) continue;
    add(insight, "context");
  }
  return Array.from(selected.values()).slice(0, MAX_SIGNALS);
}

const COVERAGE_STOP_WORDS = new Set([
  "current", "business", "health", "requires", "review", "recorded", "latest", "period",
  "remained", "below", "above", "declined", "increased", "decreased", "improved", "weakened",
  "opportunity", "risk", "leadership", "evidence", "supported", "target"
]);

function coverageTerms(label: string, fact: string) {
  const metric = fact.match(/^(.+?)\s+(?:moved|remained|was|is|last reported|first observed|first observation)\b/i)?.[1]?.trim();
  const source = metric || label;
  return Array.from(new Set(
    source
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 4 && !COVERAGE_STOP_WORDS.has(term))
  )).slice(0, 4);
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

function confidenceCeiling(
  confidence: ExecutiveBriefConfidence,
  independentSourceCount: number
): ExecutiveBriefConfidence {
  if (independentSourceCount <= 1) return "Low";
  if (independentSourceCount === 2 && confidence === "High") return "Medium";
  return confidence;
}

function uniqueStrings(values: Array<string | null | undefined>, maximum = 6) {
  const normalized = values.map((value) => compactText(value, 280)).filter(Boolean);
  return normalized
    .filter((value, index) => normalized.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, maximum);
}

function selectSubmode({
  available,
  status,
  trajectory,
  stale,
  sparse,
  conflicting
}: {
  available: boolean;
  status: string;
  trajectory: string | null;
  stale: boolean;
  sparse: boolean;
  conflicting: boolean;
}): ExecutiveBriefSubmode {
  if (!available) return "insufficient_evidence";
  if (stale) return "evidence_stale";
  if (sparse) return "evidence_sparse";
  if (conflicting) return "conflicting_evidence";
  const normalizedStatus = status.toLowerCase();
  const normalizedTrajectory = (trajectory || "").toLowerCase();
  const improving = /improv|recover|up/.test(normalizedTrajectory);
  const worsening = /declin|worsen|slow|down/.test(normalizedTrajectory);
  if (normalizedStatus.includes("healthy") && improving) return "healthy_improving";
  if (normalizedStatus.includes("healthy") && worsening) return "healthy_slowing";
  if ((normalizedStatus.includes("watch") || normalizedStatus.includes("critical") || normalizedStatus.includes("risk")) && improving) {
    return "negative_recovering";
  }
  if ((normalizedStatus.includes("watch") || normalizedStatus.includes("critical") || normalizedStatus.includes("risk")) && worsening) {
    return "negative_worsening";
  }
  return "stable";
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

function materialChanges(homepage: ExecutiveHomepageModel): ExecutiveBriefMaterialChange[] {
  return homepage.changes.items.slice(0, 3).map((change) => ({
    stableKey: evidenceEngineHash({ id: change.id, title: change.title, detail: change.detail, tone: change.tone }),
    label: compactText(change.title, 180),
    fact: compactText(change.detail, 320),
    direction: change.tone
  }));
}

export function buildExecutiveBriefPackage({
  workspaceId,
  intelligence,
  homepage,
  sourceLabelsByKey = {},
  now = new Date()
}: {
  workspaceId: string;
  intelligence: IntelligenceLayerResult;
  homepage: ExecutiveHomepageModel;
  sourceLabelsByKey?: Readonly<Record<string, string>>;
  now?: Date;
}): ExecutiveBriefPackage {
  const selected = selectInsights(intelligence);
  const candidateSignalKeys = new Map<string, Set<string>>();
  const candidateById = new Map<string, EvidenceCandidate>();
  const sourceLabelByCandidateId = new Map<string, string>();

  for (const item of selected) {
    for (const record of eligibleRecords(item.insight)) {
      const candidate = candidateFromRecord({
        workspaceId,
        insight: item.insight,
        record,
        baseRank: candidateById.size + 1
      });
      if (!candidateById.has(candidate.candidateId) && candidateById.size >= MAX_EVIDENCE_RECORDS) continue;
      candidateById.set(candidate.candidateId, candidateById.get(candidate.candidateId) || candidate);
      sourceLabelByCandidateId.set(
        candidate.candidateId,
        compactText(sourceLabelsByKey[record.sourceKey] || record.title, 180)
      );
      const signalKeys = candidateSignalKeys.get(candidate.candidateId) || new Set<string>();
      signalKeys.add(item.stableKey);
      candidateSignalKeys.set(candidate.candidateId, signalKeys);
    }
  }

  const candidates = Array.from(candidateById.values());
  const sourceRegistry = buildSourceRegistry({ workspaceId, candidates });
  const manifest = buildEvidenceManifest({
    workspaceId,
    queryText: "Prepare the fixed Executive Brief from approved executive signals.",
    candidates,
    sourceRegistry,
    generatedAt: now.toISOString(),
    candidateRetrieverVersion: "executive_brief_structured_signal_retriever_v1",
    embeddingVersion: null,
    rerankerVersion: "deterministic_noop_reranker_v1",
    signalPlannerVersion: "executive_brief_signal_planner_v1"
  });
  const citationIdsBySignal = new Map<string, number[]>();
  for (const entry of manifest.evidence) {
    for (const signalKey of candidateSignalKeys.get(entry.candidateId) || []) {
      citationIdsBySignal.set(signalKey, [...(citationIdsBySignal.get(signalKey) || []), entry.citationId]);
    }
  }

  const signals: ExecutiveBriefSignal[] = selected
    .map((item) => {
      const fact = compactText(`${item.insight.summary} ${item.insight.why}`, 520);
      return {
        ordinal: 0,
        stableKey: item.stableKey,
        roles: Array.from(item.roles),
        classification: signalClassification(item.insight),
        domain: compactText(item.insight.affectedArea, 100),
        label: compactText(item.insight.title, 180),
        approvedFact: fact,
        approvedLeadershipFocus: item.roles.has("leadership_focus")
          ? compactText(item.insight.recommendedAction, 360) || null
          : null,
        coverageTerms: coverageTerms(item.insight.title, fact),
        citationIds: citationIdsBySignal.get(item.stableKey) || []
      } satisfies ExecutiveBriefSignal;
    })
    .filter((signal) => signal.citationIds.length > 0)
    .map((signal, index) => ({ ...signal, ordinal: index + 1 }));

  const primaryConcernOrdinal = signals.find((signal) => signal.roles.includes("primary_concern"))?.ordinal || null;
  const positiveSignalOrdinal = signals.find((signal) => signal.roles.includes("positive_signal"))?.ordinal || null;
  const leadershipFocusOrdinals = signals
    .filter((signal) => signal.roles.includes("leadership_focus"))
    .map((signal) => signal.ordinal)
    .slice(0, 2);
  const requiredSignalOrdinals = Array.from(new Set([
    primaryConcernOrdinal,
    positiveSignalOrdinal,
    ...leadershipFocusOrdinals,
    ...signals.slice(0, 1).map((signal) => signal.ordinal)
  ].filter((value): value is number => value !== null))).slice(0, 3);
  const requiredCitationIds = Array.from(new Set(
    signals
      .filter((signal) => requiredSignalOrdinals.includes(signal.ordinal))
      .flatMap((signal) => signal.citationIds)
  )).sort((left, right) => left - right);
  const citationVerification = verifyEvidenceManifestCitations({
    manifest,
    citationIds: requiredCitationIds,
    requiredCitationIds
  });
  if (!citationVerification.valid) {
    throw new Error("Executive Brief evidence citations could not be verified.");
  }

  const sourceEntries = new Map(sourceRegistry.entries.map((entry) => [entry.sourceOrdinal, entry]));
  const citations: ExecutiveBriefCitationView[] = manifest.evidence
    .filter((entry) => signals.some((signal) => signal.citationIds.includes(entry.citationId)))
    .map((entry) => ({
      citationId: entry.citationId,
      title: entry.title,
      sourceLabel: sourceLabelByCandidateId.get(entry.candidateId) || sourceLabelForCitation(entry.sourceOrdinal, sourceEntries).sourceLabel,
      sourceType: sourceLabelForCitation(entry.sourceOrdinal, sourceEntries).sourceType,
      excerpt: entry.excerpt,
      recordedAt: entry.recordedAt
    }));
  const freshness = evidenceFreshness(candidates, now);
  const independentSourceCount = sourceRegistry.independentOriginalSourceCount;
  const available = homepage.health.available && signals.length > 0 && requiredCitationIds.length > 0;
  const sparse = independentSourceCount <= 1 || signals.length < 2;
  const conflicting = selected.some((item) => item.insight.contradictoryEvidence.length > 0);
  const submode = selectSubmode({
    available,
    status: homepage.health.status,
    trajectory: homepage.health.trend,
    stale: freshness.stale,
    sparse,
    conflicting
  });
  const changes = materialChanges(homepage);
  const limitations = uniqueStrings([
    ...selected.map((item) => item.insight.limitation),
    ...selected.flatMap((item) => item.insight.missingEvidence),
    intelligence.dataQuality.reason,
    freshness.stale ? "The newest supporting evidence is older than 45 days." : null,
    sparse ? "The brief is supported by limited independent-source coverage." : null,
    conflicting ? "Some eligible signals conflict and should not be combined into one directional conclusion." : null,
    primaryConcernOrdinal === null ? "No evidence-backed primary concern is established." : null,
    positiveSignalOrdinal === null ? "No evidence-backed positive signal is established." : null
  ]);
  const confidence = confidenceCeiling(homepage.health.confidence, independentSourceCount);
  const primaryConcern = signals.find((signal) => signal.ordinal === primaryConcernOrdinal);
  const positiveSignal = signals.find((signal) => signal.ordinal === positiveSignalOrdinal);
  const leadershipSignal = signals.find((signal) => leadershipFocusOrdinals.includes(signal.ordinal));
  const deterministicReadout = uniqueStrings([
    homepage.health.summary,
    primaryConcern ? `Primary concern: ${primaryConcern.label}.` : "No evidence-backed primary concern currently stands out.",
    positiveSignal ? `Positive signal: ${positiveSignal.label}.` : null,
    leadershipSignal?.approvedLeadershipFocus
      ? `Leadership focus: ${leadershipSignal.approvedLeadershipFocus}`
      : "Leadership focus should remain on validating the highest-ranked eligible signals."
  ], 5);
  const facts = {
    available,
    businessHealth: {
      score: available ? homepage.health.score : null,
      status: available ? homepage.health.status : "Limited evidence",
      trajectory: available ? homepage.health.trend : null,
      comparisonDelta: homepage.health.trendDelta
    },
    materialChanges: changes,
    confidence,
    freshness: freshness.freshness,
    latestEvidenceAt: freshness.latestEvidenceAt,
    independentSourceCount,
    limitations,
    deterministicReadout
  } as const;
  const fingerprint = evidenceEngineHash({
    contractId: EXECUTIVE_BRIEF_CONTRACT_ID,
    contractVersion: EXECUTIVE_BRIEF_CONTRACT_VERSION,
    validatorVersion: EXECUTIVE_BRIEF_VALIDATOR_VERSION,
    submode,
    facts: {
      businessHealth: facts.businessHealth,
      materialChanges: facts.materialChanges,
      confidence: facts.confidence,
      freshness: facts.freshness,
      latestEvidenceAt: facts.latestEvidenceAt,
      limitations: facts.limitations
    },
    signals: signals
      .map((signal) => ({
        stableKey: signal.stableKey,
        roles: [...signal.roles].sort(),
        classification: signal.classification,
        domain: signal.domain,
        label: signal.label,
        approvedFact: signal.approvedFact,
        approvedLeadershipFocus: signal.approvedLeadershipFocus,
        coverageTerms: signal.coverageTerms
      }))
      .sort((left, right) => left.stableKey.localeCompare(right.stableKey)),
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
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
    requiredSignalStableKeys: signals
      .filter((signal) => requiredSignalOrdinals.includes(signal.ordinal))
      .map((signal) => signal.stableKey)
      .sort(),
    primaryConcernStableKey: primaryConcern?.stableKey || null,
    positiveSignalStableKey: positiveSignal?.stableKey || null,
    leadershipFocusStableKeys: signals
      .filter((signal) => leadershipFocusOrdinals.includes(signal.ordinal))
      .map((signal) => signal.stableKey)
      .sort(),
    permittedRelationships: [],
    permittedHypothesis: null
  });

  return {
    contractId: EXECUTIVE_BRIEF_CONTRACT_ID,
    contractVersion: EXECUTIVE_BRIEF_CONTRACT_VERSION,
    validatorVersion: EXECUTIVE_BRIEF_VALIDATOR_VERSION,
    fingerprint,
    submode,
    facts,
    signals,
    manifest,
    requiredSignalOrdinals,
    primaryConcernOrdinal,
    positiveSignalOrdinal,
    leadershipFocusOrdinals,
    permittedRelationships: [],
    permittedHypothesis: null,
    requiredCitationIds,
    citations
  };
}
