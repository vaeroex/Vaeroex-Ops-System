import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { UuidSchema } from "@/lib/integrations/contracts/primitives";
import { QboSandboxCloudTaskNameSchema } from "@/lib/integrations/persistence/qbo-sandbox-runtime-repository";
import { CloudTaskDeliveryMetadataSchema } from "@/lib/integrations/runtime/contracts";

type HeaderValue = string | readonly string[] | undefined;

function requiredCanonicalCount(value: HeaderValue) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("phase8b_cloud_task_delivery_invalid");
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0 || count > 100) {
    throw new Error("phase8b_cloud_task_delivery_invalid");
  }
  return count;
}

export function parseQboCloudTaskDelivery(input: {
  taskId: string;
  workspaceId: string;
  businessEntityId: string;
  connectionId: string;
  connectionGeneration: number;
  expectedQueueName: string;
  trustedDispatchGeneration: number;
  taskName: HeaderValue;
  queueName: HeaderValue;
  retryCount: HeaderValue;
  executionCount: HeaderValue;
}) {
  const taskId = UuidSchema.parse(input.taskId);
  const workspaceId = UuidSchema.parse(input.workspaceId);
  const businessEntityId = UuidSchema.parse(input.businessEntityId);
  const connectionId = UuidSchema.parse(input.connectionId);
  const taskName = QboSandboxCloudTaskNameSchema.parse(input.taskName);
  if (input.queueName !== input.expectedQueueName) {
    throw new Error("phase8b_cloud_task_delivery_invalid");
  }
  const metadata = CloudTaskDeliveryMetadataSchema.parse({
    taskName,
    queueName: input.queueName,
    retryCount: requiredCanonicalCount(input.retryCount),
    executionCount: requiredCanonicalCount(input.executionCount)
  });
  if (
    !Number.isSafeInteger(input.connectionGeneration) ||
    input.connectionGeneration < 1 ||
    !Number.isSafeInteger(input.trustedDispatchGeneration) ||
    input.trustedDispatchGeneration < 1
  ) {
    throw new Error("phase8b_cloud_task_delivery_invalid");
  }
  return {
    ...metadata,
    dispatchGeneration: input.trustedDispatchGeneration,
    attemptFingerprint: contractSha256({
      fingerprintPurpose: "phase8b_cloud_task_delivery",
      fingerprintVersion: "phase8b_cloud_task_delivery_v2",
      workspaceId,
      businessEntityId,
      connectionId,
      connectionGeneration: input.connectionGeneration,
      taskId,
      taskName: metadata.taskName,
      queueName: metadata.queueName,
      dispatchGeneration: input.trustedDispatchGeneration,
      retryCount: metadata.retryCount,
      executionCount: metadata.executionCount
    })
  } as const;
}
