import "server-only";

import { createHash, createHmac } from "node:crypto";
import {
  buildNormalizedDocumentExtractionArtifact,
  buildNormalizedDocumentExtractionArtifactV2,
  criticalFieldManifestForArtifactWithProvenance,
  criticalFieldManifestForArtifactV2WithProvenance,
  type NormalizedDocumentExtractionArtifactDraftV1,
  type NormalizedDocumentExtractionArtifactDraftV2
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
  resolveDocumentExtractionLease,
  type DocumentExtractionLeaseContext,
  type DocumentExtractionProviderProfile
} from "@/lib/document-extraction/broker-store";
import { createManagedDocumentExtractionEncryptionProvider } from "@/lib/document-extraction/encryption";
import { persistWithDocumentExtractionNonceRetry } from "@/lib/document-extraction/nonce-retry";
import {
  DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION,
  DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION_V2,
  DOCUMENT_EXTRACTION_ROUTING_POLICY_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
  NVIDIA_DOCUMENT_EXTRACTION_ENDPOINT_CONTRACT_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_HOSTED_COMPATIBILITY_CONTRACT_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_NORMALIZATION_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
  NVIDIA_DOCUMENT_EXTRACTION_REQUEST_SERIALIZER_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_RESPONSE_VALIDATOR_VERSION
} from "@/lib/document-extraction/contracts";
import {
  buildDocumentExtractionReviewProvenance,
  buildDocumentExtractionReviewProvenanceV2
} from "@/lib/document-extraction/review-provenance";
import {
  resolveDocumentExtractionProviderRuntimeContract,
  type DocumentExtractionProviderRuntimeContract
} from "@/lib/document-extraction/provider-profile";
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
  providerProfile,
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
  providerProfile: DocumentExtractionProviderProfile;
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
    costAmountUsd: null,
    providerProfile
  });
}

function providerProfile(
  contract: DocumentExtractionProviderRuntimeContract
): DocumentExtractionProviderProfile {
  if (
    contract.providerProfile !== NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
    && contract.providerProfile !== GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
  ) {
    throw new Error("document_extraction_provider_profile_not_approved");
  }
  return contract.providerProfile;
}

function assertLeaseIdentity(
  context: DocumentExtractionLeaseContext,
  contract: DocumentExtractionProviderRuntimeContract
) {
  const expected = [
    [context.parser_provider, contract.parserProvider],
    [context.parser_model, contract.parserModel],
    [context.parser_revision, contract.parserRevision],
    [context.client_revision, contract.clientRevision],
    [context.provider_profile, contract.providerProfile],
    [context.processor_type, contract.processorType],
    [context.processor_id, contract.processorId],
    [context.processor_resource, contract.processorResource],
    [context.processor_location, contract.processorLocation],
    [context.processor_version, contract.processorVersion],
    [context.endpoint_contract_version, contract.endpointContractVersion],
    [context.request_serializer_version, contract.requestSerializerVersion],
    [context.response_validator_version, contract.responseValidatorVersion],
    [context.provider_normalization_version, contract.providerNormalizationVersion],
    [context.compatibility_policy_version, contract.compatibilityPolicyVersion],
    [context.table_policy_version, contract.tablePolicyVersion],
    [context.confidence_policy_version, contract.confidencePolicyVersion],
    [context.selection_mark_policy_version, contract.selectionMarkPolicyVersion],
    [context.routing_policy_version, DOCUMENT_EXTRACTION_ROUTING_POLICY_VERSION],
    [
      context.review_provenance_version,
      contract.providerProfile === GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
        ? DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION_V2
        : DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION
    ],
    [context.extraction_contract_version, contract.extractionContractVersion],
    [context.normalization_version, contract.artifactNormalizationVersion]
  ] as const;
  if (expected.some(([actual, approved]) => actual !== approved)) {
    throw new Error("document_extraction_provider_contract_mismatch");
  }
  if (
    (contract.providerProfile === NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
      && context.route !== "nvidia_primary" && context.route !== "nvidia_fallback")
    || (contract.providerProfile === GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
      && context.route !== "google_primary" && context.route !== "google_fallback")
  ) {
    throw new Error("document_extraction_provider_route_mismatch");
  }
  return context;
}

