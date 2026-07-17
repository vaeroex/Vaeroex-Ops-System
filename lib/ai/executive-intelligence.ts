import "server-only";

import type { BoundedWorkspaceContext } from "@/lib/ai/bounded-context";
import { evidenceContextAsJson, type EvidenceContext } from "@/lib/ai/evidence-index";
import type { ExecutiveCitationCatalogEntry } from "@/lib/ai/executive-output";
import type { VaeroexQueryPlan } from "@/lib/ai/query-depth-planner";
import { estimateTokenCount } from "@/lib/ai/usage";
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
  findingEligible: boolean;
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
  modelWorkspaceSnapshot: Json;
  reasoningManifest: Json;
  catalog: ExecutiveCitationCatalogEntry[];
  independentSourceCount: number;
  currentIndependentSourceCount: number;
  originalSourceTypeCount: number;
  rankedEvidenceCount: number;
  rankedEvidence: RankedExecutiveEvidence[];
  signalSynthesis: ExecutiveSignalSynthesisPlan;
  promptCompaction: ExecutivePromptCompactionMetrics;
  maximumEvidenceSufficiency: "Sufficient" | "Partial" | "Insufficient";
};

export type ExecutivePromptCompactionMetrics = {
  retrievedEvidenceCount: number;
  retainedEvidenceCount: number;
  retainedOriginalEvidenceCount: number;
  retainedSupportingMemoryCount: number;
  retainedSignalCount: number;
  compactContextTokens: number;
  targetContextTokens: number;
  trimmingSteps: string[];
};

export type ExecutiveSignalCandidate = {
  signalId: string;
  title: string;
  domains: string[];
  citationIds: number[];
  originalCitationIds: number[];
  independentSourceCount: number;
  currentIndependentSourceCount: number;
  priorityScore: number;
  executiveRank: number;
};

export type ExecutiveSignalRelationship = {
  leftSignalId: string;
  rightSignalId: string;
  domains: string[];
  sharedTerms: string[];
  evaluationPriority: number;
};

export type ExecutiveSignalSynthesisPlan = {
  candidates: ExecutiveSignalCandidate[];
  relationships: ExecutiveSignalRelationship[];
  minimumDistinctFindings: number;
  requiredSignalIds: string[];
  requireCrossSignalAssessment: boolean;
};

export const EXECUTIVE_INTERACTIVE_MAX_INPUT_TOKENS = 10_000;
export const EXECUTIVE_COMPACT_CONTEXT_TARGET_TOKENS = 900;
export const EXECUTIVE_SIGNAL_CANDIDATE_LIMIT = 6;
export const EXECUTIVE_ORIGINAL_RECORDS_PER_SIGNAL = 2;
export const EXECUTIVE_ORIGINAL_EXCERPT_LIMIT = 320;
export const EXECUTIVE_SUPPORTING_MEMORY_LIMIT = 4;
export const EXECUTIVE_SUPPORTING_MEMORY_EXCERPT_LIMIT = 240;

const IMPACT_PATTERN = /\b(revenue|profit|margin|cash|cost|expense|customer|retention|complaint|inventory|deadline|delay|risk|compliance|staff|capacity|quality|churn|conversion|loss|growth)\b/i;
const HISTORICAL_PATTERN = /\b(trend|history|historical|previous|prior|month|quarter|year|week|period|change|growth|declin|increase|decrease|forecast)\b/i;
const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "what", "why", "how", "should", "would", "could", "about"]);
const SIGNAL_GENERIC_TERMS = new Set([
  ...STOP_WORDS,
  "business",
  "current",
  "document",
  "evidence",
  "historical",
  "measurement",
  "metric",
  "record",
  "report",
  "signal",
  "source",
  "summary"
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactText(value: unknown, max = 900) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function compactExcerpt(value: string, max: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  const candidate = normalized.slice(0, max - 3);
  const boundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "), candidate.lastIndexOf(", "));
  const text = boundary >= Math.floor(max * 0.55) ? candidate.slice(0, boundary + 1) : candidate;
  return `${text.trim()}...`;
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

function hasStructuredSignal(record: JsonRecord, sourceType: string) {
  const populated = (value: unknown) => value !== null && value !== undefined && value !== "";

  if (sourceType === "KPI measurement") return populated(record.actual_value);
  if (sourceType === "Document") return stringValue(record.analysis_summary).length >= 12;
  if (sourceType === "Risk") return Boolean(stringValue(record.title) || stringValue(record.description));
  if (sourceType === "Business Signal") return Boolean(stringValue(record.title) || stringValue(record.description));
  if (sourceType === "Operational metric") return populated(record.value);
  if (sourceType === "Customer activity") return Boolean(record.raw_data_json || record.last_activity_at || record.status);
  if (sourceType === "People context") return Boolean(record.role_title || record.department || record.status);
  if (sourceType === "Policy or procedure") return Boolean(record.title || record.status || record.version);
  return true;
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
    recordedAt: recordDate(record),
    findingEligible: role === "original" && hasStructuredSignal(record, sourceType)
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
    findingEligible: false,
    similarity: chunk.similarity
  }));
}

