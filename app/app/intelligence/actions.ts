"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";
import { isDemoWorkspaceRecord } from "@/lib/workspaces/demo-compatibility";

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
  redirectWithMessage(path, "Decision logged. Vaeroex will include it in future reviews.");
}
