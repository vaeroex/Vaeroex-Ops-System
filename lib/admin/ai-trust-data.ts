import "server-only";
import {
  aiTrustRangeStart,
  buildAiTrustDashboardSnapshot,
  type AiTrustAgentRunRow,
  type AiTrustBusinessNoteRow,
  type AiTrustDashboardSnapshot,
  type AiTrustFilters,
  type AiTrustUsageRow
} from "@/lib/admin/ai-trust-dashboard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { getAdminUsageData } from "@/lib/admin/usage-data";

const MAX_ROWS_PER_SOURCE = 5_000;
type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
function objectRows(value: unknown) {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return value === true || value === "true";
}

function usageRows(rows: readonly Record<string, unknown>[]): AiTrustUsageRow[] {
  return rows.flatMap((row) => {
    const id = stringValue(row.id);
    const status = stringValue(row.status);
    const createdAt = stringValue(row.created_at);
    if (!id || !status || !createdAt) return [];
    return [{
      id,
      agent_type: nullableString(row.agent_type),
      status,
      model: nullableString(row.model),
      latency_ms: nullableNumber(row.latency_ms),
      metadata_json: {
        provider: row.provider,
        fallback_used: row.fallback_used,
        provider_attempts: row.provider_attempts,
        trust_shadow: row.trust_shadow
      },
      created_at: createdAt
    }];
  });
}

function agentRunRows(rows: readonly Record<string, unknown>[]): AiTrustAgentRunRow[] {
  return rows.flatMap((row) => {
    const id = stringValue(row.id);
    const agentType = stringValue(row.agent_type);
    const status = stringValue(row.status);
    const createdAt = stringValue(row.created_at);
    return id && agentType && status && createdAt ? [{ id, agent_type: agentType, status, created_at: createdAt }] : [];
  });
}

function businessNoteRows(rows: readonly Record<string, unknown>[]): AiTrustBusinessNoteRow[] {
  return rows.flatMap((row) => {
    const id = stringValue(row.id);
    const status = stringValue(row.status);
    const lifecycle = stringValue(row.evidence_lifecycle_status);
    const releaseChannel = stringValue(row.release_channel);
    const createdAt = stringValue(row.created_at);
    if (!id || !status || !lifecycle || !releaseChannel || !createdAt) return [];
    return [{
      id,
      status,
      evidence_lifecycle_status: lifecycle,
      extraction_confidence: typeof row.extraction_confidence === "string" || typeof row.extraction_confidence === "number" ? row.extraction_confidence : null,
      correction_count: typeof row.correction_count === "string" || typeof row.correction_count === "number" ? row.correction_count : null,
      provider_name: nullableString(row.provider_name),
      model_used: nullableString(row.model_used),
      fallback_used: booleanValue(row.fallback_used),
      provider_attempts_json: row.provider_attempts_json,
      release_channel: releaseChannel,
      latency_ms: nullableNumber(row.latency_ms),
      extracted_at: nullableString(row.extracted_at),
      approved_at: nullableString(row.approved_at),
      archived_at: nullableString(row.archived_at),
      deleted_at: nullableString(row.deleted_at),
      created_at: createdAt
    }];
  });
}

/** Only bounded diagnostic row sources can be truncated. Count-only saved analyses
 * have no fetched rows and must never participate in this comparison. */
export function trustRowsTruncated(counts: Record<string, unknown>, sources: { usage: readonly unknown[]; runs: readonly unknown[]; notes: readonly unknown[] }) {
  return (["usage", "runs", "notes"] as const).some((source) => typeof counts[source] === "number" && Number(counts[source]) > sources[source].length);
}

export async function getAiTrustDashboardData(input: {
  admin: AdminClient;
  filters: AiTrustFilters;
}): Promise<AiTrustDashboardSnapshot> {
  // Reauthorize this reusable data boundary as well as the admin page/layout.
  const access = await getVaeroexAdminAccess();
  const now = new Date();
  const start = aiTrustRangeStart(input.filters.range, now)!;
  const end = now.toISOString();
  const empty = (message: string) => buildAiTrustDashboardSnapshot({ filters: input.filters, businessHealthUsage: [], findingExplanationUsage: [], fileAnalysisUsage: [], findingExplanationRuns: [], fileAnalysisRuns: [], businessNotes: [], savedFindingAnalyses: null, generatedAt: end, sourceErrors: [{ source: "Trust telemetry", message }] });
  if (!access.allowed || !access.admin) return empty("Vaeroex admin access is required.");
  const operational = await getAdminUsageData({ start, end, workspaceId: input.filters.workspace || null });
  try {
    // PostgreSQL explicitly reconstructs every nested operational field before it
    // leaves the database. Never fall back to selecting raw JSON on an RPC error.
    const { data, error } = await access.admin.rpc("admin_ai_trust_rows_v1", {
      p_start: start, p_end: end, p_workspace_id: input.filters.workspace || null, p_limit: MAX_ROWS_PER_SOURCE
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return { ...empty("Trust diagnostics are unavailable. No reliability conclusion can be drawn."), operational, periodStart: start, periodEnd: end };
    const raw = data as Record<string, unknown>;
    const rows = { usage: objectRows(raw.usage), runs: objectRows(raw.runs), notes: objectRows(raw.notes) };
    const counts = raw.counts && typeof raw.counts === "object" && !Array.isArray(raw.counts) ? raw.counts as Record<string, unknown> : {};
    const usage = usageRows(rows.usage);
    const runs = agentRunRows(rows.runs);
    return {
      ...buildAiTrustDashboardSnapshot({ filters: input.filters,
        businessHealthUsage: usage.filter((row) => row.agent_type === "business_health_explanation_v1"),
        findingExplanationUsage: usage.filter((row) => row.agent_type === "finding_explanation_v1"),
        fileAnalysisUsage: usage.filter((row) => row.agent_type === "file_analysis"),
        findingExplanationRuns: runs.filter((row) => row.agent_type === "finding_explanation_v1"),
        fileAnalysisRuns: runs.filter((row) => row.agent_type === "file_analysis"), businessNotes: businessNoteRows(rows.notes),
        savedFindingAnalyses: nullableNumber(counts.saved_analyses), generatedAt: end,
        truncated: trustRowsTruncated(counts, rows)
      }), operational, periodStart: start, periodEnd: end
    };
  } catch {
    return { ...empty("Trust diagnostics are unavailable. No reliability conclusion can be drawn."), operational, periodStart: start, periodEnd: end };
  }
}
