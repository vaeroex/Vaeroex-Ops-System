import "server-only";

import { z } from "zod";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const completion = z.object({
  credentialId: z.string().uuid(), stored: z.boolean(),
  credentialVersion: z.number().int().positive().nullable(),
  credentialStatus: z.string().nullable(), connectionStatus: z.string(),
  connectionRowVersion: z.number().int().positive(),
  outcome: z.enum(["pending", "exchanging", "stored", "completed", "denied", "recovery_required"])
}).strict();

async function call(client: ExternalIntegrationsRpcClient, name: string, args: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error("qbo_customer_authorization_persistence_failed");
  return result.data;
}

export async function beginCustomerAuthorization(client: ExternalIntegrationsRpcClient, stateId: string, realmFingerprint: string) {
  return z.object({ credentialId: z.string().uuid(), priorMappingVerificationFingerprint: fingerprint.nullable() }).strict().parse(
    await call(client, "begin_qbo_customer_authorization_v1", {
      p_state_id: z.string().uuid().parse(stateId), p_realm_fingerprint: fingerprint.parse(realmFingerprint)
    })
  );
}

export async function finishCustomerAuthorization(
  client: ExternalIntegrationsRpcClient, stateId: string,
  outcome: "completed" | "denied" | "recovery_required"
) {
  return z.object({ outcome: z.literal(outcome), idempotent: z.boolean() }).strict().parse(
    await call(client, "finish_qbo_customer_authorization_v1", { p_state_id: stateId, p_outcome: outcome })
  );
}

/** A lost store acknowledgement is resolved by reading the exact durable
 * credential/state identity. Neither the OAuth exchange nor storage is replayed. */
export async function persistBeforeDiscovery<T, D>(input: {
  client: ExternalIntegrationsRpcClient; stateId: string; credentialId: string;
  store: () => Promise<T>; discover: () => Promise<D>;
}) {
  try {
    await input.store();
  } catch {
    const reconciled = completion.parse(await call(input.client, "read_qbo_customer_authorization_completion_v1", {
      p_state_id: input.stateId
    }));
    if (!reconciled.stored || reconciled.credentialId !== input.credentialId ||
      reconciled.credentialStatus !== "active" || reconciled.outcome !== "stored") {
      throw new Error("qbo_customer_credential_storage_uncertain");
    }
  }
  return input.discover();
}

export async function completeCustomerAuthorization<T>(input: {
  client: ExternalIntegrationsRpcClient; stateId: string; complete: () => Promise<T>;
}) {
  try {
    const result = await input.complete();
    await finishCustomerAuthorization(input.client, input.stateId, "completed");
    return result;
  } catch {
    // A failed status write must not result in another code exchange. Even if
    // this call fails, the consumed state remains single-use and nonretryable.
    await finishCustomerAuthorization(input.client, input.stateId, "recovery_required").catch(() => undefined);
    throw new Error("qbo_customer_authorization_recovery_required");
  }
}
