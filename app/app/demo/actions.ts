"use server";

import { cookies } from "next/headers";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

type WorkspaceJoinRow = {
  workspace_id: string;
  workspaces: { id: string; name: string; subscription_status: string } | { id: string; name: string; subscription_status: string }[] | null;
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

function normalizeWorkspace(row: WorkspaceJoinRow) {
  return Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
}

function throwIfError(error: { message?: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message || "request failed"}`);
  }
}

export async function createDemoWorkspaceAction() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect("/app?error=Supabase is not configured.");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let destination = "/app?message=Demo workspace loaded.";

  try {
    const { data: memberships } = await supabase
      .from("workspace_members")
      .select("workspace_id, workspaces(id,name,subscription_status)")
      .eq("user_id", user.id)
      .eq("status", "active");
    const existing = ((memberships || []) as WorkspaceJoinRow[])
      .map(normalizeWorkspace)
      .find((workspace) => workspace?.subscription_status === "demo" || workspace?.name === "Vaeroex Demo Workspace");

    if (existing) {
      const cookieStore = await cookies();
      cookieStore.set("vaeroex_workspace_id", existing.id, {
        httpOnly: true,
        sameSite: "lax",
        path: "/"
      });
    } else {
      const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .insert({
        name: "Vaeroex Demo Workspace",
        industry: "General Small Business",
        size: "12 employees",
        primary_contact_name: user.user_metadata?.full_name || "Demo Owner",
        primary_contact_email: user.email,
        created_by: user.id,
        subscription_status: "demo",
        plan_slug: "growth",
        subscription_required: false,
        manually_unlocked: true
      })
      .select("id")
      .single();

      throwIfError(workspaceError, "Demo workspace");

      if (!workspace) {
        throw new Error("Demo workspace could not be created.");
      }

      const workspaceId = workspace.id;
      const membership = await supabase.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      role: "owner",
      status: "active"
    });
      throwIfError(membership.error, "Demo membership");

    const kpis = await supabase.from("kpis").insert([
      { workspace_id: workspaceId, name: "Revenue", category: "Sales", target: 90000, actual_value: 72000, metric_date: dateDaysFromNow(-35), owner: "Owner", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Revenue", category: "Sales", target: 90000, actual_value: 81000, metric_date: dateDaysFromNow(-21), owner: "Owner", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Revenue", category: "Sales", target: 90000, actual_value: 94000, metric_date: dateDaysFromNow(-7), owner: "Owner", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Leads", category: "Sales", target: 50, actual_value: 38, metric_date: dateDaysFromNow(-35), owner: "Sales Manager", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Leads", category: "Sales", target: 50, actual_value: 44, metric_date: dateDaysFromNow(-21), owner: "Sales Manager", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Leads", category: "Sales", target: 50, actual_value: 57, metric_date: dateDaysFromNow(-7), owner: "Sales Manager", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Tasks Completed", category: "Operations", target: 80, actual_value: 64, metric_date: dateDaysFromNow(-21), owner: "Operations Manager", source: "Demo data", created_by: user.id },
      { workspace_id: workspaceId, name: "Tasks Completed", category: "Operations", target: 80, actual_value: 76, metric_date: dateDaysFromNow(-7), owner: "Operations Manager", source: "Demo data", created_by: user.id }
    ]);
    throwIfError(kpis.error, "Demo KPIs");

    const tasks = await supabase.from("tasks").insert([
      { workspace_id: workspaceId, title: "Review overdue customer follow-ups", description: "Confirm every open lead has a next action and owner.", status: "To Do", priority: "High", category: "CRM", due_date: dateDaysFromNow(1), created_by: user.id },
      { workspace_id: workspaceId, title: "Assign weekly manager review", description: "Set a recurring operating review for tasks, issues, KPIs, and checklist misses.", status: "In Progress", priority: "Medium", category: "Management", due_date: dateDaysFromNow(3), created_by: user.id },
      { workspace_id: workspaceId, title: "Update equipment handoff SOP", description: "Add inspection steps and escalation owner.", status: "To Do", priority: "Medium", category: "SOP", due_date: dateDaysFromNow(6), created_by: user.id }
    ]);
    throwIfError(tasks.error, "Demo tasks");

    const issues = await supabase.from("issues").insert([
      { workspace_id: workspaceId, title: "Customer follow-ups are inconsistent", description: "Leads are created but next-contact dates are not always assigned.", issue_type: "Follow-up", severity: "High", status: "Open", root_cause: "No required follow-up field.", recommended_fix: "Use CRM review and a weekly follow-up task list.", due_date: dateDaysFromNow(2), created_by: user.id },
      { workspace_id: workspaceId, title: "Checklist completion drops on Fridays", description: "End-of-week closeout checks are missed when managers are busy.", issue_type: "Checklist", severity: "Medium", status: "Open", root_cause: "No escalation after missed run.", recommended_fix: "Add a Friday manager reminder and review incomplete runs.", due_date: dateDaysFromNow(5), created_by: user.id }
    ]);
    throwIfError(issues.error, "Demo issues");

    const { data: checklists, error: checklistError } = await supabase
      .from("checklists")
      .insert([
        { workspace_id: workspaceId, name: "Opening Checklist", description: "Confirm the team is ready before work begins.", category: "Readiness", frequency: "Daily", items_json: ["Review schedule", "Confirm staffing", "Check open issues", "Assign urgent tasks"] satisfies Json, assigned_role: "Manager", created_by: user.id },
        { workspace_id: workspaceId, name: "Weekly Management Review", description: "Review KPIs, leads, tasks, issues, and reports.", category: "Management", frequency: "Weekly", items_json: ["Review KPI movement", "Review open leads", "Close overdue tasks", "Document next actions"] satisfies Json, assigned_role: "Owner", created_by: user.id }
      ])
      .select("id,name");
    throwIfError(checklistError, "Demo checklists");

    if (checklists?.length) {
      const runs = await supabase.from("checklist_runs").insert([
        { workspace_id: workspaceId, checklist_id: checklists[0].id, status: "Complete", responses_json: ["Schedule reviewed", "Staffing confirmed", "Urgent tasks assigned"] satisfies Json, notes: "Morning readiness completed.", completed_at: isoDaysFromNow(-1), assigned_to: user.id },
        { workspace_id: workspaceId, checklist_id: checklists[1].id, status: "Needs review", responses_json: ["KPI movement reviewed", "Open leads reviewed"] satisfies Json, notes: "Follow-up dates still missing on several leads.", completed_at: null, assigned_to: user.id }
      ]);
      throwIfError(runs.error, "Demo checklist runs");
    }

    const sops = await supabase.from("sops").insert([
      { workspace_id: workspaceId, title: "Customer Follow-Up SOP", department: "Sales", category: "CRM", body_markdown: "# Customer Follow-Up SOP\n\n## Purpose\nKeep every lead moving with a clear owner and next step.\n\n## Steps\n- Review new leads daily.\n- Assign an owner.\n- Set the next follow-up.\n- Convert stalled leads into tasks.", status: "Draft", version: 1, created_by: user.id, ai_generated: true },
      { workspace_id: workspaceId, title: "Weekly Management Review SOP", department: "Operations", category: "Management", body_markdown: "# Weekly Management Review SOP\n\nReview KPIs, CRM, overdue tasks, open issues, recent files, and Vaeroex recommendations every week.", status: "Draft", version: 1, created_by: user.id, ai_generated: true }
    ]);
    throwIfError(sops.error, "Demo SOPs");

    const assets = await supabase.from("assets").insert([
      { workspace_id: workspaceId, asset_name: "Operations Tablet", asset_type: "Device", identifier: "TAB-001", location: "Front desk", status: "Needs attention", last_checked_at: isoDaysFromNow(-2), notes: "Battery drains before close." },
      { workspace_id: workspaceId, asset_name: "Primary Vehicle", asset_type: "Vehicle", identifier: "VEH-001", location: "Main location", status: "Ready", last_checked_at: isoDaysFromNow(-1), notes: "Ready for daily work." }
    ]);
    throwIfError(assets.error, "Demo assets");

    const people = await supabase.from("people").insert([
      { workspace_id: workspaceId, full_name: "Jamie Brooks", email: "jamie@example.com", role_title: "Operations Coordinator", department: "Operations", status: "active", start_date: dateDaysFromNow(-120), notes: "Owns daily readiness and task follow-up." },
      { workspace_id: workspaceId, full_name: "Morgan Lee", email: "morgan@example.com", role_title: "Sales Manager", department: "Sales", status: "active", start_date: dateDaysFromNow(-240), notes: "Owns lead review and weekly pipeline check." }
    ]);
    throwIfError(people.error, "Demo people");

    const { data: leads, error: leadError } = await supabase
      .from("crm_leads")
      .insert([
        { workspace_id: workspaceId, lead_name: "Avery Johnson", company: "Northline Co.", email: "avery@example.com", status: "Proposal Sent", estimated_value: 18000, owner: "Morgan Lee", notes: "Needs follow-up this week.", last_activity_at: isoDaysFromNow(-3), created_by: user.id },
        { workspace_id: workspaceId, lead_name: "Sam Patel", company: "Patel Retail Group", email: "sam@example.com", status: "New", estimated_value: 9500, owner: "Morgan Lee", notes: "No follow-up date assigned yet.", last_activity_at: null, created_by: user.id },
        { workspace_id: workspaceId, lead_name: "Casey Rivera", company: "Rivera Services", email: "casey@example.com", status: "Won", estimated_value: 22000, owner: "Morgan Lee", notes: "Converted after manager follow-up.", last_activity_at: isoDaysFromNow(-5), created_by: user.id }
      ])
      .select("id,lead_name,status,estimated_value,owner");
    throwIfError(leadError, "Demo CRM");

    if (leads?.length) {
      const history = await supabase.from("crm_lead_history").insert(
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
      throwIfError(history.error, "Demo CRM history");
    }

    const { data: file, error: fileError } = await supabase
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
    throwIfError(fileError, "Demo file");

    if (file) {
      const fileImport = await supabase.from("file_imports").insert({
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
      throwIfError(fileImport.error, "Demo file import");
    }

    const reportBody = `# Weekly Executive Report\n\nGenerated by Vaeroex.\n\n## Executive Summary\nRevenue and lead volume improved this period, while customer follow-up and checklist consistency need attention.\n\n## Completed Work\n- Demo KPIs, CRM leads, tasks, issues, SOPs, checklists, and file insights are available.\n\n## Operational Risks\n- Leads without follow-up dates can stall revenue.\n- Friday checklist misses can hide end-of-week issues.\n\n## Recommended Actions\n- Assign follow-up owners for new leads.\n- Review open issues during the weekly management review.\n- Update the customer follow-up SOP after one week of real usage.`;
    const reports = await supabase.from("reports").insert({
      workspace_id: workspaceId,
      report_type: "Weekly",
      title: "Demo Weekly Executive Report",
      date_range_start: dateDaysFromNow(-7),
      date_range_end: dateDaysFromNow(0),
      body_markdown: reportBody,
      source_data_json: { demo: true, generated_by: "Vaeroex" } satisfies Json,
      created_by: user.id
    });
    throwIfError(reports.error, "Demo report");

    const insights = await supabase.from("ai_agent_runs").insert({
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
    throwIfError(insights.error, "Demo Vaeroex insight");

      const cookieStore = await cookies();
      cookieStore.set("vaeroex_workspace_id", workspaceId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/"
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo workspace could not be created.";
    destination = `/app?error=${encodeURIComponent(message)}`;
  }

  redirect(destination as Route);
}
