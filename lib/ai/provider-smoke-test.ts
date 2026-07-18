import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildWorkspaceEvidenceContext, evidenceContextAsJson } from "@/lib/ai/evidence-index";
import { getAIProviderRetrySettings } from "@/lib/ai/provider-resilience";
import { runStructuredAI } from "@/lib/ai/providers/provider-manager";
import type { AIProvider } from "@/lib/ai/providers/types";
import { runVaeroexCompletionWithUsage } from "@/lib/ai/vaeroex-client";
import { getVaeroexWorkflow } from "@/lib/ai/vaeroex-workflows";
import { validateVaeroexWorkflowContract } from "@/lib/ai/output-contracts";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import type { Database } from "@/lib/supabase/types";

function mockProvider(name: "openai" | "nvidia", responses: string[]): AIProvider {
  let index = 0;
  return {
    name,
    supportsAttachments: true,
    isConfigured: () => true,
    async generate() {
      const content = responses[Math.min(index, responses.length - 1)] || "";
      index += 1;
      return {
        content,
        requestId: `smoke-${name}-${index}`,
        latencyMs: 1,
        finishReason: "stop",
        truncationDetected: false,
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }
      };
    }
  };
}

async function verifyFallbackPath() {
  const generation = await runStructuredAI({
    primaryProvider: "nvidia",
    primaryModel: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    fallbackModel: "gpt-4o-mini",
    systemPrompt: "Return a valid Vaeroex JSON response.",
    userContent: [{ type: "text", text: "Synthetic provider fallback smoke test." }],
    settings: { ...getAIProviderRetrySettings("nvidia"), timeoutMs: 1_000 },
    providers: {
      nvidia: mockProvider("nvidia", ["not-json", '{"unexpected":true}']),
      openai: mockProvider("openai", ['{"title":"Fallback verified","direct_answer":"Fallback is working.","response_markdown":"Fallback is working."}'])
    },
    validate: (value) => validateVaeroexWorkflowContract("ask_vaeroex", value),
    logContext: { workflow: "provider_smoke_test", executionPath: "synthetic_fallback" }
  });

  return generation.provider === "openai" && generation.fallbackUsed && generation.attempts.length === 3;
}

export async function runAIProviderSmokeTest({
  supabase,
  workspaceId,
  userId
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  userId: string;
}) {
  if (process.env.VAEROEX_AI_SMOKE_TEST_ENABLED !== "true") {
    throw new Error("AI provider smoke testing is disabled.");
  }

  const question = "What should leadership understand about revenue and margin?";
  const evidence = await buildWorkspaceEvidenceContext({
    supabase,
    workspaceId,
    query: question,
    maxChunks: 3,
    embeddingTimeoutMs: 5_000
  });
  if (!evidence.available) throw new Error("The selected demo workspace has no eligible sample Business Memory for the smoke test.");
  const workflow = getVaeroexWorkflow("ask_vaeroex");
  const generation = await runVaeroexCompletionWithUsage({
    workflow,
    userPrompt: question,
    workspaceSnapshot: { evidence_context: evidenceContextAsJson(evidence) },
    extraInputs: {
      smoke_test: true,
      evidence_scope: "authorized_demo_workspace"
    },
    supabase,
    workspaceId,
    userId,
    executionPath: "provider_smoke_test",
    maxOutputTokens: 500
  });
  await recordVaeroexAiUsage({
    supabase,
    workspaceId,
    userId,
    agentType: "provider_smoke_test",
    usage: generation.usage
  });
  const fallbackVerified = await verifyFallbackPath();

  return {
    ok: fallbackVerified,
    evidenceRetrieved: evidence.chunks.length,
    retrievalMode: evidence.retrievalMode,
    schemaValidated: true,
    activeProvider: generation.usage.metadata && !Array.isArray(generation.usage.metadata) && typeof generation.usage.metadata === "object"
      ? generation.usage.metadata.provider || null
      : null,
    model: generation.usage.model,
    fallbackVerified,
    latencyMs: generation.usage.latencyMs || null,
    inputTokens: generation.usage.inputTokens,
    outputTokens: generation.usage.outputTokens
  };
}
