import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  BusinessHealthAnalysisState,
  BusinessHealthExplanationArtifact,
  BusinessHealthExplanationPackage,
  BusinessHealthExplanationViewArtifact
} from "@/lib/ai/business-health-explanation/contracts";
import {
  BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
  BUSINESS_HEALTH_EXPLANATION_CONTRACT_VERSION,
  BUSINESS_HEALTH_EXPLANATION_VALIDATOR_VERSION
} from "@/lib/ai/business-health-explanation/contracts";
import type { Database, Json } from "@/lib/supabase/types";

const analysisSchema = z.object({
  executive_interpretation: z.string(),
  why_it_matters: z.string(),
  leadership_consideration: z.string(),
  provisional_hypothesis: z.string().nullable()
}).strict();

const driverSchema = z.object({
  kind: z.enum(["risk", "opportunity"]),
  label: z.string(),
  fact: z.string(),
  scoreImpact: z.number(),
  citationIds: z.array(z.number()),
  limitation: z.string().nullable()
}).strict();

const factsSchema = z.object({
  available: z.boolean(),
  score: z.number().nullable(),
  status: z.string(),
  trajectory: z.string().nullable(),
  comparison: z.string(),
  comparisonDelta: z.number().nullable(),
  dataQualityBase: z.number(),
  riskPenalty: z.number(),
  opportunityAdjustment: z.number(),
  confidence: z.enum(["High", "Medium", "Low"]),
  freshness: z.enum(["current", "stale", "unavailable"]),
  latestEvidenceAt: z.string().nullable(),
  deterministicSummary: z.string(),
  drivers: z.array(driverSchema),
  limitations: z.array(z.string())
}).strict();

const citationSchema = z.object({
  citationId: z.number().int().positive(),
  title: z.string(),
  sourceLabel: z.string(),
  sourceType: z.string(),
  excerpt: z.string(),
  recordedAt: z.string().nullable()
}).strict();

const artifactSchema = z.object({
  contractId: z.literal(BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID),
  contractVersion: z.literal(BUSINESS_HEALTH_EXPLANATION_CONTRACT_VERSION),
  validatorVersion: z.literal(BUSINESS_HEALTH_EXPLANATION_VALIDATOR_VERSION),
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

type RunRow = Pick<
  Database["public"]["Tables"]["ai_agent_runs"]["Row"],
  "id" | "status" | "input_json" | "output_json" | "error_message" | "created_at" | "updated_at"
>;

function record(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function runFingerprint(run: RunRow) {
  const input = record(run.input_json);
  return typeof input.fingerprint === "string" ? input.fingerprint : null;
}

export function parseBusinessHealthExplanationArtifact(value: Json) {
  const parsed = artifactSchema.safeParse(value);
  return parsed.success ? parsed.data as BusinessHealthExplanationArtifact : null;
}

export function businessHealthArtifactForView(
  artifact: BusinessHealthExplanationArtifact
): BusinessHealthExplanationViewArtifact {
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

async function loadRuns(supabase: SupabaseClient<Database>, workspaceId: string) {
  const { data, error } = await supabase
    .from("ai_agent_runs")
    .select("id,status,input_json,output_json,error_message,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("agent_type", BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID)
    .is("archived_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error("Business Health analysis history is unavailable.");
  return (data || []) as RunRow[];
}

export async function findCurrentBusinessHealthExplanationArtifact({
  supabase,
  workspaceId,
  fingerprint
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  fingerprint: string;
}) {
  const runs = await loadRuns(supabase, workspaceId);
  const artifact = runs
    .filter((run) => run.status === "completed" && runFingerprint(run) === fingerprint)
    .map((run) => parseBusinessHealthExplanationArtifact(run.output_json))
    .find((artifact): artifact is BusinessHealthExplanationArtifact => Boolean(artifact)) || null;
  return artifact ? businessHealthArtifactForView(artifact) : null;
}

export async function loadBusinessHealthAnalysisState({
  supabase,
  workspaceId,
  analysisPackage,
  requestTokenAvailable
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  analysisPackage: BusinessHealthExplanationPackage;
  requestTokenAvailable: boolean;
}): Promise<BusinessHealthAnalysisState> {
  let runs: RunRow[];
  try {
    runs = await loadRuns(supabase, workspaceId);
  } catch {
    return {
      status: "unavailable",
      artifact: null,
      message: "Business Health facts are available, but saved analysis is temporarily unavailable."
    };
  }

  return resolveBusinessHealthAnalysisStateFromRuns({
    runs,
    analysisPackage,
    requestTokenAvailable
  });
}

export function resolveBusinessHealthAnalysisStateFromRuns({
  runs,
  analysisPackage,
  requestTokenAvailable
}: {
  runs: RunRow[];
  analysisPackage: BusinessHealthExplanationPackage;
  requestTokenAvailable: boolean;
}): BusinessHealthAnalysisState {
  const completed = runs
    .filter((run) => run.status === "completed")
    .flatMap((run) => {
      const artifact = parseBusinessHealthExplanationArtifact(run.output_json);
      return artifact ? [{ run, artifact }] : [];
    });
  const current = completed.find(({ run }) => runFingerprint(run) === analysisPackage.fingerprint);
  if (current) return { status: "current", artifact: businessHealthArtifactForView(current.artifact), message: null };

  if (!analysisPackage.facts.available) {
    return {
      status: "insufficient_evidence",
      artifact: null,
      message: "More eligible original evidence is needed before Vaeroex can synthesize this score safely."
    };
  }

  const stale = completed[0]?.artifact ? businessHealthArtifactForView(completed[0].artifact) : null;
  if (stale) {
    return {
      status: "stale",
      artifact: stale,
      message: "The last analysis is based on an earlier eligible evidence set. Current Business Health facts remain up to date."
    };
  }

  const failedCurrent = runs.find((run) => run.status === "failed" && runFingerprint(run) === analysisPackage.fingerprint);
  if (failedCurrent) {
    return {
      status: "failed",
      artifact: null,
      message: "Business Health facts are available, but the analysis could not be prepared. Please try again."
    };
  }

  if (!requestTokenAvailable) {
    return {
      status: "unavailable",
      artifact: null,
      message: "Business Health analysis is temporarily unavailable. The underlying score and drivers remain available."
    };
  }

  return { status: "available", artifact: null, message: null };
}
