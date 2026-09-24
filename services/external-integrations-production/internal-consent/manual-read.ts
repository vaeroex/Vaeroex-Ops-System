import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { CredentialEnvelopeSchema } from "@/lib/integrations/credentials/contracts";
import type { CredentialKms } from "@/lib/integrations/credentials/kms";
import { SQUARE_API_VERSION } from "@/lib/integrations/providers/square/contracts";
import { parseSquarePaymentResponse, squarePaymentFingerprint, squarePaymentResponseFingerprint } from "@/lib/integrations/providers/square/payment-responses";
import { InternalPermitSchema, internalFingerprint as fp, type InternalActor, type InternalRpc } from "./handlers";

const uuid = z.string().uuid(), hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const version = z.number().int().positive().safe();
const timestamp = z.string().datetime();
const databaseTimestamp = z.string().datetime({ offset: true });
const kmsKey = "projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials";

/** Private operator configuration, not browser input or permission. References
 * and versions must come from the reconciled consent receipt/catalog. No RPC
 * guesses a current version or searches other permits when a binding fails. */
export const ManualReadConfigurationSchema = z.object({
  credentialId: uuid, credentialVersion: z.literal(1), mappingRowVersion: version,
  scanId: uuid, taskId: uuid, leaseId: uuid, leaseOwnerFingerprint: hash,
  paymentWindowStart: timestamp, paymentWindowEnd: timestamp,
  runtimeOrigin: z.literal("https://square-production-runtime-u5c6zahmpq-uw.a.run.app"),
  evidenceOrigin: z.literal("https://square-production-evidence-u5c6zahmpq-uw.a.run.app")
}).strict().refine(value => {
  const duration = Date.parse(value.paymentWindowEnd) - Date.parse(value.paymentWindowStart);
  return duration > 0 && duration <= 86_400_000;
});
export type ManualReadConfiguration = z.infer<typeof ManualReadConfigurationSchema>;
export const ManualActionSchema = z.enum(["map", "prepare", "read", "evidence"]);
export type ManualAction = z.infer<typeof ManualActionSchema>;
const ActorSchema = z.object({ actorId: uuid, sessionId: uuid, workspaceId: uuid, businessEntityId: uuid }).strict();
export const ManualCommandSchema = z.object({ action: ManualActionSchema, actor: ActorSchema }).strict();
export type ManualCommand = z.infer<typeof ManualCommandSchema>;
type Permit = z.infer<typeof InternalPermitSchema>;
type Base = { permit: Permit; configuration: ManualReadConfiguration; now?: () => Date };
const denied = () => new Error("square_internal_manual_read_requires_reconciliation");

function context(input: Base) {
  const permit = InternalPermitSchema.parse(input.permit);
  const configuration = ManualReadConfigurationSchema.parse(input.configuration);
  const now = input.now ?? (() => new Date());
  return { permit, configuration, now, check(actor: InternalActor) {
    ActorSchema.parse(actor);
    if (actor.actorId !== permit.operatorId || actor.sessionId !== permit.operatorSessionId ||
      actor.workspaceId !== permit.workspaceId || actor.businessEntityId !== permit.businessEntityId ||
      !Number.isFinite(now().getTime()) || now().getTime() >= Date.parse(permit.approvalExpiresAt)) throw denied();
  } };
}
function record(raw: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(raw);
}
function requireFields(raw: unknown, expected: Record<string, unknown>) {
  const result = record(raw);
  for (const [key, value] of Object.entries(expected)) if (result[key] !== value) throw denied();
  return result;
}

export function createInternalMapping(input: Base & { oauthRpc: InternalRpc }) {
  const { permit: p, configuration: c, check } = context(input);
  return async (actor: InternalActor) => {
    check(actor);
    const mappingFingerprint = fp(["confirm-mapping-v1", p.permitId, actor.actorId, actor.sessionId,
      p.expectedMerchantId, p.expectedLocationId, c.mappingRowVersion]);
    // No retry: confirm_mapping has no replay branch. A lost acknowledgment
    // must be reconciled privately before selecting a subsequent command.
    const result = requireFields(await input.oauthRpc("confirm_mapping", { actorId: actor.actorId,
      sessionId: actor.sessionId, permitId: p.permitId, merchantId: p.expectedMerchantId,
      locationId: p.expectedLocationId, mappingFingerprint }), { permitId: p.permitId, state: "mapped", mappingFingerprint });
    hash.parse(result.auditFingerprint);
    return { status: "mapped", nonEconomic: true } as const;
  };
}

