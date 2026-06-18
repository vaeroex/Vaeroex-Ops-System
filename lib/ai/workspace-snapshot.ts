import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

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
    vaeroexRuns
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
      .limit(5)
  ]);

  return {
    generated_at: new Date().toISOString(),
    workspace: workspace.data,
    metrics: {
      open_tasks: openTasks.count ?? 0,
      overdue_tasks: overdueTasks.count ?? 0,
      open_issues: openIssues.count ?? 0,
      flagged_assets: flaggedAssets.count ?? 0,
      form_submissions: submissions.count ?? 0
    },
    recent_tasks: recentTasks.data ?? [],
    recent_issues: recentIssues.data ?? [],
    forms: recentForms.data ?? [],
    recent_form_submissions: recentSubmissions.data ?? [],
    checklists: checklists.data ?? [],
    checklist_runs: checklistRuns.data ?? [],
    assets: assets.data ?? [],
    people: people.data ?? [],
    sops: sops.data ?? [],
    reports: reports.data ?? [],
    recent_vaeroex_results: vaeroexRuns.data ?? []
  };
}
