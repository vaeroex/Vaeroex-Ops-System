import type { SupabaseClient } from "@supabase/supabase-js";
import { isVaeroexAdminEmail } from "@/lib/admin/admin-emails";
import type { SubscriptionAccessResult, SubscriptionStatus } from "@/lib/billing/types";
import type { Database } from "@/lib/supabase/types";

type SubscriptionPlan = Database["public"]["Tables"]["subscription_plans"]["Row"];
type SubscriptionRow = Database["public"]["Tables"]["customer_subscriptions"]["Row"] & {
  subscription_plans?: SubscriptionPlan | SubscriptionPlan[] | null;
};

type WorkspaceBillingState = {
  id: string;
  subscription_status?: string | null;
  subscription_required?: boolean | null;
  manually_unlocked?: boolean | null;
  trial_ends_at?: string | null;
  plan_slug?: string | null;
};

function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
}

function validFutureTimestamp(value?: string | null, now = new Date()) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

export function isStripeSubscriptionEntitled(subscription: SubscriptionRow, now = new Date()) {
  return (
    subscription.billing_provider === "stripe" &&
    !subscription.manually_activated &&
    ["active", "trialing"].includes(subscription.status) &&
    validFutureTimestamp(subscription.current_period_end, now) &&
    Boolean(subscription.stripe_customer_id && subscription.stripe_subscription_id)
  );
}

function isManualSubscriptionEntitled(subscription: SubscriptionRow) {
  return (
    subscription.billing_provider === "manual" &&
    subscription.manually_activated &&
    ["active", "trialing"].includes(subscription.status)
  );
}

function getSubscriptionPlan(subscription?: SubscriptionRow | null) {
  const plan = subscription?.subscription_plans;
  return Array.isArray(plan) ? (plan[0] ?? null) : (plan ?? null);
}

function allowedResult({
  subscription,
  reason,
  source,
  workspace
}: {
  subscription?: SubscriptionRow | null;
  reason: string;
  source: SubscriptionAccessResult["source"];
  workspace?: WorkspaceBillingState | null;
}): SubscriptionAccessResult {
  return {
    allowed: true,
    reason,
    status: (subscription?.status as SubscriptionStatus) || (workspace?.subscription_status as SubscriptionStatus) || "active",
    subscription_id: subscription?.id ?? null,
    plan_slug: subscription?.plan_slug ?? workspace?.plan_slug ?? null,
    plan: getSubscriptionPlan(subscription),
    billing_provider: subscription?.billing_provider ?? null,
    stripe_customer_id: subscription?.stripe_customer_id ?? null,
    source
  };
}

function deniedResult({
  subscription,
  workspace,
  reason
}: {
  subscription?: SubscriptionRow | null;
  workspace?: WorkspaceBillingState | null;
  reason?: string;
}): SubscriptionAccessResult {
  return {
    allowed: false,
    reason: reason || (subscription
      ? `Subscription status is ${subscription.status}.`
      : "No active Vaeroex subscription was found for this account."),
    status: (subscription?.status as SubscriptionStatus) || (workspace?.subscription_status as SubscriptionStatus) || "missing",
    subscription_id: subscription?.id ?? null,
    plan_slug: subscription?.plan_slug ?? workspace?.plan_slug ?? null,
    plan: getSubscriptionPlan(subscription),
    billing_provider: subscription?.billing_provider ?? null,
    stripe_customer_id: subscription?.stripe_customer_id ?? null,
    source: "missing"
  };
}

export async function getSubscriptionStatus({
  supabase,
  userId,
  email,
  workspaceId
}: {
  supabase: SupabaseClient<Database>;
  userId?: string | null;
  email?: string | null;
  workspaceId?: string | null;
}): Promise<SubscriptionAccessResult> {
  const normalizedEmail = normalizeEmail(email);

  if (isVaeroexAdminEmail(normalizedEmail)) {
    return {
      allowed: true,
      reason: "Vaeroex admin account bypassed the subscription check.",
      status: "manual_review",
      subscription_id: null,
      plan_slug: null,
      plan: null,
      billing_provider: null,
      stripe_customer_id: null,
      source: "admin"
    };
  }

  const [workspaceResult, subscriptionsResult] = await Promise.all([
    workspaceId
      ? supabase
          .from("workspaces")
          .select("id,subscription_status,subscription_required,manually_unlocked,trial_ends_at,plan_slug")
          .eq("id", workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    userId || normalizedEmail || workspaceId
      ? supabase
          .from("customer_subscriptions")
          .select("*, subscription_plans(*)")
          .or(
            [
              userId ? `user_id.eq.${userId}` : "",
              normalizedEmail ? `customer_email.ilike.${normalizedEmail}` : "",
              workspaceId ? `workspace_id.eq.${workspaceId}` : ""
            ]
              .filter(Boolean)
              .join(",")
          )
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null })
  ]);

  if (workspaceResult.error || subscriptionsResult.error) {
    return deniedResult({ reason: "Subscription verification is temporarily unavailable." });
  }

  const workspace = workspaceResult.data as WorkspaceBillingState | null;
  const subscriptionRows = (subscriptionsResult.data ?? []) as SubscriptionRow[];

  if (workspace) {
    const linked = subscriptionRows.filter((subscription) => subscription.workspace_id === workspace.id);
    const linkedStripe = linked.find((subscription) => subscription.billing_provider === "stripe");
    const linkedManual = linked.find(isManualSubscriptionEntitled);

    if (linkedStripe) {
      return isStripeSubscriptionEntitled(linkedStripe)
        ? allowedResult({ subscription: linkedStripe, workspace, source: "subscription", reason: "Active Stripe subscription found." })
        : deniedResult({ subscription: linkedStripe, workspace });
    }

    if (workspace.subscription_required === false) {
      return allowedResult({ workspace, source: "manual", reason: "Subscription is not required for this workspace." });
    }

    if (workspace.manually_unlocked && linkedManual) {
      return allowedResult({ subscription: linkedManual, workspace, source: "manual", reason: "Manual activation found." });
    }

    if (workspace.subscription_status === "demo") {
      return allowedResult({ workspace, source: "demo", reason: "Demo workspace access allowed." });
    }

    if (workspace.subscription_status === "trialing" && validFutureTimestamp(workspace.trial_ends_at)) {
      return allowedResult({ workspace, source: "trial", reason: "Workspace trial active." });
    }

    return deniedResult({
      workspace,
      subscription: linked[0],
      reason: linked.length
        ? undefined
        : "This workspace is not linked to an authoritative paid entitlement."
    });
  }

  const active = subscriptionRows.find((subscription) =>
    isStripeSubscriptionEntitled(subscription) ||
    isManualSubscriptionEntitled(subscription) ||
    subscription.status === "demo"
  );

  if (active) {
    return allowedResult({
      subscription: active,
      source: isManualSubscriptionEntitled(active) ? "manual" : active.status === "demo" ? "demo" : "subscription",
      reason: isManualSubscriptionEntitled(active)
        ? "Manual activation found."
        : active.status === "demo"
          ? "Demo access found."
          : "Active Stripe subscription found."
    });
  }

  return deniedResult({ subscription: subscriptionRows[0] });
}
