import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
}

function countByStatus<T extends { status?: string | null }>(rows: T[] | null | undefined) {
  return (rows || []).reduce<Record<string, number>>((counts, row) => {
    const status = row.status || "Unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

export async function buildWorkspaceSnapshot(supabase: SupabaseClient<Database>, workspaceId: string) {
  const today = new Date().toISOString().slice(0, 10);

  const [
    workspace,
    openTasks,
    overdueTasks,
    openIssues,
    flaggedAssets,
    submissions,
    recentTasks,
    recentIssues,
    recentForms,
    recentSubmissions,
    checklists,
    checklistRuns,
    assets,
    people,
    sops,
    reports,
    vaeroexRuns,
    fileCount,
    kpiCount,
    crmLeadCount,
    operationalMetricCount,
    formCount,
    checklistCount,
    sopCount,
    reportCount,
    assetCount,
    peopleCount,
    recentKpis,
    recentFileImports,
    recentFiles,
    recentCrmLeads,
    recentCrmLeadHistory,
    recentOperationalMetrics
  ] = await Promise.all([
    supabase.from("workspaces").select("id,name,industry,size,created_at").eq("id", workspaceId).maybeSingle(),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "Done"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).lt("due_date", today).neq("status", "Done"),
    supabase.from("issues").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "Closed"),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "Ready"),
    supabase.from("form_submissions").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase
      .from("tasks")
      .select("id,title,description,status,priority,category,due_date,ai_generated,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("issues")
      .select("id,title,description,issue_type,severity,status,root_cause,recommended_fix,due_date,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("forms")
      .select("id,name,description,form_type,schema_json,is_public,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("form_submissions")
      .select("id,form_id,submitter_name,data_json,ai_summary,ai_detected_priority,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("checklists")
      .select("id,name,description,category,frequency,items_json,assigned_role,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("checklist_runs")
      .select("id,checklist_id,status,responses_json,notes,completed_at,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("assets")
      .select("id,asset_name,asset_type,location,status,last_checked_at,notes,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("people")
      .select("id,full_name,role_title,department,status,start_date,created_at")
      .eq("workspace_id", workspaceId)
      .order("full_name", { ascending: true })
      .limit(20),
    supabase
      .from("sops")
      .select("id,title,department,category,status,version,ai_generated,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("reports")
      .select("id,title,report_type,date_range_start,date_range_end,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("ai_agent_runs")
      .select("id,agent_type,status,output_json,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("file_uploads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("kpis").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("crm_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("operational_metrics").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("forms").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("checklists").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("sops").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("people").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase
      .from("kpis")
      .select("id,name,category,target,actual_value,metric_date,owner,source,source_file_id,import_id,created_at")
      .eq("workspace_id", workspaceId)
      .order("metric_date", { ascending: false })
      .limit(30),
    supabase
      .from("file_imports")
      .select("id,file_upload_id,import_type,status,rows_total,rows_imported,extraction_summary,created_at,imported_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("file_uploads")
      .select("id,display_name,file_extension,import_type,import_status,imported_rows,analysis_summary,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("crm_leads")
      .select("id,lead_name,company,status,estimated_value,owner,source_file_id,import_id,last_activity_at,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("crm_lead_history")
      .select("id,lead_id,event_type,status,estimated_value,owner,source_file_id,import_id,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("operational_metrics")
      .select("id,metric_name,category,value,metric_date,owner,source_file_id,import_id,created_at")
      .eq("workspace_id", workspaceId)
      .order("metric_date", { ascending: false })
      .limit(10)
  ]);
  const recentKpiRows = recentKpis.data ?? [];
  const recentFileRows = recentFiles.data ?? [];
  const recentLeadRows = recentCrmLeads.data ?? [];
  const recentTaskRows = recentTasks.data ?? [];
  const recentIssueRows = recentIssues.data ?? [];
  const recentChecklistRows = checklists.data ?? [];
  const recentSopRows = sops.data ?? [];
  const recentReportRows = reports.data ?? [];
  const recentFormRows = recentForms.data ?? [];
  const recentPeopleRows = people.data ?? [];
  const analyzedFiles = recentFileRows.filter((file) => Boolean(file.analysis_summary));
  const pendingImports = (recentFileImports.data ?? []).filter((item) => item.status !== "completed");
  const moduleState = {
    executive_dashboard: {
      exists: true,
      guidance: "The Executive Dashboard is built into Vaeroex. Do not recommend creating it; recommend improving the data feeding it."
    },
    kpi_dashboard: {
      exists: true,
      records: kpiCount.count ?? 0,
      metric_names: uniqueStrings(recentKpiRows.map((kpi) => kpi.name)),
      categories: uniqueStrings(recentKpiRows.map((kpi) => kpi.category)),
      guidance: "The KPI Dashboard already exists. Recommend adding, cleaning, reviewing, or comparing KPI records instead of creating a KPI dashboard."
    },
    crm_pipeline: {
      exists: true,
      records: crmLeadCount.count ?? 0,
      statuses: countByStatus(recentLeadRows),
      guidance: "The CRM Pipeline already exists. Recommend improving lead data, follow-up cadence, status quality, source tracking, or estimated value."
    },
    task_tracking: {
      exists: true,
      open_records: openTasks.count ?? 0,
      overdue_records: overdueTasks.count ?? 0,
      statuses: countByStatus(recentTaskRows),
      guidance: "Task tracking already exists. Recommend assigning owners, due dates, priorities, or converting recommendations into tasks."
    },
    issue_tracking: {
      exists: true,
      open_records: openIssues.count ?? 0,
      statuses: countByStatus(recentIssueRows),
      guidance: "Issue tracking already exists. Recommend resolving, categorizing, converting, or reviewing issues instead of creating an issue log."
    },
    checklist_library: {
      exists: true,
      records: checklistCount.count ?? 0,
      names: uniqueStrings(recentChecklistRows.map((checklist) => checklist.name)),
      guidance: "Checklists already exist as a module. Recommend adding missing checklist items, assigning roles, running checklists, or reviewing failed runs."
    },
    sop_library: {
      exists: true,
      records: sopCount.count ?? 0,
      names: uniqueStrings(recentSopRows.map((sop) => sop.title)),
      guidance: "The SOP Library already exists. Recommend owners, review cadence, approvals, and updates to specific SOPs instead of creating an SOP system."
    },
    reports: {
      exists: true,
      records: reportCount.count ?? 0,
      names: uniqueStrings(recentReportRows.map((report) => report.title)),
      guidance: "Reports already exist. Recommend generating a specific follow-up report, updating report inputs, or attaching file analysis to a report."
    },
    files: {
      exists: true,
      records: fileCount.count ?? 0,
      analyzed_records: analyzedFiles.length,
      pending_imports: pendingImports.length,
      names: uniqueStrings(recentFileRows.map((file) => file.display_name)),
      guidance: "The Files module already exists. Recommend analyzing, importing, mapping, reporting from, or converting existing file insights."
    },
    forms: {
      exists: true,
      records: formCount.count ?? 0,
      names: uniqueStrings(recentFormRows.map((form) => form.name)),
      guidance: "Forms already exist. Recommend improving fields, public status, follow-up rules, or submission review."
    },
    assets: {
      exists: true,
      records: assetCount.count ?? 0,
      flagged_records: flaggedAssets.count ?? 0,
      guidance: "Assets already exist. Recommend checks, maintenance follow-up, owners, locations, or readiness review."
    },
    people: {
      exists: true,
      records: peopleCount.count ?? 0,
      departments: uniqueStrings(recentPeopleRows.map((person) => person.department)),
      guidance: "People records already exist. Recommend improving ownership, role clarity, departments, and accountability assignments."
    }
  };
  const gaps = [
    !(kpiCount.count ?? 0) ? "KPI Dashboard exists but has no KPI records yet." : "",
    !(crmLeadCount.count ?? 0) ? "CRM Pipeline exists but has no lead records yet." : "",
    !(sopCount.count ?? 0) ? "SOP Library exists but has no SOP records yet." : "",
    !(checklistCount.count ?? 0) ? "Checklist module exists but has no checklist records yet." : "",
    !(reportCount.count ?? 0) ? "Reports module exists but has no saved reports yet." : "",
    pendingImports.length ? `${pendingImports.length} file import${pendingImports.length === 1 ? "" : "s"} are waiting for review or approval.` : "",
    (overdueTasks.count ?? 0) ? `${overdueTasks.count} task${overdueTasks.count === 1 ? "" : "s"} are overdue.` : "",
    (openIssues.count ?? 0) ? `${openIssues.count} issue${openIssues.count === 1 ? "" : "s"} are open.` : ""
  ].filter(Boolean);

  return {
    generated_at: new Date().toISOString(),
    workspace: workspace.data,
    workspace_awareness_rules: [
      "Do not recommend creating a Vaeroex module that already exists in module_state.",
      "If a module exists, recommend improving, filling, reviewing, cleaning, converting, assigning, or using existing records.",
      "Mention the specific existing workspace records, counts, gaps, overdue work, stale items, file analyses, reports, KPIs, CRM records, SOPs, checklists, issues, tasks, assets, or people records that support the recommendation.",
      "Classify recommendations into Improve Existing, Fill Missing Data, Review Stale Items, Convert Insight Into Action, Operational Risk, Dashboard / KPI Improvement, CRM / Revenue Improvement, SOP / Process Improvement, or File / Report Follow-up.",
      "Never say 'Create KPI Dashboard', 'Create CRM', 'Create task tracking', 'Create SOPs', 'Create reports', or 'Upload files' as a generic recommendation. Vaeroex already has those modules."
    ],
    module_state: moduleState,
    workspace_gaps: gaps,
    metrics: {
      open_tasks: openTasks.count ?? 0,
      overdue_tasks: overdueTasks.count ?? 0,
      open_issues: openIssues.count ?? 0,
      flagged_assets: flaggedAssets.count ?? 0,
      form_submissions: submissions.count ?? 0,
      uploaded_files: fileCount.count ?? 0,
      kpi_history_records: kpiCount.count ?? 0,
      crm_leads: crmLeadCount.count ?? 0,
      operational_metrics: operationalMetricCount.count ?? 0,
      forms: formCount.count ?? 0,
      checklists: checklistCount.count ?? 0,
      sops: sopCount.count ?? 0,
      reports: reportCount.count ?? 0,
      assets: assetCount.count ?? 0,
      people: peopleCount.count ?? 0
    },
    recent_tasks: recentTaskRows,
    recent_issues: recentIssueRows,
    forms: recentFormRows,
    recent_form_submissions: recentSubmissions.data ?? [],
    checklists: recentChecklistRows,
    checklist_runs: checklistRuns.data ?? [],
    assets: assets.data ?? [],
    people: recentPeopleRows,
    sops: recentSopRows,
    reports: recentReportRows,
    recent_vaeroex_results: vaeroexRuns.data ?? [],
    kpi_history: recentKpiRows,
    file_import_history: recentFileImports.data ?? [],
    files: recentFileRows,
    file_analyses: analyzedFiles,
    crm_leads: recentLeadRows,
    crm_lead_history: recentCrmLeadHistory.data ?? [],
    operational_metrics: recentOperationalMetrics.data ?? []
  };
}
