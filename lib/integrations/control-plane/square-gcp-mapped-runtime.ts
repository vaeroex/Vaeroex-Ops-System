import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { IntegrationCredentialBroker, ProviderAccessCredential } from "@/lib/integrations/credentials/broker";
import { credentialAadDigest } from "@/lib/integrations/credentials/kms";
import { ProviderCredentialReadResultSchema, type ReadProviderCredentialCommand } from "@/lib/integrations/credentials/contracts";
import { createSquareAccountBrokerStore, squareAccountRpc, squareCredentialReadLeaseId } from "@/lib/integrations/providers/square/account-connection-broker";
import { createSquareOAuthPolicy, createSquareOAuthCredentialProvider, SQUARE_OAUTH_SCOPES } from "@/lib/integrations/providers/square/account-connection-oauth";
import { createSquareDatabaseAuthority } from "@/lib/integrations/providers/square/durable-authority";
import { createSquareDurablePageRepository } from "@/lib/integrations/providers/square/durable-page-repository";
import { createSquareDormantIngestionAdapter } from "@/lib/integrations/providers/square/ingestion-adapter";
import { createSquareAccountMapping } from "@/lib/integrations/providers/square/account-mapping";
import { assertSquareReadOperation } from "@/lib/integrations/providers/square/request-validators";
import type { SquarePageLease, SquarePageBinding, SquareSyntheticTransport } from "@/lib/integrations/providers/square/ingestion-contracts";
import { createSquareGcpCallbackIdentity } from "./square-gcp-callback-identity";
import { readSquareGcpCallbackDatabaseSecret } from "./square-gcp-callback-credentials";
import { checkedSquareGcpMappedBinding, squareGcpMappedHost, type SquareGcpMappedBinding, type SquareGcpMappedRole } from "./square-gcp-mapped-contracts";
import { openSquareGcpMappedDatabase } from "./square-gcp-mapped-database";
import { createSquareGcpMappedCredentials, readSquareGcpMappedDatabaseSecret } from "./square-gcp-mapped-credentials";

type Input = Readonly<{ binding: SquareGcpMappedBinding; databaseCa: string; network: typeof fetch }>;
function denied(): never { throw new Error("square_gcp_mapped_runtime_denied"); }
export function squareGcpMappedContext(binding: SquareGcpMappedBinding) {
  const b = checkedSquareGcpMappedBinding(binding);
  return Object.freeze({ actor: Object.freeze({ actorId: b.operatorId, workspaceId: b.workspaceId,
    sessionId: b.operatorSessionId, role: b.operatorRole }), environment: "sandbox" as const,
    applicationId: b.applicationId, redirectUri: b.applicationOrigin + "/api/integrations/square/callback" });
}
async function openRole(input: Input, role: SquareGcpMappedRole, signal: AbortSignal) {
  const binding = checkedSquareGcpMappedBinding({ ...input.binding, capability: role });
  const host = squareGcpMappedHost(binding);
  const identity = createSquareGcpCallbackIdentity({ binding: host, network: input.network, signal });
  let dsn = "";
  let database: Awaited<ReturnType<typeof openSquareGcpMappedDatabase>> | undefined;
  try {
    dsn = role === "broker" ? await readSquareGcpCallbackDatabaseSecret({ binding: host, identity, network: input.network, signal })
      : await readSquareGcpMappedDatabaseSecret({ binding, identity, network: input.network, signal });
    database = await openSquareGcpMappedDatabase(role, dsn, input.databaseCa, signal);
    if (canonicalContractJson(database.binding) !== canonicalContractJson(binding)) denied();
    return database;
  } catch { await database?.close(); return denied(); }
  finally { dsn = ""; identity.dispose(); }
}

/** Applies only the operator-approved binding's location, under its still-valid
 * actor session. This does not mint authority, enroll or call Square. */
export async function confirmNativeSquareGcpMappedLocation(input: Input, signal: AbortSignal) {
  const db = await openRole(input, "broker", signal);
  try {
    const result = await createSquareAccountMapping({ client: db.client, context: squareGcpMappedContext(db.binding) }).confirm({
      connectionId: db.binding.connectionId, businessEntityId: db.binding.businessEntityId,
      locationIds: [db.binding.defaultLocationId], confirmation: "map"
    });
    return z.object({ confirmed: z.literal(true), generation: z.literal(db.binding.connectionGeneration) }).strict().parse(result);
  } catch { return denied(); } finally { await db.close(); }
}

