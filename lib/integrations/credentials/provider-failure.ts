import { z } from "zod";

export const ProviderCredentialRefreshFailureCodeSchema = z.enum([
  "invalid_grant",
  "provider_revoked",
  "provider_transient",
  "scope_loss",
  "integrity_failure"
]);

export type ProviderCredentialRefreshFailureCode = z.infer<
  typeof ProviderCredentialRefreshFailureCodeSchema
>;

export class ProviderCredentialRefreshFailure extends Error {
  readonly code: ProviderCredentialRefreshFailureCode;

  constructor(code: ProviderCredentialRefreshFailureCode) {
    super("provider_credential_refresh_failed");
    this.name = "ProviderCredentialRefreshFailure";
    this.code = ProviderCredentialRefreshFailureCodeSchema.parse(code);
  }
}
