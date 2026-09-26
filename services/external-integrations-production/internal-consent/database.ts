import "server-only";
import type { InternalRpc } from "./handlers";

type Database = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};

const operations = {
  oauth: new Set(["create_state", "consume_state", "deny_state", "reconcile_state", "confirm_mapping"]),
  broker: new Set(["acquire_exchange", "reconcile_acquire", "commit_credential", "reconcile_exchange", "read_credential"]),
  runtime: new Set(["create_scan", "acquire_page", "commit_page"]),
  evidence: new Set(["read"])
};
const sql = {
  oauth: "select public.square_production_internal_oauth_v1($1::text,$2::jsonb) as value",
  broker: "select public.square_production_internal_broker_v1($1::text,$2::jsonb) as value",
  runtime: "select public.square_production_internal_runtime_v1($1::text,$2::jsonb) as value",
  evidence: "select public.square_production_internal_evidence_v1($1::text,$2::jsonb) as value"
};

/** The opener uses the corresponding existing native LOGIN and pinned TLS
 * secret delivery, never postgres/service-role. A request-owned connection is
 * closed even after a lost acknowledgment; reconciliation opens a fresh one.
 * Only the already-granted capability and exact migration-25 RPC are used.
 */
export function createInternalRpc(profile: "oauth" | "broker" | "runtime" | "evidence", open: () => Promise<Database>): InternalRpc {
  if (!Object.hasOwn(operations, profile)) throw new Error("square_internal_database_profile_denied");
  return async (operation, payload) => {
    if (!operations[profile].has(operation)) throw new Error("square_internal_database_operation_denied");
    let database: Database | undefined;
    try {
      database = await open();
      const identity = await database.query("select session_user::text as login, current_user::text as current_login");
      if (identity.rows.length !== 1 || identity.rows[0].login !== `square_production_${profile}` ||
        identity.rows[0].current_login !== `square_production_${profile}`) throw new Error("identity");
      // Native admission grants INHERIT TRUE, SET FALSE. Execute only the fixed
      // RPC through inherited permission, retaining the exact LOGIN identity.
      const result = await database.query(sql[profile], [operation, JSON.stringify(payload)]);
      if (result.rows.length !== 1 || result.rows[0].value === null || result.rows[0].value === undefined) throw new Error("result");
      return result.rows[0].value;
    } catch { throw new Error("square_internal_database_result_unavailable"); }
    finally { if (database) try { await database.end(); } catch { /* Never expose connection diagnostics. */ } }
  };
}

const customerOperations = {
  oauth: new Set(["lookup_state", "consume_state", "deny_state", "authorization_failed"]),
  broker: new Set(["acquire_exchange", "authorize_exchange", "commit_credential"])
};

/** The customer callback and broker share only this fixed customer RPC.
 * Browser owner operations use the signed authenticated Supabase session and
 * never obtain either native LOGIN or a generic table capability. */
export function createCustomerRpc(profile: "oauth" | "broker", open: () => Promise<Database>): InternalRpc {
  return async (operation, payload) => {
    if (!customerOperations[profile].has(operation)) throw new Error("square_customer_database_operation_denied");
    let database: Database | undefined;
    try {
      database = await open();
      const identity = await database.query("select session_user::text as login, current_user::text as current_login");
      if (identity.rows.length !== 1 || identity.rows[0].login !== `square_production_${profile}` ||
        identity.rows[0].current_login !== `square_production_${profile}`) throw new Error("identity");
      const result = await database.query("select public.square_production_customer_v1($1::text,$2::jsonb) as value",
        [operation, JSON.stringify(payload)]);
      if (result.rows.length !== 1 || result.rows[0].value === null || result.rows[0].value === undefined) throw new Error("result");
      return result.rows[0].value;
    } catch { throw new Error("square_customer_database_result_unavailable"); }
    finally { if (database) try { await database.end(); } catch { /* Keep diagnostics private. */ } }
  };
}