const ObservationSchema = z.object({ sourceVersionId: uuid, ordinal: version, paymentFingerprint: hash,
  versionFingerprint: hash, locationFingerprint: hash, paymentStatus: z.enum(["approved", "completed", "canceled", "failed", "pending", "unknown"]),
  occurredAt: databaseTimestamp, observedAt: timestamp, sourceFingerprint: hash }).strict();
const PageSchema = z.object({ permitId: uuid, scanId: uuid, responseFingerprint: hash,
  observations: z.array(ObservationSchema).max(100) }).strict();
export type ManualPage = z.infer<typeof PageSchema>;
export const BrokerPageCommandSchema = z.object({ actor: ActorSchema, permitId: uuid, scanId: uuid,
  leaseId: uuid, leaseOwnerFingerprint: hash }).strict();
export type BrokerPageCommand = z.infer<typeof BrokerPageCommandSchema>;

export function createInternalPaymentsRuntime(input: Base & {
  runtimeRpc: InternalRpc; readPage(command: BrokerPageCommand): Promise<unknown>;
}) {
  const { permit: p, configuration: c, check, now } = context(input);
  const scanRequestFingerprint = fp(["create-scan-v1", p.permitId, c.scanId, c.taskId,
    c.paymentWindowStart, c.paymentWindowEnd, c.leaseOwnerFingerprint, c.mappingRowVersion + 1]);
  return async (raw: ManualCommand) => {
    const { action, actor } = ManualCommandSchema.parse(raw);
    check(actor);
    if (action === "prepare") {
      if (Date.parse(c.paymentWindowEnd) > now().getTime()) throw denied();
      const result = requireFields(await input.runtimeRpc("create_scan", { permitId: p.permitId, scanId: c.scanId,
        taskId: c.taskId, paymentWindowStart: c.paymentWindowStart, paymentWindowEnd: c.paymentWindowEnd,
        leaseOwnerFingerprint: c.leaseOwnerFingerprint, requestFingerprint: scanRequestFingerprint }), {
        permitId: p.permitId, scanId: c.scanId, taskId: c.taskId, status: "ready", stream: "payments", operation: "list_payments"
      });
      hash.parse(result.auditFingerprint);
      return { status: "ready", nonEconomic: true };
    }
    if (action !== "read") throw denied();
    const requestFingerprint = fp(["acquire-page-v2", c.scanId, c.leaseId, c.leaseOwnerFingerprint,
      scanRequestFingerprint, p.permitId, actor.workspaceId, actor.businessEntityId, actor.actorId,
      actor.sessionId, p.generation, 1]);
    const lease = requireFields(await input.runtimeRpc("acquire_page", { ...actor, generation: p.generation,
      permitId: p.permitId, scanId: c.scanId, leaseId: c.leaseId, leaseOwnerFingerprint: c.leaseOwnerFingerprint,
      scanRequestFingerprint, requestFingerprint }), { permitId: p.permitId, scanId: c.scanId });
    if (lease.status === "committed" && lease.replayed === true)
      return { status: "committed", replayed: true, nonEconomic: true, historicalCompleteness: "unknown" };
    requireFields(lease, { status: "leased", replayed: false, leaseId: c.leaseId, method: "GET", path: "/v2/payments",
      continuationAllowed: false, requestFingerprint });
    if (Date.parse(databaseTimestamp.parse(lease.beginTime)) !== Date.parse(c.paymentWindowStart) ||
      Date.parse(databaseTimestamp.parse(lease.endTime)) !== Date.parse(c.paymentWindowEnd) ||
      Date.parse(databaseTimestamp.parse(lease.leaseExpiresAt)) <= now().getTime()) throw denied();
    // A leased replay deliberately does NOT fetch again. Only a committed
    // replay is automatic; uncertain provider requests require reconciliation.
    const page = PageSchema.parse(await input.readPage({ actor, permitId: p.permitId, scanId: c.scanId,
      leaseId: c.leaseId, leaseOwnerFingerprint: c.leaseOwnerFingerprint }));
    requireFields(page, { permitId: p.permitId, scanId: c.scanId });
    const pageId = fp(["payments-page-v1", c.scanId, page.responseFingerprint]);
    const rows = page.observations.map((row, index) => {
      if (row.ordinal !== index + 1 || row.locationFingerprint !== fp(["location-v1", p.expectedLocationId]) ||
        Date.parse(row.occurredAt) > Date.parse(row.observedAt) || Date.parse(row.observedAt) > now().getTime() + 300_000 ||
        row.sourceFingerprint !== fp(["payment-observation-v1", c.scanId, pageId, row.ordinal, row.paymentFingerprint,
          row.versionFingerprint, row.locationFingerprint, row.paymentStatus, row.occurredAt, row.observedAt])) throw denied();
      return fp(["page-observation-v1", row.sourceVersionId, row.ordinal, row.paymentFingerprint, row.versionFingerprint,
        row.locationFingerprint, row.paymentStatus, row.occurredAt, row.observedAt, row.sourceFingerprint]);
    });
    const resultFingerprint = fp(["page-result-v2", c.scanId, pageId, rows.join(",")]);
    const commandFingerprint = fp(["commit-page-v1", c.scanId, c.leaseId, pageId, page.responseFingerprint, resultFingerprint, "false"]);
    const command = { scanId: c.scanId, leaseId: c.leaseId, leaseOwnerFingerprint: c.leaseOwnerFingerprint,
      pageId, responseFingerprint: page.responseFingerprint, observations: page.observations, continuation: false, commandFingerprint };
    let result: unknown;
    try { result = await input.runtimeRpc("commit_page", command); }
    catch {
      // The existing RPC's exact receipt branch permits ONE lost-ack check
      // with identical bytes; it never repeats provider access or creates IDs.
      result = await input.runtimeRpc("commit_page", command);
    }
    const committed = requireFields(result, { permitId: p.permitId, scanId: c.scanId, pageId, status: "committed", commandFingerprint });
    z.boolean().parse(committed.replayed);
    if (!committed.replayed) requireFields(committed, { resultFingerprint, observationCount: page.observations.length });
    return { status: "committed", replayed: committed.replayed, observationCount: page.observations.length,
      nonEconomic: true, historicalCompleteness: "unknown" };
  };
}

