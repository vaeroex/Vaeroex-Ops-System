import type { Database } from "@/lib/supabase/types";
import { buildKpiForecastEligibility, type KpiForecastEligibilitySummary } from "@/lib/kpis/forecast-eligibility";
import { excludeChecklistDerivedMetrics, excludeChecklistDerivedRecords } from "@/lib/intelligence/checklist-retirement";
import { filterOriginalBusinessEvidence, independentOriginalEvidenceKeys } from "@/lib/intelligence/evidence-eligibility";
import {
  calculateBusinessHealthPerformance,
  calculateIntelligenceReadiness,
  type BusinessHealthPerformanceSignal
} from "@/lib/intelligence/business-health-formula";
import { buildSourceParentEligibility, filterBySourceParentEligibility } from "@/lib/intelligence/source-parent-eligibility";
import { compareKpiRowsNewest, groupKpisByNormalizedName, normalizeKpiName } from "@/lib/intelligence/kpi-identity";
import { applyKpiSettingsToRows, kpiSemantics, type KpiSettingRow } from "@/lib/kpis/settings";
import {
  effectiveKpiTarget,
  evaluateKpiPerformance,
  isKpiTargetMet,
  isKpiTargetMiss,
  kpiTargetGapRatio,
  type KpiPerformanceEvaluation,
  type KpiSemantics
} from "@/lib/kpis/semantics";

export type IntelligenceInsightType = "Risk" | "Opportunity" | "Forecast" | "Bottleneck" | "Recommendation" | "Anomaly";
export type IntelligenceConfidence = "High" | "Medium" | "Low";

export type BusinessHealthDriverImpact = Readonly<{
  findingId: string;
  kind: "risk" | "opportunity";
  scoreImpact: number;
}>;

export type IntelligenceEvidenceRecord = {
  id: string;
  title: string;
  recordType: string;
  date: string;
  value: string;
  support: string;
  href: string;
  classification: "Original" | "Manual" | "Derived";
  sourceKey: string;
  groupHint?: string;
};

export type IntelligenceInsight = {
  id: string;
  type: IntelligenceInsightType;
  title: string;
  summary: string;
  why: string;
  impact: string;
  recommendedAction: string;
  confidence: IntelligenceConfidence;
  evidence: string[];
  evidenceCount: number;
  supportingRecords: IntelligenceEvidenceRecord[];
  independentSourceCount: number;
  contradictoryEvidence: string[];
  missingEvidence: string[];
  sourceTypes: string[];
  sourceHref: string;
  priority: "High" | "Medium" | "Low";
  lastUpdated: string;
  affectedArea: string;
  timePeriod: string;
  limitation: string;
  fingerprint: string;
  suggestedNextData?: string;
  businessHealthEffect?: Readonly<{
    identity: string;
    points: 8 | 10;
  }>;
};

export type IntelligenceLayerResult = {
  executiveSummary: string;
  businessHealth: {
    available: boolean;
    unavailableReason: "insufficient_original_evidence" | "no_evaluable_performance_outcome" | null;
    score: number;
    status: "Strong" | "Watch" | "At Risk" | "Insufficient Data";
    trend: "Improving" | "Holding steady" | "Declining" | "Not enough history";
    components: {
      dataQualityBase: number;
      riskPenalty: number;
      opportunityAdjustment: number;
      driverImpacts: BusinessHealthDriverImpact[];
    };
  };
  dataQuality: {
    score: number;
    label: "Strong" | "Developing" | "Limited";
    confidence: IntelligenceConfidence;
    reason: string;
    suggestedNextData: string[];
  };
  forecastReadiness: Pick<
    KpiForecastEligibilitySummary,
    | "state"
    | "label"
    | "reason"
    | "ready"
    | "directional"
    | "currentKpiCount"
    | "totalMeasurementCount"
    | "readyKpiCount"
    | "directionalKpiCount"
    | "historicalDepthLabel"
    | "freshnessLabel"
  >;
  topRisk?: IntelligenceInsight;
  topOpportunity?: IntelligenceInsight;
  topRecommendation?: IntelligenceInsight;
  topForecast?: IntelligenceInsight;
  insights: IntelligenceInsight[];
  memorySummary: {
    profileSignals: number;
    sourceRecords: number;
    kpiHistoryRecords: number;
    vaeroexRuns: number;
    decisions: number;
    recommendationOutcomes: number;
    eligibleSignalCategories: readonly EligibleBusinessSignalCategory[];
  };
};

export type EligibleBusinessSignalCategory = Readonly<{
  id:
    | "kpi_observations"
    | "kpi_series"
    | "files"
    | "process_documents"
    | "forms"
    | "form_submissions"
    | "operational_issues"
    | "customer_records"
    | "organization_context";
  label: string;
  count: number;
}>;

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type FormRow = Database["public"]["Tables"]["forms"]["Row"];
type FormSubmissionRow = Database["public"]["Tables"]["form_submissions"]["Row"];
type PersonRow = Database["public"]["Tables"]["people"]["Row"];
type DecisionRow = Database["public"]["Tables"]["business_decisions"]["Row"];

export type IntelligenceLayerInput = {
  asOf?: Date | string;
  workspace?: {
    name?: string | null;
    industry?: string | null;
    size?: string | null;
  } | null;
  kpis?: KpiRow[];
  kpiSettings?: KpiSettingRow[];
  issues?: IssueRow[];
  files?: FileUploadRow[];
  vaeroexRuns?: VaeroexRunRow[];
  crmLeads?: CrmLeadRow[];
  imports?: FileImportRow[];
  sops?: SopRow[];
  forms?: FormRow[];
  submissions?: FormSubmissionRow[];
  people?: PersonRow[];
  decisions?: DecisionRow[];
  operationalInsights?: IntelligenceInsight[];
};

const currencyFormatter = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function lower(value: string | null | undefined) {
  return (value || "").toLowerCase();
}

function isClosed(value: string | null | undefined) {
  return ["closed", "done", "complete", "completed", "converted", "won", "dismissed"].includes(lower(value));
}

function isOverdue(date: string | null | undefined) {
  return Boolean(date && date < new Date().toISOString().slice(0, 10));
}

