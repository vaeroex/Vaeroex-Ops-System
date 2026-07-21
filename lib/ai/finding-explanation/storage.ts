import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  FINDING_EXPLANATION_CONTRACT_ID,
  FINDING_EXPLANATION_CONTRACT_VERSION,
  FINDING_EXPLANATION_VALIDATOR_VERSION,
  type FindingExplanationArtifact,
  type FindingExplanationViewArtifact
} from "@/lib/ai/finding-explanation/contracts";
import type { Database, Json } from "@/lib/supabase/types";

const factsSchema = z.object({
  findingKey: z.string(),
  findingType: z.string(),
  title: z.string(),
  priority: z.enum(["High", "Medium", "Low"]),
  confidence: z.enum(["High", "Medium", "Low"]),
  timePeriod: z.string(),
  approvedDevelopment: z.string(),
  approvedEvidenceBasis: z.string(),
  approvedLeadershipRelevance: z.string(),
  approvedInvestigationNext: z.string(),
  approvedLimitations: z.array(z.string()),
  freshness: z.enum(["current", "stale", "unavailable"]),
  independentSourceCount: z.number().int().nonnegative()
}).strict();

const artifactSchema = z.object({
  contractId: z.literal(FINDING_EXPLANATION_CONTRACT_ID),
  contractVersion: z.literal(FINDING_EXPLANATION_CONTRACT_VERSION),
  validatorVersion: z.literal(FINDING_EXPLANATION_VALIDATOR_VERSION),
  fingerprint: z.string().length(64),
  generatedAt: z.string(),
  analysis: z.object({
    what_happened: z.string(),
    why_evidence_suggests: z.string(),
    why_leadership_should_care: z.string(),
    investigate_next: z.string(),
    what_evidence_does_not_prove: z.string()
  }).strict(),
  facts: factsSchema,
  citations: z.array(z.object({
    citationId: z.number().int().positive(),
    title: z.string(),
    sourceLabel: z.string(),
    sourceType: z.string(),
    excerpt: z.string(),
    recordedAt: z.string().nullable()
  }).strict()),
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

export function parseFindingExplanationArtifact(value: Json) {
  const parsed = artifactSchema.safeParse(value);
  return parsed.success ? parsed.data as FindingExplanationArtifact : null;
}

export function findingExplanationArtifactForView(artifact: FindingExplanationArtifact): FindingExplanationViewArtifact {
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

export async function findCurrentFindingExplanationArtifact({
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
    .eq("agent_type", FINDING_EXPLANATION_CONTRACT_ID)
    .eq("status", "completed")
    .is("archived_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error("Finding explanation history is unavailable.");
  const artifact = (data || [])
    .filter((run) => record(run.input_json).fingerprint === fingerprint)
    .map((run) => parseFindingExplanationArtifact(run.output_json))
    .find((candidate): candidate is FindingExplanationArtifact => Boolean(candidate)) || null;
  return artifact ? findingExplanationArtifactForView(artifact) : null;
}
