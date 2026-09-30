import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { discoverQboProductionValidationTasks, validateQboProductionSourcePage } from "@/lib/integrations/persistence/qbo-production-validation-repository";

export const QboValidationRecoveryResultSchema = z.object({
  discoveredTaskCount: z.number().int().min(0).max(25),
  validatedCount: z.number().int().min(0).max(2500),
  quarantinedCount: z.number().int().min(0).max(2500),
  supersededCount: z.number().int().min(0).max(2500),
  fullPageCount: z.number().int().min(0).max(25)
}).strict();

/** Only drain durable validation jobs; task/checkpoint completion stays with its owner. */
export async function recoverQboProductionValidation(client: ExternalIntegrationsRpcClient, maximumTasks = 5) {
  const limit = z.number().int().min(1).max(25).parse(maximumTasks);
  const taskIds = await discoverQboProductionValidationTasks(client, limit);
  if (taskIds.length > limit || new Set(taskIds).size !== taskIds.length) throw new Error("qbo_validation_discovery_invalid");
  const counts = { discoveredTaskCount: taskIds.length, validatedCount: 0, quarantinedCount: 0, supersededCount: 0, fullPageCount: 0 };
  const workerFingerprint = contractSha256({ fingerprintPurpose: "qbo_validation_recovery", fingerprintVersion: "qbo_validation_recovery_v1", workerId: randomUUID() });
  for (const taskId of taskIds) {
    const page = await validateQboProductionSourcePage({ taskId, workerFingerprint, maximumResults: 100,
      requestId: `qbo_recover_validation_${randomUUID()}` }, client);
    if (page.fullPage) counts.fullPageCount += 1;
    for (const result of page.results) {
      if (result.state === "valid") counts.validatedCount += 1;
      else if (result.state === "quarantined") counts.quarantinedCount += 1;
      else counts.supersededCount += 1;
    }
  }
  // An empty claim can mean another worker owns the jobs, not completed work.
  return QboValidationRecoveryResultSchema.parse(counts);
}
