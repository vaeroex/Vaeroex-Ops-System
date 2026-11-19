import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { qualificationCitationScope, qualificationHash, assertQualificationSources } from "./qualification";
import { reopenSharedCitation, sharedCitationTarget } from "@/lib/ai/shared-evidence/citation-reopen";
import type { SharedCitationReadTrace } from "@/lib/supabase/citation-read-trace";

/** A qualification manifest cannot authorize reading another conversation. The
 * saved exchange is read through the signed-in client's normal RLS before the
 * ordinary source-reopen RPC rechecks the exact artifact and its dependencies.
 * No admin client, invented session or released global gate is used here. */
export async function reopenQualificationCitation(reader: SupabaseClient,
  input: { actorUserId: string; workspaceId: string; target: z.infer<typeof sharedCitationTarget> },
  trace?: SharedCitationReadTrace) {
  const slot = qualificationCitationScope(input);
  if (!slot || input.target.kind !== "vsi_exchange" || input.target.workspaceId !== input.workspaceId)
    throw new Error("qualification_citation_scope");
  const result = await reader.from("vsi_exchanges").select("id,conversation_id,user_message")
    .eq("id", input.target.id).eq("workspace_id", input.workspaceId).eq("actor_user_id", input.actorUserId)
    .eq("conversation_id", slot.conversationId).abortSignal(AbortSignal.timeout(10_000)).single();
  const saved = z.object({ id: z.literal(input.target.id), conversation_id: z.literal(slot.conversationId),
    user_message: z.string().min(1).max(8000) }).safeParse(result.data);
  if (result.error || !saved.success || qualificationHash(saved.data.user_message) !== slot.questionHash)
    throw new Error("qualification_citation_exchange");
  if (!qualificationCitationScope(input)) throw new Error("qualification_citation_scope");
  const sources = await reopenSharedCitation(reader as unknown as Parameters<typeof reopenSharedCitation>[0], input.target, trace);
  // Recheck the current manifest/expiry and exact source set after I/O. The page
  // cannot reveal another valid source just because the same owner can read it.
  if (!qualificationCitationScope(input)) throw new Error("qualification_citation_scope");
  assertQualificationSources({ actorUserId: input.actorUserId, workspaceId: input.workspaceId,
    conversationId: slot.conversationId, question: saved.data.user_message }, sources);
  return sources;
}
