import "server-only";

import { verifyEvidenceManifestCitations } from "@/lib/ai/evidence-engine/citation-verification";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { getStageTwoFixture } from "@/lib/ai/qualification/stage-two-fixtures";
import { runStageThreeBGeneration } from "@/lib/ai/qualification/stage-three-b-generation";
import { getStageThreeBProfile } from "@/lib/ai/qualification/stage-three-b-profiles";
import type {
  StageThreeBAssemblyMode,
  StageThreeBProbeResult,
  StageThreeBQualityScore
} from "@/lib/ai/qualification/stage-three-b-types";

const REASONING_LEAKAGE = /\b(?:chain of thought|hidden reasoning|internal reasoning|system prompt|step-by-step reasoning)\b|<\/?think>/i;
const UNSUPPORTED_INFERENCE = /\b(?:caused? by|results? in|leads? to|will (?:cause|create|produce)|guarantees?|proves?|forecast|predict)\b/i;
const RELATIONSHIP_LANGUAGE = /\b(?:correlat(?:e|ed|ion)|associated? with|linked? to|co-mov(?:e|ement)|moves? with)\b/i;

const PUBLISHED_OPENAI_PRICING_USD_PER_1M: Readonly<Record<string, { input: number; cachedInput: number; output: number }>> = {
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.60 },
  "gpt-5.6-terra": { input: 2.50, cachedInput: 0.25, output: 15.00 },
  "gpt-5.6-sol": { input: 5.00, cachedInput: 0.50, output: 30.00 }
};

function parseJsonObject(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    const value = JSON.parse(candidate) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? { ok: true as const, value: value as Record<string, unknown> }
      : { ok: false as const, reason: "root_not_object" as const };
  } catch {
    return { ok: false as const, reason: "response_not_json" as const };
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

function signalRows(input: Readonly<Record<string, unknown>>) {
  const candidates = Array.isArray(input.required_signals)
    ? input.required_signals
    : Array.isArray(input.required_drivers)
      ? input.required_drivers
      : Array.isArray(input.ranked_candidates)
        ? input.ranked_candidates
        : [];
  return candidates.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const ordinal = typeof row.ordinal === "number" ? row.ordinal : null;
    const label = typeof row.label === "string" ? row.label : "";
    const fact = typeof row.approved_fact === "string" ? row.approved_fact : "";
    const classification = typeof row.classification === "string" ? row.classification : "";
    return ordinal && label && fact ? [{ ordinal, label, fact, classification }] : [];
  });
}

function deterministicAssembly({
  value,
  input,
  contractId
}: {
  value: Record<string, unknown>;
  input: Readonly<Record<string, unknown>>;
  contractId: StageThreeBProbeResult["contractId"];
}) {
  const rows = signalRows(input);
  const covered = Array.isArray(value.covered_signal_ordinals)
    ? value.covered_signal_ordinals.filter((item): item is number => Number.isInteger(item))
    : [];
  const expected = rows.map((row) => row.ordinal);
  if (covered.length !== expected.length || expected.some((ordinal) => !covered.includes(ordinal))) {
    return { ok: false as const, reasonCode: "missing_required_signal" as const, expectedCount: expected.length, observedCount: covered.length };
  }
  const assembled = { ...value };
  delete assembled.covered_signal_ordinals;
  if (contractId === "executive_brief_v1") {
    const firstRisk = rows.find((row) => row.classification === "risk");
    const firstOpportunity = rows.find((row) => row.classification === "opportunity");
    const concernOrdinal = typeof value.primary_concern_ordinal === "number" ? value.primary_concern_ordinal : null;
    const opportunityOrdinal = typeof value.strongest_positive_signal_ordinal === "number" ? value.strongest_positive_signal_ordinal : null;
    if (concernOrdinal !== (firstRisk?.ordinal || null) || opportunityOrdinal !== (firstOpportunity?.ordinal || null)) {
      return { ok: false as const, reasonCode: "invalid_action" as const, expectedCount: rows.length, observedCount: covered.length };
    }
    assembled.primary_concern = firstRisk ? `${firstRisk.label}: ${firstRisk.fact}` : null;
    assembled.strongest_positive_signal = firstOpportunity ? `${firstOpportunity.label}: ${firstOpportunity.fact}` : null;
    delete assembled.primary_concern_ordinal;
    delete assembled.strongest_positive_signal_ordinal;
  }
  return { ok: true as const, value: assembled };
}

