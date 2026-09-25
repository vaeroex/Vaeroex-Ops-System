import { z } from "zod";

import {
  IsoTimestampSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";

export const SQUARE_ACCOUNT_CONNECTION_VERSION = "square_account_connection_v1" as const;
export const SquareAccountEnvironmentSchema = z.enum(["sandbox", "production"]);
export const SquareConnectionActorSchema = z.object({
  actorId: UuidSchema,
  workspaceId: UuidSchema,
  sessionId: UuidSchema,
  role: z.enum(["owner", "admin", "manager", "staff", "viewer"])
}).strict();
export type SquareConnectionActor = Readonly<z.infer<typeof SquareConnectionActorSchema>>;

export const SquareAccountContextSchema = z.object({
  actor: SquareConnectionActorSchema,
  environment: SquareAccountEnvironmentSchema,
  applicationId: z.string().min(8).max(512),
  redirectUri: z.string().url().max(2048)
}).strict();
export type SquareAccountContext = Readonly<z.infer<typeof SquareAccountContextSchema>>;

const DisplayLabelSchema = z.string().min(1).max(255);
const ProviderIdSchema = z.string().min(1).max(32).regex(/^[A-Za-z0-9._:-]+$/);
export const SquareVerifiedDiscoverySchema = z.object({
  contractVersion: z.literal("square_verified_discovery_v1"),
  environment: SquareAccountEnvironmentSchema,
  applicationId: z.string().min(8).max(512),
  // Intersection of OAuth evidence (128) and existing durable seller scope (100).
  merchantId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  merchantLabel: DisplayLabelSchema,
  defaultLocationId: ProviderIdSchema,
  locations: z.array(z.object({
    id: ProviderIdSchema,
    label: DisplayLabelSchema,
    status: z.enum(["ACTIVE", "INACTIVE"])
  }).strict()).min(1).max(500),
  verifiedAt: IsoTimestampSchema,
  fingerprint: Sha256FingerprintSchema
}).strict();
/** A schema validates storage shape; only the authenticated discovery invocation supplies authority. */
export type SquareVerifiedDiscovery = Readonly<z.infer<typeof SquareVerifiedDiscoverySchema>>;

export const SquareConnectionViewSchema = z.object({
  canManage: z.boolean(),
  businessEntities: z.array(z.object({ id: UuidSchema, label: DisplayLabelSchema }).strict()).max(1000),
  connections: z.array(z.object({
    connectionId: UuidSchema,
    businessEntityId: UuidSchema,
    state: z.enum(["authorization_required", "mapping_required", "authorized", "reauthorization_required", "disconnecting", "disconnected", "revoked", "recovery_required"]),
    sellerLabel: DisplayLabelSchema.nullable(),
    locations: z.array(z.object({ id: ProviderIdSchema, label: DisplayLabelSchema }).strict()).max(500),
    mappedLocationIds: z.array(ProviderIdSchema).max(500),
    retentionApproved: z.boolean(),
    revocationPending: z.boolean()
  }).strict()).max(32)
}).strict();
export type SquareConnectionView = Readonly<z.infer<typeof SquareConnectionViewSchema>>;

export type SquareConnectionService = Readonly<{
  initiate(actor: SquareConnectionActor, input: Readonly<{ operation: "connect" | "reauthorize"; businessEntityId: string; connectionId?: string }>, signal?: AbortSignal): Promise<{ authorizationUrl: string }>;
  complete(actor: SquareConnectionActor, input: Readonly<{ state: string; code?: string; error?: "access_denied" }>, signal?: AbortSignal): Promise<void>;
  snapshot(actor: SquareConnectionActor): Promise<SquareConnectionView>;
  confirmMapping(actor: SquareConnectionActor, input: Readonly<{ connectionId: string; businessEntityId: string; locationIds: readonly string[]; confirmation: "map" }>): Promise<void>;
  disconnect(actor: SquareConnectionActor, input: Readonly<{ connectionId: string; confirmation: "disconnect" }>, signal?: AbortSignal): Promise<void>;
}>;
