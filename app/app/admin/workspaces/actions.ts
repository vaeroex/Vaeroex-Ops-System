"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { normalizePlanSlug } from "@/lib/billing/plans";
import { logSecurityAuditEvent } from "@/lib/security/tool-execution-gateway";
import type { Json } from "@/lib/supabase/types";

function text(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function bool(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

export async function updateWorkspaceAccessAction(formData: FormData) {
  const { admin, user } = await requireVaeroexAdmin("/app/admin/workspaces");
  const workspaceId = text(formData, "workspace_id");
  const status = text(formData, "subscription_status") || "manual_review";
  const planSlug = normalizePlanSlug(text(formData, "plan_slug"));

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

  await logSecurityAuditEvent({
    supabase: admin,
    workspaceId,
    userId: user.id,
    actionName: "admin.update_workspace_access",
    operationType: "ADMIN",
    targetTable: "workspaces",
    targetRecordId: workspaceId,
    initiatedBy: "user",
    requiredConfirmation: true,
    confirmationReceived: true,
    allowed: true,
    metadata: {
      source: "admin_workspace_access_action",
      subscription_status: status,
      plan_slug: planSlug,
      subscription_required: bool(formData, "subscription_required"),
      manually_unlocked: bool(formData, "manually_unlocked")
    } satisfies Json
  });

  revalidatePath("/app/admin/workspaces");
  redirect("/app/admin/workspaces?message=Workspace access updated.");
}
