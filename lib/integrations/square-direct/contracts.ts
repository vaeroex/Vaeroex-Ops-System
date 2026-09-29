import { z } from "zod";

const id = z.string().uuid();
// PostgreSQL JSON uses +00:00 while Square uses Z. Bind the same instant,
// not its transport spelling (also stabilizes persisted cursor fingerprints).
const instant = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const DirectActorSchema = z.object({ workspaceId: id, actorId: id, sessionId: id }).strict();
export type DirectActor = z.infer<typeof DirectActorSchema>;
export const DirectPaymentSchema = z.object({
  id: z.string().min(1).max(192), locationId: z.string().min(1).max(50),
  status: z.enum(["APPROVED", "PENDING", "COMPLETED", "CANCELED", "FAILED", "UNKNOWN"]),
  createdAt: instant, updatedAt: instant,
  amountMinor: z.string().regex(/^-?(?:0|[1-9][0-9]*)$/).max(17).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable()
}).strict();
export type DirectPayment = z.infer<typeof DirectPaymentSchema>;
const location = z.object({ id: z.string().min(1).max(50), label: z.string().min(1).max(255) }).strict();
export const DirectStateSchema = z.enum(["consent_pending", "exchanging", "mapping_required", "connected",
  "syncing", "retry_required", "reauthorization_required", "disconnected"]);
export const DirectViewSchema = z.object({
  available: z.boolean(), businessEntities: z.array(z.object({ id, label: z.string().min(1).max(255) }).strict()).max(1000),
  connections: z.array(z.object({ connectionId: id, businessEntityId: id, state: DirectStateSchema,
    sellerLabel: z.string().max(255).nullable(), locations: z.array(location).max(500), locationId: z.string().max(50).nullable(),
    lastSyncedAt: instant.nullable(), lastError: z.enum(["retry_required", "reauthorization_required"]).nullable(),
    hasMore: z.boolean(), revocationPending: z.boolean(), payments: z.array(DirectPaymentSchema).max(100)
  }).strict()).max(100)
}).strict();
export type DirectView = z.infer<typeof DirectViewSchema>;
export const DirectContextSchema = z.object({
  connectionId: id, workspaceId: id, businessEntityId: id,
  generation: z.number().int().positive().safe(), credentialVersion: z.number().int().nonnegative().safe(),
  ciphertext: z.string().max(131072).nullable(), merchantId: z.string().max(191).nullable(),
  accessExpiresAt: instant.nullable(), locationId: z.string().max(50).nullable(),
  windowStart: instant.nullable(), windowEnd: instant.nullable(), cursor: z.string().max(4098).nullable(),
  cursorBindingFingerprint: fingerprint.nullable(), cursorFingerprint: fingerprint.nullable(),
  leaseId: id.nullable(), state: DirectStateSchema
}).strict();
export type DirectContext = z.infer<typeof DirectContextSchema>;
export type DirectRpc = (operation: string, payload: Record<string, unknown>) => Promise<unknown>;
