import "server-only";

import { z } from "zod";
import { BoundedIdentifierSchema, Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { QboProductionValidationClaimSchema, validateProductionQboSourceClaim } from "@/lib/integrations/provider-runtime/qbo/production-validation";

const limit = z.number().int().min(1).max(100);
const resultSchema = z.object({ sourceVersionId: UuidSchema, validatedVersionId: UuidSchema.nullable(),
  state: z.enum(["valid", "quarantined", "superseded"]), idempotent: z.boolean() }).strict();

async function rpc(client: ExternalIntegrationsRpcClient, name: string, args: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.code === "42501" ? "qbo_source_validation_denied" : "qbo_source_validation_failed");
  return result.data;
}

export async function discoverQboProductionValidationTasks(client: ExternalIntegrationsRpcClient, maximumTasks = 25) {
  const maximum = limit.parse(maximumTasks);
  const result = z.array(UuidSchema).max(maximum).safeParse(await rpc(client, "discover_qbo_production_source_validation_tasks_v1", {
    p_maximum_tasks: maximum
  }));
  if (!result.success || new Set(result.data).size !== result.data.length) throw new Error("qbo_validation_discovery_invalid");
  return result.data;
}

/** One bounded page. Durable jobs remain discoverable after crashes or lease expiry. */
export async function validateQboProductionSourcePage(input: {
  taskId: string; workerFingerprint: string; maximumResults: number; requestId: string;
}, client: ExternalIntegrationsRpcClient) {
  const worker = Sha256FingerprintSchema.parse(input.workerFingerprint);
  const maximumResults = limit.parse(input.maximumResults);
  const claims = z.array(QboProductionValidationClaimSchema).max(maximumResults).parse(await rpc(client,
    "claim_qbo_production_source_validation_v1", { p_task_id: UuidSchema.parse(input.taskId),
      p_worker_fingerprint: worker, p_maximum_results: maximumResults }));
  const results: z.infer<typeof resultSchema>[] = [];
  for (const claim of claims) {
    if (claim.taskId !== input.taskId) throw new Error("qbo_source_validation_task_binding_denied");
    const validated = validateProductionQboSourceClaim(claim);
    const result = resultSchema.parse(await rpc(client, "complete_qbo_production_source_validation_v1", {
      p_source_version_id: claim.sourceVersionId, p_claim_id: claim.claimId, p_worker_fingerprint: worker,
      p_validated_version: validated.validatedVersion, p_request_id: BoundedIdentifierSchema.parse(input.requestId)
    }));
    const expectedVersionId = result.state === "superseded" || claim.pendingVersion.changeKind === "deleted"
      ? null : claim.validatedVersionId;
    if (result.sourceVersionId !== claim.sourceVersionId || result.validatedVersionId !== expectedVersionId
      || (result.state !== "superseded" && result.state !== validated.validatedVersion.validation.state)) {
      throw new Error("qbo_source_validation_result_binding_denied");
    }
    results.push(result);
  }
  return { results, fullPage: claims.length === maximumResults, economicPromotionAllowed: false as const };
}
