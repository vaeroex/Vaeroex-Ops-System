import "server-only";

import { Client } from "pg";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";
import {
  checkedSquareRemoteSandboxBinding, SQUARE_REMOTE_SANDBOX, type SquareRemoteSandboxBinding
} from "@/lib/integrations/control-plane/square-remote-sandbox-contracts";

export const SQUARE_REMOTE_DATABASE_ROLES = ["broker", "enroller", "webhook", "runtime"] as const;
export type SquareRemoteDatabaseRole = typeof SQUARE_REMOTE_DATABASE_ROLES[number];
const loginKey = { broker: "brokerLogin", enroller: "enrollerLogin", webhook: "webhookLogin", runtime: "runtimeLogin" } as const;
const queries = {
  square_account_connection_v1: ["broker", ["p_context", "p_operation", "p_command"], ["jsonb", "text", "jsonb"]],
  enroll_square_verified_connection_v1: ["enroller", ["p_context", "p_command"], ["jsonb", "jsonb"]],
  enroll_square_verified_task_v1: ["enroller", ["p_command"], ["jsonb"]],
  record_square_account_revocation_v1: ["webhook", ["p_environment", "p_application_id", "p_event"], ["text", "text", "jsonb"]],
  resolve_square_ingestion_authority_v1: ["runtime", ["p_task_id", "p_lease_owner_fingerprint"], ["uuid", "text"]],
  acquire_square_ingestion_page_v1: ["runtime", ["p_task_id", "p_lease_owner_fingerprint", "p_binding"], ["uuid", "text", "jsonb"]],
  commit_square_ingestion_page_v1: ["runtime", ["p_task_id", "p_lease_owner_fingerprint", "p_command"], ["uuid", "text", "jsonb"]],
  release_square_ingestion_page_v1: ["runtime", ["p_task_id", "p_lease_owner_fingerprint", "p_lease", "p_release"], ["uuid", "text", "jsonb", "jsonb"]]
} as const;

function denied(): never { throw new Error("square_remote_database_denied"); }

/** A DSN is private runtime input. It is never logged, serialized, exposed or used
 * for a different database. Pooler identity includes the exact project suffix;
 * checked DB records independently attest the target and actual session_user. */
export function checkedSquareSandboxDatabaseUrl(value: string) {
  try {
    if (typeof value !== "string" || value.length > 8_192) denied();
    const url = new URL(value);
    const direct = url.hostname === `db.${SQUARE_REMOTE_SANDBOX.projectRef}.supabase.co`;
    const pooled = /^aws-[0-9]+-us-west-2\.pooler\.supabase\.com$/.test(url.hostname);
    const username = decodeURIComponent(url.username);
    const suffix = `.${SQUARE_REMOTE_SANDBOX.projectRef}`;
    const login = pooled && username.endsWith(suffix) ? username.slice(0, -suffix.length) : username;
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:" || (!direct && !pooled) ||
      url.pathname !== "/postgres" || url.hash || !url.password ||
      !/^square_sandbox_[a-z_]{1,40}$/.test(login) ||
      direct && url.port && url.port !== "5432" ||
      pooled && (!["5432", "6543"].includes(url.port) || !username.endsWith(suffix)) ||
      [...url.searchParams.keys()].some(key => key !== "sslmode") || url.searchParams.getAll("sslmode").length > 1 ||
      url.searchParams.has("sslmode") && !["require", "verify-full"].includes(url.searchParams.get("sslmode")!)) denied();
    // Do not let pg-connection-string's sslmode parsing replace strict TLS options.
    url.search = "";
    return { connectionString: url.href, login };
  } catch { return denied(); }
}

function resultJson(value: unknown) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 32 * 1_024 * 1_024) denied();
  try { return JSON.parse(value) as unknown; } catch { return denied(); }
}

/** One request-owned actual LOGIN connection, fixed checked RPCs only. No SET
 * ROLE, generic PostgREST/service-role fallback, DDL, migration, raw query or retry
 * API is exposed. A failed/uncertain transaction closes the connection. */
