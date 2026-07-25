import "server-only";

import { resolveVaeroexModel, type VaeroexModelRoute } from "@/lib/ai/model-routing";
import {
  NVIDIA_NEMOTRON_MODEL,
  type AIProviderFallbackReason,
  type AIProviderRoutingPolicy
} from "@/lib/ai/providers/provider-manager";
import type { AIProviderExecutionBudget } from "@/lib/ai/providers/execution-budget";
import type { AIProviderStructuredOutput } from "@/lib/ai/providers/types";

export const BUSINESS_HEALTH_GPT56_POLICY_SELECTOR = "gpt56_sol_terra_v1" as const;
export const BUSINESS_HEALTH_GPT56_POLICY_ID = "business_health_preview_gpt56_sol_terra_v1" as const;
export const BUSINESS_HEALTH_GPT56_SOL_MODEL = "gpt-5.6-sol" as const;
export const BUSINESS_HEALTH_GPT56_TERRA_MODEL = "gpt-5.6-terra" as const;
export const EXECUTIVE_BRIEF_GPT56_POLICY_ID = "executive_brief_preview_gpt56_sol_terra_v1" as const;
export const FINDING_EXPLANATION_POLICY_SELECTOR = "gpt56_sol_terra_v1" as const;
export const FINDING_EXPLANATION_GPT56_POLICY_ID = "finding_explanation_preview_gpt56_sol_terra_v1" as const;

const BUSINESS_HEALTH_LEGACY_DEADLINE_MS = 26_000;
const BUSINESS_HEALTH_LEGACY_NVIDIA_TIMEOUT_MS = 10_500;
const BUSINESS_HEALTH_LEGACY_OPENAI_TIMEOUT_MS = 8_500;
const BUSINESS_HEALTH_GPT56_DEADLINE_MS = 90_000;
const BUSINESS_HEALTH_GPT56_ATTEMPT_TIMEOUT_MS = 30_000;
const BUSINESS_HEALTH_GPT56_MAX_OUTPUT_TOKENS = 2_500;
export const EXECUTIVE_BRIEF_GPT56_DEADLINE_MS = 90_000;
export const EXECUTIVE_BRIEF_GPT56_SOL_TIMEOUT_MS = 52_000;
export const EXECUTIVE_BRIEF_GPT56_TERRA_TIMEOUT_MS = 30_000;
export const EXECUTIVE_BRIEF_GPT56_SOL_OUTPUT_TOKENS = 8_000;
export const EXECUTIVE_BRIEF_GPT56_TERRA_OUTPUT_TOKENS = 7_000;
const FINDING_EXPLANATION_GPT56_DEADLINE_MS = 75_000;
const FINDING_EXPLANATION_GPT56_SOL_TIMEOUT_MS = 42_000;
const FINDING_EXPLANATION_GPT56_TERRA_TIMEOUT_MS = 25_000;
const FINDING_EXPLANATION_GPT56_SOL_OUTPUT_TOKENS = 3_500;
const FINDING_EXPLANATION_GPT56_TERRA_OUTPUT_TOKENS = 3_000;

export const BUSINESS_HEALTH_GPT56_FALLBACK_REASONS = [
  "timeout",
  "transport_failure",
  "empty_response",
  "malformed_response",
  "schema_failure",
  "contextual_validation_failure",
  "unsupported_inference",
  "unsupported_relationship",
  "missing_required_signal",
  "citation_integrity_failure",
  "numeric_integrity_failure"
] as const satisfies readonly AIProviderFallbackReason[];

export type BusinessHealthGenerationPolicy = Readonly<{
  providerPolicy: AIProviderRoutingPolicy;
  executionBudget: AIProviderExecutionBudget;
  requestTimeoutMs: number;
  requestMaxOutputTokens: number;
}>;

export type ExecutiveBriefGenerationPolicy = Readonly<{
  providerPolicy: AIProviderRoutingPolicy;
  executionBudget: AIProviderExecutionBudget;
  requestTimeoutMs: number;
  requestMaxOutputTokens: number;
}>;

export type FindingExplanationGenerationPolicy = ExecutiveBriefGenerationPolicy;

export function isExecutiveBriefPreviewEnabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY === BUSINESS_HEALTH_GPT56_POLICY_SELECTOR;
}

export function isFindingExplanationEnabled() {
  return process.env.VAEROEX_FINDING_EXPLANATION_POLICY === FINDING_EXPLANATION_POLICY_SELECTOR;
}

