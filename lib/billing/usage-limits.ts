import type { SupabaseClient } from "@supabase/supabase-js";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { normalizePlanLimits } from "@/lib/billing/plans";
import type { SubscriptionAccessResult, UsageSnapshot } from "@/lib/billing/types";
import type { Database } from "@/lib/supabase/types";

function monthStart() {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

export async function getUsageSnapshot({
  supabase,
  workspaceId,
  userId
}: {
  supabase: SupabaseClient<Database>;
  workspaceId?: string | null;
  userId?: string | null;
}): Promise<UsageSnapshot> {
  const [workspaces, users, forms, checklists, aiRuns, files] = await Promise.all([
    userId
      ? supabase.from("workspace_members").select("workspace_id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "active")
      : Promise.resolve({ count: 0 }),
    workspaceId
      ? supabase.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "active")
      : Promise.resolve({ count: 0 }),
    workspaceId
      ? supabase.from("forms").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
      : Promise.resolve({ count: 0 }),
    workspaceId
      ? supabase.from("checklists").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
      : Promise.resolve({ count: 0 }),
    workspaceId
      ? supabase.from("ai_agent_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", monthStart())
      : Promise.resolve({ count: 0 }),
    workspaceId
      ? supabase.from("file_uploads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("deleted_at", null)
      : Promise.resolve({ count: 0 })
  ]);

  return {
    workspaces: workspaces.count ?? 0,
    users: users.count ?? 0,
    forms: forms.count ?? 0,
    checklists: checklists.count ?? 0,
    ai_runs_this_month: aiRuns.count ?? 0,
    files: files.count ?? 0
  };
}

export async function getSubscriptionUsageStatus({
  supabase,
  userId,
  email,
  workspaceId
}: {
  supabase: SupabaseClient<Database>;
  userId?: string | null;
  email?: string | null;
  workspaceId?: string | null;
}) {
  const [subscription, usage] = await Promise.all([
    getSubscriptionStatus({ supabase, userId, email, workspaceId }),
    getUsageSnapshot({ supabase, workspaceId, userId })
  ]);

  return { subscription, usage };
}

export async function isUsageLimitReached({
  supabase,
  userId,
  email,
  workspaceId,
  limit
}: {
  supabase: SupabaseClient<Database>;
  userId?: string | null;
  email?: string | null;
  workspaceId?: string | null;
  limit: "workspaces" | "users" | "forms" | "checklists" | "ai_runs_this_month" | "files";
}) {
  const { subscription, usage } = await getSubscriptionUsageStatus({ supabase, userId, email, workspaceId });
  const plan = normalizePlanLimits(subscription.plan);

  if (!plan) {
    return {
      reached: false,
      subscription,
      usage,
      limitValue: null
    };
  }

  const limitMap = {
    workspaces: plan.max_workspaces,
    users: plan.max_users,
    forms: plan.max_forms,
    checklists: plan.max_checklists,
    ai_runs_this_month: plan.max_ai_runs_per_month,
    files: plan.max_files ?? null
  };
  const limitValue = limitMap[limit] ?? null;

  return {
    reached: typeof limitValue === "number" && usage[limit] >= limitValue,
    subscription,
    usage,
    limitValue
  };
}

export async function isAiRunUsageLimitReached({
  supabase,
  workspaceId,
  subscription
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  subscription: SubscriptionAccessResult;
}) {
  const plan = normalizePlanLimits(subscription.plan);
  const limitValue = plan?.max_ai_runs_per_month ?? null;

  if (typeof limitValue !== "number") {
    return { reached: false, limitValue, count: 0 };
  }

  const result = await supabase
    .from("ai_agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", monthStart());
  const count = result.count ?? 0;

  return {
    reached: count >= limitValue,
    limitValue,
    count
  };
}
