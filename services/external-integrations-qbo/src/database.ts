import "server-only";

import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { qboDatabaseConfiguration } from "./database-config";

type PgClient = Readonly<{
  query(sql: string, values?: readonly unknown[]): Promise<{ rows: Array<{ data?: unknown }> }>;
  release(): void;
}>;
type PgPool = Readonly<{ connect(): Promise<PgClient>; end(): Promise<void> }>;

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

  constructor(connectionString: string, roles: readonly string[], ca = process.env.QBO_DATABASE_CA_PEM ?? "") {
    if (roles.length === 0 || roles.length > productionRoles.size) {
      throw new Error("qbo_production_database_roles_invalid");
    }
    this.#roles = new Set(roles.map((role) => identifier(role, productionRoles)));
    this.#pool = new Pool(qboDatabaseConfiguration(connectionString, ca));
  }

  role(role: string): ExternalIntegrationsRpcClient {
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
        const client = await this.#pool.connect();
        try {
          await client.query("begin");
          await client.query(`set local role ${checkedRole}`);
          const result = await client.query(
            `select public.${functionName}(${parameters.join(", ")}) as data`,
            entries.map(([key, value]) => jsonArrayArguments[functionName]?.includes(key) ? JSON.stringify(value) : value)
          );
          await client.query("commit");
          return { data: result.rows[0]?.data ?? null, error: null };
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "unknown";
          return {
            data: null,
            error: { code, message: "qbo_production_database_rpc_failed" }
          };
        } finally {
          client.release();
        }
      }
    };
  }

  async checkConnectivity() {
    const client = await this.#pool.connect();
    client.release();
  }

  async close() {
    await this.#pool.end();
  }
}
