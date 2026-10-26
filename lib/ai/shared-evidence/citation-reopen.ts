import "server-only";
import { z } from "zod";
import { validateSharedMemoryProjection } from "./memory-eligibility";
import { SharedCitationFailure, sharedCitationRpcFailure } from "./citation-diagnostics";
import type { SharedCitationReadTrace } from "@/lib/supabase/citation-read-trace";

export const sharedCitationTarget = z.object({ workspaceId: z.string().uuid(),
  kind: z.enum(["report", "briefing_run", "vsi_exchange"]), id: z.string().uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().refine(t=>t.kind!=="report"||Boolean(t.revision));
type Target = z.infer<typeof sharedCitationTarget>;
type CitationResult = { data: unknown; error: unknown; status?: number };
type CitationRequest = PromiseLike<CitationResult> & { abortSignal?(signal: AbortSignal): PromiseLike<CitationResult> };
type Reader = { rpc(name: string, args: Record<string, unknown>): CitationRequest };
async function readCitationWithDeadline(request: CitationRequest, started: number, trace?: SharedCitationReadTrace): Promise<CitationResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let deadlineFailure: SharedCitationFailure | undefined;
  try {
    const response = request.abortSignal?.(controller.signal) ?? request;
    // End the protected page's wait even if a transport does not honor abort.
    const result=await Promise.race([response, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        trace?.finish("deadline");
        deadlineFailure=new SharedCitationFailure("rpc_read", "read_deadline_exceeded", started);
        reject(deadlineFailure);
        controller.abort();
      }, 10_000);
    })]);
    if(deadlineFailure) throw deadlineFailure;
    trace?.clientComplete();
    return result;
  } catch (error) {
    if(deadlineFailure) throw deadlineFailure;
    if (error instanceof SharedCitationFailure) throw error;
    throw new SharedCitationFailure("rpc_read", "request_failed", started);
  } finally {
    clearTimeout(timeout);
  }
}
export function sharedCitationHref(raw: Target) {
  const t=sharedCitationTarget.parse(raw);
  return `/app/sources/evidence/${t.kind}/${t.id}?workspace=${t.workspaceId}${t.revision?`&revision=${t.revision}`:""}` as const;
}
/** Reopen the exact saved revision, never substitute a latest record or list. */
export async function reopenSharedCitation(reader: Reader, target: Target, trace?: SharedCitationReadTrace) {
  const t=sharedCitationTarget.parse(target);
  const started=performance.now();
  trace?.begin();
  let request:CitationRequest;
  try { request=reader.rpc(t.revision?"reopen_shared_evidence_artifact_v1":"reopen_shared_evidence_target_v1", { p_workspace_id:t.workspaceId,
    p_artifact_kind:t.kind,p_artifact_id:t.id,...(t.revision?{p_expected_revision:t.revision}:{}) }); }
  catch { throw new SharedCitationFailure("rpc_start","request_creation_failed",started); }
  const result=await readCitationWithDeadline(request,started,trace);
  if(!result||typeof result!=="object") throw new SharedCitationFailure("envelope","response_shape_invalid",started);
  if(result.error) throw sharedCitationRpcFailure(result.error,result.status,started);
  const parsed=z.object({ stage:z.literal("revalidated_saved_evidence"),artifact_kind:z.literal(t.kind),artifact_id:z.literal(t.id),
    artifact_revision:t.revision?z.literal(t.revision):z.string().regex(/^[a-f0-9]{64}$/),projections:z.array(z.object({identity:z.record(z.unknown()),hash:z.string().regex(/^[a-f0-9]{64}$/),data:z.record(z.unknown())})).max(24) }).safeParse(result.data);
  if(!parsed.success) throw new SharedCitationFailure("envelope","response_shape_invalid",started);
  return parsed.data.projections.filter(source=>{
    if(source.identity.kind!=="inherited_artifact") return true;
    // These are control-only ancestor proofs. The protected RPC already checked
    // their workspace, actor, immutable revision and original dependencies.
    const ancestor=z.object({artifact_kind:z.enum(["report","briefing_run","vsi_exchange","vsi_conversation_context"]),artifact_id:z.string().uuid(),revision:z.string().regex(/^[a-f0-9]{64}$/)}).safeParse(source.data);
    if(!ancestor.success) throw new SharedCitationFailure("projection","ancestor_shape_invalid",started);
    return false;
  }).map(source => {
    if(source.data.workspace_id !== t.workspaceId) throw new SharedCitationFailure("projection","workspace_mismatch",started);
    if(source.data.provider==='file'||source.data.provider==='business_note') {
      let memory:ReturnType<typeof validateSharedMemoryProjection>;
      try { memory=validateSharedMemoryProjection(source.data,t.workspaceId); }
      catch { throw new SharedCitationFailure("projection","memory_projection_invalid",started); }
      return { hash:source.hash,provider:String(source.data.provider),text:memory.text,sourceHref:memory.url,identity:source.identity };
    }
    // Deliberately omit admission snapshots and opaque read-ticket roots.
    const {eligibility:_eligibility,read_sources:_roots,...facts}=source.data;
    return {hash:source.hash,provider:String(source.data.provider),text:JSON.stringify(facts,null,2),sourceHref:null,identity:source.identity};
  });
}
