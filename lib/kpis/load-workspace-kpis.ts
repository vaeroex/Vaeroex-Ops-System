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

  // These three database columns are NOT NULL. Keep the database's timestamp
  // string (including microseconds) instead of round-tripping through Date.
  let cursor: Pick<KpiRow, "metric_date" | "created_at" | "id"> | undefined;
  const queryPage = (limit: number) => {
    let query = supabase
      .from("kpis")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .is("deleted_at", null)
      .order("metric_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (cursor) {
      // Quote each typed database value for PostgREST's filter grammar. The
      // cursor is never supplied by a caller. The date bound also lets the
      // existing workspace/date index skip pages already read.
      const metricDate = JSON.stringify(cursor.metric_date);
      const createdAt = JSON.stringify(cursor.created_at);
      const id = JSON.stringify(cursor.id);
      query = query.lte("metric_date", cursor.metric_date).or(
        `metric_date.lt.${metricDate},and(metric_date.eq.${metricDate},created_at.lt.${createdAt}),and(metric_date.eq.${metricDate},created_at.eq.${createdAt},id.lt.${id})`
      );
    }
    return query;
  };

  for (let from = 0; from < WORKSPACE_KPI_LOAD_LIMIT; from += WORKSPACE_KPI_PAGE_SIZE) {
    const { data, error } = await queryPage(WORKSPACE_KPI_PAGE_SIZE);

    if (error) return { data: [], error: new Error(error.message), complete: false };
    rows.push(...(data || []));
    cursor = data?.at(-1) ?? cursor;
    if (!data || data.length < WORKSPACE_KPI_PAGE_SIZE) {
      return resolveSheetsAuthority();
    }
  }

  const { data: overflow, error: overflowError } = await queryPage(1).maybeSingle();

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
