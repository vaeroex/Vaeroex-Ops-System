import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { CloudTaskDeliveryMetadataSchema } from "@/lib/integrations/runtime/contracts";

type HeaderValue = string | readonly string[] | undefined;

function count(value: HeaderValue) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("qbo_production_cloud_task_delivery_invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("qbo_production_cloud_task_delivery_invalid");
  }
  return parsed;
}

export function parseQboProductionCloudTaskDelivery(input: {
  queueResource: string;
  expectedQueueName: string;
  taskHeader: HeaderValue;
  queueHeader: HeaderValue;
  retryHeader: HeaderValue;
  executionHeader: HeaderValue;
  taskId: string;
  workspaceId: string;
  businessEntityId: string;
  connectionId: string;
  connectionGeneration: number;
  dispatchGeneration: number;
}) {
  if (input.queueHeader !== input.expectedQueueName || typeof input.taskHeader !== "string") {
    throw new Error("qbo_production_cloud_task_delivery_invalid");
  }
  const fullTaskName = /^[a-f0-9]{64}$/.test(input.taskHeader)
    ? `${input.queueResource}/tasks/${input.taskHeader}`
    : input.taskHeader;
  if (
    !fullTaskName.startsWith(`${input.queueResource}/tasks/`) ||
    !/^projects\/[a-z][a-z0-9-]{0,62}\/locations\/[a-z][a-z0-9-]{0,62}\/queues\/[a-z][a-z0-9-]{0,62}\/tasks\/[a-f0-9]{64}$/.test(fullTaskName) ||
    !Number.isSafeInteger(input.dispatchGeneration) ||
    input.dispatchGeneration < 1
  ) {
    throw new Error("qbo_production_cloud_task_delivery_invalid");
  }
  const metadata = CloudTaskDeliveryMetadataSchema.parse({
    taskName: fullTaskName,
    queueName: input.queueHeader,
    retryCount: count(input.retryHeader),
    executionCount: count(input.executionHeader)
  });
  return {
    ...metadata,
    dispatchGeneration: input.dispatchGeneration,
    attemptFingerprint: contractSha256({
      fingerprintPurpose: "qbo_production_cloud_task_delivery",
      fingerprintVersion: "qbo_production_cloud_task_delivery_v2",
      workspaceId: input.workspaceId,
      businessEntityId: input.businessEntityId,
      connectionId: input.connectionId,
      connectionGeneration: input.connectionGeneration,
      taskId: input.taskId,
      taskName: metadata.taskName,
      queueName: metadata.queueName,
      dispatchGeneration: input.dispatchGeneration,
      retryCount: metadata.retryCount,
      executionCount: metadata.executionCount
    })
  } as const;
}
