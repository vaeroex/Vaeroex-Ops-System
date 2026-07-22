import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

type AppSupabaseClient = SupabaseClient<Database>;
type DemoUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
};

export type DemoWorkspaceCounts = {
  crmLeads: number;
  kpis: number;
  operationalMetrics: number;
  reports: number;
  sops: number;
  issues: number;
  files: number;
  fileAnalyses: number;
  assets: number;
  checklists: number;
  vaeroexInsights: number;
};

type DemoMonth = {
  monthIndex: number;
  label: string;
  revenue: number;
  leads: number;
  conversion: number;
  responseHours: number;
  openIssues: number;
  overdueFollowups: number;
  satisfaction: number;
  sopReview: number;
  checklistCompletion: number;
  jobVolume: number;
  complaints: number;
  staffingCoverage: number;
  utilization: number;
  note: string;
};

type DemoMetricRow = {
  name: string;
  category: string;
  target: number;
  value: number;
  owner: string;
  note: string;
};

const DEMO_VERSION = "ytd-sales-demo-2026-02-prestige";
const DEMO_SOURCE = "Vaeroex YTD Demo";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const DEMO_MONTHS: DemoMonth[] = [
  {
    monthIndex: 0,
    label: "January",
    revenue: 38500,
    leads: 34,
    conversion: 24,
    responseHours: 22,
    openIssues: 4,
    overdueFollowups: 4,
    satisfaction: 89,
    sopReview: 82,
    checklistCompletion: 93,
    jobVolume: 108,
    complaints: 5,
    staffingCoverage: 91,
    utilization: 78,
    note: "January started steady, with revenue near target and a few process gaps still visible."
  },
  {
    monthIndex: 1,
    label: "February",
    revenue: 42100,
    leads: 38,
    conversion: 27,
    responseHours: 19,
    openIssues: 3,
    overdueFollowups: 3,
    satisfaction: 91,
    sopReview: 88,
    checklistCompletion: 96,
    jobVolume: 116,
    complaints: 4,
    staffingCoverage: 94,
    utilization: 81,
    note: "February improved after managers tightened follow-up cadence and checklist ownership."
  },
  {
    monthIndex: 2,
    label: "March",
    revenue: 31500,
    leads: 41,
    conversion: 18,
    responseHours: 32,
    openIssues: 9,
    overdueFollowups: 11,
    satisfaction: 82,
    sopReview: 62,
    checklistCompletion: 78,
    jobVolume: 119,
    complaints: 12,
    staffingCoverage: 76,
    utilization: 73,
    note: "March was the clear dip: revenue missed target while response time, overdue follow-ups, and open issues rose."
  },
  {
    monthIndex: 3,
    label: "April",
    revenue: 39750,
    leads: 44,
    conversion: 22,
    responseHours: 28,
    openIssues: 8,
    overdueFollowups: 7,
    satisfaction: 86,
    sopReview: 84,
    checklistCompletion: 88,
    jobVolume: 124,
    complaints: 9,
    staffingCoverage: 84,
    utilization: 77,
    note: "April recovered part of the March drop after SOP review, but service responsiveness still lagged."
  },
  {
    monthIndex: 4,
    label: "May",
    revenue: 46800,
    leads: 47,
    conversion: 29,
    responseHours: 18,
    openIssues: 5,
    overdueFollowups: 4,
    satisfaction: 92,
    sopReview: 96,
    checklistCompletion: 97,
    jobVolume: 131,
    complaints: 4,
    staffingCoverage: 95,
    utilization: 84,
    note: "May showed the recovery: better SOP review, stronger conversion, and fewer overdue actions."
  },
  {
    monthIndex: 5,
    label: "June",
    revenue: 41200,
    leads: 45,
    conversion: 23,
    responseHours: 26,
    openIssues: 6,
    overdueFollowups: 8,
    satisfaction: 88,
    sopReview: 91,
    checklistCompletion: 90,
    jobVolume: 128,
    complaints: 7,
    staffingCoverage: 87,
    utilization: 82,
    note: "June is mixed: revenue is above target, but conversion, response time, and overdue work need attention."
  },
  {
    monthIndex: 6,
    label: "July",
    revenue: 43800,
    leads: 46,
    conversion: 26,
    responseHours: 21,
    openIssues: 5,
    overdueFollowups: 5,
    satisfaction: 90,
    sopReview: 94,
    checklistCompletion: 94,
    jobVolume: 132,
    complaints: 6,
    staffingCoverage: 91,
    utilization: 83,
    note: "July stabilized after managers reinforced response-time accountability."
  },
  {
    monthIndex: 7,
    label: "August",
    revenue: 36900,
    leads: 43,
    conversion: 21,
    responseHours: 29,
    openIssues: 8,
    overdueFollowups: 9,
    satisfaction: 85,
    sopReview: 79,
    checklistCompletion: 86,
    jobVolume: 121,
    complaints: 10,
    staffingCoverage: 82,
    utilization: 76,
    note: "August shows a second dip caused by coverage gaps and slower follow-up."
  },
  {
    monthIndex: 8,
    label: "September",
    revenue: 45200,
    leads: 49,
    conversion: 28,
    responseHours: 20,
    openIssues: 5,
    overdueFollowups: 4,
    satisfaction: 91,
    sopReview: 95,
    checklistCompletion: 96,
    jobVolume: 136,
    complaints: 5,
    staffingCoverage: 93,
    utilization: 85,
    note: "September recovered after the team tightened follow-up and issue review."
  },
  {
    monthIndex: 9,
    label: "October",
    revenue: 47250,
    leads: 52,
    conversion: 30,
    responseHours: 17,
    openIssues: 4,
    overdueFollowups: 3,
    satisfaction: 93,
    sopReview: 97,
    checklistCompletion: 98,
    jobVolume: 142,
    complaints: 3,
    staffingCoverage: 96,
    utilization: 87,
    note: "October delivered stronger conversion and cleaner operating rhythm."
  },
  {
    monthIndex: 10,
    label: "November",
    revenue: 44800,
    leads: 48,
    conversion: 27,
    responseHours: 21,
    openIssues: 5,
    overdueFollowups: 5,
    satisfaction: 91,
    sopReview: 92,
    checklistCompletion: 95,
    jobVolume: 138,
    complaints: 5,
    staffingCoverage: 92,
    utilization: 84,
    note: "November remained healthy, with a small rise in overdue actions during holiday scheduling."
  },
  {
    monthIndex: 11,
    label: "December",
    revenue: 50100,
    leads: 55,
    conversion: 31,
    responseHours: 18,
    openIssues: 4,
    overdueFollowups: 4,
    satisfaction: 94,
    sopReview: 98,
    checklistCompletion: 97,
    jobVolume: 146,
    complaints: 4,
    staffingCoverage: 95,
    utilization: 88,
    note: "December finished strong after the team kept the recovery systems in place."
  }
];

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0, 0));
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function dateForMonth(year: number, monthIndex: number, day: number) {
  const safeDay = Math.min(day, daysInMonth(year, monthIndex));
  return `${year}-${pad(monthIndex + 1)}-${pad(safeDay)}`;
}