/** Opens the distinct enroller LOGIN only after checked mapping exists. */
export async function enrollNativeSquareGcpMappedConnection(input: Input, signal: AbortSignal) {
  const db = await openRole(input, "enroller", signal);
  try {
    const result = await db.client.rpc("enroll_square_verified_connection_v1", {
      p_context: squareGcpMappedContext(db.binding),
      p_command: { connectionId: db.binding.connectionId, generation: db.binding.connectionGeneration }
    });
    if (result.error) denied();
    return z.object({ enrolled: z.literal(true), generation: z.literal(db.binding.connectionGeneration), idempotent: z.boolean() }).strict().parse(result.data);
  } catch { return denied(); } finally { await db.close(); }
}

export async function enrollNativeSquareGcpMappedTask(input: Input, command: unknown, signal: AbortSignal) {
  const db = await openRole(input, "enroller", signal);
  try {
    const result = await db.client.rpc("enroll_square_verified_task_v1", { p_command: command });
    if (result.error) denied();
    return result.data;
  } catch { return denied(); } finally { await db.close(); }
}

/** One bounded, checked page; no loop, scheduler, refresh, consent, automatic
 * retry or economic contribution. Recovery is a new invocation using the same
 * durable task/scan receipt, never an in-process replay of an uncertain commit. */
