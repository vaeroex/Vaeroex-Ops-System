import { z } from "zod";

const phases = ["request_binding", "window_selection", "preparation", "discovery",
  "source_read", "source_projection", "product_context", "sealing", "prepared_validation",
  "actor_validation", "memory_certification", "legacy_capture", "source_roots",
  "dependency_read", "dependency_roots", "manifest_seal"] as const;
export type SharedPreparationPhase = typeof phases[number];
const safePhase = (phase: SharedPreparationPhase) => phases.find(item => item === phase) ?? "preparation";
type Category = "denial" | "snapshot_conflict" | "rpc_schema_mismatch" | "invalid_evidence" | "operational" | "unknown";
type Reason = "actor_denied" | "source_changed" | "identity_changed" | "source_ineligible" | "retention_stop"
  | "input_contract_invalid" | "evidence_budget" | "rpc_contract_missing" | "rpc_response_invalid" | "timeout" | "concurrency"
  | "isolation_unsupported" | "schema_invalid" | "projection_invalid"
  | "preparation_changed" | "actor_unavailable" | "certification_unavailable" | "certification_rejected"
  | "read_ticket_unavailable" | "read_ticket_invalid" | "read_sources_invalid" | "read_ticket_mismatch"
  | "product_context_limit" | "subscription_unavailable" | "request_binding_missing" | "unclassified";
const operations = ["discover_shared_evidence_v2", "preview_shared_legacy_evidence_v1", "read_shared_typed_evidence_v1",
  "certify_shared_memory_semantics_v1", "capture_legacy_evidence_v1", "shared_evidence_dependencies_v1",
  "seal_shared_evidence_manifest_v1", "validate_shared_evidence_manifest_v1"] as const;
type Operation = typeof operations[number];
const rpcCodes = ["42501", "40001", "PT409", "55000", "22023", "54000", "PGRST202", "42883", "42P01", "42703", "57014", "40P01", "55P03"] as const;
type Core = Readonly<{ category: Category; reason: Reason; operation?: Operation; rpcCode?: typeof rpcCodes[number] | "other"; schemaIssueCount?: number }>;
export type SharedPreparationDiagnostic = Readonly<Core & { version: 1; phase: SharedPreparationPhase }>;
// Private metadata holds only closed enums/counts, never a raw cause or payload.
const failures = new WeakMap<object, Core & { phase?: SharedPreparationPhase }>();
const pairs = new Map<string, readonly [Category, Reason]>();
function pair(code: string, messages: readonly string[], category: Category, reason: Reason) {
  for (const message of messages) pairs.set(`${code}:${message}`, [category, reason]);
}
pair("42501", ["evidence_owner_required", "evidence_live_session_required", "shared_evidence_actor_denied", "shared_evidence_inherited_actor_denied", "google_sheets_read_denied"], "denial", "actor_denied");
pair("42501", ["evidence_binding_changed"], "snapshot_conflict", "source_changed");
pair("40001", ["evidence_connection_changed", "shared_evidence_stale_attempt", "shared_evidence_source_changed", "shared_evidence_input_changed", "shared_evidence_manifest_changed", "google_sheets_read_ticket_stale", "google_sheets_read_source_changed"], "snapshot_conflict", "source_changed");
for (const code of ["PT409", "40001"]) pair(code, ["shared_typed_identity_changed"], "snapshot_conflict", "identity_changed");
pair("42501", ["shared_typed_qbo_denied", "shared_typed_sheets_denied"], "denial", "source_ineligible");
pair("55000", ["google_sheets_privacy_paused", "google_sheets_source_expired"], "denial", "retention_stop");
pair("22023", ["shared_discovery_period_invalid", "shared_discovery_preference_invalid", "shared_typed_identity_invalid", "shared_evidence_sources_invalid"], "invalid_evidence", "input_contract_invalid");
pair("54000", ["evidence_read_budget_exceeded", "shared_typed_budget_exceeded", "shared_evidence_budget_exceeded"], "invalid_evidence", "evidence_budget");
pair("40001", ["shared_evidence_write_conflict", "shared_evidence_authority_conflict"], "operational", "concurrency");
pair("40001", ["shared_evidence_isolation_unsupported"], "operational", "isolation_unsupported");
const local = new Map<string, readonly [Category, Reason]>([
  ["shared_discovery_counts_invalid", ["rpc_schema_mismatch", "rpc_response_invalid"]],
  ["shared_source_changed", ["snapshot_conflict", "source_changed"]],
  ["shared_preparation_changed", ["snapshot_conflict", "preparation_changed"]],
  ["shared_actor_unavailable", ["unknown", "actor_unavailable"]],
  ["shared_semantic_certification_unavailable", ["operational", "certification_unavailable"]],
  ["shared_semantic_certification_failed", ["invalid_evidence", "certification_rejected"]],
  ["shared_request_binding_missing", ["invalid_evidence", "request_binding_missing"]],
  ["read_ticket_invalid", ["invalid_evidence", "read_ticket_invalid"]],
  ["read_sources_invalid", ["invalid_evidence", "read_sources_invalid"]],
  ["read_ticket_mismatch", ["invalid_evidence", "read_ticket_mismatch"]],
  ["Workspace data changed or is being updated. Reload this page before trying again.", ["unknown", "read_ticket_unavailable"]],
  ["Vaeroex product context exceeded its safe size. Please retry after the catalog is updated.", ["invalid_evidence", "product_context_limit"]],
  ["Workspace subscription access could not be verified. Please retry.", ["unknown", "subscription_unavailable"]],
]);
for (const message of ["shared_workspace_mismatch", "shared_provider_mismatch", "shared_period_invalid", "shared_square_status_invalid", "shared_square_minor_units_invalid", "shared_qbo_scope_invalid", "shared_qbo_currency_invalid", "shared_qbo_truncated", "shared_snapshot_time_invalid", "shared_wix_amount_invalid", "shared_zoho_amount_invalid", "shared_projection_unsupported", "shared_projection_large", "shared_fact_time_alignment", "shared_memory_workspace_mismatch", "shared_memory_ineligible", "fact_time_semantics_invalid", "fact_time_index_alignment"])
  local.set(message, ["invalid_evidence", "projection_invalid"]);
