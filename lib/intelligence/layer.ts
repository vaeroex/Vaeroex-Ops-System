import type { Database } from "@/lib/supabase/types";
import { buildKpiForecastEligibility, type KpiForecastEligibilitySummary } from "@/lib/kpis/forecast-eligibility";
import { filterOriginalBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { buildSourceParentEligibility, filterBySourceParentEligibility } from "@/lib/intelligence/source-parent-eligibility";

export type IntelligenceInsightType = "Risk" | "Opportunity" | "Forecast" | "Bottleneck" | "Recommendation" | "Anomaly";
export type IntelligenceConfidence = "High" | "Medium" | "Low";

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
  sourceTypes: string[];
  sourceHref: string;
  priority: "High" | "Medium" | "Low";
  lastUpdated: string;
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
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
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
  tasks?: TaskRow[];
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
  const map = new Map<string, KpiRow>();

  for (const kpi of [...kpis].sort((a, b) => b.metric_date.localeCompare(a.metric_date))) {
    if (!map.has(kpi.name)) {
      map.set(kpi.name, kpi);
    }
  }

  return Array.from(map.values());
}

function kpiHistoryCounts(kpis: KpiRow[]) {
  const map = new Map<string, number>();

  for (const kpi of kpis) {
    map.set(kpi.name, (map.get(kpi.name) || 0) + 1);
  }

  return map;
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

function businessSignalPatternTitle(signals: TaskRow[]) {
  const sourceText = signals
    .flatMap((signal) => [signal.title, signal.description, signal.category])
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (/follow.?up|response/.test(sourceText)) return "Follow-up process requires review";
  if (/handoff|handover/.test(sourceText)) return "Handoffs require review";
  if (/process|procedure|sop/.test(sourceText)) return "Current process requires review";
  return "Repeated operating signals require review";
}

export function buildIntelligenceLayer(input: IntelligenceLayerInput): IntelligenceLayerResult {
  const workspace = input.workspace || null;
  const files = filterOriginalBusinessEvidence(input.files);
  const parentEligibility = buildSourceParentEligibility({ files, imports: input.imports || [] });
  const kpis = filterBySourceParentEligibility(filterOriginalBusinessEvidence(input.kpis), parentEligibility);
  const tasks = filterOriginalBusinessEvidence(input.tasks);
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
  const openTasks = tasks.filter((task) => !isClosed(task.status));
  const businessSignalsForReview = openTasks.filter((task) => Boolean(task.description || task.category || task.related_type || task.due_date));
  const signalsWithLimitedContext = openTasks.filter((task) => !task.description || !task.category);
  const openIssues = issues.filter((issue) => !isClosed(issue.status));
  const latestKpis = latestKpisByName(kpis);
  const historyCounts = kpiHistoryCounts(kpis);
  const forecastEligibility = buildKpiForecastEligibility(kpis);
  const belowTargetKpis = latestKpis.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value < kpi.target * 0.9);
  const improvingKpis = latestKpis.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value >= kpi.target);
  const pendingImports = imports.filter((item) => ["extracted", "needs_review"].includes(lower(item.status)));
  const forecastReadyMetricNames = new Set(forecastEligibility.metrics.filter((metric) => metric.state === "ready").map((metric) => metric.name.toLowerCase()));
  const forecastReadyKpis = latestKpis.filter((kpi) => forecastReadyMetricNames.has(kpi.name.toLowerCase()));
  const staleSops = sops.filter((sop) => {
    const date = new Date(sop.updated_at || sop.created_at);
    const ageDays = (Date.now() - date.getTime()) / 86400000;
    return ageDays > 90;
  });
  const customerContextWithoutFollowup = crmLeads.filter((lead) => !isClosed(lead.status) && (!lead.last_activity_at || isOverdue(lead.last_activity_at)));
  const originalKpiSeries = new Set(kpis.map((kpi) => `${kpi.source_file_id || kpi.import_id || "manual"}:${kpi.name.toLowerCase()}`));
  const originalSourceRecords = originalKpiSeries.size + files.length + reports.length + sops.length + forms.length + submissions.length + tasks.length + issues.length + crmLeads.length + people.length;
  const originalSourceTypes = [
    originalKpiSeries.size > 0,
    files.length > 0,
    reports.length > 0,
    sops.length > 0,
    tasks.length > 0,
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
    !people.length ? "Add leadership or area context so Vaeroex can interpret Business Signals." : ""
  ].filter(Boolean);
  const dataQualityScore = Math.min(
    100,
    Math.round(
      (workspace?.industry || workspace?.size ? 10 : 0) +
        (files.length ? 15 : 0) +
        (kpis.length ? 25 : 0) +
        (reports.length ? 15 : 0) +
        (crmLeads.length || issues.length || tasks.length ? 10 : 0) +
        (decisions.length || recommendationOutcomes.length ? 10 : 0)
    )
  );
  const dataQualityLabel = dataQualityScore >= 70 ? "Strong" : dataQualityScore >= 40 ? "Developing" : "Limited";
  const dataConfidence = dataQualityScore >= 70 ? "High" : dataQualityScore >= 40 ? "Medium" : "Low";
  const insights: IntelligenceInsight[] = [
    ...openIssues.slice(0, 4).map((issue) => {
      const priority = priorityFrom(issue.severity);
      const evidence = [`Issue status: ${issue.status}`, `Severity: ${issue.severity}`, issue.root_cause ? `Root cause: ${issue.root_cause}` : "Root cause not documented"];

      return {
        id: `issue-${issue.id}`,
        type: "Risk" as const,
        title: issue.title,
        summary: issue.description || issue.recommended_fix || `Issue is currently ${issue.status}.`,
        why: "The issue remains open and its recorded severity or root cause has not yet been resolved.",
        impact: "An unresolved issue can continue to affect the work described in the record.",
        recommendedAction: "Review the issue record and determine whether a leadership brief is warranted.",
        confidence: confidenceFromEvidence(evidence.length, priority),
        evidence,
        evidenceCount: evidence.length,
        sourceTypes: ["Issues"],
        sourceHref: "/app/issues",
        priority,
        lastUpdated: issue.updated_at || issue.created_at
      };
    }),
    businessSignalsForReview.length
      ? (() => {
          const signalPriority = businessSignalsForReview.length >= 5 ? "High" : "Medium";
          const examples = businessSignalsForReview
            .slice(0, 3)
            .map((task) => task.title)
            .join(", ");
          const evidence = [
            `Business Signals in this pattern: ${businessSignalsForReview.length}`,
            examples ? `Examples: ${examples}` : "Examples: no titles available",
            "Business Signals are evidence and context, not Vaeroex-owned tasks"
          ];

          return {
            id: "source-signal-review-pattern",
            type: "Risk" as const,
            title: businessSignalPatternTitle(businessSignalsForReview),
            summary: `Vaeroex found ${businessSignalsForReview.length} related operating record${businessSignalsForReview.length === 1 ? "" : "s"}. The records do not confirm a company-wide problem, but the repeated context warrants management review.`,
            why: "The entries share operating context and appear across more than one record. Direct timing, outcome, or customer-impact data is not yet available in this finding.",
            impact: "The available records may point to inconsistent follow-up, handoffs, or process completion; the underlying cause is not confirmed.",
            recommendedAction: "Review the underlying records together and confirm whether they describe one recurring operating issue or unrelated events.",
            confidence: confidenceFromEvidence(evidence.length, signalPriority),
            evidence,
            evidenceCount: evidence.length,
            sourceTypes: ["Business Signals"],
            sourceHref: "/app/tasks",
            priority: signalPriority,
            lastUpdated: latestDate(businessSignalsForReview.map((task) => task.updated_at || task.created_at))
          };
        })()
      : null,
    signalsWithLimitedContext.length
      ? {
          id: "unclear-source-signals",
          type: "Bottleneck" as const,
          title: "More context is needed to interpret current operating signals",
          summary: `${signalsWithLimitedContext.length} operating record${signalsWithLimitedContext.length === 1 ? " has" : "s have"} limited description or category information.`,
          why: "The records cannot be reliably connected to a specific process, outcome, or business impact with the available context.",
          impact: "This limits confidence in related operational conclusions rather than confirming a business problem.",
          recommendedAction: "Add a clear description, category, or source reference before using these records in a leadership decision.",
          confidence: signalsWithLimitedContext.length >= 5 ? "High" : "Medium",
          evidence: [`Business Signals with limited context: ${signalsWithLimitedContext.length}`, `Business Signals in memory: ${openTasks.length}`, signalsWithLimitedContext[0]?.title ? `Example: ${signalsWithLimitedContext[0].title}` : "No example available"],
          evidenceCount: 3,
          sourceTypes: ["Business Signals"],
          sourceHref: "/app/tasks",
          priority: signalsWithLimitedContext.length >= 5 ? "High" : "Medium",
          lastUpdated: latestDate(signalsWithLimitedContext.map((task) => task.updated_at || task.created_at))
        }
      : null,
    ...belowTargetKpis.slice(0, 4).map((kpi) => {
      const history = historyCounts.get(kpi.name) || 1;
      const evidence = [`Actual: ${formatMetric(kpi.actual_value, kpi.name)}`, `Target: ${formatMetric(kpi.target, kpi.name)}`, `Historical records: ${history}`];

      return {
        id: `kpi-risk-${kpi.id}`,
        type: "Risk" as const,
        title: `${kpi.name} is below target`,
        summary: `Actual ${formatMetric(kpi.actual_value, kpi.name)} vs target ${formatMetric(kpi.target, kpi.name)}.`,
        why: "The latest recorded value is below the current target.",
        impact: "The gap needs context before it can be tied to a cause or business impact.",
        recommendedAction: "Review the KPI history and the most relevant supporting records before deciding whether the target or operating conditions need attention.",
        confidence: history >= 3 ? "High" : "Medium",
        evidence,
        evidenceCount: evidence.length,
        sourceTypes: ["KPIs"],
        sourceHref: "/app/kpis",
        priority: "High" as const,
        lastUpdated: kpi.updated_at || kpi.created_at
      };
    }),
    ...customerContextWithoutFollowup.slice(0, 3).map((lead) => {
      const evidence = [
        lead.status ? `Customer activity status: ${lead.status}` : "Customer activity status is not recorded",
        lead.last_activity_at ? `Last activity: ${lead.last_activity_at}` : "No recent customer activity is recorded",
        "Customer activity evidence is available"
      ];

      return {
        id: `customer-risk-${lead.id}`,
        type: "Opportunity" as const,
        title: lead.company ? `${lead.lead_name} at ${lead.company}` : lead.lead_name,
        summary: "Customer activity evidence exists, but recent activity context is limited.",
        why: "Recent customer activity is not fully documented in the available record.",
        impact: "The available record is insufficient to confirm a revenue or retention effect.",
        recommendedAction: "Review the source activity record and add current context before drawing a customer or revenue conclusion.",
        confidence: lead.last_activity_at || lead.source_file_id || lead.import_id ? "Medium" : "Low",
        evidence,
        evidenceCount: evidence.length,
        sourceTypes: ["Customer Evidence"],
        sourceHref: "/app/sources",
        priority: lead.last_activity_at || lead.source_file_id || lead.import_id ? "Medium" : "Low",
        lastUpdated: lead.updated_at || lead.created_at
      };
    }),
    ...improvingKpis.slice(0, 3).map((kpi) => {
      const history = historyCounts.get(kpi.name) || 1;

      return {
        id: `kpi-opportunity-${kpi.id}`,
        type: "Opportunity" as const,
        title: `${kpi.name} is on or above target`,
        summary: `Actual ${formatMetric(kpi.actual_value, kpi.name)} vs target ${formatMetric(kpi.target, kpi.name)}.`,
        why: "The latest recorded value meets or exceeds the current target.",
        impact: "The result may be worth preserving, but the current records do not establish its cause.",
        recommendedAction: "Review the period and supporting records to determine whether a repeatable practice is present.",
        confidence: history >= 3 ? "High" : "Medium",
        evidence: [`Metric date: ${kpi.metric_date}`, `Historical records: ${history}`, kpi.source ? `Source: ${kpi.source}` : "Source not recorded"],
        evidenceCount: 3,
        sourceTypes: ["KPIs"],
        sourceHref: "/app/kpis",
        priority: "Medium" as const,
        lastUpdated: kpi.updated_at || kpi.created_at
      };
    }),
    ...forecastReadyKpis.slice(0, 3).map((kpi) => ({
      id: `forecast-${kpi.id}`,
      type: "Forecast" as const,
      title: `${kpi.name} has enough history for trend review`,
      summary: `${historyCounts.get(kpi.name)} historical records are available for directional forecasting.`,
      why: "The metric has enough dated history for directional trend review.",
      impact: "The trend can inform a discussion, but it does not establish a forecasted outcome on its own.",
      recommendedAction: "Compare the trend with the most relevant current records before relying on it in a decision.",
      confidence: "Medium" as const,
      evidence: [`Latest value: ${formatMetric(kpi.actual_value, kpi.name)}`, `Target: ${formatMetric(kpi.target, kpi.name)}`, `History count: ${historyCounts.get(kpi.name)}`],
      evidenceCount: 3,
      sourceTypes: ["KPI history"],
      sourceHref: "/app/kpis",
      priority: "Medium" as const,
      lastUpdated: kpi.updated_at || kpi.created_at
    })),
    ...pendingImports.slice(0, 3).map((item) => ({
      id: `import-${item.id}`,
      type: "Recommendation" as const,
      title: `${item.import_type.replace(/_/g, " ")} import needs review`,
      summary: `${item.rows_imported} of ${item.rows_total} rows have been imported.`,
      why: "The import has not completed its required review step.",
      impact: "Current intelligence may not include the staged data until it is approved.",
      recommendedAction: "Review the import mapping before allowing the data to influence future intelligence.",
      confidence: "Medium" as const,
      evidence: [`Status: ${item.status}`, `Rows staged: ${item.rows_total}`, item.extraction_summary || "No extraction summary recorded"],
      evidenceCount: 3,
      sourceTypes: ["Files", "Imports"],
      sourceHref: "/app/files",
      priority: "Medium" as const,
      lastUpdated: item.imported_at || item.reviewed_at || item.created_at
    })),
    staleSops.length
      ? {
          id: "stale-process-knowledge",
          type: "Recommendation" as const,
          title: "Process knowledge may be stale",
          summary: `${staleSops.length} SOP${staleSops.length === 1 ? " is" : "s are"} older than 90 days.`,
          why: "The process documents have not been updated in more than 90 days.",
          impact: "Older process documentation can limit confidence in process-related conclusions.",
          recommendedAction: "Confirm whether the documents still reflect current operations and update the source material if they do not.",
          confidence: "Medium",
          evidence: [`Stale SOPs: ${staleSops.length}`, staleSops[0]?.title ? `Oldest example: ${staleSops[0].title}` : "No example available"],
          evidenceCount: 2,
          sourceTypes: ["SOPs", "Process Knowledge"],
          sourceHref: "/app/sops",
          priority: "Medium",
          lastUpdated: latestDate(staleSops.map((sop) => sop.updated_at || sop.created_at))
        }
      : null
  ].filter(Boolean) as IntelligenceInsight[];
  const sortedInsights = sortInsights(insights);
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