function assemblyPromptSuffix(assemblyMode: StageThreeBAssemblyMode, contractId: StageThreeBProbeResult["contractId"]) {
  if (assemblyMode === "one_pass") return "";
  const briefFields = contractId === "executive_brief_v1"
    ? " Omit primary_concern and strongest_positive_signal; the application will assemble those fields. Return primary_concern_ordinal and strongest_positive_signal_ordinal as the application-ranked signal ordinal, or null when that class is absent."
    : "";
  return `\nFor deterministic application assembly, also return covered_signal_ordinals containing every supplied signal ordinal exactly once.${briefFields} These ordinal fields are transport controls and must not appear in narrative text.`;
}

function boundedScore(value: number) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function qualityScore({
  value,
  requiredTerms,
  representedDomains,
  contractId,
  numericIntegrity,
  requiredSignalCoverage,
  unsupportedInference,
  unauthorizedRelationship
}: {
  value: unknown;
  requiredTerms: readonly string[];
  representedDomains: readonly string[];
  contractId: StageThreeBProbeResult["contractId"];
  numericIntegrity: boolean;
  requiredSignalCoverage: boolean;
  unsupportedInference: boolean;
  unauthorizedRelationship: boolean;
}): StageThreeBQualityScore {
  const text = allStrings(value).replace(/\s+/g, " ").trim();
  const normalized = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).map((item) => item.trim()).filter(Boolean);
  const averageSentenceWords = sentences.length ? words.length / sentences.length : words.length;
  const uniqueSentenceRatio = sentences.length
    ? new Set(sentences.map((sentence) => sentence.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim())).size / sentences.length
    : 0;
  const coveredTerms = requiredTerms.filter((term) => normalized.includes(term.toLowerCase())).length;
  const coveredDomains = representedDomains.filter((domain) => normalized.includes(domain.toLowerCase())).length;
  const hasRiskAndPositive = /\b(?:risk|concern|declin|increase in return|below)\b/i.test(text)
    && /\b(?:positive|counter|improv|increase in repeat|opportunity|recover)\b/i.test(text);
  const targetWords = contractId === "business_health_explanation_v1"
    ? [120, 250]
    : contractId === "leadership_priorities_v1"
      ? [200, 450]
      : [300, 700];
  const dimensions = {
    factualFidelity: numericIntegrity && !unsupportedInference && !unauthorizedRelationship ? 5 : 1,
    executiveUsefulness: /\b(?:leadership|focus|review|monitor|verify|preserve|attention|priority)\b/i.test(text) ? 5 : 3,
    strategicInsight: /\b(?:while|however|despite|counter|concurrent|tradeoff|balance|sequence)\b/i.test(text) ? 5 : 3,
    crossDomainSynthesis: representedDomains.length < 2 ? 5 : coveredDomains >= 2 ? 5 : 2,
    prioritizationQuality: contractId === "leadership_priorities_v1"
      ? (/\b(?:first|then|next|after|before|priority|sequence)\b/i.test(text) ? 5 : 2)
      : (/\b(?:primary|focus|priority|strongest)\b/i.test(text) ? 5 : 3),
    explanationDepth: /\b(?:because|reflects|combination|together|while|despite|therefore)\b/i.test(text) ? 5 : 3,
    clarity: averageSentenceWords <= 26 ? 5 : averageSentenceWords <= 34 ? 4 : averageSentenceWords <= 42 ? 3 : 2,
    concision: words.length >= targetWords[0] && words.length <= targetWords[1] ? 5 : words.length <= targetWords[1] * 1.2 ? 4 : 3,
    completeness: requiredTerms.length ? boundedScore(5 * (coveredTerms / requiredTerms.length)) : 5,
    uncertaintyDiscipline: /\b(?:uncertain|limited|stale|does not establish|insufficient|one quarter|one source|confidence|cannot determine)\b/i.test(text) ? 5 : 3,
    counterSignalTreatment: hasRiskAndPositive ? 5 : 4,
    actionabilityWithoutOverclaiming: /\b(?:review|monitor|verify|preserve|maintain|confirm|refresh)\b/i.test(text) && !unsupportedInference ? 5 : 3,
    executiveVoice: /\b(?:leadership|business|priority|focus|position|performance)\b/i.test(text) && uniqueSentenceRatio >= 0.8 ? 5 : 3
  };
  if (!requiredSignalCoverage) dimensions.completeness = 1;
  return {
    ...dimensions,
    total: Math.round(Object.values(dimensions).reduce((sum, score) => sum + score, 0) / (13 * 5) * 100)
  };
}

