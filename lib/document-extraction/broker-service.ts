import "server-only";

import { createHash, createHmac } from "node:crypto";
import {
  buildNormalizedDocumentExtractionArtifact,
  criticalFieldManifestForArtifact,
  type NormalizedDocumentExtractionArtifactDraftV1
} from "@/lib/document-extraction/artifact";
import {
  createFileCapability,
  createFileGrantSecret,
  createLeaseCapability,
  verifyBrokerCapability
} from "@/lib/document-extraction/broker-capability";
import type { DocumentExtractionBrokerRequest } from "@/lib/document-extraction/broker-contracts";
import {
  advanceDocumentExtractionStage,
  authorizeDocumentExtractionDispatch,
  authorizeDocumentExtractionRetry,
  claimDocumentExtractionJob,
  checkDocumentExtractionProviderBoundary,
  completeDocumentExtractionJob,
  failDocumentExtractionJob,
  heartbeatDocumentExtractionJob,
  issueDocumentExtractionFileGrant,
  recordDocumentExtractionProviderOutcome,
  recordDocumentExtractionTelemetry,
  resolveDocumentExtractionLease
} from "@/lib/document-extraction/broker-store";
import { createManagedDocumentExtractionEncryptionProvider } from "@/lib/document-extraction/encryption";
import { persistWithDocumentExtractionNonceRetry } from "@/lib/document-extraction/nonce-retry";
import {
  assertDocumentExtractionBrokerEnabled,
  assertDocumentExtractionProviderGateEnabled,
  assertDocumentExtractionProviderDispatchEnabled,
  resolveDocumentExtractionExecutionPolicy,
  type DocumentExtractionRuntimeEnvironment
} from "@/lib/document-extraction/runtime-policy";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function telemetryKey(environment: NodeJS.ProcessEnv) {
  const encoded = environment.DOCUMENT_EXTRACTION_TELEMETRY_HMAC_SECRET;
  if (!encoded?.trim()) throw new Error("document_extraction_telemetry_key_missing");
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
    throw new Error("document_extraction_telemetry_key_invalid");
  }
  return key;
}

function pseudonym(value: string, environment: NodeJS.ProcessEnv) {
  return createHmac("sha256", telemetryKey(environment)).update(value).digest("hex");
}

function leaseFor(token: string, workerId: string, environment: NodeJS.ProcessEnv) {
  const capability = verifyBrokerCapability({
    token,
    workerId,
    expectedKind: "lease",
    environment
  });
  if (capability.kind !== "lease") throw new Error("document_extraction_lease_capability_invalid");
  return capability;
}

async function recordFinalTelemetry({
  jobId,
  workerId,
  workspaceId,
  telemetry,
  environment
}: {
  jobId: string;
  workerId: string;
  workspaceId: string;
  telemetry: {
    requestId: string;
    latencyMs: number | null;
    validationResult: string | null;
    encryptionResult: string | null;
    cacheResult: string | null;
  };
  environment: NodeJS.ProcessEnv;
}) {
  return recordDocumentExtractionTelemetry({
    jobId,
    workerId,
    requestId: telemetry.requestId,
    jobIdHash: pseudonym(`job:${jobId}`, environment),
    workspaceHash: pseudonym(`workspace:${workspaceId}`, environment),
    latencyMs: telemetry.latencyMs,
    validationResult: telemetry.validationResult,
    encryptionResult: telemetry.encryptionResult,
    cacheResult: telemetry.cacheResult,
    costRateVersion: null,
    costAmountUsd: null
  });
}