export function buildSynchronousExecutiveProviderPolicy({
  modelRoute,
  nvidiaSecondaryMinimumRemainingMs
}: {
  modelRoute: VaeroexModelRoute;
  nvidiaSecondaryMinimumRemainingMs: number;
}): AIProviderRoutingPolicy {
  return {
    id: "synchronous_executive_openai_first_interim",
    steps: [
      { provider: "openai", model: resolveVaeroexModel(modelRoute, "openai") },
      {
        provider: "nvidia",
        model: resolveVaeroexModel(modelRoute, "nvidia"),
        minimumRemainingMs: nvidiaSecondaryMinimumRemainingMs
      }
    ]
  };
}

export function resolveBusinessHealthGenerationPolicy({
  startedAtMs,
  structuredOutput
}: {
  startedAtMs: number;
  structuredOutput: AIProviderStructuredOutput;
}): BusinessHealthGenerationPolicy {
  if (
    process.env.VERCEL_ENV === "preview" &&
    process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY === BUSINESS_HEALTH_GPT56_POLICY_SELECTOR
  ) {
    return {
      providerPolicy: {
        id: BUSINESS_HEALTH_GPT56_POLICY_ID,
        fallbackOn: BUSINESS_HEALTH_GPT56_FALLBACK_REASONS,
        steps: [
          {
            provider: "openai",
            model: BUSINESS_HEALTH_GPT56_SOL_MODEL,
            workflowConfiguration: {
              timeoutMs: BUSINESS_HEALTH_GPT56_ATTEMPT_TIMEOUT_MS,
              maxAttempts: 1,
              maxOutputTokens: BUSINESS_HEALTH_GPT56_MAX_OUTPUT_TOKENS,
              temperature: null,
              topP: null,
              reasoning: { mode: "standard", effort: "low" },
              structuredOutput,
              store: false,
              stream: false
            }
          },
          {
            provider: "openai",
            model: BUSINESS_HEALTH_GPT56_TERRA_MODEL,
            minimumRemainingMs: 5_000,
            workflowConfiguration: {
              timeoutMs: BUSINESS_HEALTH_GPT56_ATTEMPT_TIMEOUT_MS,
              maxAttempts: 1,
              maxOutputTokens: BUSINESS_HEALTH_GPT56_MAX_OUTPUT_TOKENS,
              temperature: null,
              topP: null,
              reasoning: { mode: "standard", effort: "medium" },
              structuredOutput,
              store: false,
              stream: false
            }
          }
        ]
      },
      executionBudget: {
        deadlineAtMs: startedAtMs + BUSINESS_HEALTH_GPT56_DEADLINE_MS,
        providerTimeoutMs: { openai: BUSINESS_HEALTH_GPT56_ATTEMPT_TIMEOUT_MS },
        minimumAttemptWindowMs: { openai: 5_000 },
        fallbackReserveMs: BUSINESS_HEALTH_GPT56_ATTEMPT_TIMEOUT_MS,
        reserveFallbackForPrimary: true,
        transitionReserveMs: 1_000
      },
      requestTimeoutMs: BUSINESS_HEALTH_GPT56_ATTEMPT_TIMEOUT_MS,
      requestMaxOutputTokens: BUSINESS_HEALTH_GPT56_MAX_OUTPUT_TOKENS
    };
  }

  const providerPolicy: AIProviderRoutingPolicy = process.env.VERCEL_ENV === "preview"
    ? {
        id: "business_health_preview_nvidia_primary_v1",
        steps: [
          { provider: "nvidia", model: NVIDIA_NEMOTRON_MODEL },
          { provider: "openai", model: resolveVaeroexModel("cross_business_reasoning", "openai") }
        ]
      }
    : {
        id: "business_health_openai_primary_v1",
        steps: [{ provider: "openai", model: resolveVaeroexModel("cross_business_reasoning", "openai") }]
      };

  return {
    providerPolicy,
    executionBudget: {
      deadlineAtMs: startedAtMs + BUSINESS_HEALTH_LEGACY_DEADLINE_MS,
      providerTimeoutMs: {
        nvidia: BUSINESS_HEALTH_LEGACY_NVIDIA_TIMEOUT_MS,
        openai: BUSINESS_HEALTH_LEGACY_OPENAI_TIMEOUT_MS
      },
      minimumAttemptWindowMs: { nvidia: 4_000, openai: 3_500 },
      fallbackReserveMs: BUSINESS_HEALTH_LEGACY_OPENAI_TIMEOUT_MS + 1_000,
      transitionReserveMs: 700
    },
    requestTimeoutMs: BUSINESS_HEALTH_LEGACY_NVIDIA_TIMEOUT_MS,
    requestMaxOutputTokens: 420
  };
}

