import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import type { OAuthCredentialProvider, ProviderSecretStore } from "@/lib/integrations/credentials/broker";
import { CredentialAadContextSchema } from "@/lib/integrations/credentials/contracts";
import { credentialAad, credentialAadDigest, type CredentialKms } from "@/lib/integrations/credentials/kms";
import { assertCredentialEnvelopeMatchesProviderOAuthPolicy } from "@/lib/integrations/credentials/oauth-policy";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { QBO_PRODUCTION_OAUTH_POLICY } from "@/lib/integrations/provider-runtime/qbo/oauth-policy";

const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const claimSchema = z.discriminatedUnion("acquired", [
  z.object({ acquired: z.literal(false) }).strict(),
  z.object({ acquired: z.literal(true), claimId: z.string().uuid(), connectionId: z.string().uuid(),
    credentialId: z.string().uuid(), credentialVersion: z.number().int().positive(),
    ciphertextBase64: z.string().min(16).max(131072).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    kmsKeyResource: z.string().min(16), aadDigest: fingerprint, realmFingerprint: fingerprint,
    aadContext: CredentialAadContextSchema }).strict()
]);

/** No caller chooses a tenant, connection or credential. Only canonical
 * disconnecting connections can be claimed by the native broker role. */
export async function completePendingCustomerDisconnects(input: {
  maximumConnections: number; client: ExternalIntegrationsRpcClient;
  kms: CredentialKms; kmsKeyResource: string; secrets: ProviderSecretStore; provider: OAuthCredentialProvider;
}) {
  const maximum = z.number().int().min(1).max(25).parse(input.maximumConnections);
  const outcomes: Array<"succeeded" | "failed" | "deferred"> = [];
  for (let index = 0; index < maximum; index++) {
    const result = await input.client.rpc("claim_qbo_customer_disconnect_v1", { p_request_id: `qbo_disconnect_${randomUUID()}` });
    if (result.error) throw new Error("qbo_customer_disconnect_claim_failed");
    const claim = claimSchema.parse(result.data);
    if (!claim.acquired) break;
    let plaintext: Buffer | null = null;
    let outcome: "succeeded" | "failed" | "deferred" = "deferred";
    try {
      if (claim.kmsKeyResource !== input.kmsKeyResource ||
        claim.aadContext.environment !== "production" || claim.aadContext.providerKey !== "quickbooks_online" ||
        claim.aadContext.credentialId !== claim.credentialId || claim.aadContext.connectionId !== claim.connectionId ||
        credentialAadDigest(claim.aadContext) !== claim.aadDigest) {
        throw new Error("qbo_customer_disconnect_binding_denied");
      }
      plaintext = Buffer.from(await input.kms.decrypt({ keyResource: claim.kmsKeyResource,
        ciphertext: Buffer.from(claim.ciphertextBase64, "base64"),
        additionalAuthenticatedData: credentialAad(claim.aadContext) }));
      const envelope = assertCredentialEnvelopeMatchesProviderOAuthPolicy(
        QBO_PRODUCTION_OAUTH_POLICY, JSON.parse(plaintext.toString("utf8"))
      );
      if (contractSha256({ fingerprintPurpose: "provider_authorized_entity_reference",
        fingerprintVersion: "provider_authorized_entity_reference_fingerprint_v1",
        value: envelope.externalAuthorizedEntityReference }) !== claim.realmFingerprint) {
        throw new Error("qbo_customer_disconnect_realm_denied");
      }
      const applicationSecret = await input.secrets.access("quickbooks_online", "production");
      const authorized = await input.client.rpc("authorize_qbo_customer_revocation_v1", {
        p_claim_id: claim.claimId, p_connection_id: claim.connectionId
      });
      if (authorized.error || authorized.data !== true) throw new Error("qbo_customer_disconnect_stale");
      await input.provider.revokeCredential({ credential: envelope, applicationSecret });
      outcome = "succeeded";
    } catch {
      outcome = "failed";
    } finally {
      plaintext?.fill(0);
    }
    const completed = await input.client.rpc("complete_qbo_customer_disconnect_v1", {
      p_claim_id: claim.claimId, p_connection_id: claim.connectionId, p_outcome: outcome
    });
    if (completed.error) throw new Error("qbo_customer_disconnect_completion_uncertain");
    const completion = z.object({ disconnected: z.boolean(),
      providerOutcome: z.enum(["succeeded", "failed", "deferred"]), idempotent: z.boolean() }).strict().parse(completed.data);
    if (completion.disconnected !== (completion.providerOutcome === "succeeded")) {
      throw new Error("qbo_customer_disconnect_completion_invalid");
    }
    outcomes.push(completion.providerOutcome);
  }
  return { disconnectedCount: outcomes.filter(value => value === "succeeded").length, providerRevokedCount: outcomes.filter(value => value === "succeeded").length,
    providerUnconfirmedCount: outcomes.filter(value => value !== "succeeded").length };
}
