import "server-only";

import type { StageThreeBProfile } from "@/lib/ai/qualification/stage-three-b-types";

const nvidiaDisabled = { chat_template_kwargs: { enable_thinking: false } } as const;

export const STAGE_THREE_B_PROFILES: readonly StageThreeBProfile[] = [
  {
    id: "openai-gpt-5-6-terra-standard",
    provider: "openai",
    model: "gpt-5.6-terra",
    transport: "openai_responses",
    label: "GPT-5.6 Terra workflow-matched reasoning",
    deterministicAssemblyEligible: false,
    workflows: {
      business_health_explanation_v1: { timeoutMs: 30_000, maxOutputTokens: 2_000, temperature: 0, topP: 1, reasoningEffort: "low", reasoningMode: "standard" },
      leadership_priorities_v1: { timeoutMs: 60_000, maxOutputTokens: 4_000, temperature: 0, topP: 1, reasoningEffort: "medium", reasoningMode: "standard" },
      executive_brief_v1: { timeoutMs: 90_000, maxOutputTokens: 6_000, temperature: 0, topP: 1, reasoningEffort: "medium", reasoningMode: "standard" }
    }
  },
  {
    id: "openai-gpt-5-6-terra-higher",
    provider: "openai",
    model: "gpt-5.6-terra",
    transport: "openai_responses",
    label: "GPT-5.6 Terra higher reasoning comparison",
    deterministicAssemblyEligible: false,
    workflows: {
      business_health_explanation_v1: { timeoutMs: 30_000, maxOutputTokens: 2_500, temperature: 0, topP: 1, reasoningEffort: "medium", reasoningMode: "standard" },
      leadership_priorities_v1: { timeoutMs: 60_000, maxOutputTokens: 5_000, temperature: 0, topP: 1, reasoningEffort: "high", reasoningMode: "standard" },
      executive_brief_v1: { timeoutMs: 90_000, maxOutputTokens: 7_000, temperature: 0, topP: 1, reasoningEffort: "high", reasoningMode: "standard" }
    }
  },
  {
    id: "openai-gpt-5-6-sol-standard",
    provider: "openai",
    model: "gpt-5.6-sol",
    transport: "openai_responses",
    label: "GPT-5.6 Sol standard reasoning",
    deterministicAssemblyEligible: true,
    workflows: {
      business_health_explanation_v1: { timeoutMs: 30_000, maxOutputTokens: 2_500, temperature: 0, topP: 1, reasoningEffort: "low", reasoningMode: "standard" },
      leadership_priorities_v1: { timeoutMs: 60_000, maxOutputTokens: 6_000, temperature: 0, topP: 1, reasoningEffort: "high", reasoningMode: "standard" },
      executive_brief_v1: { timeoutMs: 90_000, maxOutputTokens: 8_000, temperature: 0, topP: 1, reasoningEffort: "high", reasoningMode: "standard" }
    }
  },
  {
    id: "openai-gpt-5-6-sol-pro",
    provider: "openai",
    model: "gpt-5.6-sol",
    transport: "openai_responses",
    label: "GPT-5.6 Sol pro mode",
    deterministicAssemblyEligible: true,
    workflows: {
      leadership_priorities_v1: { timeoutMs: 60_000, maxOutputTokens: 8_000, temperature: 0, topP: 1, reasoningEffort: "high", reasoningMode: "pro" },
      executive_brief_v1: { timeoutMs: 90_000, maxOutputTokens: 10_000, temperature: 0, topP: 1, reasoningEffort: "high", reasoningMode: "pro" }
    }
  },
  {
    id: "nvidia-nemotron-3-ultra-550b-disabled-stage-3b",
    provider: "nvidia",
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    transport: "nvidia_chat_completions",
    label: "Nemotron 3 Ultra 550B reasoning disabled",
    deterministicAssemblyEligible: true,
    workflows: {
      business_health_explanation_v1: { timeoutMs: 30_000, maxOutputTokens: 2_048, temperature: 0, topP: 1, requestExtensions: nvidiaDisabled },
      leadership_priorities_v1: { timeoutMs: 60_000, maxOutputTokens: 4_096, temperature: 0, topP: 1, requestExtensions: nvidiaDisabled },
      executive_brief_v1: { timeoutMs: 90_000, maxOutputTokens: 6_144, temperature: 0, topP: 1, requestExtensions: nvidiaDisabled }
    }
  },
  {
    id: "nvidia-nemotron-3-ultra-550b-bounded-stage-3b",
    provider: "nvidia",
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    transport: "nvidia_chat_completions",
    label: "Nemotron 3 Ultra 550B bounded reasoning",
    deterministicAssemblyEligible: true,
    workflows: {
      leadership_priorities_v1: { timeoutMs: 60_000, maxOutputTokens: 8_192, temperature: 1, topP: 0.95, requestExtensions: { chat_template_kwargs: { enable_thinking: true }, reasoning_budget: 4_096 } },
      executive_brief_v1: { timeoutMs: 90_000, maxOutputTokens: 16_384, temperature: 1, topP: 0.95, requestExtensions: { chat_template_kwargs: { enable_thinking: true }, reasoning_budget: 8_192 } }
    }
  },
  {
    id: "nvidia-nemotron-3-super-120b-bounded-stage-3b",
    provider: "nvidia",
    model: "nvidia/nemotron-3-super-120b-a12b",
    transport: "nvidia_chat_completions",
    label: "Nemotron 3 Super 120B bounded reasoning",
    deterministicAssemblyEligible: true,
    workflows: {
      business_health_explanation_v1: { timeoutMs: 30_000, maxOutputTokens: 4_096, temperature: 0.6, topP: 0.95, requestExtensions: { chat_template_kwargs: { enable_thinking: true }, reasoning_budget: 2_048 } },
      leadership_priorities_v1: { timeoutMs: 60_000, maxOutputTokens: 8_192, temperature: 1, topP: 0.95, requestExtensions: { chat_template_kwargs: { enable_thinking: true }, reasoning_budget: 4_096 } },
      executive_brief_v1: { timeoutMs: 90_000, maxOutputTokens: 16_384, temperature: 1, topP: 0.95, requestExtensions: { chat_template_kwargs: { enable_thinking: true }, reasoning_budget: 8_192 } }
    }
  },
  {
    id: "openai-gpt-4o-mini-legacy-control",
    provider: "openai",
    model: "gpt-4o-mini",
    transport: "openai_production_adapter",
    label: "GPT-4o mini legacy control",
    deterministicAssemblyEligible: false,
    workflows: {
      business_health_explanation_v1: { timeoutMs: 30_000, maxOutputTokens: 2_048, temperature: 0.1, topP: 1 },
      leadership_priorities_v1: { timeoutMs: 60_000, maxOutputTokens: 4_096, temperature: 0.1, topP: 1 },
      executive_brief_v1: { timeoutMs: 90_000, maxOutputTokens: 6_144, temperature: 0.1, topP: 1 }
    }
  }
] as const;

export const STAGE_THREE_B_PROFILE_IDS = STAGE_THREE_B_PROFILES.map((profile) => profile.id);

export function getStageThreeBProfile(profileId: string) {
  return STAGE_THREE_B_PROFILES.find((profile) => profile.id === profileId) || null;
}
