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
  tasks: number;
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
  overdueTasks: number;
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
    overdueTasks: 4,
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
    overdueTasks: 3,
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
    overdueTasks: 11,
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
    overdueTasks: 7,
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
    overdueTasks: 4,
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
    overdueTasks: 8,
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
    overdueTasks: 5,
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
    overdueTasks: 9,
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
    overdueTasks: 4,
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
    overdueTasks: 3,
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
    overdueTasks: 5,
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
    overdueTasks: 4,
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
      name: "New Leads",
      category: "Sales",
      target: 40,
      value: month.leads,
      owner: "Sales Manager",
      note: "Lead volume stayed workable even when conversion dropped."
    },
    {
      name: "Conversion Rate",
      category: "Sales",
      target: 25,
      value: month.conversion,
      owner: "Sales Manager",
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
      value: month.overdueTasks,
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
    tasks,
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
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
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
    tasks: countValue(tasks),
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
      role_title: "Sales Manager",
      department: "Sales",
      status: "active",
      start_date: dateForMonth(year - 1, 5, 12),
      notes: "Owns lead review, CRM hygiene, and monthly conversion recovery.",
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
            ? "March lead: decent volume, but slower response and missed follow-up lowered conversion."
            : `${month.label} lead from ${source}; follow-up date and outcome included for demo review.`,
        raw_data_json: {
          demo: true,
          demo_version: DEMO_VERSION,
          lead_source: source,
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
  throwIfError(error, "Demo CRM leads");

  if (leads?.length) {
    const history = await supabase.from("crm_lead_history").insert(
      leads.map((lead) => ({
        workspace_id: workspaceId,
        lead_id: lead.id,
        event_type: "import",
        status: lead.status,
        estimated_value: lead.estimated_value,
        owner: lead.owner,
        notes: `${lead.lead_name} recorded for the YTD demo pipeline. March illustrates lower conversion despite solid lead volume.`,
        raw_data_json: lead.raw_data_json,
        created_by: user.id,
        created_at: lead.created_at
      }))
    );
    throwIfError(history.error, "Demo CRM history");
  }
}

async function seedTasksAndIssues(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser) {
  const year = todayUtc().getUTCFullYear();
  const tasks = await supabase.from("tasks").insert([
    {
      workspace_id: workspaceId,
      title: "Investigate response time increase",
      description: "March response time rose to 32 hours, which coincided with lower conversion and satisfaction.",
      status: "Done",
      priority: "High",
      category: "Customer Service",
      due_date: dateForMonth(year, 2, 20),
      created_by: user.id,
      created_at: isoForMonth(year, 2, 16)
    },
    {
      workspace_id: workspaceId,
      title: "Review missed follow-ups",
      description: "Audit March leads with proposal or lost status and identify missed next steps.",
      status: "Done",
      priority: "High",
      category: "CRM",
      due_date: dateForMonth(year, 2, 24),
      created_by: user.id,
      created_at: isoForMonth(year, 2, 18)
    },
    {
      workspace_id: workspaceId,
      title: "Update customer follow-up SOP",
      description: "Add required next-contact date, owner, and escalation steps after the March dip.",
      status: "Done",
      priority: "High",
      category: "SOP",
      due_date: dateForMonth(year, 3, 10),
      created_by: user.id,
      created_at: isoForMonth(year, 3, 2)
    },
    {
      workspace_id: workspaceId,
      title: "Assign owner for overdue issue review",
      description: "Review issues carried from March into April and assign a weekly owner.",
      status: "In Progress",
      priority: "Medium",
      category: "Issues",
      due_date: dateFromNow(-2),
      created_by: user.id,
      created_at: isoFromNow(-12)
    },
    {
      workspace_id: workspaceId,
      title: "Review recovery progress",
      description: "Compare April and May against the March dip and confirm which fixes worked.",
      status: "Done",
      priority: "Medium",
      category: "Management",
      due_date: dateForMonth(year, 4, 18),
      created_by: user.id,
      created_at: isoForMonth(year, 4, 10)
    },
    {
      workspace_id: workspaceId,
      title: "Create CRM follow-up list",
      description: "Turn current open proposals into assigned follow-up work before the next month closes.",
      status: "In Progress",
      priority: "High",
      category: "CRM",
      due_date: dateFromNow(-1),
      created_by: user.id,
      created_at: isoFromNow(-7)
    },
    {
      workspace_id: workspaceId,
      title: "Generate monthly recovery report",
      description: "Summarize March dip, April recovery plan, and May progress for the owner.",
      status: "Done",
      priority: "Medium",
      category: "Reports",
      due_date: dateForMonth(year, 4, 28),
      created_by: user.id,
      created_at: isoForMonth(year, 4, 21)
    },
    {
      workspace_id: workspaceId,
      title: "Confirm KPI targets for next month",
      description: "Review revenue, conversion, response time, and checklist completion targets before next month.",
      status: "To Do",
      priority: "Medium",
      category: "KPI Review",
      due_date: dateFromNow(5),
      created_by: user.id,
      created_at: isoFromNow(-1)
    }
  ]);
  throwIfError(tasks.error, "Demo tasks");

  const issues = await supabase.from("issues").insert([
    {
      workspace_id: workspaceId,
      title: "March response time exceeded target",
      description: "Average response time reached 32 hours in March, above the under-24-hour target.",
      issue_type: "Customer Service",
      severity: "High",
      status: "Open",
      root_cause: "Staffing coverage and missed follow-up ownership.",
      recommended_fix: "Assign daily response owner and add escalation to the follow-up SOP.",
      due_date: dateFromNow(3),
      created_by: user.id,
      created_at: isoForMonth(year, 2, 19)
    },
    {
      workspace_id: workspaceId,
      title: "Conversion dropped despite stable lead volume",
      description: "March lead volume was stable, but conversion dropped to 18%.",
      issue_type: "CRM",
      severity: "High",
      status: "In Progress",
      root_cause: "Follow-up quality declined and proposal next steps were not assigned.",
      recommended_fix: "Use CRM follow-ups and a weekly proposal review.",
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
      recommended_fix: "Review missed checklist runs every Friday and assign an owner.",
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
      root_cause: "No monthly owner for follow-up SOP review.",
      recommended_fix: "Keep a monthly SOP review follow-up tied to management reports.",
      due_date: dateForMonth(year, 3, 20),
      created_by: user.id,
      created_at: isoForMonth(year, 3, 8)
    },
    {
      workspace_id: workspaceId,
      title: "Current month overdue follow-ups rising",
      description: "Current month overdue follow-ups increased while conversion softened.",
      issue_type: "Accountability",
      severity: "Medium",
      status: "Open",
      root_cause: "Recovery follow-ups are not all assigned to owners.",
      recommended_fix: "Assign owners to overdue follow-ups and include them in next management review.",
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
      title: "Customer Follow-Up SOP",
      department: "Sales",
      category: "CRM",
      body_markdown: "# Customer Follow-Up SOP\n\n## Purpose\nPrevent lead leakage and missed proposal follow-up.\n\n## Monthly Learning\nMarch conversion dropped while lead volume stayed stable. Vaeroex recommended adding required next-contact dates and a weekly proposal review.\n\n## Steps\n- Review new leads daily.\n- Assign an owner.\n- Set a next follow-up date.\n- Convert stalled leads into follow-ups.\n- Review missed follow-ups every Friday.",
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
      body_markdown: "# Response Time Escalation SOP\n\n## Trigger\nAverage response time exceeds 24 hours or customer complaints rise.\n\n## Steps\n- Assign a daily response owner.\n- Escalate unanswered leads after one business day.\n- Review response time during the weekly management review.",
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
      body_markdown: "# Weekly Management Review SOP\n\nReview revenue, leads, conversion, response time, overdue follow-ups, open issues, checklist completion, SOP review, and Vaeroex decision support.",
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
        description: "Confirm staffing, schedule, urgent follow-ups, and open issues before work begins.",
        category: "Readiness",
        frequency: "Daily",
        items_json: ["Review schedule", "Confirm staffing", "Check open issues", "Assign urgent follow-ups"] satisfies Json,
        assigned_role: "Manager",
        created_by: user.id,
        created_at: isoForMonth(year, 0, 6)
      },
      {
        workspace_id: workspaceId,
        name: "Weekly Sales Follow-Up Review",
        description: "Review open leads, proposals, next contact dates, and lost opportunities.",
        category: "CRM",
        frequency: "Weekly",
        items_json: ["Review new leads", "Check proposal status", "Assign follow-up owners", "Convert stalled leads to follow-ups"] satisfies Json,
        assigned_role: "Sales Manager",
        created_by: user.id,
        created_at: isoForMonth(year, 0, 6)
      },
      {
        workspace_id: workspaceId,
        name: "Monthly SOP Review",
        description: "Confirm procedures still match how the business actually operates.",
        category: "Process",
        frequency: "Monthly",
        items_json: ["Review stale SOPs", "Update changed steps", "Assign owner", "Document next review date"] satisfies Json,
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
        Leads: "New Leads",
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
      improved: ["Basic operating rhythm was in place.", "Lead volume was enough to support the month."],
      declined: ["Revenue was slightly below the $40,000 target.", "Checklist completion was under the 95% target."],
      risks: ["If checklist ownership stayed loose, issues could compound in later months."],
      actions: ["Create first KPI review follow-up.", "Assign weekly checklist owner."]
    },
    {
      monthIndex: 1,
      title: "February Pipeline Report",
      type: "Monthly",
      summary: "February improved across revenue, conversion, response time, and checklist completion.",
      improved: ["Revenue moved above target.", "Conversion reached 27%.", "Checklist completion reached 96%."],
      declined: ["SOP review was still below full completion."],
      risks: ["Pipeline momentum could hide process drift if SOP review stayed partial."],
      actions: ["Keep weekly sales follow-up review.", "Schedule monthly SOP review."]
    },
    {
      monthIndex: 2,
      title: "March Performance Dip Review",
      type: "Monthly",
      summary: "March was the main performance dip. Revenue fell below target while lead volume stayed decent, pointing to follow-up quality and response time issues.",
      improved: ["Lead volume stayed healthy at 41 new leads."],
      declined: ["Revenue fell to $31,500.", "Conversion dropped to 18%.", "Response time increased to 32 hours.", "Checklist completion fell to 78%."],
      risks: ["Missed follow-ups could continue lowering conversion.", "Open issues and overdue follow-ups could slow recovery."],
      actions: ["Create CRM follow-up list.", "Update customer follow-up SOP.", "Create checklist review.", "Generate recovery report."]
    },
    {
      monthIndex: 3,
      title: "April Recovery Plan",
      type: "Monthly",
      summary: "April recovered part of the March dip, but response time and checklist completion still needed attention.",
      improved: ["Revenue nearly returned to target.", "SOP review improved after process updates."],
      declined: ["Response time stayed above target.", "Open issues remained elevated."],
      risks: ["Partial recovery could stall without issue ownership."],
      actions: ["Assign owner for overdue issue review.", "Run weekly sales follow-up review.", "Review response time escalation SOP."]
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
      "The YTD story shows why Vaeroex is useful: February improved, March exposed follow-up and response-time breakdowns, April recovered partially, May improved, and the current month is mixed.",
      ["May showed strong recovery after SOP and checklist review.", "YTD records make month-over-month changes visible."],
      ["March revenue, conversion, satisfaction, SOP review, and checklist completion missed target.", "The current month still shows response-time and overdue-follow-up risk."],
      ["Lead volume alone did not protect revenue when follow-up quality declined.", "Open issues increased in weak months and need assigned owners."],
      ["Create KPI review follow-up.", "Create CRM follow-up.", "Create checklist review.", "Generate monthly recovery report.", "Confirm KPI targets for next month."]
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
        "Lead volume was stable in March, but conversion dropped to 18%, suggesting follow-up quality declined.",
        "Open issues increased in March and April, especially staffing and response-time issues.",
        "Checklist completion dropped below target during the March dip, increasing execution risk.",
        "The current month has positive revenue but softer conversion, response-time, and overdue-follow-up signals."
      ],
      recommended_actions: [
        {
          title: "Create CRM follow-up list",
          priority: "High",
          suggested_owner: "Sales Manager",
          suggested_due_date: dateFromNow(2),
          why_it_matters: "Stable lead volume did not convert in March because follow-up quality declined.",
          related_module: "CRM"
        },
        {
          title: "Update customer follow-up SOP",
          priority: "High",
          suggested_owner: "General Manager",
          suggested_due_date: dateFromNow(5),
          why_it_matters: "The March dip shows the team needs required next-contact dates and escalation rules.",
          related_module: "SOPs"
        },
        {
          title: "Create checklist review",
          priority: "Medium",
          suggested_owner: "General Manager",
          suggested_due_date: dateFromNow(3),
          why_it_matters: "Checklist completion fell below target during weak months.",
          related_module: "Checklists"
        },
        {
          title: "Create KPI review follow-up",
          priority: "Medium",
          suggested_owner: "Owner",
          suggested_due_date: dateFromNow(4),
          why_it_matters: "YTD trends show which KPIs recovered and which still need ownership.",
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
      suggested_tasks: [
        {
          title: "Review March missed follow-ups",
          description: "Audit March lost/proposal leads and assign next follow-up owners.",
          priority: "High",
          category: "CRM",
          due_date_recommendation: dateFromNow(2),
          reason_this_matters: "March lead volume was stable, but conversion dropped."
        },
        {
          title: "Confirm next-month KPI targets",
          description: "Review revenue, conversion, response time, checklist completion, and overdue-follow-up targets before the next month starts.",
          priority: "Medium",
          category: "KPI Review",
          due_date_recommendation: dateFromNow(5),
          reason_this_matters: "The current month is mixed and needs owner attention before targets drift."
        }
      ],
      suggested_systems: [
        "Use KPI Dashboard YTD view to compare March, April, May, and the current month.",
        "Use CRM follow-ups to prevent lead leakage.",
        "Use monthly reports to preserve the business story and recovery plan."
      ],
      response_markdown:
        "March was the weak month: revenue fell below target while response time rose, conversion dropped, open issues increased, and checklist completion fell. May shows recovery after SOP and checklist review. The current month is mixed, so Vaeroex recommends CRM follow-ups, an SOP update, a checklist review, and a monthly recovery report."
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
      title: "Change weekly lead follow-up process",
      reason: "Conversion dropped in March even though lead volume stayed healthy.",
      expected_outcome: "Improve conversion rate from 18% toward the 25% target and reduce proposal-stage stalls.",
      related_kpi: "Conversion Rate",
      owner: "Morgan Lee",
      review_date: dateForMonth(year, 4, 15),
      status: "reviewed",
      outcome_summary: "May conversion improved to 29% after weekly proposal review and required next-contact dates.",
      created_by: user.id,
      created_at: isoForMonth(year, 3, 5)
    },
    {
      workspace_id: workspaceId,
      title: "Add response-time escalation owner",
      reason: "Average response time rose to 32 hours during the March dip.",
      expected_outcome: "Bring response time back under the 24-hour target.",
      related_kpi: "Average Response Time",
      owner: "Taylor Smith",
      review_date: dateForMonth(year, 4, 20),
      status: "reviewed",
      outcome_summary: "Response time improved to 18 hours in May after daily ownership was added.",
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
      title: "Update customer follow-up SOP",
      source_type: "prestige_demo",
      source_title: "March Performance Dip Review",
      evidence: "March conversion dropped to 18% while lead volume stayed healthy.",
      related_module: "SOPs",
      related_kpi: "Conversion Rate",
      expected_outcome: "Improve follow-up discipline and conversion recovery.",
      created_action_type: "sop_review",
      owner: "General Manager",
      priority: "High",
      review_date: dateForMonth(year, 4, 20),
      status: "outcome_measured",
      outcome_summary: "Follow-up completion improved, conversion rose to 29%, and response time improved after the SOP update.",
      metadata_json: { demo: true, demo_version: DEMO_VERSION, worked: true } satisfies Json,
      created_by: user.id,
      created_at: isoForMonth(year, 3, 10)
    },
    {
      workspace_id: workspaceId,
      title: "Create CRM follow-up list",
      source_type: "prestige_demo",
      source_title: "Vaeroex YTD Demo Operations Intelligence Review",
      evidence: "Proposal-stage leads stalled after response time increased.",
      related_module: "CRM",
      related_kpi: "Conversion Rate",
      expected_outcome: "Prevent lost pipeline by giving every open proposal an owner and next date.",
      created_action_type: "task",
      owner: "Sales Manager",
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
      title: "Create current-month KPI review",
      source_type: "prestige_demo",
      source_title: "Current month mixed signal",
      evidence: "Revenue is above target, but conversion, response time, overdue follow-ups, and checklist completion still need attention.",
      related_module: "KPIs",
      related_kpi: "Revenue",
      expected_outcome: "Confirm next-month targets and assign owners before drift repeats.",
      created_action_type: "task",
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
  await seedTasksAndIssues(supabase, workspaceId, user);
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
