import type { Database } from "@/lib/supabase/types";
import { buildKpiForecastEligibility, type KpiForecastEligibilitySummary } from "@/lib/kpis/forecast-eligibility";
import { filterOriginalBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { buildSourceParentEligibility, filterBySourceParentEligibility } from "@/lib/intelligence/source-parent-eligibility";
import { compareKpiRowsNewest, groupKpisByNormalizedName, normalizeKpiName } from "@/lib/intelligence/kpi-identity";

export type IntelligenceInsightType = "Risk" | "Opportunity" | "Forecast" | "Bottleneck" | "Recommendation" | "Anomaly";
export type IntelligenceConfidence = "High" | "Medium" | "Low";

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
};

export type IntelligenceLayerResult = {
  executiveSummary: string;
  businessHealth: {
    available: boolean;
    score: number;
    status: "Strong" | "Watch" | "At Risk" | "Insufficient Data";
    trend: "Improving" | "Holding steady" | "Declining" | "Not enough history";
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
    reports: number;
    vaeroexRuns: number;
    decisions: number;
    recommendationOutcomes: number;
  };
};

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type FormRow = Database["public"]["Tables"]["forms"]["Row"];
type FormSubmissionRow = Database["public"]["Tables"]["form_submissions"]["Row"];
type PersonRow = Database["public"]["Tables"]["people"]["Row"];
type DecisionRow = Database["public"]["Tables"]["business_decisions"]["Row"];
type RecommendationOutcomeRow = Database["public"]["Tables"]["vaeroex_recommendation_outcomes"]["Row"];

