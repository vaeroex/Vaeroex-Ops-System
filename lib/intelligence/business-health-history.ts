import type { SupabaseClient } from "@supabase/supabase-js";
import { filterBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import type { Database, Json } from "@/lib/supabase/types";

export type BusinessHealthSnapshotRow = Database["public"]["Tables"]["business_health_snapshots"]["Row"];
export type BusinessHealthSnapshotResult = {
  snapshots: BusinessHealthSnapshotRow[];
  errorMessage: string | null;
};

type BusinessHealthSnapshotInput = {
  workspaceId: string;
  score: number;
  status: string;
  trend: string;
  dataConfidence: string;
  dataQualityScore: number;
  memorySignalCount: number;
  sourceSummary: Json;
};

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function recordDailyBusinessHealthSnapshot(
  supabase: SupabaseClient<Database>,
  input: BusinessHealthSnapshotInput
) {
  const today = dateOnly(new Date());
  const { error } = await supabase
    .from("business_health_snapshots")
    .upsert(
      {
        workspace_id: input.workspaceId,
        snapshot_date: today,
        score: input.score,
        status: input.status,
        trend: input.trend,
        data_confidence: input.dataConfidence,
        data_quality_score: input.dataQualityScore,
        memory_signal_count: input.memorySignalCount,
        source_summary: input.sourceSummary
      },
      {
        ignoreDuplicates: true,
        onConflict: "workspace_id,snapshot_date"
      }
    );

  if (error && error.code !== "42P01" && error.code !== "PGRST205") {
    console.warn("Could not record Business Health snapshot", error.message);
  }
}

export async function getBusinessHealthSnapshots(
  supabase: SupabaseClient<Database>,
  workspaceId: string
): Promise<BusinessHealthSnapshotRow[]> {
  const result = await getBusinessHealthSnapshotResult(supabase, workspaceId);
  return result.snapshots;
}

export async function getBusinessHealthSnapshotResult(
  supabase: SupabaseClient<Database>,
  workspaceId: string
): Promise<BusinessHealthSnapshotResult> {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
  const { data, error } = await supabase
    .from("business_health_snapshots")
    .select("*")
    .eq("workspace_id", workspaceId)
    .gte("snapshot_date", dateOnly(start))
    .order("snapshot_date", { ascending: true });

  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205") {
      console.warn("Could not load Business Health snapshots", error.message);
    }

    return {
      snapshots: [],
      errorMessage: "Business Health history is temporarily unavailable."
    };
  }

  return {
      snapshots: filterBusinessEvidence(data || []),
    errorMessage: null
  };
}