async function resolveExactLease(
  jobId: string,
  workerId: string,
  contract: DocumentExtractionProviderRuntimeContract
) {
  const context = await resolveDocumentExtractionLease(
    jobId,
    workerId,
    providerProfile(contract)
  );
  return assertLeaseIdentity(context, contract);
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
  const providerContract = resolveDocumentExtractionProviderRuntimeContract(environment);
  const activeProviderProfile = providerProfile(providerContract);

  if (request.operation === "claim") {
    assertDocumentExtractionProviderDispatchEnabled(environment, runtimeEnvironment);
    if (request.providerProfile !== activeProviderProfile) {
      throw new Error("document_extraction_provider_profile_mismatch");
    }
    const job = await claimDocumentExtractionJob(
      workerId,
      activeProviderProfile,
      request.leaseSeconds
    );
    if (!job) return { ok: true, claimed: false };
    const context = await resolveExactLease(job.id, workerId, providerContract);
    return {
      ok: true,
      claimed: true,
      job: {
        id: job.id,
        route: job.route,
        documentClass: job.document_class,
        pageCount: job.page_count,
        providerProfile: activeProviderProfile,
        parserProvider: context.parser_provider,
        parserModel: context.parser_model,
        parserRevision: context.parser_revision,
        clientRevision: context.client_revision,
        processorType: context.processor_type,
        processorId: context.processor_id,
        processorResource: context.processor_resource,
        processorLocation: context.processor_location,
        processorVersion: context.processor_version,
        endpointContractVersion: context.endpoint_contract_version,
        requestSerializerVersion: context.request_serializer_version,
        responseValidatorVersion: context.response_validator_version,
        providerNormalizationVersion: context.provider_normalization_version,
        compatibilityPolicyVersion: context.compatibility_policy_version,
        tablePolicyVersion: context.table_policy_version,
        confidencePolicyVersion: context.confidence_policy_version,
        selectionMarkPolicyVersion: context.selection_mark_policy_version,
        routingPolicyVersion: context.routing_policy_version,
        reviewProvenanceVersion: context.review_provenance_version,
        extractionContractVersion: context.extraction_contract_version,
        normalizationVersion: context.normalization_version,
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
  let context = await resolveExactLease(lease.jobId, workerId, providerContract);
  if (request.operation === "heartbeat") {
    const extended = await heartbeatDocumentExtractionJob(lease.jobId, workerId, request.leaseSeconds);
    if (!extended) throw new Error("document_extraction_heartbeat_denied");
    context = await resolveExactLease(lease.jobId, workerId, providerContract);
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
      ttlSeconds: request.ttlSeconds,
      providerProfile: activeProviderProfile
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
      requestId: request.requestId,
      providerProfile: activeProviderProfile
    });
    return { ok: result.advanced, ...result };
  }

  if (request.operation === "authorize_dispatch") {
    assertDocumentExtractionProviderDispatchEnabled(environment, runtimeEnvironment);
    const result = await authorizeDocumentExtractionDispatch({
      jobId: lease.jobId,
      workerId,
      dispatchRequestId: request.dispatchRequestId,
      providerProfile: activeProviderProfile
    });
    return { ok: result.authorized, ...result };
  }

  if (request.operation === "check_provider_boundary") {
    assertDocumentExtractionProviderDispatchEnabled(environment, runtimeEnvironment);
    const result = await checkDocumentExtractionProviderBoundary({
      jobId: lease.jobId,
      workerId,
      boundary: request.boundary,
      providerProfile: activeProviderProfile
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
      latencyMs: request.latencyMs,
      providerProfile: activeProviderProfile
    });
    return { ok: result.recorded, ...result };
  }

  if (request.operation === "authorize_retry") {
    assertDocumentExtractionProviderDispatchEnabled(environment, runtimeEnvironment);
    if (activeProviderProfile === GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE) {
      throw new Error("document_extraction_google_retry_not_permitted");
    }
    const result = await authorizeDocumentExtractionRetry({
      jobId: lease.jobId,
      workerId,
      priorDispatchRequestId: request.priorDispatchRequestId,
      nextDispatchRequestId: request.nextDispatchRequestId,
      providerProfile: activeProviderProfile
    });
    return { ok: result.authorized, ...result };
  }
  if (request.operation === "complete") {
    assertDocumentExtractionProviderGateEnabled(environment, runtimeEnvironment);
    if (context.stage !== "encrypting") throw new Error("document_extraction_completion_stage_invalid");
    const artifact = activeProviderProfile === GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
      ? buildNormalizedDocumentExtractionArtifactV2(
        request.artifact as NormalizedDocumentExtractionArtifactDraftV2
      )
      : buildNormalizedDocumentExtractionArtifact(
        request.artifact as NormalizedDocumentExtractionArtifactDraftV1
      );
    if (
      artifact.route !== context.route
      || artifact.documentClass !== context.document_class
      || artifact.pageCount !== context.page_count
    ) {
      throw new Error("document_extraction_artifact_job_mismatch");
    }
    const reviewProvenance = activeProviderProfile === GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
      ? buildDocumentExtractionReviewProvenanceV2({
        workspaceId: context.workspace_id,
        jobId: context.job_id,
        cacheKey: context.cache_key,
        contentFingerprint: artifact.artifactFingerprint,
        pageCount: context.page_count,
        processorId: context.processor_id || "",
        processorResource: context.processor_resource || "",
        routingPolicyVersion: context.routing_policy_version
      })
      : buildDocumentExtractionReviewProvenance({
        workspaceId: context.workspace_id,
        jobId: context.job_id,
        cacheKey: context.cache_key,
        contentFingerprint: artifact.artifactFingerprint,
        pageCount: context.page_count,
        parserRevision: context.parser_revision,
        clientRevision: context.client_revision,
        providerProfile: NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
        endpointContractVersion: NVIDIA_DOCUMENT_EXTRACTION_ENDPOINT_CONTRACT_VERSION,
        requestSerializerVersion: NVIDIA_DOCUMENT_EXTRACTION_REQUEST_SERIALIZER_VERSION,
        responseValidatorVersion: NVIDIA_DOCUMENT_EXTRACTION_RESPONSE_VALIDATOR_VERSION,
        providerNormalizationVersion: NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_NORMALIZATION_VERSION,
        compatibilityPolicyVersion: NVIDIA_DOCUMENT_EXTRACTION_HOSTED_COMPATIBILITY_CONTRACT_VERSION,
        modelAlias: context.parser_model
      });
    const criticalFieldManifest = activeProviderProfile === GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
      ? criticalFieldManifestForArtifactV2WithProvenance(
        artifact as ReturnType<typeof buildNormalizedDocumentExtractionArtifactV2>,
        reviewProvenance.provenance as ReturnType<typeof buildDocumentExtractionReviewProvenanceV2>["provenance"],
        reviewProvenance.reviewProvenanceFingerprint
      )
      : criticalFieldManifestForArtifactWithProvenance(
        artifact as ReturnType<typeof buildNormalizedDocumentExtractionArtifact>,
        reviewProvenance.provenance as ReturnType<typeof buildDocumentExtractionReviewProvenance>["provenance"],
        reviewProvenance.reviewProvenanceFingerprint
      );
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
        criticalFieldManifest,
        ciphertext: envelope.ciphertext,
        keyVersion: envelope.keyVersion,
        nonce: envelope.nonce,
        authenticationTag: envelope.authenticationTag,
        aadDigest: envelope.aadDigest,
        providerProfile: activeProviderProfile
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
      providerProfile: activeProviderProfile,
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
    providerProfile: activeProviderProfile,
    environment
  });
  const result = await failDocumentExtractionJob({
    jobId: lease.jobId,
    workerId,
    failureCode: request.failureCode,
    failureClass: request.failureClass,
    providerProfile: activeProviderProfile
  });
  return { ok: true, ...result };
}
