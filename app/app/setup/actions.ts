"use server";

import { redirect } from "next/navigation";
import { COMPLIANCE_NOTICE, industryTemplates } from "@/data/industry-templates";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { VAEROEX_SYSTEM_PROMPT } from "@/lib/ai/prompts/vaeroex-system-prompt";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

function value(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function slugify(valueToSlug: string) {
  return valueToSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function fieldSchemaFor(formName: string): Json {
  return [
    { label: "Submitted by", type: "text", required: true },
    { label: "Operational details", type: "long_text", required: true },
    { label: "Priority", type: "priority", required: true },
    { label: "Suggested follow-up date", type: "date", required: false },
    { label: "Manager notes", type: "long_text", required: false }
  ].map((field) => ({
    ...field,
    key: slugify(`${formName}-${field.label}`)
  })) as Json;
}

function checklistItemsFor(name: string): Json {
  return [
    `Confirm ${name.toLowerCase()} owner`,
    "Review open tasks or blockers",
    "Log missed or failed items",
    "Create follow-up task when needed",
    "Submit for manager review"
  ] as Json;
}

function workflowStepsFor(name: string): Json {
  return [
    { order: 1, title: "Trigger", description: `Identify when ${name.toLowerCase()} starts.` },
    { order: 2, title: "Assign owner", description: "Assign one accountable owner and backup reviewer." },
    { order: 3, title: "Complete work", description: "Track required fields, checklist items, and blockers." },
    { order: 4, title: "Manager review", description: "Review exceptions and create follow-up tasks." }
  ] as Json;
}

function sopBody(title: string) {
  return `# ${title}

## Purpose
Create a repeatable process with clear ownership, required information, and manager review.

## When to Use This SOP
Use this draft when the related workflow starts or when a bottleneck is reported.

## Who Is Responsible
Assign one process owner and one manager reviewer.

## Step-by-Step Process
1. Capture the request or issue.
2. Assign an owner and due date.
3. Complete the checklist or workflow steps.
4. Log blockers, missed items, or follow-up tasks.
5. Submit for manager review.

## Quality Checks
- Required fields are complete.
- Follow-up task exists when needed.
- Manager review is logged.

## Escalation Rules
Escalate after one missed deadline or repeated ownership gap.

## Completion Standard
The process is complete when the owner logs the outcome and the manager confirms closure.`;
}

function buildVaeroexAuditSummary(companyName: string, mainProblem: string) {
  return {
    title: "Vaeroex Operations Audit",
    generated_by: "Vaeroex",
    business_summary: `${companyName} needs a clear operating system for repeatable work, ownership, and manager review.`,
    current_operational_problems: [mainProblem || "Operational priorities need to be clarified during setup."],
    main_bottlenecks: ["Unclear ownership", "Missed follow-ups", "No weekly manager review cadence"],
    accountability_gaps: ["Tasks need assigned owners, due dates, and completion standards."],
    recommended_systems_to_build: ["Forms", "Checklists", "SOPs", "Task owner review", "Weekly operations report"],
    suggested_dashboard_metrics: ["Open tasks", "Overdue tasks", "Open issues", "Assets needing attention"],
    thirty_day_action_plan: [
      "Week 1: Finalize forms and checklists.",
      "Week 2: Assign owners and run checklist reviews.",
      "Week 3: Convert repeated issues into SOP drafts.",
      "Week 4: Generate weekly operations report and refine next actions."
    ]
  };
}

export async function generateWorkspaceFromSetupAction(formData: FormData) {
  if (!VAEROEX_SYSTEM_PROMPT.trim()) {
    redirect("/app/setup?error=Vaeroex%20prompt%20is%20not%20configured.");
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect("/app/setup?error=Supabase%20is%20not%20configured.");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const subscription = await getSubscriptionStatus({
    supabase,
    userId: user.id,
    email: user.email
  });

  if (!subscription.allowed) {
    redirect(`/billing-required?reason=${encodeURIComponent(subscription.reason)}`);
  }

  const workspaceLimit = await isUsageLimitReached({
    supabase,
    userId: user.id,
    email: user.email,
    limit: "workspaces"
  });

  if (workspaceLimit.reached) {
    redirect("/billing-required?reason=You%E2%80%99ve%20reached%20the%20limit%20for%20your%20current%20Vaeroex%20Ops%20System%20plan.");
  }

  const businessName = value(formData, "business_name");
  const templateId = value(formData, "template_id");
  const industry = value(formData, "industry");
  const teamSize = value(formData, "team_size");
  const locations = value(formData, "locations");
  const mainProblem = value(formData, "main_problem");
  const currentTools = value(formData, "current_tools");
  const missedOften = value(formData, "missed_often");
  const managedItems = value(formData, "managed_items");
  const desiredSystems = value(formData, "desired_systems");

  const template =
    industryTemplates.find((item) => item.id === templateId) ??
    industryTemplates.find((item) => item.name === industry) ??
    industryTemplates[0];

  if (
    !businessName ||
    !template ||
    !teamSize ||
    !locations ||
    !mainProblem ||
    !missedOften ||
    !managedItems ||
    !desiredSystems
  ) {
    redirect("/app/setup?error=Complete%20all%20setup%20steps%20before%20generating%20the%20workspace.");
  }

  await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email ?? null,
    full_name: user.user_metadata?.full_name ?? user.email ?? "Workspace Owner"
  });

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert({
      name: businessName,
      industry: template.name,
      size: teamSize,
      primary_contact_name: user.user_metadata?.full_name ?? null,
      primary_contact_email: user.email ?? null,
      created_by: user.id,
      subscription_status: subscription.status === "missing" ? "manual_review" : subscription.status,
      plan_slug: subscription.plan_slug,
      subscription_required: true,
      manually_unlocked: subscription.source === "manual"
    })
    .select("*")
    .single();

  if (workspaceError || !workspace) {
    redirect(`/app/setup?error=${encodeURIComponent(workspaceError?.message || "Workspace could not be created.")}`);
  }

  const workspaceId = workspace.id;

  const { error: memberError } = await supabase.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    role: "owner",
    status: "active"
  });

  if (memberError) {
    redirect(`/app/setup?error=${encodeURIComponent(memberError.message)}`);
  }

  const auditSummary = buildVaeroexAuditSummary(businessName, mainProblem);

  const operations = [
    supabase.from("business_intakes").insert({
      workspace_id: workspaceId,
      company_name: businessName,
      industry: template.name,
      team_size: teamSize,
      locations,
      current_tools: currentTools,
      biggest_operational_problems: mainProblem,
      repeated_missed_tasks: missedOften,
      customer_followup_process: desiredSystems.includes("follow-up") ? "Needs follow-up system" : null,
      employee_accountability_process: managedItems,
      reporting_process: desiredSystems,
      equipment_or_asset_process: managedItems.includes("equipment") || managedItems.includes("vehicles") ? managedItems : null,
      ideal_outcome: desiredSystems,
      raw_answers_json: {
        businessName,
        templateId: template.id,
        locations,
        currentTools,
        missedOften,
        managedItems,
        desiredSystems,
        complianceNotice: template.complianceNotice || null
      } satisfies Json,
      ai_summary: auditSummary.business_summary,
      ai_recommendations: auditSummary.recommended_systems_to_build.join("\n"),
      created_by: user.id
    }),
    supabase.from("forms").insert(
      template.forms.map((name, index) => ({
        workspace_id: workspaceId,
        name,
        description: `${name} generated from the ${template.name} starter template.`,
        form_type: index === 0 ? "intake" : index === 1 ? "completion" : "follow-up",
        schema_json: fieldSchemaFor(name),
        is_public: index === 0,
        public_slug: index === 0 ? `${slugify(businessName)}-${slugify(name)}` : null,
        created_by: user.id
      }))
    ),
    supabase.from("checklists").insert(
      template.checklists.map((name, index) => ({
        workspace_id: workspaceId,
        name,
        description: `${name} generated from the ${template.name} starter template.`,
        category: index === 2 ? "Manager review" : "Operations",
        frequency: index === 0 ? "Daily" : index === 1 ? "Per job" : "Weekly",
        items_json: checklistItemsFor(name),
        assigned_role: index === 1 ? "Staff" : "Manager",
        created_by: user.id
      }))
    ),
    supabase.from("workflow_maps").insert(
      template.workflows.map((name) => ({
        workspace_id: workspaceId,
        name,
        description: `${name} starter workflow generated during setup.`,
        department: "Operations",
        trigger_event: "New request or operational event",
        steps_json: workflowStepsFor(name),
        owner_role: "Manager",
        status: "draft",
        created_by: user.id
      }))
    ),
    supabase.from("sops").insert(
      template.workflows.map((name) => ({
        workspace_id: workspaceId,
        title: `${name} SOP`,
        department: "Operations",
        category: "Starter SOP",
        body_markdown: sopBody(`${name} SOP`),
        status: "Draft",
        version: 1,
        created_by: user.id,
        ai_generated: false
      }))
    ),
    supabase.from("issues").insert(
      [
        "Missed follow-up",
        "Equipment problem",
        "Staffing issue",
        "Communication issue",
        "Process breakdown"
      ].map((issueType) => ({
        workspace_id: workspaceId,
        title: issueType,
        description: `${issueType} category created during setup for manager review.`,
        issue_type: issueType,
        severity: issueType === "Missed follow-up" ? "High" : "Medium",
        status: "Open",
        root_cause: "Starter category; confirm with real workspace activity.",
        recommended_fix: "Assign owner, due date, and review cadence.",
        created_by: user.id
      }))
    ),
    supabase.from("tasks").insert(
      [
        ["Customize starter forms", "Review generated forms and adjust required fields.", "High"],
        ["Assign checklist owners", "Choose who completes each checklist and how often.", "High"],
        ["Review issue categories", "Confirm the first issue categories match your business.", "Medium"],
        ["Review SOP drafts", "Turn starter SOPs into active operating procedures.", "Medium"],
        ["Run Vaeroex audit", "Ask Vaeroex to review real workspace data after setup.", "Medium"]
      ].map(([title, description, priority]) => ({
        workspace_id: workspaceId,
        title,
        description,
        status: "To Do",
        priority,
        category: "Setup",
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        ai_generated: false,
        created_by: user.id
      }))
    ),
    supabase.from("assets").insert(
      (template.assetExamples || ["Operations asset", "Manager device", "Supply bin", "Vehicle", "Checklist station"])
        .slice(0, 5)
        .map((assetName, index) => ({
          workspace_id: workspaceId,
          asset_name: assetName,
          asset_type: index === 0 ? "Primary asset" : "Operations asset",
          identifier: `ASSET-${String(index + 1).padStart(3, "0")}`,
          location: "Main location",
          status: index === 1 ? "Needs review" : "Ready",
          last_checked_at: new Date().toISOString(),
          notes: "Starter asset generated during workspace setup."
        }))
    ),
    supabase.from("reports").insert({
      workspace_id: workspaceId,
      report_type: "Weekly Operations Report",
      title: "Weekly Operations Report - Generated by Vaeroex",
      date_range_start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      date_range_end: new Date().toISOString().slice(0, 10),
      body_markdown: `# Weekly Operations Report\n\nGenerated by Vaeroex.\n\n## Executive Summary\n${auditSummary.business_summary}\n\n## Recommended Next Actions\n- Customize starter forms.\n- Assign checklist owners.\n- Review issue categories.\n- Run Vaeroex audit after real data is added.`,
      source_data_json: { generatedFrom: "setup", template: template.name } satisfies Json,
      created_by: user.id
    }),
    supabase.from("ai_agent_runs").insert({
      workspace_id: workspaceId,
      agent_type: "operations_audit",
      input_json: {
        setup: true,
        businessName,
        template: template.name,
        mainProblem,
        currentTools,
        missedOften
      } satisfies Json,
      output_json: auditSummary satisfies Json,
      status: "completed",
      created_by: user.id
    })
  ];

  const results = await Promise.all(operations);
  const failed = results.find((result) => result.error);

  if (failed?.error) {
    redirect(`/app/setup?error=${encodeURIComponent(failed.error.message)}`);
  }

  redirect("/app");
}
