import "server-only";

import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { qboDatabaseConfiguration } from "./database-config";

type PgClient = Readonly<{
  query(sql: string | Readonly<{ text: string; values?: readonly unknown[]; query_timeout: number }>, values?: readonly unknown[]): Promise<{ rows: Array<{ data?: unknown }> }>;
  release(destroy?: boolean): void;
}>;
type PgPool = Readonly<{
  connect(): Promise<PgClient>; end(): Promise<void>;
  totalCount?: number; idleCount?: number; waitingCount?: number;
  on?(event: "error", listener: () => void): void;
}>;

export type QboProductionDatabaseSession = Readonly<{
  role(role: string): ExternalIntegrationsRpcClient;
  checkConnectivity(): Promise<void>;
  close(): Promise<void>;
}>;

// pg has no bundled declarations in this pinned service dependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require("pg") as {
  Pool: new (options: Record<string, unknown>) => PgPool;
};

const productionRoles = new Set([
  "integration_oauth_ingress_authority",
  "integration_credential_broker_authority",
  "integration_control_plane_authority",
  "integration_webhook_ingress_authority",
  "integration_task_scheduler_authority",
  "integration_task_dispatch_authority",
  "integration_provider_runtime_authority",
  "integration_provider_source_authority"
]);

// pg encodes JavaScript arrays as PostgreSQL arrays. These two arguments are
// explicitly JSONB; reason-code text[] arguments retain normal pg encoding.
const jsonArrayArguments: Readonly<Record<string, readonly string[]>> = {
  commit_qbo_accounting_source_v1: ["p_facts"],
  commit_qbo_accounting_calculation_v1: ["p_nodes"]
};

function identifier(value: string, allowed?: ReadonlySet<string>) {
  if (!/^[a-z][a-z0-9_]*$/.test(value) || (allowed && !allowed.has(value))) {
    throw new Error("qbo_production_database_identifier_denied");
  }
  return value;
}

export class QboProductionDatabase {
  readonly #pool: PgPool;
  readonly #roles: ReadonlySet<string>;
  #closed = false;
  #idleErrors = 0;

  constructor(connectionString: string, roles: readonly string[], ca = process.env.QBO_DATABASE_CA_PEM ?? "") {
    if (roles.length === 0 || roles.length > productionRoles.size) {
      throw new Error("qbo_production_database_roles_invalid");
    }
    this.#roles = new Set(roles.map((role) => identifier(role, productionRoles)));
    this.#pool = new Pool(qboDatabaseConfiguration(connectionString, ca));
    // Idle socket failures must not crash unrelated in-flight handlers. pg removes
    // the failed client; the next acquisition opens a new verified connection.
    this.#pool.on?.("error", () => { this.#idleErrors += 1; });
  }

  /** Request authority shares only the transport pool, never transaction state. */
  request(remainingMilliseconds?: () => number): QboProductionDatabaseSession {
    let closed = false;
    const assertOpen = () => {
      if (closed || this.#closed) throw new Error("qbo_production_database_session_closed");
      remainingMilliseconds?.();
    };
    return {
      role: (role) => {
        assertOpen();
        const client = this.role(role, remainingMilliseconds);
        return { rpc: (name, args) => { assertOpen(); return client.rpc(name, args); } };
      },
      checkConnectivity: async () => { assertOpen(); await this.checkConnectivity(); },
      close: async () => { closed = true; }
    };
  }

  statistics() {
    return { total: this.#pool.totalCount ?? 0, idle: this.#pool.idleCount ?? 0,
      waiting: this.#pool.waitingCount ?? 0, idleErrors: this.#idleErrors };
  }

  role(role: string, remainingMilliseconds?: () => number): ExternalIntegrationsRpcClient {
    const checkedRole = identifier(role, this.#roles);
    return {
      rpc: async (name, args) => {
        const functionName = identifier(name);
        const entries = Object.entries(args);
        if (entries.length === 0 || entries.length > 16) {
          throw new Error("qbo_production_database_rpc_arguments_invalid");
        }
        const parameters = entries.map(([key], index) =>
          `${identifier(key)} => $${index + 1}`
        );
        if (this.#closed) throw new Error("qbo_production_database_session_closed");
        remainingMilliseconds?.();
        const client = await this.#connect(remainingMilliseconds);
        let destroy = false;
        const query = (text: string, values?: readonly unknown[]) => remainingMilliseconds
          ? client.query({ text, values, query_timeout: Math.max(1, Math.ceil(remainingMilliseconds())) })
          : client.query(text, values);
        try {
          await query("begin");
          await query(`set local role ${checkedRole}`);
          if (remainingMilliseconds) {
            // Both server cancellation and the client response wait are bounded.
            // SET LOCAL disappears on commit/rollback before this socket is reused.
            await query("select set_config('statement_timeout', case when current_setting('statement_timeout') = '0' then $1::text else least(extract(epoch from current_setting('statement_timeout')::interval) * 1000, $1::numeric)::bigint::text end, true)",
              [String(Math.max(1, Math.ceil(remainingMilliseconds())))]);
          }
          const result = await query(
            `select public.${functionName}(${parameters.join(", ")}) as data`,
            entries.map(([key, value]) => jsonArrayArguments[functionName]?.includes(key) ? JSON.stringify(value) : value)
          );
          await query("commit");
          return { data: result.rows[0]?.data ?? null, error: null };
        } catch (error) {
          try { await query("rollback"); } catch { destroy = true; }
          // A failed rollback or exhausted response budget leaves socket/commit
          // outcome uncertain. Never hand its role/transaction state to a peer.
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "unknown";
          return {
            data: null,
            error: { code, message: "qbo_production_database_rpc_failed" }
          };
        } finally {
          client.release(destroy);
        }
      }
    };
  }

  async #connect(remainingMilliseconds?: () => number): Promise<PgClient> {
    if (!remainingMilliseconds) return this.#pool.connect();
    const timeout = Math.max(1, Math.ceil(remainingMilliseconds()));
    return new Promise((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        reject(new Error("qbo_production_database_acquisition_budget_exhausted"));
      }, timeout);
      this.#pool.connect().then((client) => {
        clearTimeout(timer);
        // pg cannot cancel a queued acquisition. Release its eventual socket;
        // the abandoned request must never start SQL after its deadline.
        if (expired) client.release(); else resolve(client);
      }, (error) => { clearTimeout(timer); if (!expired) reject(error); });
    });
  }

  async checkConnectivity() {
    if (this.#closed) throw new Error("qbo_production_database_session_closed");
    const client = await this.#pool.connect();
    client.release();
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#pool.end();
  }
}
