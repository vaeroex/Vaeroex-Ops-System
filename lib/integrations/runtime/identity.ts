import {
  CloudTaskDeliveryMetadataSchema,
  CloudTaskEnvelopeSchema,
  VerifiedGoogleOidcClaimsSchema
} from "@/lib/integrations/runtime/contracts";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";

export class CloudTaskDeliveryAuthorizer {
  authorize(input: {
    envelope: unknown;
    delivery: unknown;
    verifiedClaims: unknown;
    expectedAudience: string;
    expectedServiceAccount: string;
    expectedTaskName: string;
    now: Date;
  }) {
    const envelope = CloudTaskEnvelopeSchema.parse(input.envelope);
    const delivery = CloudTaskDeliveryMetadataSchema.parse(input.delivery);
    const claims = VerifiedGoogleOidcClaimsSchema.parse(input.verifiedClaims);
    const nowSeconds = Math.floor(input.now.getTime() / 1_000);
    if (
      claims.audience !== input.expectedAudience ||
      claims.email !== input.expectedServiceAccount ||
      claims.subject.length === 0 ||
      claims.issuedAt > nowSeconds + 60 ||
      claims.expiresAt <= nowSeconds ||
      claims.expiresAt - claims.issuedAt > 3_900 ||
      delivery.taskName !== input.expectedTaskName
    ) {
      throw new Error("integration_cloud_task_identity_denied");
    }
    return {
      taskId: envelope.taskId,
      executionCount: delivery.executionCount,
      retryCount: delivery.retryCount,
      serviceIdentity: claims.email,
      deliveryAttemptFingerprint: contractSha256({
        fingerprintPurpose: "integration_cloud_task_delivery_attempt",
        fingerprintVersion: "integration_cloud_task_delivery_attempt_fingerprint_v1",
        payload: {
          taskId: envelope.taskId,
          taskName: delivery.taskName,
          queueName: delivery.queueName,
          executionCount: delivery.executionCount,
          retryCount: delivery.retryCount,
          tokenIssuedAt: claims.issuedAt,
          serviceIdentity: claims.email
        }
      })
    } as const;
  }
}
