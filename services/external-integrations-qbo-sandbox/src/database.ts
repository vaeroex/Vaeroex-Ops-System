import "server-only";

import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

type PgClient = Readonly<{
  query(sql: string, values?: readonly unknown[]): Promise<{ rows: Array<{ data?: unknown }> }>;
  release(): void;
}>;
type PgPool = Readonly<{
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}>;
// pg has no bundled declarations in this pinned runtime dependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require("pg") as {
  Pool: new (options: Record<string, unknown>) => PgPool;
};

const allowedRoles = new Set([
  "external_integrations_authority",
  "deterministic_calculation_authority",
  "integration_oauth_ingress_authority",
  "integration_credential_broker_authority",
  "integration_control_plane_authority",
  "integration_webhook_ingress_authority",
  "integration_task_dispatch_authority",
  "integration_provider_runtime_authority",
  "integration_provider_source_authority",
  "integration_provider_validation_authority"
]);

function checkedIdentifier(value: string, allowed?: ReadonlySet<string>) {
  if (!/^[a-z][a-z0-9_]*$/.test(value) || (allowed && !allowed.has(value))) {
    throw new Error("phase8b_database_identifier_denied");
  }
  return value;
}

export class Phase8bDatabase {
  readonly #pool: PgPool;
  readonly #allowedRoles: ReadonlySet<string>;

  constructor(connectionString: string, roles: readonly string[]) {
    if (roles.length === 0 || roles.length > allowedRoles.size) {
      throw new Error("phase8b_database_roles_invalid");
    }
    this.#allowedRoles = new Set(
      roles.map((role) => checkedIdentifier(role, allowedRoles))
    );
    this.#pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true
    });
  }

  role(role: string): ExternalIntegrationsRpcClient {
    const checkedRole = checkedIdentifier(role, this.#allowedRoles);
    return {
      rpc: async (name, args) => {
        const functionName = checkedIdentifier(name);
        const entries = Object.entries(args);
        if (entries.length === 0 || entries.length > 12) {
          throw new Error("phase8b_database_rpc_arguments_invalid");
        }
        const parameters = entries.map(([key], index) => {
          const parameter = checkedIdentifier(key);
          return `${parameter} => $${index + 1}`;
        });
        const client = await this.#pool.connect();
        try {
          await client.query("begin");
          await client.query(`set local role ${checkedRole}`);
          const result = await client.query(
            `select public.${functionName}(${parameters.join(", ")}) as data`,
            entries.map(([, value]) => value)
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
            error: { code, message: "phase8b_database_rpc_failed" }
          };
        } finally {
          client.release();
        }
      }
    };
  }

  async close() {
    await this.#pool.end();
  }
}
