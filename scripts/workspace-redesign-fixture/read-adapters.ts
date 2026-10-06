import { AS_OF, WORKSPACE_ID, files, kpis, performanceKpis, performanceKpiSettings, profile, workspace, analyses, cards, briefings, freeze, executiveModel, businessHealthFacts, type FixtureRole, type FixtureState } from "./data";
import type { IntegrationDashboard } from "../../lib/integrations/dashboard/model";
let current = { state: "populated" as FixtureState, role: "owner" as FixtureRole };
export function setFixture(state: FixtureState, role: FixtureRole) { current = { state, role }; }
const reportRows = analyses.map(analysis => ({ id: analysis.id, workspace_id: WORKSPACE_ID, archived_at: null, deleted_at: null, source_data_json: { record_kind: "saved_analysis", envelope_version: 1, saved_analysis_key: analysis.id, workspace_id: WORKSPACE_ID, release_channel: "preview", analysis_type: analysis.analysisType, title: analysis.title, source_artifact: { id: analysis.id, workflow: "synthetic", contract_id: "synthetic", contract_version: "synthetic", validator_version: "synthetic", policy_id: "synthetic" }, provider_attribution: { provider: "openai", model: "synthetic-not-generated", fallback_used: false }, generated_at: AS_OF, saved_at: AS_OF, confidence: analysis.confidence, freshness: "current", evidence_fingerprint: "synthetic", citations: [], evidence_lineage: [], display: { summary_label: "Synthetic analysis", summary: "Interface fixture; no model was called.", sections: [], evidence_status: analysis.evidenceStatus, date_range: analysis.dateRange }, artifact: {} } }));
const tables = Object.freeze(["kpis", "kpi_settings", "people", "record_shares", "file_uploads", "record_folders", "file_imports", "file_import_rows", "ai_agent_runs", "business_memory_chunks", "business_notes", "workspace_agreements", "reports"]);
const fixtureClients = new WeakMap<object, FixtureState>();
export function createFixtureClient(state: FixtureState) {
  const client = { from(table: string) {
    if (!tables.includes(table)) throw new Error(`Unreviewed synthetic table: ${table}`);
    let rows: Record<string, unknown>[] = state === "empty" ? [] : table === "kpis" ? [...kpis] : table === "kpi_settings" ? [...performanceKpiSettings] : table === "file_uploads" ? [...files] : table === "reports" ? reportRows : [];
    let scoped = false;
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { if (key === "workspace_id") { if (value !== WORKSPACE_ID) throw new Error("Unknown synthetic workspace"); scoped = true; } rows = rows.filter(row => row[key] === value); return query; },
      is(key: string, value: unknown) { rows = rows.filter(row => row[key] === value || value === null && row[key] === undefined); return query; },
      in(key: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[key])); return query; },
      contains(key: string, values: Record<string, unknown>) { rows = rows.filter(row => Object.entries(values).every(([field, value]) => { const nested = row[key]; return nested !== null && typeof nested === "object" && (nested as Record<string, unknown>)[field] === value; })); return query; },
      order() { return query; },
      limit(maximum: number) { rows = rows.slice(0, maximum); return query; },
      range(from: number, to: number) { rows = rows.slice(from, to + 1); return query; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        if (!scoped) return Promise.reject(new Error(`Unscoped synthetic read: ${table}`)).then(resolve, reject);
        return Promise.resolve({ data: state === "error" ? [] : rows, error: state === "error" ? { message: "Synthetic read unavailable. No live data was requested." } : null }).then(resolve, reject);
      },
    };
    // Unknown operations, especially mutations/RPC/storage/auth, do not exist.
    return new Proxy(query, { get(target, key) { if (key in target || typeof key === "symbol") return Reflect.get(target, key); throw new Error(`Unreviewed synthetic query operation: ${String(key)}`); } });
  } };
  fixtureClients.set(client, state);
  return client;
}
export async function requireWorkspacePage() {
  const { state, role } = current;
  return { workspaceId: WORKSPACE_ID, supabase: createFixtureClient(state), context: { profile, activeWorkspace: workspace, workspace, workspaces: [workspace], membership: { workspace_id: WORKSPACE_ID, user_id: profile.id, role }, user: { id: profile.id, email: profile.email } } };
}
export async function loadActiveWorkspaceKpis({ supabase, workspaceId }: { supabase: object; workspaceId: string }) {
  if (workspaceId !== WORKSPACE_ID || !fixtureClients.has(supabase)) throw new Error("Unknown synthetic Performance workspace/client");
  const state = fixtureClients.get(supabase);
  if (performanceKpis.length >= 1000) throw new Error("Synthetic Performance observations exceed the reviewed fixture bound");
  return { data: state === "empty" || state === "error" ? [] : [...performanceKpis], error: state === "error" ? { message: "Synthetic read unavailable. No live data was requested." } : null, complete: state !== "error" };
}
export async function filterEligibleMemoryRowsByLifecycle({ rows }: { rows: unknown[] }) {
  if (rows.length) throw new Error("Non-empty synthetic memory lifecycle is not implemented"); return rows;
}
export async function createFileAccessLinkMap(_client: unknown, rows: { id: string }[]) { return new Map(rows.map(row => [row.id, { downloadUrl: null, previewUrl: null, error: "Synthetic file; download unavailable" }])); }
export function isBusinessNoteExtractionEnabled() { return true; }
export function qboProductionCustomerConnectionsEnabled() { return false; }
export function squareDirectEnabled() { return true; }
export async function readSquareWorkspaceEvidence() { return null; }
export async function headers() { return new Headers(); }
export const fixedAsOf = AS_OF;
const dashboard = freeze<IntegrationDashboard>({ workspaceId: WORKSPACE_ID, observedAt: AS_OF, timeZone: "UTC", timeZoneConfirmed: false, preferencesAvailable: false, entries: [], unavailable: [] });
export function intelligenceFixture() { const empty = current.state === "empty"; return { healthView: freeze({ executiveHomepageModel: executiveModel(empty), businessHealthAnalysisPackage: { facts: businessHealthFacts(empty), citations: [] }, businessHealthHistory: [], businessHealthExplanationAsOf: AS_OF, businessHealthSnapshotResult: { errorMessage: null }, businessHealthAnalysisState: { status: "unavailable", artifact: null, message: "Analysis generation is unavailable in this isolated preview." }, businessHealthAnalysisToken: null }), workspaceId: WORKSPACE_ID, dashboard, displayErrors: [], lifecycleCards: { current: current.state === "empty" ? [] : cards, history: [] }, explanationTokens: {}, canManageLifecycle: false, blockedState: null, briefingStates: briefings, isIntelligenceBriefingEnabled: () => false }; }
