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

// Standard text-token catalog checked 2026-10-05 against the official model pages.
// https://developers.openai.com/api/docs/models/gpt-5.6-sol (and luna/terra).
// Estimates exclude cache discounts/write charges, tool charges, service-tier/regional adjustments
// and unreported usage. They are not provider invoices or customer billing.
const DEFAULT_MODEL_COST_CENTS_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 15, output: 60 },
  "gpt-5.4-mini": { input: 75, output: 450 },
  "gpt-5.6-luna": { input: 20, output: 120 },
  "gpt-5.6-terra": { input: 200, output: 1_200 },
  "gpt-5.6-sol": { input: 400, output: 2_000 }
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
  const normalized = model.trim().toLowerCase();
  const isNvidia = normalized.startsWith("nvidia/");
  const inputOverride = numberEnv(isNvidia ? "NVIDIA_INPUT_COST_CENTS_PER_1M" : "OPENAI_INPUT_COST_CENTS_PER_1M");
  const outputOverride = numberEnv(isNvidia ? "NVIDIA_OUTPUT_COST_CENTS_PER_1M" : "OPENAI_OUTPUT_COST_CENTS_PER_1M");
  const exact = DEFAULT_MODEL_COST_CENTS_PER_1M[normalized];
  const matchedPrefix = Object.entries(DEFAULT_MODEL_COST_CENTS_PER_1M).find(([name]) => normalized.startsWith(`${name}-`))?.[1];
  const defaults = exact || matchedPrefix || CONSERVATIVE_UNKNOWN_MODEL_COST_CENTS_PER_1M;

  return {
    input: inputOverride ?? defaults.input,
    output: outputOverride ?? defaults.output,
    catalogKnown: Boolean(exact || matchedPrefix),
    inputOverride: inputOverride !== null,
    outputOverride: outputOverride !== null,
    estimated: !exact && !matchedPrefix && inputOverride === null && outputOverride === null,
    basis: inputOverride !== null || outputOverride !== null ? "environment_override" : exact || matchedPrefix ? "standard_catalog" : "conservative_unknown"
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

const COST_ESTIMATE_VERSION = "standard-text-2026-10-05-v1";

function estimateAttempt(usage: Pick<VaeroexTokenUsage, "inputTokens" | "outputTokens" | "model">) {
  const cost = modelCost(usage.model);
  const inputTokens = Number.isFinite(usage.inputTokens) ? Math.max(0, usage.inputTokens) : 0;
  const outputTokens = Number.isFinite(usage.outputTokens) ? Math.max(0, usage.outputTokens) : 0;
  const longContext = /^gpt-5\.6-(luna|terra|sol)(?:-|$)/.test(usage.model.trim().toLowerCase()) && inputTokens > 272_000;
  const inputRate = cost.input * (longContext && !cost.inputOverride ? 2 : 1);
  const outputRate = cost.output * (longContext && !cost.outputOverride ? 1.5 : 1);
  return {
    model: usage.model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    input_cents_per_million: inputRate,
    output_cents_per_million: outputRate,
    rate_basis: cost.basis,
    input_rate_basis: cost.inputOverride ? "environment_override" : cost.catalogKnown ? "standard_catalog" : "conservative_unknown",
    output_rate_basis: cost.outputOverride ? "environment_override" : cost.catalogKnown ? "standard_catalog" : "conservative_unknown",
    amount_microcents: Math.round(inputTokens * inputRate + outputTokens * outputRate)
  };
}

export function estimatedCostCents(usage: Pick<VaeroexTokenUsage, "inputTokens" | "outputTokens" | "model">) {
  return Math.ceil(estimateAttempt(usage).amount_microcents / 1_000_000);
}

function providerAttempts(metadata: Json | undefined) {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") return [];
  const attempts = (metadata as Record<string, Json | undefined>).provider_attempts;
  if (!Array.isArray(attempts)) return [];

  return attempts.flatMap((attempt) => {
    if (!attempt || Array.isArray(attempt) || typeof attempt !== "object") return [];
    const value = attempt as Record<string, Json | undefined>;
    const model = typeof value.runtime_model === "string"
      ? value.runtime_model
      : typeof value.model === "string"
        ? value.model
        : typeof value.requested_model === "string"
          ? value.requested_model
          : "";
    const inputTokens = typeof value.input_tokens === "number"
      ? value.input_tokens
      : typeof value.inputTokens === "number"
        ? value.inputTokens
        : 0;
    const outputTokens = typeof value.output_tokens === "number"
      ? value.output_tokens
      : typeof value.outputTokens === "number"
        ? value.outputTokens
        : 0;
    return model ? [{ model, inputTokens, outputTokens }] : [];
  });
}

export function providerCostEstimate(usage: VaeroexTokenUsage) {
  const suppliedAttempts = providerAttempts(usage.metadata);
  const attempts = (suppliedAttempts.length ? suppliedAttempts : [usage]).map(estimateAttempt);
  return {
    schema_version: 1,
    version: COST_ESTIMATE_VERSION,
    currency: "USD",
    kind: "uncached_text_token_estimate",
    amount_microcents: attempts.reduce((total, attempt) => total + attempt.amount_microcents, 0),
    attempts
  };
}

export function estimatedProviderCostCents(usage: VaeroexTokenUsage) {
  return Math.ceil(providerCostEstimate(usage).amount_microcents / 1_000_000);
}

/** New rows retain precision; pre-versioned rows keep their historical estimate. */
export function recordedEstimatedCostCents(row: { estimated_cost_cents: number; metadata_json: Json }) {
  const metadata = row.metadata_json;
  const value = metadata && !Array.isArray(metadata) && typeof metadata === "object" ? metadata.cost_estimate : null;
  if (value && !Array.isArray(value) && typeof value === "object" && value.schema_version === 1 && typeof value.version === "string" && value.currency === "USD"
    && typeof value.amount_microcents === "number" && Number.isSafeInteger(value.amount_microcents) && value.amount_microcents >= 0) {
    return value.amount_microcents / 1_000_000;
  }
  return row.estimated_cost_cents;
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

  const { data, error, count } = await supabase
    .from("ai_usage")
    .select("tokens_used", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .gte("created_at", monthStart())
    .limit(MAX_MONTHLY_USAGE_ROWS_FOR_BUDGET_CHECK);

  if (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        component: "vaeroex-usage",
        event: "token_budget_check_failed",
        workspaceId
      })
    );
    throw new Error("Vaeroex could not verify this workspace’s intelligence usage budget. Please try again shortly.");
  }

  // PostgREST can cap the response below our requested limit. A partial
  // history must never authorize a provider call as if missing usage were zero.
  if (!Array.isArray(data) || !Number.isSafeInteger(count) || count !== data.length
    || data.length >= MAX_MONTHLY_USAGE_ROWS_FOR_BUDGET_CHECK
    || data.some((row) => !Number.isSafeInteger(row.tokens_used) || row.tokens_used < 0)) {
    throw new Error("Vaeroex could not safely calculate this workspace’s monthly token usage. Contact Vaeroex support before running more intelligence requests.");
  }

  const usedTokens = data.reduce((sum, row) => sum + row.tokens_used, 0);
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
    estimated_cost_cents: estimatedProviderCostCents(usage),
    model: usage.model,
    request_id: usage.requestId || null,
    latency_ms: usage.latencyMs ?? null,
    status: usage.status || "completed",
    metadata_json: {
      ...(usage.metadata && !Array.isArray(usage.metadata) && typeof usage.metadata === "object" ? usage.metadata : {}),
      cost_estimate: providerCostEstimate(usage)
    }
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
