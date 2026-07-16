import "server-only";

import { NVIDIA_NEMOTRON_MODEL } from "@/lib/ai/providers/provider-manager";
import type { AIProviderName } from "@/lib/ai/providers/types";

export type VaeroexModelRoute = "default" | "kpi_overview" | "focused_explanation" | "cross_business_reasoning" | "file_analysis";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

function configured(name: string) {
  return process.env[name]?.trim() || null;
}

export function resolveConfiguredAIProvider(): AIProviderName {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "nvidia" ? "nvidia" : "openai";
}

export function resolveVaeroexModel(route: VaeroexModelRoute = "default", provider = resolveConfiguredAIProvider()) {
  if (provider === "nvidia") return NVIDIA_NEMOTRON_MODEL;
  const current = configured("OPENAI_MODEL") || DEFAULT_OPENAI_MODEL;

  if (route === "focused_explanation") {
    return configured("VAEROEX_FOCUSED_EXPLANATION_MODEL") || current;
  }

  if (route === "cross_business_reasoning") {
    return configured("VAEROEX_CROSS_BUSINESS_MODEL") || configured("VAEROEX_FOCUSED_EXPLANATION_MODEL") || current;
  }

  if (route === "file_analysis") {
    return configured("VAEROEX_FILE_ANALYSIS_MODEL") || current;
  }

  return current;
}

export function getVaeroexModelRoutingStatus() {
  return {
    provider: resolveConfiguredAIProvider(),
    default: resolveVaeroexModel("default"),
    kpiOverview: resolveVaeroexModel("kpi_overview"),
    focusedExplanation: resolveVaeroexModel("focused_explanation"),
    crossBusinessReasoning: resolveVaeroexModel("cross_business_reasoning"),
    fileAnalysis: resolveVaeroexModel("file_analysis"),
    focusedOverrideConfigured: Boolean(configured("VAEROEX_FOCUSED_EXPLANATION_MODEL")),
    crossBusinessOverrideConfigured: Boolean(configured("VAEROEX_CROSS_BUSINESS_MODEL")),
    fileAnalysisOverrideConfigured: Boolean(configured("VAEROEX_FILE_ANALYSIS_MODEL"))
  };
}
