import { z } from "zod";

import {
  CredentialRefreshResultSchema,
  type CredentialRefreshResult
} from "@/lib/integrations/credentials/contracts";
import {
  BoundedIdentifierSchema,
  IsoTimestampSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";

const CredentialIdentitySchema = z
  .object({
    credentialId: UuidSchema,
    credentialVersion: z.number().int().positive().safe(),
    accessExpiresAt: IsoTimestampSchema
  })
  .strict();

export const ProviderCredentialBrokerReadSchema = z.discriminatedUnion("state", [
  CredentialIdentitySchema.extend({
    state: z.literal("available"),
    credentialReadEvidenceId: UuidSchema,
    externalAuthorizedEntityReference: BoundedIdentifierSchema.optional(),
    accessToken: z.string().min(16).max(16_384)
  }).strict(),
  CredentialIdentitySchema.extend({ state: z.literal("refresh_required") }).strict(),
  CredentialIdentitySchema.extend({ state: z.literal("credential_version_stale") }).strict()
]);

export const ProviderCredentialResolutionSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("available"),
      credentialId: UuidSchema,
      credentialVersion: z.number().int().positive().safe(),
      credentialReadEvidenceId: UuidSchema,
      externalAuthorizedEntityReference: BoundedIdentifierSchema.optional(),
      accessExpiresAt: IsoTimestampSchema,
      accessToken: z.string().min(16).max(16_384)
    })
    .strict(),
  z
    .object({
      state: z.literal("retry_wait"),
      failureCode: z.enum([
        "credential_refresh_in_progress",
        "credential_refresh_transient",
        "credential_version_handoff_incomplete"
      ]),
      retryAfterSeconds: z.number().int().min(1).max(3_600)
    })
    .strict(),
  z
    .object({
      state: z.literal("reauthorization_required"),
      failureCode: z.literal("credential_reauthorization_required")
    })
    .strict()
]);

type ReadCredential = (expectedCredentialVersion: number) => PromiseLike<unknown>;
type RefreshCredential = (
  credentialId: string,
  expectedCredentialVersion: number
) => PromiseLike<unknown>;

export async function resolveProviderAccessCredential(input: {
  expectedCredentialVersion: number;
  readCredential: ReadCredential;
  refreshCredential: RefreshCredential;
}) {
  let expectedVersion = z.number().int().positive().safe().parse(
    input.expectedCredentialVersion
  );
  for (let handoff = 0; handoff < 3; handoff += 1) {
    const credential = ProviderCredentialBrokerReadSchema.parse(
      await input.readCredential(expectedVersion)
    );
    if (credential.state === "available") {
      return ProviderCredentialResolutionSchema.parse(credential);
    }
    if (credential.state === "credential_version_stale") {
      expectedVersion = credential.credentialVersion;
      continue;
    }

    const refresh = CredentialRefreshResultSchema.parse(
      await input.refreshCredential(credential.credentialId, credential.credentialVersion)
    ) as CredentialRefreshResult;
    if (refresh.state === "refreshed") {
      expectedVersion = refresh.credentialVersion;
      continue;
    }
    if (refresh.state === "credential_version_superseded") {
      expectedVersion = credential.credentialVersion;
      continue;
    }
    if (refresh.state === "refresh_in_progress") {
      return ProviderCredentialResolutionSchema.parse({
        state: "retry_wait",
        failureCode: "credential_refresh_in_progress",
        retryAfterSeconds: refresh.retryAfterSeconds
      });
    }
    if (refresh.state === "retry_required") {
      return ProviderCredentialResolutionSchema.parse({
        state: "retry_wait",
        failureCode: "credential_refresh_transient",
        retryAfterSeconds: refresh.retryAfterSeconds
      });
    }
    return ProviderCredentialResolutionSchema.parse({
      state: "reauthorization_required",
      failureCode: "credential_reauthorization_required"
    });
  }
  return ProviderCredentialResolutionSchema.parse({
    state: "retry_wait",
    failureCode: "credential_version_handoff_incomplete",
    retryAfterSeconds: 5
  });
}
