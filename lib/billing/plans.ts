import type { PlanLimits } from "@/lib/billing/types";

export const VAEROEX_PLAN_SLUG = "vaeroex";
export const VAEROEX_PLAN_NAME = "Vaeroex";
export const VAEROEX_PLAN_PRICE_LABEL = "$399/month";

export const VAEROEX_PLAN_LIMITS = {
  max_workspaces: 1,
  max_users: 10,
  max_forms: null,
  max_checklists: null,
  max_ai_runs_per_month: 1000
} satisfies PlanLimits;

export const VAEROEX_PLAN_FEATURES = [
  "Executive Dashboard",
  "CRM",
  "KPIs",
  "Reports",
  "SOPs",
  "Tasks",
  "Issues",
  "Checklists",
  "Files",
  "People",
  "Notifications",
  "Team Roles",
  "Assignments",
  "Report Scheduling",
  "Report Sharing",
  "KPI Alerts",
  "Vaeroex AI",
  "Business Health Score",
  "Business Memory",
  "Profit Leak Detector",
  "Executive Briefings",
  "Role-Based Briefings",
  "Weekly Reviews",
  "Demo Workspace",
  "Security Features",
  "Help Center",
  "Future Prestige Features"
] as const;

const legacyPlanSlugs = new Set(["starter", "growth", "pro"]);

export function normalizePlanSlug(slug?: string | null) {
  const normalized = String(slug || "").trim().toLowerCase();

  if (!normalized) return null;
  if (normalized === VAEROEX_PLAN_SLUG || legacyPlanSlugs.has(normalized)) return VAEROEX_PLAN_SLUG;

  return normalized;
}

export function displayPlanName(slug?: string | null) {
  return normalizePlanSlug(slug) === VAEROEX_PLAN_SLUG ? VAEROEX_PLAN_NAME : "No plan";
}

export function displaySubscriptionStatus(status?: string | null, source?: string | null) {
  if (source === "demo" || status === "demo") return "Demo Workspace";
  if (source === "manual") return "Manual Activation";
  if (status === "active" || status === "trialing") return "Active";
  if (status === "manual_review") return "Pending";
  if (!status || status === "missing") return "Subscription Required";

  return status.replace(/_/g, " ");
}

export function normalizePlanLimits(plan?: (PlanLimits & { slug?: string | null }) | null): PlanLimits | null {
  if (!plan) return null;
  if (normalizePlanSlug(plan.slug) === VAEROEX_PLAN_SLUG) return VAEROEX_PLAN_LIMITS;

  return plan;
}
