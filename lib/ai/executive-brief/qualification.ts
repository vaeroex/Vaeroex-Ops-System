import "server-only";

import { verifyEvidenceManifestCitations } from "@/lib/ai/evidence-engine/citation-verification";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import {
  EXECUTIVE_BRIEF_CONTRACT_ID,
  EXECUTIVE_BRIEF_CONTRACT_VERSION,
  EXECUTIVE_BRIEF_JSON_SCHEMA,
  EXECUTIVE_BRIEF_VALIDATOR_VERSION,
  type ExecutiveBriefConfidence,
  type ExecutiveBriefPackage,
  type ExecutiveBriefSignal,
  type ExecutiveBriefSubmode
} from "@/lib/ai/executive-brief/contracts";
import {
  EXECUTIVE_BRIEF_SYSTEM_PROMPT,
  executiveBriefModelInput
} from "@/lib/ai/executive-brief/service";
import { validateExecutiveBriefOutput } from "@/lib/ai/executive-brief/validation";
import { getAIProviderRetrySettings } from "@/lib/ai/provider-resilience";
import {
  AIProviderExecutionError,
  runStructuredAI
} from "@/lib/ai/providers/provider-manager";
import {
  BUSINESS_HEALTH_GPT56_SOL_MODEL,
  BUSINESS_HEALTH_GPT56_TERRA_MODEL,
  EXECUTIVE_BRIEF_GPT56_DEADLINE_MS,
  EXECUTIVE_BRIEF_GPT56_SOL_OUTPUT_TOKENS,
  EXECUTIVE_BRIEF_GPT56_SOL_TIMEOUT_MS,
  EXECUTIVE_BRIEF_GPT56_TERRA_OUTPUT_TOKENS,
  EXECUTIVE_BRIEF_GPT56_TERRA_TIMEOUT_MS
} from "@/lib/ai/providers/workflow-provider-policy";
import { STAGE_TWO_FIXTURES } from "@/lib/ai/qualification/stage-two-fixtures";
import type { StageTwoFixture } from "@/lib/ai/qualification/stage-two-types";
import { estimateTokenCount } from "@/lib/ai/usage";

export const EXECUTIVE_BRIEF_QUALIFICATION_VERSION = "executive_brief_final_contract_qualification_v1" as const;
export const EXECUTIVE_BRIEF_QUALIFICATION_PROFILE_IDS = ["gpt56-sol", "gpt56-terra"] as const;
export type ExecutiveBriefQualificationProfileId = (typeof EXECUTIVE_BRIEF_QUALIFICATION_PROFILE_IDS)[number];

type FrozenSignal = Readonly<{
  ordinal: number;
  label: string;
  required_signal_identity: string;
  approved_fact: string;
  classification: "risk" | "opportunity";
}>;

type FrozenInput = Readonly<{
  business_state: string;
  required_signals: readonly FrozenSignal[];
  permitted_relationship: string | null;
  permitted_hypothesis: string | null;
  confidence_ceiling: ExecutiveBriefConfidence;
  limitations: readonly string[];
}>;

type StateFacts = Readonly<{
  score: number;
  status: string;
  trajectory: string;
  comparisonDelta: number | null;
  submode: ExecutiveBriefSubmode;
}>;

const STATE_FACTS: Readonly<Record<string, StateFacts>> = {
  healthy_and_improving: { score: 86, status: "Healthy", trajectory: "Improving", comparisonDelta: 5, submode: "healthy_improving" },
  healthy_but_slowing: { score: 78, status: "Healthy", trajectory: "Slowing", comparisonDelta: -2, submode: "healthy_slowing" },
  stable_sparse_evidence: { score: 71, status: "Stable", trajectory: "Stable", comparisonDelta: 0, submode: "evidence_sparse" },
  watch_and_recovering_with_conflict: { score: 62, status: "Watch", trajectory: "Recovering", comparisonDelta: 4, submode: "conflicting_evidence" },
  at_risk_and_worsening: { score: 43, status: "Critical", trajectory: "Worsening", comparisonDelta: -7, submode: "negative_worsening" },
  stale_and_evidence_limited: { score: 67, status: "Watch", trajectory: "Unknown", comparisonDelta: null, submode: "evidence_stale" },
  at_risk_without_established_opportunity: { score: 43, status: "Critical", trajectory: "Worsening", comparisonDelta: -7, submode: "negative_worsening" },
  negative_but_recovering: { score: 62, status: "Watch", trajectory: "Recovering", comparisonDelta: 4, submode: "negative_recovering" },
  mixed_without_hypothesis: { score: 69, status: "Stable", trajectory: "Mixed", comparisonDelta: 0, submode: "conflicting_evidence" },
  cross_domain_multiple_sources: { score: 55, status: "Watch", trajectory: "Stable", comparisonDelta: 0, submode: "stable" },
  worsening_with_minority_counter_signal: { score: 40, status: "Critical", trajectory: "Worsening", comparisonDelta: -8, submode: "negative_worsening" },
  healthy_without_established_concern: { score: 86, status: "Healthy", trajectory: "Improving", comparisonDelta: 5, submode: "healthy_improving" }
};

