/** Safe support inbox fields; request contents are fetched only after opening a request. */
export const SUPPORT_REQUEST_LIST_FIELDS = "id,workspace_id,name,email,issue_type,priority,status,created_at,updated_at,archived_at,deleted_at";
export const SUPPORT_STATUSES = ["open", "in_review", "waiting_on_customer", "resolved", "closed"] as const;
export const SUPPORT_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export const SUPPORT_LIFECYCLES = ["active", "archived", "deleted", "all"] as const;
export const SUPPORT_PAGE_SIZE = 25;
export const SUPPORT_MAX_BATCH = 50;
export const SUPPORT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SupportRequestSummary = {
  id: string; workspace_id: string | null; name: string; email: string; issue_type: string;
  priority: string; status: string; created_at: string; updated_at: string;
  archived_at: string | null; deleted_at: string | null; workspaceName: string;
};
export type SupportFilters = { q: string; status: string; view: typeof SUPPORT_LIFECYCLES[number]; page: number };
export type SupportMutationResult = { ok: boolean; message: string; changedCount?: number; requestedCount?: number; replayed?: boolean };

export function supportFilters(params: { q?: string | string[]; status?: string | string[]; view?: string | string[]; page?: string | string[] } = {}): SupportFilters {
  const query = typeof params.q === "string" ? params.q : "";
  const status = typeof params.status === "string" ? params.status : "";
  const view = typeof params.view === "string" ? params.view : "";
  const page = typeof params.page === "string" ? Number(params.page) : 1;
  return {
    q: query.trim().slice(0, 120),
    status: SUPPORT_STATUSES.includes(status as typeof SUPPORT_STATUSES[number]) ? status : "",
    view: SUPPORT_LIFECYCLES.includes(view as typeof SUPPORT_LIFECYCLES[number]) ? view as SupportFilters["view"] : "active",
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1
  };
}

export function supportSearchExpression(query: string) {
  // Quote PostgREST filter values and escape LIKE metacharacters. Commas, quotes,
  // parentheses and backslashes remain data, never filter operators.
  const literal = query.replace(/[\\%_]/g, "\\$&").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const pattern = `"%${literal}%"`;
  return `email.ilike.${pattern},name.ilike.${pattern},issue_type.ilike.${pattern}`;
}

export function supportPageHref(filters: SupportFilters, page: number) {
  const query = new URLSearchParams({ view: filters.view, page: String(page) });
  if (filters.q) query.set("q", filters.q);
  if (filters.status) query.set("status", filters.status);
  return `/app/admin/support-requests?${query}`;
}

export function validateSupportMutation(formData: FormData) {
  if (!(formData instanceof FormData)) return null;
  const action = String(formData.get("support_action") || "");
  const rawIds = formData.getAll("support_request_ids");
  if (!rawIds.length && formData.has("support_request_id")) rawIds.push(formData.get("support_request_id")!);
  if (!rawIds.length || rawIds.length > SUPPORT_MAX_BATCH || rawIds.some((id) => typeof id !== "string" || !SUPPORT_UUID.test(id))) return null;
  const ids = [...new Set(rawIds as string[])].sort();
  const operationId = String(formData.get("operation_id") || "");
  if (!SUPPORT_UUID.test(operationId) || !["archive", "delete", "restore", "update"].includes(action)) return null;
  const status = String(formData.get("status") || "");
  const priority = String(formData.get("priority") || "");
  if (action === "update" && (ids.length !== 1 || !SUPPORT_STATUSES.includes(status as typeof SUPPORT_STATUSES[number]) || !SUPPORT_PRIORITIES.includes(priority as typeof SUPPORT_PRIORITIES[number]))) return null;
  return { ids, action, operationId, status: action === "update" ? status : null, priority: action === "update" ? priority : null };
}
