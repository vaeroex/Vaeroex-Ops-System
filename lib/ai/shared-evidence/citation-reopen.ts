import "server-only";
import { z } from "zod";
import { validateSharedMemoryProjection } from "./memory-eligibility";
import { requireSandboxInstallation } from "./sandbox-projection";

export const sharedCitationTarget = z.object({ workspaceId: z.string().uuid(),
  kind: z.enum(["report", "briefing_run", "vsi_exchange"]), id: z.string().uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().refine(t=>t.kind!=="report"||Boolean(t.revision));
type Target = z.infer<typeof sharedCitationTarget>;
type Reader = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export function sharedCitationHref(raw: Target) {
  const t=sharedCitationTarget.parse(raw);
  return `/app/sources/evidence/${t.kind}/${t.id}?workspace=${t.workspaceId}${t.revision?`&revision=${t.revision}`:""}` as const;
}
/** Reopen the exact saved revision, never substitute a latest record or list. */
export async function reopenSharedCitation(reader: Reader, target: Target) {
  const t=sharedCitationTarget.parse(target);
  const result=await reader.rpc(t.revision?"reopen_shared_evidence_artifact_v1":"reopen_shared_evidence_target_v1", { p_workspace_id:t.workspaceId,
    p_artifact_kind:t.kind,p_artifact_id:t.id,...(t.revision?{p_expected_revision:t.revision}:{}) });
  if(result.error) throw new Error("shared_citation_unavailable");
  const output=z.object({ stage:z.literal("revalidated_saved_evidence"),artifact_kind:z.literal(t.kind),artifact_id:z.literal(t.id),
    artifact_revision:t.revision?z.literal(t.revision):z.string().regex(/^[a-f0-9]{64}$/),projections:z.array(z.object({identity:z.record(z.unknown()),hash:z.string().regex(/^[a-f0-9]{64}$/),data:z.record(z.unknown())})).max(24) }).parse(result.data);
  return output.projections.filter(source=>{
    if(source.identity.kind!=="inherited_artifact") return true;
    // These are control-only ancestor proofs. The protected RPC already checked
    // their workspace, actor, immutable revision and original dependencies.
    z.object({artifact_kind:z.enum(["report","briefing_run","vsi_exchange","vsi_conversation_context"]),artifact_id:z.string().uuid(),revision:z.string().regex(/^[a-f0-9]{64}$/)}).parse(source.data);
    return false;
  }).map(source => {
    if(source.data.workspace_id !== t.workspaceId) throw new Error("shared_citation_workspace_mismatch");
    if(source.data.environment==='sandbox'||String(source.identity.kind).includes('sandbox')) {
      const installation=requireSandboxInstallation(source.data.installation_id);
      if(source.identity.environment!=='sandbox'||source.identity.installation_id!==installation) throw new Error('sandbox_citation_scope_denied');
    }
    if(source.data.provider==='file'||source.data.provider==='business_note') {
      const memory=validateSharedMemoryProjection(source.data,t.workspaceId);
      return { hash:source.hash,provider:String(source.data.provider),text:memory.text,sourceHref:memory.url,identity:source.identity };
    }
    // Deliberately omit admission snapshots and opaque read-ticket roots.
    const {eligibility:_eligibility,read_sources:_roots,...facts}=source.data;
    return {hash:source.hash,provider:String(source.data.provider),text:JSON.stringify(facts,null,2),sourceHref:null,identity:source.identity};
  });
}
