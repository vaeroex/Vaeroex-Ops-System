import "server-only";

import type { BoundedWorkspaceContext } from "@/lib/ai/bounded-context";
import { evidenceContextAsJson, type EvidenceContext } from "@/lib/ai/evidence-index";
import type { ExecutiveCitationCatalogEntry } from "@/lib/ai/executive-output";
import type { VaeroexQueryPlan } from "@/lib/ai/query-depth-planner";
import type { Json } from "@/lib/supabase/types";

type JsonRecord = Record<string, Json | undefined>;

export type ExecutiveEvidenceCandidate = {
  key: string;
  domain: string;
  title: string;
  sourceType: string;
  excerpt: string;
  sourceId: string | null;
  sourceFileId: string | null;
  independentSourceKey: string | null;
  evidenceRole: ExecutiveCitationCatalogEntry["evidenceRole"];
  confidenceScore: number;
  recordedAt: string | null;
  similarity?: number;
};

export type RankedExecutiveEvidence = ExecutiveEvidenceCandidate & {
  rankScore: number;
  rankingFactors: {
    businessImpact: number;
    confidence: number;
    freshness: number;
    directRelevance: number;
    historicalImportance: number;
  };
};

export type ExecutiveReasoningContext = {
  evidenceContextJson: Json;
  reasoningManifest: Json;
  catalog: ExecutiveCitationCatalogEntry[];
  independentSourceCount: number;
  currentIndependentSourceCount: number;
  originalSourceTypeCount: number;
  rankedEvidenceCount: number;
  rankedEvidence: RankedExecutiveEvidence[];
  maximumEvidenceSufficiency: "Sufficient" | "Partial" | "Insufficient";
};

const IMPACT_PATTERN = /\b(revenue|profit|margin|cash|cost|expense|customer|retention|complaint|inventory|deadline|delay|risk|compliance|staff|capacity|quality|churn|conversion|loss|growth)\b/i;
const HISTORICAL_PATTERN = /\b(trend|history|historical|previous|prior|month|quarter|year|week|period|change|growth|declin|increase|decrease|forecast)\b/i;
const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "what", "why", "how", "should", "would", "could", "about"]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactText(value: unknown, max = 900) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function uuidValue(value: unknown) {
  const candidate = stringValue(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

function recordDate(record: JsonRecord) {
  const candidate = [record.metric_date, record.snapshot_date, record.updated_at, record.created_at, record.indexed_at]
    .map(stringValue)
    .find(Boolean);
  return candidate && Number.isFinite(new Date(candidate).getTime()) ? candidate : null;
}

function recordTitle(record: JsonRecord, fallback: string) {
  return [record.title, record.name, record.display_name, record.metric_name, record.role_title, record.report_type]
    .map(stringValue)
    .find(Boolean) || fallback;
}

function evidenceTerms(value: string) {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9%$]+/g)
      ?.filter((term) => term.length >= 3 && !STOP_WORDS.has(term)) || []
  );
}

function directRelevance(query: string, candidate: ExecutiveEvidenceCandidate) {
  if (typeof candidate.similarity === "number" && Number.isFinite(candidate.similarity)) {
    return Math.round(Math.min(Math.max(candidate.similarity, 0), 1) * 100);
  }

  const queryTerms = evidenceTerms(query);
  if (!queryTerms.size) return 40;
  const candidateTerms = evidenceTerms(`${candidate.title} ${candidate.excerpt}`);
  const matches = Array.from(queryTerms).filter((term) => candidateTerms.has(term)).length;
  return Math.round((matches / queryTerms.size) * 100);
}

function freshnessScore(recordedAt: string | null) {
  if (!recordedAt) return 35;
  const timestamp = new Date(recordedAt).getTime();
  if (!Number.isFinite(timestamp)) return 35;
  const ageDays = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (ageDays <= 30) return 100;
  if (ageDays <= 90) return 80;
  if (ageDays <= 180) return 60;
  if (ageDays <= 365) return 40;
  return 20;
}