function priorityFrom(value: string | null | undefined): "High" | "Medium" | "Low" {
  const normalized = lower(value);

  if (normalized.includes("urgent") || normalized.includes("high")) return "High";
  if (normalized.includes("medium") || normalized.includes("review") || normalized.includes("waiting")) return "Medium";
  return "Low";
}

function formatMetric(value: number | null, name: string) {
  if (value === null) return "not set";
  return /revenue|cost|value|sales/i.test(name) ? currencyFormatter.format(value) : numberFormatter.format(value);
}

function latestKpisByName(kpis: KpiRow[]) {
  return Array.from(groupKpisByNormalizedName(kpis).values()).map((rows) => rows[0]);
}

function kpiHistoryCounts(kpis: KpiRow[]) {
  const map = new Map<string, number>();

  for (const kpi of kpis) {
    const key = normalizeKpiName(kpi.name);
    map.set(key, (map.get(key) || 0) + 1);
  }

  return map;
}

function kpiHistoryByName(kpis: KpiRow[]) {
  const map = new Map<string, KpiRow[]>();

  for (const kpi of [...kpis].sort(compareKpiRowsNewest)) {
    const key = normalizeKpiName(kpi.name);
    map.set(key, [...(map.get(key) || []), kpi]);
  }

  return map;
}

function recordClassification(row: { source_file_id?: string | null; import_id?: string | null; ai_generated?: boolean | null }) {
  if (row.ai_generated) return "Derived" as const;
  if (row.source_file_id || row.import_id) return "Original" as const;
  return "Manual" as const;
}

function evidenceRecord({
  id,
  title,
  recordType,
  date,
  value,
  support,
  href,
  sourceKey,
  groupHint,
  classification = "Original"
}: IntelligenceEvidenceRecord) {
  return { id, title, recordType, date, value, support, href, sourceKey, classification, groupHint };
}

function kpiEvidenceRecord(kpi: KpiRow, semantics: KpiSemantics, support: string): IntelligenceEvidenceRecord {
  const sourceKey = kpi.source_file_id
    ? `source-file:${kpi.source_file_id}`
    : kpi.import_id
      ? `import:${kpi.import_id}`
      : `manual-kpi:${normalizeKpiName(kpi.name)}`;

  const reference = targetReference(kpi, semantics);
  return evidenceRecord({
    id: `kpi:${kpi.id}`,
    title: kpi.name,
    recordType: "KPI record",
    date: kpi.metric_date,
    value: `Actual ${formatMetric(kpi.actual_value, kpi.name)}${reference ? ` · ${reference[0].toUpperCase()}${reference.slice(1)}` : ""}`,
    support,
    href: `/app/kpis?metric=${encodeURIComponent(kpi.name)}&section=detail`,
    classification: recordClassification(kpi),
    sourceKey,
    groupHint: kpi.category || kpi.name
  });
}

function canonicalTopic(value: string) {
  const normalized = lower(value);
  if (/response.?time/.test(normalized)) return "response-time";
  if (/follow.?up|overdue/.test(normalized)) return "customer-follow-up";
  if (/conversion/.test(normalized)) return "conversion";
  if (/revenue|sales/.test(normalized)) return "revenue";
  if (/handoff|handover/.test(normalized)) return "handoff";
  if (/sop|process knowledge/.test(normalized)) return "process-knowledge";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "general";
}

function canonicalCondition(value: string, typeGroup: string) {
  const normalized = lower(value);
  if (/dropped|declin|fell|missed target/.test(normalized) || (typeGroup === "risk" && /below target/.test(normalized))) return "performance-gap";
  if (typeGroup === "risk" && /above target|outside target|(?:above|below) acceptable range/.test(normalized)) return "performance-gap";
  if (/unclear|missing|not documented|limited context/.test(normalized)) return "missing-context";
  if (/stale|older than/.test(normalized)) return "stale";
  if (/above target|meets|exceeds|improv/.test(normalized)) return "positive-performance";
  if (typeGroup === "opportunity" && /on target|on or (?:above|below) target|within (?:its )?target range/.test(normalized)) return "positive-performance";
  return "review";
}

function findingFingerprint(insight: Pick<IntelligenceInsight, "type" | "title" | "summary" | "affectedArea" | "timePeriod">) {
  const typeGroup = ["Risk", "Bottleneck", "Anomaly"].includes(insight.type) ? "risk" : insight.type.toLowerCase();
  const topic = canonicalTopic(`${insight.affectedArea} ${insight.title}`);
  const condition = canonicalCondition(`${insight.title} ${insight.summary}`, typeGroup);
  const normalizedPeriod = /^\d{4}-\d{2}/.test(insight.timePeriod) ? insight.timePeriod.slice(0, 7) : lower(insight.timePeriod) || "current";
  return `${typeGroup}:${topic}:${condition}:${normalizedPeriod}`;
}

function canonicalKpiPerformanceIdentity(semantics: KpiSemantics) {
  return [
    semantics.canonicalName.trim().toLowerCase(),
    semantics.metricRole,
    `${semantics.scale}`,
    (semantics.unit || "").trim().toLowerCase()
  ].join("|");
}

function distinctDatedKpiHistory(history: KpiRow[]) {
  const byDate = new Map<string, KpiRow>();
  for (const row of [...history].sort(compareKpiRowsNewest)) {
    if (row.actual_value === null || !Number.isFinite(row.actual_value) || !/^\d{4}-\d{2}-\d{2}/.test(row.metric_date || "")) continue;
    const date = row.metric_date.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, row);
  }
  return [...byDate.values()].sort((left, right) => left.metric_date.localeCompare(right.metric_date));
}

