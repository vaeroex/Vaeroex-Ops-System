import "server-only";

import { createHash } from "node:crypto";
import { compareDocumentExtractions } from "@/lib/ai/document-intelligence-poc/pilot-agreement";
import { assessDocumentForPilot } from "@/lib/ai/document-intelligence-poc/pilot-assessment";
import {
  DocumentPilotCircuitBreaker,
  DocumentPilotExtractionCoordinator,
  MemoryDocumentPilotCache,
  documentPilotCacheKey,
  workspaceScopedDocumentPilotCacheKey
} from "@/lib/ai/document-intelligence-poc/pilot-cache";
import {
  DOCUMENT_PILOT_NORMALIZATION_VERSION,
  DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION,
  DOCUMENT_ROUTING_POLICY_VERSION,
  DOCUMENT_PILOT_TELEMETRY_VERSION,
  type DocumentAssessmentInputV1,
  type DocumentExtractionFailureCode,
  type DocumentPilotConfig,
  type DocumentPilotOutcomeV1,
  type ProviderNeutralDocumentExtractionV1
} from "@/lib/ai/document-intelligence-poc/pilot-contracts";
import { OFFICIAL_NVIDIA_PILOT_IDENTITY } from "@/lib/ai/document-intelligence-poc/pilot-official-adapter";
import { routeDocumentAssessment } from "@/lib/ai/document-intelligence-poc/pilot-router";
import {
  assertPrivacySafeDocumentPilotTelemetry,
  configuredPlanningCost,
  privacySafeWorkspaceScopeHash
} from "@/lib/ai/document-intelligence-poc/pilot-telemetry";

const defaultCoordinator = new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache());
const defaultCircuitBreaker = new DocumentPilotCircuitBreaker();
const RETRYABLE_FAILURES = new Set<DocumentExtractionFailureCode>(["transport_failure", "timeout", "rate_limit"]);

export type DocumentPilotRunOptions = Readonly<{
  config: DocumentPilotConfig;
  assessmentInput: DocumentAssessmentInputV1;
  documentBytes: Buffer;
  workspaceScope: string;
  telemetryHashKey: string;
  authorizedForWorkspace: boolean;
  syntheticDocument: boolean;
  nativeExtraction?: ProviderNeutralDocumentExtractionV1 | null;
  nvidiaExtractor?: () => Promise<ProviderNeutralDocumentExtractionV1>;
  coordinator?: DocumentPilotExtractionCoordinator;
  circuitBreaker?: DocumentPilotCircuitBreaker;
  qualifiedReanalysisKey?: string;
}>;

function failedNvidiaExtraction(
  failureCode: Exclude<DocumentExtractionFailureCode, null>,
  providerCalls = 0,
  retries = 0,
  latencyMs = 0
): ProviderNeutralDocumentExtractionV1 {
  return {
    contractVersion: DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION,
    normalizationVersion: DOCUMENT_PILOT_NORMALIZATION_VERSION,
    source: "nvidia",
    provider: "nvidia",
    model: OFFICIAL_NVIDIA_PILOT_IDENTITY.model,
    clientRevision: OFFICIAL_NVIDIA_PILOT_IDENTITY.clientRevision,
    status: "failed",
    pageCount: 0,
    outputElementCount: 0,
    criticalFields: [],
    validationResult: "invalid",
    failureCode,
    latencyMs,
    providerCalls,
    successfulCalls: 0,
    failedCalls: providerCalls,
    retries
  };
}

function validatedNvidiaExtraction(
  result: ProviderNeutralDocumentExtractionV1,
  config: DocumentPilotConfig
): ProviderNeutralDocumentExtractionV1 {
  const valid =
    result.contractVersion === DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION &&
    result.normalizationVersion === DOCUMENT_PILOT_NORMALIZATION_VERSION &&
    result.source === "nvidia" &&
    result.provider === "nvidia" &&
    result.model === OFFICIAL_NVIDIA_PILOT_IDENTITY.model &&
    result.clientRevision === OFFICIAL_NVIDIA_PILOT_IDENTITY.clientRevision &&
    Number.isInteger(result.pageCount) &&
    result.pageCount >= 0 &&
    result.pageCount <= config.maxPages &&
    Number.isInteger(result.outputElementCount) &&
    result.outputElementCount >= 0 &&
    Number.isInteger(result.providerCalls) &&
    result.providerCalls >= 0 &&
    result.providerCalls <= config.maxPages &&
    Number.isInteger(result.successfulCalls) &&
    result.successfulCalls >= 0 &&
    Number.isInteger(result.failedCalls) &&
    result.failedCalls >= 0 &&
    result.successfulCalls + result.failedCalls === result.providerCalls &&
    Number.isInteger(result.retries) &&
    result.retries >= 0 &&
    result.retries <= 1 &&
    Number.isFinite(result.latencyMs) &&
    result.latencyMs >= 0 &&
    result.criticalFields.every((field) => (
      field.identity.length > 0 &&
      field.identity.length <= 240 &&
      field.value.length <= 4_000 &&
      (field.page === null || (Number.isInteger(field.page) && field.page > 0 && field.page <= config.maxPages))
    ));
  return valid ? result : failedNvidiaExtraction("validation_failure", Math.max(1, result.providerCalls), result.retries, result.latencyMs);
}

