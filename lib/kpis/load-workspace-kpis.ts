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
      return { data: rows, error: null, complete: true };
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

  return { data: rows, error: null, complete: true };
}
