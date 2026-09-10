import "server-only";

import { Client } from "pg";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";
import { checkedSquareSandboxDatabaseUrl } from "./square-remote-sandbox-database";
import { checkedSquareGcpCallbackDatabaseCa } from "./square-gcp-callback-database";
import { checkedSquareGcpMappedBinding, type SquareGcpMappedRole } from "./square-gcp-mapped-contracts";

const rpc = {
  square_account_connection_v1: ["broker", "square_gcp_mapped_account_v1", ["p_context", "p_operation", "p_command"], ["jsonb", "text", "jsonb"]],
  enroll_square_verified_connection_v1: ["enroller", "enroll_square_gcp_verified_connection_v1", ["p_context", "p_command"], ["jsonb", "jsonb"]],
  enroll_square_verified_task_v1: ["enroller", "enroll_square_gcp_verified_task_v1", ["p_command"], ["jsonb"]],
  resolve_square_ingestion_authority_v1: ["runtime", "resolve_square_gcp_ingestion_authority_v1", ["p_task_id", "p_lease_owner_fingerprint"], ["uuid", "text"]],
  acquire_square_ingestion_page_v1: ["runtime", "acquire_square_gcp_ingestion_page_v1", ["p_task_id", "p_lease_owner_fingerprint", "p_binding"], ["uuid", "text", "jsonb"]],
  commit_square_ingestion_page_v1: ["runtime", "commit_square_gcp_ingestion_page_v1", ["p_task_id", "p_lease_owner_fingerprint", "p_command"], ["uuid", "text", "jsonb"]],
  release_square_ingestion_page_v1: ["runtime", "release_square_gcp_ingestion_page_v1", ["p_task_id", "p_lease_owner_fingerprint", "p_lease", "p_release"], ["uuid", "text", "jsonb", "jsonb"]]
} as const;
const brokerOperations = new Set(["confirm_mapping", "credential_metadata", "read_credential", "read_failure", "audit"]);
const loginKey = { broker: "brokerLogin", enroller: "enrollerLogin", runtime: "runtimeLogin" } as const;
function denied(): never { throw new Error("square_gcp_mapped_database_denied"); }
function json(value: unknown) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 32 * 1024 * 1024) denied();
  return JSON.parse(value) as unknown;
}

/** No SQL, role switching, credential fallback or implicit retries. Each handle
 * belongs to one actual native LOGIN and closes on cancellation/uncertain commit. */
export async function openSquareGcpMappedDatabase(role: SquareGcpMappedRole, dsn: string, ca: string, signal: AbortSignal) {
  const target = checkedSquareSandboxDatabaseUrl(dsn);
  const client = new Client({ connectionString: target.connectionString,
    ssl: { rejectUnauthorized: true, ca: checkedSquareGcpCallbackDatabaseCa(ca) },
    connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000,
    idle_in_transaction_session_timeout: 10000, application_name: "square_gcp_mapped_v1" });
  let closed = false, active = false;
  async function close() {
    if (closed) return;
    closed = true; signal.removeEventListener("abort", abort);
    try { await client.end(); } catch { /* Never expose database payloads. */ }
  }
  const abort = () => { void close(); };
  const live = () => { if (closed || signal.aborted) denied(); };
  client.on("error", abort); signal.addEventListener("abort", abort, { once: true });
  async function binding() {
    live();
    const result = await client.query("select public.get_square_gcp_mapped_runtime_binding_v1()::text as value");
    live();
    if (result.rows.length !== 1) denied();
    const value = checkedSquareGcpMappedBinding(json(result.rows[0].value));
    if (value.capability !== role || value[loginKey[role]] !== target.login) denied();
    return value;
  }
  try {
    live(); await client.connect(); live();
    const approved = await binding(), expected = canonicalContractJson(approved);
    const recheckBinding = async () => {
      if (active) denied();
      const current = await binding();
      if (canonicalContractJson(current) !== expected) denied();
      return current;
    };
    const adapter: ExternalIntegrationsRpcClient = Object.freeze({
      async rpc(name, input) {
        live();
        if (active || !Object.hasOwn(rpc, name)) denied();
        const [capability, functionName, keys, types] = rpc[name as keyof typeof rpc];
        if (capability !== role) denied();
        const args = snapshotSquareDurableJson(input, { containers: 66004, values: 7200010,
          bytes: 64 * 1024 * 1024 + 8192, depth: 66, arrayLength: 3000, properties: 64, stringLength: 131072 }) as Record<string, unknown>;
        if (!args || Object.keys(args).sort().join(",") !== [...keys].sort().join(",")) denied();
        if (role === "broker" && (typeof args.p_operation !== "string" || !brokerOperations.has(args.p_operation))) denied();
        active = true;
        try {
          await client.query("begin isolation level read committed");
          if (canonicalContractJson(await binding()) !== expected) denied();
          const commitPage = name === "commit_square_ingestion_page_v1";
          if (commitPage) await client.query("set local statement_timeout='20s'");
          const query = {
            text: `select public.${functionName}(${types.map((type, i) => `$${i + 1}::${type}`).join(",")})::text as value`,
            values: keys.map((key, i) => types[i] === "jsonb" ? JSON.stringify(args[key]) : args[key]),
            query_timeout: commitPage ? 21000 : 6000
          };
          const result = await client.query(query);
          live();
          if (result.rows.length !== 1) denied();
          const data = result.rows[0].value === null ? null : json(result.rows[0].value);
          if (commitPage) await client.query("set local statement_timeout='5s'");
          if (canonicalContractJson(await binding()) !== expected) denied();
          await client.query("commit"); live();
          return { data, error: null };
        } catch { await close(); return denied(); }
        finally { active = false; }
      }
    });
    return Object.freeze({ binding: approved, client: adapter, recheckBinding, close });
  } catch { await close(); return denied(); }
}