export async function handleDocumentExtractionBrokerOperation({
  request,
  workerId,
  runtimeEnvironment,
  environment = process.env
}: {
  request: DocumentExtractionBrokerRequest;
  workerId: string;
  runtimeEnvironment: DocumentExtractionRuntimeEnvironment;
  environment?: NodeJS.ProcessEnv;
}): Promise<Record<string, unknown>> {
  if (request.operation === "health") {
    const policy = resolveDocumentExtractionExecutionPolicy(environment, runtimeEnvironment);
    return {
      ok: true,
      brokerEnabled: policy.brokerEnabled,
      providerExecutionEnabled: policy.providerExecutionEnabled,
      environment: policy.environment
    };
  }

  assertDocumentExtractionBrokerEnabled(environment, runtimeEnvironment);

  if (request.operation === "claim") {
    assertDocumentExtractionProviderDispatchEnabled(environment, runtimeEnvironment);
    const job = await claimDocumentExtractionJob(workerId, request.leaseSeconds);
    if (!job) return { ok: true, claimed: false };
    return {
      ok: true,
      claimed: true,
      job: {
        id: job.id,
        route: job.route,
        documentClass: job.document_class,
        pageCount: job.page_count,
        leaseCapability: createLeaseCapability({
          jobId: job.id,
          workerId,
          expiresAt: job.lease_expires_at,
          environment
        })
      }
    };
  }

  const lease = leaseFor(request.leaseCapability, workerId, environment);
  if (request.operation === "heartbeat") {
    const extended = await heartbeatDocumentExtractionJob(lease.jobId, workerId, request.leaseSeconds);
    if (!extended) throw new Error("document_extraction_heartbeat_denied");
    const context = await resolveDocumentExtractionLease(lease.jobId, workerId);
    return {
      ok: true,
      leaseCapability: createLeaseCapability({
        jobId: lease.jobId,
        workerId,
        expiresAt: context.lease_expires_at,
        environment
      })
    };
  }

  if (request.operation === "issue_file_access") {
    assertDocumentExtractionProviderDispatchEnabled(environment, runtimeEnvironment);
    const secret = createFileGrantSecret();
    const grant = await issueDocumentExtractionFileGrant({
      jobId: lease.jobId,
      workerId,
      tokenHash: sha256(secret),
      ttlSeconds: request.ttlSeconds
    });
    if (!grant.issued || !grant.grant_id || !grant.expires_at) {
      return { ok: false, issued: false, reason: grant.reason || "file_access_denied" };
    }
    return {
      ok: true,
      issued: true,
      expiresAt: grant.expires_at,
      pageCount: grant.page_count,
      fileCapability: createFileCapability({
        grantId: grant.grant_id,
        workerId,
        expiresAt: grant.expires_at,
        secret,
        environment
      })
    };
  }

  if (request.operation === "advance_stage") {
    assertDocumentExtractionProviderGateEnabled(environment, runtimeEnvironment);
    const result = await advanceDocumentExtractionStage({
      jobId: lease.jobId,
      workerId,
      expectedStage: request.expectedStage,
      nextStage: request.nextStage,
      requestId: request.requestId
    });
    return { ok: result.advanced, ...result };
  }

  if (request.operation === "authorize_dispatch") {
    assertDocumentExtractionProviderDispatchEnabled(environment, runtimeEnvironment);
    const result = await authorizeDocumentExtractionDispatch({
      jobId: lease.jobId,
      workerId,
      dispatchRequestId: request.dispatchRequestId
    });
    return { ok: result.authorized, ...result };
  }

  if (request.operation === "check_provider_boundary") {
    assertDocumentExtractionProviderDispatchEnabled(environment, runtimeEnvironment);
    const result = await checkDocumentExtractionProviderBoundary({
      jobId: lease.jobId,
      workerId,
      boundary: request.boundary
    });
    if (!result.allowed || !result.lease_expires_at) {
      return { ok: false, ...result };
    }
    return {
      ok: true,
      ...result,
      leaseCapability: createLeaseCapability({
        jobId: lease.jobId,
        workerId,
        expiresAt: result.lease_expires_at,
        environment
      })
    };
  }

  if (request.operation === "provider_outcome") {
    const result = await recordDocumentExtractionProviderOutcome({
      jobId: lease.jobId,
      workerId,
      dispatchRequestId: request.dispatchRequestId,
      resultClass: request.resultClass,
      latencyMs: request.latencyMs
    });
    return { ok: result.recorded, ...result };
  }

  if (request.operation === "authorize_retry") {
    assertDocumentExtractionProviderDispatchEnabled(environment, runtimeEnvironment);
    const result = await authorizeDocumentExtractionRetry({
      jobId: lease.jobId,
      workerId,
      priorDispatchRequestId: request.priorDispatchRequestId,
      nextDispatchRequestId: request.nextDispatchRequestId
    });
    return { ok: result.authorized, ...result };
  }

  const context = await resolveDocumentExtractionLease(lease.jobId, workerId);
  if (request.operation === "complete") {
    assertDocumentExtractionProviderGateEnabled(environment, runtimeEnvironment);
    if (context.stage !== "encrypting") throw new Error("document_extraction_completion_stage_invalid");
    const artifact = buildNormalizedDocumentExtractionArtifact(
      request.artifact as NormalizedDocumentExtractionArtifactDraftV1
    );
    if (
      artifact.route !== context.route
      || artifact.documentClass !== context.document_class
      || artifact.pageCount !== context.page_count
    ) {
      throw new Error("document_extraction_artifact_job_mismatch");
    }
    const encryption = createManagedDocumentExtractionEncryptionProvider();
    const result = await persistWithDocumentExtractionNonceRetry(
      () => encryption.encrypt(artifact, {
        workspaceId: context.workspace_id,
        cacheKey: context.cache_key,
        artifactFingerprint: artifact.artifactFingerprint,
        extractionContractVersion: context.extraction_contract_version,
        normalizationVersion: context.normalization_version
      }),
      (envelope) => completeDocumentExtractionJob({
        jobId: lease.jobId,
        workerId,
        artifactFingerprint: artifact.artifactFingerprint,
        criticalFieldManifest: criticalFieldManifestForArtifact(artifact),
        ciphertext: envelope.ciphertext,
        keyVersion: envelope.keyVersion,
        nonce: envelope.nonce,
        authenticationTag: envelope.authenticationTag,
        aadDigest: envelope.aadDigest
      })
    );
    await recordFinalTelemetry({
      jobId: lease.jobId,
      workerId,
      workspaceId: context.workspace_id,
      telemetry: {
        ...request.telemetry,
        validationResult: "passed",
        encryptionResult: "encrypted",
        cacheResult: "store_authorized"
      },
      environment
    });
    return { ok: true, ...result };
  }

  await recordFinalTelemetry({
    jobId: lease.jobId,
    workerId,
    workspaceId: context.workspace_id,
    telemetry: {
      ...request.telemetry,
      validationResult: request.failureClass === "validation" ? "failed" : request.telemetry.validationResult,
      encryptionResult: request.failureClass === "encryption" ? "failed" : request.telemetry.encryptionResult,
      cacheResult: "not_stored"
    },
    environment
  });
  const result = await failDocumentExtractionJob({
    jobId: lease.jobId,
    workerId,
    failureCode: request.failureCode,
    failureClass: request.failureClass
  });
  return { ok: true, ...result };
}
