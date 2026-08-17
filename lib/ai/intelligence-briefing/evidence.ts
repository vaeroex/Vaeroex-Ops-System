import "server-only";

import {
  EVIDENCE_CANDIDATE_VERSION,
  type EvidenceCandidate,
  type EvidenceManifest
} from "@/lib/ai/evidence-engine/contracts";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { buildEvidenceManifest } from "@/lib/ai/evidence-engine/manifest";
import { buildSourceRegistry } from "@/lib/ai/evidence-engine/source-registry";
import type { IntelligenceBriefingEvidencePeriod } from "@/lib/ai/intelligence-briefing/contracts";
import { intelligenceBriefingKpiEvidenceKey } from "@/lib/ai/intelligence-briefing/identity";
import { dateFallsInBriefingPeriod } from "@/lib/ai/intelligence-briefing/period";
import type { IntelligenceInsight } from "@/lib/intelligence/layer";
import {
  getConfiguredMetricNames,
  kpiSemantics,
  kpiSettingForName,
  normalizeKpiName,
  type KpiSettingRow
} from "@/lib/kpis/settings";
import { evaluateKpiPerformance, resolveKpiTargetReference } from "@/lib/kpis/semantics";
import type { Database } from "@/lib/supabase/types";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];

const MAX_KPI_CANDIDATES = 24;
const MAX_FINDING_CANDIDATES = 24;
const MAX_RECORDS_PER_FINDING = 2;

