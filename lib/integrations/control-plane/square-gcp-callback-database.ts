import "server-only";

import { Client } from "pg";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { CredentialAadContextSchema, OAuthStateConsumeResultSchema } from "@/lib/integrations/credentials/contracts";
import { credentialAadDigest } from "@/lib/integrations/credentials/kms";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { SquareAccountContextSchema, type SquareAccountContext } from "@/lib/integrations/providers/square/account-connection-contracts";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";
import { checkedSquareSandboxDatabaseUrl } from "@/lib/integrations/control-plane/square-remote-sandbox-database";
import {
  checkedSquareGcpCallbackBinding, type SquareGcpCallbackBinding, type SquareGcpFirstConsentAuthority
} from "@/lib/integrations/control-plane/square-gcp-callback-contracts";

const operations = new Set(["status", "prepare", "create_state", "lookup_state", "consume_state", "deny_state",
  "store_credential", "authorization_failed", "disconnect", "audit"]);
const small = { containers: 20, values: 160, bytes: 16_384, depth: 5, arrayLength: 10, properties: 40, stringLength: 2_048 };
const commandLimits = { containers: 1_055, values: 5_015, bytes: 2_113_536, depth: 10, arrayLength: 1_000, properties: 64, stringLength: 131_072 };
type Consumed = Readonly<{ stateId: string; connectionId: string; connectionGeneration: number;
  expectedConnectionRowVersion: number; consumedAt: string }>;
function denied(): never { throw new Error("square_gcp_callback_database_denied"); }
function json(value: unknown) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 32 * 1_024 * 1_024) denied();
  try { return JSON.parse(value) as unknown; } catch { return denied(); }
}

/** Request-owned actual broker LOGIN only. There is no raw SQL, SET ROLE,
 * service-role fallback, generic RPC, runtime/enroller capability or retry API.
 * Database connection material is never returned or used as a log message. */
