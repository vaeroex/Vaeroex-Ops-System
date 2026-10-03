import "server-only";

import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { createSquareAccountConnectionService } from "@/lib/integrations/providers/square/account-connection-service";
import { createSquareSandboxOAuthTransport } from "@/lib/integrations/control-plane/square-remote-sandbox-transport";
import { createSquareGcpCallbackIdentity } from "@/lib/integrations/control-plane/square-gcp-callback-identity";
import { createSquareGcpCallbackCredentials, readSquareGcpCallbackDatabaseSecret } from "@/lib/integrations/control-plane/square-gcp-callback-credentials";
import { checkedSquareGcpCallbackBinding, type SquareGcpCallbackBinding } from "@/lib/integrations/control-plane/square-gcp-callback-contracts";
import { checkedSquareGcpCallbackDatabaseCa, openSquareGcpCallbackDatabase } from "@/lib/integrations/control-plane/square-gcp-callback-database";
import { createSquarePortalAuth } from "./auth";
import { CALLBACK_PATH, createSquareSandboxPortal, type SquarePortalScope } from "./portal";
import { reportSquareConsentProgress, type SquareConsentObserver } from "@/lib/integrations/providers/square/account-connection-progress";
import { createSquareConsentDiagnostics } from "./consent-diagnostics";
import { checkedSquareGcpMappedBinding, squareGcpMappedHost, type SquareGcpMappedBinding } from "@/lib/integrations/control-plane/square-gcp-mapped-contracts";
import { openSquareGcpMappedDatabase } from "@/lib/integrations/control-plane/square-gcp-mapped-database";
import { createSquareAccountMapping } from "@/lib/integrations/providers/square/account-mapping";

function denied(): never { throw new Error("square_portal_runtime_denied"); }
type NativePortalInput = Readonly<{
  binding: SquareGcpCallbackBinding; publishableKey: string; databaseCa: string; network: typeof fetch;
  mappedBinding?: SquareGcpMappedBinding;
}>;

/** Explicit operator binding probe only. No portal listener, user session,
 * application secret, KMS or Square transport is constructed by this path. */
export async function checkNativeSquareSandboxPortalBinding(input: NativePortalInput, signal: AbortSignal) {
  const databaseCa = checkedSquareGcpCallbackDatabaseCa(input.databaseCa);
  const binding = checkedSquareGcpCallbackBinding(input.binding), expected = canonicalContractJson(binding);
  const mapped = input.mappedBinding ? checkedSquareGcpMappedBinding(input.mappedBinding) : undefined;
  if (mapped && (mapped.capability !== "broker" || canonicalContractJson(squareGcpMappedHost(mapped)) !== expected)) denied();
  if (signal.aborted) denied();
  const identity = createSquareGcpCallbackIdentity({ binding, network: input.network, signal });
  let database: Awaited<ReturnType<typeof openSquareGcpCallbackDatabase>> | undefined;
  let mappedDatabase: Awaited<ReturnType<typeof openSquareGcpMappedDatabase>> | undefined;
  let dsn = "";
  try {
    const bootstrap = createSquareGcpCallbackIdentity({ binding, network: input.network, signal });
    dsn = await readSquareGcpCallbackDatabaseSecret({ binding, identity: bootstrap, network: input.network, signal });
    database = await openSquareGcpCallbackDatabase(dsn, databaseCa, signal);
    if (mapped) {
      mappedDatabase = await openSquareGcpMappedDatabase("broker", dsn, databaseCa, signal);
      if (canonicalContractJson(mappedDatabase.binding) !== canonicalContractJson(mapped)) denied();
      await mappedDatabase.recheckBinding();
    }
    dsn = "";
    if (signal.aborted || canonicalContractJson(database.binding) !== expected) denied();
    await identity.verify();
    if (signal.aborted) denied();
    const current = await database.recheckBinding();
    if (signal.aborted || canonicalContractJson(current) !== expected) denied();
    return Object.freeze({ checked: true as const });
  } catch { return denied(); }
  finally { dsn = "";identity.dispose();await database?.close();await mappedDatabase?.close(); }
}

/** Native composition, never imported by Next/Vercel and never installed in the
 * shared provider registry. Explicit server startup is the sole caller. Every
 * request has independent host verification, actual broker LOGIN, consumed-intent
 * closure, credentials, cancellation and cleanup. No ADC/WIF/service-key fallback. */
