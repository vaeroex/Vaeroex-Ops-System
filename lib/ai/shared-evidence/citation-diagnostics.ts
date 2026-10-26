import "server-only";

type Stage = "rpc_start" | "rpc_read" | "envelope" | "projection" | "unexpected";
type Category = "authorization" | "lookup" | "stale_binding" | "eligibility" | "timeout" | "cancellation" |
  "transport" | "rpc_contract" | "rpc_failure" | "budget" | "response_validation" |
  "projection_validation" | "unexpected";
const reasons = {
  owner_required: "authorization", live_session_required: "authorization", actor_denied: "authorization",
  permission_denied: "authorization", artifact_lookup_unavailable: "lookup", source_lookup_unavailable: "lookup",
  source_binding_changed: "stale_binding", source_unavailable: "eligibility", artifact_revalidation_failed: "rpc_failure",
  read_deadline_exceeded: "timeout", database_query_canceled: "cancellation", gateway_timeout: "timeout",
  request_failed: "transport", rpc_contract_unavailable: "rpc_contract", database_error: "rpc_failure",
  request_creation_failed: "rpc_failure", reconstruction_budget_exceeded: "budget",
  response_shape_invalid: "response_validation", ancestor_shape_invalid: "projection_validation",
  workspace_mismatch: "projection_validation", memory_projection_invalid: "projection_validation",
  unexpected_failure: "unexpected"
} as const satisfies Record<string, Category>;
type Reason = keyof typeof reasons;
const sqlCodes = new Set(["42501", "40001", "22023", "54000", "57014", "42883", "42P01", "PGRST202", "PGRST301", "PGRST302"]);
const httpStatuses = new Set([0, 400, 401, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504]);
const rpcReasons: Readonly<Record<string, Reason>> = Object.freeze({
  evidence_owner_required: "owner_required", evidence_live_session_required: "live_session_required",
  shared_evidence_actor_denied: "actor_denied", shared_evidence_inherited_actor_denied: "actor_denied",
  shared_reopen_unavailable: "artifact_lookup_unavailable", shared_target_unavailable: "artifact_lookup_unavailable",
  shared_evidence_inherited_artifact_denied: "artifact_lookup_unavailable",
  evidence_reference_unavailable: "source_lookup_unavailable", shared_evidence_reference_denied: "source_lookup_unavailable",
  evidence_binding_changed: "source_binding_changed", evidence_connection_changed: "source_binding_changed",
  shared_evidence_source_changed: "source_binding_changed", shared_typed_identity_changed: "source_binding_changed",
  evidence_binding_unavailable: "source_unavailable", evidence_connection_unavailable: "source_unavailable",
  evidence_entity_unavailable: "source_unavailable", shared_typed_worksheet_head_denied: "source_unavailable",
  shared_typed_chunk_denied: "source_unavailable", shared_typed_note_denied: "source_unavailable",
  shared_typed_file_denied: "source_unavailable", shared_typed_file_authority_denied: "source_unavailable",
  shared_typed_parent_run_denied: "source_unavailable", shared_typed_qbo_denied: "source_unavailable",
  shared_typed_square_denied: "source_unavailable", shared_semantic_receipt_required: "source_unavailable",
  // This SQL branch combines content integrity and current readability. Do not
  // claim that a changed hash (rather than revoked eligibility) was established.
  shared_evidence_inherited_artifact_changed: "artifact_revalidation_failed",
  shared_reopen_budget_exceeded: "reconstruction_budget_exceeded", evidence_read_budget_exceeded: "reconstruction_budget_exceeded",
  shared_typed_budget_exceeded: "reconstruction_budget_exceeded"
});

export type SharedCitationDiagnostic = Readonly<{
  stage: Stage; category: Category; reason: Reason; elapsedMs: number;
  sqlCode: string | null; httpStatus: number | null;
}>;
const stages = new Set<Stage>(["rpc_start", "rpc_read", "envelope", "projection", "unexpected"]);
const unknownDiagnostic: SharedCitationDiagnostic = Object.freeze({
  stage: "unexpected", category: "unexpected", reason: "unexpected_failure", elapsedMs: 0, sqlCode: null, httpStatus: null
});
// A public Error property can be replaced or forged. Only module-issued,
// immutable diagnostics can cross the logging boundary.
const diagnostics = new WeakMap<object, SharedCitationDiagnostic>();

export class SharedCitationFailure extends Error {
  constructor(stage: Stage, reason: Reason, started: number, code?: unknown, status?: unknown) {
    const valid=stages.has(stage)&&typeof reason==="string"&&Object.hasOwn(reasons,reason);
    super(`shared_citation_unavailable:${valid?reason:"unexpected_failure"}`);
    this.name = "SharedCitationFailure";
    diagnostics.set(this,valid?Object.freeze({ stage, category: reasons[reason], reason,
      elapsedMs: Number.isFinite(started)?Math.min(60_000, Math.max(0, Math.round(performance.now() - started))):0,
      sqlCode: typeof code === "string" && sqlCodes.has(code) ? code : null,
      httpStatus: typeof status === "number" && httpStatuses.has(status) ? status : null }):unknownDiagnostic);
  }
}

/** Only exact, known SQL sentinels are classified; messages/details/hints are never retained. */
export function sharedCitationRpcFailure(error: unknown, status: unknown, started: number) {
  const fields = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = fields.code;
  const known = typeof fields.message === "string" && Object.hasOwn(rpcReasons, fields.message)
    ? rpcReasons[fields.message] : undefined;
  const reason: Reason = known ?? (
    code === "57014" ? "database_query_canceled" :
    status === 408 || status === 504 ? "gateway_timeout" :
    code === "PGRST202" || code === "42883" || code === "42P01" ? "rpc_contract_unavailable" :
    code === "42501" || code === "PGRST301" || code === "PGRST302" || status === 401 || status === 403 ? "permission_denied" :
    status === 0 ? "request_failed" : "database_error");
  return new SharedCitationFailure("rpc_read", reason, started, code, status);
}

/** No raw exception, request/actor/source identity, SQL message, hash or body can escape this boundary. */
export function sharedCitationDiagnostic(error: unknown): SharedCitationDiagnostic {
  return error&&typeof error==="object"?diagnostics.get(error)??unknownDiagnostic:unknownDiagnostic;
}