function compact(value: string | null | undefined, maximum: number) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, Math.max(1, maximum - 3)).trim()}...`;
}

function safeIso(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function sourceFileIdFromKey(sourceKey: string) {
  const match = sourceKey.match(/^source-file:([0-9a-f-]{36})$/i);
  return match?.[1] || null;
}

function safeAppHref(value: string | null | undefined, fallback: `/app/${string}`): `/app/${string}` {
  return value?.startsWith("/app/") ? value as `/app/${string}` : fallback;
}

function confidenceScore(confidence: IntelligenceInsight["confidence"]) {
  return confidence === "High" ? 90 : confidence === "Medium" ? 70 : 45;
}

function candidateBase({
  workspaceId,
  candidateId,
  domain,
  recordType,
  title,
  excerpt,
  summary,
  sourceType,
  sourceId,
  sourceFileId,
  parentSourceId,
  canonicalSourceKey,
  independentSourceKey,
  recordedAt,
  lineageVersion,
  eligibilityDecisionVersion,
  quality,
  confidence,
  baseRank
}: {
  workspaceId: string;
  candidateId: string;
  domain: string;
  recordType: string;
  title: string;
  excerpt: string;
  summary: string | null;
  sourceType: string;
  sourceId: string | null;
  sourceFileId: string | null;
  parentSourceId: string | null;
  canonicalSourceKey: string;
  independentSourceKey: string | null;
  recordedAt: string | null;
  lineageVersion: string;
  eligibilityDecisionVersion: string;
  quality: string;
  confidence: number;
  baseRank: number;
}): EvidenceCandidate {
  return {
    version: EVIDENCE_CANDIDATE_VERSION,
    candidateId,
    workspaceId,
    domain: compact(domain, 80) || "Operations",
    recordType: compact(recordType, 80),
    title: compact(title, 180),
    excerpt: compact(excerpt, 780),
    summary: compact(summary, 360) || null,
    evidenceRole: "original",
    source: {
      sourceType: compact(sourceType, 80),
      sourceId,
      sourceFileId,
      parentSourceId,
      canonicalSourceKey,
      independentSourceKey
    },
    provenance: {
      recordId: candidateId,
      indexedAt: recordedAt || "1970-01-01T00:00:00.000Z",
      recordedAt,
      lineageVersion
    },
    eligibility: {
      eligible: true,
      lifecycleState: "active",
      originalEvidenceEligible: true,
      decisionVersion: eligibilityDecisionVersion
    },
    quality,
    confidenceScore: confidence,
    retrieval: {
      mode: "structured",
      baseRank,
      score: null,
      embeddingVersion: null
    }
  };
}

function targetText(target: ReturnType<typeof resolveKpiTargetReference>) {
  if (target.kind === "scalar") return String(target.value);
  if (target.kind === "range") return `${target.min} to ${target.max}`;
  return "not configured";
}

function kpiCandidates({
  workspaceId,
  rows,
  settings,
  period,
  sourceLabelsById
}: {
  workspaceId: string;
  rows: readonly KpiRow[];
  settings: readonly KpiSettingRow[];
  period: IntelligenceBriefingEvidencePeriod;
  sourceLabelsById: Readonly<Record<string, string>>;
}) {
  const periodRows = rows.filter((row) => row.workspace_id === workspaceId && dateFallsInBriefingPeriod(row.metric_date, period));
  const candidateIdsByMetric = new Map<string, string[]>();
  const hrefByCandidateId = new Map<string, `/app/${string}`>();
  const sourceLabelByCandidateId = new Map<string, string>();
  const candidates: EvidenceCandidate[] = [];

  for (const metricName of getConfiguredMetricNames(periodRows as KpiRow[], settings as KpiSettingRow[], true)) {
    if (candidates.length >= MAX_KPI_CANDIDATES) break;
    const semantics = kpiSemantics(metricName, settings as KpiSettingRow[]);
    if (semantics.desiredDirection === "unknown" || semantics.metricRole !== "actual") continue;
    const metricRows = periodRows
      .filter((row) => normalizeKpiName(row.name) === normalizeKpiName(metricName) && row.actual_value !== null)
      .sort((left, right) => left.metric_date.localeCompare(right.metric_date) || left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
    const latest = metricRows.at(-1);
    if (!latest || latest.actual_value === null) continue;
    const previous = metricRows.at(-2) || null;
    const setting = kpiSettingForName(settings as KpiSettingRow[], metricName);
    const manualTarget = setting?.target ?? latest.target ?? null;
    const target = resolveKpiTargetReference(semantics, manualTarget);
    const evaluation = evaluateKpiPerformance({ observations: metricRows, semantics, target: manualTarget });
    const identity = intelligenceBriefingKpiEvidenceKey(semantics);
    const candidateId = `IB-KPI-${evidenceEngineHash({ identity, observationId: latest.id }).slice(0, 24)}`;
    const sourceKey = latest.source_file_id
      ? `source-file:${latest.source_file_id}`
      : latest.import_id
        ? `import:${latest.import_id}`
        : `canonical-kpi:${evidenceEngineHash(identity)}`;
    const sourceLabel = latest.source_file_id
      ? sourceLabelsById[latest.source_file_id] || latest.source || "KPI source"
      : latest.source || "Canonical KPI record";
    const unit = semantics.unit ? ` ${semantics.unit}` : "";
    const excerpt = [
      `Latest ${latest.actual_value}${unit} on ${latest.metric_date}.`,
      previous?.actual_value === null || previous?.actual_value === undefined
        ? "No earlier observation is available within this briefing period."
        : `Previous ${previous.actual_value}${unit} on ${previous.metric_date}.`,
      `Movement ${evaluation.rawMovement}; performance effect ${evaluation.latestPerformanceEffect}; target status ${evaluation.targetStatus}.`,
      `Authoritative target ${targetText(target)}.`
    ].join(" ");
    candidates.push(candidateBase({
      workspaceId,
      candidateId,
      domain: setting?.category || latest.category || semantics.displayName,
      recordType: "Canonical KPI observation",
      title: semantics.displayName,
      excerpt,
      summary: semantics.rationale,
      sourceType: "KPI evidence",
      sourceId: latest.id,
      sourceFileId: latest.source_file_id,
      parentSourceId: latest.import_id,
      canonicalSourceKey: sourceKey,
      independentSourceKey: sourceKey,
      recordedAt: safeIso(`${latest.metric_date}T00:00:00.000Z`),
      lineageVersion: "intelligence_briefing_kpi_lineage_v1",
      eligibilityDecisionVersion: "intelligence_briefing_kpi_eligibility_v1",
      quality: semantics.classificationConfirmed || semantics.classificationSource === "user" ? "high" : "medium",
      confidence: semantics.classificationConfirmed || semantics.classificationSource === "user" ? 90 : 75,
      baseRank: candidates.length + 1
    }));
    candidateIdsByMetric.set(identity, [candidateId]);
    hrefByCandidateId.set(candidateId, `/app/kpis?metric=${encodeURIComponent(metricName)}&section=detail#kpi-detail`);
    sourceLabelByCandidateId.set(candidateId, compact(sourceLabel, 180));
  }

  return { candidates, candidateIdsByMetric, hrefByCandidateId, sourceLabelByCandidateId };
}

