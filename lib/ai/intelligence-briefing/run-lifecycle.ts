import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import type { Database, Json } from "@/lib/supabase/types";
import { INTELLIGENCE_BRIEFING_CONTRACT_ID, type IntelligenceBriefingArtifact } from "./contracts";
import { parseIntelligenceBriefingArtifact } from "./storage";

const uuid = z.string().uuid();
const authoritySchema = z.object({ workspaceId: uuid, userId: uuid, sessionId: uuid, readTicketId: uuid });
export type BriefingRunAuthority = z.infer<typeof authoritySchema>;
type Client = SupabaseClient<Database>;
type TransitionClient = {
  rpc(name: "complete_trusted_derived_run_v1" | "complete_trusted_derived_run_v2" | "fail_trusted_derived_run_v1", args: Record<string, Json>):
    PromiseLike<{ data: unknown; error: unknown }>;
};

/** Verify signed claims against the authenticated user; never decode a browser token. */
export async function verifiedBriefingSession(reader: Client, userId: string): Promise<string | null> {
  try {
    const { data, error } = await reader.auth.getClaims();
    const session = uuid.safeParse(data?.claims.session_id);
    return !error && data?.claims.sub === userId && session.success ? session.data : null;
  } catch { return null; }
}

async function transition(admin: Client, authority: BriefingRunAuthority, runId: string, artifact?: IntelligenceBriefingArtifact, sharedManifestId?:string) {
  if (!authoritySchema.safeParse(authority).success || !uuid.safeParse(runId).success || sharedManifestId!==undefined&&!uuid.safeParse(sharedManifestId).success) return false;
  try {
    const { data, error } = await (admin as unknown as TransitionClient).rpc(
      artifact ? sharedManifestId ? "complete_trusted_derived_run_v2" : "complete_trusted_derived_run_v1" : "fail_trusted_derived_run_v1",
      { p_workspace_id: authority.workspaceId, p_run_id: runId, p_actor_id: authority.userId,
        p_session_id: authority.sessionId, p_read_ticket_id: authority.readTicketId,
        p_agent_type: INTELLIGENCE_BRIEFING_CONTRACT_ID,
        ...(artifact ? { p_output_json: artifact as unknown as Json,...(sharedManifestId?{p_manifest_id:sharedManifestId}:{}) } : {}) }
    );
    return !error && data === runId;
  } catch { return false; }
}

export async function failIntelligenceBriefingRun(admin: Client, authority: BriefingRunAuthority, runId: string) {
  return transition(admin, authority, runId);
}

export type BriefingCompletion = { status: "completed"; artifact: IntelligenceBriefingArtifact }
  | { status: "failed" | "unavailable" };

/** No retry or direct-write fallback. Reconcile an unconfirmed completion using
 * the original reader and exact run before attempting the guarded failure path. */
export async function completeIntelligenceBriefingRun({ admin, reader, authority, runId, artifact, sharedManifestId }: {
  admin: Client; reader: Client; authority: BriefingRunAuthority; runId: string; artifact: IntelligenceBriefingArtifact; sharedManifestId?:string;
}): Promise<BriefingCompletion> {
  if (!authoritySchema.safeParse(authority).success || !uuid.safeParse(runId).success
    || artifact.workspaceId !== authority.workspaceId || artifact.contractId !== INTELLIGENCE_BRIEFING_CONTRACT_ID) return { status: "unavailable" };
  if (await transition(admin, authority, runId, artifact, sharedManifestId)) return { status: "completed", artifact };
  try {
    const { data: run, error } = await reader.from("ai_agent_runs")
      .select("id,workspace_id,created_by,agent_type,status,input_json,output_json,archived_at,deleted_at")
      .eq("id", runId).eq("workspace_id", authority.workspaceId).eq("created_by", authority.userId)
      .eq("agent_type", INTELLIGENCE_BRIEFING_CONTRACT_ID).maybeSingle();
    if (error || !run || run.id !== runId || run.workspace_id !== authority.workspaceId || run.created_by !== authority.userId
      || run.agent_type !== INTELLIGENCE_BRIEFING_CONTRACT_ID || run.archived_at || run.deleted_at) return { status: "unavailable" };
    const input = run.input_json && typeof run.input_json === "object" && !Array.isArray(run.input_json) ? run.input_json : {};
    if (input.workflow !== INTELLIGENCE_BRIEFING_CONTRACT_ID || input.google_sheets_read_ticket_id !== authority.readTicketId
      || input.generation_key !== artifact.generationKey || input.briefing_type !== artifact.briefingType) return { status: "unavailable" };
    if (run.status === "completed") {
      const saved = parseIntelligenceBriefingArtifact(run.output_json);
      return saved && evidenceEngineHash(saved) === evidenceEngineHash(artifact)
        ? { status: "completed", artifact: saved } : { status: "unavailable" };
    }
    if (run.status === "failed") return { status: "failed" };
    if (run.status === "processing" && await failIntelligenceBriefingRun(admin, authority, runId)) return { status: "failed" };
  } catch { /* Missing visibility or transport certainty cannot authorize another write. */ }
  return { status: "unavailable" };
}
