"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { normalizePlanSlug, VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
import type { Json } from "@/lib/supabase/types";

function text(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

async function requireSubscriptionAdmin() {
  const { admin, user } = await requireVaeroexAdmin("/app/admin/subscriptions");
  return { admin, user };
}

export async function createManualSubscriptionAction(formData: FormData) {
  const { admin, user } = await requireSubscriptionAdmin();
  const email = text(formData, "customer_email").toLowerCase();
  const planSlug = normalizePlanSlug(text(formData, "plan_slug")) || VAEROEX_PLAN_SLUG;
  const status = text(formData, "status") || "active";
  const workspaceId = text(formData, "workspace_id") || null;

  if (!email) {
    redirect("/app/admin/subscriptions?error=Customer email is required.");
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
    redirect(`/app/admin/subscriptions?error=${encodeURIComponent(result.error.message)}`);
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

  revalidatePath("/app/admin/subscriptions");
  redirect("/app/admin/subscriptions?message=Manual activation saved.");
}

export async function updateSubscriptionAction(formData: FormData) {
  const { admin } = await requireSubscriptionAdmin();
  const id = text(formData, "subscription_id");
  const status = text(formData, "status") || "manual_review";
  const planSlug = normalizePlanSlug(text(formData, "plan_slug")) || VAEROEX_PLAN_SLUG;

  if (!id) {
    redirect("/app/admin/subscriptions?error=Subscription is required.");
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
    redirect(`/app/admin/subscriptions?error=${encodeURIComponent(error.message)}`);
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

  revalidatePath("/app/admin/subscriptions");
  redirect("/app/admin/subscriptions?message=Subscription updated.");
}

export async function reviewActivationRequestAction(formData: FormData) {
  const { admin, user } = await requireSubscriptionAdmin();
  const requestId = text(formData, "request_id");
  const status = text(formData, "status") || "needs_more_info";

  const { error } = await admin
    .from("manual_activation_requests")
    .update({
      status,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", requestId);

  if (error) {
    redirect(`/app/admin/subscriptions?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/app/admin/subscriptions");
  redirect("/app/admin/subscriptions?message=Activation request updated.");
}
