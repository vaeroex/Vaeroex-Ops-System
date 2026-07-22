"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { isDemoWorkspaceRecord } from "@/lib/demo/workspace-demo";
import { legacyReportGenerationDisabled } from "@/lib/reports/generation-policy";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function returnPath(formData: FormData, fallback = "/app") {
  const value = text(formData, "return_path");
  return value.startsWith("/app") ? value : fallback;
}

function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}` as Route);
}

function redirectWithMessage(path: string, message: string): never {
  redirect(`${path}?message=${encodeURIComponent(message)}` as Route);
}

function requireTitle(path: string, title: string) {
  if (!title) {
    redirectWithError(path, "A title is required.");
  }
}

async function requireWorkspace(path: string) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirectWithError(path, "Supabase is not configured.");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const context = await getWorkspaceContext();

  if (!context.activeWorkspace) {
    redirect("/app/setup");
  }

  await requireActiveSubscription({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId: context.activeWorkspace.id
  });

  return { supabase, user, workspace: context.activeWorkspace, workspaceId: context.activeWorkspace.id };
}

function requireLiveWorkspace(path: string, workspace: { name?: string | null; subscription_status?: string | null }) {
  if (isDemoWorkspaceRecord(workspace)) {
    redirectWithMessage(path, "Demo Workspace is preview-only for Vaeroex recommendations. Copy the pattern to your real workspace before saving live work.");
  }
}

export async function createBusinessDecisionAction(formData: FormData) {
  const path = returnPath(formData);
  const { supabase, user, workspace, workspaceId } = await requireWorkspace(path);
  requireLiveWorkspace(path, workspace);
  const title = text(formData, "title");

  requireTitle(path, title);

  const { error } = await supabase.from("business_decisions").insert({
    workspace_id: workspaceId,
    title,
    reason: nullableText(formData, "reason"),
    expected_outcome: nullableText(formData, "expected_outcome"),
    related_kpi: nullableText(formData, "related_kpi"),
    owner: nullableText(formData, "owner"),
    review_date: nullableText(formData, "review_date"),
    status: text(formData, "status") || "open",
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath("/app");
  revalidatePath("/app/reports");
  redirectWithMessage(path, "Decision logged. Vaeroex will include it in future reviews.");
}

export async function dismissPrestigeRecommendationAction(formData: FormData) {
  const path = returnPath(formData);
  const { supabase, user, workspace, workspaceId } = await requireWorkspace(path);
  requireLiveWorkspace(path, workspace);
  const title = text(formData, "title");

  requireTitle(path, title);

  const { error } = await supabase.from("vaeroex_recommendation_outcomes").insert({
    workspace_id: workspaceId,
    title,
    source_type: text(formData, "source_type") || "prestige_intelligence",
    source_title: nullableText(formData, "source_title"),
    evidence: nullableText(formData, "evidence"),
    related_module: nullableText(formData, "related_module"),
    owner: nullableText(formData, "owner"),
    priority: text(formData, "priority") || "Medium",
    status: "dismissed",
    outcome_summary: nullableText(formData, "outcome_summary") || "Dismissed by user during Vaeroex review.",
    metadata_json: { dismissed_from: path } satisfies Json,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath("/app");
  redirectWithMessage(path, "Recommendation dismissed.");
}

export async function createBusinessReviewPackageAction(formData: FormData) {
  const path = returnPath(formData);
  if (legacyReportGenerationDisabled()) {
    redirectWithError(path, "Business Review Package generation is no longer available. Save completed analyses from their live views instead.");
  }
  const { supabase, user, workspace, workspaceId } = await requireWorkspace(path);
  requireLiveWorkspace(path, workspace);
  const title = text(formData, "title") || "Business Review Package";
  const body = text(formData, "body_markdown");

  requireTitle(path, title);

  const { error } = await supabase.from("reports").insert({
    workspace_id: workspaceId,
    report_type: text(formData, "report_type") || "Business Review Package",
    title,
    date_range_start: nullableText(formData, "date_range_start"),
    date_range_end: nullableText(formData, "date_range_end"),
    body_markdown: body,
    source_data_json: {
      generated_from: "operations_intelligence",
      package_type: text(formData, "package_type") || "Leadership Review"
    } satisfies Json,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath("/app/reports");
  revalidatePath("/app");
  redirectWithMessage(path, "Business Review Package saved to Reports.");
}
