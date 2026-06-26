import type { Database } from "@/lib/supabase/types";

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

function activeRows<T extends { archived_at?: string | null; deleted_at?: string | null }>(rows: T[]) {
  return rows.filter((row) => !row.archived_at && !row.deleted_at);
}

export function buildIntelligenceLayer(input: IntelligenceLayerInput): IntelligenceLayerResult {
  const workspace = input.workspace || null;
  const kpis = activeRows(input.kpis || []);
  const tasks = input.tasks || [];
  const issues = input.issues || [];
  const files = activeRows(input.files || []);
  const reports = input.reports || [];
  const vaeroexRuns = input.vaeroexRuns || [];
  const crmLeads = activeRows(input.crmLeads || []);
  const imports = input.imports || [];
  const sops = input.sops || [];
  const forms = input.forms || [];
  const submissions = input.submissions || [];
  const people = activeRows(input.people || []);
  const decisions = input.decisions || [];
  const recommendationOutcomes = activeRows(input.recommendationOutcomes || []);
  const openTasks = tasks.filter((task) => !isClosed(task.status));
  const overdueTasks = openTasks.filter((task) => isOverdue(task.due_date));
  const ownerlessTasks = openTasks.filter((task) => !task.assigned_to && !task.assigned_role && !task.assigned_person_id && !task.assigned_department);
  const openIssues = issues.filter((issue) => !isClosed(issue.status));
  const latestKpis = latestKpisByName(kpis);
  const historyCounts = kpiHistoryCounts(kpis);
  const belowTargetKpis = latestKpis.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value < kpi.target * 0.9);
  const improvingKpis = latestKpis.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value >= kpi.target);
  const pendingImports = imports.filter((item) => !["completed", "imported"].includes(lower(item.status)));
  const failedRuns = vaeroexRuns.filter((run) => run.status === "failed");
  const completedRuns = vaeroexRuns.filter((run) => run.status === "completed");
  const forecastReadyKpis = latestKpis.filter((kpi) => (historyCounts.get(kpi.name) || 0) >= 4);
  const staleSops = sops.filter((sop) => {
    const date = new Date(sop.updated_at || sop.created_at);
    const ageDays = (Date.now() - date.getTime()) / 86400000;
    return ageDays > 90;
  });
  const customerContextWithoutFollowup = crmLeads.filter((lead) => !isClosed(lead.status) && (!lead.last_activity_at || isOverdue(lead.last_activity_at)));
  const sourceRecords = files.length + reports.length + sops.length + forms.length + submissions.length + crmLeads.length;
  const suggestedNextData = [
    !kpis.length ? "Upload KPI history or create one owner-level KPI." : "",
    !reports.length ? "Upload or generate prior management reports." : "",
    !files.length ? "Upload a recent spreadsheet, report, meeting note, or SOP." : "",
    !crmLeads.length ? "Add customer context or import a customer/lead list." : "",
    !people.length ? "Add ownership context so Vaeroex can identify accountability gaps." : ""
  ].filter(Boolean);
  const dataQualityScore = Math.min(
    100,
    Math.round(
      (workspace?.industry || workspace?.size ? 10 : 0) +
        (files.length ? 15 : 0) +
        (kpis.length ? 25 : 0) +
        (reports.length ? 15 : 0) +
        (completedRuns.length ? 15 : 0) +
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
        summary: issue.recommended_fix || issue.description || `Issue is currently ${issue.status}.`,
        why: "Open issues indicate unresolved risk or a process gap leadership may need to prioritize.",
        impact: "Work can stall, repeat, or spread when the same issue remains unresolved.",
        recommendedAction: issue.recommended_fix || "Confirm the owner, severity, and next follow-up.",
        confidence: confidenceFromEvidence(evidence.length, priority),
        evidence,
        evidenceCount: evidence.length,
        sourceTypes: ["Issues"],
        sourceHref: "/app/issues",
        priority,
        lastUpdated: issue.updated_at || issue.created_at
      };
    }),
    ...overdueTasks.slice(0, 4).map((task) => {
      const priority = priorityFrom(task.priority);
      const evidence = [`Priority: ${task.priority}`, `Status: ${task.status}`, task.assigned_role || task.assigned_to ? `Owner: ${task.assigned_role || task.assigned_to}` : "No owner recorded"];

      return {
        id: `task-${task.id}`,
        type: "Risk" as const,
        title: task.title,
        summary: `Follow-up is overdue${task.due_date ? ` since ${task.due_date}` : ""}.`,
        why: "Overdue follow-ups reduce accountability and can hide recurring execution gaps.",
        impact: "Leadership loses visibility into whether the recommended work actually happened.",
        recommendedAction: "Assign or confirm an owner and decide whether this still matters.",
        confidence: confidenceFromEvidence(evidence.length, priority),
        evidence,
        evidenceCount: evidence.length,
        sourceTypes: ["Follow-ups"],
        sourceHref: "/app/tasks",
        priority,
        lastUpdated: task.updated_at || task.created_at
      };
    }),
    ownerlessTasks.length
      ? {
          id: "ownerless-follow-ups",
          type: "Bottleneck" as const,
          title: "Ownerless follow-ups are creating accountability risk",
          summary: `${ownerlessTasks.length} open follow-up${ownerlessTasks.length === 1 ? " has" : "s have"} no clear owner.`,
          why: "Vaeroex looks for work that exists without responsibility attached.",
          impact: "Work can stall because nobody is accountable for the next decision.",
          recommendedAction: "Assign owners to the oldest or highest-priority ownerless follow-ups.",
          confidence: ownerlessTasks.length >= 5 ? "High" : "Medium",
          evidence: [`Ownerless follow-ups: ${ownerlessTasks.length}`, `Open follow-ups: ${openTasks.length}`, ownerlessTasks[0]?.title ? `Oldest example: ${ownerlessTasks[0].title}` : "No example available"],
          evidenceCount: 3,
          sourceTypes: ["Follow-ups", "Ownership"],
          sourceHref: "/app/tasks",
          priority: ownerlessTasks.length >= 5 ? "High" : "Medium",
          lastUpdated: latestDate(ownerlessTasks.map((task) => task.updated_at || task.created_at))
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
        why: "A below-target KPI is a signal that performance changed or the target needs leadership review.",
        impact: "The metric may point to execution risk, weak process, or a target that needs a management decision.",
        recommendedAction: "Review related reports, files, and follow-ups before changing the target.",
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
      const evidence = [`Customer status: ${lead.status}`, lead.owner ? `Owner: ${lead.owner}` : "No owner recorded", lead.last_activity_at ? `Last activity: ${lead.last_activity_at}` : "No recent activity recorded"];

      return {
        id: `customer-risk-${lead.id}`,
        type: "Opportunity" as const,
        title: lead.company ? `${lead.lead_name} at ${lead.company}` : lead.lead_name,
        summary: `${formatMetric(lead.estimated_value, "revenue")} estimated value with weak follow-up context.`,
        why: "Customer context can reveal revenue opportunities when follow-up and ownership are visible.",
        impact: "Revenue can leak when customer context exists but follow-up discipline is unclear.",
        recommendedAction: "Review the next follow-up and decide whether this opportunity belongs in the leadership review.",
        confidence: lead.estimated_value ? "Medium" : "Low",
        evidence,
        evidenceCount: evidence.length,
        sourceTypes: ["Customer Context"],
        sourceHref: "/app/crm",
        priority: lead.estimated_value ? "Medium" : "Low",
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
        why: "Positive KPI movement can point to a repeatable practice worth preserving.",
        impact: "Leadership can identify what changed and protect the practice that produced the result.",
        recommendedAction: "Capture what changed and decide whether to turn it into a SOP, checklist, or report note.",
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
      why: "Vaeroex can forecast more responsibly when historical records exist across multiple periods.",
      impact: "This can support a management review, but should still be treated as directional decision support.",
      recommendedAction: "Compare this metric against recent files, reports, and action outcomes before making a decision.",
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
      why: "Unreviewed imported data can keep dashboards and reports from reflecting the newest business context.",
      impact: "Vaeroex may miss current patterns until source data is approved.",
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
          why: "Vaeroex uses process knowledge as source context for recommendations.",
          impact: "Old source knowledge can lower confidence in process recommendations.",
          recommendedAction: "Review stale SOPs and update the ones that describe active work.",
          confidence: "Medium",
          evidence: [`Stale SOPs: ${staleSops.length}`, staleSops[0]?.title ? `Oldest example: ${staleSops[0].title}` : "No example available"],
          evidenceCount: 2,
          sourceTypes: ["SOPs", "Process Knowledge"],
          sourceHref: "/app/sops",
          priority: "Medium",
          lastUpdated: latestDate(staleSops.map((sop) => sop.updated_at || sop.created_at))
        }
      : null,
    ...failedRuns.slice(0, 2).map((run) => ({
      id: `run-${run.id}`,
      type: "Anomaly" as const,
      title: `Vaeroex run failed: ${run.agent_type.replace(/_/g, " ")}`,
      summary: run.error_message || "The run did not complete.",
      why: "Failed intelligence runs reduce confidence until the underlying data or service issue is resolved.",
      impact: "The workspace may be missing a recent answer or generated recommendation.",
      recommendedAction: "Retry from Ask Vaeroex or review technical details if you are an admin.",
      confidence: "High" as const,
      evidence: [`Run status: ${run.status}`, `Created: ${new Date(run.created_at).toLocaleString()}`, run.error_message || "No error message recorded"],
      evidenceCount: 3,
      sourceTypes: ["Vaeroex Runs"],
      sourceHref: "/app/agents",
      priority: "High" as const,
      lastUpdated: run.created_at
    }))
  ].filter(Boolean) as IntelligenceInsight[];
  const sortedInsights = sortInsights(insights);
  const risks = sortedInsights.filter((insight) => insight.type === "Risk" || insight.type === "Bottleneck" || insight.type === "Anomaly");
  const opportunities = sortedInsights.filter((insight) => insight.type === "Opportunity");
  const recommendations = sortedInsights.filter((insight) => insight.type === "Recommendation" || insight.type === "Risk" || insight.type === "Bottleneck");
  const forecasts = sortedInsights.filter((insight) => insight.type === "Forecast");
  const riskPenalty = Math.min(45, risks.filter((risk) => risk.priority === "High").length * 12 + risks.filter((risk) => risk.priority === "Medium").length * 6);
  const healthScore = Math.max(10, Math.min(100, dataQualityScore - riskPenalty + Math.min(15, opportunities.length * 4)));
  const healthStatus = dataQualityScore < 25 ? "Insufficient Data" : healthScore >= 75 ? "Strong" : healthScore >= 50 ? "Watch" : "At Risk";
  const trend = risks.length > opportunities.length + 1 ? "Declining" : opportunities.length > risks.length ? "Improving" : dataQualityScore < 35 ? "Not enough history" : "Holding steady";
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
    topRisk,
    topOpportunity,
    topRecommendation,
    topForecast,
    insights: sortedInsights,
    memorySummary: {
      profileSignals: [workspace?.industry, workspace?.size].filter(Boolean).length,
      sourceRecords,
      kpiHistoryRecords: kpis.length,
      reports: reports.length,
      vaeroexRuns: vaeroexRuns.length,
      decisions: decisions.length,
      recommendationOutcomes: recommendationOutcomes.length
    }
  };
}
