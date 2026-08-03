import "server-only";

import {
  DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION,
  DOCUMENT_ROUTING_POLICY_VERSION,
  type DocumentAssessmentReasonCode,
  type DocumentAssessmentV1,
  type DocumentPilotConfig,
  type DocumentPilotEnvironment,
  type DocumentPilotMode,
  type DocumentRoutingDecisionV1,
  type DocumentRoutingExecution,
  type DocumentRoutingPath,
  type RoutedDocumentAssessmentV1
} from "@/lib/ai/document-intelligence-poc/pilot-contracts";

const DEFAULT_MAX_PAGES = 16;
const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_LATENCY_MS = 10 * 60_000;

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function optionalPlanningRate(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function environmentFromVercel(value: string | undefined): DocumentPilotEnvironment {
  if (value === "production") return "production";
  if (value === "preview") return "preview";
  if (value === "development") return "development";
  return "test";
}

export function documentPilotConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  mode: DocumentPilotMode = "routing_dry_run"
): DocumentPilotConfig {
  const environment = environmentFromVercel(env.VERCEL_ENV);
  const routerPilotEnabled = enabled(env.VAEROEX_DOCUMENT_ROUTER_PILOT);
  const nvidiaPilotEnabled = enabled(env.VAEROEX_NVIDIA_DOCUMENT_PILOT);
  const shadowConfirmationEnabled = enabled(env.VAEROEX_NVIDIA_DOCUMENT_SHADOW_CONFIRMATION);
  return {
    environment,
    mode,
    routerPilotEnabled,
    nvidiaPilotEnabled,
    shadowConfirmationEnabled,
    nvidiaExecutionAllowed:
      environment === "preview" &&
      routerPilotEnabled &&
      nvidiaPilotEnabled &&
      shadowConfirmationEnabled &&
      (mode === "shadow_extraction" || mode === "dual_extraction_comparison"),
    syntheticOnly: true,
    maxPages: DEFAULT_MAX_PAGES,
    maxFileBytes: DEFAULT_MAX_FILE_BYTES,
    maxExtractionAttempts: 2,
    maxProviderCalls: DEFAULT_MAX_PAGES * 2,
    maxLatencyMs: DEFAULT_MAX_LATENCY_MS,
    planningCostPerPageUsd: optionalPlanningRate(env.VAEROEX_NVIDIA_DOCUMENT_PLANNING_COST_PER_PAGE_USD),
    planningCostPerCallUsd: optionalPlanningRate(env.VAEROEX_NVIDIA_DOCUMENT_PLANNING_COST_PER_CALL_USD)
  };
}

function desiredPath(assessment: DocumentAssessmentV1): DocumentRoutingPath {
  if (assessment.fileKind === "unsupported") return "unsupported";
  if (assessment.fileKind === "csv" || assessment.fileKind === "xlsx") return "deterministic_structured_parser";
  if (assessment.fileKind === "png" || assessment.fileKind === "jpeg") return "nvidia_direct";
  if (assessment.state === "image_only" || assessment.state === "visual_specialist_required") return "nvidia_direct";
  if (assessment.state === "native_low_quality" || assessment.state === "review_required") return "nvidia_fallback";
  return "native_document_extraction";
}

function executionFor(path: DocumentRoutingPath, config: DocumentPilotConfig): DocumentRoutingExecution {
  if (path === "deterministic_structured_parser" || path === "native_document_extraction" || path === "unsupported") return "native_only";
  if (!config.routerPilotEnabled || config.environment === "production") return "pilot_disabled";
  if (config.mode === "routing_dry_run") return "pilot_dry_run";
  if (config.mode === "cost_only_measurement") return "pilot_cost_only";
  return config.nvidiaExecutionAllowed ? "pilot_shadow_allowed" : "pilot_disabled";
}

export function routeDocumentAssessment(
  assessment: DocumentAssessmentV1,
  config: DocumentPilotConfig
): RoutedDocumentAssessmentV1 {
  const path = desiredPath(assessment);
  const reasons = [...assessment.reasonCodes];
  if (assessment.pageCount !== null && assessment.pageCount > config.maxPages) reasons.push("page_limit_exceeded");
  if (assessment.fileSizeBytes > config.maxFileBytes) reasons.push("file_size_limit_exceeded");
  const reasonCodes = Array.from(new Set(reasons)).sort() as DocumentAssessmentReasonCode[];
  const bounded =
    !reasonCodes.includes("page_limit_exceeded") &&
    !reasonCodes.includes("file_size_limit_exceeded") &&
    !reasonCodes.includes("declared_type_mismatch");
  const execution = executionFor(path, config);
  const nvidiaExecutionAllowed =
    bounded &&
    config.nvidiaExecutionAllowed &&
    execution === "pilot_shadow_allowed" &&
    (path === "nvidia_direct" || path === "nvidia_fallback");
  const reviewRequired =
    assessment.state === "review_required" ||
    assessment.state === "native_low_quality" ||
    path === "nvidia_direct" ||
    path === "nvidia_fallback" ||
    !bounded;

  const decision: DocumentRoutingDecisionV1 = {
    contractVersion: DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION,
    routingPolicyVersion: DOCUMENT_ROUTING_POLICY_VERSION,
    mode: config.mode,
    path,
    execution,
    nvidiaExecutionAllowed,
    reasonCodes,
    reviewRequired,
    writesAuthoritativeData: false
  };
  return { assessment, decision };
}