type MutableSignalGroup = {
  title: string;
  domains: Set<string>;
  topicTerms: Set<string>;
  originalMembers: Array<{ item: RankedExecutiveEvidence; citationId: number }>;
  supportingMembers: Array<{ item: RankedExecutiveEvidence; citationId: number }>;
  priorityScore: number;
};

function signalTerms(candidate: ExecutiveEvidenceCandidate) {
  return new Set(
    Array.from(evidenceTerms(candidate.title))
      .filter((term) => !SIGNAL_GENERIC_TERMS.has(term))
      .slice(0, 8)
  );
}

function termOverlap(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  const matches = Array.from(left).filter((term) => right.has(term)).length;
  return matches / Math.min(left.size, right.size);
}

function sameSignalTopic(left: Set<string>, right: Set<string>) {
  return left.size > 0 && left.size === right.size && Array.from(left).every((term) => right.has(term));
}

function groupPriority(members: MutableSignalGroup["originalMembers"]) {
  const scores = members.map(({ item }) => item.rankScore);
  const highest = Math.max(...scores);
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const independentSources = new Set(
    members.map(({ item }) => item.independentSourceKey).filter((key): key is string => Boolean(key))
  ).size;
  return Math.round(highest * 0.7 + average * 0.25 + Math.min(independentSources * 2.5, 5));
}