function findingCandidates({
  workspaceId,
  insights,
  period,
  startingRank,
  sourceLabelsById
}: {
  workspaceId: string;
  insights: readonly IntelligenceInsight[];
  period: IntelligenceBriefingEvidencePeriod;
  startingRank: number;
  sourceLabelsById: Readonly<Record<string, string>>;
}) {
  const candidateIdsByFinding = new Map<string, string[]>();
  const hrefByCandidateId = new Map<string, `/app/${string}`>();
  const sourceLabelByCandidateId = new Map<string, string>();
  const candidatesById = new Map<string, EvidenceCandidate>();
  const priority = { High: 0, Medium: 1, Low: 2 } as const;
  const orderedInsights = [...insights].sort((left, right) =>
    priority[left.priority] - priority[right.priority]
    || right.lastUpdated.localeCompare(left.lastUpdated)
    || left.fingerprint.localeCompare(right.fingerprint)
  );

  for (const insight of orderedInsights) {
    if (candidatesById.size >= MAX_FINDING_CANDIDATES) break;
    const records = [...insight.supportingRecords]
      .filter((record) => record.classification !== "Derived" && dateFallsInBriefingPeriod(record.date, period))
      .sort((left, right) => (safeIso(right.date) || "").localeCompare(safeIso(left.date) || "") || left.id.localeCompare(right.id))
      .slice(0, MAX_RECORDS_PER_FINDING);
    for (const record of records) {
      if (candidatesById.size >= MAX_FINDING_CANDIDATES) break;
      const candidateId = `IB-FINDING-${evidenceEngineHash({ recordId: record.id, sourceKey: record.sourceKey }).slice(0, 24)}`;
      const sourceFileId = sourceFileIdFromKey(record.sourceKey);
      const candidate = candidateBase({
        workspaceId,
        candidateId,
        domain: insight.affectedArea || record.groupHint || "Operations",
        recordType: record.recordType,
        title: record.title,
        excerpt: `${record.value}. ${record.support}`,
        summary: insight.summary,
        sourceType: record.recordType,
        sourceId: record.id,
        sourceFileId,
        parentSourceId: null,
        canonicalSourceKey: record.sourceKey,
        independentSourceKey: record.sourceKey,
        recordedAt: safeIso(record.date),
        lineageVersion: "intelligence_briefing_finding_lineage_v1",
        eligibilityDecisionVersion: "intelligence_briefing_finding_eligibility_v1",
        quality: record.classification === "Original" ? "high" : "medium",
        confidence: confidenceScore(insight.confidence),
        baseRank: startingRank + candidatesById.size + 1
      });
      candidatesById.set(candidateId, candidatesById.get(candidateId) || candidate);
      const current = candidateIdsByFinding.get(insight.id) || [];
      if (!current.includes(candidateId)) candidateIdsByFinding.set(insight.id, [...current, candidateId]);
      hrefByCandidateId.set(
        candidateId,
        sourceFileId ? `/app/sources/${sourceFileId}` : safeAppHref(insight.sourceHref, "/app/intelligence")
      );
      sourceLabelByCandidateId.set(candidateId, sourceFileId ? sourceLabelsById[sourceFileId] || record.title : record.title);
    }
  }

  return {
    candidates: [...candidatesById.values()],
    candidateIdsByFinding,
    hrefByCandidateId,
    sourceLabelByCandidateId
  };
}

