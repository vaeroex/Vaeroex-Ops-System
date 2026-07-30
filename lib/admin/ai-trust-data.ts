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

const MAX_ROWS_PER_SOURCE = 5_000;
const USAGE_SELECT = "id,agent_type,status,model,latency_ms,created_at,provider:metadata_json->>provider,fallback_used:metadata_json->fallback_used,provider_attempts:metadata_json->provider_attempts,trust_shadow:metadata_json->trust_shadow";
const NOTE_SELECT = "id,status,evidence_lifecycle_status,provider_name,model_used,fallback_used,provider_attempts_json,release_channel,latency_ms,extracted_at,approved_at,archived_at,deleted_at,created_at,extraction_confidence:extraction_json->>extractionConfidence,correction_count:user_corrections_json->>correction_count";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type SafeRows = Readonly<{ rows: readonly Record<string, unknown>[]; count: number; failed: boolean }>;

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

async function safeRows(source: string, promise: PromiseLike<{ data: unknown; error: unknown; count?: number | null }>): Promise<SafeRows & { source: string }> {
  try {
    const result = await promise;
    if (result.error) return { source, rows: [], count: 0, failed: true };
    const rows = objectRows(result.data);
    return { source, rows, count: result.count ?? rows.length, failed: false };
  } catch {
    return { source, rows: [], count: 0, failed: true };
  }
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

async function loadUsage(admin: AdminClient, agentType: string, start: string | null) {
  let query = admin.from("ai_usage").select(USAGE_SELECT, { count: "exact" }).eq("agent_type", agentType)
    .order("created_at", { ascending: false }).limit(MAX_ROWS_PER_SOURCE);
  if (start) query = query.gte("created_at", start);
  return query;
}

async function loadRuns(admin: AdminClient, agentType: string, start: string | null) {
  let query = admin.from("ai_agent_runs").select("id,agent_type,status,created_at", { count: "exact" }).eq("agent_type", agentType)
    .order("created_at", { ascending: false }).limit(MAX_ROWS_PER_SOURCE);
  if (start) query = query.gte("created_at", start);
  return query;
}

async function loadNotes(admin: AdminClient, start: string | null) {
  let query = admin.from("business_notes").select(NOTE_SELECT, { count: "exact" })
    .order("created_at", { ascending: false }).limit(MAX_ROWS_PER_SOURCE);
  if (start) query = query.gte("created_at", start);
  return query;
}

async function loadSavedFindingAnalysisCount(admin: AdminClient, start: string | null) {
  let query = admin.from("reports").select("id", { count: "exact", head: true })
    .eq("report_type", "Saved Analysis")
    .contains("source_data_json", { record_kind: "saved_analysis", analysis_type: "finding_explanation" });
  if (start) query = query.gte("created_at", start);
  return query;
}

export async function getAiTrustDashboardData(input: {
  admin: AdminClient;
  filters: AiTrustFilters;
}): Promise<AiTrustDashboardSnapshot> {
  const start = aiTrustRangeStart(input.filters.range);
  const sources = await Promise.all([
    safeRows("Business Health telemetry", loadUsage(input.admin, "business_health_explanation_v1", start)),
    safeRows("Explain Finding telemetry", loadUsage(input.admin, "finding_explanation_v1", start)),
    safeRows("File Analysis telemetry", loadUsage(input.admin, "file_analysis", start)),
    safeRows("Explain Finding artifacts", loadRuns(input.admin, "finding_explanation_v1", start)),
    safeRows("File Analysis artifacts", loadRuns(input.admin, "file_analysis", start)),
    safeRows("Business Notes lifecycle", loadNotes(input.admin, start)),
    safeRows("Saved Analysis count", loadSavedFindingAnalysisCount(input.admin, start))
  ]);
  const [businessHealthUsage, findingUsage, fileUsage, findingRuns, fileRuns, notes, savedAnalyses] = sources;
  const sourceErrors = sources.filter((source) => source.failed).map((source) => ({
    source: source.source,
    message: `${source.source} could not be loaded. Other available AI Trust metrics remain visible.`
  }));
  return buildAiTrustDashboardSnapshot({
    filters: input.filters,
    businessHealthUsage: usageRows(businessHealthUsage.rows),
    findingExplanationUsage: usageRows(findingUsage.rows),
    fileAnalysisUsage: usageRows(fileUsage.rows),
    findingExplanationRuns: agentRunRows(findingRuns.rows),
    fileAnalysisRuns: agentRunRows(fileRuns.rows),
    businessNotes: businessNoteRows(notes.rows),
    savedFindingAnalyses: savedAnalyses.failed ? null : savedAnalyses.count,
    truncated: sources.some((source) => source.count > source.rows.length),
    sourceErrors
  });
}