/** Only broker owns decrypted credentials and provider I/O. No access token,
 * raw payment, cursor, provider ID or money object leaves this boundary. */
export function createInternalPaymentsBroker(input: Base & { brokerRpc: InternalRpc; kms: CredentialKms; network?: typeof fetch }) {
  const { permit: p, configuration: c, check, now } = context(input);
  return async (raw: BrokerPageCommand): Promise<ManualPage> => {
    const command = BrokerPageCommandSchema.parse(raw);
    check(command.actor);
    requireFields(command, { permitId: p.permitId, scanId: c.scanId, leaseId: c.leaseId, leaseOwnerFingerprint: c.leaseOwnerFingerprint });
    const requestFingerprint = fp(["read-credential-v1", c.scanId, c.leaseId, c.leaseOwnerFingerprint, c.credentialId, c.credentialVersion]);
    const stored = requireFields(await input.brokerRpc("read_credential", { permitId: p.permitId, scanId: c.scanId,
      leaseId: c.leaseId, leaseOwnerFingerprint: c.leaseOwnerFingerprint, requestFingerprint }), {
      permitId: p.permitId, scanId: c.scanId, credentialId: c.credentialId, credentialVersion: c.credentialVersion,
      kmsKeyResource: kmsKey, externalEntityFingerprint: fp(["external-entity-v1", p.expectedMerchantId, p.expectedLocationId]),
      aadDigest: fp(["aad-v1", "square", "production", "vaeroex-integrations-prod", p.generation, p.permitId, c.credentialId, c.credentialVersion])
    });
    const aad = { credentialId: c.credentialId, credentialVersion: String(c.credentialVersion), environment: "production",
      generation: String(p.generation), permitId: p.permitId, projectId: "vaeroex-integrations-prod", providerKey: "square" };
    if (canonicalContractJson(stored.aadContext) !== canonicalContractJson(aad) ||
      Date.parse(databaseTimestamp.parse(stored.accessExpiresAt)) <= now().getTime()) throw denied();
    const ciphertext = Buffer.from(z.string().min(1).max(180_000).parse(stored.ciphertextBase64), "base64");
    const additionalAuthenticatedData = Buffer.from(canonicalContractJson(aad));
    let plaintext: Uint8Array | undefined;
    try {
      plaintext = await input.kms.decrypt({ keyResource: kmsKey, ciphertext, additionalAuthenticatedData });
      const credential = CredentialEnvelopeSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)));
      if (credential.providerKey !== "square" || credential.environment !== "production" ||
        credential.externalAuthorizedEntityReference !== p.expectedMerchantId ||
        Date.parse(credential.accessExpiresAt) !== Date.parse(String(stored.accessExpiresAt)) || !credential.grantedScopes.includes("PAYMENTS_READ")) throw denied();
      const query = { begin_time: c.paymentWindowStart, end_time: c.paymentWindowEnd,
        location_id: p.expectedLocationId, limit: "100", sort_order: "ASC" };
      const response = await (input.network ?? fetch)(`https://connect.squareup.com/v2/payments?${new URLSearchParams(query)}`, {
        method: "GET", headers: { Authorization: `Bearer ${credential.accessToken}`, "Square-Version": SQUARE_API_VERSION },
        redirect: "error", cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok || response.redirected || !response.body) { await response.body?.cancel(); throw denied(); }
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      let responseValue: unknown;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 2_097_152 || chunks.length >= 1024) { part.value.fill(0); throw denied(); }
          chunks.push(part.value);
        }
        const bytes = Buffer.concat(chunks);
        try { responseValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
        finally { bytes.fill(0); }
      } finally { for (const chunk of chunks) chunk.fill(0); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const parsed = parseSquarePaymentResponse({ providerKey: "square", providerEnvironment: "production", apiVersion: SQUARE_API_VERSION,
        operation: "list_payments", connectionAuthority: { workspaceId: p.workspaceId, connectionId: p.permitId,
          providerEntityType: "merchant", providerEntityId: p.expectedMerchantId },
        requestContext: { authorizedLocationIds: [p.expectedLocationId], locationId: p.expectedLocationId, query }, response: responseValue });
      if (parsed.outcome !== "accepted") throw denied();
      const responseFingerprint = squarePaymentResponseFingerprint(parsed.value);
      const pageId = fp(["payments-page-v1", c.scanId, responseFingerprint]);
      const observedAt = now().toISOString();
      const observations = parsed.value.items.map((item, index) => {
        const occurredAt = item.updatedAt ?? item.createdAt;
        if (!item.id || item.locationId !== p.expectedLocationId || !occurredAt || Date.parse(occurredAt) > Date.parse(observedAt)) throw denied();
        const row = { sourceVersionId: randomUUID(), ordinal: index + 1,
          paymentFingerprint: fp(["payment-id-v1", p.expectedMerchantId, item.id]), versionFingerprint: squarePaymentFingerprint(item),
          locationFingerprint: fp(["location-v1", p.expectedLocationId]), paymentStatus: (item.status ?? "UNKNOWN").toLowerCase(), occurredAt, observedAt };
        return ObservationSchema.parse({ ...row, sourceFingerprint: fp(["payment-observation-v1", c.scanId, pageId,
          row.ordinal, row.paymentFingerprint, row.versionFingerprint, row.locationFingerprint, row.paymentStatus, occurredAt, observedAt]) });
      });
      // A provider cursor is deliberately discarded, never followed. Even an
      // empty/no-cursor response makes no complete-history assertion.
      return { permitId: p.permitId, scanId: c.scanId, responseFingerprint, observations };
    } finally { plaintext?.fill(0); ciphertext.fill(0); additionalAuthenticatedData.fill(0); }
  };
}