async function executeWithBoundedRetry({
  extractor,
  circuitBreaker,
  config
}: {
  extractor: () => Promise<ProviderNeutralDocumentExtractionV1>;
  circuitBreaker: DocumentPilotCircuitBreaker;
  config: DocumentPilotConfig;
}) {
  if (!circuitBreaker.canAttempt()) return failedNvidiaExtraction("circuit_open");
  let providerCalls = 0;
  let retries = 0;
  let latencyMs = 0;
  let successfulCalls = 0;
  let failedCalls = 0;
  let last: ProviderNeutralDocumentExtractionV1 | null = null;

  for (let attempt = 0; attempt < config.maxExtractionAttempts; attempt += 1) {
    try {
      const result = validatedNvidiaExtraction(await extractor(), config);
      providerCalls += Math.max(1, result.providerCalls);
      successfulCalls += result.successfulCalls;
      failedCalls += result.failedCalls || (result.providerCalls === 0 ? 1 : 0);
      latencyMs += result.latencyMs;
      last = result;
      const boundedResult = result.latencyMs > config.maxLatencyMs
        ? failedNvidiaExtraction("timeout", providerCalls, retries, latencyMs)
        : result;
      if (boundedResult.status === "success") {
        circuitBreaker.recordSuccess();
        return { ...boundedResult, providerCalls, successfulCalls, failedCalls, retries, latencyMs };
      }
      if (!RETRYABLE_FAILURES.has(boundedResult.failureCode) || attempt + 1 >= config.maxExtractionAttempts) break;
    } catch {
      providerCalls += 1;
      failedCalls += 1;
      last = failedNvidiaExtraction("transport_failure", providerCalls, retries, latencyMs);
      if (attempt + 1 >= config.maxExtractionAttempts) break;
    }
    retries += 1;
  }

  circuitBreaker.recordFailure();
  return {
    ...(last || failedNvidiaExtraction("provider_unavailable")),
    providerCalls,
    successfulCalls,
    failedCalls,
    retries,
    latencyMs
  };
}

