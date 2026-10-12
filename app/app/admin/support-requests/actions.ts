"use server";

import { revalidatePath } from "next/cache";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { SUPPORT_UUID, validateSupportMutation, type SupportMutationResult } from "@/lib/admin/support-requests";

export async function manageSupportRequestAction(formData: FormData): Promise<SupportMutationResult> {
  const { admin, user } = await requireVaeroexAdmin("/app/admin/support-requests");
  const input = validateSupportMutation(formData);
  if (!input) return { ok: false, message: "Choose 1–50 valid requests and a supported action, then try again." };

  // The service-only RPC commits the mutation, admin.<action>_support_request
  // security event and idempotency receipt together. Source: admin_support_request_action.
  // This includes admin.update_support_request. Request bodies never enter audit metadata.
  const { data, error } = await admin.rpc("admin_manage_support_requests_v1", {
    p_actor_user_id: user.id,
    p_request_ids: input.ids,
    p_action: input.action,
    p_operation_id: input.operationId,
    p_status: input.status,
    p_priority: input.priority
  }).then((response) => response, () => ({ data: null, error: true }));
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, message: "The update result could not be confirmed. Retry the same action to safely check its outcome." };
  }
  const changedCount = Number(data.changed_count);
  const requestedCount = Number(data.requested_count);
  if (!Number.isInteger(changedCount) || !Number.isInteger(requestedCount) || changedCount < 0 || changedCount > input.ids.length || requestedCount !== input.ids.length) {
    return { ok: false, message: "The update result could not be verified. Refresh the inbox before continuing." };
  }
  revalidatePath("/app/admin/support-requests");
  const verb = { archive: "archived", delete: "moved to Deleted", restore: "restored", update: "updated" }[input.action] || "updated";
  const unchanged = requestedCount - changedCount;
  const replayed = data.replayed === true;
  return {
    ok: true, changedCount, requestedCount, replayed,
    message: `${replayed ? "Previously completed: " : ""}${changedCount} ${changedCount === 1 ? "request" : "requests"} ${verb}.${unchanged ? ` ${unchanged} unchanged or no longer available.` : ""}`
  };
}

export async function updateSupportRequestAction(formData: FormData): Promise<SupportMutationResult> {
  formData.set("support_action", "update");
  return manageSupportRequestAction(formData);
}

export async function getSupportRequestContentAction(id: string): Promise<{ message: string | null; error: string | null }> {
  const { admin } = await requireVaeroexAdmin("/app/admin/support-requests");
  if (typeof id !== "string" || !SUPPORT_UUID.test(id)) return { message: null, error: "Support request is unavailable." };
  const { data, error } = await admin.from("support_requests").select("message").eq("id", id).maybeSingle().then((response) => response, () => ({ data: null, error: true }));
  if (error || !data) return { message: null, error: "Support request is unavailable. Refresh and try again." };
  return { message: data.message, error: null };
}