function canonicalKpiReadinessCounts(kpis: KpiRow[], settings: KpiSettingRow[], asOf: Date | string | undefined) {
  const parsedAsOf = typeof asOf === "string" ? new Date(asOf) : asOf || new Date();
  const referenceDate = Number.isNaN(parsedAsOf.getTime()) ? new Date() : parsedAsOf;
  const byIdentity = new Map<string, Set<string>>();

  for (const row of kpis) {
    const semantics = kpiSemantics(row.name, settings);
    const identity = canonicalKpiPerformanceIdentity(semantics);
    const dates = byIdentity.get(identity) || new Set<string>();
    if (row.actual_value !== null && Number.isFinite(row.actual_value) && /^\d{4}-\d{2}-\d{2}/.test(row.metric_date || "")) {
      dates.add(row.metric_date.slice(0, 10));
    }
    byIdentity.set(identity, dates);
  }

  const series = [...byIdentity.values()];
  return {
    count: series.length,
    withHistoricalDepth: series.filter((dates) => dates.size >= 4).length,
    fresh: series.filter((dates) => {
      const latest = [...dates].sort().at(-1);
      if (!latest) return false;
      const latestDate = new Date(`${latest}T12:00:00.000Z`);
      return !Number.isNaN(latestDate.getTime()) && Math.floor((referenceDate.getTime() - latestDate.getTime()) / 86400000) <= 45;
    }).length
  };
}

function isSustainedFavorableTrend({ kpi, semantics, evaluation, history }: EvaluatedKpiTarget) {
  if (
    semantics.desiredDirection === "unknown"
    || semantics.desiredDirection === "target_range"
    || semantics.desiredDirection === "exact_target"
    || semantics.desiredDirection === "maintain"
    || effectiveKpiTarget(semantics, kpi.target) !== null
  ) return false;
  const datedHistory = distinctDatedKpiHistory(history);
  if (datedHistory.length < 4 || evaluation.selectedRangeTrend !== "favorable") return false;
  const intervalEffects = datedHistory.slice(1).map((row, index) => evaluateKpiPerformance({
    observations: [datedHistory[index], row],
    semantics,
    target: null
  }).latestPerformanceEffect);
  const determinate = intervalEffects.filter((effect) => effect === "favorable" || effect === "unfavorable" || effect === "neutral");
  const favorable = determinate.filter((effect) => effect === "favorable").length;
  return determinate.length > 0 && favorable / determinate.length >= 0.6;
}

function riskPerformanceDescriptor(insight: IntelligenceInsight, canonicalKpiIdentityByLabel: Map<string, string>) {
  const dependencies = insight.supportingRecords.map((record) => {
    const kpiIdentity = canonicalKpiIdentityByLabel.get(normalizeKpiName(record.title));
    if (kpiIdentity) return `kpi:${kpiIdentity}`;
    if (record.id.startsWith("issue:")) return record.id;
    return `${record.recordType.trim().toLowerCase()}:${record.sourceKey}:${record.title.trim().toLowerCase()}`;
  });
  const canonicalDependencies = [...new Set(dependencies)].sort();
  return {
    insight,
    condition: canonicalCondition(`${insight.title} ${insight.summary}`, "risk"),
    dependencies: new Set(canonicalDependencies.length ? canonicalDependencies : [`finding:${insight.id}`]),
    points: insight.priority === "High" ? 18 : insight.priority === "Medium" ? 10 : 4
  };
}