const BASE_BRIEF_FIXTURES = STAGE_TWO_FIXTURES.filter((fixture) => fixture.contractId === EXECUTIVE_BRIEF_CONTRACT_ID);
const NO_CONCERN_SOURCE_ID = "brief-healthy-improving";

function frozenInput(fixture: StageTwoFixture, forceNoConcern = false): FrozenInput {
  const input = fixture.input as unknown as FrozenInput;
  const requiredSignals = input.required_signals.map((signal) => ({
    ...signal,
    classification: forceNoConcern ? "opportunity" as const : signal.classification
  }));
  return {
    business_state: forceNoConcern ? "healthy_without_established_concern" : input.business_state,
    required_signals: requiredSignals,
    permitted_relationship: input.permitted_relationship,
    permitted_hypothesis: input.permitted_hypothesis,
    confidence_ceiling: input.confidence_ceiling,
    limitations: forceNoConcern
      ? [...input.limitations, "No evidence-backed primary concern is established."]
      : input.limitations
  };
}

function fixtureEntries() {
  const noConcernSource = BASE_BRIEF_FIXTURES.find((fixture) => fixture.id === NO_CONCERN_SOURCE_ID);
  if (!noConcernSource) throw new Error("The frozen no-concern source fixture is unavailable.");
  return [
    ...BASE_BRIEF_FIXTURES.map((fixture) => ({ id: fixture.id, fixture, forceNoConcern: false })),
    { id: "brief-no-established-concern", fixture: noConcernSource, forceNoConcern: true }
  ] as const;
}

