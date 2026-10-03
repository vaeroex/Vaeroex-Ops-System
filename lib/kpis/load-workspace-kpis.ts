import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type SupabaseServerClient = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];

export const WORKSPACE_KPI_PAGE_SIZE = 1_000;
export const WORKSPACE_KPI_LOAD_LIMIT = 20_000;

export type WorkspaceKpiLoadResult = Readonly<{
  data: KpiRow[];
  error: Error | null;
  complete: boolean;
}>;

export async function loadActiveWorkspaceKpis({
  supabase,
  workspaceId
}: {
  supabase: SupabaseServerClient;
  workspaceId: string;
}): Promise<WorkspaceKpiLoadResult> {
  const rows: KpiRow[] = [];
  const resolveSheetsAuthority = async (): Promise<WorkspaceKpiLoadResult> => {
    const hasSheets = rows.some(row => row.raw_data_json && typeof row.raw_data_json === "object" && !Array.isArray(row.raw_data_json) && "googleSheets" in row.raw_data_json);
    if (!hasSheets) return { data: rows, error: null, complete: true };
    const result = await supabase.rpc("read_google_sheets_operational_conflicts_v1", { p_workspace_id: workspaceId });
    const authorityError: WorkspaceKpiLoadResult = { data: [], error: new Error("Google Sheets source authority could not be verified."), complete: false };
    if (result.error || !Array.isArray(result.data) || result.data.length > WORKSPACE_KPI_LOAD_LIMIT) return authorityError;
    const conflicts = new Set<string>();
    for (const row of result.data) {
      if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.kpi_id !== "string") return authorityError;
      conflicts.add(row.kpi_id);
    }
    return { data: rows.filter(row => !conflicts.has(row.id)), error: null, complete: true };
  };

  for (let from = 0; from < WORKSPACE_KPI_LOAD_LIMIT; from += WORKSPACE_KPI_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("kpis")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .is("deleted_at", null)
      .order("metric_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + WORKSPACE_KPI_PAGE_SIZE - 1);

    if (error) return { data: [], error: new Error(error.message), complete: false };
    rows.push(...(data || []));
    if (!data || data.length < WORKSPACE_KPI_PAGE_SIZE) {
      return resolveSheetsAuthority();
    }
  }

  const { data: overflow, error: overflowError } = await supabase
    .from("kpis")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .is("deleted_at", null)
    .range(WORKSPACE_KPI_LOAD_LIMIT, WORKSPACE_KPI_LOAD_LIMIT)
    .maybeSingle();

  if (overflowError) return { data: [], error: new Error(overflowError.message), complete: false };
  if (overflow) {
    return {
      data: [],
      error: new Error(`Active KPI history exceeds the supported ${WORKSPACE_KPI_LOAD_LIMIT.toLocaleString()}-observation workspace bound.`),
      complete: false
    };
  }

  return resolveSheetsAuthority();
}
