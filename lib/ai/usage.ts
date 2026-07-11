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
  "gpt-4o-mini": { input: 15, output: 60 },
  "gpt-5.4-mini": { input: 75, output: 450 },
  "gpt-5.6-luna": { input: 100, output: 600 },
  "gpt-5.6-terra": { input: 250, output: 1_500 },
  "gpt-5.6-sol": { input: 500, output: 3_000 }
};
const CONSERVATIVE_UNKNOWN_MODEL_COST_CENTS_PER_1M = { input: 500, output: 3_000 };
const DEFAULT_WORKSPACE_MONTHLY_TOKEN_BUDGET = 2_000_000;
const DEFAULT_SINGLE_REQUEST_TOKEN_BUDGET = 120_000;
const MAX_MONTHLY_USAGE_ROWS_FOR_BUDGET_CHECK = 10_000;

function numberEnv(name: string) {
  const value = Number.parseFloat(process.env[name] || "");
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function modelCost(model: string) {
  const inputOverride = numberEnv("OPENAI_INPUT_COST_CENTS_PER_1M");
  const outputOverride = numberEnv("OPENAI_OUTPUT_COST_CENTS_PER_1M");
  const normalized = model.trim().toLowerCase();
  const exact = DEFAULT_MODEL_COST_CENTS_PER_1M[normalized];
  const matchedPrefix = Object.entries(DEFAULT_MODEL_COST_CENTS_PER_1M).find(([name]) => normalized.startsWith(`${name}-`))?.[1];
  const defaults = exact || matchedPrefix || CONSERVATIVE_UNKNOWN_MODEL_COST_CENTS_PER_1M;

  return {
    input: inputOverride ?? defaults.input,
    output: outputOverride ?? defaults.output,
    estimated: !exact && !matchedPrefix && inputOverride === null && outputOverride === null
  };
}

export function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function integerEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number.parseInt(process.env[name] || "", 10);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}

export function getWorkspaceTokenBudget() {
  return {
    monthlyTokens: integerEnv("VAEROEX_WORKSPACE_MONTHLY_TOKEN_BUDGET", DEFAULT_WORKSPACE_MONTHLY_TOKEN_BUDGET, 50_000, 50_000_000),
    singleRequestTokens: integerEnv("VAEROEX_SINGLE_REQUEST_TOKEN_BUDGET", DEFAULT_SINGLE_REQUEST_TOKEN_BUDGET, 5_000, 1_000_000)
  };
}

function monthStart() {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

export function estimatedCostCents(usage: Pick<VaeroexTokenUsage, "inputTokens" | "outputTokens" | "model">) {
  const cost = modelCost(usage.model);
  const inputCost = (usage.inputTokens / 1_000_000) * cost.input;
  const outputCost = (usage.outputTokens / 1_000_000) * cost.output;

  return Math.max(0, Math.ceil(inputCost + outputCost));
}

export async function assertWorkspaceTokenBudget({
  supabase,
  workspaceId,
  estimatedRequestTokens
}: {
  supabase?: SupabaseClient<Database> | null;
  workspaceId?: string | null;
  estimatedRequestTokens: number;
}) {
  const budget = getWorkspaceTokenBudget();

  if (estimatedRequestTokens > budget.singleRequestTokens) {
    throw new Error("This request is too large for a single Vaeroex analysis. Reduce the file size or narrow the question.");
  }

  if (!supabase || !workspaceId) {
    return {
      allowed: true,
      budget,
      usedTokens: 0,
      estimatedRequestTokens,
      remainingTokens: budget.monthlyTokens
    };
  }

  const { data, error } = await supabase
    .from("ai_usage")
    .select("tokens_used")
    .eq("workspace_id", workspaceId)
    .gte("created_at", monthStart())
    .limit(MAX_MONTHLY_USAGE_ROWS_FOR_BUDGET_CHECK);

  if (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        component: "vaeroex-usage",
        event: "token_budget_check_failed",
        workspaceId,
        message: error.message
      })
    );
    throw new Error("Vaeroex could not verify this workspace’s intelligence usage budget. Please try again shortly.");
  }

  if ((data || []).length >= MAX_MONTHLY_USAGE_ROWS_FOR_BUDGET_CHECK) {
    throw new Error("Vaeroex could not safely calculate this workspace’s monthly token usage. Contact Vaeroex support before running more intelligence requests.");
  }

  const usedTokens = (data || []).reduce((sum, row) => sum + (row.tokens_used || 0), 0);
  const projectedTokens = usedTokens + estimatedRequestTokens;

  if (projectedTokens > budget.monthlyTokens) {
    throw new Error("This workspace has reached its monthly Vaeroex intelligence token budget. Contact Vaeroex support if you need a temporary increase.");
  }

  return {
    allowed: true,
    budget,
    usedTokens,
    estimatedRequestTokens,
    remainingTokens: Math.max(0, budget.monthlyTokens - projectedTokens)
  };
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
