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
  FINDING_EXPLANATION_CONTRACT_ID,
  FINDING_EXPLANATION_CONTRACT_VERSION,
  FINDING_EXPLANATION_VALIDATOR_VERSION,
  type FindingExplanationCitationView,
  type FindingExplanationPackage
} from "@/lib/ai/finding-explanation/contracts";
import type { IntelligenceEvidenceRecord, IntelligenceInsight } from "@/lib/intelligence/layer";

const MAX_EVIDENCE_RECORDS = 8;
const STALE_AFTER_DAYS = 45;

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

function eligibleRecords(insight: IntelligenceInsight) {
  return [...insight.supportingRecords]
    .filter((record) => record.classification !== "Derived")
    .sort((left, right) => {
      const dateDelta = (safeDate(right.date) || "").localeCompare(safeDate(left.date) || "");
      return dateDelta || left.id.localeCompare(right.id);
    })
    .slice(0, MAX_EVIDENCE_RECORDS);
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
  const candidateId = `FE-${evidenceEngineHash({ recordId: record.id, sourceKey: record.sourceKey }).slice(0, 24)}`;
  const sourceKey = `finding-explanation-source:${evidenceEngineHash(record.sourceKey)}`;
  return {
    version: EVIDENCE_CANDIDATE_VERSION,
    candidateId,
    workspaceId,
    domain: compactText(insight.affectedArea || record.groupHint || "Operations", 80),
    recordType: compactText(record.recordType, 80),
    title: compactText(record.title, 180),
    excerpt: compactText(`${record.value}. ${record.support}`, 620),
    summary: null,
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
      lineageVersion: "finding_explanation_lineage_v1"
    },
    eligibility: {
      eligible: true,
      lifecycleState: "active",
      originalEvidenceEligible: true,
      decisionVersion: "finding_explanation_eligibility_v1"
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

function uniqueStrings(values: readonly (string | null | undefined)[]) {
  return values
    .map((value) => compactText(value, 320))
    .filter(Boolean)
    .filter((value, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 6);
}

export function buildFindingExplanationPackage({
  workspaceId,
  insight,
  now = new Date()
}: {
  workspaceId: string;
  insight: IntelligenceInsight;
  now?: Date;
}): FindingExplanationPackage {
  const records = eligibleRecords(insight);
  const candidates = records.map((record, index) => candidateFromRecord({ workspaceId, insight, record, baseRank: index + 1 }));
  const sourceRegistry = buildSourceRegistry({ workspaceId, candidates });
  const manifest = buildEvidenceManifest({
    workspaceId,
    queryText: "Explain one application-selected Intelligence finding.",
    candidates,
    sourceRegistry,
    generatedAt: now.toISOString(),
    candidateRetrieverVersion: "finding_explanation_structured_retriever_v1",
    embeddingVersion: null,
    rerankerVersion: "deterministic_noop_reranker_v1",
    signalPlannerVersion: "finding_explanation_signal_plan_v1"
  });
  const requiredCitationIds = manifest.evidence.map((entry) => entry.citationId);
  const verification = verifyEvidenceManifestCitations({ manifest, citationIds: requiredCitationIds, requiredCitationIds });
  if (!verification.valid) throw new Error("Finding evidence citations could not be verified.");

  const sourceEntries = new Map(sourceRegistry.entries.map((entry) => [entry.sourceOrdinal, entry]));
  const citations: FindingExplanationCitationView[] = manifest.evidence.map((entry) => {
    const source = sourceEntries.get(entry.sourceOrdinal);
    return {
      citationId: entry.citationId,
      title: entry.title,
      sourceLabel: source?.title || "Eligible business evidence",
      sourceType: source?.sourceType || "Business evidence",
      excerpt: entry.excerpt,
      recordedAt: entry.recordedAt
    };
  });
  const latestEvidenceAt = candidates
    .map((candidate) => candidate.provenance.recordedAt || candidate.provenance.indexedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const ageDays = latestEvidenceAt
    ? Math.floor((now.getTime() - Date.parse(latestEvidenceAt)) / 86_400_000)
    : null;
  const facts = {
    findingKey: evidenceEngineHash({ fingerprint: insight.fingerprint || insight.id }),
    findingType: insight.type,
    title: compactText(insight.title, 180),
    priority: insight.priority,
    confidence: insight.confidence,
    timePeriod: compactText(insight.timePeriod, 120),
    approvedDevelopment: compactText(insight.summary, 520),
    approvedEvidenceBasis: compactText(insight.why, 520),
    approvedLeadershipRelevance: compactText(insight.impact, 420),
    approvedInvestigationNext: compactText(insight.recommendedAction, 420),
    approvedLimitations: uniqueStrings([
      insight.limitation,
      ...insight.missingEvidence,
      ...insight.contradictoryEvidence,
      insight.suggestedNextData,
      "The available evidence does not establish a cause beyond the recorded facts."
    ]),
    freshness: !latestEvidenceAt ? "unavailable" as const : ageDays !== null && ageDays > STALE_AFTER_DAYS ? "stale" as const : "current" as const,
    independentSourceCount: sourceRegistry.independentOriginalSourceCount
  };
  const fingerprint = evidenceEngineHash({
    contractId: FINDING_EXPLANATION_CONTRACT_ID,
    contractVersion: FINDING_EXPLANATION_CONTRACT_VERSION,
    validatorVersion: FINDING_EXPLANATION_VALIDATOR_VERSION,
    facts,
    evidence: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      excerpt: candidate.excerpt,
      canonicalSourceKey: candidate.source.canonicalSourceKey,
      recordedAt: candidate.provenance.recordedAt,
      lineageVersion: candidate.provenance.lineageVersion,
      lifecycleState: candidate.eligibility.lifecycleState,
      eligibilityDecisionVersion: candidate.eligibility.decisionVersion
    })).sort((left, right) => left.candidateId.localeCompare(right.candidateId))
  });

  return {
    contractId: FINDING_EXPLANATION_CONTRACT_ID,
    contractVersion: FINDING_EXPLANATION_CONTRACT_VERSION,
    validatorVersion: FINDING_EXPLANATION_VALIDATOR_VERSION,
    fingerprint,
    facts,
    manifest,
    requiredCitationIds,
    citations
  };
}