export function resolveExecutiveBriefGenerationPolicy({
  startedAtMs,
  structuredOutput
}: {
  startedAtMs: number;
  structuredOutput: AIProviderStructuredOutput;
}): ExecutiveBriefGenerationPolicy {
  if (!isExecutiveBriefPreviewEnabled()) {
    throw new Error("Executive Brief generation is not enabled for this environment.");
  }

  return {
    providerPolicy: {
      id: EXECUTIVE_BRIEF_GPT56_POLICY_ID,
      fallbackOn: BUSINESS_HEALTH_GPT56_FALLBACK_REASONS,
      steps: [
        {
          provider: "openai",
          model: BUSINESS_HEALTH_GPT56_SOL_MODEL,
          workflowConfiguration: {
            timeoutMs: EXECUTIVE_BRIEF_GPT56_SOL_TIMEOUT_MS,
            maxAttempts: 1,
            maxOutputTokens: EXECUTIVE_BRIEF_GPT56_SOL_OUTPUT_TOKENS,
            temperature: null,
            topP: null,
            reasoning: { mode: "standard", effort: "high" },
            structuredOutput,
            store: false,
            stream: false
          }
        },
        {
          provider: "openai",
          model: BUSINESS_HEALTH_GPT56_TERRA_MODEL,
          minimumRemainingMs: 10_000,
          workflowConfiguration: {
            timeoutMs: EXECUTIVE_BRIEF_GPT56_TERRA_TIMEOUT_MS,
            maxAttempts: 1,
            maxOutputTokens: EXECUTIVE_BRIEF_GPT56_TERRA_OUTPUT_TOKENS,
            temperature: null,
            topP: null,
            reasoning: { mode: "standard", effort: "high" },
            structuredOutput,
            store: false,
            stream: false
          }
        }
      ]
    },
    executionBudget: {
      deadlineAtMs: startedAtMs + EXECUTIVE_BRIEF_GPT56_DEADLINE_MS,
      providerTimeoutMs: { openai: EXECUTIVE_BRIEF_GPT56_SOL_TIMEOUT_MS },
      minimumAttemptWindowMs: { openai: 10_000 },
      fallbackReserveMs: EXECUTIVE_BRIEF_GPT56_TERRA_TIMEOUT_MS + 1_000,
      reserveFallbackForPrimary: true,
      transitionReserveMs: 1_000
    },
    requestTimeoutMs: EXECUTIVE_BRIEF_GPT56_SOL_TIMEOUT_MS,
    requestMaxOutputTokens: EXECUTIVE_BRIEF_GPT56_SOL_OUTPUT_TOKENS
  };
}

export function resolveFindingExplanationGenerationPolicy({
  startedAtMs,
  structuredOutput
}: {
  startedAtMs: number;
  structuredOutput: AIProviderStructuredOutput;
}): FindingExplanationGenerationPolicy {
  if (!isFindingExplanationEnabled()) {
    throw new Error("Finding explanation generation is not enabled for this environment.");
  }

  return {
    providerPolicy: {
      id: FINDING_EXPLANATION_GPT56_POLICY_ID,
      fallbackOn: BUSINESS_HEALTH_GPT56_FALLBACK_REASONS,
      steps: [
        {
          provider: "openai",
          model: BUSINESS_HEALTH_GPT56_SOL_MODEL,
          workflowConfiguration: {
            timeoutMs: FINDING_EXPLANATION_GPT56_SOL_TIMEOUT_MS,
            maxAttempts: 1,
            maxOutputTokens: FINDING_EXPLANATION_GPT56_SOL_OUTPUT_TOKENS,
            temperature: null,
            topP: null,
            reasoning: { mode: "standard", effort: "high" },
            structuredOutput,
            store: false,
            stream: false
          }
        },
        {
          provider: "openai",
          model: BUSINESS_HEALTH_GPT56_TERRA_MODEL,
          minimumRemainingMs: 8_000,
          workflowConfiguration: {
            timeoutMs: FINDING_EXPLANATION_GPT56_TERRA_TIMEOUT_MS,
            maxAttempts: 1,
            maxOutputTokens: FINDING_EXPLANATION_GPT56_TERRA_OUTPUT_TOKENS,
            temperature: null,
            topP: null,
            reasoning: { mode: "standard", effort: "high" },
            structuredOutput,
            store: false,
            stream: false
          }
        }
      ]
    },
    executionBudget: {
      deadlineAtMs: startedAtMs + FINDING_EXPLANATION_GPT56_DEADLINE_MS,
      providerTimeoutMs: { openai: FINDING_EXPLANATION_GPT56_SOL_TIMEOUT_MS },
      minimumAttemptWindowMs: { openai: 8_000 },
      fallbackReserveMs: FINDING_EXPLANATION_GPT56_TERRA_TIMEOUT_MS + 1_000,
      reserveFallbackForPrimary: true,
      transitionReserveMs: 1_000
    },
    requestTimeoutMs: FINDING_EXPLANATION_GPT56_SOL_TIMEOUT_MS,
    requestMaxOutputTokens: FINDING_EXPLANATION_GPT56_SOL_OUTPUT_TOKENS
  };
}
