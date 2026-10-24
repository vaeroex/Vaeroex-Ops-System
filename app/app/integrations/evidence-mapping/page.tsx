import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { evidenceMappingSetupEnabled } from "@/lib/ai/shared-evidence/mapping-gate";
import { mappingOwner, mappingPreview, mappingTarget } from "@/lib/ai/shared-evidence/mapping";
import { confirmMappingAction } from "./actions";

export default async function EvidenceMappingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!evidenceMappingSetupEnabled()) notFound();
  const access = await requireWorkspaceAccess();
  if (!mappingOwner(access, access.workspaceId)) notFound();
  const query = await searchParams;
  if (query.result === "saved" || query.result === "unavailable") return <main className="space-y-4 p-6">
    <h1 className="text-xl font-semibold">Business correspondence</h1>
    <p role="status">{query.result === "saved" ? "Your selection was saved. Vaeroex can use this correspondence when checking eligible stored evidence." : "The selection could not be confirmed. Reopen the connection and review its current details before trying again."}</p>
    <Link href="/app/integrations" className="underline">Back to plug-ins</Link>
  </main>;
  const target = mappingTarget.safeParse(query);
  if (!target.success || target.data.workspaceId !== access.workspaceId) notFound();
  const t = target.data;
  const [preview, entities] = await Promise.all([
    access.supabase.rpc("preview_legacy_evidence_mapping_v1" as never, { p_workspace_id: access.workspaceId, p_provider: t.provider, p_connection_id: t.connectionId } as never),
    access.supabase.from("business_entities").select("id,display_name").eq("workspace_id", access.workspaceId).eq("status", "active").order("display_name"),
  ]);
  const state = mappingPreview.safeParse(preview.data);
  if (preview.error || entities.error || !state.success || !entities.data?.length) return <main className="space-y-4 p-6"><h1 className="text-xl font-semibold">Business correspondence unavailable</h1><p>A current connection and an existing active business entity are required. No selection was saved.</p><Link href="/app/integrations" className="underline">Back to plug-ins</Link></main>;
  return <main className="mx-auto max-w-2xl space-y-5 p-6">
    <h1 className="text-xl font-semibold">Confirm which business this connection represents</h1>
    <p>Select the existing business entity that this {t.provider} account represents. Vaeroex uses your confirmation to compare eligible stored evidence across plug-ins. Similar account names do not establish a match.</p>
    <dl className="space-y-2 text-sm"><dt>Workspace</dt><dd>{access.workspace.name}</dd><dt>Connection</dt><dd className="break-all">{t.connectionId}</dd><dt>Evidence scope</dt><dd>{state.data.scope.replaceAll("_", " ")}</dd></dl>
    <details className="text-sm"><summary>Connection version</summary><p className="break-all">{state.data.incarnation_hash}</p></details>
    <form action={confirmMappingAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={access.workspaceId}/><input type="hidden" name="provider" value={t.provider}/><input type="hidden" name="connectionId" value={t.connectionId}/><input type="hidden" name="incarnationHash" value={state.data.incarnation_hash}/>
      <label className="block space-y-2"><span>Business entity</span><select name="entityId" required defaultValue="" className="block min-h-11 w-full rounded border p-2"><option value="" disabled>Select a business entity</option>{entities.data.map(entity => <option key={entity.id} value={entity.id}>{entity.display_name} ({entity.id})</option>)}</select></label>
      <label className="flex gap-2"><input type="checkbox" name="confirmation" value="confirm" required/><span>I confirm that this connection represents the selected business entity.</span></label>
      <p className="text-sm">Changing this selection invalidates evidence that relied on the previous correspondence. It does not import data or establish complete periods, matching transactions, or compatible units.</p>
      <button type="submit" className="min-h-11 rounded border px-4 py-2 font-semibold">Confirm correspondence</button>
    </form><Link href="/app/integrations" className="underline">Cancel</Link>
  </main>;
}
