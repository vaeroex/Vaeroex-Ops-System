import { z } from "zod";

import {
  BoundedIdentifierSchema,
  BoundedLabelSchema,
  CurrencyCodeSchema,
  IsoTimestampSchema,
  ProviderKeySchema,
  Sha256FingerprintSchema,
  TimeZoneSchema,
  UuidSchema,
  uniqueStringArray
} from "@/lib/integrations/contracts/primitives";
import {
  EXTERNAL_INTEGRATION_CONTRACT_VERSIONS,
  EXTERNAL_INTEGRATION_LIMITS
} from "@/lib/integrations/contracts/versions";

export const BusinessEntitySchema = z
  .object({
    contractVersion: z.literal(EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.businessEntity),
    id: UuidSchema,
    workspaceId: UuidSchema,
    parentBusinessEntityId: UuidSchema.nullable(),
    entityKey: BoundedIdentifierSchema,
    displayName: BoundedLabelSchema,
    legalName: BoundedLabelSchema.nullable(),
    status: z.enum(["active", "inactive", "archived"]),
    baseCurrency: CurrencyCodeSchema,
    timeZone: TimeZoneSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.parentBusinessEntityId === value.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentBusinessEntityId"],
        message: "A Business Entity cannot be its own parent"
      });
    }
  });

export type BusinessEntity = Readonly<z.infer<typeof BusinessEntitySchema>>;

export const IntegrationConnectionStatusSchema = z.enum([
  "pending_authorization",
  "authorized_unmapped",
  "initializing",
  "active",
  "degraded",
  "error",
  "reauthorization_required",
  "disconnecting",
  "disconnected",
  "deleting",
  "deleted"
]);

export type IntegrationConnectionStatus = z.infer<typeof IntegrationConnectionStatusSchema>;

const scopeSet = uniqueStringArray(BoundedIdentifierSchema, EXTERNAL_INTEGRATION_LIMITS.scopesPerConnection);

export const IntegrationConnectionSchema = z
  .object({
    contractVersion: z.literal(EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.connection),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    providerKey: ProviderKeySchema,
    providerEnvironment: BoundedIdentifierSchema,
    providerTenantReferenceFingerprint: Sha256FingerprintSchema.nullable(),
    status: IntegrationConnectionStatusSchema,
    requestedScopes: scopeSet,
    grantedScopes: scopeSet,
    configurationVersion: z.number().int().positive().safe(),
    createdAt: IsoTimestampSchema,
    statusChangedAt: IsoTimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    const requested = new Set(value.requestedScopes);
    for (const scope of value.grantedScopes) {
      if (!requested.has(scope)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["grantedScopes"],
          message: `Granted scope was not requested: ${scope}`
        });
      }
    }
    if (value.status === "pending_authorization" && value.grantedScopes.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["grantedScopes"],
        message: "A pending connection cannot have granted scopes"
      });
    }
  });

export type IntegrationConnection = Readonly<z.infer<typeof IntegrationConnectionSchema>>;

const allowedTransitions: Readonly<Record<IntegrationConnectionStatus, readonly IntegrationConnectionStatus[]>> = {
  pending_authorization: ["authorized_unmapped", "error", "deleting"],
  authorized_unmapped: ["initializing", "reauthorization_required", "disconnecting", "deleting"],
  initializing: ["active", "degraded", "error", "reauthorization_required", "disconnecting", "deleting"],
  active: ["degraded", "reauthorization_required", "disconnecting", "deleting"],
  degraded: ["active", "error", "reauthorization_required", "disconnecting", "deleting"],
  error: ["pending_authorization", "initializing", "disconnected", "deleting"],
  reauthorization_required: ["pending_authorization", "disconnecting", "deleting"],
  disconnecting: ["disconnected", "deleting"],
  disconnected: ["pending_authorization", "deleting"],
  deleting: ["deleted"],
  deleted: []
};

export function isIntegrationConnectionTransitionAllowed(
  from: IntegrationConnectionStatus,
  to: IntegrationConnectionStatus
) {
  IntegrationConnectionStatusSchema.parse(from);
  IntegrationConnectionStatusSchema.parse(to);
  return from === to || allowedTransitions[from].includes(to);
}

export function assertIntegrationConnectionTransition(
  from: IntegrationConnectionStatus,
  to: IntegrationConnectionStatus
) {
  if (!isIntegrationConnectionTransitionAllowed(from, to)) {
    throw new Error(`Invalid integration connection transition: ${from} -> ${to}`);
  }
}