export type IntelligenceLayerInput = {
  workspace?: {
    name?: string | null;
    industry?: string | null;
    size?: string | null;
  } | null;
  kpis?: KpiRow[];
  issues?: IssueRow[];
  files?: FileUploadRow[];
  reports?: ReportRow[];
  vaeroexRuns?: VaeroexRunRow[];
  crmLeads?: CrmLeadRow[];
  imports?: FileImportRow[];
  sops?: SopRow[];
  forms?: FormRow[];
  submissions?: FormSubmissionRow[];
  people?: PersonRow[];
  decisions?: DecisionRow[];
  recommendationOutcomes?: RecommendationOutcomeRow[];
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

function kpiEvidenceRecord(kpi: KpiRow, support: string): IntelligenceEvidenceRecord {
  const sourceKey = kpi.source_file_id
    ? `source-file:${kpi.source_file_id}`
    : kpi.import_id
      ? `import:${kpi.import_id}`
      : `manual-kpi:${normalizeKpiName(kpi.name)}`;

  return evidenceRecord({
    id: `kpi:${kpi.id}`,
    title: kpi.name,
    recordType: "KPI record",
    date: kpi.metric_date,
    value: `Actual ${formatMetric(kpi.actual_value, kpi.name)}${kpi.target === null ? "" : ` · Target ${formatMetric(kpi.target, kpi.name)}`}`,
    support,
    href: `/app/kpis?metric=${encodeURIComponent(kpi.name)}&section=detail`,
    classification: recordClassification(kpi),
    sourceKey,
    groupHint: kpi.category || kpi.name
  });
}

function canonicalTopic(value: string) {
  const normalized = lower(value);
  if (/checklist/.test(normalized)) return "checklist-completion";
  if (/response.?time/.test(normalized)) return "response-time";
  if (/follow.?up|overdue/.test(normalized)) return "customer-follow-up";
  if (/conversion/.test(normalized)) return "conversion";
  if (/revenue|sales/.test(normalized)) return "revenue";
  if (/handoff|handover/.test(normalized)) return "handoff";
  if (/sop|process knowledge/.test(normalized)) return "process-knowledge";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "general";
}

function canonicalCondition(value: string) {
  const normalized = lower(value);
  if (/below target|dropped|declin|fell|missed target/.test(normalized)) return "performance-gap";
  if (/unclear|missing|not documented|limited context/.test(normalized)) return "missing-context";
  if (/stale|older than/.test(normalized)) return "stale";
  if (/above target|meets|exceeds|improv/.test(normalized)) return "positive-performance";
  return "review";
}

function findingFingerprint(insight: Pick<IntelligenceInsight, "type" | "title" | "summary" | "affectedArea" | "timePeriod">) {
  const typeGroup = ["Risk", "Bottleneck", "Anomaly"].includes(insight.type) ? "risk" : insight.type.toLowerCase();
  const topic = canonicalTopic(`${insight.affectedArea} ${insight.title}`);
  const condition = canonicalCondition(`${insight.title} ${insight.summary}`);
  const normalizedPeriod = /^\d{4}-\d{2}/.test(insight.timePeriod) ? insight.timePeriod.slice(0, 7) : lower(insight.timePeriod) || "current";
  return `${typeGroup}:${topic}:${condition}:${normalizedPeriod}`;
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
      lastUpdated: [current.lastUpdated, insight.lastUpdated].sort().at(-1) || current.lastUpdated
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

export function buildIntelligenceLayer(input: IntelligenceLayerInput): IntelligenceLayerResult {
  const workspace = input.workspace || null;
  const files = filterOriginalBusinessEvidence(input.files);
  const parentEligibility = buildSourceParentEligibility({ files, imports: input.imports || [] });
  const kpis = filterBySourceParentEligibility(filterOriginalBusinessEvidence(input.kpis), parentEligibility);
  const issues = filterOriginalBusinessEvidence(input.issues);
  // Reports are derived outputs. They remain reviewable, but never become
  // original evidence for new health, coverage, risk, or recommendation logic.
  const reports: ReportRow[] = [];
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
  const recommendationOutcomes: RecommendationOutcomeRow[] = [];
  const operationalInsights = input.operationalInsights || [];
  const openIssues = issues.filter((issue) => !isClosed(issue.status));
  const latestKpis = latestKpisByName(kpis);
  const historyCounts = kpiHistoryCounts(kpis);
  const historyByName = kpiHistoryByName(kpis);
  const forecastEligibility = buildKpiForecastEligibility(kpis);
  const belowTargetKpis = latestKpis.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value < kpi.target * 0.9);
  const improvingKpis = latestKpis.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value >= kpi.target);
  const pendingImports = imports.filter((item) => ["extracted", "needs_review"].includes(lower(item.status)));
  const staleSops = sops.filter((sop) => {
    const date = new Date(sop.updated_at || sop.created_at);
    const ageDays = (Date.now() - date.getTime()) / 86400000;
    return ageDays > 90;
  });
  const customerContextWithoutFollowup = crmLeads.filter((lead) => !isClosed(lead.status) && (!lead.last_activity_at || isOverdue(lead.last_activity_at)));
  const originalKpiSeries = new Set(kpis.map((kpi) => `${kpi.source_file_id || kpi.import_id || "manual"}:${kpi.name.toLowerCase()}`));
  const originalSourceRecords = originalKpiSeries.size + files.length + reports.length + sops.length + forms.length + submissions.length + issues.length + crmLeads.length + people.length;
  const originalSourceTypes = [
    originalKpiSeries.size > 0,
    files.length > 0,
    reports.length > 0,
    sops.length > 0,
    issues.length > 0,
    crmLeads.length > 0,
    people.length > 0
  ].filter(Boolean).length;
  const hasHealthEvidence = originalSourceRecords >= 3 && originalSourceTypes >= 2 && (originalKpiSeries.size > 0 || files.length > 0 || reports.length > 0 || issues.length > 0);
  const suggestedNextData = [
    !kpis.length ? "Upload KPI history or connect one leadership-level KPI source." : "",
    !reports.length ? "Upload or generate prior management reports." : "",
    !files.length ? "Upload a recent spreadsheet, report, meeting note, or SOP." : "",
    !crmLeads.length ? "Add customer context or import a customer/lead list." : "",
    !people.length ? "Add leadership or area context so Vaeroex can interpret the evidence." : ""
  ].filter(Boolean);
  const dataQualityScore = Math.min(
    100,
    Math.round(
      (workspace?.industry || workspace?.size ? 10 : 0) +
        (files.length ? 15 : 0) +
        (kpis.length ? 25 : 0) +
        (reports.length ? 15 : 0) +
        (crmLeads.length || issues.length ? 10 : 0) +
        (decisions.length || recommendationOutcomes.length ? 10 : 0)
    )
  );
  const dataQualityLabel = dataQualityScore >= 70 ? "Strong" : dataQualityScore >= 40 ? "Developing" : "Limited";
  const dataConfidence = dataQualityScore >= 70 ? "High" : dataQualityScore >= 40 ? "Medium" : "Low";
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
    ...belowTargetKpis.slice(0, 4).map((kpi) => {
      const key = normalizeKpiName(kpi.name);
      const history = historyCounts.get(key) || 1;
      const belowTargetPeriods = (historyByName.get(key) || [kpi]).filter(
        (row) => row.target !== null && row.actual_value !== null && row.actual_value < row.target * 0.9
      ).length;
      const evidence = [`Actual: ${formatMetric(kpi.actual_value, kpi.name)}`, `Target: ${formatMetric(kpi.target, kpi.name)}`, `Historical records: ${history}`];
      const supportingRecords = (historyByName.get(key) || [kpi]).slice(0, 4).map((row, index) =>
        kpiEvidenceRecord(row, index === 0 ? "The latest recorded value is below the current target." : "This prior value establishes the recent KPI history.")
      );
      const independentSourceCount = new Set(supportingRecords.map((record) => record.sourceKey)).size;
      const limitation = history < 3
        ? `Only ${history} historical record${history === 1 ? " is" : "s are"} available. Vaeroex cannot determine whether the gap is persistent.`
        : "The KPI history confirms the performance gap, but it does not establish the cause.";

      return {
        id: `kpi-risk-${kpi.id}`,
        type: "Risk" as const,
        title: belowTargetPeriods >= 2 ? `${kpi.name} remained below target for ${belowTargetPeriods} periods` : `${kpi.name} is below target`,
        summary: `Actual ${formatMetric(kpi.actual_value, kpi.name)} vs target ${formatMetric(kpi.target, kpi.name)}.`,
        why: "The latest recorded value is below the current target.",
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
    ...improvingKpis.slice(0, 3).map((kpi) => {
      const key = normalizeKpiName(kpi.name);
      const history = historyCounts.get(key) || 1;
      const supportingRecords = (historyByName.get(key) || [kpi]).slice(0, 4).map((row, index) =>
        kpiEvidenceRecord(row, index === 0 ? "The latest value meets or exceeds the current target." : "This prior value establishes the recent KPI history.")
      );
      const independentSourceCount = new Set(supportingRecords.map((record) => record.sourceKey)).size;

      return {
        id: `kpi-opportunity-${kpi.id}`,
        type: "Opportunity" as const,
        title: `${kpi.name} is on or above target`,
        summary: `Actual ${formatMetric(kpi.actual_value, kpi.name)} vs target ${formatMetric(kpi.target, kpi.name)}.`,
        why: "The latest recorded value meets or exceeds the current target.",
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
        fingerprint: ""
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
  const riskPenalty = Math.min(45, risks.filter((risk) => risk.priority === "High").length * 12 + risks.filter((risk) => risk.priority === "Medium").length * 6);
  const healthScore = hasHealthEvidence ? Math.max(10, Math.min(100, dataQualityScore - riskPenalty + Math.min(15, opportunities.length * 4))) : 0;
  const healthStatus = !hasHealthEvidence || dataQualityScore < 25 ? "Insufficient Data" : healthScore >= 75 ? "Strong" : healthScore >= 50 ? "Watch" : "At Risk";
  const trend = !hasHealthEvidence ? "Not enough history" : risks.length > opportunities.length + 1 ? "Declining" : opportunities.length > risks.length ? "Improving" : dataQualityScore < 35 ? "Not enough history" : "Holding steady";
  const topRisk = risks[0];
  const topOpportunity = opportunities[0];
  const topRecommendation = recommendations[0];
  const topForecast = forecasts[0];
  const executiveSummary = topRisk
    ? `${topRisk.title}. ${topRisk.why}`
    : topOpportunity
      ? `${topOpportunity.title}. ${topOpportunity.why}`
      : dataQualityScore < 40
        ? "Vaeroex needs more source data before it can produce a confident leadership briefing."
        : "No major risk is visible right now. Continue adding source data and reviewing business memory.";

  return {
    executiveSummary,
    businessHealth: {
      available: hasHealthEvidence,
      score: healthScore,
      status: healthStatus,
      trend
    },
    dataQuality: {
      score: dataQualityScore,
      label: dataQualityLabel,
      confidence: dataConfidence,
      reason:
        dataConfidence === "High"
          ? "Based on multiple source types, historical records, and saved Vaeroex context."
          : dataConfidence === "Medium"
            ? "Based on available workspace records, but more history would improve confidence."
            : "Not enough workspace history exists for high-confidence intelligence yet.",
      suggestedNextData: suggestedNextData.length ? suggestedNextData : ["Keep adding current reports, outcomes, and KPI history."]
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
      reports: reports.length,
      vaeroexRuns: vaeroexRuns.length,
      decisions: decisions.length,
      recommendationOutcomes: recommendationOutcomes.length
    }
  };
}