function businessImpactScore(candidate: ExecutiveEvidenceCandidate) {
  const matches = `${candidate.title} ${candidate.excerpt}`.match(new RegExp(IMPACT_PATTERN.source, "gi"))?.length || 0;
  return Math.min(100, 35 + matches * 13);
}

function historicalImportanceScore(candidate: ExecutiveEvidenceCandidate) {
  const text = `${candidate.title} ${candidate.excerpt}`;
  const matches = text.match(new RegExp(HISTORICAL_PATTERN.source, "gi"))?.length || 0;
  return Math.min(100, (candidate.evidenceRole === "historical" ? 55 : 20) + matches * 12);
}

export function rankExecutiveEvidence(
  candidates: ExecutiveEvidenceCandidate[],
  query: string,
  limit = 18
): RankedExecutiveEvidence[] {
  const ranked = candidates.map((candidate) => {
    const rankingFactors = {
      businessImpact: businessImpactScore(candidate),
      confidence: Math.min(Math.max(Math.round(candidate.confidenceScore), 0), 100),
      freshness: freshnessScore(candidate.recordedAt),
      directRelevance: directRelevance(query, candidate),
      historicalImportance: historicalImportanceScore(candidate)
    };
    const rankScore = Math.round(
      rankingFactors.businessImpact * 0.3 +
      rankingFactors.confidence * 0.25 +
      rankingFactors.freshness * 0.15 +
      rankingFactors.directRelevance * 0.25 +
      rankingFactors.historicalImportance * 0.05
    );

    return { ...candidate, rankScore, rankingFactors };
  }).sort((left, right) =>
    right.rankScore - left.rankScore ||
    right.rankingFactors.directRelevance - left.rankingFactors.directRelevance ||
    String(right.recordedAt || "").localeCompare(String(left.recordedAt || "")) ||
    left.key.localeCompare(right.key)
  );
  const selected: RankedExecutiveEvidence[] = [];
  const domainCounts = new Map<string, number>();

  for (const candidate of ranked) {
    if ((domainCounts.get(candidate.domain) || 0) >= 2) continue;
    selected.push(candidate);
    domainCounts.set(candidate.domain, (domainCounts.get(candidate.domain) || 0) + 1);
    if (selected.length >= limit) return selected;
  }

  for (const candidate of ranked) {
    if (selected.some((item) => item.key === candidate.key)) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }

  return selected;
}

function structuredCandidate({
  domain,
  sourceType,
  value,
  index,
  role,
  fallbackTitle
}: {
  domain: string;
  sourceType: string;
  value: Json;
  index: number;
  role: ExecutiveEvidenceCandidate["evidenceRole"];
  fallbackTitle: string;
}): ExecutiveEvidenceCandidate {
  const record = isRecord(value) ? value : {};
  const sourceId = uuidValue(record.id);
  const sourceFileId = uuidValue(record.source_file_id);
  const importId = uuidValue(record.import_id);
  const independentSourceKey = role === "original"
    ? sourceFileId
      ? `file:${sourceFileId}`
      : domain === "documents" && sourceId
        ? `file:${sourceId}`
        : importId
          ? `import:${importId}`
          : domain === "kpis"
            ? `kpi-series:${recordTitle(record, fallbackTitle).toLowerCase()}`
            : sourceId
            ? `${domain}:${sourceId}`
            : `${domain}:aggregate`
    : null;

  return {
    key: `structured:${domain}:${sourceId || index}`,
    domain,
    title: recordTitle(record, fallbackTitle),
    sourceType,
    excerpt: compactText(value),
    sourceId,
    sourceFileId,
    independentSourceKey,
    evidenceRole: role,
    confidenceScore: role === "original" ? 78 : role === "historical" ? 58 : role === "derived" ? 35 : 62,
    recordedAt: recordDate(record)
  };
}

function values(value: Json | undefined) {
  return Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
}

