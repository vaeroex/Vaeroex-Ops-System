import type {
  IntelligenceBriefingEvidencePeriod,
  IntelligenceBriefingState,
  IntelligenceBriefingType
} from "@/lib/ai/intelligence-briefing/contracts";
import { intelligenceBriefingPeriod } from "@/lib/ai/intelligence-briefing/period";

export function intelligenceBriefingVerificationUnavailableState({
  briefingType,
  period = intelligenceBriefingPeriod(briefingType),
  artifact = null,
  message = "Eligible evidence could not be verified safely."
}: {
  briefingType: IntelligenceBriefingType;
  period?: IntelligenceBriefingEvidencePeriod;
  artifact?: IntelligenceBriefingState["artifact"];
  message?: string;
}): IntelligenceBriefingState {
  return {
    status: "unavailable",
    briefingType,
    period,
    eligibility: "verification_unavailable",
    confidence: "Low",
    artifact,
    message
  };
}

export function intelligenceBriefingStateAllowsGeneration(state: IntelligenceBriefingState) {
  return state.status === "ready" && (state.eligibility === "limited" || state.eligibility === "sufficient");
}
