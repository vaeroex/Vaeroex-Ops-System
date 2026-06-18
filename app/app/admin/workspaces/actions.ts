"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";

function text(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function bool(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

export async function updateWorkspaceAccessAction(formData: FormData) {
  const { admin } = await requireVaeroexAdmin("/app/admin/workspaces");
  const workspaceId = text(formData, "workspace_id");
  const status = text(formData, "subscription_status") || "manual_review";
  const planSlug = text(formData, "plan_slug") || null;

  if (!workspaceId) {
    redirect("/app/admin/workspaces?error=Workspace is required.");
  }

  const { error } = await admin
    .from("workspaces")
    .update({
      subscription_status: status,
      plan_slug: planSlug,
      subscription_required: bool(formData, "subscription_required"),
      manually_unlocked: bool(formData, "manually_unlocked")
    })
    .eq("id", workspaceId);

  if (error) {
    redirect(`/app/admin/workspaces?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/app/admin/workspaces");
  redirect("/app/admin/workspaces?message=Workspace access updated.");
}
