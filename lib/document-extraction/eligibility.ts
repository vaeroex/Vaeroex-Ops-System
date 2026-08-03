import type {
  DocumentExtractionDocumentClass,
  DocumentExtractionEligibilityResult
} from "@/lib/document-extraction/contracts";

export const PHASE_A_DOCUMENT_EXTRACTION_RUNTIME_AVAILABLE = false as const;

export type DocumentExtractionGateState = {
  runtimeAvailable: boolean;
  globallyEnabled: boolean;
  workerEnabled: boolean;
  providerCallsEnabled: boolean;
  workspaceEntitled: boolean;
  workspaceEnabled: boolean;
  allowedDocumentClasses: DocumentExtractionDocumentClass[];
  documentClass: DocumentExtractionDocumentClass;
  circuitState: "closed" | "open" | "half_open";
  requiredPages: number;
  remainingPages: number;
  activeProviderJobs: number;
  concurrentJobLimit: number;
};

export function evaluateDocumentExtractionEligibility(state: DocumentExtractionGateState): DocumentExtractionEligibilityResult {
  if (!state.runtimeAvailable) return { eligible: false, reason: "phase_a_inert" };
  if (!state.globallyEnabled) return { eligible: false, reason: "globally_disabled" };
  if (!state.workerEnabled) return { eligible: false, reason: "worker_disabled" };
  if (!state.providerCallsEnabled) return { eligible: false, reason: "provider_calls_disabled" };
  if (!state.workspaceEntitled) return { eligible: false, reason: "workspace_not_entitled" };
  if (!state.workspaceEnabled) return { eligible: false, reason: "workspace_disabled" };
  if (!state.allowedDocumentClasses.includes(state.documentClass)) {
    return { eligible: false, reason: "document_class_not_allowed" };
  }
  if (state.circuitState !== "closed") return { eligible: false, reason: "circuit_open" };
  if (state.requiredPages < 0 || state.requiredPages > state.remainingPages) {
    return { eligible: false, reason: "quota_exhausted" };
  }
  if (state.activeProviderJobs >= state.concurrentJobLimit) {
    return { eligible: false, reason: "concurrency_limit_reached" };
  }
  return { eligible: true, reason: "eligible" };
}

export function evaluatePhaseADocumentExtractionEligibility(
  state: Omit<DocumentExtractionGateState, "runtimeAvailable">
): DocumentExtractionEligibilityResult {
  return evaluateDocumentExtractionEligibility({ ...state, runtimeAvailable: PHASE_A_DOCUMENT_EXTRACTION_RUNTIME_AVAILABLE });
}
