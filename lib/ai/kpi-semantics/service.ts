import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAIProviderRetrySettings } from "@/lib/ai/provider-resilience";
import { runStructuredAI } from "@/lib/ai/providers/provider-manager";
import {
  isKpiSemanticClassificationEnabled,
  KPI_SEMANTIC_CLASSIFICATION_LUNA_MODEL,
  KPI_SEMANTIC_CLASSIFICATION_POLICY_ID
} from "@/lib/ai/providers/workflow-provider-policy";
import {
  KPI_SEMANTIC_CLASSIFICATION_CONTRACT_ID,
  KPI_SEMANTIC_CLASSIFICATION_JSON_SCHEMA,
  validateKpiSemanticClassification,
  type KpiSemanticClassificationProposal
} from "@/lib/ai/kpi-semantics/contracts";
import { deterministicKpiSemantics, KPI_SEMANTIC_VERSION } from "@/lib/kpis/semantics";
import type { Database, Json } from "@/lib/supabase/types";

const ACCEPTANCE_CONFIDENCE = 0.92;
const SYSTEM_PROMPT = `Classify one KPI label for Vaeroex. Return only strict JSON.
You may propose identity, display label, unit, scale, aggregation, cadence, desired direction, target behavior, metric role, aliases, confidence, and a concise audit rationale.
Do not calculate performance or targets. Do not merge records. Do not invent business scope, a denominator, a unit, or an ideal value. Use unknown when meaning is ambiguous. Target-like series must remain separate from actual measurements.`;

export async function classifyAndPersistKpiSemantics({
  supabase,
  workspaceId,
  userId,
  label,
  category = null,
  definition = null
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  userId: string;
  label: string;
  category?: string | null;
  definition?: string | null;
}) {
  const deterministic = deterministicKpiSemantics(label);
  const existing = await supabase
    .from("kpi_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("kpi_name", label)
    .limit(1)
    .maybeSingle();
  if (existing.error || existing.data?.classification_confirmed) return;

  let proposal: KpiSemanticClassificationProposal | null = null;
  if (deterministic.desiredDirection === "unknown" && isKpiSemanticClassificationEnabled()) {
    try {
      const settings = getAIProviderRetrySettings("openai");
      const generation = await runStructuredAI({
        primaryProvider: "openai",
        primaryModel: KPI_SEMANTIC_CLASSIFICATION_LUNA_MODEL,
        fallbackModel: KPI_SEMANTIC_CLASSIFICATION_LUNA_MODEL,
        providerPolicy: {
          id: KPI_SEMANTIC_CLASSIFICATION_POLICY_ID,
          steps: [{
            provider: "openai",
            model: KPI_SEMANTIC_CLASSIFICATION_LUNA_MODEL,
            workflowConfiguration: {
              timeoutMs: 20_000,
              maxAttempts: 1,
              maxOutputTokens: 1_200,
              reasoning: { mode: "standard", effort: "low" },
              structuredOutput: { name: KPI_SEMANTIC_CLASSIFICATION_CONTRACT_ID, strict: true, schema: KPI_SEMANTIC_CLASSIFICATION_JSON_SCHEMA },
              store: false,
              stream: false
            }
          }]
        },
        systemPrompt: SYSTEM_PROMPT,
        userContent: [{ type: "text", text: JSON.stringify({ sourceLabel: label, category, definition }) }],
        maxOutputTokens: 1_200,
        settings: { ...settings, timeoutMs: Math.min(settings.timeoutMs, 20_000), maxRetries: 0 },
        validate: (value) => validateKpiSemanticClassification(value, label),
        logContext: { workflow: KPI_SEMANTIC_CLASSIFICATION_CONTRACT_ID, modelRoute: "kpi_semantics", executionPath: "kpi_lifecycle" }
      });
      proposal = generation.output;
    } catch {
      proposal = null;
    }
  }

  const acceptedProposal = proposal && proposal.confidence >= ACCEPTANCE_CONFIDENCE && proposal.desiredDirection !== "unknown" ? proposal : null;
  const values = acceptedProposal
    ? {
        canonical_name: acceptedProposal.canonicalName,
        display_name: acceptedProposal.displayName,
        original_source_label: label,
        aliases: acceptedProposal.aliases as Json,
        semantic_unit: acceptedProposal.unit,
        semantic_scale: acceptedProposal.scale,
        aggregation_basis: acceptedProposal.aggregationBasis,
        period_basis: acceptedProposal.periodBasis,
        desired_direction: acceptedProposal.desiredDirection,
        target_behavior: acceptedProposal.targetBehavior,
        ideal_value: acceptedProposal.theoreticalIdealValue,
        metric_role: acceptedProposal.metricRole,
        classification_source: "luna",
        classification_confidence: acceptedProposal.confidence,
        classification_version: KPI_SEMANTIC_VERSION,
        classification_rationale: acceptedProposal.rationale,
        classification_confirmed: false
      }
    : {
        canonical_name: deterministic.canonicalName,
        display_name: deterministic.displayName,
        original_source_label: deterministic.originalSourceLabel,
        aliases: [] as Json,
        semantic_unit: deterministic.unit,
        semantic_scale: deterministic.scale,
        aggregation_basis: null,
        period_basis: null,
        desired_direction: deterministic.desiredDirection,
        target_behavior: deterministic.targetBehavior,
        ideal_value: deterministic.idealValue,
        metric_role: deterministic.metricRole,
        classification_source: proposal ? "luna" : deterministic.classificationSource,
        classification_confidence: proposal?.confidence ?? deterministic.classificationConfidence,
        classification_version: KPI_SEMANTIC_VERSION,
        classification_rationale: proposal?.rationale ?? deterministic.rationale,
        classification_confirmed: false
      };

  if (existing.data) {
    await supabase.from("kpi_settings").update(values).eq("id", existing.data.id).eq("workspace_id", workspaceId);
  } else {
    await supabase.from("kpi_settings").insert({ workspace_id: workspaceId, kpi_name: label, category, created_by: userId, ...values });
  }
}