export function createInternalEvidence(input: Base & { evidenceRpc: InternalRpc }) {
  const { permit: p, configuration: c, check } = context(input);
  return async (actor: InternalActor) => {
    check(actor);
    const rowVersion = c.mappingRowVersion + 3;
    const requestFingerprint = fp(["read-evidence-v1", p.permitId, p.generation, p.configurationFingerprint, rowVersion,
      actor.workspaceId, actor.businessEntityId, actor.actorId, actor.sessionId]);
    const result = requireFields(await input.evidenceRpc("read", { ...actor, permitId: p.permitId, requestFingerprint }), {
      permitId: p.permitId, generation: p.generation, configurationFingerprint: p.configurationFingerprint, rowVersion, state: "synced",
      fenced: false, runtimeEnabled: false, providerCallsEnabled: false, customerOnboardingEnabled: false,
      webhookIntakeEnabled: false, economicContributionsEnabled: false, aiDispatchEnabled: false
    });
    const observationCount = z.number().int().min(0).max(100).parse(result.observationCount);
    if (result.scanCount !== 1 || result.pageReceiptCount !== 1 || result.credentialVersionCount !== 1) throw denied();
    return { source: "Square Production", status: "verified_non_economic_provider_observations", resource: "Payments",
      observationCount, pageCount: 1, historicalCompleteness: "unknown", economicContributions: false,
      limitations: ["One bounded page only", "No revenue, profit, netting, accounting truth or complete-history claim"] };
  };
}