function negativePerformanceSignals(insights: IntelligenceInsight[], canonicalKpiIdentityByLabel: Map<string, string>) {
  const descriptors = insights
    .map((insight) => riskPerformanceDescriptor(insight, canonicalKpiIdentityByLabel))
    .sort((left, right) => left.condition.localeCompare(right.condition) || [...left.dependencies].join("|").localeCompare([...right.dependencies].join("|")) || left.insight.id.localeCompare(right.insight.id));
  const groups: Array<{
    condition: string;
    dependencies: Set<string>;
    descriptors: typeof descriptors;
  }> = [];

  for (const descriptor of descriptors) {
    const matchingIndexes = groups.flatMap((group, index) =>
      group.condition === descriptor.condition && [...descriptor.dependencies].some((dependency) => group.dependencies.has(dependency))
        ? [index]
        : []
    );
    if (!matchingIndexes.length) {
      groups.push({ condition: descriptor.condition, dependencies: new Set(descriptor.dependencies), descriptors: [descriptor] });
      continue;
    }

    const first = groups[matchingIndexes[0]];
    first.descriptors.push(descriptor);
    descriptor.dependencies.forEach((dependency) => first.dependencies.add(dependency));
    for (const index of matchingIndexes.slice(1).reverse()) {
      const overlapping = groups[index];
      overlapping.descriptors.forEach((item) => first.descriptors.push(item));
      overlapping.dependencies.forEach((dependency) => first.dependencies.add(dependency));
      groups.splice(index, 1);
    }
  }

  return groups.map((group) => {
    const strongest = [...group.descriptors].sort((left, right) => right.points - left.points || left.insight.id.localeCompare(right.insight.id))[0];
    return {
      identity: `${group.condition}|${[...group.dependencies].sort().join("+")}`,
      findingId: strongest.insight.id,
      points: strongest.points
    };
  });
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function consolidateDuplicateInsights(insights: IntelligenceInsight[]) {
  const grouped = new Map<string, IntelligenceInsight>();

  sortInsights(insights).forEach((insight) => {
    const fingerprint = insight.fingerprint || findingFingerprint(insight);
    const current = grouped.get(fingerprint);
    if (!current) {
      grouped.set(fingerprint, { ...insight, fingerprint });
      return;
    }

    const supportingRecords = uniqueBy([...current.supportingRecords, ...insight.supportingRecords], (record) => record.id);
    const independentSourceCount = new Set(supportingRecords.filter((record) => record.classification !== "Derived").map((record) => record.sourceKey)).size;
    grouped.set(fingerprint, {
      ...current,
      evidence: uniqueBy([...current.evidence, ...insight.evidence], (item) => item),
      supportingRecords,
      evidenceCount: supportingRecords.length,
      independentSourceCount,
      confidence: current.confidence === "High" || insight.confidence === "High" || independentSourceCount >= 2 ? "High" : current.confidence,
      contradictoryEvidence: uniqueBy([...current.contradictoryEvidence, ...insight.contradictoryEvidence], (item) => item),
      missingEvidence: uniqueBy([...current.missingEvidence, ...insight.missingEvidence], (item) => item),
      sourceTypes: uniqueBy([...current.sourceTypes, ...insight.sourceTypes], (item) => item),
      lastUpdated: [current.lastUpdated, insight.lastUpdated].sort().at(-1) || current.lastUpdated,
      businessHealthEffect: !current.businessHealthEffect
        ? insight.businessHealthEffect
        : !insight.businessHealthEffect || current.businessHealthEffect.points >= insight.businessHealthEffect.points
          ? current.businessHealthEffect
          : insight.businessHealthEffect
    });
  });

  return sortInsights(Array.from(grouped.values()));
}

function confidenceFromEvidence(count: number, priority: "High" | "Medium" | "Low" = "Medium"): IntelligenceConfidence {
  if (count >= 4 || priority === "High") return "High";
  if (count >= 2 || priority === "Medium") return "Medium";
  return "Low";
}

function sortInsights(insights: IntelligenceInsight[]) {
  const priorityRank = { High: 3, Medium: 2, Low: 1 };
  const confidenceRank = { High: 3, Medium: 2, Low: 1 };

  return [...insights].sort((a, b) => {
    const priorityDelta = priorityRank[b.priority] - priorityRank[a.priority];
    if (priorityDelta) return priorityDelta;
    const confidenceDelta = confidenceRank[b.confidence] - confidenceRank[a.confidence];
    if (confidenceDelta) return confidenceDelta;
    return b.lastUpdated.localeCompare(a.lastUpdated);
  });
}

function latestDate(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().at(-1) || new Date().toISOString();
}

const MATERIAL_TARGET_GAP_RATIO = 0.1;

type EvaluatedKpiTarget = {
  kpi: KpiRow;
  semantics: KpiSemantics;
  evaluation: KpiPerformanceEvaluation;
  history: KpiRow[];
  gapRatio: number | null;
};

function targetReference(kpi: KpiRow, semantics: KpiSemantics) {
  if (semantics.desiredDirection === "target_range" && semantics.idealRangeMin !== null && semantics.idealRangeMax !== null) {
    return `acceptable range ${formatMetric(semantics.idealRangeMin, kpi.name)} to ${formatMetric(semantics.idealRangeMax, kpi.name)}`;
  }
  const target = effectiveKpiTarget(semantics, kpi.target);
  return target === null ? null : `target ${formatMetric(target, kpi.name)}`;
}

function targetMissLabel(status: KpiPerformanceEvaluation["targetStatus"], semantics: KpiSemantics) {
  if (status === "below_required_minimum") return semantics.desiredDirection === "target_range" ? "below acceptable range" : "below target";
  if (status === "above_acceptable_maximum") return semantics.desiredDirection === "target_range" ? "above acceptable range" : "above target";
  return "outside target";
}

function targetSuccessLabel(semantics: KpiSemantics) {
  if (semantics.desiredDirection === "maximize") return "on or above target";
  if (semantics.desiredDirection === "minimize") return "on or below target";
  if (semantics.desiredDirection === "target_range") return "within its target range";
  return "on target";
}

function evaluateKpiTarget(kpi: KpiRow, history: KpiRow[], settings: KpiSettingRow[]): EvaluatedKpiTarget {
  const semantics = kpiSemantics(kpi.name, settings);
  const evaluation = evaluateKpiPerformance({ observations: [...history].reverse(), semantics, target: kpi.target });
  return {
    kpi,
    semantics,
    evaluation,
    history,
    gapRatio: kpiTargetGapRatio({ value: kpi.actual_value, semantics, target: kpi.target })
  };
}

function isMaterialTargetMiss(row: KpiRow, semantics: KpiSemantics) {
  const evaluation = evaluateKpiPerformance({ observations: [row], semantics, target: row.target });
  const gapRatio = kpiTargetGapRatio({ value: row.actual_value, semantics, target: row.target });
  return isKpiTargetMiss(evaluation.targetStatus) && gapRatio !== null && gapRatio > MATERIAL_TARGET_GAP_RATIO;
}

export function buildIntelligenceLayer(input: IntelligenceLayerInput): IntelligenceLayerResult {
  const workspace = input.workspace || null;
  const files = filterOriginalBusinessEvidence(input.files);
  const parentEligibility = buildSourceParentEligibility({ files, imports: input.imports || [] });
  const kpiSettings = excludeChecklistDerivedMetrics(input.kpiSettings || []);
  const kpis = applyKpiSettingsToRows(
    excludeChecklistDerivedMetrics(filterBySourceParentEligibility(filterOriginalBusinessEvidence(input.kpis), parentEligibility)),
    kpiSettings,
    { includeHidden: true }
  );
  const issues = excludeChecklistDerivedRecords(filterOriginalBusinessEvidence(input.issues));
  const vaeroexRuns: VaeroexRunRow[] = [];
  // Customer activity is evidence only when it is traceable to an import or file.
  const crmLeads = filterBySourceParentEligibility(filterOriginalBusinessEvidence(input.crmLeads), parentEligibility)
    .filter((lead) => Boolean(lead.source_file_id || lead.import_id));
  const imports = [] as FileImportRow[];
  const sops = filterOriginalBusinessEvidence(input.sops);
  const forms = filterOriginalBusinessEvidence(input.forms);
  const activeFormIds = new Set(forms.map((form) => form.id));
  const submissions = filterOriginalBusinessEvidence(input.submissions).filter((submission) => activeFormIds.has(submission.form_id));
  const people = filterOriginalBusinessEvidence(input.people);
  const decisions: DecisionRow[] = [];
  const operationalInsights = input.operationalInsights || [];
  const openIssues = issues.filter((issue) => !isClosed(issue.status));
  const latestKpis = latestKpisByName(kpis);
  const historyCounts = kpiHistoryCounts(kpis);
  const historyByName = kpiHistoryByName(kpis);
  const forecastEligibility = buildKpiForecastEligibility(kpis, { now: input.asOf });
  const evaluatedKpis = latestKpis.map((kpi) => evaluateKpiTarget(kpi, historyByName.get(normalizeKpiName(kpi.name)) || [kpi], kpiSettings));
  const materialTargetMisses = evaluatedKpis.filter(({ evaluation, gapRatio }) =>
    isKpiTargetMiss(evaluation.targetStatus) && gapRatio !== null && gapRatio > MATERIAL_TARGET_GAP_RATIO
  );
  const targetAchievements = uniqueBy(
    evaluatedKpis.filter(({ semantics, evaluation }) => semantics.desiredDirection !== "unknown" && isKpiTargetMet(evaluation.targetStatus)),
    ({ semantics }) => canonicalKpiPerformanceIdentity(semantics)
  );
  const targetAchievementIdentities = new Set(targetAchievements.map(({ semantics }) => canonicalKpiPerformanceIdentity(semantics)));
  const sustainedFavorableTrends = uniqueBy(
    evaluatedKpis.filter((evaluated) => {
      const identity = canonicalKpiPerformanceIdentity(evaluated.semantics);
      return !targetAchievementIdentities.has(identity) && isSustainedFavorableTrend(evaluated);
    }),
    ({ semantics }) => canonicalKpiPerformanceIdentity(semantics)
  );
  const pendingImports = imports.filter((item) => ["extracted", "needs_review"].includes(lower(item.status)));
  const staleSops = sops.filter((sop) => {
    const date = new Date(sop.updated_at || sop.created_at);
    const ageDays = (Date.now() - date.getTime()) / 86400000;
    return ageDays > 90;
  });
  const customerContextWithoutFollowup = crmLeads.filter((lead) => !isClosed(lead.status) && (!lead.last_activity_at || isOverdue(lead.last_activity_at)));
  const originalKpiSeries = new Set(kpis.map((kpi) => `${kpi.source_file_id || kpi.import_id || "manual"}:${kpi.name.toLowerCase()}`));
  const eligibleSignalCategories: EligibleBusinessSignalCategory[] = [
    { id: "kpi_observations", label: "KPI observations", count: kpis.length },
    { id: "kpi_series", label: "KPI series", count: originalKpiSeries.size },
    { id: "files", label: "Files", count: files.length },
    { id: "process_documents", label: "SOPs and process documents", count: sops.length },
    { id: "forms", label: "Forms", count: forms.length },
    { id: "form_submissions", label: "Form submissions", count: submissions.length },
    { id: "operational_issues", label: "Operational evidence", count: issues.length },
    { id: "customer_records", label: "Customer records", count: crmLeads.length },
    { id: "organization_context", label: "Organization context", count: people.length }
  ];
  const originalSourceRecords = eligibleSignalCategories
    .filter((category) => category.id !== "kpi_observations")
    .reduce((total, category) => total + category.count, 0);
  const originalSourceTypes = [
    originalKpiSeries.size > 0,
    files.length > 0,
    sops.length > 0,
    issues.length > 0,
    crmLeads.length > 0,
    people.length > 0
  ].filter(Boolean).length;
  const hasHealthEvidence = originalSourceRecords >= 3 && originalSourceTypes >= 2 && (originalKpiSeries.size > 0 || files.length > 0 || issues.length > 0);
  const suggestedNextData = [
    !kpis.length ? "Upload KPI history or connect one leadership-level KPI source." : "",
    !files.length ? "Upload a recent spreadsheet, report, meeting note, or SOP." : "",
    !crmLeads.length ? "Add customer context or import a customer/lead list." : "",
    !people.length ? "Add leadership or area context so Vaeroex can interpret the evidence." : ""
  ].filter(Boolean);
  const independentSourceIdentityCount = independentOriginalEvidenceKeys([
    { kind: "file", values: files },
    { kind: "kpi", values: kpis },
    { kind: "issue", values: issues },
    { kind: "customer", values: crmLeads },
    { kind: "process", values: sops },
    { kind: "form", values: forms },
    { kind: "form_submission", values: submissions }
  ]).size;
  const readinessSourceTypeCount = [
    originalKpiSeries.size > 0,
    files.length > 0,
    issues.length > 0,
    crmLeads.length > 0,
    sops.length > 0 || forms.length > 0 || submissions.length > 0
  ].filter(Boolean).length;
  const canonicalKpiReadiness = canonicalKpiReadinessCounts(kpis, kpiSettings, input.asOf);
  const intelligenceReadiness = calculateIntelligenceReadiness({
    hasWorkspaceProfile: Boolean(workspace?.industry || workspace?.size),
    hasOriginalFiles: files.length > 0,
    hasCanonicalKpis: canonicalKpiReadiness.count > 0,
    hasTraceableCustomerOrOperationalRecords: crmLeads.length > 0 || issues.length > 0,
    independentSourceIdentityCount,
    sourceTypeCount: readinessSourceTypeCount,
    canonicalKpiCount: canonicalKpiReadiness.count,
    kpisWithHistoricalDepth: canonicalKpiReadiness.withHistoricalDepth,
    freshKpiCount: canonicalKpiReadiness.fresh
  });
  const dataQualityScore = intelligenceReadiness.score;
  const dataQualityLabel = intelligenceReadiness.label;
  const dataConfidence = intelligenceReadiness.confidence;
  const insights: IntelligenceInsight[] = [
    ...operationalInsights,
    ...openIssues.slice(0, 4).map((issue) => {
      const priority = priorityFrom(issue.severity);
      const evidence = [`Issue status: ${issue.status}`, `Severity: ${issue.severity}`, issue.root_cause ? `Root cause: ${issue.root_cause}` : "Root cause not documented"];
      const supportingRecords = [evidenceRecord({
        id: `issue:${issue.id}`,
        title: issue.title,
        recordType: issue.issue_type || "Issue record",
        date: issue.updated_at || issue.created_at,
        value: `${issue.status} · ${issue.severity} severity`,
        support: issue.root_cause ? `The record documents this root cause: ${issue.root_cause}` : "The issue remains open, but its root cause is not documented.",
        href: `/app/issues?q=${encodeURIComponent(issue.title)}`,
        classification: "Manual",
        sourceKey: `issue:${issue.id}`,
        groupHint: issue.issue_type || "Issues"
      })];
      const limitation = issue.root_cause
        ? "The issue record does not establish whether the documented cause is the only contributing factor."
        : "The root cause and measured business outcome are not documented.";

      return {
        id: `issue-${issue.id}`,
        type: "Risk" as const,
        title: issue.title,
        summary: issue.description || issue.recommended_fix || `Issue is currently ${issue.status}.`,
        why: issue.root_cause ? `The record attributes the issue to ${issue.root_cause}` : `The issue remains ${lower(issue.status)} and no root cause is recorded.`,
        impact: issue.description || "The unresolved issue may continue to affect the business area described in the record.",
        recommendedAction: issue.recommended_fix || "Decide whether this issue requires an investigation and what evidence should be collected next.",
        confidence: confidenceFromEvidence(evidence.length, priority),
        evidence,
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount: 1,
        contradictoryEvidence: [],
        missingEvidence: issue.root_cause ? ["Independent confirmation of the recorded root cause"] : ["Documented root cause", "Measured business outcome"],
        sourceTypes: ["Issues"],
        sourceHref: "/app/issues",
        priority,
        lastUpdated: issue.updated_at || issue.created_at,
        affectedArea: issue.issue_type || "Operations",
        timePeriod: (issue.updated_at || issue.created_at).slice(0, 7),
        limitation,
        fingerprint: ""
      };
    }),
    ...materialTargetMisses.slice(0, 4).map(({ kpi, semantics, evaluation, history: kpiHistory }) => {
      const key = normalizeKpiName(kpi.name);
      const history = historyCounts.get(key) || 1;
      const targetMissPeriods = kpiHistory.filter((row) => isMaterialTargetMiss(row, semantics)).length;
      const condition = targetMissLabel(evaluation.targetStatus, semantics);
      const reference = targetReference(kpi, semantics);
      const evidence = [
        `Actual: ${formatMetric(kpi.actual_value, kpi.name)}`,
        reference ? `${reference[0].toUpperCase()}${reference.slice(1)}` : "Target reference unavailable",
        `Historical records: ${history}`
      ];
      const supportingRecords = kpiHistory.slice(0, 4).map((row, index) =>
        kpiEvidenceRecord(row, semantics, index === 0 ? `The latest recorded value is ${condition}.` : "This prior value establishes the recent KPI history.")
      );
      const independentSourceCount = new Set(supportingRecords.map((record) => record.sourceKey)).size;
      const limitation = history < 3
        ? `Only ${history} historical record${history === 1 ? " is" : "s are"} available. Vaeroex cannot determine whether the gap is persistent.`
        : "The KPI history confirms the performance gap, but it does not establish the cause.";

      return {
        id: `kpi-risk-${kpi.id}`,
        type: "Risk" as const,
        title: targetMissPeriods >= 2 ? `${kpi.name} remained ${condition} for ${targetMissPeriods} periods` : `${kpi.name} is ${condition}`,
        summary: `Actual ${formatMetric(kpi.actual_value, kpi.name)}${reference ? ` vs ${reference}` : ""}.`,
        why: `The latest recorded value is ${condition} under the canonical KPI semantics.`,
        impact: "The gap needs context before it can be tied to a cause or business impact.",
        recommendedAction: "Decide whether leadership should investigate the cause now or continue monitoring the next reporting period.",
        confidence: history >= 3 && independentSourceCount >= 2 ? "High" : "Medium",
        evidence,
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount,
        contradictoryEvidence: [],
        missingEvidence: history < 3 ? ["At least three comparable historical periods", "Evidence explaining the change"] : ["Evidence explaining the change"],
        sourceTypes: ["KPIs"],
        sourceHref: "/app/kpis",
        priority: "High" as const,
        lastUpdated: kpi.updated_at || kpi.created_at,
        affectedArea: kpi.category || kpi.name,
        timePeriod: kpi.metric_date,
        limitation,
        fingerprint: ""
      };
    }),
    ...customerContextWithoutFollowup.slice(0, 3).map((lead) => {
      const evidence = [
        lead.status ? `Customer activity status: ${lead.status}` : "Customer activity status is not recorded",
        lead.last_activity_at ? `Last activity: ${lead.last_activity_at}` : "No recent customer activity is recorded",
        "Customer activity evidence is available"
      ];
      const supportingRecords = [evidenceRecord({
        id: `customer:${lead.id}`,
        title: lead.company ? `${lead.lead_name} at ${lead.company}` : lead.lead_name,
        recordType: "Imported customer activity",
        date: lead.last_activity_at || lead.updated_at || lead.created_at,
        value: lead.status ? `Status: ${lead.status}` : "Status not recorded",
        support: lead.last_activity_at ? "The last recorded activity is overdue." : "No recent activity date is recorded.",
        href: lead.source_file_id ? `/app/sources/${lead.source_file_id}` : "/app/sources",
        classification: recordClassification(lead),
        sourceKey: lead.source_file_id ? `source-file:${lead.source_file_id}` : `import:${lead.import_id}`
      })];

      return {
        id: `customer-risk-${lead.id}`,
        type: "Opportunity" as const,
        title: lead.company ? `${lead.lead_name} at ${lead.company}` : lead.lead_name,
        summary: "Customer activity evidence exists, but recent activity context is limited.",
        why: "Recent customer activity is not fully documented in the available record.",
        impact: "The available record is insufficient to confirm a revenue or retention effect.",
        recommendedAction: "Decide whether the underlying customer activity should be reviewed in the external source system before drawing a revenue conclusion.",
        confidence: lead.last_activity_at || lead.source_file_id || lead.import_id ? "Medium" : "Low",
        evidence,
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount: 1,
        contradictoryEvidence: [],
        missingEvidence: ["Current activity outcome", "Confirmed revenue or retention impact"],
        sourceTypes: ["Customer Evidence"],
        sourceHref: "/app/sources",
        priority: lead.last_activity_at || lead.source_file_id || lead.import_id ? "Medium" : "Low",
        lastUpdated: lead.updated_at || lead.created_at,
        affectedArea: "Customer activity",
        timePeriod: (lead.updated_at || lead.created_at).slice(0, 7),
        limitation: "The customer activity record does not confirm a revenue, conversion, or retention outcome.",
        fingerprint: ""
      };
    }),
    ...targetAchievements.slice(0, 3).map(({ kpi, semantics, history: kpiHistory }) => {
      const key = normalizeKpiName(kpi.name);
      const history = historyCounts.get(key) || 1;
      const condition = targetSuccessLabel(semantics);
      const reference = targetReference(kpi, semantics);
      const supportingRecords = kpiHistory.slice(0, 4).map((row, index) =>
        kpiEvidenceRecord(row, semantics, index === 0 ? `The latest value is ${condition}.` : "This prior value establishes the recent KPI history.")
      );
      const independentSourceCount = new Set(supportingRecords.map((record) => record.sourceKey)).size;

      return {
        id: `kpi-opportunity-${kpi.id}`,
        type: "Opportunity" as const,
        title: `${kpi.name} is ${condition}`,
        summary: `Actual ${formatMetric(kpi.actual_value, kpi.name)}${reference ? ` vs ${reference}` : ""}.`,
        why: `The latest recorded value is ${condition} under the canonical KPI semantics.`,
        impact: "The result may be worth preserving, but the current records do not establish its cause.",
        recommendedAction: "Decide whether the practice behind this result is clear enough to preserve or requires a focused review.",
        confidence: history >= 3 && independentSourceCount >= 2 ? "High" : "Medium",
        evidence: [`Metric date: ${kpi.metric_date}`, `Historical records: ${history}`, kpi.source ? `Source: ${kpi.source}` : "Source not recorded"],
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount,
        contradictoryEvidence: [],
        missingEvidence: ["Evidence explaining what caused the result"],
        sourceTypes: ["KPIs"],
        sourceHref: "/app/kpis",
        priority: "Medium" as const,
        lastUpdated: kpi.updated_at || kpi.created_at,
        affectedArea: kpi.category || kpi.name,
        timePeriod: kpi.metric_date,
        limitation: history < 3 ? `Only ${history} historical record${history === 1 ? " is" : "s are"} available, so the result may not represent a durable trend.` : "The KPI history confirms the result, but not what caused it.",
        fingerprint: "",
        businessHealthEffect: {
          identity: canonicalKpiPerformanceIdentity(semantics),
          points: 10 as const
        }
      };
    }),
    ...sustainedFavorableTrends.map(({ kpi, semantics, history: kpiHistory }) => {
      const datedHistory = distinctDatedKpiHistory(kpiHistory);
      const supportingRecords = datedHistory.slice(-4).map((row, index) =>
        kpiEvidenceRecord(row, semantics, index === datedHistory.slice(-4).length - 1
          ? "The latest value completes a sustained favorable KPI trend."
          : "This dated value supports the sustained KPI trend.")
      );
      const independentSourceCount = new Set(supportingRecords.map((record) => record.sourceKey)).size;
      const start = datedHistory[0];
      const latest = datedHistory.at(-1) || kpi;

      return {
        id: `kpi-trend-opportunity-${kpi.id}`,
        type: "Opportunity" as const,
        title: `${kpi.name} has a sustained favorable trend`,
        summary: `${formatMetric(start.actual_value, kpi.name)} to ${formatMetric(latest.actual_value, kpi.name)} across ${datedHistory.length} dated periods.`,
        why: "The canonical KPI semantics classify the sustained movement as favorable, and no authoritative target is configured.",
        impact: "The trend is confirmed in the KPI history, but the current evidence does not establish its cause or durability beyond the measured periods.",
        recommendedAction: "Decide whether the practices associated with this trend should be documented and monitored.",
        confidence: independentSourceCount >= 2 ? "High" as const : "Medium" as const,
        evidence: [`Dated periods: ${datedHistory.length}`, `Latest value: ${formatMetric(latest.actual_value, kpi.name)}`, "No authoritative target is configured"],
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount,
        contradictoryEvidence: [],
        missingEvidence: ["Evidence explaining what caused the favorable movement"],
        sourceTypes: ["KPIs"],
        sourceHref: "/app/kpis",
        priority: "Medium" as const,
        lastUpdated: latest.updated_at || latest.created_at,
        affectedArea: kpi.category || kpi.name,
        timePeriod: `${start.metric_date} to ${latest.metric_date}`,
        limitation: "The KPI history confirms favorable movement, not causation or future performance.",
        fingerprint: "",
        businessHealthEffect: {
          identity: canonicalKpiPerformanceIdentity(semantics),
          points: 8 as const
        }
      };
    }),
    ...pendingImports.slice(0, 3).map((item) => {
      const supportingRecords = [evidenceRecord({
        id: `import:${item.id}`,
        title: `${item.import_type.replace(/_/g, " ")} import`,
        recordType: "Structured import",
        date: item.imported_at || item.reviewed_at || item.created_at,
        value: `${item.rows_imported} of ${item.rows_total} rows imported`,
        support: "The import remains in its required review state and is not yet eligible for intelligence.",
        href: `/app/sources/${item.file_upload_id}?section=imported`,
        classification: "Derived",
        sourceKey: `source-file:${item.file_upload_id}`,
        groupHint: item.import_type.replace(/_/g, " ")
      })];

      return {
        id: `import-${item.id}`,
        type: "Recommendation" as const,
        title: `${item.import_type.replace(/_/g, " ")} import needs review`,
        summary: `${item.rows_imported} of ${item.rows_total} rows have been imported.`,
        why: "The import has not completed its required review step.",
        impact: "Current intelligence excludes the staged data until it is approved.",
        recommendedAction: "Decide whether the structured import is accurate enough to approve.",
        confidence: "Medium" as const,
        evidence: [`Status: ${item.status}`, `Rows staged: ${item.rows_total}`, item.extraction_summary || "No extraction summary recorded"],
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount: 1,
        contradictoryEvidence: [],
        missingEvidence: ["Approved field mapping"],
        sourceTypes: ["Files", "Imports"],
        sourceHref: "/app/sources",
        priority: "Medium" as const,
        lastUpdated: item.imported_at || item.reviewed_at || item.created_at,
        affectedArea: "Structured imports",
        timePeriod: "Current",
        limitation: "Staged import rows are not eligible business evidence until the structured import is approved.",
        fingerprint: ""
      };
    }),
    staleSops.length
      ? (() => {
          const supportingRecords = staleSops.map((sop) => evidenceRecord({
            id: `sop:${sop.id}`,
            title: sop.title,
            recordType: "SOP",
            date: sop.updated_at || sop.created_at,
            value: `Last updated ${sop.updated_at || sop.created_at}`,
            support: "The document has not been updated in more than 90 days.",
            href: `/app/sops?q=${encodeURIComponent(sop.title)}`,
            classification: "Manual",
            sourceKey: `sop:${sop.id}`,
            groupHint: sop.category || sop.department || "Process knowledge"
          }));

          return {
          id: "stale-process-knowledge",
          type: "Recommendation" as const,
          title: "Process knowledge may be stale",
          summary: `${staleSops.length} SOP${staleSops.length === 1 ? " is" : "s are"} older than 90 days.`,
          why: "The process documents have not been updated in more than 90 days.",
          impact: "Older process documentation can limit confidence in process-related conclusions.",
          recommendedAction: "Decide which process documents still reflect current operations and retire or update the rest in the source system.",
          confidence: "Medium",
          evidence: [`Stale SOPs: ${staleSops.length}`, staleSops[0]?.title ? `Oldest example: ${staleSops[0].title}` : "No example available"],
          evidenceCount: supportingRecords.length,
          supportingRecords,
          independentSourceCount: supportingRecords.length,
          contradictoryEvidence: [],
          missingEvidence: ["Confirmation that each process document still reflects current operations"],
          sourceTypes: ["SOPs", "Process Knowledge"],
          sourceHref: "/app/sops",
          priority: "Medium",
          lastUpdated: latestDate(staleSops.map((sop) => sop.updated_at || sop.created_at)),
          affectedArea: "Process knowledge",
          timePeriod: "Older than 90 days",
          limitation: "Document age alone does not prove that the underlying process is outdated.",
          fingerprint: ""
        };
      })()
      : null
  ].filter(Boolean) as IntelligenceInsight[];
  const normalizedInsights = insights.map((insight) => ({
    ...insight,
    fingerprint: insight.fingerprint || findingFingerprint(insight)
  }));
  const sortedInsights = consolidateDuplicateInsights(normalizedInsights);
  const risks = sortedInsights.filter((insight) => insight.type === "Risk" || insight.type === "Bottleneck" || insight.type === "Anomaly");
  const opportunities = sortedInsights.filter((insight) => insight.type === "Opportunity");
  const recommendations = sortedInsights.filter((insight) => insight.type === "Recommendation" || insight.type === "Risk" || insight.type === "Bottleneck");
  const forecasts = sortedInsights.filter((insight) => insight.type === "Forecast");
  const canonicalKpiIdentityByLabel = new Map(evaluatedKpis.map(({ kpi, semantics }) => [normalizeKpiName(kpi.name), canonicalKpiPerformanceIdentity(semantics)]));
  const positivePerformanceSignals: BusinessHealthPerformanceSignal[] = sortedInsights.flatMap((insight) => insight.businessHealthEffect
    ? [{ identity: insight.businessHealthEffect.identity, findingId: insight.id, points: insight.businessHealthEffect.points }]
    : []);
  const negativeSignals = negativePerformanceSignals(risks, canonicalKpiIdentityByLabel);
  const businessHealthPerformance = calculateBusinessHealthPerformance({
    evidenceEligible: hasHealthEvidence,
    positiveSignals: positivePerformanceSignals,
    negativeSignals
  });
  const businessHealthComponents = businessHealthPerformance.components;
  const healthScore = businessHealthPerformance.score;
  const healthStatus = businessHealthPerformance.status;
  const scoredRiskCount = businessHealthComponents.driverImpacts.filter((impact) => impact.kind === "risk").length;
  const scoredPositiveCount = businessHealthComponents.driverImpacts.filter((impact) => impact.kind === "opportunity").length;
  const trend = !businessHealthPerformance.available
    ? "Not enough history"
    : scoredRiskCount > scoredPositiveCount + 1
      ? "Declining"
      : scoredPositiveCount > scoredRiskCount
        ? "Improving"
        : "Holding steady";
  const topRisk = risks[0];
  const topOpportunity = opportunities[0];
  const topRecommendation = recommendations[0];
  const topForecast = forecasts[0];
  const executiveSummary = topRisk
    ? `${topRisk.title}. ${topRisk.why}`
    : topOpportunity
      ? `${topOpportunity.title}. ${topOpportunity.why}`
      : dataQualityScore < 50
        ? "Vaeroex needs more source data before it can produce a confident leadership briefing."
        : "No major risk is visible right now. Continue adding source data and reviewing business memory.";

  return {
    executiveSummary,
    businessHealth: {
      available: businessHealthPerformance.available,
      unavailableReason: !hasHealthEvidence
        ? "insufficient_original_evidence"
        : !businessHealthPerformance.hasEvaluableOutcome
          ? "no_evaluable_performance_outcome"
          : null,
      score: healthScore,
      status: healthStatus,
      trend,
      components: businessHealthComponents
    },
    dataQuality: {
      score: dataQualityScore,
      label: dataQualityLabel,
      confidence: dataConfidence,
      reason:
        dataConfidence === "High"
          ? "Authoritative evidence is complete, diverse, historically deep, and current enough for high-confidence interpretation."
          : dataConfidence === "Medium"
            ? "Authoritative evidence is usable, but source diversity, KPI history, or freshness still limits confidence."
            : "Authoritative evidence remains limited in completeness, independent-source diversity, KPI history, or freshness.",
      suggestedNextData: suggestedNextData.length ? suggestedNextData : ["Keep adding current evidence, outcomes, and KPI history."]
    },
    forecastReadiness: {
      state: forecastEligibility.state,
      label: forecastEligibility.label,
      reason: forecastEligibility.reason,
      ready: forecastEligibility.ready,
      directional: forecastEligibility.directional,
      currentKpiCount: forecastEligibility.currentKpiCount,
      totalMeasurementCount: forecastEligibility.totalMeasurementCount,
      readyKpiCount: forecastEligibility.readyKpiCount,
      directionalKpiCount: forecastEligibility.directionalKpiCount,
      historicalDepthLabel: forecastEligibility.historicalDepthLabel,
      freshnessLabel: forecastEligibility.freshnessLabel
    },
    topRisk,
    topOpportunity,
    topRecommendation,
    topForecast,
    insights: sortedInsights,
    memorySummary: {
      profileSignals: [workspace?.industry, workspace?.size].filter(Boolean).length,
      sourceRecords: originalSourceRecords,
      kpiHistoryRecords: kpis.length,
      vaeroexRuns: vaeroexRuns.length,
      decisions: decisions.length,
      recommendationOutcomes: 0,
      eligibleSignalCategories
    }
  };
}
