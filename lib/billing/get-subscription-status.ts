import type { SupabaseClient } from "@supabase/supabase-js";
import { isVaeroexAdminEmail } from "@/lib/admin/admin-emails";
import type { SubscriptionAccessResult, SubscriptionStatus } from "@/lib/billing/types";
import type { Database } from "@/lib/supabase/types";

type SubscriptionPlan = Database["public"]["Tables"]["subscription_plans"]["Row"];
type SubscriptionRow = Database["public"]["Tables"]["customer_subscriptions"]["Row"] & {
  subscription_plans?: SubscriptionPlan | SubscriptionPlan[] | null;
};

function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
}

function isWorkspaceAllowed(workspace?: {
  subscription_status?: string | null;
  subscription_required?: boolean | null;
  manually_unlocked?: boolean | null;
  trial_ends_at?: string | null;
  plan_slug?: string | null;
} | null) {
  if (!workspace) {
    return null;
  }

  if (workspace.subscription_required === false) {
    return { allowed: true, source: "manual" as const, reason: "Subscription is not required for this workspace." };
  }

  if (workspace.manually_unlocked) {
    return { allowed: true, source: "manual" as const, reason: "Workspace manually unlocked." };
  }

  if (workspace.subscription_status === "demo") {
    return { allowed: true, source: "demo" as const, reason: "Demo workspace access allowed." };
  }

  if (workspace.subscription_status === "active") {
    return { allowed: true, source: "workspace" as const, reason: "Workspace subscription active." };
  }

  if (workspace.subscription_status === "trialing" && workspace.trial_ends_at && new Date(workspace.trial_ends_at) > new Date()) {
    return { allowed: true, source: "trial" as const, reason: "Workspace trial active." };
  }

  return null;
}

function getSubscriptionPlan(subscription?: SubscriptionRow | null) {
  const plan = subscription?.subscription_plans;

  return Array.isArray(plan) ? (plan[0] ?? null) : (plan ?? null);
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
      plan_slug: null,
      plan: null,
      source: "admin"
    };
  }

  const [{ data: workspace }, { data: subscriptions }] = await Promise.all([
    workspaceId
      ? supabase
          .from("workspaces")
          .select("id,subscription_status,subscription_required,manually_unlocked,trial_ends_at,plan_slug")
          .eq("id", workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    userId || normalizedEmail
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
      : Promise.resolve({ data: [] })
  ]);

  const subscriptionRows = (subscriptions ?? []) as SubscriptionRow[];
  const workspaceAccess = isWorkspaceAllowed(workspace);

  if (workspaceAccess) {
    const plan = getSubscriptionPlan(subscriptionRows.find((subscription) => subscription.plan_slug === workspace?.plan_slug));
    return {
      allowed: true,
      reason: workspaceAccess.reason,
      status: (workspace?.subscription_status as SubscriptionStatus) || "active",
      plan_slug: workspace?.plan_slug ?? null,
      plan,
      source: workspaceAccess.source
    };
  }

  const activeSubscription = subscriptionRows.find((subscription) => {
    const status = subscription.status as SubscriptionStatus;
    const periodValid = !subscription.current_period_end || new Date(subscription.current_period_end) > new Date();
    const activeOrTrialing = ["active", "trialing"].includes(status) && periodValid;
    const manualActivation = subscription.manually_activated && ["active", "trialing"].includes(status);

    return (
      status === "demo" ||
      activeOrTrialing ||
      manualActivation
    );
  });

  if (activeSubscription) {
    return {
      allowed: true,
      reason: activeSubscription.manually_activated
        ? "Manual activation found."
        : activeSubscription.status === "demo"
          ? "Demo access found."
          : "Active Vaeroex subscription found.",
      status: activeSubscription.status as SubscriptionStatus,
      plan_slug: activeSubscription.plan_slug,
      plan: getSubscriptionPlan(activeSubscription),
      source: activeSubscription.manually_activated
        ? "manual"
        : activeSubscription.status === "demo"
          ? "demo"
          : "subscription"
    };
  }

  const latest = subscriptionRows[0];
  return {
    allowed: false,
    reason: latest
      ? `Subscription status is ${latest.status}.`
      : "No active Vaeroex subscription was found for this account.",
    status: (latest?.status as SubscriptionStatus) || "missing",
    plan_slug: latest?.plan_slug ?? workspace?.plan_slug ?? null,
    plan: getSubscriptionPlan(latest),
    source: "missing"
  };
}