export type IntelligenceBriefingEvidenceBuild = Readonly<{
  manifest: EvidenceManifest;
  candidateIdsByMetric: ReadonlyMap<string, readonly string[]>;
  candidateIdsByFinding: ReadonlyMap<string, readonly string[]>;
  citationIdsByMetric: ReadonlyMap<string, readonly number[]>;
  citationIdsByFinding: ReadonlyMap<string, readonly number[]>;
  evidenceReferenceIdsByMetric: ReadonlyMap<string, readonly string[]>;
  hrefByCandidateId: ReadonlyMap<string, `/app/${string}`>;
  sourceLabelByCandidateId: ReadonlyMap<string, string>;
}>;

export function buildIntelligenceBriefingEvidence({
  workspaceId,
  period,
  kpiRows,
  kpiSettings,
  insights,
  sourceLabelsById,
  generatedAt
}: {
  workspaceId: string;
  period: IntelligenceBriefingEvidencePeriod;
  kpiRows: readonly KpiRow[];
  kpiSettings: readonly KpiSettingRow[];
  insights: readonly IntelligenceInsight[];
  sourceLabelsById: Readonly<Record<string, string>>;
  generatedAt: string;
}): IntelligenceBriefingEvidenceBuild {
  if (kpiRows.some((row) => row.workspace_id !== workspaceId) || kpiSettings.some((setting) => setting.workspace_id !== workspaceId)) {
    throw new Error("Intelligence briefing evidence received data from another workspace.");
  }
  const kpis = kpiCandidates({ workspaceId, rows: kpiRows, settings: kpiSettings, period, sourceLabelsById });
  const findings = findingCandidates({ workspaceId, insights, period, startingRank: kpis.candidates.length, sourceLabelsById });
  const candidates = [...kpis.candidates, ...findings.candidates]
    .sort((left, right) => left.retrieval.baseRank - right.retrieval.baseRank || left.candidateId.localeCompare(right.candidateId));
  const sourceRegistry = buildSourceRegistry({ workspaceId, candidates });
  const manifest = buildEvidenceManifest({
    workspaceId,
    queryText: "Prepare a bounded Weekly or Monthly Intelligence Briefing from canonical executive intelligence.",
    candidates,
    sourceRegistry,
    generatedAt,
    candidateRetrieverVersion: "intelligence_briefing_structured_retriever_v1",
    embeddingVersion: null,
    rerankerVersion: "deterministic_noop_reranker_v1",
    signalPlannerVersion: "intelligence_briefing_section_planner_v1"
  });
  const citationByCandidate = new Map(manifest.evidence.map((entry) => [entry.candidateId, entry.citationId]));
  const citationIds = (candidateIds: readonly string[]) => candidateIds.flatMap((id) => {
    const citationId = citationByCandidate.get(id);
    return citationId ? [citationId] : [];
  }).sort((left, right) => left - right);
  const mapCitations = (source: ReadonlyMap<string, readonly string[]>) => new Map(
    [...source.entries()].map(([key, ids]) => [key, citationIds(ids)] as const)
  );
  const evidenceReferenceIdsByMetric = new Map(
    [...kpis.candidateIdsByMetric.entries()].map(([key, ids]) => [
      key,
      ids.map((candidateId) => `manifest:${manifest.manifestId}:${candidateId}`)
    ] as const)
  );

  return {
    manifest,
    candidateIdsByMetric: kpis.candidateIdsByMetric,
    candidateIdsByFinding: findings.candidateIdsByFinding,
    citationIdsByMetric: mapCitations(kpis.candidateIdsByMetric),
    citationIdsByFinding: mapCitations(findings.candidateIdsByFinding),
    evidenceReferenceIdsByMetric,
    hrefByCandidateId: new Map([...kpis.hrefByCandidateId, ...findings.hrefByCandidateId]),
    sourceLabelByCandidateId: new Map([...kpis.sourceLabelByCandidateId, ...findings.sourceLabelByCandidateId])
  };
}