function structuredEvidenceCandidates(context: BoundedWorkspaceContext): ExecutiveEvidenceCandidate[] {
  const snapshot = isRecord(context.workspaceSnapshot) ? context.workspaceSnapshot : {};
  const structured = isRecord(snapshot.structured_context) ? snapshot.structured_context : {};
  const riskContext = isRecord(structured.risk_and_priority_evidence) ? structured.risk_and_priority_evidence : {};
  const definitions: Array<{
    domain: string;
    sourceType: string;
    records: Json[];
    role: ExecutiveEvidenceCandidate["evidenceRole"];
    fallbackTitle: string;
  }> = [
    { domain: "kpis", sourceType: "KPI summary", records: values(structured.kpi_summary), role: "supporting", fallbackTitle: "Structured KPI summary" },
    { domain: "kpis", sourceType: "KPI measurement", records: values(structured.kpi_records), role: "original", fallbackTitle: "KPI measurement" },
    { domain: "business_health", sourceType: "Historical trend", records: values(structured.business_health), role: "historical", fallbackTitle: "Business Health history" },
    { domain: "risks", sourceType: "Risk", records: values(riskContext.issues), role: "original", fallbackTitle: "Business risk" },
    { domain: "decisions", sourceType: "Recommendation", records: values(riskContext.recommendations), role: "derived", fallbackTitle: "Prior recommendation" },
    { domain: "reports", sourceType: "Report", records: values(structured.reports).filter((value) => isRecord(value) && value.evidence_lineage_available === true), role: "derived", fallbackTitle: "Saved report" },
    { domain: "documents", sourceType: "Document", records: values(structured.sources), role: "original", fallbackTitle: "Source document" },
    { domain: "operations", sourceType: "Business Signal", records: values(structured.business_signals), role: "original", fallbackTitle: "Business Signal" },
    { domain: "operations", sourceType: "Operational metric", records: values(structured.operational_metrics), role: "original", fallbackTitle: "Operational metric" },
    { domain: "customers", sourceType: "Customer activity", records: values(structured.historical_customer_activity), role: "original", fallbackTitle: "Customer activity" },
    { domain: "people", sourceType: "People context", records: values(structured.people_context), role: "original", fallbackTitle: "People context" },
    { domain: "compliance", sourceType: "Policy or procedure", records: values(structured.process_and_policy_context), role: "original", fallbackTitle: "Policy or procedure" }
  ];

  return definitions.flatMap((definition) => definition.records.map((record, index) => structuredCandidate({
    domain: definition.domain,
    sourceType: definition.sourceType,
    value: record,
    index,
    role: definition.role,
    fallbackTitle: definition.fallbackTitle
  })));
}

function memoryEvidenceCandidates(context: EvidenceContext): ExecutiveEvidenceCandidate[] {
  return context.chunks.map((chunk) => ({
    key: `memory:${chunk.id}`,
    domain: "business_memory",
    title: chunk.title,
    sourceType: "Business Memory",
    excerpt: compactText(chunk.excerpt),
    sourceId: chunk.sourceId,
    sourceFileId: chunk.sourceFileId,
    independentSourceKey: null,
    evidenceRole: "supporting" as const,
    confidenceScore: chunk.confidenceScore,
    recordedAt: chunk.indexedAt,
    similarity: chunk.similarity
  }));
}

function confidenceCeiling(independentSourceCount: number, currentIndependentSourceCount: number) {
  if (currentIndependentSourceCount >= 3) return "High";
  if (currentIndependentSourceCount >= 2) return "Medium";
  if (independentSourceCount >= 1) return "Low";
  return "Insufficient";
}

