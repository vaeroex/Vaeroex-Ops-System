"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminActionReturnPath, withAdminActionNotice } from "@/lib/admin/action-redirect";
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
  const returnTo = getAdminActionReturnPath(formData, "/app/admin/workspaces");
  const { admin, user } = await requireVaeroexAdmin(returnTo);
  const workspaceId = text(formData, "workspace_id");
  const status = text(formData, "subscription_status") || "manual_review";
  const planSlug = normalizePlanSlug(text(formData, "plan_slug"));

  if (!workspaceId) {
    redirect(withAdminActionNotice(returnTo, "error", "Workspace is required."));
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
    redirect(withAdminActionNotice(returnTo, "error", error.message));
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
  revalidatePath("/app/admin/customers");
  revalidatePath(`/app/admin/customers/${workspaceId}`);
  redirect(withAdminActionNotice(returnTo, "message", "Workspace access updated."));
}

type WorkspaceLifecycleResult = {
  workspace_id?: string;
  status?: "archived" | "restored";
  changed?: boolean;
};

export async function transitionWorkspaceLifecycleAction(formData: FormData) {
  const returnTo = getAdminActionReturnPath(formData, "/app/admin/workspaces");
  const { admin, user } = await requireVaeroexAdmin(returnTo);
  const workspaceId = text(formData, "workspace_id");
  const requestedAction = text(formData, "lifecycle_action").toLowerCase();

  if (!workspaceId || (requestedAction !== "archive" && requestedAction !== "restore")) {
    redirect(withAdminActionNotice(returnTo, "error", "Workspace lifecycle action is invalid."));
  }
  const lifecycleAction: "archive" | "restore" = requestedAction;

  const { data, error } = await admin.rpc("transition_workspace_admin_lifecycle", {
    p_workspace_id: workspaceId,
    p_actor_id: user.id,
    p_action: lifecycleAction
  });

  if (error) {
    await logSecurityAuditEvent({
      supabase: admin,
      workspaceId,
      userId: user.id,
      actionName: `admin.${lifecycleAction}_workspace`,
      operationType: "ADMIN",
      targetTable: "workspace_admin_lifecycle",
      targetRecordId: workspaceId,
      initiatedBy: "user",
      requiredConfirmation: true,
      confirmationReceived: true,
      allowed: false,
      reasonBlocked: "workspace_lifecycle_transition_rejected",
      metadata: {
        source: "admin_workspace_lifecycle_action",
        lifecycle_action: lifecycleAction
      } satisfies Json
    });
    redirect(withAdminActionNotice(returnTo, "error", error.message));
  }

  const result = (data && typeof data === "object" && !Array.isArray(data)
    ? data
    : {}) as WorkspaceLifecycleResult;

  await logSecurityAuditEvent({
    supabase: admin,
    workspaceId,
    userId: user.id,
    actionName: `admin.${lifecycleAction}_workspace`,
    operationType: "ADMIN",
    targetTable: "workspace_admin_lifecycle",
    targetRecordId: workspaceId,
    initiatedBy: "user",
    requiredConfirmation: true,
    confirmationReceived: true,
    allowed: true,
    metadata: {
      source: "admin_workspace_lifecycle_action",
      lifecycle_action: lifecycleAction,
      changed: result.changed === true,
      resulting_status: result.status || null
    } satisfies Json
  });

  revalidatePath("/app/admin");
  revalidatePath("/app/admin/customers");
  revalidatePath("/app/admin/workspaces");
  revalidatePath(`/app/admin/customers/${workspaceId}`);

  const label = lifecycleAction === "archive" ? "archived" : "restored";
  const message = result.changed === false
    ? `Workspace was already ${label}.`
    : `Workspace ${label}.`;
  redirect(withAdminActionNotice(returnTo, "message", message));
}
