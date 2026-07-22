import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  EXECUTIVE_BRIEF_CONTRACT_ID,
  EXECUTIVE_BRIEF_CONTRACT_VERSION,
  EXECUTIVE_BRIEF_VALIDATOR_VERSION,
  type ExecutiveBriefArtifact,
  type ExecutiveBriefPackage,
  type ExecutiveBriefState,
  type ExecutiveBriefViewArtifact
} from "@/lib/ai/executive-brief/contracts";
import { EXECUTIVE_BRIEF_GPT56_POLICY_ID } from "@/lib/ai/providers/workflow-provider-policy";
import type { Database, Json } from "@/lib/supabase/types";

export const EXECUTIVE_BRIEF_RELEASE_CHANNELS = ["production", "preview", "development"] as const;
export type ExecutiveBriefReleaseChannel = (typeof EXECUTIVE_BRIEF_RELEASE_CHANNELS)[number];

const analysisSchema = z.object({
  executive_summary: z.string(),
  why_it_matters: z.string(),
  primary_concern: z.string().nullable(),
  positive_signal: z.string().nullable(),
  leadership_focus: z.string(),
  uncertainty: z.string(),
  provisional_hypothesis: z.string().nullable()
}).strict();

const materialChangeSchema = z.object({
  stableKey: z.string(),
  label: z.string(),
  fact: z.string(),
  direction: z.enum(["positive", "negative", "neutral"])
}).strict();

const factsSchema = z.object({
  available: z.boolean(),
  businessHealth: z.object({
    score: z.number().nullable(),
    status: z.string(),
    trajectory: z.string().nullable(),
    comparisonDelta: z.number().nullable()
  }).strict(),
  materialChanges: z.array(materialChangeSchema),
  confidence: z.enum(["High", "Medium", "Low"]),
  freshness: z.enum(["current", "stale", "unavailable"]),
  latestEvidenceAt: z.string().nullable(),
  independentSourceCount: z.number().int().nonnegative(),
  limitations: z.array(z.string()),
  deterministicReadout: z.array(z.string())
}).strict();

