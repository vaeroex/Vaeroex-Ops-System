"use server";

import { redirect } from "next/navigation";
import { workspaceSetupCategories } from "@/data/workspace-categories";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { normalizePlanSlug, VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
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
    { label: "Business details", type: "long_text", required: true },
    { label: "Priority", type: "priority", required: true },
    { label: "Review context", type: "long_text", required: false },
    { label: "Manager notes", type: "long_text", required: false }
  ].map((field) => ({
    ...field,
    key: slugify(`${formName}-${field.label}`)
  })) as Json;
}

function checklistItemsFor(name: string): Json {
  return [
    `Confirm how ${name.toLowerCase()} is reviewed`,
    "Review open signals or blockers",
    "Log missed or failed items",
    "Document evidence when needed",
    "Submit for leadership review"
  ] as Json;
}

function workflowStepsFor(name: string): Json {
  return [
    { order: 1, title: "Trigger", description: `Identify when ${name.toLowerCase()} starts.` },
    { order: 2, title: "Capture evidence", description: "Record the signals, source data, and context leadership should review." },
    { order: 3, title: "Review pattern", description: "Compare required fields, checklist items, and blockers." },
    { order: 4, title: "Leadership review", description: "Review exceptions and decide whether a supporting document is needed." }
  ] as Json;
}

function sopBody(title: string) {
  return `# ${title}

## Purpose
Create a repeatable process with clear evidence, required information, and review points.

## When to Use This SOP
Use this draft when the related workflow starts or when a bottleneck is reported.

## Leadership Review
Define when this process should be reviewed and what evidence should be considered.

## Step-by-Step Process
1. Capture the request or issue.
2. Capture source context and evidence.
3. Complete the checklist or workflow steps.
4. Log blockers, missed items, or unresolved signals.
5. Submit for leadership review.

## Quality Checks
- Required fields are complete.
- Supporting evidence exists when needed.
- Leadership review is logged.

## Escalation Rules
Escalate when repeated signals show the process is not producing the expected outcome.

## Completion Standard
The process is complete when the outcome is documented and leadership can review the evidence.`;
}

