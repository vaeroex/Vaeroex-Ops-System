import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INTELLIGENCE_BRIEFING_CONTRACT_ID,
  type IntelligenceBriefingType
} from "@/lib/ai/intelligence-briefing/contracts";
import {
  parseIntelligenceBriefingArtifact,
  type CurrentIntelligenceBriefing
} from "@/lib/ai/intelligence-briefing/storage";
import type { Database, Json } from "@/lib/supabase/types";

export type IntelligenceBriefingGenerationClaim =
  | { status: "claimed"; runId: string }
  | { status: "completed"; current: CurrentIntelligenceBriefing }
  | { status: "processing" }
  | { status: "hidden_completed" }
  | { status: "failed_closed" };

function record(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

export async function claimIntelligenceBriefingGeneration({
  admin,
  workspaceId,
  userId,
  briefingType,
  generationKey,
  inputJson
}: {
  admin: SupabaseClient<Database>;
  workspaceId: string;
  userId: string;
  briefingType: IntelligenceBriefingType;
  generationKey: string;
  inputJson: Json;
}): Promise<IntelligenceBriefingGenerationClaim> {
  const { data: inserted, error: insertError } = await admin
    .from("ai_agent_runs")
    .insert({
      workspace_id: workspaceId,
      agent_type: INTELLIGENCE_BRIEFING_CONTRACT_ID,
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
    .eq("agent_type", INTELLIGENCE_BRIEFING_CONTRACT_ID)
    .contains("input_json", { briefing_type: briefingType, generation_key: generationKey })
    .in("status", ["processing", "completed"])
    .limit(2);
  if (error || !data || data.length !== 1) return { status: "failed_closed" };
  const run = data[0];
  const input = record(run.input_json);
  if (input.briefing_type !== briefingType || input.generation_key !== generationKey) return { status: "failed_closed" };
  if (run.status === "processing") return { status: "processing" };
  if (run.status !== "completed") return { status: "failed_closed" };
  if (run.archived_at || run.deleted_at) return { status: "hidden_completed" };
  const artifact = parseIntelligenceBriefingArtifact(run.output_json);
  if (!artifact || artifact.workspaceId !== workspaceId || artifact.briefingType !== briefingType || artifact.generationKey !== generationKey) {
    return { status: "failed_closed" };
  }
  return { status: "completed", current: { runId: run.id, artifact } };
}
