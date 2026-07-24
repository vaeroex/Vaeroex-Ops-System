import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
  EXECUTIVE_KPI_ANALYSIS_CONTRACT_VERSION,
  EXECUTIVE_KPI_ANALYSIS_VALIDATOR_VERSION,
  type ExecutiveKpiAnalysisArtifact,
  type ExecutiveKpiAnalysisViewArtifact
} from "@/lib/ai/executive-kpi-analysis/contracts";
import type { Database, Json } from "@/lib/supabase/types";

const metricSchema = z.object({
  ordinal: z.number().int().positive(),
  stableKpiIds: z.array(z.string()),
  name: z.string(),
  directionality: z.enum(["higher_is_better", "lower_is_better", "exact_target", "neutral_contextual"]),
  trendDirection: z.enum(["up", "down", "flat", "insufficient_history"]),
  percentageChange: z.number().nullable(),
  observationCount: z.number().int().nonnegative(),
  freshness: z.enum(["current", "stale", "unavailable"]),
  latestObservedAt: z.string().nullable(),
  values: z.array(z.object({
    observedAt: z.string(),
    actualValue: z.number(),
    targetValue: z.number().nullable(),
    normalizedValue: z.number(),
    percentFromFirst: z.number().nullable()
  }).strict())
}).strict();
const relationshipSchema = z.object({
  leftOrdinal: z.number().int().positive(),
  rightOrdinal: z.number().int().positive(),
  status: z.enum(["observed_movement_only", "correlated", "statistically_meaningful", "not_established"]),
  movement: z.enum(["same_direction", "opposite_direction", "not_established"]),
  correlationCoefficient: z.number().nullable(),
  significanceThreshold: z.number().nullable(),
  causationEstablished: z.literal(false)
}).strict();
const factsSchema = z.object({
  timeframe: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  mode: z.enum(["actual", "percent", "normalized"]),
  confidenceLabel: z.string(),
  confidenceScore: z.number(),
  metrics: z.array(metricSchema),
  relationships: z.array(relationshipSchema),
  limitations: z.array(z.string()),
  deterministicFallback: z.array(z.string())
}).strict();
const citationSchema = z.object({
  citationId: z.number().int().positive(),
  sourceLabel: z.string(),
  sourceType: z.enum(["Uploaded evidence", "KPI record"]),
  metricOrdinals: z.array(z.number().int().positive()),
  recordedAt: z.string().nullable()
}).strict();
const analysisSchema = z.object({
  executive_summary: z.string(),
  significant_trends: z.array(z.object({ metric_ordinals: z.array(z.number()), statement: z.string() }).strict()),
  potential_kpi_relationships: z.array(z.object({
    metric_ordinals: z.array(z.number()),
    status: z.enum(["Observed movement", "Possible relationship", "Supported correlation", "Strong supported relationship", "No meaningful relationship detected"]),
    statement: z.string()
  }).strict()),
  possible_business_drivers: z.array(z.object({ metric_ordinals: z.array(z.number()), statement: z.string() }).strict()),
  leadership_considerations: z.array(z.string()),
  analysis_limitations: z.array(z.string())
}).strict();
const artifactSchema = z.object({
  contractId: z.literal(EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID),
  contractVersion: z.literal(EXECUTIVE_KPI_ANALYSIS_CONTRACT_VERSION),
  validatorVersion: z.literal(EXECUTIVE_KPI_ANALYSIS_VALIDATOR_VERSION),
  fingerprint: z.string().length(64),
  generatedAt: z.string(),
  analysis: analysisSchema,
  facts: factsSchema,
  citations: z.array(citationSchema),
  providerAttribution: z.object({
    provider: z.enum(["openai", "nvidia"]),
    model: z.string(),
    fallbackUsed: z.boolean(),
    providerPolicyId: z.string()
  }).strict()
}).strict();

function record(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

export function parseExecutiveKpiAnalysisArtifact(value: Json) {
  const parsed = artifactSchema.safeParse(value);
  return parsed.success ? parsed.data as ExecutiveKpiAnalysisArtifact : null;
}

export function executiveKpiAnalysisArtifactForView(artifact: ExecutiveKpiAnalysisArtifact): ExecutiveKpiAnalysisViewArtifact {
  return {
    contractId: artifact.contractId,
    contractVersion: artifact.contractVersion,
    validatorVersion: artifact.validatorVersion,
    fingerprint: artifact.fingerprint,
    generatedAt: artifact.generatedAt,
    analysis: artifact.analysis,
    facts: artifact.facts,
    citations: artifact.citations
  };
}

export async function findCurrentExecutiveKpiAnalysisArtifact({
  supabase,
  workspaceId,
  fingerprint
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  fingerprint: string;
}) {
  const { data, error } = await supabase
    .from("ai_agent_runs")
    .select("input_json,output_json,status")
    .eq("workspace_id", workspaceId)
    .eq("agent_type", EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID)
    .eq("status", "completed")
    .is("archived_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error("Executive KPI Analysis history is unavailable.");
  const artifact = (data || [])
    .filter((run) => record(run.input_json).fingerprint === fingerprint)
    .map((run) => parseExecutiveKpiAnalysisArtifact(run.output_json))
    .find((candidate): candidate is ExecutiveKpiAnalysisArtifact => Boolean(candidate)) || null;
  return artifact ? executiveKpiAnalysisArtifactForView(artifact) : null;
}
