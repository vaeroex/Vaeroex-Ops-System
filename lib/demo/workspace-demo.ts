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

function dateDaysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoDaysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function countValue(result: { count: number | null }) {
  return result.count ?? 0;
}

function throwIfError(error: { message?: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message || "request failed"}`);
  }
}

export function isDemoWorkspaceRecord(workspace?: { name?: string | null; subscription_status?: string | null } | null) {
  return Boolean(workspace && (workspace.subscription_status === "demo" || workspace.name === "Vaeroex Demo Workspace"));
}

export async function getDemoWorkspaceCounts(supabase: AppSupabaseClient, workspaceId: string): Promise<DemoWorkspaceCounts> {
  const [
    crmLeads,
    kpis,
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

export async function ensureDemoWorkspacePopulated(supabase: AppSupabaseClient, workspaceId: string, user: DemoUser) {
  const counts = await getDemoWorkspaceCounts(supabase, workspaceId);

  if (!counts.kpis) {
    const result = await supabase.from("kpis").insert([
      { workspace_id: workspaceId, name: "Revenue", category: "Sales", target: 90000, actual_value: 72000, metric_date: dateDaysFromNow(-35), owner: "Owner", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Revenue", category: "Sales", target: 90000, actual_value: 81000, metric_date: dateDaysFromNow(-21), owner: "Owner", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Revenue", category: "Sales", target: 90000, actual_value: 94000, metric_date: dateDaysFromNow(-7), owner: "Owner", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Leads", category: "Sales", target: 50, actual_value: 38, metric_date: dateDaysFromNow(-35), owner: "Sales Manager", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Leads", category: "Sales", target: 50, actual_value: 44, metric_date: dateDaysFromNow(-21), owner: "Sales Manager", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Leads", category: "Sales", target: 50, actual_value: 57, metric_date: dateDaysFromNow(-7), owner: "Sales Manager", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Tasks Completed", category: "Operations", target: 80, actual_value: 64, metric_date: dateDaysFromNow(-21), owner: "Operations Manager", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Tasks Completed", category: "Operations", target: 80, actual_value: 76, metric_date: dateDaysFromNow(-7), owner: "Operations Manager", source: "Demo data", created_by: user.id }
    ]);
    throwIfError(result.error, "Demo KPIs");
  }

  if (!counts.tasks) {
    const result = await supabase.from("tasks").insert([
      { workspace_id: workspaceId, title: "Review overdue customer follow-ups", description: "Confirm every open lead has a next action and owner.", status: "To Do", priority: "High", category: "CRM", due_date: dateDaysFromNow(1), created_by: user.id },
      { workspace_id: workspaceId, title: "Assign weekly manager review", description: "Set a recurring operating review for tasks, issues, KPIs, and checklist misses.", status: "In Progress", priority: "Medium", category: "Management", due_date: dateDaysFromNow(3), created_by: user.id },
      { workspace_id: workspaceId, title: "Update equipment handoff SOP", description: "Add inspection steps and escalation owner.", status: "To Do", priority: "Medium", category: "SOP", due_date: dateDaysFromNow(6), created_by: user.id }
    ]);
    throwIfError(result.error, "Demo tasks");
  }

  if (!counts.issues) {
    const result = await supabase.from("issues").insert([
      { workspace_id: workspaceId, title: "Customer follow-ups are inconsistent", description: "Leads are created but next-contact dates are not always assigned.", issue_type: "Follow-up", severity: "High", status: "Open", root_cause: "No required follow-up field.", recommended_fix: "Use CRM review and a weekly follow-up task list.", due_date: dateDaysFromNow(2), created_by: user.id },
      { workspace_id: workspaceId, title: "Checklist completion drops on Fridays", description: "End-of-week closeout checks are missed when managers are busy.", issue_type: "Checklist", severity: "Medium", status: "Open", root_cause: "No escalation after missed run.", recommended_fix: "Add a Friday manager reminder and review incomplete runs.", due_date: dateDaysFromNow(5), created_by: user.id }
    ]);
    throwIfError(result.error, "Demo issues");
  }

  if (!counts.checklists) {
    const { data: checklists, error } = await supabase
      .from("checklists")
      .insert([
        { workspace_id: workspaceId, name: "Opening Checklist", description: "Confirm the team is ready before work begins.", category: "Readiness", frequency: "Daily", items_json: ["Review schedule", "Confirm staffing", "Check open issues", "Assign urgent tasks"] satisfies Json, assigned_role: "Manager", created_by: user.id },
        { workspace_id: workspaceId, name: "Weekly Management Review", description: "Review KPIs, leads, tasks, issues, and reports.", category: "Management", frequency: "Weekly", items_json: ["Review KPI movement", "Review open leads", "Close overdue tasks", "Document next actions"] satisfies Json, assigned_role: "Owner", created_by: user.id }
      ])
      .select("id");
    throwIfError(error, "Demo checklists");

    if (checklists?.length) {
      const result = await supabase.from("checklist_runs").insert([
        { workspace_id: workspaceId, checklist_id: checklists[0].id, status: "Complete", responses_json: ["Schedule reviewed", "Staffing confirmed", "Urgent tasks assigned"] satisfies Json, notes: "Morning readiness completed.", completed_at: isoDaysFromNow(-1), assigned_to: user.id },
        { workspace_id: workspaceId, checklist_id: checklists[1].id, status: "Needs review", responses_json: ["KPI movement reviewed", "Open leads reviewed"] satisfies Json, notes: "Follow-up dates still missing on several leads.", completed_at: null, assigned_to: user.id }
      ]);
      throwIfError(result.error, "Demo checklist runs");
    }
  }

  if (!counts.sops) {
    const result = await supabase.from("sops").insert([
      { workspace_id: workspaceId, title: "Customer Follow-Up SOP", department: "Sales", category: "CRM", body_markdown: "# Customer Follow-Up SOP\n\n## Purpose\nKeep every lead moving with a clear owner and next step.\n\n## Steps\n- Review new leads daily.\n- Assign an owner.\n- Set the next follow-up.\n- Convert stalled leads into tasks.", status: "Draft", version: 1, created_by: user.id, ai_generated: true },
      { workspace_id: workspaceId, title: "Weekly Management Review SOP", department: "Operations", category: "Management", body_markdown: "# Weekly Management Review SOP\n\nReview KPIs, CRM, overdue tasks, open issues, recent files, and Vaeroex recommendations every week.", status: "Draft", version: 1, created_by: user.id, ai_generated: true }
    ]);
    throwIfError(result.error, "Demo SOPs");
  }

  if (!counts.assets) {
    const result = await supabase.from("assets").insert([
      { workspace_id: workspaceId, asset_name: "Operations Tablet", asset_type: "Device", identifier: "TAB-001", location: "Front desk", status: "Needs attention", last_checked_at: isoDaysFromNow(-2), notes: "Battery drains before close." },
      { workspace_id: workspaceId, asset_name: "Primary Vehicle", asset_type: "Vehicle", identifier: "VEH-001", location: "Main location", status: "Ready", last_checked_at: isoDaysFromNow(-1), notes: "Ready for daily work." }
    ]);
    throwIfError(result.error, "Demo assets");
  }

  if (!counts.crmLeads) {
    const { data: leads, error } = await supabase
      .from("crm_leads")
      .insert([
        { workspace_id: workspaceId, lead_name: "Avery Johnson", company: "Northline Co.", email: "avery@example.com", status: "Proposal Sent", estimated_value: 18000, owner: "Morgan Lee", notes: "Needs follow-up this week.", last_activity_at: isoDaysFromNow(-3), created_by: user.id },
        { workspace_id: workspaceId, lead_name: "Sam Patel", company: "Patel Retail Group", email: "sam@example.com", status: "New", estimated_value: 9500, owner: "Morgan Lee", notes: "No follow-up date assigned yet.", last_activity_at: null, created_by: user.id },
        { workspace_id: workspaceId, lead_name: "Casey Rivera", company: "Rivera Services", email: "casey@example.com", status: "Won", estimated_value: 22000, owner: "Morgan Lee", notes: "Converted after manager follow-up.", last_activity_at: isoDaysFromNow(-5), created_by: user.id }
      ])
      .select("id,lead_name,status,estimated_value,owner");
    throwIfError(error, "Demo CRM");

    if (leads?.length) {
      const result = await supabase.from("crm_lead_history").insert(
        leads.map((lead) => ({
          workspace_id: workspaceId,
          lead_id: lead.id,
          event_type: "demo_created",
          status: lead.status,
          estimated_value: lead.estimated_value,
          owner: lead.owner,
          notes: `${lead.lead_name} added to demo CRM history.`,
          created_by: user.id
        }))
      );
      throwIfError(result.error, "Demo CRM history");
    }
  }

  if (!counts.files || !counts.fileAnalyses) {
    const { data: file, error } = await supabase
      .from("file_uploads")
      .insert({
        workspace_id: workspaceId,
        original_name: "demo-business-scorecard.csv",
        display_name: "Demo Business Scorecard.csv",
        file_extension: "csv",
        mime_type: "text/csv",
        file_size_bytes: 4096,
        storage_bucket: "demo",
        storage_path: `demo/${workspaceId}/demo-business-scorecard.csv`,
        import_type: "kpi",
        import_status: "imported",
        imported_rows: 8,
        processing_status: "ready",
        processed_at: new Date().toISOString(),
        analysis_prompt: "Create an executive summary and identify trends.",
        analysis_summary: "Revenue and leads improved, but follow-up consistency and equipment readiness need manager attention.",
        metadata_json: { demo: true, source: "Vaeroex demo workspace" } satisfies Json,
        created_by: user.id
      })
      .select("id")
      .single();
    throwIfError(error, "Demo file");

    if (file) {
      const result = await supabase.from("file_imports").insert({
        workspace_id: workspaceId,
        file_upload_id: file.id,
        import_type: "kpi",
        status: "completed",
        rows_total: 8,
        rows_imported: 8,
        mapping_json: { Revenue: "Revenue", Leads: "Leads", "Tasks Completed": "Tasks Completed" } satisfies Json,
        extraction_summary: "Imported demo KPI rows for revenue, leads, and completed tasks.",
        reviewed_at: new Date().toISOString(),
        imported_at: new Date().toISOString(),
        created_by: user.id
      });
      throwIfError(result.error, "Demo file import");
    }
  }

  if (!counts.reports) {
    const reportBody = `# Weekly Executive Report\n\nGenerated by Vaeroex.\n\n## Executive Summary\nRevenue and lead volume improved this period, while customer follow-up and checklist consistency need attention.\n\n## Completed Work\n- Demo KPIs, CRM leads, tasks, issues, SOPs, checklists, and file insights are available.\n\n## Operational Risks\n- Leads without follow-up dates can stall revenue.\n- Friday checklist misses can hide end-of-week issues.\n\n## Recommended Actions\n- Assign follow-up owners for new leads.\n- Review open issues during the weekly management review.\n- Update the customer follow-up SOP after one week of real usage.`;
    const result = await supabase.from("reports").insert({
      workspace_id: workspaceId,
      report_type: "Weekly",
      title: "Demo Weekly Executive Report",
      date_range_start: dateDaysFromNow(-7),
      date_range_end: dateDaysFromNow(0),
      body_markdown: reportBody,
      source_data_json: { demo: true, generated_by: "Vaeroex" } satisfies Json,
      created_by: user.id
    });
    throwIfError(result.error, "Demo report");
  }

  if (!counts.vaeroexInsights) {
    const result = await supabase.from("ai_agent_runs").insert({
      workspace_id: workspaceId,
      agent_type: "operations_audit",
      input_json: { demo: true, prompt: "Audit the demo workspace" } satisfies Json,
      output_json: {
        title: "Demo Operations Audit",
        executive_summary: "Vaeroex found improving revenue and lead activity, with risks around follow-up ownership, checklist misses, and equipment readiness.",
        problems_identified: [
          "Some CRM leads have no next follow-up date.",
          "Weekly checklist review is not fully completed.",
          "Operations tablet needs attention."
        ],
        recommended_actions: [
          {
            title: "Assign follow-up owner for new leads",
            priority: "High",
            suggested_owner: "Sales Manager",
            suggested_due_date: dateDaysFromNow(2),
            why_it_matters: "Leads can stall when no one owns the next touch.",
            related_module: "CRM"
          },
          {
            title: "Review Friday checklist misses",
            priority: "Medium",
            suggested_owner: "Operations Manager",
            suggested_due_date: dateDaysFromNow(5),
            why_it_matters: "Missed closeout checks can hide staffing and customer issues.",
            related_module: "Checklists"
          }
        ],
        suggested_tasks: [
          {
            title: "Review CRM leads missing follow-up",
            description: "Open CRM and assign next owner/date for each new lead.",
            priority: "High",
            category: "CRM",
            due_date_recommendation: dateDaysFromNow(2),
            reason_this_matters: "Follow-up ownership protects revenue."
          }
        ],
        suggested_systems: ["Use the existing KPI Dashboard to track weekly revenue, leads, conversion, and issue volume."],
        response_markdown: "Revenue and leads are improving. The next priority is making follow-up and checklist ownership consistent."
      } satisfies Json,
      status: "completed",
      created_by: user.id
    });
    throwIfError(result.error, "Demo Vaeroex insight");
  }

  return getDemoWorkspaceCounts(supabase, workspaceId);
}
