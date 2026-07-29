"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminActionReturnPath, withAdminActionNotice } from "@/lib/admin/action-redirect";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { normalizePlanSlug, VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
import { logSecurityAuditEvent } from "@/lib/security/tool-execution-gateway";
import type { Json } from "@/lib/supabase/types";

const assignableSubscriptionStatuses = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "canceled",
  "expired",
  "manual_review"
]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

type ManualActivationReviewResult = {
  request_id?: string;
  request_status?: string;
  subscription_id?: string | null;
  workspace_id?: string | null;
  access_granted?: boolean;
};

async function requireSubscriptionAdmin(returnTo: string) {
  const { admin, user } = await requireVaeroexAdmin(returnTo);
  return { admin, user };
}

export async function createManualSubscriptionAction(formData: FormData) {
  const returnTo = getAdminActionReturnPath(formData, "/app/admin/subscriptions");
  const { admin, user } = await requireSubscriptionAdmin(returnTo);
  const email = text(formData, "customer_email").toLowerCase();
  const planSlug = normalizePlanSlug(text(formData, "plan_slug")) || VAEROEX_PLAN_SLUG;
  const status = text(formData, "status") || "active";
  const workspaceId = text(formData, "workspace_id") || null;

  if (!email) {
    redirect(withAdminActionNotice(returnTo, "error", "Customer email is required."));
  }

  if (!assignableSubscriptionStatuses.has(status)) {
    redirect(withAdminActionNotice(returnTo, "error", "Subscription status cannot be assigned."));
  }

  const { data: profile } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  const { data: existing } = await admin
    .from("customer_subscriptions")
    .select("id,workspace_id")
    .eq("customer_email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const effectiveWorkspaceId = workspaceId ?? existing?.workspace_id ?? null;

  const payload = {
    user_id: profile?.id ?? null,
    workspace_id: effectiveWorkspaceId,
    customer_email: email,
    customer_name: text(formData, "customer_name"),
    source: "manual",
    billing_provider: "manual",
    plan_slug: planSlug,
    status,
    raw_payload_json: { manual: true } satisfies Json,
    manually_activated: true,
    manually_activated_by: user.id,
    notes: text(formData, "notes")
  };

  const result = existing
    ? await admin.from("customer_subscriptions").update(payload).eq("id", existing.id)
    : await admin.from("customer_subscriptions").insert(payload);

  if (result.error) {
    redirect(withAdminActionNotice(returnTo, "error", result.error.message));
  }

  if (effectiveWorkspaceId) {
    await admin
      .from("workspaces")
      .update({
        subscription_status: status,
        plan_slug: planSlug,
        manually_unlocked: ["active", "trialing"].includes(status)
      })
      .eq("id", effectiveWorkspaceId);
  }

  await logSecurityAuditEvent({
    supabase: admin,
    workspaceId: effectiveWorkspaceId,
    userId: user.id,
    actionName: existing ? "admin.update_manual_subscription" : "admin.create_manual_subscription",
    operationType: "BILLING",
    targetTable: "customer_subscriptions",
    targetRecordId: existing?.id ?? null,
    initiatedBy: "user",
    requiredConfirmation: true,
    confirmationReceived: true,
    allowed: true,
    metadata: {
      source: "admin_subscription_action",
      customer_email: email,
      status,
      plan_slug: planSlug
    } satisfies Json
  });

  revalidatePath("/app/admin/subscriptions");
  revalidatePath("/app/admin/customers");
  if (effectiveWorkspaceId) revalidatePath(`/app/admin/customers/${effectiveWorkspaceId}`);
  redirect(withAdminActionNotice(returnTo, "message", "Manual activation saved."));
}

export async function updateSubscriptionAction(formData: FormData) {
  const returnTo = getAdminActionReturnPath(formData, "/app/admin/subscriptions");
  const { admin, user } = await requireSubscriptionAdmin(returnTo);
  const id = text(formData, "subscription_id");
  const status = text(formData, "status") || "manual_review";
  const planSlug = normalizePlanSlug(text(formData, "plan_slug")) || VAEROEX_PLAN_SLUG;

  if (!id) {
    redirect(withAdminActionNotice(returnTo, "error", "Subscription is required."));
  }

  if (!assignableSubscriptionStatuses.has(status)) {
    redirect(withAdminActionNotice(returnTo, "error", "Subscription status cannot be assigned."));
  }

  const { data: existing } = await admin
    .from("customer_subscriptions")
    .select("workspace_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await admin
    .from("customer_subscriptions")
    .update({
      status,
      plan_slug: planSlug,
      notes: text(formData, "notes")
    })
    .eq("id", id);

  if (error) {
    redirect(withAdminActionNotice(returnTo, "error", error.message));
  }

  if (existing?.workspace_id) {
    await admin
      .from("workspaces")
      .update({
        subscription_status: status,
        plan_slug: planSlug,
        manually_unlocked: ["active", "trialing"].includes(status)
      })
      .eq("id", existing.workspace_id);
  }

  await logSecurityAuditEvent({
    supabase: admin,
    workspaceId: existing?.workspace_id ?? null,
    userId: user.id,
    actionName: "admin.update_subscription",
    operationType: "BILLING",
    targetTable: "customer_subscriptions",
    targetRecordId: id,
    initiatedBy: "user",
    requiredConfirmation: true,
    confirmationReceived: true,
    allowed: true,
    metadata: {
      source: "admin_subscription_action",
      status,
      plan_slug: planSlug
    } satisfies Json
  });

  revalidatePath("/app/admin/subscriptions");
  revalidatePath("/app/admin/customers");
  if (existing?.workspace_id) revalidatePath(`/app/admin/customers/${existing.workspace_id}`);
  redirect(withAdminActionNotice(returnTo, "message", "Subscription updated."));
}

export async function reviewActivationRequestAction(formData: FormData) {
  const returnTo = getAdminActionReturnPath(formData, "/app/admin/subscriptions");
  const { admin, user } = await requireSubscriptionAdmin(returnTo);
  const requestId = text(formData, "request_id");
  const status = text(formData, "status") || "needs_more_info";
  const allowedStatuses = new Set(["pending", "approved", "denied", "needs_more_info"]);

  if (!requestId || !allowedStatuses.has(status)) {
    redirect(withAdminActionNotice(returnTo, "error", "Activation request review is invalid."));
  }

  const { data, error } = await admin.rpc("review_manual_activation_request", {
    p_request_id: requestId,
    p_status: status,
    p_reviewed_by: user.id,
    p_plan_slug: VAEROEX_PLAN_SLUG
  });

  if (error) {
    redirect(withAdminActionNotice(returnTo, "error", error.message));
  }

  const result = (data && typeof data === "object" && !Array.isArray(data)
    ? data
    : {}) as ManualActivationReviewResult;

  if (status === "approved" && (!result.access_granted || !result.subscription_id)) {
    redirect(withAdminActionNotice(returnTo, "error", "Activation approval did not create an active entitlement."));
  }

  await logSecurityAuditEvent({
    supabase: admin,
    workspaceId: result.workspace_id ?? null,
    userId: user.id,
    actionName: status === "approved" ? "admin.approve_manual_activation_request" : "admin.review_manual_activation_request",
    operationType: "BILLING",
    targetTable: "manual_activation_requests",
    targetRecordId: requestId,
    initiatedBy: "user",
    requiredConfirmation: status === "approved",
    confirmationReceived: status === "approved",
    allowed: true,
    metadata: {
      source: "manual_activation_request_review",
      status,
      access_granted: result.access_granted === true
    } satisfies Json
  });

  revalidatePath("/app/admin/subscriptions");
  revalidatePath("/app/admin/customers");
  if (result.workspace_id) revalidatePath(`/app/admin/customers/${result.workspace_id}`);
  revalidatePath("/app/account/subscription");
  revalidatePath("/app/setup");
  revalidatePath("/billing-required");
  redirect(withAdminActionNotice(
    returnTo,
    "message",
    status === "approved"
      ? "Activation request approved and access granted."
      : "Activation request updated."
  ));
}
