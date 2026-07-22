import type { Route } from "next";
import type { Database } from "@/lib/supabase/types";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type AssetRow = Database["public"]["Tables"]["assets"]["Row"];
type ChecklistRow = Database["public"]["Tables"]["checklists"]["Row"];
type ChecklistRunRow = Database["public"]["Tables"]["checklist_runs"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type OperationalMetricRow = Database["public"]["Tables"]["operational_metrics"]["Row"];
type AssignmentRow = Database["public"]["Tables"]["operational_assignments"]["Row"];
type ShareRow = Database["public"]["Tables"]["record_shares"]["Row"];
type PersonRow = Database["public"]["Tables"]["people"]["Row"];
type BusinessDecisionRow = Database["public"]["Tables"]["business_decisions"]["Row"];
type RecommendationOutcomeRow = Database["public"]["Tables"]["vaeroex_recommendation_outcomes"]["Row"];

export type PrestigeDateRange = {
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
};

export type PrestigeInput = {
  workspaceName: string;
  isDemoWorkspace: boolean;
  periodLabel: string;
  range: PrestigeDateRange;
  kpis: KpiRow[];
  issues: IssueRow[];
  assets: AssetRow[];
  checklists: ChecklistRow[];
  checklistRuns: ChecklistRunRow[];
  sops: SopRow[];
  files: FileUploadRow[];
  imports: FileImportRow[];
  crmLeads: CrmLeadRow[];
  reports: ReportRow[];
  vaeroexRuns: VaeroexRunRow[];
  operationalMetrics: OperationalMetricRow[];
  assignments: AssignmentRow[];
  shares: ShareRow[];
  people: PersonRow[];
  decisions: BusinessDecisionRow[];
  recommendationOutcomes: RecommendationOutcomeRow[];
};

export type HealthCategory = {
  name: string;
  score: number;
  trend: "up" | "down" | "flat";
  explanation: string;
  improved: string;
  declined: string;
  nextAction: string;
};

export type PrestigeAction = {
  id: string;
  title: string;
  why: string;
  evidence: string;
  owner: string;
  dueDate: string;
  action: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  relatedModule: string;
  href: Route;
};

export type ProfitLeak = PrestigeAction & {
  severity: "Low" | "Medium" | "High";
  estimatedImpact: string;
};

export type MemoryMoment = {
  id: string;
  month: string;
  title: string;
  whatHappened: string;
  cause: string;
  actionTaken: string;
  outcome: string;
  href: Route;
};

export type DataGap = {
  id: string;
  title: string;
  why: string;
  href: Route;
  severity: "Low" | "Medium" | "High";
};

export type AccountabilityScorecard = {
  id: string;
  label: string;
  role?: string | null;
  department?: string | null;
  assignedWork: number;
  overdueWork: number;
  openIssues: number;
  completedWork: number;
  riskLevel: "Low" | "Medium" | "High";
  explanation: string;
};

export type DepartmentScorecard = {
  department: string;
  score: number;
  trend: "up" | "down" | "flat";
  openReviewItems: number;
  pastDueReviewItems: number;
  openIssues: number;
  kpiPerformance: string;
  checklistPerformance: string;
  crmImpact: string;
  explanation: string;
};

export type RoleBriefing = {
  role: string;
  title: string;
  summary: string;
  focus: string[];
};

export type BenchmarkItem = {
  title: string;
  status: "On track" | "Needs attention" | "Missing data";
  evidence: string;
  recommendedAction: string;
};

export type PrestigeIntelligence = {
  businessHealth: {
    score: number;
    explanation: string;
    dataQualityWarning: string | null;
    categories: HealthCategory[];
  };
  memoryTimeline: MemoryMoment[];
  focusPriorities: PrestigeAction[];
  profitLeaks: ProfitLeak[];
  accountabilityMap: AccountabilityScorecard[];
  departmentScorecards: DepartmentScorecard[];
  dataQuality: {
    score: number;
    gaps: DataGap[];
  };
  toolSprawl: {
    score: number;
    modulesUsed: string[];
    modulesNotUsed: string[];
    replaced: string[];
    explanation: string;
  };
  decisions: {
    recent: BusinessDecisionRow[];
    reviewDue: BusinessDecisionRow[];
    outcomeNotes: string[];
  };
  recommendationTracking: {
    saved: RecommendationOutcomeRow[];
    approvalQueue: PrestigeAction[];
    outcomeNotes: string[];
  };
  meetingMode: {
    agenda: string[];
    nextAssignments: PrestigeAction[];
  };
  riskSimulation: PrestigeAction[];
  ceoMode: {
    summary: string;
    actions: string[];
  };
  businessReviewPackage: {
    title: string;
    body: string;
    sections: { title: string; lines: string[] }[];
  };
  benchmarkMode: BenchmarkItem[];
  roleBriefings: RoleBriefing[];
};

const currencyFormatter = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const lowerIsBetterWords = ["response", "overdue", "open issue", "complaint", "cost", "delay", "missed"];
const departments = ["Operations", "Sales", "Customer Service", "Field Operations", "Admin", "Finance", "HR", "Warehouse"];

function lower(value: string | null | undefined) {
  return (value || "").toLowerCase();
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isOlderThan(value: string | null | undefined, days: number) {
  if (!value) return false;
  return new Date(value).getTime() < Date.now() - days * 24 * 60 * 60 * 1000;
}

function monthLabel(value: string | null | undefined) {
  if (!value) return "Recent";
  return new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(value));
}

function isOpenIssue(issue: IssueRow) {
  const status = lower(issue.status);
  return status !== "closed" && status !== "resolved";
}

function isConvertedLead(lead: CrmLeadRow) {
  const status = lower(lead.status);
  return status.includes("won") || status.includes("converted") || status.includes("customer");
}

function isProposalLead(lead: CrmLeadRow) {
  const status = lower(lead.status);
  return status.includes("proposal") || status.includes("quote") || status.includes("estimate");
}

function isLowerBetterMetric(name: string) {
  return lowerIsBetterWords.some((word) => lower(name).includes(word));
}

function metricOnTarget(kpi: KpiRow) {
  if (kpi.actual_value === null || kpi.target === null) return null;
  return isLowerBetterMetric(`${kpi.name} ${kpi.category || ""}`) ? kpi.actual_value <= kpi.target : kpi.actual_value >= kpi.target;
}

function latestKpis(kpis: KpiRow[]) {
  const latest = new Map<string, KpiRow>();

  for (const row of kpis) {
    if (!latest.has(row.name)) {
      latest.set(row.name, row);
    }
  }

  return [...latest.values()];
}

function findKpi(kpis: KpiRow[], words: string[]) {
  return latestKpis(kpis).find((row) => {
    const haystack = `${lower(row.name)} ${lower(row.category)}`;
    return words.some((word) => haystack.includes(word));
  });
}

function formatMetric(value: number | null | undefined, label: string) {
  if (value === null || value === undefined) return "missing";
  const normalized = lower(label);
  if (normalized.includes("revenue") || normalized.includes("sales") || normalized.includes("value")) return currencyFormatter.format(value);
  if (normalized.includes("rate") || normalized.includes("completion") || normalized.includes("satisfaction")) return `${numberFormatter.format(value)}%`;
  if (normalized.includes("time")) return `${numberFormatter.format(value)} hours`;
  return numberFormatter.format(value);
}

function completionRate(rows: ChecklistRunRow[]) {
  if (!rows.length) return null;
  const completed = rows.filter((row) => Boolean(row.completed_at) || ["complete", "completed", "done"].includes(lower(row.status))).length;
  return (completed / rows.length) * 100;
}

function kpiTargetRate(kpis: KpiRow[]) {
  const rows = latestKpis(kpis).filter((row) => row.actual_value !== null && row.target !== null);
  if (!rows.length) return null;
  return (rows.filter((row) => metricOnTarget(row)).length / rows.length) * 100;
}

function scoreFromBoolean(good: boolean, goodScore = 92, badScore = 58) {
  return good ? goodScore : badScore;
}

function scoreFromRate(value: number | null, fallback: number) {
  return value === null ? fallback : clampScore(value);
}

function action({
  id,
  title,
  why,
  evidence,
  owner = "Manager",
  dueDate = addDays(todayDate(), 7),
  action: actionText,
  priority = "Medium",
  relatedModule = "Issues",
  href = "/app/issues"
}: Partial<PrestigeAction> & Pick<PrestigeAction, "id" | "title" | "why" | "evidence" | "action">): PrestigeAction {
  return {
    id,
    title,
    why,
    evidence,
    owner,
    dueDate,
    action: actionText,
    priority,
    relatedModule,
    href: href as Route
  };
}

function healthCategory(input: {
  name: string;
  score: number;
  trend?: "up" | "down" | "flat";
  explanation: string;
  improved: string;
  declined: string;
  nextAction: string;
}): HealthCategory {
  return {
    name: input.name,
    score: clampScore(input.score),
    trend: input.trend || (input.score >= 75 ? "up" : input.score < 60 ? "down" : "flat"),
    explanation: input.explanation,
    improved: input.improved,
    declined: input.declined,
    nextAction: input.nextAction
  };
}

function buildDataQuality(input: PrestigeInput) {
  const openIssues = input.issues.filter(isOpenIssue);
  const latest = latestKpis(input.kpis);
  const gaps: DataGap[] = [
    ...input.crmLeads
      .filter((lead) => !isConvertedLead(lead) && !lead.last_activity_at)
      .slice(0, 4)
      .map((lead) => ({
        id: `crm-${lead.id}`,
        title: `${lead.lead_name} has limited recent activity evidence`,
        why: "Customer activity gaps can indicate retention, conversion, or response-quality risk without making Vaeroex the customer system.",
        href: "/app/sources" as Route,
        severity: "High" as const
      })),
    ...latest
      .filter((kpi) => kpi.target === null)
      .slice(0, 4)
      .map((kpi) => ({
        id: `kpi-${kpi.id}`,
        title: `${kpi.name} has no target`,
        why: "Vaeroex can explain performance better when each key metric has a target.",
        href: "/app/kpis" as Route,
        severity: "Medium" as const
      })),
    ...openIssues
      .filter((issue) => !issue.assigned_person_id && !issue.assigned_role && !issue.assigned_department && !issue.assigned_to)
      .slice(0, 4)
      .map((issue) => ({
        id: `issue-${issue.id}`,
        title: `${issue.title} has unclear responsibility`,
        why: "Open issues with unclear responsibility deserve leadership review before risk compounds.",
        href: "/app/issues" as Route,
        severity: "High" as const
      })),
    ...input.sops
      .filter((sop) => isOlderThan(sop.updated_at || sop.created_at, 90))
      .slice(0, 4)
      .map((sop) => ({
        id: `sop-${sop.id}`,
        title: `${sop.title} may be stale`,
        why: "SOPs should be reviewed at least every 90 days or after a major process change.",
        href: "/app/sops" as Route,
        severity: "Medium" as const
      })),
    ...input.files
      .filter((file) => !file.analysis_summary && !file.deleted_at && !file.archived_at)
      .slice(0, 4)
      .map((file) => ({
        id: `file-${file.id}`,
        title: `${file.display_name} has not been analyzed`,
        why: "Uploaded files should either feed business memory or explain a business trend.",
        href: "/app/sources" as Route,
        severity: "Medium" as const
      })),
    ...input.assets
      .filter((asset) => !asset.deleted_at && !asset.archived_at && (!asset.assigned_to || isOlderThan(asset.last_checked_at, 60)))
      .slice(0, 4)
      .map((asset) => ({
        id: `asset-${asset.id}`,
        title: `${asset.asset_name} needs asset record review`,
        why: "Assets that affect operations should have recent checks and clear source context.",
        href: "/app/assets" as Route,
        severity: "Low" as const
      }))
  ];
  const score = clampScore(100 - gaps.filter((gap) => gap.severity === "High").length * 8 - gaps.filter((gap) => gap.severity === "Medium").length * 5 - gaps.filter((gap) => gap.severity === "Low").length * 2);

  return { score, gaps };
}

function buildHealth(input: PrestigeInput, dataQuality: ReturnType<typeof buildDataQuality>) {
  const openIssues = input.issues.filter(isOpenIssue);
  const revenue = findKpi(input.kpis, ["revenue", "sales"]);
  const conversion = findKpi(input.kpis, ["conversion"]);
  const satisfaction = findKpi(input.kpis, ["satisfaction"]);
  const responseTime = findKpi(input.kpis, ["response"]);
  const checklistCompletion = findKpi(input.kpis, ["checklist completion"]);
  const sopReview = findKpi(input.kpis, ["sop review"]);
  const targetRate = kpiTargetRate(input.kpis);
  const checkRate = checklistCompletion?.actual_value ?? completionRate(input.checklistRuns);
  const leadsWithoutFollowUp = input.crmLeads.filter((lead) => !isConvertedLead(lead) && !lead.last_activity_at);
  const processScore = scoreFromRate(sopReview?.actual_value ?? null, input.sops.length ? 72 : 55);
  const customerScore = satisfaction?.actual_value ?? (responseTime && metricOnTarget(responseTime) === false ? 62 : input.crmLeads.length ? 76 : 55);
  const operationsScore = clampScore(88 - openIssues.length * 3 + Math.max(0, (checkRate ?? 80) - 85) / 2);
  const salesScore = clampScore((revenue && metricOnTarget(revenue) ? 88 : 66) + (conversion && metricOnTarget(conversion) ? 8 : -8) - leadsWithoutFollowUp.length * 3);
  const sourceVisibilityScore = clampScore(90 + Math.min(10, input.assignments.filter((item) => lower(item.status) === "done").length * 2));
  const teamScore = clampScore(70 + input.people.filter((person) => person.role_title && person.department).length * 4);
  const categories = [
    healthCategory({
      name: "Operational Intelligence Health",
      score: operationsScore,
      explanation: `${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"} and checklist completion at ${formatMetric(checkRate, "Checklist Completion Rate")}.`,
      improved: checkRate && checkRate >= 90 ? "Checklist discipline is improving operational visibility." : "Core business records are now centralized enough to review.",
      declined: openIssues.length ? "Open issues may indicate operating risk that leadership should review." : "No major operational decline is visible.",
      nextAction: openIssues.length ? "Review the highest-severity open issue before the next leadership meeting." : "Keep reviewing checklist completion weekly."
    }),
    healthCategory({
      name: "Sales Health",
      score: salesScore,
      explanation: `${revenue ? `Revenue is ${formatMetric(revenue.actual_value, revenue.name)} against target ${formatMetric(revenue.target, revenue.name)}.` : "Revenue KPI is missing."} ${conversion ? `Conversion is ${formatMetric(conversion.actual_value, conversion.name)}.` : ""}`,
      improved: revenue && metricOnTarget(revenue) ? "Revenue is at or above target." : "Customer activity evidence is available for response-quality review.",
      declined: conversion && metricOnTarget(conversion) === false ? "Conversion is below target." : leadsWithoutFollowUp.length ? "Some customer records show response gaps." : "No major sales decline is visible.",
      nextAction: leadsWithoutFollowUp.length ? "Review customer activity evidence as a leadership issue." : "Review conversion against recent customer activity evidence."
    }),
    healthCategory({
      name: "Source Visibility",
      score: sourceVisibilityScore,
      explanation: `${input.files.length} source file${input.files.length === 1 ? " is" : "s are"} available; ${dataQuality.gaps.length} evidence gap${dataQuality.gaps.length === 1 ? " remains" : "s remain"}.`,
      improved: sourceVisibilityScore >= 85 ? "Source evidence is sufficiently complete for useful review." : "Available sources provide a starting point for leadership review.",
      declined: dataQuality.gaps.length ? "Missing source context, targets, or history reduce confidence." : "No major source-context drag is visible.",
      nextAction: "Review the top Vaeroex priority and decide whether leadership needs an executive report, meeting agenda, or improvement plan."
    }),
    healthCategory({
      name: "Customer Experience Health",
      score: customerScore,
      explanation: `${satisfaction ? `Satisfaction is ${formatMetric(satisfaction.actual_value, satisfaction.name)}.` : "Customer satisfaction is not fully tracked."} ${responseTime ? `Response time is ${formatMetric(responseTime.actual_value, responseTime.name)}.` : ""}`,
      improved: satisfaction && metricOnTarget(satisfaction) ? "Customer satisfaction is at or above target." : "Customer signals are available for review.",
      declined: responseTime && metricOnTarget(responseTime) === false ? "Response time is above target." : "No major customer experience decline is visible.",
      nextAction: responseTime && metricOnTarget(responseTime) === false ? "Review the response-time workflow as a leadership issue." : "Keep tracking satisfaction and response time."
    }),
    healthCategory({
      name: "Process Health",
      score: processScore,
      explanation: `${input.sops.length} SOPs and ${input.checklists.length} checklists are available; SOP review is ${formatMetric(sopReview?.actual_value, "SOP Review Completion")}.`,
      improved: processScore >= 80 ? "Process review discipline is strong." : "SOPs and checklists are centralized for review.",
      declined: processScore < 75 ? "SOP or checklist review needs attention." : "No major process decline is visible.",
      nextAction: "Review stale SOPs and missed checklist runs."
    }),
    healthCategory({
      name: "Data Quality Health",
      score: dataQuality.score,
      explanation: `${dataQuality.gaps.length} data gap${dataQuality.gaps.length === 1 ? "" : "s"} are currently visible.`,
      improved: dataQuality.score >= 80 ? "Workspace data is structured enough for useful analysis." : "Vaeroex can identify exactly which data gaps to fix.",
      declined: dataQuality.gaps.length ? "Missing source context, targets, activity history, or analyses reduce confidence." : "No major data quality decline is visible.",
      nextAction: dataQuality.gaps[0]?.title || "Keep records complete as work is created."
    }),
    healthCategory({
      name: "Team Context Health",
      score: teamScore,
      explanation: `${input.people.length} people record${input.people.length === 1 ? " is" : "s are"} available as organizational context.`,
      improved: input.people.length ? "People records add role and area context to leadership briefings." : "Team context can improve once people records are added.",
      declined: input.people.length ? "No major team-context decline is visible." : "Role and department context is limited.",
      nextAction: "Use source visibility to review overloaded areas with leadership."
    })
  ];
  const score = clampScore(categories.reduce((sum, category) => sum + category.score, 0) / categories.length);
  const weak = categories.filter((category) => category.score < 70).sort((a, b) => a.score - b.score)[0];
  const strong = categories.filter((category) => category.score >= 80).sort((a, b) => b.score - a.score)[0];
  const dataMissing = !input.kpis.length || !input.crmLeads.length || !input.reports.length;

  return {
    score,
    explanation: `Business Health Score: ${score}/100. ${strong ? `${strong.name} is strongest because ${strong.improved.toLowerCase()}` : "The workspace is still building enough history."} ${weak ? `${weak.name} needs attention because ${weak.declined.toLowerCase()}` : "No category is critically weak right now."}`,
    dataQualityWarning: dataMissing ? "Some score inputs are missing. Vaeroex is using available workspace data and will improve confidence as KPIs, customer activity evidence, reports, and files are added." : null,
    categories
  };
}

function buildFocusPriorities(input: PrestigeInput, dataQuality: ReturnType<typeof buildDataQuality>) {
  const openIssues = input.issues.filter(isOpenIssue);
  const conversion = findKpi(input.kpis, ["conversion"]);
  const responseTime = findKpi(input.kpis, ["response"]);
  const revenue = findKpi(input.kpis, ["revenue", "sales"]);
  const priorities: PrestigeAction[] = [];

  if (conversion && metricOnTarget(conversion) === false) {
    priorities.push(action({
      id: "conversion-decline",
      title: "Review customer conversion decline",
      why: "Sales Health is at risk when customer activity evidence exists but conversion misses target.",
      evidence: `${conversion.name}: ${formatMetric(conversion.actual_value, conversion.name)} vs target ${formatMetric(conversion.target, conversion.name)}.`,
      owner: "Leadership Review",
      dueDate: addDays(todayDate(), 3),
      action: "Review conversion quality and customer activity evidence with leadership.",
      priority: "High",
      relatedModule: "Customer Evidence",
      href: "/app/sources"
    }));
  }

  if (revenue && metricOnTarget(revenue) === false) {
    priorities.push(action({
      id: "revenue-below-target",
      title: "Stabilize revenue below target",
      why: "Revenue below target needs a fast review of customer activity, conversion quality, and operational delivery.",
      evidence: `${revenue.name}: ${formatMetric(revenue.actual_value, revenue.name)} vs target ${formatMetric(revenue.target, revenue.name)}.`,
      owner: "Owner",
      dueDate: addDays(todayDate(), 4),
      action: "Generate a revenue recovery report for leadership review.",
      priority: "High",
      relatedModule: "Reports",
      href: "/app/reports"
    }));
  }

  if (responseTime && metricOnTarget(responseTime) === false) {
    priorities.push(action({
      id: "response-time-risk",
      title: "Reduce response-time risk",
      why: "Slow response time can hurt conversion, customer satisfaction, and complaint volume.",
      evidence: `${responseTime.name}: ${formatMetric(responseTime.actual_value, responseTime.name)} vs target ${formatMetric(responseTime.target, responseTime.name)}.`,
      owner: "Customer Service Manager",
      dueDate: addDays(todayDate(), 2),
      action: "Review the response process and escalation SOP as a leadership issue.",
      priority: "High",
      relatedModule: "SOPs",
      href: "/app/sops"
    }));
  }

  if (openIssues.length) {
    priorities.push(action({
      id: "open-issues",
      title: "Resolve high-risk open issues",
      why: "Issues that stay open become recurring operational cost and customer risk.",
      evidence: `${openIssues.length} issue${openIssues.length === 1 ? "" : "s"} are still open.`,
      owner: "Operations Manager",
      dueDate: addDays(todayDate(), 5),
      action: "Sort open issues by severity and review the top risk with leadership.",
      priority: "Medium",
      relatedModule: "Issues",
      href: "/app/issues"
    }));
  }

  if (dataQuality.gaps.length) {
    priorities.push(action({
      id: "fix-data-gaps",
      title: "Fix the highest data gaps",
      why: "Vaeroex can be more decisive when records have source context, targets, activity history, and supporting analysis.",
      evidence: `${dataQuality.gaps.length} gap${dataQuality.gaps.length === 1 ? "" : "s"} found; first gap: ${dataQuality.gaps[0].title}.`,
      owner: "Coordinator",
      dueDate: addDays(todayDate(), 7),
      action: "Review the first gap and add the missing context, target, source history, or analysis.",
      priority: "Medium",
      relatedModule: "KPIs",
      href: dataQuality.gaps[0].href
    }));
  }

  return priorities.slice(0, 5);
}

function buildProfitLeaks(input: PrestigeInput) {
  const leaks: ProfitLeak[] = [];
  const staleLeads = input.crmLeads.filter((lead) => !isConvertedLead(lead) && (!lead.last_activity_at || isOlderThan(lead.last_activity_at, 14)));
  const staleProposalLeads = staleLeads.filter(isProposalLead);
  const lostValue = staleLeads.reduce((sum, lead) => sum + (lead.estimated_value || 0), 0);
  const conversion = findKpi(input.kpis, ["conversion"]);
  const revenue = findKpi(input.kpis, ["revenue", "sales"]);
  const checklistRate = findKpi(input.kpis, ["checklist completion"])?.actual_value ?? completionRate(input.checklistRuns);

  if (staleLeads.length) {
    leaks.push({
      ...action({
        id: "stale-leads",
        title: "Customer response activity may be weakening",
        why: "Customer records without recent activity can indicate revenue, retention, or response-quality risk.",
        evidence: `${staleLeads.length} customer activity record${staleLeads.length === 1 ? "" : "s"} have no recent activity evidence.`,
        owner: "Leadership Review",
        dueDate: addDays(todayDate(), 2),
        action: "Review customer activity evidence and decide whether leadership needs an executive report or improvement plan.",
        priority: "High",
        relatedModule: "Customer Evidence",
        href: "/app/sources"
      }),
      severity: lostValue > 15000 ? "High" : "Medium",
      estimatedImpact: lostValue > 0 ? currencyFormatter.format(lostValue) : "Potential revenue exposure"
    });
  }

  if (staleProposalLeads.length) {
    leaks.push({
      ...action({
        id: "proposal-stall",
      title: "Customer activity with proposal context is not moving",
      why: "Customer records with proposal context but no recent activity can indicate preventable revenue risk.",
      evidence: `${staleProposalLeads.length} customer evidence record${staleProposalLeads.length === 1 ? "" : "s"} with proposal context are stale.`,
        owner: "Leadership Review",
        dueDate: addDays(todayDate(), 3),
        action: "Review proposal-context movement and response quality as a leadership concern.",
        priority: "High",
        relatedModule: "Customer Evidence",
        href: "/app/sources"
      }),
      severity: "High",
      estimatedImpact: "High opportunity risk"
    });
  }

  if (conversion && metricOnTarget(conversion) === false) {
    leaks.push({
      ...action({
        id: "low-conversion",
        title: "Conversion rate is below operating standard",
        why: "Low conversion can offset healthy customer activity and weaken revenue momentum.",
        evidence: `${conversion.name}: ${formatMetric(conversion.actual_value, conversion.name)} vs target ${formatMetric(conversion.target, conversion.name)}.`,
        owner: "Owner",
        dueDate: addDays(todayDate(), 5),
        action: "Generate a conversion review report and inspect response quality.",
        priority: "High",
        relatedModule: "Reports",
        href: "/app/reports"
      }),
      severity: "High",
      estimatedImpact: "Revenue risk"
    });
  }

  if (revenue && metricOnTarget(revenue) === false) {
    leaks.push({
      ...action({
        id: "revenue-target",
        title: "Revenue is below target",
        why: "Revenue below target may reflect customer activity gaps, delivery constraints, or pricing/volume problems.",
        evidence: `${revenue.name}: ${formatMetric(revenue.actual_value, revenue.name)} vs target ${formatMetric(revenue.target, revenue.name)}.`,
        owner: "Owner",
        dueDate: addDays(todayDate(), 4),
        action: "Prepare a revenue recovery package for leadership review.",
        priority: "High",
        relatedModule: "Reports",
        href: "/app/reports"
      }),
      severity: "High",
      estimatedImpact: "Monthly revenue gap"
    });
  }

  if (checklistRate !== null && checklistRate < 90) {
    leaks.push({
      ...action({
        id: "missed-checklists",
        title: "Missed checklists may be creating rework",
        why: "Checklist misses are an early warning for service, quality, or handoff mistakes.",
        evidence: `Checklist completion is ${numberFormatter.format(checklistRate)}%.`,
        owner: "Supervisor",
        dueDate: addDays(todayDate(), 5),
      action: "Review checklist compliance evidence and document the likely operational cause.",
        priority: "Medium",
        relatedModule: "Checklists",
        href: "/app/checklists"
      }),
      severity: "Medium",
      estimatedImpact: "Rework and service risk"
    });
  }

  return leaks.slice(0, 6);
}

function buildMemoryTimeline(input: PrestigeInput, focus: PrestigeAction[]) {
  const moments: MemoryMoment[] = [];
  const latestBelowTarget = latestKpis(input.kpis).filter((row) => metricOnTarget(row) === false).slice(0, 5);

  for (const kpi of latestBelowTarget) {
    moments.push({
      id: `kpi-${kpi.id}`,
      month: monthLabel(kpi.metric_date),
      title: `${kpi.name} missed target`,
      whatHappened: `${kpi.name} recorded ${formatMetric(kpi.actual_value, kpi.name)} against target ${formatMetric(kpi.target, kpi.name)}.`,
      cause: kpi.notes || "Likely connected to workload, response activity, process, or data quality changes.",
      actionTaken: focus[0]?.action || "Review related source records and decide whether an improvement plan is needed.",
      outcome: "Outcome will be clearer after the next KPI update.",
      href: "/app/kpis"
    });
  }

  for (const report of input.reports.slice(0, 4)) {
    moments.push({
      id: `report-${report.id}`,
      month: monthLabel(report.date_range_start || report.created_at),
      title: report.title,
      whatHappened: report.report_type,
      cause: "Report saved the business story for this period.",
      actionTaken: "Review recommendations and decide which supporting document leadership needs.",
      outcome: "Saved as part of business memory.",
      href: "/app/reports"
    });
  }

  for (const file of input.files.filter((item) => item.analysis_summary).slice(0, 3)) {
    moments.push({
      id: `file-${file.id}`,
      month: monthLabel(file.created_at),
      title: `${file.display_name} analyzed`,
      whatHappened: file.analysis_summary || "File analysis was saved.",
      cause: "Uploaded file added historical context.",
      actionTaken: "Use extracted findings in reports and KPI review.",
      outcome: `${file.imported_rows} imported row${file.imported_rows === 1 ? "" : "s"} recorded.`,
      href: "/app/sources"
    });
  }

  for (const decision of input.decisions.slice(0, 4)) {
    moments.push({
      id: `decision-${decision.id}`,
      month: monthLabel(decision.created_at),
      title: decision.title,
      whatHappened: decision.reason || "Decision was logged.",
      cause: decision.related_kpi ? `Connected to ${decision.related_kpi}.` : "Leadership decision.",
      actionTaken: decision.expected_outcome || "Expected outcome is being tracked.",
      outcome: decision.outcome_summary || "Awaiting review.",
      href: "/app"
    });
  }

  return moments.sort((a, b) => b.id.localeCompare(a.id)).slice(0, 10);
}

function buildAccountability(input: PrestigeInput) {
  const peopleById = new Map(input.people.map((person) => [person.id, person]));
  const scorecards: AccountabilityScorecard[] = input.people.map((person) => {
    const assignedAssignments = input.assignments.filter((assignment) => assignment.assigned_person_id === person.id);
    const assignedIssues = input.issues.filter((issue) => issue.assigned_person_id === person.id);
    const openAssignments = assignedAssignments.filter((assignment) => !["done", "complete", "completed", "dismissed"].includes(lower(assignment.status)));
    const overdue = openAssignments.filter((assignment) => Boolean(assignment.due_date && assignment.due_date < todayDate())).length;
    const openIssues = assignedIssues.filter(isOpenIssue).length;
    const completed = assignedAssignments.filter((assignment) => ["done", "complete", "completed"].includes(lower(assignment.status))).length;
    const riskLevel = overdue + openIssues >= 4 ? "High" : overdue + openIssues >= 2 ? "Medium" : "Low";

    return {
      id: person.id,
      label: person.full_name,
      role: person.role_title,
      department: person.department,
      assignedWork: openAssignments.length,
      overdueWork: overdue,
      openIssues,
      completedWork: completed,
      riskLevel,
      explanation:
        riskLevel === "High"
          ? `${person.full_name} is connected to the highest concentration of open review items and may need leadership review.`
          : `${person.full_name} has a ${riskLevel.toLowerCase()} visible source-context risk.`
    };
  });
  const roleGroups = Array.from(new Set(input.people.map((person) => person.role_title).filter(Boolean) as string[]));
  const departmentGroups = Array.from(new Set(input.people.map((person) => person.department).filter(Boolean) as string[]));

  for (const role of roleGroups) {
    const issues = input.issues.filter((issue) => issue.assigned_role === role);
    const assignments = input.assignments.filter((assignment) => assignment.assigned_role === role);
    const openAssignments = assignments.filter((assignment) => !["done", "complete", "completed", "dismissed"].includes(lower(assignment.status)));
    const overdue = openAssignments.filter((assignment) => Boolean(assignment.due_date && assignment.due_date < todayDate())).length;
    const openIssues = issues.filter(isOpenIssue).length;
    scorecards.push({
      id: `role-${role}`,
      label: role,
      role,
      department: null,
      assignedWork: openAssignments.length,
      overdueWork: overdue,
      openIssues,
      completedWork: assignments.filter((assignment) => ["done", "complete", "completed"].includes(lower(assignment.status))).length,
      riskLevel: overdue + openIssues >= 5 ? "High" : overdue + openIssues >= 2 ? "Medium" : "Low",
      explanation: `${role} is connected to ${openAssignments.length} open review item${openAssignments.length === 1 ? "" : "s"}.`
    });
  }

  for (const department of departmentGroups) {
    const issues = input.issues.filter((issue) => issue.assigned_department === department);
    const assignments = input.assignments.filter((assignment) => assignment.assigned_department === department);
    const openAssignments = assignments.filter((assignment) => !["done", "complete", "completed", "dismissed"].includes(lower(assignment.status)));
    const overdue = openAssignments.filter((assignment) => Boolean(assignment.due_date && assignment.due_date < todayDate())).length;
    const openIssues = issues.filter(isOpenIssue).length;
    scorecards.push({
      id: `department-${department}`,
      label: department,
      role: null,
      department,
      assignedWork: openAssignments.length,
      overdueWork: overdue,
      openIssues,
      completedWork: assignments.filter((assignment) => ["done", "complete", "completed"].includes(lower(assignment.status))).length,
      riskLevel: overdue + openIssues >= 5 ? "High" : overdue + openIssues >= 2 ? "Medium" : "Low",
      explanation: `${department} has ${overdue} past-due review item${overdue === 1 ? "" : "s"} and ${openIssues} open issue${openIssues === 1 ? "" : "s"}.`
    });
  }

  return scorecards
    .filter((item) => item.assignedWork || item.openIssues || item.completedWork || peopleById.has(item.id))
    .sort((a, b) => (b.riskLevel === "High" ? 2 : b.riskLevel === "Medium" ? 1 : 0) - (a.riskLevel === "High" ? 2 : a.riskLevel === "Medium" ? 1 : 0))
    .slice(0, 12);
}

function buildDepartmentScorecards(input: PrestigeInput) {
  const allDepartments = Array.from(
    new Set([
      ...departments,
      ...input.people.map((person) => person.department).filter(Boolean),
      ...input.issues.map((issue) => issue.assigned_department || issue.issue_type).filter(Boolean)
    ] as string[])
  ).slice(0, 12);

  return allDepartments.map((department) => {
    const openReviewItems = input.assignments.filter((assignment) =>
      assignment.assigned_department === department && !["done", "complete", "completed", "dismissed"].includes(lower(assignment.status))
    );
    const pastDueReviewItems = openReviewItems.filter((assignment) => Boolean(assignment.due_date && assignment.due_date < todayDate()));
    const openIssues = input.issues.filter((issue) => isOpenIssue(issue) && (issue.assigned_department === department || issue.issue_type === department));
    const kpiRows = latestKpis(input.kpis).filter((kpi) => kpi.category === department || kpi.owner === department);
    const onTarget = kpiRows.length ? kpiRows.filter((kpi) => metricOnTarget(kpi)).length / kpiRows.length : null;
    const checkRows = input.checklistRuns.filter((run) => run.assigned_department === department || run.assigned_role === department);
    const checkRate = completionRate(checkRows);
    const score = clampScore(88 - pastDueReviewItems.length * 7 - openIssues.length * 5 + (onTarget !== null ? onTarget * 10 : 0) + ((checkRate ?? 80) - 80) / 3);

    return {
      department,
      score,
      trend: score >= 80 ? "up" : score < 65 ? "down" : "flat",
      openReviewItems: openReviewItems.length,
      pastDueReviewItems: pastDueReviewItems.length,
      openIssues: openIssues.length,
      kpiPerformance: kpiRows.length ? `${Math.round((onTarget || 0) * 100)}% of visible KPIs on target` : "No department KPIs yet",
      checklistPerformance: checkRate === null ? "No department checklist runs yet" : `${numberFormatter.format(checkRate)}% completion`,
      crmImpact: lower(department).includes("sales") ? `${input.crmLeads.filter((lead) => !isConvertedLead(lead)).length} active customer activity records` : "No direct customer evidence impact",
      explanation:
        score < 70
          ? `${department} scores lower because open review items, issues, or missing KPI/checklist evidence need attention.`
          : `${department} is relatively stable based on current issues, KPIs, checklist results, and review items.`
    } satisfies DepartmentScorecard;
  });
}

function buildToolSprawl(input: PrestigeInput) {
  const usage = [
    ["KPIs", input.kpis.length > 0, "manual KPI tracker"],
    ["Customer evidence", input.crmLeads.length > 0, "customer activity source"],
    ["Checklists", input.checklists.length > 0, "paper checklist"],
    ["Files", input.files.length > 0, "shared drive review"],
    ["Reports", input.reports.length > 0, "manual report doc"],
    ["SOPs", input.sops.length > 0, "SOP folder"],
    ["People", input.people.length > 0, "team contact sheet"],
    ["Assets", input.assets.length > 0, "asset tracker"]
  ] as const;
  const modulesUsed = usage.filter((item) => item[1]).map((item) => item[0]);
  const modulesNotUsed = usage.filter((item) => !item[1]).map((item) => item[0]);
  const replaced = usage.filter((item) => item[1]).map((item) => item[2]);
  const score = clampScore((modulesUsed.length / usage.length) * 100);

  return {
    score,
    modulesUsed,
    modulesNotUsed,
    replaced,
    explanation: `Business intelligence centralized: ${score}%. Vaeroex has enough context to reduce manual analysis across ${replaced.length ? replaced.join(", ") : "source records as data is added"}.`
  };
}

function buildBenchmarkMode(input: PrestigeInput) {
  const responseTime = findKpi(input.kpis, ["response"]);
  const latest = latestKpis(input.kpis);
  const openIssues = input.issues.filter(isOpenIssue);
  const leadsWithoutFollowup = input.crmLeads.filter((lead) => !isConvertedLead(lead) && !lead.last_activity_at);
  const recentReports = input.reports.filter((report) => isOlderThan(report.created_at, 14) === false);
  const staleSops = input.sops.filter((sop) => isOlderThan(sop.updated_at || sop.created_at, 90));

  return [
    {
      title: "Customer response activity should be visible within 24 hours",
      status: responseTime ? (metricOnTarget(responseTime) ? "On track" : "Needs attention") : "Missing data",
      evidence: responseTime ? `${responseTime.name}: ${formatMetric(responseTime.actual_value, responseTime.name)}` : "No response-time KPI found.",
      recommendedAction: "Review response-time evidence and delayed records as a leadership issue."
    },
    {
      title: "SOPs should be reviewed every 90 days",
      status: staleSops.length ? "Needs attention" : input.sops.length ? "On track" : "Missing data",
      evidence: staleSops.length ? `${staleSops.length} stale SOPs detected.` : `${input.sops.length} SOPs available.`,
      recommendedAction: "Generate an SOP review brief for leadership."
    },
    {
      title: "Critical issues should show clear responsibility",
      status: openIssues.some((issue) => !issue.assigned_person_id && !issue.assigned_role && !issue.assigned_department) ? "Needs attention" : openIssues.length ? "On track" : "Missing data",
      evidence: `${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"} found.`,
      recommendedAction: "Review unresolved critical issues with leadership and prepare an investigation summary if needed."
    },
    {
      title: "Weekly reports should be generated consistently",
      status: recentReports.length ? "On track" : "Needs attention",
      evidence: recentReports.length ? `${recentReports.length} recent report${recentReports.length === 1 ? "" : "s"} found.` : "No recent report found.",
      recommendedAction: "Generate a weekly management report."
    },
    {
      title: "Customer activity records should show recent activity",
      status: leadsWithoutFollowup.length ? "Needs attention" : input.crmLeads.length ? "On track" : "Missing data",
      evidence: `${leadsWithoutFollowup.length} customer activity record${leadsWithoutFollowup.length === 1 ? "" : "s"} have no recent activity.`,
      recommendedAction: "Review stalled customer activity evidence with leadership."
    },
    {
      title: "KPIs should have targets",
      status: latest.some((kpi) => kpi.target === null) ? "Needs attention" : latest.length ? "On track" : "Missing data",
      evidence: `${latest.filter((kpi) => kpi.target === null).length} current KPI${latest.length === 1 ? "" : "s"} lack targets.`,
      recommendedAction: "Review KPI definitions and targets with leadership."
    }
  ] satisfies BenchmarkItem[];
}

function buildRoleBriefings(input: PrestigeInput, healthScore: number, focus: PrestigeAction[]) {
  const openIssues = input.issues.filter(isOpenIssue);
  const topFocus = focus.slice(0, 3).map((item) => item.title);

  return [
    {
      role: "Owner / Executive",
      title: "Owner briefing",
      summary: `Business health is ${healthScore}/100. Focus on revenue, risk, responsibility visibility, customer experience, and the top Vaeroex intelligence signals.`,
      focus: topFocus.length ? topFocus : ["Review revenue and conversion", "Review open risks", "Generate an executive report"]
    },
    {
      role: "Director",
      title: "Director briefing",
      summary: `${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"} and ${departments.length} department areas need performance review.`,
      focus: ["Review department scorecards", "Resolve unresolved problems", "Review KPI trends"]
    },
    {
      role: "Manager",
      title: "Manager briefing",
      summary: `${openIssues.length} open issue${openIssues.length === 1 ? " is" : "s are"} available for review.`,
      focus: ["Review open issues", "Review checklist evidence", "Document the next leadership decision"]
    },
    {
      role: "Supervisor",
      title: "Supervisor briefing",
      summary: "Focus on checklist completion, field issues, and current evidence.",
      focus: ["Review checklists", "Review field issues", "Confirm source context"]
    },
    {
      role: "Coordinator / Staff",
      title: "Staff briefing",
      summary: "Focus on visible source evidence, shared reports, and checklist results.",
      focus: ["Review Evidence", "Open shared reports", "Review checklist evidence"]
    },
    {
      role: "Viewer",
      title: "Viewer briefing",
      summary: "Read-only users should review the executive summary, current risks, and recent reports.",
      focus: ["Review dashboard", "Read latest report", "Watch current risks"]
    }
  ];
}

function buildReviewPackage(input: PrestigeInput, health: ReturnType<typeof buildHealth>, focus: PrestigeAction[], leaks: ProfitLeak[]) {
  const decisions = input.decisions.slice(0, 5).map((decision) => `${decision.title}: ${decision.expected_outcome || decision.status}`);
  const sections = [
    {
      title: "Executive Summary",
      lines: [health.explanation, `This package covers ${input.periodLabel.toLowerCase()} activity for ${input.workspaceName}.`]
    },
    {
      title: "KPI and Revenue Signals",
      lines: latestKpis(input.kpis).slice(0, 6).map((kpi) => `${kpi.name}: ${formatMetric(kpi.actual_value, kpi.name)} vs target ${formatMetric(kpi.target, kpi.name)}`)
    },
    {
      title: "Operational Risks",
      lines: [...focus.slice(0, 3).map((item) => item.evidence), ...leaks.slice(0, 2).map((item) => item.evidence)]
    },
    {
      title: "Corrective Actions",
      lines: focus.slice(0, 5).map((item) => item.action)
    },
    {
      title: "Open Decisions",
      lines: decisions.length ? decisions : ["No decisions have been logged yet."]
    },
    {
      title: "Recommended Next Steps",
      lines: focus.slice(0, 5).map((item) => `${item.title}: ${item.action}`)
    }
  ];
  const body = `# Business Review Package - ${input.workspaceName}

${sections.map((section) => `## ${section.title}\n${section.lines.map((line) => `- ${line}`).join("\n")}`).join("\n\n")}`;

  return {
    title: `Business Review Package - ${input.workspaceName}`,
    body,
    sections
  };
}

function buildDecisionSummary(input: PrestigeInput) {
  const today = todayDate();
  const reviewDue = input.decisions.filter((decision) => decision.review_date && decision.review_date <= today && !["completed", "dismissed"].includes(lower(decision.status)));
  const outcomeNotes = input.decisions.slice(0, 5).map((decision) => {
    const relatedKpis = decision.related_kpi ? input.kpis.filter((kpi) => kpi.name === decision.related_kpi).slice(0, 2) : [];
    if (decision.outcome_summary) return `${decision.title}: ${decision.outcome_summary}`;
    if (relatedKpis.length >= 2) {
      const [latest, previous] = relatedKpis;
      const improved = latest.actual_value !== null && previous.actual_value !== null ? latest.actual_value >= previous.actual_value : null;
      return `${decision.title}: ${decision.related_kpi} ${improved ? "appears to have improved" : "needs another review"} since the decision.`;
    }
    return `${decision.title}: outcome review pending.`;
  });

  return {
    recent: input.decisions.slice(0, 6),
    reviewDue,
    outcomeNotes
  };
}

function buildRecommendationTracking(input: PrestigeInput, focus: PrestigeAction[], leaks: ProfitLeak[]) {
  const saved = input.recommendationOutcomes.slice(0, 8);
  const completed = saved.filter((item) => ["completed", "reviewed", "outcome_measured"].includes(lower(item.status)));
  const outcomeNotes = completed.length
    ? completed.map((item) => `${item.title}: ${item.outcome_summary || "Action completed; outcome measurement pending."}`)
    : ["No reviewed recommendation outcomes yet. Save a Vaeroex recommendation after leadership review to track whether it worked."];

  return {
    saved,
    approvalQueue: [...focus, ...leaks].slice(0, 6),
    outcomeNotes
  };
}

function buildMeetingMode(input: PrestigeInput, focus: PrestigeAction[]) {
  const agenda = [
    "KPI review: compare current KPIs to targets and prior period.",
    "Customer evidence review: inspect stalled customer activity, proposal-stage records, and response gaps.",
    `Open issues: review ${input.issues.filter(isOpenIssue).length} active issue${input.issues.filter(isOpenIssue).length === 1 ? "" : "s"}.`,
    "Evidence review: inspect current source records supporting the highest-priority findings.",
    "Checklist compliance: confirm missed runs, failed runs, and related issue evidence.",
    "SOP review: identify stale or weak procedures affecting current performance.",
    "Department risks: review department scorecards and workload imbalance.",
    "Vaeroex recommendations: review, save, dismiss, or schedule outcome review.",
    "Decisions needed: log leadership decisions and expected outcomes.",
    "Leadership follow-through: confirm what changed, what evidence supports it, and what review cadence is appropriate."
  ];

  return { agenda, nextAssignments: focus.slice(0, 5) };
}

function buildRiskSimulation(focus: PrestigeAction[], leaks: ProfitLeak[]) {
  return [
    ...leaks.map((leak) => action({
      id: `risk-${leak.id}`,
      title: leak.title.replace(/^/, "Risk: "),
      why: `This may happen next month because ${leak.why.toLowerCase()}`,
      evidence: leak.evidence,
      owner: leak.owner,
      dueDate: leak.dueDate,
      action: leak.action,
      priority: leak.priority,
      relatedModule: leak.relatedModule,
      href: leak.href
    })),
    ...focus.map((item) => action({
      id: `risk-${item.id}`,
      title: `Risk: ${item.title}`,
      why: `This can worsen next month if leadership does not review the underlying responsibility gap.`,
      evidence: item.evidence,
      owner: item.owner,
      dueDate: item.dueDate,
      action: item.action,
      priority: item.priority,
      relatedModule: item.relatedModule,
      href: item.href
    }))
  ].slice(0, 5);
}

export function buildPrestigeIntelligence(input: PrestigeInput): PrestigeIntelligence {
  const dataQuality = buildDataQuality(input);
  const businessHealth = buildHealth(input, dataQuality);
  const focusPriorities = buildFocusPriorities(input, dataQuality);
  const profitLeaks = buildProfitLeaks(input);
  const memoryTimeline = buildMemoryTimeline(input, focusPriorities);
  const accountabilityMap = buildAccountability(input);
  const departmentScorecards = buildDepartmentScorecards(input);
  const toolSprawl = buildToolSprawl(input);
  const decisions = buildDecisionSummary(input);
  const recommendationTracking = buildRecommendationTracking(input, focusPriorities, profitLeaks);
  const meetingMode = buildMeetingMode(input, focusPriorities);
  const riskSimulation = buildRiskSimulation(focusPriorities, profitLeaks);
  const benchmarkMode = buildBenchmarkMode(input);
  const ceoActions = [
    focusPriorities[0]?.title || "Clarify the top operating priority",
    profitLeaks[0]?.title || "Protect revenue and customer response quality",
    dataQuality.gaps[0]?.title || "Keep the management system clean enough to trust"
  ];
  const ceoMode = {
    summary: `If I were the CEO this week, I would focus on business health (${businessHealth.score}/100), revenue leakage, responsibility visibility, customer experience, and the first three executive decisions Vaeroex can tie to evidence.`,
    actions: ceoActions
  };
  const businessReviewPackage = buildReviewPackage(input, businessHealth, focusPriorities, profitLeaks);
  const roleBriefings = buildRoleBriefings(input, businessHealth.score, focusPriorities);

  return {
    businessHealth,
    memoryTimeline,
    focusPriorities,
    profitLeaks,
    accountabilityMap,
    departmentScorecards,
    dataQuality,
    toolSprawl,
    decisions,
    recommendationTracking,
    meetingMode,
    riskSimulation,
    ceoMode,
    businessReviewPackage,
    benchmarkMode,
    roleBriefings
  };
}