const signalSchema = z.object({
  ordinal: z.number().int().positive(),
  stableKey: z.string(),
  roles: z.array(z.enum(["primary_concern", "positive_signal", "leadership_focus", "context"])),
  classification: z.enum(["risk", "opportunity", "neutral"]),
  domain: z.string(),
  label: z.string(),
  approvedFact: z.string(),
  approvedLeadershipFocus: z.string().nullable(),
  coverageTerms: z.array(z.string()),
  citationIds: z.array(z.number().int().positive())
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
  contractId: z.literal(EXECUTIVE_BRIEF_CONTRACT_ID),
  contractVersion: z.literal(EXECUTIVE_BRIEF_CONTRACT_VERSION),
  validatorVersion: z.literal(EXECUTIVE_BRIEF_VALIDATOR_VERSION),
  fingerprint: z.string().length(64),
  generatedAt: z.string(),
  analysis: analysisSchema,
  facts: factsSchema,
  signals: z.array(signalSchema),
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

function isExecutiveBriefReleaseChannel(value: unknown): value is ExecutiveBriefReleaseChannel {
  return typeof value === "string" && EXECUTIVE_BRIEF_RELEASE_CHANNELS.includes(value as ExecutiveBriefReleaseChannel);
}

export function resolveExecutiveBriefReleaseChannel(): ExecutiveBriefReleaseChannel {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "development";
}

export function classifyExecutiveBriefRunReleaseChannel(run: Pick<RunRow, "input_json" | "output_json">): ExecutiveBriefReleaseChannel | null {
  const input = record(run.input_json);
  if ("release_channel" in input) {
    return isExecutiveBriefReleaseChannel(input.release_channel) ? input.release_channel : null;
  }

  const output = record(run.output_json);
  const attribution = record(output.providerAttribution ?? null);
  return attribution.providerPolicyId === EXECUTIVE_BRIEF_GPT56_POLICY_ID ? "preview" : null;
}

function runsForReleaseChannel(runs: RunRow[], releaseChannel: ExecutiveBriefReleaseChannel) {
  return runs.filter((run) => classifyExecutiveBriefRunReleaseChannel(run) === releaseChannel);
}

export function parseExecutiveBriefArtifact(value: Json) {
  const parsed = artifactSchema.safeParse(value);
  return parsed.success ? parsed.data as ExecutiveBriefArtifact : null;
}

export function executiveBriefArtifactForView(artifact: ExecutiveBriefArtifact): ExecutiveBriefViewArtifact {
  return {
    contractId: artifact.contractId,
    contractVersion: artifact.contractVersion,
    validatorVersion: artifact.validatorVersion,
    fingerprint: artifact.fingerprint,
    generatedAt: artifact.generatedAt,
    analysis: artifact.analysis,
    facts: artifact.facts,
    signals: artifact.signals,
    citations: artifact.citations
  };
}

async function loadRuns(supabase: SupabaseClient<Database>, workspaceId: string) {
  const { data, error } = await supabase
    .from("ai_agent_runs")
    .select("id,status,input_json,output_json,error_message,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("agent_type", EXECUTIVE_BRIEF_CONTRACT_ID)
    .is("archived_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error("Executive Brief history is unavailable.");
  return (data || []) as RunRow[];
}

export async function findCurrentExecutiveBriefArtifact({
  supabase,
  workspaceId,
  fingerprint,
  releaseChannel
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  fingerprint: string;
  releaseChannel: ExecutiveBriefReleaseChannel;
}) {
  const runs = await loadRuns(supabase, workspaceId);
  const artifact = runsForReleaseChannel(runs, releaseChannel)
    .filter((run) => run.status === "completed" && runFingerprint(run) === fingerprint)
    .map((run) => parseExecutiveBriefArtifact(run.output_json))
    .find((candidate): candidate is ExecutiveBriefArtifact => Boolean(candidate)) || null;
  return artifact ? executiveBriefArtifactForView(artifact) : null;
}

export async function loadExecutiveBriefState({
  supabase,
  workspaceId,
  analysisPackage,
  requestTokenAvailable,
  releaseChannel
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  analysisPackage: ExecutiveBriefPackage;
  requestTokenAvailable: boolean;
  releaseChannel: ExecutiveBriefReleaseChannel;
}): Promise<ExecutiveBriefState> {
  let runs: RunRow[];
  try {
    runs = await loadRuns(supabase, workspaceId);
  } catch {
    return {
      status: "unavailable",
      artifact: null,
      message: "Executive facts are available, but the saved brief is temporarily unavailable."
    };
  }
  return resolveExecutiveBriefStateFromRuns({ runs, analysisPackage, requestTokenAvailable, releaseChannel });
}

export function resolveExecutiveBriefStateFromRuns({
  runs,
  analysisPackage,
  requestTokenAvailable,
  releaseChannel
}: {
  runs: RunRow[];
  analysisPackage: Pick<ExecutiveBriefPackage, "fingerprint" | "facts">;
  requestTokenAvailable: boolean;
  releaseChannel: ExecutiveBriefReleaseChannel;
}): ExecutiveBriefState {
  const eligibleRuns = runsForReleaseChannel(runs, releaseChannel);
  const completed = eligibleRuns
    .filter((run) => run.status === "completed")
    .flatMap((run) => {
      const artifact = parseExecutiveBriefArtifact(run.output_json);
      return artifact ? [{ run, artifact }] : [];
    });
  const current = completed.find(({ run }) => runFingerprint(run) === analysisPackage.fingerprint);
  if (current) return { status: "current", artifact: executiveBriefArtifactForView(current.artifact), message: null };

  if (!analysisPackage.facts.available) {
    return {
      status: "insufficient_evidence",
      artifact: null,
      message: "More eligible original evidence is needed before Vaeroex can prepare an Executive Brief safely."
    };
  }

  const stale = completed[0]?.artifact ? executiveBriefArtifactForView(completed[0].artifact) : null;
  if (stale) {
    return {
      status: "stale",
      artifact: stale,
      message: "The last brief is based on an earlier eligible evidence set. Current business facts remain up to date."
    };
  }

  const failedCurrent = eligibleRuns.find((run) => run.status === "failed" && runFingerprint(run) === analysisPackage.fingerprint);
  if (failedCurrent) {
    return {
      status: "failed",
      artifact: null,
      message: "Executive facts are available, but the brief could not be prepared. Please try again."
    };
  }

  if (!requestTokenAvailable) {
    return {
      status: "unavailable",
      artifact: null,
      message: "Executive Brief synthesis is not available in this environment. The underlying facts remain available."
    };
  }

  return { status: "available", artifact: null, message: null };
}