export function buildExecutiveSignalSynthesisPlan(
  ranked: RankedExecutiveEvidence[],
  limit = EXECUTIVE_SIGNAL_CANDIDATE_LIMIT
): ExecutiveSignalSynthesisPlan {
  const groups: MutableSignalGroup[] = [];
  const structuredLineageKeys = new Set(
    ranked
      .filter((item) => item.evidenceRole === "original" && item.findingEligible && item.sourceType !== "Document")
      .map((item) => item.independentSourceKey)
      .filter((key): key is string => Boolean(key))
  );

  ranked.forEach((item, index) => {
    if (item.evidenceRole !== "original" || !item.findingEligible) return;
    if (item.sourceType === "Document" && item.independentSourceKey && structuredLineageKeys.has(item.independentSourceKey)) return;
    const terms = signalTerms(item);
    const existing = groups.find((group) =>
      (group.domains.has(item.domain) && termOverlap(group.topicTerms, terms) >= 0.6) ||
      sameSignalTopic(group.topicTerms, terms)
    );
    const member = { item, citationId: index + 1 };

    if (existing) {
      existing.originalMembers.push(member);
      existing.domains.add(item.domain);
      existing.priorityScore = groupPriority(existing.originalMembers);
      return;
    }

    groups.push({
      title: item.title,
      domains: new Set([item.domain]),
      topicTerms: terms,
      originalMembers: [member],
      supportingMembers: [],
      priorityScore: item.rankScore
    });
  });

  const selectedGroups = groups
    .sort((left, right) =>
      right.priorityScore - left.priorityScore ||
      Array.from(left.domains).sort().join(":").localeCompare(Array.from(right.domains).sort().join(":")) ||
      left.title.localeCompare(right.title)
    )
    .slice(0, Math.max(1, limit));
  const groupedOriginalKeys = new Set(
    selectedGroups.flatMap((group) => group.originalMembers.map(({ item }) => item.key))
  );

  ranked.forEach((item, index) => {
    if (groupedOriginalKeys.has(item.key)) return;
    const terms = signalTerms(item);
    let best: { group: MutableSignalGroup; score: number } | null = null;

    for (const group of selectedGroups) {
      const sameLineage = group.originalMembers.some(({ item: original }) =>
        Boolean(
          (item.independentSourceKey && item.independentSourceKey === original.independentSourceKey) ||
          (item.sourceFileId && original.sourceFileId === item.sourceFileId) ||
          (item.sourceId && original.sourceId === item.sourceId) ||
          (item.sourceId && original.sourceFileId === item.sourceId) ||
          (item.sourceFileId && original.sourceId === item.sourceFileId)
        )
      );
      const overlap = termOverlap(group.topicTerms, terms);
      const score = sameLineage ? 2 : overlap;
      if (score > (best?.score || 0)) best = { group, score };
    }

    if (best && best.score >= 0.5) {
      best.group.supportingMembers.push({ item, citationId: index + 1 });
    }
  });

  const candidates: ExecutiveSignalCandidate[] = selectedGroups.map((group, index) => {
    const originalKeys = group.originalMembers
      .map(({ item }) => item.independentSourceKey)
      .filter((key): key is string => Boolean(key));
    const currentOriginalKeys = group.originalMembers
      .filter(({ item }) => item.rankingFactors.freshness >= 60)
      .map(({ item }) => item.independentSourceKey)
      .filter((key): key is string => Boolean(key));

    return {
      signalId: `S${index + 1}`,
      title: group.title,
      domains: Array.from(group.domains).sort(),
      citationIds: [...group.originalMembers, ...group.supportingMembers].map(({ citationId }) => citationId),
      originalCitationIds: group.originalMembers.map(({ citationId }) => citationId),
      independentSourceCount: new Set(originalKeys).size,
      currentIndependentSourceCount: new Set(currentOriginalKeys).size,
      priorityScore: group.priorityScore,
      executiveRank: index + 1
    };
  });

  const relationships: ExecutiveSignalRelationship[] = [];
  for (let leftIndex = 0; leftIndex < selectedGroups.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < selectedGroups.length; rightIndex += 1) {
      const left = selectedGroups[leftIndex];
      const right = selectedGroups[rightIndex];
      const sharedTerms = Array.from(left.topicTerms).filter((term) => right.topicTerms.has(term)).slice(0, 4);
      const relationshipDomains = Array.from(new Set([...left.domains, ...right.domains])).sort();
      if (relationshipDomains.length === 1 && !sharedTerms.length) continue;
      relationships.push({
        leftSignalId: `S${leftIndex + 1}`,
        rightSignalId: `S${rightIndex + 1}`,
        domains: relationshipDomains,
        sharedTerms,
        evaluationPriority: Math.round((left.priorityScore + right.priorityScore) / 2 + sharedTerms.length * 3)
      });
    }
  }
  relationships.sort((left, right) =>
    right.evaluationPriority - left.evaluationPriority ||
    left.leftSignalId.localeCompare(right.leftSignalId) ||
    left.rightSignalId.localeCompare(right.rightSignalId)
  );

  const minimumDistinctFindings = Math.min(3, candidates.length);
  const boundedRelationships = relationships.slice(0, 4);
  return {
    candidates,
    relationships: boundedRelationships,
    minimumDistinctFindings,
    requiredSignalIds: candidates.slice(0, minimumDistinctFindings).map((candidate) => candidate.signalId),
    requireCrossSignalAssessment: minimumDistinctFindings >= 2 && boundedRelationships.length > 0
  };
}