function packageForEntry(entry: ReturnType<typeof fixtureEntries>[number]): ExecutiveBriefPackage {
  const input = frozenInput(entry.fixture, entry.forceNoConcern);
  const state = STATE_FACTS[input.business_state];
  if (!state) throw new Error("The frozen Executive Brief state is not mapped.");
  const riskOrdinal = input.required_signals.find((signal) => signal.classification === "risk")?.ordinal || null;
  const opportunityOrdinal = input.required_signals.find((signal) => signal.classification === "opportunity")?.ordinal || null;
  const leadershipOrdinal = riskOrdinal || opportunityOrdinal || input.required_signals[0]?.ordinal || null;
  const requiredSignalOrdinals = Array.from(new Set([
    riskOrdinal,
    opportunityOrdinal,
    leadershipOrdinal
  ].filter((value): value is number => value !== null))).slice(0, 3);
  const signals: ExecutiveBriefSignal[] = input.required_signals.map((signal) => {
    const roles: ExecutiveBriefSignal["roles"] = [
      ...(signal.ordinal === riskOrdinal ? ["primary_concern" as const] : []),
      ...(signal.ordinal === opportunityOrdinal ? ["positive_signal" as const] : []),
      ...(signal.ordinal === leadershipOrdinal ? ["leadership_focus" as const] : []),
      ...(![riskOrdinal, opportunityOrdinal, leadershipOrdinal].includes(signal.ordinal) ? ["context" as const] : [])
    ];
    return {
      ordinal: signal.ordinal,
      stableKey: evidenceEngineHash({ fixture: entry.id, ordinal: signal.ordinal, fact: signal.approved_fact }),
      roles,
      classification: signal.classification,
      domain: entry.fixture.representedDomains[signal.ordinal - 1] || "Operations",
      label: signal.label,
      approvedFact: signal.approved_fact,
      approvedLeadershipFocus: signal.ordinal === leadershipOrdinal
        ? `Keep leadership attention on ${signal.required_signal_identity} during the next evidence review.`
        : null,
      coverageTerms: [signal.required_signal_identity.toLowerCase()],
      citationIds: entry.fixture.manifest.evidence[signal.ordinal - 1]
        ? [entry.fixture.manifest.evidence[signal.ordinal - 1].citationId]
        : []
    };
  });
  const requiredCitationIds = Array.from(new Set(
    signals
      .filter((signal) => requiredSignalOrdinals.includes(signal.ordinal))
      .flatMap((signal) => signal.citationIds)
  )).sort((left, right) => left - right);
  const citationVerification = verifyEvidenceManifestCitations({
    manifest: entry.fixture.manifest,
    citationIds: requiredCitationIds,
    requiredCitationIds
  });
  if (!citationVerification.valid) throw new Error("The frozen fixture citations are invalid.");
  const citations = entry.fixture.manifest.evidence.map((evidence) => ({
    citationId: evidence.citationId,
    title: evidence.title,
    sourceLabel: evidence.title,
    sourceType: "Frozen synthetic evidence",
    excerpt: evidence.excerpt,
    recordedAt: evidence.recordedAt
  }));
  const latestEvidenceAt = citations.map((citation) => citation.recordedAt).filter(Boolean).sort().at(-1) || null;
  const facts = {
    available: true,
    businessHealth: {
      score: state.score,
      status: state.status,
      trajectory: state.trajectory,
      comparisonDelta: state.comparisonDelta
    },
    materialChanges: signals.slice(0, 3).map((signal) => ({
      stableKey: signal.stableKey,
      label: signal.label,
      fact: signal.approvedFact,
      direction: signal.classification === "risk" ? "negative" as const : "positive" as const
    })),
    confidence: input.confidence_ceiling,
    freshness: state.submode === "evidence_stale" ? "stale" as const : "current" as const,
    latestEvidenceAt,
    independentSourceCount: entry.fixture.manifest.sourceRegistry.independentOriginalSourceCount,
    limitations: input.limitations,
    deterministicReadout: [
      `Business Health is ${state.score} and the application classified the state as ${state.status}.`,
      riskOrdinal ? `Primary concern: ${signals.find((signal) => signal.ordinal === riskOrdinal)?.label}.` : "No evidence-backed primary concern currently stands out.",
      opportunityOrdinal ? `Positive signal: ${signals.find((signal) => signal.ordinal === opportunityOrdinal)?.label}.` : "No evidence-backed positive signal currently stands out."
    ]
  } as const;
  const permittedRelationships = input.permitted_relationship && signals.length >= 2
    ? [{ signalOrdinals: [signals[0].ordinal, signals[1].ordinal] as const, statement: input.permitted_relationship }]
    : [];
  const fingerprint = evidenceEngineHash({
    version: EXECUTIVE_BRIEF_QUALIFICATION_VERSION,
    contractId: EXECUTIVE_BRIEF_CONTRACT_ID,
    contractVersion: EXECUTIVE_BRIEF_CONTRACT_VERSION,
    validatorVersion: EXECUTIVE_BRIEF_VALIDATOR_VERSION,
    state: input.business_state,
    facts,
    signals: signals.map(({ citationIds: _citationIds, ordinal: _ordinal, ...signal }) => signal),
    permittedRelationships,
    permittedHypothesis: input.permitted_hypothesis
  });
  return {
    contractId: EXECUTIVE_BRIEF_CONTRACT_ID,
    contractVersion: EXECUTIVE_BRIEF_CONTRACT_VERSION,
    validatorVersion: EXECUTIVE_BRIEF_VALIDATOR_VERSION,
    fingerprint,
    submode: state.submode,
    facts,
    signals,
    manifest: entry.fixture.manifest,
    requiredSignalOrdinals,
    primaryConcernOrdinal: riskOrdinal,
    positiveSignalOrdinal: opportunityOrdinal,
    leadershipFocusOrdinals: leadershipOrdinal ? [leadershipOrdinal] : [],
    permittedRelationships,
    permittedHypothesis: input.permitted_hypothesis,
    requiredCitationIds,
    citations
  };
}

export function getExecutiveBriefQualificationFixtures() {
  return fixtureEntries().map((entry) => ({
    id: entry.id,
    state: frozenInput(entry.fixture, entry.forceNoConcern).business_state,
    analysisPackage: packageForEntry(entry)
  }));
}