export function buildExecutiveReasoningContext({
  query,
  plan,
  boundedContext,
  evidenceContext
}: {
  query: string;
  plan: VaeroexQueryPlan;
  boundedContext: BoundedWorkspaceContext;
  evidenceContext: EvidenceContext;
}): ExecutiveReasoningContext {
  const ranked = rankExecutiveEvidence(
    [...structuredEvidenceCandidates(boundedContext), ...memoryEvidenceCandidates(evidenceContext)],
    query
  );
  const selectedMemoryKeys = new Set(ranked.filter((item) => item.key.startsWith("memory:")).map((item) => item.key.slice("memory:".length)));
  const rankedMemoryContext: EvidenceContext = {
    ...evidenceContext,
    chunks: evidenceContext.chunks.filter((chunk) => selectedMemoryKeys.has(chunk.id))
  };
  const baseEvidence = evidenceContextAsJson(rankedMemoryContext) as JsonRecord;
  const catalog: ExecutiveCitationCatalogEntry[] = ranked.map((item, index) => ({
    citationId: index + 1,
    title: item.title,
    sourceType: item.sourceType,
    independentSourceKey: item.independentSourceKey,
    evidenceRole: item.evidenceRole,
    freshnessScore: item.rankingFactors.freshness,
    directRelevanceScore: item.rankingFactors.directRelevance
  }));
  const independentSourceCount = new Set(
    catalog
      .filter((item) => item.evidenceRole === "original")
      .map((item) => item.independentSourceKey)
      .filter((key): key is string => Boolean(key))
  ).size;
  const currentIndependentSourceCount = new Set(
    catalog
      .filter((item) => item.evidenceRole === "original" && item.freshnessScore >= 60)
      .map((item) => item.independentSourceKey)
      .filter((key): key is string => Boolean(key))
  ).size;
  const originalSourceTypeCount = new Set(
    catalog.filter((item) => item.evidenceRole === "original").map((item) => item.sourceType)
  ).size;
  const maximumEvidenceSufficiency = independentSourceCount === 0
    ? "Insufficient" as const
    : independentSourceCount === 1 || currentIndependentSourceCount < 2 || originalSourceTypeCount < 2
      ? "Partial" as const
      : "Sufficient" as const;
  const citations = ranked.map((item, index) => ({
    citation_id: index + 1,
    title: item.title,
    source_type: item.sourceType,
    source_id: item.sourceId,
    source_file_id: item.sourceFileId,
    evidence_role: item.evidenceRole,
    independent_source_key: item.independentSourceKey,
    excerpt: item.excerpt,
    executive_rank: index + 1,
    rank_score: item.rankScore,
    ranking_factors: item.rankingFactors
  }));

  return {
    evidenceContextJson: {
      ...baseEvidence,
      citations
    },
    reasoningManifest: {
      mode: "executive_intelligence",
      question: query,
      execution_tier: plan.tier,
      loaded_domains: boundedContext.loadedDomains,
      reasoning_must_precede_writing: true,
      reasoning_stage_order: [
        "Determine what is happening from ranked evidence.",
        "Determine why it is happening; distinguish supported causes from possible relationships.",
        "Determine why leadership should care across financial, operational, customer, and strategic impact.",
        "Determine what should happen next.",
        "Rank those actions and explain why they come before lower-impact work.",
        "Only then write the executive response."
      ],
      evidence_ranking: {
        factors: ["business impact", "confidence", "freshness", "direct relevance", "historical importance"],
        representative_limit: ranked.length,
        maximum_per_domain_before_fill: 2
      },
      correlation_policy: {
        supported_root_cause_requires_independent_sources: 2,
        correlation_is_not_causation: true,
        business_memory_is_supporting_context_not_an_independent_source: true,
        derived_reports_cannot_establish_current_business_facts: true,
        unsupported_relationships_must_be_labeled_possible_or_not_established: true
      },
      independent_original_source_count: independentSourceCount,
      current_independent_original_source_count: currentIndependentSourceCount,
      original_source_type_count: originalSourceTypeCount,
      maximum_evidence_sufficiency: maximumEvidenceSufficiency,
      maximum_recommendation_confidence: confidenceCeiling(independentSourceCount, currentIndependentSourceCount),
      response_policy: {
        use_only_citation_ids_from_evidence_context: true,
        never_invent_financial_impact: true,
        use_not_established_when_impact_is_not_supported: true,
        explain_conflicting_evidence: true,
        classify_evidence_sufficiency_before_drawing_conclusions: true,
        partial_evidence_requires_provisional_language: true,
        insufficient_evidence_requires_safe_reversible_actions: true,
        stale_evidence_cannot_support_high_confidence: true,
        derived_context_requires_original_lineage: true,
        do_not_expose_internal_reasoning_stage: true
      }
    },
    catalog,
    independentSourceCount,
    currentIndependentSourceCount,
    originalSourceTypeCount,
    rankedEvidenceCount: ranked.length,
    rankedEvidence: ranked,
    maximumEvidenceSufficiency
  };
}
