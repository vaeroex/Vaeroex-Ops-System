import "server-only";

import { resolveVaeroexModel } from "@/lib/ai/model-routing";
import type { QualificationModelProfile } from "@/lib/ai/qualification/types";

const noThink = { chat_template_kwargs: { enable_thinking: false } } as const;

export function getQualificationModelProfiles(): readonly QualificationModelProfile[] {
  return [
    {
      id: "nvidia-nemotron-3-nano-30b-disabled",
      provider: "nvidia",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      reasoningMode: "disabled",
      temperature: 0,
      topP: 1,
      maxOutputTokens: 4096,
      requestExtensions: noThink
    },
    {
      id: "nvidia-nemotron-3-nano-30b-bounded",
      provider: "nvidia",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      reasoningMode: "bounded",
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 4096,
      requestExtensions: { reasoning_budget: 2048 }
    },
    {
      id: "nvidia-nemotron-3-nano-omni-disabled",
      provider: "nvidia",
      model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      reasoningMode: "disabled",
      temperature: 0,
      topP: 1,
      maxOutputTokens: 4096,
      requestExtensions: noThink
    },
    {
      id: "nvidia-nemotron-3-nano-omni-bounded",
      provider: "nvidia",
      model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      reasoningMode: "bounded",
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 4096,
      requestExtensions: { reasoning_budget: 2048 }
    },
    {
      id: "nvidia-llama-3-3-nemotron-super-49b-no-think",
      provider: "nvidia",
      model: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      reasoningMode: "disabled",
      temperature: 0,
      topP: 1,
      maxOutputTokens: 4096,
      systemPrefix: "/no_think"
    },
    {
      id: "nvidia-llama-3-3-nemotron-super-49b-default",
      provider: "nvidia",
      model: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      reasoningMode: "default",
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 4096
    },
    {
      id: "nvidia-nemotron-3-super-120b-disabled",
      provider: "nvidia",
      model: "nvidia/nemotron-3-super-120b-a12b",
      reasoningMode: "disabled",
      temperature: 0,
      topP: 1,
      maxOutputTokens: 4096,
      requestExtensions: noThink
    },
    {
      id: "nvidia-nemotron-3-super-120b-bounded",
      provider: "nvidia",
      model: "nvidia/nemotron-3-super-120b-a12b",
      reasoningMode: "bounded",
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 4096,
      requestExtensions: { reasoning_budget: 2048 }
    },
    {
      id: "nvidia-nemotron-3-ultra-550b-disabled",
      provider: "nvidia",
      model: "nvidia/nemotron-3-ultra-550b-a55b",
      reasoningMode: "disabled",
      temperature: 0,
      topP: 1,
      maxOutputTokens: 4096,
      requestExtensions: noThink
    },
    {
      id: "nvidia-nemotron-3-ultra-550b-bounded",
      provider: "nvidia",
      model: "nvidia/nemotron-3-ultra-550b-a55b",
      reasoningMode: "bounded",
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 4096,
      requestExtensions: { reasoning_budget: 2048 }
    },
    {
      id: "nvidia-glm-5-2-default",
      provider: "nvidia",
      model: "z-ai/glm-5.2",
      reasoningMode: "default",
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 4096
    },
    {
      id: "nvidia-deepseek-v4-flash-disabled",
      provider: "nvidia",
      model: "deepseek-ai/deepseek-v4-flash",
      reasoningMode: "disabled",
      temperature: 0,
      topP: 1,
      maxOutputTokens: 4096,
      requestExtensions: { chat_template_kwargs: { thinking: false } }
    },
    {
      id: "nvidia-deepseek-v4-flash-extended",
      provider: "nvidia",
      model: "deepseek-ai/deepseek-v4-flash",
      reasoningMode: "extended",
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 8192,
      requestExtensions: { reasoning_effort: "high" }
    },
    {
      id: "nvidia-deepseek-v4-pro-disabled",
      provider: "nvidia",
      model: "deepseek-ai/deepseek-v4-pro",
      reasoningMode: "disabled",
      temperature: 0,
      topP: 1,
      maxOutputTokens: 4096,
      requestExtensions: { chat_template_kwargs: { thinking: false } }
    },
    {
      id: "nvidia-deepseek-v4-pro-extended",
      provider: "nvidia",
      model: "deepseek-ai/deepseek-v4-pro",
      reasoningMode: "extended",
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 8192,
      requestExtensions: { reasoning_effort: "high" }
    },
    {
      id: "nvidia-gpt-oss-20b-default",
      provider: "nvidia",
      model: "openai/gpt-oss-20b",
      reasoningMode: "default",
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 4096
    },
    {
      id: "nvidia-llama-3-3-70b-instruct-control",
      provider: "nvidia",
      model: "meta/llama-3.3-70b-instruct",
      reasoningMode: "disabled",
      temperature: 0,
      topP: 1,
      maxOutputTokens: 4096
    },
    {
      id: "openai-production-control",
      provider: "openai",
      model: resolveVaeroexModel("cross_business_reasoning", "openai"),
      reasoningMode: "default",
      temperature: 0.1,
      topP: 1,
      maxOutputTokens: 4096
    }
  ];
}
export function getQualificationModelProfile(profileId: string) {
  return getQualificationModelProfiles().find((profile) => profile.id === profileId) || null;
}
