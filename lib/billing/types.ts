import type { Json } from "@/lib/supabase/types";

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "expired" | "manual_review" | "demo";

export type PlanSlug = "vaeroex";

export type PlanLimits = {
  max_workspaces: number | null;
  max_users: number | null;
  max_forms: number | null;
  max_checklists: number | null;
  max_ai_runs_per_month: number | null;
};

export type SubscriptionAccessResult = {
  allowed: boolean;
  reason: string;
  status: SubscriptionStatus | "missing";
  plan_slug: string | null;
  plan: (PlanLimits & {
    name: string;
    slug: string;
    features_json: Json;
  }) | null;
  source: "subscription" | "workspace" | "demo" | "manual" | "trial" | "admin" | "missing";
};

export type UsageSnapshot = {
  workspaces: number;
  users: number;
  forms: number;
  checklists: number;
  ai_runs_this_month: number;
};