function buildVaeroexAuditSummary(companyName: string, mainProblem: string, organizationDescription: string, environmentName: string) {
  return {
    title: "Vaeroex Operations Intelligence Review",
    generated_by: "Vaeroex",
    business_summary: `${companyName} is configured as a ${environmentName} environment. ${
      organizationDescription || "The organization"
    } needs clearer business evidence, context, and leadership review rhythms for repeatable growth.`,
    current_operational_problems: [mainProblem || "Visibility and review priorities need to be clarified during setup."],
    main_bottlenecks: ["Limited visibility", "Missing source evidence", "No weekly leadership review cadence"],
    accountability_gaps: ["Source evidence needs context and clear review standards."],
    recommended_systems_to_build: ["Evidence sources", "KPI context", "Executive review cadence", "Weekly intelligence review"],
    suggested_dashboard_metrics: ["Evidence readiness", "Source coverage", "Open risks", "Assets needing attention"],
    thirty_day_action_plan: [
      "Week 1: Upload the first source evidence.",
      "Week 2: Review evidence and KPI patterns.",
      "Week 3: Summarize repeated issues for leadership.",
      "Week 4: Generate a weekly intelligence report and refine review priorities."
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
    redirect("/billing-required?reason=You%E2%80%99ve%20reached%20the%20limit%20for%20your%20current%20Vaeroex%20plan.");
  }

  const businessName = value(formData, "business_name");
  const categoryId = value(formData, "category_id") || value(formData, "template_id");
  const organizationType = value(formData, "organization_type") || value(formData, "industry");
  const teamSize = value(formData, "team_size");
  const locations = value(formData, "locations");
  const organizationDescription = value(formData, "organization_description");
  const mainProblem = value(formData, "main_problem");
  const currentTools = value(formData, "current_tools");
  const missedOften = value(formData, "missed_often");
  const managedItems = value(formData, "managed_items");
  const desiredSystems = value(formData, "desired_systems");

  const category =
    workspaceSetupCategories.find((item) => item.id === categoryId) ??
    workspaceSetupCategories.find((item) => item.name === organizationType) ??
    workspaceSetupCategories[0];

  if (
    !businessName ||
    !category ||
    !teamSize ||
    !locations ||
    !organizationDescription ||
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
      industry: category.name,
      size: teamSize,
      primary_contact_name: user.user_metadata?.full_name ?? null,
      primary_contact_email: user.email ?? null,
      created_by: user.id,
      subscription_status: subscription.status === "missing" ? "manual_review" : subscription.status,
      plan_slug: normalizePlanSlug(subscription.plan_slug) || VAEROEX_PLAN_SLUG,
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

  const auditSummary = buildVaeroexAuditSummary(businessName, mainProblem, organizationDescription, category.name);

  const operations = [
    supabase.from("business_intakes").insert({
      workspace_id: workspaceId,
      company_name: businessName,
      industry: category.name,
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
        categoryId: category.id,
        organizationType: category.name,
        organizationDescription,
        locations,
        currentTools,
        missedOften,
        managedItems,
        desiredSystems,
        complianceNotice: category.complianceNotice || null
      } satisfies Json,
      ai_summary: auditSummary.business_summary,
      ai_recommendations: auditSummary.recommended_systems_to_build.join("\n"),
      created_by: user.id
    }),
    supabase.from("forms").insert(
      category.forms.map((name, index) => ({
        workspace_id: workspaceId,
        name,
        description: `${name} generated from the ${category.name} operational environment.`,
        form_type: index === 0 ? "intake" : index === 1 ? "completion" : "follow-up",
        schema_json: fieldSchemaFor(name),
        is_public: index === 0,
        public_slug: index === 0 ? `${slugify(businessName)}-${slugify(name)}` : null,
        created_by: user.id
      }))
    ),
    supabase.from("checklists").insert(
      category.checklists.map((name, index) => ({
        workspace_id: workspaceId,
        name,
        description: `${name} generated from the ${category.name} operational environment.`,
        category: index === 2 ? "Manager review" : "Execution",
        frequency: index === 0 ? "Daily" : index === 1 ? "Per job" : "Weekly",
        items_json: checklistItemsFor(name),
        assigned_role: index === 1 ? "Staff" : "Manager",
        created_by: user.id
      }))
    ),
    supabase.from("workflow_maps").insert(
      category.workflows.map((name) => ({
        workspace_id: workspaceId,
        name,
        description: `${name} workflow generated during setup.`,
        department: "Execution",
        trigger_event: "New request or business event",
        steps_json: workflowStepsFor(name),
        owner_role: "Manager",
        status: "draft",
        created_by: user.id
      }))
    ),
    supabase.from("sops").insert(
      category.workflows.map((name) => ({
        workspace_id: workspaceId,
        title: `${name} SOP`,
        department: "Execution",
        category: "Initial SOP",
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
        description: `${issueType} category created during setup for visibility and manager review.`,
        issue_type: issueType,
        severity: issueType === "Missed follow-up" ? "High" : "Medium",
        status: "Open",
        root_cause: "Initial category; confirm with real workspace activity.",
        recommended_fix: "Review evidence, source context, and leadership review cadence.",
        created_by: user.id
      }))
    ),
    supabase.from("assets").insert(
      (category.assetExamples || ["Tracked asset", "Manager device", "Supply bin", "Vehicle", "Checklist station"])
        .slice(0, 5)
        .map((assetName, index) => ({
          workspace_id: workspaceId,
          asset_name: assetName,
          asset_type: index === 0 ? "Primary asset" : "Tracked asset",
          identifier: `ASSET-${String(index + 1).padStart(3, "0")}`,
          location: "Main location",
          status: index === 1 ? "Needs review" : "Ready",
          last_checked_at: new Date().toISOString(),
          notes: "Initial asset generated during workspace setup."
        }))
    ),
    supabase.from("reports").insert({
      workspace_id: workspaceId,
      report_type: "Weekly Intelligence Report",
      title: "Weekly Intelligence Report - Generated by Vaeroex",
      date_range_start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      date_range_end: new Date().toISOString().slice(0, 10),
      body_markdown: `# Weekly Intelligence Report\n\nGenerated by Vaeroex.\n\n## Executive Summary\n${auditSummary.business_summary}\n\n## Executive Recommendations\n- Review initial forms.\n- Review checklist evidence.\n- Review issue categories.\n- Run Vaeroex review after real data is added.`,
      source_data_json: { generatedFrom: "setup", organizationType: category.name } satisfies Json,
      created_by: user.id
    }),
    supabase.from("ai_agent_runs").insert({
      workspace_id: workspaceId,
      agent_type: "operations_audit",
      input_json: {
        setup: true,
        businessName,
        organizationType: category.name,
        organizationDescription,
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

  redirect("/app/sources");
}
