import "server-only";

import { z } from "zod";
import { BoundedIdentifierSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { scheduleQboProductionInitialization } from "@/lib/integrations/persistence/qbo-production-repository";
import { QboValidationRecoveryResultSchema } from "./validation-recovery";
import { QboAccountingRecoveryResultSchema } from "./accounting-recovery";

const maintenanceValidationResult = QboValidationRecoveryResultSchema.extend({
  accounting: QboAccountingRecoveryResultSchema.optional()
});

const disconnectResult = z.object({
  disconnectedCount: z.number().int().min(0).max(25),
  providerRevokedCount: z.number().int().min(0).max(25),
  providerUnconfirmedCount: z.number().int().min(0).max(25),
  promotionAuthorized: z.literal(false), modelCallCount: z.literal(0)
}).strict().refine(value => value.disconnectedCount === value.providerRevokedCount &&
  value.providerRevokedCount + value.providerUnconfirmedCount <= 25);

/** One maintenance failure must not prevent attempted disconnect finalization. */
export async function runQboSchedulerMaintenance(input: {
  validate: () => Promise<unknown>; disconnect: () => Promise<unknown>;
}) {
  let validation: z.infer<typeof maintenanceValidationResult> | null = null;
  let disconnect: z.infer<typeof disconnectResult> | null = null;
  try { validation = maintenanceValidationResult.parse(await input.validate()); } catch { /* Report bounded failure below. */ }
  try { disconnect = disconnectResult.parse(await input.disconnect()); } catch { /* Both drains are independently attempted. */ }
  return { validation, disconnect, validationFailed: validation === null, disconnectFailed: disconnect === null };
}

const ongoingResult = z.object({
  scheduledConnectionCount: z.number().int().min(0).max(25),
  scheduledTaskCount: z.number().int().min(0).max(325),
  settledRunCount: z.number().int().nonnegative(),
  blockedCdcCount: z.number().int().min(0).max(25),
  runs: z.array(z.object({
    workspaceId: UuidSchema, businessEntityId: UuidSchema, connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(), syncRunId: UuidSchema,
    taskCount: z.number().int().min(1).max(13)
  }).strict()).max(25)
}).strict().superRefine((value, context) => {
  if (value.runs.length !== value.scheduledConnectionCount ||
      value.runs.reduce((sum, run) => sum + run.taskCount, 0) !== value.scheduledTaskCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "qbo_ongoing_schedule_result_inconsistent" });
  }
});

export async function scheduleQboProductionWork(maximumConnections: number, requestId: string, client: ExternalIntegrationsRpcClient) {
  const limit = z.number().int().min(1).max(25).parse(maximumConnections);
  BoundedIdentifierSchema.parse(requestId);
  const initial = await scheduleQboProductionInitialization(limit, requestId, client);
  const result = await client.rpc("schedule_qbo_ongoing_v1", { p_limit: limit - initial.scheduledConnectionCount, p_request_id: requestId });
  if (result.error) throw new Error("qbo_ongoing_scheduler_failed");
  const ongoing = ongoingResult.parse(result.data);
  return {
    scheduledConnectionCount: new Set([...initial.runs, ...ongoing.runs].map(run => run.connectionId)).size,
    scheduledTaskCount: initial.scheduledTaskCount + ongoing.scheduledTaskCount,
    settledRunCount: ongoing.settledRunCount,
    blockedCdcCount: ongoing.blockedCdcCount
  };
}