function compactBusinessHealthContext(workspaceSnapshot: Json) {
  const snapshot = isRecord(workspaceSnapshot) ? workspaceSnapshot : {};
  const structured = isRecord(snapshot.structured_context) ? snapshot.structured_context : {};
  const health = isRecord(structured.business_health_score_context) ? structured.business_health_score_context : null;
  if (!health) return null;
  const readiness = isRecord(health.kpi_readiness) ? health.kpi_readiness : null;

  return {
    available: health.available ?? false,
    current_assessment: health.current_assessment ?? null,
    score_components: health.score_components ?? null,
    coverage_indicators: health.coverage_indicators ?? null,
    kpi_readiness: readiness
      ? {
          visible_metrics: readiness.visible_metrics ?? null,
          measurement_rows: readiness.measurement_rows ?? null,
          missing_targets: readiness.missing_targets ?? null,
          missing_values: readiness.missing_values ?? null,
          stale_metrics: readiness.stale_metrics ?? null,
          metrics_with_insufficient_history: readiness.metrics_with_insufficient_history ?? null,
          recommendation_confidence: readiness.recommendation_confidence ?? null,
          limitations: Array.isArray(readiness.limitations)
            ? readiness.limitations.slice(0, 3).map((item) => compactText(item, 180))
            : []
        }
      : null,
    interpretation_policy: health.interpretation_policy ?? null
  } satisfies Json;
}

