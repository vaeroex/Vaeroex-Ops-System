import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

export type VaeroexTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  requestId?: string | null;
  latencyMs?: number | null;
  status?: "completed" | "failed";
  metadata?: Json;
};

const DEFAULT_MODEL_COST_CENTS_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 15, output: 60 }
};

function numberEnv(name: string) {
  const value = Number.parseFloat(process.env[name] || "");
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function modelCost(model: string) {
  const inputOverride = numberEnv("OPENAI_INPUT_COST_CENTS_PER_1M");
  const outputOverride = numberEnv("OPENAI_OUTPUT_COST_CENTS_PER_1M");
  const normalized = model.trim().toLowerCase();
  const defaults = DEFAULT_MODEL_COST_CENTS_PER_1M[normalized] || { input: 0, output: 0 };

  return {
    input: inputOverride ?? defaults.input,
    output: outputOverride ?? defaults.output
  };
}

export function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimatedCostCents(usage: Pick<VaeroexTokenUsage, "inputTokens" | "outputTokens" | "model">) {
  const cost = modelCost(usage.model);
  const inputCost = (usage.inputTokens / 1_000_000) * cost.input;
  const outputCost = (usage.outputTokens / 1_000_000) * cost.output;

  return Math.max(0, Math.ceil(inputCost + outputCost));
}

export async function recordVaeroexAiUsage({
  supabase,
  workspaceId,
  userId,
  agentType,
  usage
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  userId?: string | null;
  agentType: string;
  usage: VaeroexTokenUsage;
}) {
  const { error } = await supabase.from("ai_usage").insert({
    workspace_id: workspaceId,
    user_id: userId || null,
    agent_type: agentType,
    tokens_used: usage.totalTokens,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    estimated_cost_cents: estimatedCostCents(usage),
    model: usage.model,
    request_id: usage.requestId || null,
    latency_ms: usage.latencyMs ?? null,
    status: usage.status || "completed",
    metadata_json: usage.metadata || {}
  });

  if (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        component: "vaeroex-usage",
        event: "usage_insert_failed",
        workspaceId,
        agentType,
        message: error.message
      })
    );
  }
}