function documentHash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function runDocumentIngestionPilot(options: DocumentPilotRunOptions): Promise<DocumentPilotOutcomeV1> {
  if (options.qualifiedReanalysisKey && (
    options.config.environment !== "preview" ||
    !/^preview-qualified-reanalysis:[a-f0-9-]{36}$/.test(options.qualifiedReanalysisKey)
  )) {
    throw new Error("Qualified pilot re-analysis requires a reviewed Preview-only request key.");
  }
  const assessment = assessDocumentForPilot({
    ...options.assessmentInput,
    fileSizeBytes: options.documentBytes.length,
    magicBytes: options.documentBytes.subarray(0, 16)
  });
  let routed = routeDocumentAssessment(assessment, options.config);
  const hash = documentHash(options.documentBytes);
  const workspaceScopeHash = privacySafeWorkspaceScopeHash(options.workspaceScope, options.telemetryHashKey);
  const nvidiaPath = routed.decision.path === "nvidia_direct" || routed.decision.path === "nvidia_fallback";
  const authorizationBlocked = nvidiaPath && !options.authorizedForWorkspace;
  const syntheticBlocked = nvidiaPath && options.config.syntheticOnly && !options.syntheticDocument;
  if (authorizationBlocked || syntheticBlocked) {
    const reasonCodes = [...routed.decision.reasonCodes];
    if (authorizationBlocked) reasonCodes.push("authorized_file_required");
    if (syntheticBlocked) reasonCodes.push("synthetic_pilot_only");
    routed = {
      assessment: routed.assessment,
      decision: {
        ...routed.decision,
        nvidiaExecutionAllowed: false,
        execution: "pilot_disabled",
        reviewRequired: true,
        reasonCodes: Array.from(new Set(reasonCodes)).sort()
      }
    };
  }

  let nvidiaExtraction: ProviderNeutralDocumentExtractionV1 | null = null;
  let cacheHit = false;
  let duplicateDocumentSkip = false;
  let eventProviderCalls = 0;
  let eventRetries = 0;
  let eventLatencyMs = 0;
  let eventSuccessfulCalls = 0;
  let eventFailedCalls = 0;
  if (routed.decision.nvidiaExecutionAllowed && options.nvidiaExtractor) {
    const baseKey = documentPilotCacheKey({
      documentHash: hash,
      provider: "nvidia",
      model: OFFICIAL_NVIDIA_PILOT_IDENTITY.model,
      clientRevision: OFFICIAL_NVIDIA_PILOT_IDENTITY.clientRevision,
      extractionContractVersion: DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION,
      normalizationVersion: DOCUMENT_PILOT_NORMALIZATION_VERSION,
      routingPolicyVersion: DOCUMENT_ROUTING_POLICY_VERSION
    });
    const scopedKey = workspaceScopedDocumentPilotCacheKey(baseKey, workspaceScopeHash);
    const key = options.qualifiedReanalysisKey
      ? createHash("sha256").update(`${scopedKey}:${options.qualifiedReanalysisKey}`).digest("hex")
      : scopedKey;
    const coordinated = await (options.coordinator || defaultCoordinator).run(key, () => executeWithBoundedRetry({
      extractor: options.nvidiaExtractor as () => Promise<ProviderNeutralDocumentExtractionV1>,
      circuitBreaker: options.circuitBreaker || defaultCircuitBreaker,
      config: options.config
    }));
    nvidiaExtraction = coordinated.result;
    cacheHit = coordinated.cacheHit;
    duplicateDocumentSkip = coordinated.duplicateDocumentSkip;
    if (!cacheHit && !duplicateDocumentSkip) {
      eventProviderCalls = nvidiaExtraction.providerCalls;
      eventRetries = nvidiaExtraction.retries;
      eventLatencyMs = nvidiaExtraction.latencyMs;
      eventSuccessfulCalls = nvidiaExtraction.successfulCalls;
      eventFailedCalls = nvidiaExtraction.failedCalls;
    }
  }

  const nativeExtraction = options.nativeExtraction || null;
  const agreement = options.config.mode === "dual_extraction_comparison" && nativeExtraction && nvidiaExtraction
    ? compareDocumentExtractions(nativeExtraction, nvidiaExtraction)
    : null;
  const selectedExtraction = nvidiaExtraction?.status === "success"
    ? nvidiaExtraction
    : nativeExtraction?.status === "success"
      ? nativeExtraction
      : null;
  const nvidiaHasCriticalFields = nvidiaExtraction?.criticalFields.some((field) => field.critical) === true;
  const reviewRequired =
    routed.decision.reviewRequired ||
    nvidiaHasCriticalFields ||
    agreement?.reviewRequired === true ||
    nvidiaExtraction?.validationResult === "review_required" ||
    nvidiaExtraction?.status === "failed";
  const pagesSentToNvidia = eventProviderCalls
    ? (nvidiaExtraction?.pageCount || assessment.pageCount || 0) * Math.max(1, eventRetries + 1)
    : 0;
  const projectedCostOnly = options.config.mode === "cost_only_measurement" && nvidiaPath && routed.decision.execution === "pilot_cost_only";
  const costBasisPages = projectedCostOnly ? (assessment.pageCount || 0) : pagesSentToNvidia;
  const costBasisCalls = projectedCostOnly && costBasisPages > 0 ? 1 : eventProviderCalls;
  const estimatedCostUsd = configuredPlanningCost(options.config, costBasisPages, costBasisCalls);
  const telemetry = assertPrivacySafeDocumentPilotTelemetry({
    version: DOCUMENT_PILOT_TELEMETRY_VERSION,
    workspaceScopeHash,
    documentHash: hash,
    documentType: assessment.fileKind,
    parserSelected: routed.decision.path,
    routingReasonCodes: routed.decision.reasonCodes,
    pageCount: assessment.pageCount,
    pagesSentToNvidia,
    providerCalls: eventProviderCalls,
    successfulCalls: eventSuccessfulCalls,
    failedCalls: eventFailedCalls,
    retries: eventRetries,
    latencyMs: eventLatencyMs,
    inputSizeBytes: assessment.fileSizeBytes,
    outputElementCount: nvidiaExtraction?.outputElementCount || 0,
    cacheHit,
    duplicateDocumentSkip,
    assessmentResult: assessment.state,
    validationResult: nvidiaExtraction?.validationResult || nativeExtraction?.validationResult || "not_run",
    reviewRequired,
    costEstimateKind: estimatedCostUsd === null ? "unknown" : "configured_planning_estimate",
    costBasis: estimatedCostUsd === null ? "none" : projectedCostOnly ? "projected_eligible_usage" : "actual_provider_usage",
    costBasisPages,
    costBasisCalls,
    estimatedCostUsd,
    mode: options.config.mode
  });

  return {
    routed,
    selectedExtraction,
    nativeExtractionPreserved: nativeExtraction?.status === "success",
    agreement,
    reviewRequired,
    authorityDisposition: "preview_only_no_authoritative_write",
    cacheHit,
    duplicateDocumentSkip,
    telemetry
  };
}