export function getExecutiveBriefQualificationMetadata() {
  return getExecutiveBriefQualificationFixtures().map(({ id, state, analysisPackage }) => ({
    id,
    state,
    fingerprint: analysisPackage.fingerprint,
    signalCount: analysisPackage.signals.length,
    requiredSignalCount: analysisPackage.requiredSignalOrdinals.length,
    representedDomains: Array.from(new Set(analysisPackage.signals.map((signal) => signal.domain))),
    sourceCount: analysisPackage.manifest.sourceRegistry.entries.length,
    independentSourceCount: analysisPackage.facts.independentSourceCount,
    primaryConcernEstablished: analysisPackage.primaryConcernOrdinal !== null,
    positiveSignalEstablished: analysisPackage.positiveSignalOrdinal !== null,
    hypothesisPermitted: analysisPackage.permittedHypothesis !== null
  }));
}

function profile(profileId: ExecutiveBriefQualificationProfileId) {
  if (profileId === "gpt56-sol") {
    return {
      model: BUSINESS_HEALTH_GPT56_SOL_MODEL,
      timeoutMs: EXECUTIVE_BRIEF_GPT56_SOL_TIMEOUT_MS,
      maxOutputTokens: EXECUTIVE_BRIEF_GPT56_SOL_OUTPUT_TOKENS
    };
  }
  return {
    model: BUSINESS_HEALTH_GPT56_TERRA_MODEL,
    timeoutMs: EXECUTIVE_BRIEF_GPT56_TERRA_TIMEOUT_MS,
    maxOutputTokens: EXECUTIVE_BRIEF_GPT56_TERRA_OUTPUT_TOKENS
  };
}

function blindQuality(output: Record<string, unknown>, analysisPackage: ExecutiveBriefPackage) {
  const text = Object.values(output).filter((value): value is string => typeof value === "string").join(" ");
  const sentences = text.split(/[.!?]+/).filter((value) => value.trim().length > 10).length;
  const domainCoverage = new Set(
    analysisPackage.signals
      .filter((signal) => signal.coverageTerms.some((term) => text.toLowerCase().includes(term)))
      .map((signal) => signal.domain)
  ).size;
  const completeness = Math.min(5, 2 + analysisPackage.requiredSignalOrdinals.length);
  const clarity = text.length > 120 && sentences >= 4 ? 5 : text.length > 80 ? 4 : 3;
  const concision = text.length <= 2_400 ? 5 : text.length <= 3_200 ? 4 : 3;
  const prioritization = output.primary_concern !== undefined && output.leadership_focus ? 5 : 3;
  const crossDomainSynthesis = Math.min(5, Math.max(3, domainCoverage));
  const uncertaintyDiscipline = typeof output.uncertainty === "string" && output.uncertainty.length >= 15 ? 5 : 2;
  const readability = text.length <= 2_800 && sentences >= 4 ? 5 : 4;
  const executiveUsefulness = Math.round((completeness + clarity + prioritization + uncertaintyDiscipline) / 4);
  return {
    completeness,
    clarity,
    concision,
    prioritization,
    crossDomainSynthesis,
    uncertaintyDiscipline,
    readability,
    executiveUsefulness,
    total: completeness + clarity + concision + prioritization + crossDomainSynthesis + uncertaintyDiscipline + readability + executiveUsefulness
  };
}