function compactExecutivePromptContext({
  boundedContext,
  ranked,
  signalSynthesis,
  baseEvidence
}: {
  boundedContext: BoundedWorkspaceContext;
  ranked: RankedExecutiveEvidence[];
  signalSynthesis: ExecutiveSignalSynthesisPlan;
  baseEvidence: JsonRecord;
}) {
  const rankedByCitationId = new Map(ranked.map((item, index) => [index + 1, item]));
  const requiredSignalIds = new Set(signalSynthesis.requiredSignalIds);
  const minimumSignalCount = signalSynthesis.requiredSignalIds.length;
  const memoryCandidates = ranked
    .map((item, index) => ({ item, citationId: index + 1 }))
    .filter(({ item }) => item.evidenceRole === "supporting" && item.sourceType === "Business Memory");
  const requiredContextCandidates = ranked
    .map((item, index) => ({ item, citationId: index + 1 }))
    .filter(({ item }) => item.domain === "business_health" && item.evidenceRole === "historical")
    .slice(0, 1);
  const distinctOriginalCitationIds = new Map(signalSynthesis.candidates.map((signal) => {
    const seen = new Set<string>();
    const citationIds = signal.originalCitationIds.filter((citationId) => {
      const item = rankedByCitationId.get(citationId);
      if (!item) return false;
      const provenanceKey = item.independentSourceKey || [
        item.sourceFileId,
        item.sourceId,
        item.title.toLowerCase(),
        compactExcerpt(item.excerpt, 120).toLowerCase()
      ].filter(Boolean).join(":");
      if (seen.has(provenanceKey)) return false;
      seen.add(provenanceKey);
      return true;
    });
    return [signal.signalId, citationIds] as const;
  }));
  const baseModelWorkspaceSnapshot = {
    scope: "compact_executive_reasoning",
    query: compactText(
      isRecord(boundedContext.workspaceSnapshot) ? boundedContext.workspaceSnapshot.query : "",
      600
    ),
    requested_domains: isRecord(boundedContext.workspaceSnapshot)
      ? boundedContext.workspaceSnapshot.requested_domains ?? boundedContext.loadedDomains
      : boundedContext.loadedDomains,
    loaded_domains: boundedContext.loadedDomains,
    business_health_score_context: compactBusinessHealthContext(boundedContext.workspaceSnapshot),
  } satisfies Json;

  let retainedSignalCount = signalSynthesis.candidates.length;
  let memoryLimit = EXECUTIVE_SUPPORTING_MEMORY_LIMIT;
  let includeOptionalSecondRecords = true;
  let includeRequiredSecondRecords = true;
  let originalExcerptLimit = EXECUTIVE_ORIGINAL_EXCERPT_LIMIT;
  let memoryExcerptLimit = EXECUTIVE_SUPPORTING_MEMORY_EXCERPT_LIMIT;
  const trimmingSteps: string[] = [];

  const buildCompactContext = () => {
    const retainedSignals = signalSynthesis.candidates.slice(0, retainedSignalCount);
    const signalByCitationId = new Map<number, ExecutiveSignalCandidate>();
    retainedSignals.forEach((signal) => signal.citationIds.forEach((citationId) => signalByCitationId.set(citationId, signal)));
    const selectedCitationIds = new Set<number>();

    retainedSignals.forEach((signal) => distinctOriginalCitationIds.get(signal.signalId)?.slice(0, 1).forEach((citationId) => selectedCitationIds.add(citationId)));
    retainedSignals
      .filter((signal) => requiredSignalIds.has(signal.signalId) && includeRequiredSecondRecords)
      .forEach((signal) => distinctOriginalCitationIds.get(signal.signalId)?.slice(1, EXECUTIVE_ORIGINAL_RECORDS_PER_SIGNAL).forEach((citationId) => selectedCitationIds.add(citationId)));
    retainedSignals
      .filter((signal) => !requiredSignalIds.has(signal.signalId) && includeOptionalSecondRecords)
      .forEach((signal) => distinctOriginalCitationIds.get(signal.signalId)?.slice(1, EXECUTIVE_ORIGINAL_RECORDS_PER_SIGNAL).forEach((citationId) => selectedCitationIds.add(citationId)));
    requiredContextCandidates.forEach(({ citationId }) => selectedCitationIds.add(citationId));
    memoryCandidates.slice(0, memoryLimit).forEach(({ citationId }) => selectedCitationIds.add(citationId));

    const retained = Array.from(selectedCitationIds)
      .sort((left, right) => left - right)
      .map((citationId) => ({ citationId, item: rankedByCitationId.get(citationId) }))
      .filter((entry): entry is { citationId: number; item: RankedExecutiveEvidence } => Boolean(entry.item));
    const citations = retained.map(({ citationId, item }) => {
      const signal = signalByCitationId.get(citationId);
      return {
        citation_id: citationId,
        signal_id: signal?.signalId || null,
        executive_rank: signal?.executiveRank || null,
        domain: item.domain,
        title: compactText(item.title, 160),
        source_type: item.sourceType,
        source_id: item.sourceId,
        source_file_id: item.sourceFileId,
        independent_source_key: item.independentSourceKey,
        evidence_role: item.evidenceRole,
        recorded_at: item.recordedAt,
        confidence_score: item.confidenceScore,
        freshness_score: item.rankingFactors.freshness,
        direct_relevance_score: item.rankingFactors.directRelevance,
        excerpt: compactExcerpt(
          item.excerpt,
          item.sourceType === "Business Memory" ? memoryExcerptLimit : originalExcerptLimit
        )
      };
    });
    const evidenceContextJson = {
      available: baseEvidence.available ?? citations.length > 0,
      retrieval_mode: baseEvidence.retrieval_mode ?? "none",
      confidence_score: baseEvidence.confidence_score ?? null,
      confidence_label: baseEvidence.confidence_label ?? null,
      data_gaps: Array.isArray(baseEvidence.data_gaps)
        ? baseEvidence.data_gaps.slice(0, 4).map((item) => compactText(item, 180))
        : [],
      limitations: Array.isArray(baseEvidence.limitations)
        ? baseEvidence.limitations.slice(0, 4).map((item) => compactText(item, 180))
        : [],
      policy: [
        "Only these compact citations may support the answer.",
        "Citation provenance is authoritative; omitted workspace records are not available to the model.",
        "Supporting Business Memory cannot establish a finding or increase source independence."
      ],
      citations
    } satisfies Json;
    const modelWorkspaceSnapshot = {
      ...baseModelWorkspaceSnapshot,
      scope_policy: {
        full_workspace_snapshot_excluded: true,
        retrieved_records_ranked_server_side: true,
        model_receives_compact_signal_evidence_only: true,
        maximum_signal_candidates: EXECUTIVE_SIGNAL_CANDIDATE_LIMIT,
        retained_signal_candidates: retainedSignals.length,
        maximum_original_records_per_signal: EXECUTIVE_ORIGINAL_RECORDS_PER_SIGNAL,
        maximum_supporting_memory_entries: EXECUTIVE_SUPPORTING_MEMORY_LIMIT
      }
    } satisfies Json;
    const compactContextTokens = estimateTokenCount(JSON.stringify({
      workspace_context: modelWorkspaceSnapshot,
      evidence_context: evidenceContextJson
    }));

    return { evidenceContextJson, modelWorkspaceSnapshot, selectedCitationIds, retained, compactContextTokens };
  };

  let compact = buildCompactContext();
  while (compact.compactContextTokens > EXECUTIVE_COMPACT_CONTEXT_TARGET_TOKENS) {
    if (memoryLimit > 0) {
      memoryLimit -= 1;
      trimmingSteps.push("supporting_memory");
    } else if (includeOptionalSecondRecords) {
      includeOptionalSecondRecords = false;
      trimmingSteps.push("optional_secondary_evidence");
    } else if (includeRequiredSecondRecords) {
      includeRequiredSecondRecords = false;
      trimmingSteps.push("required_secondary_evidence");
    } else if (retainedSignalCount > minimumSignalCount) {
      retainedSignalCount -= 1;
      trimmingSteps.push("lowest_ranked_optional_signal");
    } else if (originalExcerptLimit > 160) {
      originalExcerptLimit = Math.max(160, originalExcerptLimit - 40);
      memoryExcerptLimit = Math.max(120, memoryExcerptLimit - 40);
      trimmingSteps.push("excerpt_length");
    } else {
      break;
    }
    compact = buildCompactContext();
  }

  return {
    evidenceContextJson: compact.evidenceContextJson,
    modelWorkspaceSnapshot: compact.modelWorkspaceSnapshot,
    selectedCitationIds: compact.selectedCitationIds,
    metrics: {
      retrievedEvidenceCount: ranked.length,
      retainedEvidenceCount: compact.retained.length,
      retainedOriginalEvidenceCount: compact.retained.filter(({ item }) => item.evidenceRole === "original").length,
      retainedSupportingMemoryCount: compact.retained.filter(({ item }) => item.sourceType === "Business Memory").length,
      retainedSignalCount,
      compactContextTokens: compact.compactContextTokens,
      targetContextTokens: EXECUTIVE_COMPACT_CONTEXT_TARGET_TOKENS,
      trimmingSteps
    } satisfies ExecutivePromptCompactionMetrics
  };
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
  const signalSynthesis = buildExecutiveSignalSynthesisPlan(ranked);
  const signalByCitationId = new Map<number, ExecutiveSignalCandidate>();
  signalSynthesis.candidates.forEach((signal) => {
    signal.citationIds.forEach((citationId) => signalByCitationId.set(citationId, signal));
  });
  const selectedMemoryKeys = new Set(ranked.filter((item) => item.key.startsWith("memory:")).map((item) => item.key.slice("memory:".length)));
  const rankedMemoryContext: EvidenceContext = {
    ...evidenceContext,
    chunks: evidenceContext.chunks.filter((chunk) => selectedMemoryKeys.has(chunk.id))
  };
  const baseEvidence = evidenceContextAsJson(rankedMemoryContext) as JsonRecord;
  const compactPrompt = compactExecutivePromptContext({
    boundedContext,
    ranked,
    signalSynthesis,
    baseEvidence
  });
  const retainedSignalIds = new Set(signalSynthesis.candidates
    .filter((candidate) => candidate.citationIds.some((citationId) => compactPrompt.selectedCitationIds.has(citationId)))
    .map((candidate) => candidate.signalId));
  const retainedRelationships = signalSynthesis.relationships.filter((relationship) =>
    retainedSignalIds.has(relationship.leftSignalId) && retainedSignalIds.has(relationship.rightSignalId)
  );
  const compactSignalSynthesis: ExecutiveSignalSynthesisPlan = {
    candidates: signalSynthesis.candidates.filter((candidate) => retainedSignalIds.has(candidate.signalId)),
    relationships: retainedRelationships,
    minimumDistinctFindings: Math.min(signalSynthesis.minimumDistinctFindings, retainedSignalIds.size),
    requiredSignalIds: signalSynthesis.requiredSignalIds.filter((signalId) => retainedSignalIds.has(signalId)),
    requireCrossSignalAssessment: signalSynthesis.requireCrossSignalAssessment && retainedRelationships.length > 0
  };
  const catalog: ExecutiveCitationCatalogEntry[] = ranked.map((item, index) => ({
    citationId: index + 1,
    title: item.title,
    sourceType: item.sourceType,
    independentSourceKey: item.independentSourceKey,
    evidenceRole: item.evidenceRole,
    freshnessScore: item.rankingFactors.freshness,
    directRelevanceScore: item.rankingFactors.directRelevance,
    domain: item.domain,
    signalId: signalByCitationId.get(index + 1)?.signalId || null,
    findingEligible: item.findingEligible,
    executiveRank: signalByCitationId.get(index + 1)?.executiveRank || null
  })).filter((item) => compactPrompt.selectedCitationIds.has(item.citationId));
  const catalogByCitationId = new Map(catalog.map((item) => [item.citationId, item]));
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
  return {
    evidenceContextJson: compactPrompt.evidenceContextJson,
    modelWorkspaceSnapshot: compactPrompt.modelWorkspaceSnapshot,
    reasoningManifest: {
      mode: "executive_intelligence",
      question: query,
      execution_tier: plan.tier,
      loaded_domains: boundedContext.loadedDomains,
      reasoning_must_precede_writing: true,
      reasoning_stage_order: [
        "Review every bounded signal candidate and determine which conditions are meaningfully supported.",
        "Merge related evidence into one condition so repeated records do not become repeated findings.",
        "Rank distinct findings by verified executive impact, urgency, confidence, and freshness.",
        "Evaluate cross-signal relationships without assuming correlation or causation.",
        "Determine what is happening from the ranked distinct findings.",
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
      signal_synthesis: {
        candidate_limit: 6,
        candidates: compactSignalSynthesis.candidates.map((candidate) => {
          const citationIds = candidate.citationIds.filter((citationId) => compactPrompt.selectedCitationIds.has(citationId));
          const originalCitationIds = candidate.originalCitationIds.filter((citationId) => compactPrompt.selectedCitationIds.has(citationId));
          const independentSources = new Set(originalCitationIds
            .map((citationId) => catalogByCitationId.get(citationId)?.independentSourceKey)
            .filter((key): key is string => Boolean(key)));
          const currentIndependentSources = new Set(originalCitationIds
            .map((citationId) => catalogByCitationId.get(citationId))
            .filter((entry) => entry?.freshnessScore !== undefined && entry.freshnessScore >= 60)
            .map((entry) => entry?.independentSourceKey)
            .filter((key): key is string => Boolean(key)));
          return {
            signal_id: candidate.signalId,
            title: candidate.title,
            domains: candidate.domains,
            citation_ids: citationIds,
            original_citation_ids: originalCitationIds,
            independent_original_source_count: independentSources.size,
            current_independent_original_source_count: currentIndependentSources.size,
            priority_score: candidate.priorityScore,
            executive_rank: candidate.executiveRank
          };
        }),
        relationship_candidates: compactSignalSynthesis.relationships.map((relationship) => ({
          left_signal_id: relationship.leftSignalId,
          right_signal_id: relationship.rightSignalId,
          domains: relationship.domains,
          shared_terms: relationship.sharedTerms,
          evaluation_priority: relationship.evaluationPriority,
          policy: "Evaluate the relationship; do not assume correlation or causation."
        })),
        minimum_distinct_findings: compactSignalSynthesis.minimumDistinctFindings,
        required_signal_ids: compactSignalSynthesis.requiredSignalIds,
        require_cross_signal_assessment: compactSignalSynthesis.requireCrossSignalAssessment,
        policy: [
          "Evaluate every candidate before writing.",
          "Merge related citations inside one signal rather than repeating the same condition.",
          "Use distinct signal candidates for distinct findings.",
          "Rank the final findings by verified executive importance.",
          "A relationship candidate is a question to evaluate, not evidence of causation."
        ]
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
    signalSynthesis: compactSignalSynthesis,
    promptCompaction: compactPrompt.metrics,
    maximumEvidenceSufficiency
  };
}