export async function openSquareRemoteDatabase(role: SquareRemoteDatabaseRole, value: string) {
  const { connectionString, login } = checkedSquareSandboxDatabaseUrl(value);
  const ca = process.env.SQUARE_SANDBOX_DATABASE_CA_PEM;
  if (ca && (ca.length > 16_384 || !ca.startsWith("-----BEGIN CERTIFICATE-----"))) denied();
  const client = new Client({ connectionString,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 6_000,
    application_name: "square_remote_sandbox_v1", idle_in_transaction_session_timeout: 10_000
  });
  // Never emit database messages or error objects (they can contain private input).
  client.on("error", () => { void close(); });
  let closed = false, active = false;
  async function close() {
    if (closed) return;
    closed = true;
    try { await client.end(); } catch { /* Fixed failure only; no diagnostic payload. */ }
  }
  async function binding(): Promise<SquareRemoteSandboxBinding> {
    const result = await client.query("select public.get_square_remote_sandbox_binding_v1()::text as value");
    if (result.rows.length !== 1) denied();
    const value = checkedSquareRemoteSandboxBinding(resultJson(result.rows[0].value));
    if (value[loginKey[role]] !== login) denied();
    return value;
  }
  try {
    await client.connect();
    const approved = await binding();
    const approvedCanonical = canonicalContractJson(approved);
    const rpcClient: ExternalIntegrationsRpcClient = Object.freeze({
      async rpc(name, input) {
        if (closed || active || !Object.hasOwn(queries, name)) denied();
        const [permittedRole, keys, types] = queries[name as keyof typeof queries];
        if (permittedRole !== role) denied();
        const args = snapshotSquareDurableJson(input, {
          containers: 66_004, values: 7_200_010, bytes: 64 * 1_024 * 1_024 + 8_192,
          depth: 66, arrayLength: 3_000, properties: 64, stringLength: 131_072
        }) as Record<string, unknown>;
        if (Object.keys(args).sort().join(",") !== [...keys].sort().join(",")) denied();
        active = true;
        try {
          await client.query("begin");
          // Hold the checked configuration locks with the operation. No warm
          // instance can reuse an old approval after configuration changes.
          if (canonicalContractJson(await binding()) !== approvedCanonical) denied();
          const parameters = keys.map((key, index) => types[index] === "jsonb" ? JSON.stringify(args[key]) : args[key]);
          const sql = `select public.${name}(${types.map((type, index) => `$${index + 1}::${type}`).join(",")})::text as value`;
          // The maximum supported Catalog page takes >8s in disposable-DB
          // qualification. Its atomic checked commit therefore gets 20s, not
          // the 5s control-plane timeout. This does not extend the unchanged
          // 30s page lease/invocation: SQL rechecks expiry before final writes.
          // SET LOCAL is fixed and transaction-scoped; no caller timeout/SQL
          // input exists and every later operation returns to the 5s default.
          const committingPage = name === "commit_square_ingestion_page_v1";
          if (committingPage) await client.query("set local statement_timeout = '20s'");
          const query = { text: sql, values: parameters, query_timeout: committingPage ? 21_000 : 6_000 };
          const result = await client.query(query);
          if (result.rows.length !== 1) denied();
          const data = result.rows[0].value === null ? null : resultJson(result.rows[0].value);
          // A long atomic page must not outlive the NEW host approval, whose
          // expiry can be earlier than the existing account/task/page lease.
          // Re-read with the database clock while all writes are still pending;
          // failure ends/rolls back this transaction instead of acknowledging it.
          // Do not apply this global gate to revocation/fencing RPCs: their own
          // successful capacity latch may intentionally close that very gate.
          if (committingPage) {
            await client.query("set local statement_timeout = '5s'");
            if (canonicalContractJson(await binding()) !== approvedCanonical) denied();
          }
          await client.query("commit");
          return { data, error: null };
        } catch {
          // End rolls back pending work. Lost COMMIT acknowledgements retain the
          // existing durable/idempotent recovery semantics; never replay here.
          await close();
          throw new Error("square_remote_database_failed");
        } finally { active = false; }
      }
    });
    return Object.freeze({ binding: approved, client: rpcClient, close });
  } catch { await close(); return denied(); }
}
