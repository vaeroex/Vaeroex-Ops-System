import { z } from "zod";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  BoundedIdentifierSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import {
  CanonicalBusinessFactVersionSchema,
  ExternalSourceRecordVersionSchema
} from "@/lib/integrations/contracts/source-facts";

export const EXTERNAL_SOURCE_IDENTITY_VERSION = "external_source_identity_v1" as const;
export const CANONICAL_FACT_IDENTITY_VERSION = "canonical_fact_identity_v1" as const;

const ProviderSourceIdentitySchema = z
  .object({
    kind: z.literal("provider"),
    providerKey: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
    providerRecordType: BoundedIdentifierSchema,
    providerRecordId: BoundedIdentifierSchema
  })
  .strict();

const UploadSourceIdentitySchema = z
  .object({
    kind: z.literal("upload"),
    artifactFingerprint: Sha256FingerprintSchema,
    rowReference: BoundedIdentifierSchema
  })
  .strict();

const ManualSourceIdentitySchema = z
  .object({
    kind: z.literal("manual"),
    actorId: UuidSchema,
    entryReference: BoundedIdentifierSchema
  })
  .strict();

export const ExternalSourceIdentityInputSchema = z
  .object({
    identityVersion: z.literal(EXTERNAL_SOURCE_IDENTITY_VERSION),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema.nullable(),
    source: z.discriminatedUnion("kind", [
      ProviderSourceIdentitySchema,
      UploadSourceIdentitySchema,
      ManualSourceIdentitySchema
    ])
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source.kind === "provider" && value.connectionId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["connectionId"],
        message: "Provider source identities require a connection"
      });
    }
    if (value.source.kind !== "provider" && value.connectionId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["connectionId"],
        message: "Non-provider source identities cannot claim a connection"
      });
    }
  });

export const CanonicalFactIdentityInputSchema = z
  .object({
    identityVersion: z.literal(CANONICAL_FACT_IDENTITY_VERSION),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    factKind: BoundedIdentifierSchema,
    factKey: BoundedIdentifierSchema
  })
  .strict();

export function externalSourceIdentityInput(input: unknown) {
  const version = ExternalSourceRecordVersionSchema.parse(input);
  const source = version.source.kind === "provider"
    ? {
        kind: version.source.kind,
        providerKey: version.source.providerKey,
        providerRecordType: version.source.providerRecordType,
        providerRecordId: version.source.providerRecordId
      }
    : version.source;

  return ExternalSourceIdentityInputSchema.parse({
    identityVersion: EXTERNAL_SOURCE_IDENTITY_VERSION,
    workspaceId: version.workspaceId,
    businessEntityId: version.businessEntityId,
    connectionId: version.connectionId,
    source
  });
}

export function externalSourceIdentityFingerprint(input: unknown) {
  return contractSha256(externalSourceIdentityInput(input));
}

export function canonicalFactIdentityInput(input: unknown) {
  const version = CanonicalBusinessFactVersionSchema.parse(input);
  return CanonicalFactIdentityInputSchema.parse({
    identityVersion: CANONICAL_FACT_IDENTITY_VERSION,
    workspaceId: version.workspaceId,
    businessEntityId: version.businessEntityId,
    factKind: version.factKind,
    factKey: version.factKey
  });
}

export function canonicalFactIdentityFingerprint(input: unknown) {
  return contractSha256(canonicalFactIdentityInput(input));
}
