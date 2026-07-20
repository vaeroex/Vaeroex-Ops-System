import "server-only";

import { getQualificationFixture } from "@/lib/ai/qualification/contracts";
import { runQualificationGeneration } from "@/lib/ai/qualification/generation-client";
import { getQualificationModelProfile } from "@/lib/ai/qualification/profiles";
import type {
  QualificationContractId,
  QualificationProbeResult
} from "@/lib/ai/qualification/types";

function parseJsonObject(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return { ok: true as const, value: JSON.parse(candidate) as unknown };
  } catch {
    return { ok: false as const };
  }
}
export async function runStageOneQualificationProbe({
  profileId,
  contractId
}: {
  profileId: string;
  contractId: QualificationContractId;
}): Promise<QualificationProbeResult> {
  const profile = getQualificationModelProfile(profileId);
  if (!profile) throw new Error("Unknown qualification model profile.");
  const fixture = getQualificationFixture(contractId);
  const content = JSON.stringify(fixture.input);
  const generation = await runQualificationGeneration({
    profile,
    prompt: fixture.systemPrompt,
    content,
    timeoutMs: fixture.timeoutMs
  });

  let contractValid = false;
  let validationReasonCode: QualificationProbeResult["validationReasonCode"] = null;
  let validationStage: QualificationProbeResult["validationStage"] = null;
  let validationExpectedField: QualificationProbeResult["validationExpectedField"] = null;
  let validationExpectedType: QualificationProbeResult["validationExpectedType"] = null;
  let validationObservedType: QualificationProbeResult["validationObservedType"] = null;
  let validationExpectedCount: QualificationProbeResult["validationExpectedCount"] = null;
  let validationObservedCount: QualificationProbeResult["validationObservedCount"] = null;
  let validationFieldPresent: QualificationProbeResult["validationFieldPresent"] = null;
  if (generation.truncationDetected) {
    validationReasonCode = "unexpected_truncation";
    validationStage = "canonical_schema";
  } else if (generation.completed) {
    const parsed = parseJsonObject(generation.content);
    if (!parsed.ok) {
      validationReasonCode = "response_not_json";
      validationStage = "json_parsing";
    } else {
      const validation = fixture.validate(parsed.value);
      contractValid = validation.ok;
      if (!validation.ok) {
        validationReasonCode = validation.reasonCode;
        validationStage = validation.stage;
        validationExpectedField = validation.expectedField || null;
        validationExpectedType = validation.expectedType || null;
        validationObservedType = validation.observedType || null;
        validationExpectedCount = validation.expectedCount ?? null;
        validationObservedCount = validation.observedCount ?? null;
        validationFieldPresent = validation.fieldPresent ?? null;
      }
    }
  }

  return {
    benchmarkVersion: "nvidia_capability_stage_1_v1",
    profileId: profile.id,
    provider: profile.provider,
    model: profile.model,
    reasoningMode: profile.reasoningMode,
    contractId,
    fixtureFingerprint: fixture.fingerprint,
    endpointHealthy: generation.endpointHealthy,
    httpStatus: generation.httpStatus,
    completed: generation.completed,
    contractValid,
    validationReasonCode,
    validationStage,
    validationExpectedField,
    validationExpectedType,
    validationObservedType,
    validationExpectedCount,
    validationObservedCount,
    validationFieldPresent,
    finishReason: generation.finishReason,
    truncationDetected: generation.truncationDetected,
    reasoningContentDetected: generation.reasoningContentDetected,
    latencyMs: generation.latencyMs,
    firstByteMs: generation.firstByteMs,
    firstTokenMs: generation.firstTokenMs,
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
    reasoningTokens: generation.reasoningTokens,
    tokenCountsEstimated: generation.tokenCountsEstimated,
    outputCharacters: generation.content.length,
    transportFailureCode: generation.transportFailureCode
  };
}
