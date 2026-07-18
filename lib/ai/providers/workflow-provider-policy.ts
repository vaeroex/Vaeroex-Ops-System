import "server-only";

import { resolveVaeroexModel, type VaeroexModelRoute } from "@/lib/ai/model-routing";
import type { AIProviderRoutingPolicy } from "@/lib/ai/providers/provider-manager";

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
