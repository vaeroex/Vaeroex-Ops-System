import { z } from "zod";

import { UuidSchema } from "@/lib/integrations/contracts/primitives";

const CloudTaskNameSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const QBO_PRECONTRACT_QUEUE_RESOURCE =
  "projects/vaeroex-p8b-20260823-84b2f0/locations/us-west1/queues/p8b-qbo";

export const QboPrecontractRetirementResultSchema = z
  .object({
    retirementEventId: UuidSchema,
    taskId: UuidSchema,
    state: z.literal("cancelled"),
    priorRowVersion: z.number().int().positive().safe(),
    rowVersion: z.number().int().positive().safe(),
    dispatchGeneration: z.number().int().positive().safe(),
    dispatcherTaskName: CloudTaskNameSchema,
    queueState: z.literal("PAUSED"),
    externalDeletionAuthorized: z.literal(true),
    idempotent: z.boolean()
  })
  .strict();

export const QboPrecontractEnvelopeReconciliationSchema = z
  .object({
    reconciliationId: UuidSchema,
    taskId: UuidSchema,
    deletionOutcome: z.enum(["deleted", "already_absent"]),
    idempotent: z.boolean()
  })
  .strict();

type RetirementResult = z.infer<typeof QboPrecontractRetirementResultSchema>;
type DeletionOutcome = "deleted" | "already_absent";

type QboPrecontractRetirementInput = Readonly<{
  taskId: string;
  expectedDispatcherTaskName: string;
  expectedDispatchGeneration: number;
  retireInDatabase(): Promise<unknown>;
  deleteExactCloudTask(input: Readonly<{
    queueResource: string;
    dispatcherTaskName: string;
  }>): Promise<DeletionOutcome>;
  reconcileDeletion(input: Readonly<{
    retirementEventId: string;
    taskId: string;
    queueResource: string;
    dispatcherTaskName: string;
    deletionOutcome: DeletionOutcome;
  }>): Promise<unknown>;
}>;

export type QboPrecontractRetirementOutcome = Readonly<{
  retirement: RetirementResult;
  deletionOutcome: DeletionOutcome;
  reconciliation: z.infer<typeof QboPrecontractEnvelopeReconciliationSchema>;
}>;

export async function retireQboPrecontractEnvelope(
  input: QboPrecontractRetirementInput
): Promise<QboPrecontractRetirementOutcome> {
  const taskId = UuidSchema.parse(input.taskId);
  const expectedDispatcherTaskName = CloudTaskNameSchema.parse(
    input.expectedDispatcherTaskName
  );
  const expectedDispatchGeneration = z
    .number()
    .int()
    .positive()
    .safe()
    .parse(input.expectedDispatchGeneration);

  const retirement = QboPrecontractRetirementResultSchema.parse(
    await input.retireInDatabase()
  );
  if (
    retirement.taskId !== taskId ||
    retirement.dispatcherTaskName !== expectedDispatcherTaskName ||
    retirement.dispatchGeneration !== expectedDispatchGeneration ||
    retirement.rowVersion !== retirement.priorRowVersion + 1
  ) {
    throw new Error("qbo_precontract_retirement_snapshot_mismatch");
  }

  const deletionOutcome = await input.deleteExactCloudTask({
    queueResource: QBO_PRECONTRACT_QUEUE_RESOURCE,
    dispatcherTaskName: retirement.dispatcherTaskName
  });
  const reconciliation = QboPrecontractEnvelopeReconciliationSchema.parse(
    await input.reconcileDeletion({
      retirementEventId: retirement.retirementEventId,
      taskId: retirement.taskId,
      queueResource: QBO_PRECONTRACT_QUEUE_RESOURCE,
      dispatcherTaskName: retirement.dispatcherTaskName,
      deletionOutcome
    })
  );
  if (
    reconciliation.taskId !== retirement.taskId ||
    reconciliation.deletionOutcome !== deletionOutcome
  ) {
    throw new Error("qbo_precontract_retirement_reconciliation_mismatch");
  }

  return { retirement, deletionOutcome, reconciliation };
}