export async function runExecutiveBriefQualificationProbe({
  profileId,
  fixtureId
}: {
  profileId: ExecutiveBriefQualificationProfileId;
  fixtureId: string;
}) {
  const fixture = getExecutiveBriefQualificationFixtures().find((item) => item.id === fixtureId);
  if (!fixture) throw new Error("Unknown Executive Brief qualification fixture.");
  const selectedProfile = profile(profileId);
  const startedAt = Date.now();
  const content = JSON.stringify(executiveBriefModelInput(fixture.analysisPackage));
  const settings = getAIProviderRetrySettings("openai");
  try {
    const generation = await runStructuredAI({
      primaryProvider: "openai",
      primaryModel: selectedProfile.model,
      fallbackModel: selectedProfile.model,
      providerPolicy: {
        id: `${EXECUTIVE_BRIEF_QUALIFICATION_VERSION}:${profileId}`,
        steps: [{
          provider: "openai",
          model: selectedProfile.model,
          workflowConfiguration: {
            timeoutMs: selectedProfile.timeoutMs,
            maxAttempts: 1,
            maxOutputTokens: selectedProfile.maxOutputTokens,
            temperature: null,
            topP: null,
            reasoning: { mode: "standard", effort: "high" },
            structuredOutput: { name: EXECUTIVE_BRIEF_CONTRACT_ID, strict: true, schema: EXECUTIVE_BRIEF_JSON_SCHEMA },
            store: false,
            stream: false
          }
        }]
      },
      systemPrompt: EXECUTIVE_BRIEF_SYSTEM_PROMPT,
      userContent: [{ type: "text", text: content }],
      generationMode: "interactive_executive",
      maxOutputTokens: selectedProfile.maxOutputTokens,
      settings: { ...settings, timeoutMs: Math.min(settings.timeoutMs, selectedProfile.timeoutMs), maxRetries: 0 },
      executionBudget: {
        deadlineAtMs: startedAt + EXECUTIVE_BRIEF_GPT56_DEADLINE_MS,
        providerTimeoutMs: { openai: selectedProfile.timeoutMs },
        minimumAttemptWindowMs: { openai: 5_000 },
        fallbackReserveMs: 0,
        transitionReserveMs: 500
      },
      validate: (value) => validateExecutiveBriefOutput(value, fixture.analysisPackage),
      logContext: {
        workflow: EXECUTIVE_BRIEF_CONTRACT_ID,
        modelRoute: "executive_brief_qualification",
        executionPath: "frozen_synthetic_fixture",
        providerPolicyId: `${EXECUTIVE_BRIEF_QUALIFICATION_VERSION}:${profileId}`
      }
    });
    const verification = verifyEvidenceManifestCitations({
      manifest: fixture.analysisPackage.manifest,
      citationIds: fixture.analysisPackage.requiredCitationIds,
      requiredCitationIds: fixture.analysisPackage.requiredCitationIds
    });
    return {
      benchmarkVersion: EXECUTIVE_BRIEF_QUALIFICATION_VERSION,
      profileId,
      model: selectedProfile.model,
      fixtureId,
      fixtureFingerprint: fixture.analysisPackage.fingerprint,
      state: fixture.state,
      completed: true,
      contractValid: true,
      citationIntegrity: verification.valid,
      numericIntegrity: true,
      requiredSignalCoverage: true,
      unsupportedInferenceDetected: false,
      reasoningLeakageDetected: false,
      latencyMs: generation.latencyMs,
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
      reasoningTokens: generation.reasoningTokens,
      estimatedCostCents: generation.estimatedCostCents,
      finishReason: generation.attempts.at(-1)?.finishReason || null,
      truncationDetected: generation.attempts.some((attempt) => attempt.truncationDetected),
      validationReasonCode: null,
      validationStage: null,
      blindSampleId: evidenceEngineHash({ fixtureId, profileId, output: generation.output }).slice(0, 20),
      blindOutput: generation.output,
      blindQuality: blindQuality(generation.output as unknown as Record<string, unknown>, fixture.analysisPackage),
      estimatedInputTokens: estimateTokenCount(`${EXECUTIVE_BRIEF_SYSTEM_PROMPT}\n${content}`)
    } as const;
  } catch (error) {
    const attempts = error instanceof AIProviderExecutionError ? error.attempts : [];
    const last = attempts.at(-1);
    return {
      benchmarkVersion: EXECUTIVE_BRIEF_QUALIFICATION_VERSION,
      profileId,
      model: selectedProfile.model,
      fixtureId,
      fixtureFingerprint: fixture.analysisPackage.fingerprint,
      state: fixture.state,
      completed: false,
      contractValid: false,
      citationIntegrity: true,
      numericIntegrity: last?.validationDiagnostic?.stage !== "numeric_integrity",
      requiredSignalCoverage: last?.validationDiagnostic?.stage !== "ranked_signal_coverage",
      unsupportedInferenceDetected: last?.validationDiagnostic?.reasonCode === "unsupported_inference",
      reasoningLeakageDetected: false,
      latencyMs: Date.now() - startedAt,
      inputTokens: attempts.reduce((sum, attempt) => sum + attempt.inputTokens, 0),
      outputTokens: attempts.reduce((sum, attempt) => sum + attempt.outputTokens, 0),
      reasoningTokens: attempts.reduce((sum, attempt) => sum + attempt.reasoningTokens, 0),
      estimatedCostCents: attempts.reduce((sum, attempt) => sum + attempt.estimatedCostCents, 0),
      finishReason: last?.finishReason || null,
      truncationDetected: attempts.some((attempt) => attempt.truncationDetected),
      validationReasonCode: last?.validationDiagnostic?.reasonCode || null,
      validationStage: last?.validationDiagnostic?.stage || null,
      blindSampleId: null,
      blindOutput: null,
      blindQuality: null,
      estimatedInputTokens: estimateTokenCount(`${EXECUTIVE_BRIEF_SYSTEM_PROMPT}\n${content}`)
    } as const;
  }
}
