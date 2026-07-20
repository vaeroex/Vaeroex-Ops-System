import "server-only";

import { verifyEvidenceManifestCitations } from "@/lib/ai/evidence-engine/citation-verification";
import { runQualificationGeneration } from "@/lib/ai/qualification/generation-client";
import { getQualificationModelProfile } from "@/lib/ai/qualification/profiles";
import { getStageTwoFixture } from "@/lib/ai/qualification/stage-two-fixtures";
import type {
  StageTwoProbeResult,
  StageTwoQualityScore
} from "@/lib/ai/qualification/stage-two-types";

export const STAGE_TWO_PROFILE_IDS = [
  "nvidia-nemotron-3-ultra-550b-disabled",
  "nvidia-nemotron-3-super-120b-bounded",
  "nvidia-deepseek-v4-pro-disabled",
  "nvidia-glm-5-2-default",
  "openai-production-control"
] as const;

const REASONING_LEAKAGE = /\b(?:chain of thought|hidden reasoning|internal reasoning|system prompt|step-by-step reasoning)\b|<\/?think>/i;
const UNSUPPORTED_INFERENCE = /\b(?:caused? by|results? in|leads? to|will (?:cause|create|produce)|guarantees?|proves?|forecast|predict)\b/i;

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

function allStrings(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(allStrings).join(" ");
  if (!value || typeof value !== "object") return "";
  return Object.values(value).map(allStrings).join(" ");
}

function numericClaims(value: string) {
  return value.match(/(?<![A-Za-z0-9])-?\$?\d[\d,]*(?:\.\d+)?%?/g) || [];
}

function normalizeNumber(value: string) {
  return value.replace(/[$,%\s]/g, "").replace(/^\+/, "");
}

function boundedScore(value: number) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function blindQualityScore({
  value,
  requiredTerms,
  representedDomains,
  contractId
}: {
  value: unknown;
  requiredTerms: readonly string[];
  representedDomains: readonly string[];
  contractId: StageTwoProbeResult["contractId"];
}): StageTwoQualityScore {
  const text = allStrings(value).replace(/\s+/g, " ").trim();
  const sentences = text.split(/[.!?]+/).map((item) => item.trim()).filter(Boolean);
  const words = text.split(/\s+/).filter(Boolean);
  const averageSentenceWords = sentences.length ? words.length / sentences.length : words.length;
  const normalizedSentences = sentences.map((sentence) => sentence.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim());
  const uniqueSentenceRatio = normalizedSentences.length
    ? new Set(normalizedSentences).size / normalizedSentences.length
    : 0;
  const normalizedText = text.toLowerCase();
  const coveredTerms = requiredTerms.filter((term) => normalizedText.includes(term.toLowerCase())).length;
  const coveredDomains = representedDomains.filter((domain) => normalizedText.includes(domain.toLowerCase())).length;
  const completeness = requiredTerms.length ? 5 * (coveredTerms / requiredTerms.length) : 5;
  const clarity = averageSentenceWords <= 24 ? 5 : averageSentenceWords <= 32 ? 4 : averageSentenceWords <= 40 ? 3 : 2;
  const concision = text.length <= 1600 ? 5 : text.length <= 2200 ? 4 : text.length <= 3000 ? 3 : 2;
  const prioritization = contractId === "leadership_priorities_v1"
    ? (/\b(?:first|then|next|after|before|sequence|priority)\b/i.test(text) ? 5 : 3)
    : (/\b(?:focus|primary|priority|attention)\b/i.test(text) ? 5 : 4);
  const crossDomainSynthesis = representedDomains.length < 2
    ? 5
    : coveredDomains >= 2 ? 5 : 3;
  const uncertaintyDiscipline = /\b(?:uncertain|limited|stale|does not establish|insufficient|one quarter|one source|confidence)\b/i.test(text) ? 5 : 3;
  const readability = averageSentenceWords <= 28 && uniqueSentenceRatio >= 0.9 ? 5 : averageSentenceWords <= 36 && uniqueSentenceRatio >= 0.75 ? 4 : 3;
  const executiveUsefulness = /\b(?:leadership|focus|review|monitor|verify|preserve|maintain|attention)\b/i.test(text) ? 5 : 3;
  const dimensions = {
    completeness: boundedScore(completeness),
    clarity: boundedScore(clarity),
    concision: boundedScore(concision),
    prioritization: boundedScore(prioritization),
    crossDomainSynthesis: boundedScore(crossDomainSynthesis),
    uncertaintyDiscipline: boundedScore(uncertaintyDiscipline),
    readability: boundedScore(readability),
    executiveUsefulness: boundedScore(executiveUsefulness)
  };
  return {
    ...dimensions,
    total: Math.round(Object.values(dimensions).reduce((sum, score) => sum + score, 0) / 40 * 100)
  };
}