function costEstimate({
  model,
  inputTokens,
  cachedInputTokens,
  outputTokens
}: {
  model: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}) {
  const price = PUBLISHED_OPENAI_PRICING_USD_PER_1M[model];
  if (!price || inputTokens === null || outputTokens === null) return null;
  const cached = Math.max(0, Math.min(inputTokens, cachedInputTokens || 0));
  const uncached = inputTokens - cached;
  return (uncached / 1_000_000) * price.input
    + (cached / 1_000_000) * price.cachedInput
    + (outputTokens / 1_000_000) * price.output;
}

export async function runStageThreeBQualificationProbe({
  profileId,
  fixtureId,
  assemblyMode
}: {
  profileId: string;
  fixtureId: string;
  assemblyMode: StageThreeBAssemblyMode;
}): Promise<StageThreeBProbeResult> {
  const profile = getStageThreeBProfile(profileId);
  const fixture = getStageTwoFixture(fixtureId);
  if (!profile || !fixture) throw new Error("Unknown Stage 3B qualification input.");
  const settings = profile.workflows[fixture.contractId];
  if (!settings) throw new Error("The selected profile does not support this Stage 3B workflow.");
  if (assemblyMode === "deterministic_assembly" && !profile.deterministicAssemblyEligible) {
    throw new Error("The selected profile is not part of the deterministic-assembly experiment.");
  }

  const generation = await runStageThreeBGeneration({
    profile,
    settings,
    contractId: fixture.contractId,
    assemblyMode,
    prompt: `${fixture.systemPrompt}${assemblyPromptSuffix(assemblyMode, fixture.contractId)}`,
    content: JSON.stringify(fixture.input)
  });

  let parsedValue: Record<string, unknown> | null = null;
  let finalValue: Record<string, unknown> | null = null;
  let contractValid = false;
  let validationReasonCode: StageThreeBProbeResult["validationReasonCode"] = null;
  let validationStage: StageThreeBProbeResult["validationStage"] = null;
  let validationExpectedField: StageThreeBProbeResult["validationExpectedField"] = null;
  let validationExpectedType: StageThreeBProbeResult["validationExpectedType"] = null;
  let validationObservedType: StageThreeBProbeResult["validationObservedType"] = null;
  let validationExpectedCount: StageThreeBProbeResult["validationExpectedCount"] = null;
  let validationObservedCount: StageThreeBProbeResult["validationObservedCount"] = null;
  let validationFieldPresent: StageThreeBProbeResult["validationFieldPresent"] = null;

  if (generation.truncationDetected) {
    validationReasonCode = "unexpected_truncation";
    validationStage = "canonical_schema";
  } else if (generation.completed) {
    const parsed = parseJsonObject(generation.content);
    if (!parsed.ok) {
      validationReasonCode = parsed.reason;
      validationStage = parsed.reason === "response_not_json" ? "json_parsing" : "canonical_schema";
    } else {
      parsedValue = parsed.value;
      if (assemblyMode === "deterministic_assembly") {
        const assembly = deterministicAssembly({ value: parsed.value, input: fixture.input, contractId: fixture.contractId });
        if (!assembly.ok) {
          validationReasonCode = assembly.reasonCode;
          validationStage = assembly.reasonCode === "missing_required_signal" ? "ranked_signal_coverage" : "canonical_schema";
          validationExpectedField = "covered_signal_ordinals";
          validationExpectedCount = assembly.expectedCount;
          validationObservedCount = assembly.observedCount;
        } else {
          finalValue = assembly.value;
        }
      } else {
        finalValue = parsed.value;
      }
      if (finalValue) {
        const validation = fixture.validate(finalValue);
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
  }

  const text = finalValue ? allStrings(finalValue).replace(/\s+/g, " ").trim() : "";
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
  const unauthorizedRelationshipDetected = !fixture.input.permitted_relationship && RELATIONSHIP_LANGUAGE.test(text);
  const reasoningLeakageDetected = REASONING_LEAKAGE.test(text);
  const accepted = contractValid
    && numericIntegrity
    && citationVerification.valid
    && requiredSignalCoverage
    && !unsupportedInferenceDetected
    && !unauthorizedRelationshipDetected
    && !reasoningLeakageDetected;
  const blindOutput = accepted && finalValue ? JSON.stringify(finalValue) : null;
  const pricingAvailable = profile.provider === "openai";

  return {
    benchmarkVersion: "executive_synthesis_stage_3b_v1",
    profileId: profile.id,
    provider: profile.provider,
    requestedModel: profile.model,
    runtimeModel: generation.runtimeModel,
    transport: profile.transport,
    assemblyMode,
    contractId: fixture.contractId,
    fixtureId: fixture.id,
    fixtureFingerprint: fixture.fingerprint,
    state: fixture.state,
    requestedReasoningEffort: generation.requestedReasoningEffort,
    effectiveReasoningEffort: generation.effectiveReasoningEffort,
    requestedReasoningMode: generation.requestedReasoningMode,
    effectiveReasoningMode: generation.effectiveReasoningMode,
    endpointHealthy: generation.endpointHealthy,
    httpStatus: generation.httpStatus,
    completed: generation.completed,
    contractValid,
    accepted,
    numericIntegrity,
    citationIntegrity: citationVerification.valid,
    requiredSignalCoverage,
    unsupportedInferenceDetected,
    unauthorizedRelationshipDetected,
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
    cachedInputTokens: generation.cachedInputTokens,
    outputTokens: generation.outputTokens,
    reasoningTokens: generation.reasoningTokens,
    tokenCountsEstimated: generation.tokenCountsEstimated,
    outputCharacters: generation.content.length,
    outputWords: text ? text.split(/\s+/).length : 0,
    estimatedCostUsd: pricingAvailable ? costEstimate({
      model: generation.runtimeModel || profile.model,
      inputTokens: generation.inputTokens,
      cachedInputTokens: generation.cachedInputTokens,
      outputTokens: generation.outputTokens
    }) : null,
    costBasis: pricingAvailable ? "published_token_pricing" : "nvidia_prototype_credit_no_token_price",
    transportFailureCode: generation.transportFailureCode,
    outputFingerprint: accepted && finalValue ? evidenceEngineHash({ contractId: fixture.contractId, output: finalValue }) : null,
    blindOutput,
    blindQuality: accepted && finalValue ? qualityScore({
      value: finalValue,
      requiredTerms: fixture.requiredTerms,
      representedDomains: fixture.representedDomains,
      contractId: fixture.contractId,
      numericIntegrity,
      requiredSignalCoverage,
      unsupportedInference: unsupportedInferenceDetected,
      unauthorizedRelationship: unauthorizedRelationshipDetected
    }) : null
  };
}