export async function runNativeSquareGcpMappedPage(input: Input, task: Readonly<{ taskId: string; leaseOwnerFingerprint: string }>, signal: AbortSignal) {
  const taskId = z.string().uuid().parse(task.taskId);
  const owner = z.string().regex(/^sha256:[a-f0-9]{64}$/).parse(task.leaseOwnerFingerprint);
  const b = checkedSquareGcpMappedBinding(input.binding);
  if (!b.mappedProviderCallsEnabled || signal.aborted) denied();
  const runtime = await openRole(input, "runtime", signal);
  let brokerDb: Awaited<ReturnType<typeof openSquareGcpMappedDatabase>> | undefined;
  let credentials: ReturnType<typeof createSquareGcpMappedCredentials> | undefined;
  let lease: SquarePageLease | null = null;
  try {
    brokerDb = await openRole(input, "broker", signal);
    const context = squareGcpMappedContext(b);
    const store = createSquareAccountBrokerStore({ client: brokerDb.client, context });
    let readCommand: ReadProviderCredentialCommand | undefined;
    let expectedRead: ReturnType<typeof ProviderCredentialReadResultSchema.parse> | undefined;
    const stableRead = (value: ReturnType<typeof ProviderCredentialReadResultSchema.parse>) => {
      const copy = { ...value } as Record<string, unknown>; delete copy.credentialReadEvidenceId;
      return canonicalContractJson(copy);
    };
    const identity = createSquareGcpCallbackIdentity({ binding: squareGcpMappedHost(runtime.binding), network: input.network, signal });
    credentials = createSquareGcpMappedCredentials({ binding: runtime.binding, identity, network: input.network, signal,
      authorizeCredentialRead: async ({ aadContext }) => {
        if (!readCommand || !expectedRead || expectedRead.state !== "available" || !lease || lease.expiresAt <= Date.now() || signal.aborted ||
          expectedRead.aadDigest !== credentialAadDigest(aadContext)) denied();
        const current = ProviderCredentialReadResultSchema.parse(await store.readProviderCredential(readCommand, randomUUID()));
        if (current.state !== "available" || stableRead(current) !== stableRead(expectedRead)) denied();
        await brokerDb!.recheckBinding();
        return runtime.recheckBinding();
      }
    });
    const policy = createSquareOAuthPolicy({ environment: "sandbox", applicationId: b.applicationId,
      redirectUri: context.redirectUri, returnPath: "/app/settings/integrations/square" });
    const broker = new IntegrationCredentialBroker({ store: Object.freeze({ ...store,
      readProviderCredential: async (command, requestId) => {
        if (readCommand) denied(); readCommand = command;
        const result = await store.readProviderCredential(command, requestId);
        expectedRead = ProviderCredentialReadResultSchema.parse(result); return result;
      }
    }), kms: credentials.kms, kmsKeyResource: b.kmsKeyResource,
      secrets: Object.freeze({ access: async () => denied() }), providerOAuthPolicy: policy,
      provider: createSquareOAuthCredentialProvider({ policy, applicationId: b.applicationId, transport: async () => denied() }) });
    const dependencies = { client: runtime.client, taskId, leaseOwnerFingerprint: owner };
    const pages = createSquareDurablePageRepository(dependencies);
    const authority = createSquareDatabaseAuthority(dependencies);
    let requests = 0;
    const transport: SquareSyntheticTransport = async request => {
      if (++requests !== 1 || !lease || signal.aborted || request.signal.aborted || request.headers.Authorization !== "Bearer square-synthetic-fixture") denied();
      const headers = { ...request.headers }; delete headers.Authorization;
      const decision = assertSquareReadOperation({ providerKey: "square", providerEnvironment: "sandbox",
        url: request.url, method: request.method, headers, body: request.body,
        expectedCursorBindingFingerprint: lease.binding.cursorBindingFingerprint });
      if (decision.providerEnvironment !== "sandbox") denied();
      const metadata = z.object({ connectionId: z.literal(b.connectionId), businessEntityId: z.literal(b.businessEntityId),
        generation: z.literal(b.connectionGeneration), credentialId: z.string().uuid(), credentialVersion: z.number().int().positive().safe()
      }).strict().parse(await squareAccountRpc(brokerDb!.client, context, "credential_metadata", { connectionId: b.connectionId }));
      const access = await broker.readProviderAccessCredential({ taskId, leaseId: squareCredentialReadLeaseId(lease.leaseId),
        leaseOwnerFingerprint: owner, expectedCredentialVersion: metadata.credentialVersion,
        requiredScopes: SQUARE_OAUTH_SCOPES, minimumValiditySeconds: 30, requestId: randomUUID() });
      if (access.state !== "available" || !(access.credential instanceof ProviderAccessCredential)) denied();
      return access.credential.use(async ({ accessToken }) => {
        await runtime.recheckBinding(); await brokerDb!.recheckBinding();
        if (!lease || lease.expiresAt <= Date.now() || signal.aborted || request.signal.aborted) denied();
        const response = await input.network(request.url, { method: request.method, headers: { ...headers, Authorization: `Bearer ${accessToken}` },
          body: request.body, signal: request.signal, redirect: "manual", cache: "no-store", credentials: "omit" });
        if (response.redirected || response.status >= 300 && response.status < 400 || !response.body || response.url && response.url !== request.url) {
          await response.body?.cancel().catch(() => undefined); denied();
        }
        const reader = response.body.getReader(); let closed = false;
        const cancel = async () => { if (closed) return; closed = true; request.signal.removeEventListener("abort", abort);
          try { await reader.cancel(); } catch { /* Sanitized by consumer. */ } try { reader.releaseLock(); } catch { /* Pending read. */ } };
        const abort = () => { void cancel(); };
        request.signal.addEventListener("abort", abort, { once: true });
        if (request.signal.aborted) { await cancel(); denied(); }
        async function* body() { try { while (!closed) { const next = await reader.read(); if (next.done) return; yield next.value; } } finally { await cancel(); } }
        return Object.freeze({ status: response.status, url: response.url || request.url, redirected: false,
          headers: Object.freeze({ "retry-after": response.headers.get("retry-after") ?? "" }), body: body(), cancel });
      });
    };
    const adapter = createSquareDormantIngestionAdapter({ authority, transport, repository: Object.freeze({ ...pages,
      acquire: async (binding: SquarePageBinding, now: number) => { const result = await pages.acquire(binding, now); if (result.outcome === "leased") lease = result.lease; return result; }
    }) });
    return await adapter.run({ taskId }, signal);
  } catch { return denied(); }
  finally { credentials?.dispose(); await brokerDb?.close(); await runtime.close(); }
}
