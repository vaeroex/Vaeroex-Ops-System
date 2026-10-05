import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export const ASSET_STATUSES = ["Ready", "Needs attention", "Out of service", "Missing"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Params = Record<string, string | string[] | undefined>;
export function assetCheckHistoryFilters(params: Params = {}) {
  const one = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const assetId = one("asset_id");
  const folder = one("folder");
  const status = one("status");
  const from = one("from");
  const to = one("to");
  if ((assetId && !uuid.test(assetId)) || (folder && folder !== "unfiled" && !uuid.test(folder))) throw new Error("Choose a valid asset or folder.");
  if (status && !ASSET_STATUSES.includes(status)) throw new Error("Choose a listed status.");
  for (const date of [from, to].filter(Boolean)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Choose a valid date.");
  }
  if (from && to && from > to) throw new Error("The start date must be on or before the end date.");
  return { assetId, folder, status, from, to, query: one("q").trim().slice(0, 200), view: ["active", "archived", "deleted", "all"].includes(one("view")) ? one("view") : "active", oldest: one("sort") === "oldest", size: [10, 25, 50].includes(Number(one("size"))) ? Number(one("size")) : 25, page: /^\d{1,7}$/.test(one("page")) ? Math.max(1, Math.min(1000000, Number(one("page")))) : 1 };
}
export type AssetCheckHistoryFilters = ReturnType<typeof assetCheckHistoryFilters>;

export async function loadAssetCheckHistory(supabase: SupabaseClient<Database>, workspaceId: string, filters: AssetCheckHistoryFilters) {
  function query(page: number) {
    let request = supabase.from("asset_checks").select("*", { count: "exact" }).eq("workspace_id", workspaceId);
    if (filters.assetId) request = request.eq("asset_id", filters.assetId);
    if (filters.status) request = request.eq("status", filters.status);
    if (filters.folder === "unfiled") request = request.is("folder_id", null);
    else if (filters.folder) request = request.eq("folder_id", filters.folder);
    if (filters.view === "active") request = request.is("archived_at", null).is("deleted_at", null);
    if (filters.view === "archived") request = request.not("archived_at", "is", null).is("deleted_at", null);
    if (filters.view === "deleted") request = request.not("deleted_at", "is", null);
    if (filters.query) request = request.ilike("notes", `%${filters.query.replace(/[\\%_]/g, "\\$&")}%`);
    if (filters.from) request = request.gte("created_at", `${filters.from}T00:00:00.000Z`);
    if (filters.to) request = request.lte("created_at", `${filters.to}T23:59:59.999999Z`);
    return request.order("created_at", { ascending: filters.oldest }).order("id", { ascending: filters.oldest }).range((page - 1) * filters.size, page * filters.size - 1);
  }
  let page = filters.page;
  let result = await query(page);
  // PostgREST returns 416/PGRST103 for an offset beyond an exact count, and
  // postgrest-js does not expose that response's count. Recover through the
  // first page with the identical scope/filters before choosing a valid page.
  if (result.error?.code === "PGRST103" && page > 1) {
    page = 1;
    result = await query(page);
  }
  if (!result.error) {
    const lastPage = Math.max(1, Math.ceil((result.count || 0) / filters.size));
    const targetPage = Math.min(filters.page, lastPage);
    if (targetPage !== page) {
      page = targetPage;
      result = await query(page);
    }
  }
  // At most three reads. If a concurrent change invalidates the recovery page,
  // return the error so the UI offers a refresh instead of retrying indefinitely.
  return { ...result, page };
}
