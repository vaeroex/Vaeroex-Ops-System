import "server-only";

import { resolveConfiguredAIProvider, resolveVaeroexModel, type VaeroexModelRoute } from "@/lib/ai/model-routing";
import type { AIProviderRoutingPolicy } from "@/lib/ai/providers/provider-manager";
import {
  isExecutiveProviderPolicyVariant,
  type ExecutiveProviderPolicyVariant
} from "@/lib/ai/providers/workflow-provider-policy-contract";

export { EXECUTIVE_PROVIDER_POLICY_HEADER } from "@/lib/ai/providers/workflow-provider-policy-contract";

export function resolvePreviewExecutiveProviderPolicyVariant({
  requested,
  vercelEnvironment = process.env.VERCEL_ENV,
  authorized
}: {
  requested: string | null;
  vercelEnvironment?: string;
  authorized: boolean;
}): ExecutiveProviderPolicyVariant | null {
  if (vercelEnvironment !== "preview" || !authorized) return null;
  return isExecutiveProviderPolicyVariant(requested) ? requested : null;
}

export function buildSynchronousExecutiveProviderPolicy({
  modelRoute,
  previewVariant,
  nvidiaSecondaryMinimumRemainingMs
}: {
  modelRoute: VaeroexModelRoute;
  previewVariant: ExecutiveProviderPolicyVariant | null;
  nvidiaSecondaryMinimumRemainingMs: number;
}): AIProviderRoutingPolicy {
  const configuredProvider = resolveConfiguredAIProvider();
  const variant = previewVariant || (configuredProvider === "nvidia" ? "nvidia_first" : "openai_first");
  const benchmark = previewVariant !== null;

  if (variant === "nvidia_first") {
    return {
      id: benchmark ? "preview_executive_nvidia_first" : "configured_executive_nvidia_first",
      steps: [
        { provider: "nvidia", model: resolveVaeroexModel(modelRoute, "nvidia") },
        { provider: "openai", model: resolveVaeroexModel(modelRoute, "openai") }
      ]
    };
  }

  return {
    id: benchmark ? "preview_executive_openai_first" : "configured_executive_openai_first",
    steps: [
      { provider: "openai", model: resolveVaeroexModel(modelRoute, "openai") },
      ...(benchmark || configuredProvider === "nvidia"
        ? [{
            provider: "nvidia" as const,
            model: resolveVaeroexModel(modelRoute, "nvidia"),
            minimumRemainingMs: nvidiaSecondaryMinimumRemainingMs
          }]
        : [])
    ]
  };
}
