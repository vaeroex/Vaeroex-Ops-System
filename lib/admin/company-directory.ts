import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export const ADMIN_COMPANY_PAGE_SIZE = 25;

export type AdminCompanyRow = Database["public"]["Views"]["admin_company_directory_v1"]["Row"];
export type AdminUnlinkedRecord = Database["public"]["Views"]["admin_unlinked_customer_records_v1"]["Row"];
export type AdminLifecycle = AdminCompanyRow["lifecycle_status"];

export type AdminCompanyFilters = {
  q: string;
  lifecycle: "current" | AdminLifecycle;
  subscription: string;
  agreement: "all" | "signed" | "missing";
  sort: "company_asc" | "company_desc" | "updated_desc" | "created_desc";
  page: number;
};

export type AdminWorkspaceView = "attention" | "pending_activation" | "inactive" | "archived" | "all";

export type AdminWorkspaceFilters = {
  q: string;
  view: AdminWorkspaceView;
  sort: AdminCompanyFilters["sort"];
  page: number;
};

const lifecycleFilters = new Set(["current", "active", "pending_activation", "inactive", "archived"]);
const subscriptionFilters = new Set([
  "all",
  "active",
  "manual_review",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "expired"
]);
const agreementFilters = new Set(["all", "signed", "missing"]);
const sortFilters = new Set(["company_asc", "company_desc", "updated_desc", "created_desc"]);
const workspaceViews = new Set(["attention", "pending_activation", "inactive", "archived", "all"]);
const accessLockedStatuses = new Set(["past_due", "unpaid", "canceled", "incomplete", "expired"]);

function boundedText(value: string | undefined, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function parsePage(value: string | undefined) {
  const page = Number.parseInt(String(value || "1"), 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

export function parseAdminCompanyFilters(params?: Record<string, string | undefined>): AdminCompanyFilters {
  const lifecycle = boundedText(params?.lifecycle, 40);
  const subscription = boundedText(params?.subscription, 40);
  const agreement = boundedText(params?.agreement, 20);
  const sort = boundedText(params?.sort, 30);

  return {
    q: boundedText(params?.q),
    lifecycle: lifecycleFilters.has(lifecycle) ? (lifecycle as AdminCompanyFilters["lifecycle"]) : "current",
    subscription: subscriptionFilters.has(subscription) ? subscription : "all",
    agreement: agreementFilters.has(agreement) ? (agreement as AdminCompanyFilters["agreement"]) : "all",
    sort: sortFilters.has(sort) ? (sort as AdminCompanyFilters["sort"]) : "company_asc",
    page: parsePage(params?.page)
  };
}

export function parseAdminWorkspaceFilters(params?: Record<string, string | undefined>): AdminWorkspaceFilters {
  const view = boundedText(params?.view, 30);
  const sort = boundedText(params?.sort, 30);

  return {
    q: boundedText(params?.q),
    view: workspaceViews.has(view) ? (view as AdminWorkspaceView) : "attention",
    sort: sortFilters.has(sort) ? (sort as AdminWorkspaceFilters["sort"]) : "updated_desc",
    page: parsePage(params?.page)
  };
}

export function quotedPostgrestValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function loadAdminCompanyPage(
  admin: SupabaseClient<Database>,
  filters: AdminCompanyFilters
) {
  let query = admin
    .from("admin_company_directory_v1")
    .select("*", { count: "exact" });

  if (filters.q) {
    const pattern = quotedPostgrestValue(`*${filters.q}*`);
    query = query.or(`company_name.ilike.${pattern},primary_contact_email.ilike.${pattern}`);
  }

  query = filters.lifecycle === "current"
    ? query.neq("lifecycle_status", "archived")
    : query.eq("lifecycle_status", filters.lifecycle);

  if (filters.subscription !== "all") {
    query = query.eq("subscription_status", filters.subscription);
  }

  if (filters.agreement !== "all") {
    query = query.eq("agreement_status", filters.agreement);
  }

  if (filters.sort === "company_desc") {
    query = query.order("company_name_sort", { ascending: false }).order("workspace_id", { ascending: true });
  } else if (filters.sort === "updated_desc") {
    query = query.order("workspace_updated_at", { ascending: false }).order("workspace_id", { ascending: true });
  } else if (filters.sort === "created_desc") {
    query = query.order("workspace_created_at", { ascending: false }).order("workspace_id", { ascending: true });
  } else {
    query = query.order("company_name_sort", { ascending: true }).order("workspace_id", { ascending: true });
  }

  const offset = (filters.page - 1) * ADMIN_COMPANY_PAGE_SIZE;
  const result = await query.range(offset, offset + ADMIN_COMPANY_PAGE_SIZE - 1);

  return {
    rows: (result.data || []) as AdminCompanyRow[],
    count: result.count || 0,
    error: result.error
  };
}

export async function loadAdminWorkspacePage(
  admin: SupabaseClient<Database>,
  filters: AdminWorkspaceFilters
) {
  let query = admin
    .from("admin_company_directory_v1")
    .select("*", { count: "exact" });

  if (filters.q) {
    const pattern = quotedPostgrestValue(`*${filters.q}*`);
    query = query.or(`company_name.ilike.${pattern},primary_contact_email.ilike.${pattern}`);
  }

  if (filters.view === "attention") {
    query = query.eq("attention_required", true);
  } else if (filters.view === "all") {
    // All workspaces is intentional and includes archived records.
  } else {
    query = query.eq("lifecycle_status", filters.view);
  }

  if (filters.sort === "company_desc") {
    query = query.order("company_name_sort", { ascending: false }).order("workspace_id", { ascending: true });
  } else if (filters.sort === "updated_desc") {
    query = query.order("workspace_updated_at", { ascending: false }).order("workspace_id", { ascending: true });
  } else if (filters.sort === "created_desc") {
    query = query.order("workspace_created_at", { ascending: false }).order("workspace_id", { ascending: true });
  } else {
    query = query.order("company_name_sort", { ascending: true }).order("workspace_id", { ascending: true });
  }

  const offset = (filters.page - 1) * ADMIN_COMPANY_PAGE_SIZE;
  const result = await query.range(offset, offset + ADMIN_COMPANY_PAGE_SIZE - 1);

  return {
    rows: (result.data || []) as AdminCompanyRow[],
    count: result.count || 0,
    error: result.error
  };
}

export function lifecycleLabel(lifecycle: AdminLifecycle) {
  if (lifecycle === "pending_activation") return "Pending activation";
  return lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1);
}

export function formatAdminDate(value?: string | null) {
  if (!value) return "Not available";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(value));
}

export function companyAttentionReasons(company: AdminCompanyRow) {
  const reasons: string[] = [];

  if (company.lifecycle_status === "archived") return ["Archived"];
  if (company.lifecycle_status === "pending_activation") reasons.push("Pending activation");
  if (company.lifecycle_status === "inactive") {
    reasons.push(accessLockedStatuses.has(company.subscription_status) ? "Locked by status" : "Access required");
  }
  if (company.agreement_status === "missing") reasons.push("Missing agreement");
  if (company.manually_unlocked) reasons.push("Manual unlock");
  if (
    company.subscription_id
    && company.workspace_subscription_status !== company.subscription_status
  ) reasons.push("Access status mismatch");
  if (!company.primary_contact_email) reasons.push("Missing contact");

  return reasons;
}

export function companyPageCount(total: number) {
  return Math.max(1, Math.ceil(total / ADMIN_COMPANY_PAGE_SIZE));
}