export function createNativeSquareSandboxPortal(input: NativePortalInput,
  diagnostics = createSquareConsentDiagnostics()) {
  const databaseCa = checkedSquareGcpCallbackDatabaseCa(input.databaseCa);
  const binding = checkedSquareGcpCallbackBinding(input.binding);
  const expected = canonicalContractJson(binding);
  const mapped = input.mappedBinding ? checkedSquareGcpMappedBinding(input.mappedBinding) : undefined;
  if (mapped && (mapped.capability !== "broker" || canonicalContractJson(squareGcpMappedHost(mapped)) !== expected)) denied();
  let opened = 0, initiations = 0;
  return createSquareSandboxPortal({
    async open(signal): Promise<SquarePortalScope> {
      if (signal.aborted || ++opened > 100) denied();
      checkedSquareGcpCallbackBinding(binding);
      // Bootstrap identity is deliberately separate: the secret reader disposes
      // it before request-scoped OAuth capability construction.
      const bootstrap = createSquareGcpCallbackIdentity({ binding, network: input.network, signal });
      let dsn = await readSquareGcpCallbackDatabaseSecret({ binding, identity: bootstrap, network: input.network, signal });
      let database: Awaited<ReturnType<typeof openSquareGcpCallbackDatabase>> | undefined;
      let mappedDatabase: Awaited<ReturnType<typeof openSquareGcpMappedDatabase>> | undefined;
      const identity = createSquareGcpCallbackIdentity({ binding, network: input.network, signal });
      let credentials: ReturnType<typeof createSquareGcpCallbackCredentials> | undefined;
      let attempt: ReturnType<typeof diagnostics.begin> | undefined;
      const observeConsent: SquareConsentObserver = stage => attempt?.observe(stage);
      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true; signal.removeEventListener("abort", abort);
        credentials?.dispose(); identity.dispose(); await database?.close(); await mappedDatabase?.close();
      };
      const abort = () => { void close(); };
      signal.addEventListener("abort", abort, { once: true });
      try {
        database = await openSquareGcpCallbackDatabase(dsn, databaseCa, signal);
        if (mapped) {
          mappedDatabase = await openSquareGcpMappedDatabase("broker", dsn, databaseCa, signal);
          if (canonicalContractJson(mappedDatabase.binding) !== canonicalContractJson(mapped)) denied();
        }
        dsn = "";
        if (closed || signal.aborted || canonicalContractJson(database.binding) !== expected) denied();
        await identity.verify();
        if (signal.aborted) denied();
        const db = database;
        credentials = binding.providerCallsEnabled ? createSquareGcpCallbackCredentials({ binding, identity,
          authorizeFirstConsent: db.authorizeFirstConsent, network: input.network, signal }, observeConsent) : undefined;
        const transport = createSquareSandboxOAuthTransport({ network: input.network, authorize: async () => {
          if (!binding.providerCallsEnabled || closed || signal.aborted) denied();
          const current = await db.authorizeFirstConsent({ purpose: "application_secret", signal });
          if (canonicalContractJson(current) !== expected) denied();
          await identity.verify();
        } });
        const service = createSquareAccountConnectionService({ client: db.client,
          enrollmentClient: Object.freeze({ rpc: async () => denied() }),
          environment: "sandbox", applicationId: binding.applicationId,
          redirectUri: binding.applicationOrigin + CALLBACK_PATH, kmsKeyResource: binding.kmsKeyResource,
          secrets: Object.freeze({ access: async (provider, environment) => {
            reportSquareConsentProgress(observeConsent, "application_secret_access");
            const value = credentials ? await credentials.secrets.access(provider, environment) : denied();
            reportSquareConsentProgress(observeConsent, "application_secret_returned");
            return value;
          } }),
          kms: Object.freeze({ encrypt: async value => {
            reportSquareConsentProgress(observeConsent, "credential_encrypt_requested");
            const result = credentials ? await credentials.kms.encrypt(value) : denied();
            reportSquareConsentProgress(observeConsent, "credential_encrypt_returned");
            return result;
          }, decrypt: async value => credentials ? credentials.kms.decrypt(value) : denied() }),
          observeConsent,
          transport: async request => {
            // The established wire/decoder implementation is reused, with its
            // refresh grant explicitly removed from this first-consent surface.
            if (new URL(request.url).pathname === "/oauth2/token" &&
              (typeof request.body !== "string" || JSON.parse(request.body).grant_type !== "authorization_code")) denied();
            return transport(request);
          }
        });
        return Object.freeze({ binding: db.binding,
          ...(mapped && mappedDatabase ? { mapping: Object.freeze({ enabled: true as const,
            approvedConnectionId: mapped.connectionId, approvedLocationId: mapped.defaultLocationId,
            confirmMapping: async (actor: Parameters<ReturnType<typeof createSquareAccountConnectionService>["confirmMapping"]>[0], command: Parameters<ReturnType<typeof createSquareAccountConnectionService>["confirmMapping"]>[1]) => {
              if (closed || signal.aborted || actor.actorId !== mapped.operatorId || actor.sessionId !== mapped.operatorSessionId ||
                actor.workspaceId !== mapped.workspaceId || actor.role !== mapped.operatorRole || command.connectionId !== mapped.connectionId ||
                command.businessEntityId !== mapped.businessEntityId || command.locationIds.length !== 1 || command.locationIds[0] !== mapped.defaultLocationId) denied();
              await identity.verify();
              await mappedDatabase!.recheckBinding();
              const result = await createSquareAccountMapping({ client: mappedDatabase!.client,
                context: { actor, environment: "sandbox", applicationId: mapped.applicationId, redirectUri: mapped.applicationOrigin + CALLBACK_PATH }
              }).confirm(command) as { confirmed?: unknown; generation?: unknown };
              if (closed || signal.aborted || result.confirmed !== true || result.generation !== mapped.connectionGeneration) denied();
            }
          }) } : {}),
          auth: createSquarePortalAuth({ binding: db.binding, publishableKey: input.publishableKey, network: input.network, signal }),
          service: Object.freeze({
            snapshot: service.snapshot, disconnect: service.disconnect,
            complete: async (...args: Parameters<typeof service.complete>) => {
              // Created only for complete(), never login/bootstrap/status. No
              // callback input or error is passed to the diagnostic collector.
              const current = diagnostics.begin(signal); attempt = current;
              try {
                const result = await service.complete(...args);
                current.finish(signal.aborted ? "cancelled" : "callback_returned");
                return result;
              } catch (error) {
                current.finish(signal.aborted ? "cancelled" : "failed");
                throw error;
              } finally { if (attempt === current) attempt = undefined; }
            },
            initiate: async (...args: Parameters<typeof service.initiate>) => {
              if (++initiations > 10 || closed || signal.aborted) denied();
              return service.initiate(...args);
            }
          }), close });
      } catch { dsn = ""; await close(); return denied(); }
    }
  });
}
