import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
  type BusinessHealthExplanationViewArtifact
} from "@/lib/ai/business-health-explanation/contracts";
import {
  businessHealthArtifactForView,
  parseBusinessHealthExplanationArtifact
} from "@/lib/ai/business-health-explanation/storage";
import type { Database, Json } from "@/lib/supabase/types";

type GenerationClaimResult =
  | { status: "claimed"; runId: string }
  | { status: "completed"; artifact: BusinessHealthExplanationViewArtifact }
  | { status: "processing" }
  | { status: "hidden_completed" }
  | { status: "failed_closed" };

function record(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

export async function claimBusinessHealthGeneration({
  admin,
  workspaceId,
  userId,
  fingerprint,
  generationPolicyVersion,
  inputJson
}: {
  admin: SupabaseClient<Database>;
  workspaceId: string;
  userId: string;
  fingerprint: string;
  generationPolicyVersion: string;
  inputJson: Json;
}): Promise<GenerationClaimResult> {
  const { data: inserted, error: insertError } = await admin
    .from("ai_agent_runs")
    .insert({
      workspace_id: workspaceId,
      agent_type: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
      input_json: inputJson,
      output_json: {},
      status: "processing",
      created_by: userId
    })
    .select("id")
    .maybeSingle();

  if (!insertError && inserted?.id) return { status: "claimed", runId: inserted.id };
  if (insertError?.code !== "23505") return { status: "failed_closed" };

  const { data, error } = await admin
    .from("ai_agent_runs")
    .select("id,status,input_json,output_json,archived_at,deleted_at")
    .eq("workspace_id", workspaceId)
    .eq("agent_type", BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID)
    .contains("input_json", {
      fingerprint,
      generation_policy_version: generationPolicyVersion
    })
    .in("status", ["processing", "completed"])
    .limit(2);

  if (error || !data || data.length !== 1) return { status: "failed_closed" };
  const run = data[0];
  const input = record(run.input_json);
  if (
    input.fingerprint !== fingerprint
    || input.generation_policy_version !== generationPolicyVersion
  ) {
    return { status: "failed_closed" };
  }
  if (run.status === "processing") return { status: "processing" };
  if (run.status !== "completed") return { status: "failed_closed" };
  if (run.archived_at || run.deleted_at) return { status: "hidden_completed" };

  const artifact = parseBusinessHealthExplanationArtifact(run.output_json);
  if (!artifact || artifact.fingerprint !== fingerprint) return { status: "failed_closed" };
  return { status: "completed", artifact: businessHealthArtifactForView(artifact) };
}