function isoForMonth(year: number, monthIndex: number, day: number, hour = 14) {
  return `${dateForMonth(year, monthIndex, day)}T${pad(hour)}:00:00.000Z`;
}

function dateFromNow(days: number) {
  const date = todayUtc();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoFromNow(days: number, hour = 14) {
  const date = todayUtc();
  date.setUTCHours(hour, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function currentTimeline() {
  const today = todayUtc();
  const year = today.getUTCFullYear();
  const currentMonthIndex = today.getUTCMonth();

  return DEMO_MONTHS.filter((month) => month.monthIndex <= currentMonthIndex).map((month) => ({
    ...month,
    year,
    metricDate: month.monthIndex === currentMonthIndex ? today.toISOString().slice(0, 10) : dateForMonth(year, month.monthIndex, 28),
    createdAt: isoForMonth(year, month.monthIndex, month.monthIndex === currentMonthIndex ? today.getUTCDate() : 28)
  }));
}

function countValue(result: { count: number | null }) {
  return result.count ?? 0;
}

function throwIfError(error: { message?: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message || "request failed"}`);
  }
}

function monthMetricRows(month: DemoMonth): DemoMetricRow[] {
  return [
    {
      name: "Revenue",
      category: "Sales",
      target: 40000,
      value: month.revenue,
      owner: "Owner",
      note: "Revenue target is $40,000 per month."
    },
    {
      name: "Customer Activity",
      category: "Sales",
      target: 40,
      value: month.leads,
      owner: "Revenue Review",
      note: "Customer activity stayed workable even when conversion dropped."
    },
    {
      name: "Conversion Rate",
      category: "Sales",
      target: 25,
      value: month.conversion,
      owner: "Revenue Review",
      note: "Conversion rate target is 25%."
    },
    {
      name: "Average Response Time",
      category: "Customer Service",
      target: 24,
      value: month.responseHours,
      owner: "General Manager",
      note: "Lower is better. Target is under 24 hours."
    },
    {
      name: "Open Issues",
      category: "Execution",
      target: 5,
      value: month.openIssues,
      owner: "General Manager",
      note: "Lower is better. Target is fewer than 5 open issues."
    },
    {
      name: "Overdue Follow-ups",
      category: "Accountability",
      target: 5,
      value: month.overdueFollowups,
      owner: "General Manager",
      note: "Lower is better. Target is fewer than 5 overdue follow-ups."
    },
    {
      name: "Customer Satisfaction",
      category: "Customer Service",
      target: 90,
      value: month.satisfaction,
      owner: "Service Manager",
      note: "Customer satisfaction target is 90%."
    },
    {
      name: "SOP Review Completion",
      category: "Process",
      target: 100,
      value: month.sopReview,
      owner: "General Manager",
      note: "SOP review should be complete each month."
    },
    {
      name: "Checklist Completion Rate",
      category: "Execution",
      target: 95,
      value: month.checklistCompletion,
      owner: "General Manager",
      note: "Checklist completion target is 95%."
    }
  ];
}

function reportBody(title: string, summary: string, improved: string[], declined: string[], risks: string[], actions: string[]) {
  return `# ${title}

Generated by Vaeroex.

## Executive Summary
${summary}

## What Improved
${improved.map((item) => `- ${item}`).join("\n")}

## What Declined
${declined.map((item) => `- ${item}`).join("\n")}

## Risks
${risks.map((item) => `- ${item}`).join("\n")}

## Vaeroex Suggested Next
${actions.map((item) => `- ${item}`).join("\n")}`;
}

export function isDemoWorkspaceRecord(workspace?: { name?: string | null; subscription_status?: string | null } | null) {
  return Boolean(workspace && (workspace.subscription_status === "demo" || workspace.name?.startsWith("Vaeroex Demo Workspace")));
}

export async function getDemoWorkspaceCounts(supabase: AppSupabaseClient, workspaceId: string): Promise<DemoWorkspaceCounts> {
  const [
    crmLeads,
    kpis,
    operationalMetrics,
    reports,
    sops,
    issues,
    files,
    fileAnalyses,
    assets,
    checklists,
    vaeroexInsights
  ] = await Promise.all([
    supabase.from("crm_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("kpis").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("operational_metrics").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("sops").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("issues").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("file_uploads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("file_uploads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).not("analysis_summary", "is", null),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("checklists").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("ai_agent_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
  ]);

  return {
    crmLeads: countValue(crmLeads),
    kpis: countValue(kpis),
    operationalMetrics: countValue(operationalMetrics),
    reports: countValue(reports),
    sops: countValue(sops),
    issues: countValue(issues),
    files: countValue(files),
    fileAnalyses: countValue(fileAnalyses),
    assets: countValue(assets),
    checklists: countValue(checklists),
    vaeroexInsights: countValue(vaeroexInsights)
  };
}

async function clearDemoWorkspaceData(supabase: AppSupabaseClient, workspaceId: string) {
  const tables = [
    "vaeroex_recommendation_outcomes",
    "business_decisions",
    "file_import_rows",
    "file_imports",
    "file_uploads",
    "crm_lead_history",
    "crm_leads",
    "checklist_runs",
    "checklists",
    "asset_checks",
    "assets",
    "operational_metrics",
    "kpis",
    // Remove task rows created by older demo versions; no new task fixtures are seeded.
    "tasks",
    "issues",
    "people",
    "sops",
    "reports",
    "ai_agent_runs"
  ] as const;

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq("workspace_id", workspaceId);
    throwIfError(error, `Clear demo ${table}`);
  }
}

async function shouldRebuildDemoWorkspace(supabase: AppSupabaseClient, workspaceId: string, expectedKpiRows: number) {
  const [kpis, decisions, recommendations] = await Promise.all([
    supabase.from("kpis").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("source", DEMO_SOURCE),
    supabase.from("business_decisions").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("vaeroex_recommendation_outcomes").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
  ]);

  throwIfError(kpis.error, "Demo version check");
  throwIfError(decisions.error, "Demo decision check");
  throwIfError(recommendations.error, "Demo recommendation check");

  return (kpis.count ?? 0) < expectedKpiRows || (decisions.count ?? 0) < 3 || (recommendations.count ?? 0) < 4;
}

async function seedKpis(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser, timeline: ReturnType<typeof currentTimeline>) {
  const rows = timeline.flatMap((month) =>
    monthMetricRows(month).map((metric) => ({
      workspace_id: workspaceId,
      name: metric.name,
      category: metric.category,
      target: metric.target,
      actual_value: metric.value,
      metric_date: month.metricDate,
      owner: metric.owner,
      notes: `${month.label}: ${month.note} ${metric.note}`,
      source: DEMO_SOURCE,
      raw_data_json: {
        demo: true,
        demo_version: DEMO_VERSION,
        month: month.label,
        month_index: month.monthIndex,
        below_target_story: month.monthIndex === 2 || month.monthIndex === 5 || month.monthIndex === 7
      } satisfies Json,
      created_by: user.id,
      created_at: month.createdAt
    }))
  );

  const { error } = await supabase.from("kpis").insert(rows);
  throwIfError(error, "Demo KPI history");
}

async function seedOperationalMetrics(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser, timeline: ReturnType<typeof currentTimeline>) {
  const rows = timeline.flatMap((month) => [
    {
      workspace_id: workspaceId,
      metric_name: "Job Volume",
      category: "Execution",
      value: month.jobVolume,
      metric_date: month.metricDate,
      owner: "General Manager",
      notes: `${month.label}: job volume compared with staffing capacity.`,
      raw_data_json: { demo: true, demo_version: DEMO_VERSION, month: month.label } satisfies Json,
      created_by: user.id,
      created_at: month.createdAt
    },
    {
      workspace_id: workspaceId,
      metric_name: "Customer Complaints",
      category: "Customer Service",
      value: month.complaints,
      metric_date: month.metricDate,
      owner: "Service Manager",
      notes: `${month.label}: complaints rose when response time slowed.`,
      raw_data_json: { demo: true, demo_version: DEMO_VERSION, month: month.label } satisfies Json,
      created_by: user.id,
      created_at: month.createdAt
    },
    {
      workspace_id: workspaceId,
      metric_name: "Staffing Coverage",
      category: "People",
      value: month.staffingCoverage,
      metric_date: month.metricDate,
      owner: "General Manager",
      notes: `${month.label}: coverage below 85% increased service risk.`,
      raw_data_json: { demo: true, demo_version: DEMO_VERSION, month: month.label } satisfies Json,
      created_by: user.id,
      created_at: month.createdAt
    },
    {
      workspace_id: workspaceId,
      metric_name: "Utilization",
      category: "Execution",
      value: month.utilization,
      metric_date: month.metricDate,
      owner: "General Manager",
      notes: `${month.label}: utilization moved with job volume and staffing coverage.`,
      raw_data_json: { demo: true, demo_version: DEMO_VERSION, month: month.label } satisfies Json,
      created_by: user.id,
      created_at: month.createdAt
    }
  ]);

  const { error } = await supabase.from("operational_metrics").insert(rows);
  throwIfError(error, "Demo business metrics");
}

async function seedPeopleAndAssets(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser) {
  const year = todayUtc().getUTCFullYear();
  const people = await supabase.from("people").insert([
    {
      workspace_id: workspaceId,
      full_name: "Jamie Brooks",
      email: "jamie@example.com",
      role_title: "Execution Coordinator",
      department: "Execution",
      status: "active",
      start_date: dateForMonth(year - 1, 8, 4),
      notes: "Owns daily readiness, checklist completion, and response-time follow-up.",
      created_at: isoForMonth(year, 0, 3)
    },
    {
      workspace_id: workspaceId,
      full_name: "Morgan Lee",
      email: "morgan@example.com",
      role_title: "Revenue Review",
      department: "Revenue",
      status: "active",
      start_date: dateForMonth(year - 1, 5, 12),
      notes: "Reviews customer activity evidence and monthly conversion recovery.",
      created_at: isoForMonth(year, 0, 3)
    },
    {
      workspace_id: workspaceId,
      full_name: "Taylor Smith",
      email: "taylor@example.com",
      role_title: "Service Lead",
      department: "Customer Service",
      status: "active",
      start_date: dateForMonth(year, 1, 1),
      notes: "Added after response time and complaint volume rose in March.",
      created_at: isoForMonth(year, 3, 10)
    }
  ]);
  throwIfError(people.error, "Demo people");

  const assets = await supabase.from("assets").insert([
    {
      workspace_id: workspaceId,
      asset_name: "Manager Tablet",
      asset_type: "Device",
      identifier: "TAB-001",
      location: "Front desk",
      status: "Needs attention",
      last_checked_at: isoFromNow(-2),
      notes: "Battery issue caused delayed checklist completion during busy shifts.",
      created_at: isoForMonth(year, 0, 5)
    },
    {
      workspace_id: workspaceId,
      asset_name: "Service Vehicle A",
      asset_type: "Vehicle",
      identifier: "VEH-101",
      location: "Main location",
      status: "Ready",
      last_checked_at: isoFromNow(-1),
      notes: "Ready for daily jobs.",
      created_at: isoForMonth(year, 0, 5)
    },
    {
      workspace_id: workspaceId,
      asset_name: "Dispatch Phone Line",
      asset_type: "System",
      identifier: "PHONE-OPS",
      location: "Dispatch",
      status: "Review",
      last_checked_at: isoFromNow(-5),
      notes: "Review voicemail routing after March response-time spike.",
      created_at: isoForMonth(year, 2, 18)
    }
  ]);
  throwIfError(assets.error, "Demo assets");
}

async function seedCrm(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser, timeline: ReturnType<typeof currentTimeline>) {
  const leadNames = [
    ["Avery Johnson", "Northline Co.", "Referral", 18500],
    ["Sam Patel", "Patel Retail Group", "Website", 9600],
    ["Casey Rivera", "Rivera Services", "Google Ads", 22400],
    ["Jordan Ellis", "Ellis Office Group", "Repeat Customer", 14200],
    ["Riley Chen", "Chen Construction", "Partner", 31800]
  ];

  const rows = timeline.flatMap((month) => {
    const volume = month.monthIndex === 2 ? 5 : month.leads >= 45 ? 5 : 4;
    const wonCount = month.conversion >= 28 ? 2 : month.conversion >= 24 ? 1 : month.monthIndex === 2 ? 1 : 1;

    return leadNames.slice(0, volume).map(([name, company, source, baseValue], index) => {
      const status = index < wonCount ? "Won" : month.monthIndex === 2 && index <= 3 ? "Lost" : index === volume - 1 ? "New" : "Proposal Sent";
      const followUpDate = dateForMonth(month.year, month.monthIndex, 12 + index * 3);
      const createdAt = isoForMonth(month.year, month.monthIndex, 4 + index * 4, 15);
      const value = Number(baseValue) + month.monthIndex * 850 + index * 500;

      return {
        workspace_id: workspaceId,
        lead_name: String(name),
        company: String(company),
        email: `${String(name).split(" ")[0].toLowerCase()}@example.com`,
        phone: `555-010${index}`,
        status,
        estimated_value: value,
        owner: "Morgan Lee",
        notes:
          month.monthIndex === 2
            ? "March customer activity: decent volume, but slower response lowered conversion."
            : `${month.label} customer activity from ${source}; response date and outcome included for demo review.`,
        raw_data_json: {
          demo: true,
          demo_version: DEMO_VERSION,
          customer_activity_source: source,
          follow_up_date: followUpDate,
          outcome: status,
          month: month.label
        } satisfies Json,
        last_activity_at: status === "New" ? null : isoForMonth(month.year, month.monthIndex, 18 + index, 16),
        created_by: user.id,
        created_at: createdAt
      };
    });
  });

  const { data: leads, error } = await supabase
    .from("crm_leads")
    .insert(rows)
    .select("id,lead_name,status,estimated_value,owner,created_at,raw_data_json");
  throwIfError(error, "Demo customer activity records");

  if (leads?.length) {
    const history = await supabase.from("crm_lead_history").insert(
      leads.map((lead) => ({
        workspace_id: workspaceId,
        lead_id: lead.id,
        event_type: "import",
        status: lead.status,
        estimated_value: lead.estimated_value,
        owner: lead.owner,
        notes: `${lead.lead_name} recorded for YTD demo customer activity evidence. March illustrates lower conversion despite solid customer activity.`,
        raw_data_json: lead.raw_data_json,
        created_by: user.id,
        created_at: lead.created_at
      }))
    );
    throwIfError(history.error, "Demo customer activity history");
  }
}

async function seedIssues(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser) {
  const year = todayUtc().getUTCFullYear();
  const issues = await supabase.from("issues").insert([
    {
      workspace_id: workspaceId,
      title: "March response time exceeded target",
      description: "Average response time reached 32 hours in March, above the under-24-hour target.",
      issue_type: "Customer Service",
      severity: "High",
      status: "Open",
      root_cause: "Staffing coverage and follow-up quality changed during the March dip.",
      recommended_fix: "Review the response workflow and summarize escalation gaps for leadership.",
      due_date: dateFromNow(3),
      created_by: user.id,
      created_at: isoForMonth(year, 2, 19)
    },
    {
      workspace_id: workspaceId,
      title: "Conversion dropped despite stable customer activity",
      description: "March customer activity was stable, but conversion dropped to 18%.",
      issue_type: "Customer Evidence",
      severity: "High",
      status: "In Progress",
      root_cause: "Follow-up quality declined while proposal next steps became less consistent.",
      recommended_fix: "Review customer activity evidence and generate an executive improvement plan.",
      due_date: dateFromNow(2),
      created_by: user.id,
      created_at: isoForMonth(year, 2, 21)
    },
    {
      workspace_id: workspaceId,
      title: "Checklist completion dropped below target",
      description: "Checklist completion fell to 78% in March and remained below target in April.",
      issue_type: "Checklist",
      severity: "Medium",
      status: "Open",
      root_cause: "Managers did not have a required weekly checklist review.",
      recommended_fix: "Review missed checklist patterns and summarize operational risk for leadership.",
      due_date: dateFromNow(7),
      created_by: user.id,
      created_at: isoForMonth(year, 3, 5)
    },
    {
      workspace_id: workspaceId,
      title: "SOP review was stale before recovery",
      description: "SOP review completion was 62% in March and improved after April updates.",
      issue_type: "SOP",
      severity: "Medium",
      status: "Closed",
      root_cause: "Follow-up SOP review did not have a consistent monthly leadership cadence.",
      recommended_fix: "Keep monthly SOP review evidence tied to executive reports.",
      due_date: dateForMonth(year, 3, 20),
      created_by: user.id,
      created_at: isoForMonth(year, 3, 8)
    },
    {
      workspace_id: workspaceId,
      title: "Current month follow-up risk rising",
      description: "Current month overdue follow-ups increased while conversion softened.",
      issue_type: "Customer Evidence",
      severity: "Medium",
      status: "Open",
      root_cause: "Recovery follow-up activity is becoming less consistent.",
      recommended_fix: "Include customer follow-up evidence in the next leadership review.",
      due_date: dateFromNow(4),
      created_by: user.id,
      created_at: isoFromNow(-3)
    }
  ]);
  throwIfError(issues.error, "Demo issues");
}

async function seedSopsAndChecklists(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser, timeline: ReturnType<typeof currentTimeline>) {
  const year = todayUtc().getUTCFullYear();
  const sops = await supabase.from("sops").insert([
    {
      workspace_id: workspaceId,
      title: "Customer Response Evidence SOP",
      department: "Revenue",
      category: "Customer Evidence",
      body_markdown: "# Customer Response Evidence SOP\n\n## Purpose\nPreserve customer response evidence when revenue or conversion changes.\n\n## Monthly Learning\nMarch conversion dropped while customer activity stayed stable. Vaeroex recommended clearer response evidence and a weekly proposal review.\n\n## Steps\n- Review customer activity evidence daily.\n- Confirm source context.\n- Record response dates when available.\n- Flag stalled customer activity as evidence.\n- Review response gaps every Friday.",
      status: "Active",
      version: 2,
      created_by: user.id,
      ai_generated: true,
      created_at: isoForMonth(year, 0, 8),
      updated_at: isoForMonth(year, 3, 11)
    },
    {
      workspace_id: workspaceId,
      title: "Response Time Escalation SOP",
      department: "Customer Service",
      category: "Service",
      body_markdown: "# Response Time Escalation SOP\n\n## Trigger\nAverage response time exceeds 24 hours or customer complaints rise.\n\n## Steps\n- Review daily response evidence.\n- Escalate unanswered customer activity after one business day.\n- Review response time during the weekly management review.",
      status: "Active",
      version: 1,
      created_by: user.id,
      ai_generated: true,
      created_at: isoForMonth(year, 3, 12),
      updated_at: isoForMonth(year, 4, 15)
    },
    {
      workspace_id: workspaceId,
      title: "Weekly Management Review SOP",
      department: "Execution",
      category: "Management",
      body_markdown: "# Weekly Management Review SOP\n\nReview revenue, customer activity, conversion, response time, open issues, checklist completion, SOP review, and Vaeroex decision support.",
      status: "Active",
      version: 2,
      created_by: user.id,
      ai_generated: true,
      created_at: isoForMonth(year, 0, 12),
      updated_at: isoForMonth(year, 4, 20)
    }
  ]);
  throwIfError(sops.error, "Demo SOPs");

  const { data: checklists, error } = await supabase
    .from("checklists")
    .insert([
      {
        workspace_id: workspaceId,
        name: "Opening Checklist",
        description: "Confirm staffing, schedule, urgent customer evidence, and open issues before work begins.",
        category: "Readiness",
        frequency: "Daily",
        items_json: ["Review schedule", "Confirm staffing", "Check open issues", "Flag urgent customer evidence"] satisfies Json,
        assigned_role: "Manager",
        created_by: user.id,
        created_at: isoForMonth(year, 0, 6)
      },
      {
        workspace_id: workspaceId,
        name: "Weekly Customer Evidence Review",
        description: "Review open customer activity, proposals, response dates, and lost opportunities.",
        category: "Customer Evidence",
        frequency: "Weekly",
        items_json: ["Review new customer activity", "Check proposal status", "Identify stalled proposals", "Summarize revenue risk"] satisfies Json,
        assigned_role: "Revenue Review",
        created_by: user.id,
        created_at: isoForMonth(year, 0, 6)
      },
      {
        workspace_id: workspaceId,
        name: "Monthly SOP Review",
        description: "Confirm procedures still match how the business actually operates.",
        category: "Process",
        frequency: "Monthly",
        items_json: ["Review stale SOPs", "Update changed steps", "Summarize process risk", "Document next review date"] satisfies Json,
        assigned_role: "General Manager",
        created_by: user.id,
        created_at: isoForMonth(year, 0, 6)
      }
    ])
    .select("id,name");
  throwIfError(error, "Demo checklists");

  if (checklists?.length) {
    const runs = timeline.flatMap((month) => {
      const needsReview = month.monthIndex === 2 || month.monthIndex === 3 || month.monthIndex === todayUtc().getUTCMonth();
      return checklists.map((checklist, index) => ({
        workspace_id: workspaceId,
        checklist_id: checklist.id,
        status: needsReview && index !== 0 ? "Needs review" : "Complete",
        responses_json: {
          demo: true,
          demo_version: DEMO_VERSION,
          month: month.label,
          completion_rate: month.checklistCompletion
        } satisfies Json,
        notes:
          needsReview && index !== 0
            ? `${month.label}: checklist completion was below target and needs manager review.`
            : `${month.label}: checklist run completed.`,
        completed_at: needsReview && index !== 0 ? null : isoForMonth(month.year, month.monthIndex, 24, 17),
        assigned_to: user.id,
        created_at: isoForMonth(month.year, month.monthIndex, 24 + index, 12)
      }));
    });

    const runResult = await supabase.from("checklist_runs").insert(runs);
    throwIfError(runResult.error, "Demo checklist runs");
  }
}

async function seedFilesAndReports(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser, timeline: ReturnType<typeof currentTimeline>) {
  const today = todayUtc();
  const year = today.getUTCFullYear();
  const kpiRowCount = timeline.length * monthMetricRows(timeline[0]).length;
  const { data: file, error } = await supabase
    .from("file_uploads")
    .insert({
      workspace_id: workspaceId,
      original_name: "vaeroex-ytd-intelligence-scorecard.csv",
      display_name: "Vaeroex YTD Intelligence Scorecard.csv",
      file_extension: "csv",
      mime_type: "text/csv",
      file_size_bytes: 18432,
      storage_bucket: "demo",
      storage_path: `demo/${workspaceId}/vaeroex-ytd-intelligence-scorecard.csv`,
      import_type: "kpi",
      import_status: "imported",
      imported_rows: kpiRowCount,
      processing_status: "ready",
      processed_at: today.toISOString(),
      analysis_prompt: "Analyze January-to-current-month performance and identify risks, recovery actions, and KPI trends.",
      analysis_summary:
        "Vaeroex found a realistic YTD story: February improved, March dipped below target, April recovered partially, May improved strongly, and the current month is mixed with overdue follow-ups and response-time risk.",
      metadata_json: {
        demo: true,
        demo_version: DEMO_VERSION,
        range_start: `${year}-01-01`,
        range_end: today.toISOString().slice(0, 10),
        weak_months: ["March", today.getUTCMonth() >= 5 ? "June" : "April"]
      } satisfies Json,
      created_by: user.id,
      created_at: today.toISOString()
    })
    .select("id")
    .single();
  throwIfError(error, "Demo YTD file");

  if (file) {
    const importResult = await supabase.from("file_imports").insert({
      workspace_id: workspaceId,
      file_upload_id: file.id,
      import_type: "kpi",
      status: "completed",
      rows_total: kpiRowCount,
      rows_imported: kpiRowCount,
      mapping_json: {
        Revenue: "Revenue",
        "Customer Activity": "Customer Activity",
        "Conversion Rate": "Conversion Rate",
        "Average Response Time": "Average Response Time",
        "Checklist Completion Rate": "Checklist Completion Rate"
      } satisfies Json,
      extraction_summary: "Imported YTD demo KPI rows from January through the current month.",
      reviewed_at: today.toISOString(),
      imported_at: today.toISOString(),
      created_by: user.id,
      created_at: today.toISOString()
    });
    throwIfError(importResult.error, "Demo YTD file import");
  }

  const reportSpecs = [
    {
      monthIndex: 0,
      title: "January Intelligence Summary",
      type: "Monthly",
      summary: "January started close to target. Revenue was slightly under the monthly goal, but response time and open issues were manageable.",
      improved: ["Basic operating rhythm was in place.", "Customer activity was enough to support the month."],
      declined: ["Revenue was slightly below the $40,000 target.", "Checklist completion was under the 95% target."],
      risks: ["If checklist ownership stayed loose, issues could compound in later months."],
      actions: ["Review first KPI signals.", "Summarize weekly checklist risk."]
    },
    {
      monthIndex: 1,
      title: "February Customer Activity Report",
      type: "Monthly",
      summary: "February improved across revenue, conversion, response time, and checklist completion.",
      improved: ["Revenue moved above target.", "Conversion reached 27%.", "Checklist completion reached 96%."],
      declined: ["SOP review was still below full completion."],
      risks: ["Customer activity momentum could hide process drift if SOP review stayed partial."],
      actions: ["Keep weekly customer evidence review.", "Schedule monthly SOP review."]
    },
    {
      monthIndex: 2,
      title: "March Performance Dip Review",
      type: "Monthly",
      summary: "March was the main performance dip. Revenue fell below target while customer activity stayed decent, pointing to response quality and response time issues.",
      improved: ["Customer activity stayed healthy at 41 records."],
      declined: ["Revenue fell to $31,500.", "Conversion dropped to 18%.", "Response time increased to 32 hours.", "Checklist completion fell to 78%."],
      risks: ["Response gaps could continue lowering conversion.", "Open issues and customer response signals could slow recovery."],
      actions: ["Review customer response evidence.", "Update customer response SOP.", "Summarize checklist risk.", "Generate recovery report."]
    },
    {
      monthIndex: 3,
      title: "April Recovery Plan",
      type: "Monthly",
      summary: "April recovered part of the March dip, but response time and checklist completion still needed attention.",
      improved: ["Revenue nearly returned to target.", "SOP review improved after process updates."],
      declined: ["Response time stayed above target.", "Open issues remained elevated."],
      risks: ["Partial recovery could stall without a clear issue review cadence."],
      actions: ["Review unresolved issue evidence.", "Run weekly customer evidence review.", "Review response time escalation SOP."]
    },
    {
      monthIndex: 4,
      title: "May Executive Summary",
      type: "Monthly",
      summary: "May showed the strongest recovery. Revenue, conversion, response time, SOP review, and checklist completion all improved.",
      improved: ["Revenue rose to $46,800.", "Conversion reached 29%.", "Response time improved to 18 hours.", "Checklist completion reached 97%."],
      declined: ["A few open issues remained."],
      risks: ["Recovery habits need to stay active during the current month."],
      actions: ["Review recovery progress.", "Keep monthly SOP review active.", "Confirm next-month KPI targets."]
    }
  ].filter((report) => report.monthIndex <= today.getUTCMonth());

  const reports: Database["public"]["Tables"]["reports"]["Insert"][] = reportSpecs.map((report) => ({
    workspace_id: workspaceId,
    report_type: report.type,
    title: report.title,
    date_range_start: dateForMonth(year, report.monthIndex, 1),
    date_range_end: dateForMonth(year, report.monthIndex, daysInMonth(year, report.monthIndex)),
    body_markdown: reportBody(report.title, report.summary, report.improved, report.declined, report.risks, report.actions),
    source_data_json: { demo: true, demo_version: DEMO_VERSION, month: MONTH_NAMES[report.monthIndex] } satisfies Json,
    created_by: user.id,
    created_at: isoForMonth(year, report.monthIndex, 28, 16)
  }));

  reports.push({
    workspace_id: workspaceId,
    report_type: "Year to Date",
    title: "Year-to-Date Intelligence Review",
    date_range_start: `${year}-01-01`,
    date_range_end: today.toISOString().slice(0, 10),
    body_markdown: reportBody(
      "Year-to-Date Intelligence Review",
      "The YTD story shows why Vaeroex is useful: February improved, March exposed customer response and response-time breakdowns, April recovered partially, May improved, and the current month is mixed.",
      ["May showed strong recovery after SOP and checklist review.", "YTD records make month-over-month changes visible."],
      ["March revenue, conversion, satisfaction, SOP review, and checklist completion missed target.", "The current month still shows response-time and customer response risk."],
      ["Customer activity alone did not protect revenue when response quality declined.", "Open issues increased in weak months and need leadership review."],
      ["Review KPI trends.", "Review customer response evidence.", "Summarize checklist risk.", "Generate monthly recovery report.", "Confirm KPI targets for next month."]
    ),
    source_data_json: { demo: true, demo_version: DEMO_VERSION, period: "YTD" } satisfies Json,
    created_by: user.id,
    created_at: today.toISOString()
  });

  const { error: reportError } = await supabase.from("reports").insert(reports);
  throwIfError(reportError, "Demo reports");
}

async function seedVaeroexInsight(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser) {
  const today = todayUtc();
  const result = await supabase.from("ai_agent_runs").insert({
    workspace_id: workspaceId,
    agent_type: "operations_audit",
    input_json: {
      demo: true,
      demo_version: DEMO_VERSION,
      prompt: "Audit the YTD demo workspace and explain the weak months."
    } satisfies Json,
    output_json: {
      title: "YTD Demo Operations Intelligence Review",
      executive_summary:
        "Vaeroex found a realistic business pattern: January was steady, February improved, March fell below target, April recovered partially, May improved, and the current month is mixed. March revenue fell below target while response time increased, checklist completion dropped, and open issues rose.",
      problems_identified: [
        "March revenue fell below the $40,000 target while response time increased to 32 hours.",
        "Customer activity was stable in March, but conversion dropped to 18%, suggesting response quality declined.",
        "Open issues increased in March and April, especially staffing and response-time issues.",
        "Checklist completion dropped below target during the March dip, increasing execution risk.",
        "The current month has positive revenue but softer conversion, response-time, and overdue-follow-up signals."
      ],
      recommended_actions: [
        {
          title: "Review customer response evidence",
          priority: "High",
          suggested_owner: "Leadership Review",
          suggested_due_date: dateFromNow(2),
          why_it_matters: "Stable customer activity did not convert in March because response quality declined.",
          related_module: "Customer Evidence"
        },
        {
          title: "Update customer response SOP",
          priority: "High",
          suggested_owner: "General Manager",
          suggested_due_date: dateFromNow(5),
          why_it_matters: "The March dip shows the business needs clearer response evidence and escalation context.",
          related_module: "SOPs"
        },
        {
          title: "Summarize checklist risk",
          priority: "Medium",
          suggested_owner: "General Manager",
          suggested_due_date: dateFromNow(3),
          why_it_matters: "Checklist completion fell below target during weak months.",
          related_module: "Checklists"
        },
        {
          title: "Review KPI trend evidence",
          priority: "Medium",
          suggested_owner: "Owner",
          suggested_due_date: dateFromNow(4),
          why_it_matters: "YTD trends show which KPIs recovered and which still need leadership review.",
          related_module: "KPIs"
        },
        {
          title: "Generate monthly recovery report",
          priority: "Medium",
          suggested_owner: "Owner",
          suggested_due_date: dateFromNow(7),
          why_it_matters: "The owner needs a clean summary of the March dip, April recovery, May improvement, and current risks.",
          related_module: "Reports"
        }
      ],
      suggested_systems: [
        "Use KPI Dashboard YTD view to compare March, April, May, and the current month.",
        "Use customer activity evidence to detect possible revenue leakage.",
        "Use monthly reports to preserve the business story and recovery plan."
      ],
      response_markdown:
        "March was the weak month: revenue fell below target while response time rose, conversion dropped, open issues increased, and checklist completion fell. May shows recovery after SOP and checklist review. The current month is mixed, so Vaeroex recommends customer response review, an SOP update, a checklist risk summary, and a monthly recovery report."
    } satisfies Json,
    status: "completed",
    created_by: user.id,
    created_at: today.toISOString()
  });

  throwIfError(result.error, "Demo Vaeroex insight");
}

async function seedPrestigeIntelligenceExamples(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser) {
  const year = todayUtc().getUTCFullYear();
  const decisionResult = await supabase.from("business_decisions").insert([
    {
      workspace_id: workspaceId,
      title: "Review weekly customer response evidence",
      reason: "Conversion dropped in March even though customer activity stayed healthy.",
      expected_outcome: "Improve conversion rate from 18% toward the 25% target and reduce proposal-stage stalls.",
      related_kpi: "Conversion Rate",
      owner: "Morgan Lee",
      review_date: dateForMonth(year, 4, 15),
      status: "reviewed",
      outcome_summary: "May conversion improved to 29% after weekly proposal review and clearer response evidence.",
      created_by: user.id,
      created_at: isoForMonth(year, 3, 5)
    },
    {
      workspace_id: workspaceId,
      title: "Review response-time escalation process",
      reason: "Average response time rose to 32 hours during the March dip.",
      expected_outcome: "Bring response time back under the 24-hour target.",
      related_kpi: "Average Response Time",
      owner: "Taylor Smith",
      review_date: dateForMonth(year, 4, 20),
      status: "reviewed",
      outcome_summary: "Response time improved to 18 hours in May after the escalation process was reviewed.",
      created_by: user.id,
      created_at: isoForMonth(year, 3, 12)
    },
    {
      workspace_id: workspaceId,
      title: "Require monthly SOP and checklist recovery review",
      reason: "Checklist completion fell to 78% and SOP review completion fell to 62% in March.",
      expected_outcome: "Raise checklist completion above 95% and keep SOP review completion near 100%.",
      related_kpi: "Checklist Completion Rate",
      owner: "Jamie Brooks",
      review_date: dateFromNow(14),
      status: "in_progress",
      outcome_summary: "May recovered, but the current month is mixed and still needs review.",
      created_by: user.id,
      created_at: isoForMonth(year, 4, 8)
    }
  ]);
  throwIfError(decisionResult.error, "Demo business decisions");

  const recommendationResult = await supabase.from("vaeroex_recommendation_outcomes").insert([
    {
      workspace_id: workspaceId,
      title: "Update customer response SOP",
      source_type: "prestige_demo",
      source_title: "March Performance Dip Review",
      evidence: "March conversion dropped to 18% while customer activity stayed healthy.",
      related_module: "SOPs",
      related_kpi: "Conversion Rate",
      expected_outcome: "Improve response discipline and conversion recovery.",
      created_action_type: "sop_review",
      owner: "General Manager",
      priority: "High",
      review_date: dateForMonth(year, 4, 20),
      status: "outcome_measured",
      outcome_summary: "Response evidence improved, conversion rose to 29%, and response time improved after the SOP update.",
      metadata_json: { demo: true, demo_version: DEMO_VERSION, worked: true } satisfies Json,
      created_by: user.id,
      created_at: isoForMonth(year, 3, 10)
    },
    {
      workspace_id: workspaceId,
      title: "Review customer response evidence",
      source_type: "prestige_demo",
      source_title: "Vaeroex YTD Demo Operations Intelligence Review",
      evidence: "Proposal-stage customer activity stalled after response time increased.",
      related_module: "Customer Evidence",
      related_kpi: "Conversion Rate",
      expected_outcome: "Prevent missed revenue context by identifying stalled proposals before they age out.",
      created_action_type: "executive_review",
      owner: "Leadership Review",
      priority: "High",
      review_date: dateFromNow(10),
      status: "in_progress",
      outcome_summary: "Open proposals are being reviewed weekly; outcome measurement is scheduled.",
      metadata_json: { demo: true, demo_version: DEMO_VERSION, approval_queue: true } satisfies Json,
      created_by: user.id,
      created_at: isoForMonth(year, 4, 3)
    },
    {
      workspace_id: workspaceId,
      title: "Run checklist compliance recovery review",
      source_type: "prestige_demo",
      source_title: "April Recovery Plan",
      evidence: "Checklist completion dropped below target during March and April.",
      related_module: "Checklists",
      related_kpi: "Checklist Completion Rate",
      expected_outcome: "Return checklist completion to 95% or better.",
      created_action_type: "checklist_review",
      owner: "General Manager",
      priority: "Medium",
      review_date: dateForMonth(year, 4, 28),
      status: "outcome_measured",
      outcome_summary: "Checklist completion recovered to 97% in May after manager review cadence was restored.",
      metadata_json: { demo: true, demo_version: DEMO_VERSION, worked: true } satisfies Json,
      created_by: user.id,
      created_at: isoForMonth(year, 3, 18)
    },
    {
      workspace_id: workspaceId,
      title: "Review current-month KPI trend",
      source_type: "prestige_demo",
      source_title: "Current month mixed signal",
      evidence: "Revenue is above target, but conversion, response time, overdue follow-ups, and checklist completion still need attention.",
      related_module: "KPIs",
      related_kpi: "Revenue",
      expected_outcome: "Confirm next-month targets and leadership review priorities before drift repeats.",
      created_action_type: "executive_review",
      owner: "Owner",
      priority: "Medium",
      review_date: dateFromNow(7),
      status: "suggested",
      outcome_summary: "Waiting for leadership review.",
      metadata_json: { demo: true, demo_version: DEMO_VERSION, approval_queue: true } satisfies Json,
      created_by: user.id,
      created_at: isoFromNow(-1)
    }
  ]);
  throwIfError(recommendationResult.error, "Demo recommendation outcomes");
}

async function seedYtdDemoWorkspace(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser, timeline: ReturnType<typeof currentTimeline>) {
  await seedKpis(supabase, workspaceId, user, timeline);
  await seedOperationalMetrics(supabase, workspaceId, user, timeline);
  await seedPeopleAndAssets(supabase, workspaceId, user);
  await seedCrm(supabase, workspaceId, user, timeline);
  await seedIssues(supabase, workspaceId, user);
  await seedSopsAndChecklists(supabase, workspaceId, user, timeline);
  await seedFilesAndReports(supabase, workspaceId, user, timeline);
  await seedVaeroexInsight(supabase, workspaceId, user);
  await seedPrestigeIntelligenceExamples(supabase, workspaceId, user);
}

export async function ensureDemoWorkspacePopulated(
  supabase: AppSupabaseClient,
  workspaceId: string,
  user: DemoUser,
  options: { rebuild?: boolean } = {}
) {
  const timeline = currentTimeline();
  const expectedKpiRows = timeline.length * monthMetricRows(timeline[0]).length;
  const shouldRebuild = options.rebuild || (await shouldRebuildDemoWorkspace(supabase, workspaceId, expectedKpiRows));

  if (shouldRebuild) {
    await clearDemoWorkspaceData(supabase, workspaceId);
    await seedYtdDemoWorkspace(supabase, workspaceId, user, timeline);
  }

  return getDemoWorkspaceCounts(supabase, workspaceId);
}