export async function runStageTwoQualificationProbe({
  profileId,
  fixtureId
}: {
  profileId: string;
  fixtureId: string;
}): Promise<StageTwoProbeResult> {
  if (!STAGE_TWO_PROFILE_IDS.includes(profileId as (typeof STAGE_TWO_PROFILE_IDS)[number])) {
    throw new Error("Unknown Stage 2 qualification profile.");
  }
  const profile = getQualificationModelProfile(profileId);
  const fixture = getStageTwoFixture(fixtureId);
  if (!profile || !fixture) throw new Error("Unknown Stage 2 qualification input.");

  const generation = await runQualificationGeneration({
    profile,
    prompt: fixture.systemPrompt,
    content: JSON.stringify(fixture.input),
    timeoutMs: fixture.timeoutMs
  });

  let parsedValue: unknown = null;
  let contractValid = false;
  let validationReasonCode: StageTwoProbeResult["validationReasonCode"] = null;
  let validationStage: StageTwoProbeResult["validationStage"] = null;
  let validationExpectedField: StageTwoProbeResult["validationExpectedField"] = null;
  let validationExpectedType: StageTwoProbeResult["validationExpectedType"] = null;
  let validationObservedType: StageTwoProbeResult["validationObservedType"] = null;
  let validationExpectedCount: StageTwoProbeResult["validationExpectedCount"] = null;
  let validationObservedCount: StageTwoProbeResult["validationObservedCount"] = null;
  let validationFieldPresent: StageTwoProbeResult["validationFieldPresent"] = null;

  if (generation.truncationDetected) {
    validationReasonCode = "unexpected_truncation";
    validationStage = "canonical_schema";
  } else if (generation.completed) {
    const parsed = parseJsonObject(generation.content);
    if (!parsed.ok) {
      validationReasonCode = "response_not_json";
      validationStage = "json_parsing";
    } else {
      parsedValue = parsed.value;
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

  const text = parsedValue ? allStrings(parsedValue) : "";
  const approvedNumbers = new Set(numericClaims(JSON.stringify(fixture.input)).map(normalizeNumber));
  const numericIntegrity = !numericClaims(text).some((claim) => !approvedNumbers.has(normalizeNumber(claim)));
  const normalizedText = text.toLowerCase();
  const requiredSignalCoverage = fixture.requiredTerms.every((term) => normalizedText.includes(term.toLowerCase()));
  const citationVerification = verifyEvidenceManifestCitations({
    manifest: fixture.manifest,
    citationIds: fixture.requiredCitationIds,
    requiredCitationIds: fixture.requiredCitationIds
  });
  const unsupportedInferenceDetected = UNSUPPORTED_INFERENCE.test(text);
  const reasoningLeakageDetected = REASONING_LEAKAGE.test(text);
  const acceptedOutput = contractValid ? JSON.stringify(parsedValue) : null;

  return {
    benchmarkVersion: "nvidia_capability_stage_2_v1",
    profileId: profile.id,
    provider: profile.provider,
    model: profile.model,
    reasoningMode: profile.reasoningMode,
    contractId: fixture.contractId,
    fixtureId: fixture.id,
    fixtureFingerprint: fixture.fingerprint,
    state: fixture.state,
    endpointHealthy: generation.endpointHealthy,
    httpStatus: generation.httpStatus,
    completed: generation.completed,
    contractValid,
    numericIntegrity,
    citationIntegrity: citationVerification.valid,
    requiredSignalCoverage,
    unsupportedInferenceDetected,
    reasoningLeakageDetected,
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
    transportFailureCode: generation.transportFailureCode,
    blindOutput: acceptedOutput,
    blindQuality: contractValid && parsedValue ? blindQualityScore({
      value: parsedValue,
      requiredTerms: fixture.requiredTerms,
      representedDomains: fixture.representedDomains,
      contractId: fixture.contractId
    }) : null
  };
}