export async function openSquareGcpCallbackDatabase(value: string, signal?: AbortSignal) {
  if (signal?.aborted) denied();
  const { connectionString, login } = checkedSquareSandboxDatabaseUrl(value);
  const ca = process.env.SQUARE_SANDBOX_DATABASE_CA_PEM;
  if (ca && (ca.length > 16_384 || !ca.startsWith("-----BEGIN CERTIFICATE-----"))) denied();
  const database = new Client({ connectionString, ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 6_000,
    application_name: "square_gcp_callback_v1", idle_in_transaction_session_timeout: 10_000 });
  let closed = false, active = false;
  let lookup: Readonly<{ context: SquareAccountContext; command: Record<string, unknown>; rowVersion: number }> | undefined;
  let consumed: Readonly<{ context: SquareAccountContext; consent: Consumed }> | undefined;
  let attemptedConsume = false, pinnedAad: string | undefined;
  const aborted = () => { void close(); };
  const checkOpen = () => { if (closed || signal?.aborted) denied(); };
  async function close() {
    if (closed) return;
    closed = true; lookup = undefined; consumed = undefined; pinnedAad = undefined;
    signal?.removeEventListener("abort", aborted);
    try { await database.end(); } catch { /* No database diagnostics leave this boundary. */ }
  }
  database.on("error", () => { void close(); });
  signal?.addEventListener("abort", aborted, { once: true });
  async function binding(): Promise<SquareGcpCallbackBinding> {
    checkOpen();
    const response = await database.query("select public.get_square_gcp_callback_binding_v1()::text as value");
    checkOpen();
    if (response.rows.length !== 1) denied();
    const result = checkedSquareGcpCallbackBinding(json(response.rows[0].value));
    if (result.brokerLogin !== login) denied();
    return result;
  }
  try {
    await database.connect();
    checkOpen();
    const approved = await binding(), approvedCanonical = canonicalContractJson(approved);
    async function transaction<T>(work: () => Promise<T>): Promise<T> {
      if (closed || active) denied();
      active = true;
      try {
        await database.query("begin isolation level read committed");
        checkOpen();
        if (canonicalContractJson(await binding()) !== approvedCanonical) denied();
        const result = await work();
        checkOpen();
        if (canonicalContractJson(await binding()) !== approvedCanonical) denied();
        checkOpen();
        await database.query("commit");
        // Cancellation can race the COMMIT acknowledgement; never report an
        // accepted result or retry. Existing checked status/CAS resolves it.
        checkOpen();
        return result;
      } catch { await close(); return denied(); }
      finally { active = false; }
    }
    const client: ExternalIntegrationsRpcClient = Object.freeze({
      async rpc(name, input) {
        if (name !== "square_account_connection_v1") denied();
        const args = snapshotSquareDurableJson(input, commandLimits) as Record<string, unknown>;
        if (!args || Object.keys(args).sort().join(",") !== "p_command,p_context,p_operation" ||
          typeof args.p_operation !== "string" || !operations.has(args.p_operation)) denied();
        const context = snapshotSquareDurableJson(SquareAccountContextSchema.parse(args.p_context), small) as SquareAccountContext;
        const operation = args.p_operation, command = args.p_command as Record<string, unknown>;
        if (context.actor.actorId !== approved.operatorId || context.actor.workspaceId !== approved.workspaceId ||
          context.actor.role !== approved.operatorRole || context.environment !== approved.environment ||
          context.applicationId !== approved.applicationId || context.redirectUri !== approved.applicationOrigin + "/api/integrations/square/callback") denied();
        if (operation === "consume_state") {
          if (attemptedConsume || !lookup || canonicalContractJson(context) !== canonicalContractJson(lookup.context) ||
            command.stateHash !== lookup.command.stateHash || command.connectionId !== lookup.command.connectionId ||
            command.connectionGeneration !== lookup.command.connectionGeneration) denied();
          attemptedConsume = true;
        }
        if (operation === "store_credential") {
          const credential = command.command as Record<string, unknown>;
          if (!consumed || !pinnedAad || !credential || credential.oauthStateId !== consumed.consent.stateId ||
            credential.connectionId !== consumed.consent.connectionId || credential.connectionGeneration !== consumed.consent.connectionGeneration ||
            credential.expectedConnectionRowVersion !== consumed.consent.expectedConnectionRowVersion ||
            canonicalContractJson(context) !== canonicalContractJson(consumed.context)) denied();
          const aad = CredentialAadContextSchema.parse(JSON.parse(pinnedAad));
          if (credential.id !== aad.credentialId || credential.aadDigest !== credentialAadDigest(aad)) denied();
        }
        const data = await transaction(async () => {
          const response = await database.query("select public.square_gcp_callback_account_v1($1::jsonb,$2::text,$3::jsonb)::text as value",
            [JSON.stringify(context), operation, JSON.stringify(command)]);
          if (response.rows.length !== 1) denied();
          return json(response.rows[0].value);
        });
        if (operation === "lookup_state") {
          const result = snapshotSquareDurableJson(data, small) as Record<string, unknown>;
          if (result.accepted === true) {
            if (attemptedConsume || !Number.isSafeInteger(result.rowVersion) || Number(result.rowVersion) < 1) denied();
            lookup = Object.freeze({ context, command: result.command as Record<string, unknown>, rowVersion: Number(result.rowVersion) });
          } else lookup = undefined;
        }
        if (operation === "consume_state") {
          const result = OAuthStateConsumeResultSchema.parse(data);
          if (result.accepted) {
            if (!lookup || result.connectionId !== lookup.command.connectionId || result.connectionGeneration !== lookup.command.connectionGeneration ||
              result.stateId !== lookup.command.id || result.workspaceId !== approved.workspaceId || result.businessEntityId !== approved.businessEntityId) denied();
            consumed = Object.freeze({ context, consent: Object.freeze({ stateId: result.stateId, connectionId: result.connectionId,
              connectionGeneration: result.connectionGeneration, expectedConnectionRowVersion: lookup.rowVersion, consumedAt: result.consumedAt }) });
          }
          lookup = undefined;
        }
        if (operation === "authorization_failed" || operation === "disconnect" || operation === "deny_state") {
          consumed = undefined; lookup = undefined; pinnedAad = undefined;
        }
        return { data, error: null };
      }
    });
    const authorizeFirstConsent: SquareGcpFirstConsentAuthority = async request => {
      try {
      // No state ID/environment/serialized assertion can activate this closure.
      // It is armed only above after this connection's successful consume COMMIT.
      if (!consumed || !request.signal || request.signal.aborted ||
        !["application_secret", "credential_encrypt"].includes(request.purpose)) denied();
      const current = consumed;
      if (request.purpose === "application_secret") {
        if (request.aadContext !== undefined || pinnedAad !== undefined) denied();
      } else {
        const aad = CredentialAadContextSchema.parse(snapshotSquareDurableJson(request.aadContext, small));
        if (aad.providerKey !== "square" || aad.environment !== "sandbox" || aad.workspaceId !== approved.workspaceId ||
          aad.connectionId !== current.consent.connectionId || aad.connectionGeneration !== current.consent.connectionGeneration) denied();
        const canonical = canonicalContractJson(aad);
        if (pinnedAad !== undefined && pinnedAad !== canonical) denied();
        pinnedAad = canonical;
      }
      return await transaction(async () => {
        if (request.signal.aborted || current !== consumed) denied();
        const response = await database.query("select public.check_square_gcp_callback_consent_v1($1::jsonb,$2::jsonb)::text as value",
          [JSON.stringify(current.context), JSON.stringify(current.consent)]);
        if (response.rows.length !== 1 || request.signal.aborted || current !== consumed) denied();
        const checked = checkedSquareGcpCallbackBinding(json(response.rows[0].value));
        if (canonicalContractJson(checked) !== approvedCanonical) denied();
        return checked;
      });
      } catch { return denied(); }
    };
    const recheckBinding = () => transaction(binding);
    return Object.freeze({ binding: approved, client, authorizeFirstConsent, recheckBinding, close });
  } catch { await close(); return denied(); }
}