function ownString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  try { const property = Object.getOwnPropertyDescriptor(value, key); return typeof property?.value === "string" && property.value.length <= 200 ? property.value : undefined; }
  catch { return undefined; }
}
function classify(error: unknown, localSentinels = true): Core {
  try { return classifyKnown(error, localSentinels); }
  catch { return { category: "unknown", reason: "unclassified" }; }
}
function classifyKnown(error: unknown, localSentinels: boolean): Core {
  if (error && typeof error === "object") {
    const retained = failures.get(error);
    if (retained) return retained;
  }
  if (error instanceof z.ZodError) return { category: "invalid_evidence", reason: "schema_invalid", schemaIssueCount: Math.min(error.issues.length, 32) };
  const code = ownString(error, "code"), message = ownString(error, "message");
  const hasCode = Boolean(error && typeof error === "object" && Object.getOwnPropertyDescriptor(error, "code"));
  const rpcCode = hasCode ? rpcCodes.find(item => item === code) ?? "other" : undefined;
  // A code such as 42501 also covers stale bindings and missing dependencies.
  // Only exact, reviewed sentinel/code pairs justify a more specific claim.
  const known = pairs.get(`${code}:${message}`) ?? (localSentinels && error instanceof Error && !hasCode && message !== undefined ? local.get(message) : undefined);
  if (known) return { category: known[0], reason: known[1], ...(rpcCode ? { rpcCode } : {}) };
  if (["PGRST202", "42883", "42P01", "42703"].includes(code ?? "")) return { category: "rpc_schema_mismatch", reason: "rpc_contract_missing", rpcCode };
  if (code === "57014" || ["AbortError", "TimeoutError"].includes(ownString(error, "name") ?? "")) return { category: "operational", reason: "timeout", ...(rpcCode ? { rpcCode } : {}) };
  if (["40P01", "55P03"].includes(code ?? "")) return { category: "operational", reason: "concurrency", rpcCode };
  // Unknown messages, details, hints, stack frames, paths and values are withheld.
  return { category: "unknown", reason: "unclassified", ...(rpcCode ? { rpcCode } : {}) };
}
export function retainSharedPreparationFailure<T extends Error>(target: T, cause: unknown, remote = false): T {
  failures.set(target, classify(cause, !remote)); return target;
}
export function sharedRpcFailure(operation: string, cause: unknown): Error {
  const error = new Error("shared_evidence_authority_unavailable");
  const knownOperation = operations.find(item => item === operation);
  failures.set(error, { ...classify(cause, false), ...(knownOperation ? { operation: knownOperation } : {}) });
  return error;
}
export async function withSharedPreparationPhase<T>(phase: SharedPreparationPhase, action: () => T | PromiseLike<T>): Promise<T> {
  try { return await action(); }
  catch (cause) {
    const error = cause && typeof cause === "object" ? cause : new Error("shared_preparation_unavailable");
    const retained = failures.get(error);
    failures.set(error, { ...classify(cause), phase: retained?.phase ?? safePhase(phase) });
    throw error;
  }
}
export function sharedPreparationDiagnostic(phase: SharedPreparationPhase, error: unknown): SharedPreparationDiagnostic {
  const core = classify(error), retained = error && typeof error === "object" ? failures.get(error) : undefined;
  const currentPhase = retained?.phase ?? safePhase(phase);
  const responseShape = core.reason === "schema_invalid" && ["discovery", "source_read", "legacy_capture", "dependency_read", "source_roots", "dependency_roots", "manifest_seal"].includes(currentPhase);
  return { ...core, ...(responseShape ? { category: "rpc_schema_mismatch" as const, reason: "rpc_response_invalid" as const } : {}), version: 1, phase: currentPhase };
}
