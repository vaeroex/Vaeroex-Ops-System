import { z } from "zod";

export const mappingTarget = z.object({
  workspaceId: z.string().uuid(),
  provider: z.enum(["xero", "harvest", "clockify", "toggl", "zoho-inventory", "katana", "loyverse", "zoho-books", "wix-orders"]),
  connectionId: z.string().uuid(),
});
export const mappingPreview = z.object({ incarnation_hash: z.string().regex(/^[a-f0-9]{64}$/), scope: z.string().min(1).max(100) });
const confirmation = mappingTarget.extend({ entityId: z.string().uuid(), incarnationHash: z.string().regex(/^[a-f0-9]{64}$/), confirmation: z.literal("confirm") });
type MappingAccess = { workspaceId: string; user: { id: string }; membership: { role: string; status: string; workspace_id: string; user_id: string | null }; supabase: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> } };
export function mappingOwner(access: MappingAccess, workspaceId: string): boolean {
  return access.workspaceId === workspaceId && access.membership.workspace_id === workspaceId
    && access.membership.user_id === access.user.id && access.membership.status === "active" && access.membership.role === "owner";
}
/** Authenticated client only. SQL independently binds the JWT/session, current
 * installation, workspace and active entity. Never accept actor IDs from a form. */
export async function confirmEvidenceMapping(access: MappingAccess, form: FormData, enabled: boolean): Promise<"saved" | "unavailable"> {
  if (!enabled) return "unavailable";
  const keys = ["workspaceId", "provider", "connectionId", "entityId", "incarnationHash", "confirmation"] as const;
  if (keys.some(key => form.getAll(key).length !== 1)) return "unavailable";
  const input = confirmation.safeParse(Object.fromEntries(keys.map(key => [key, form.get(key)])));
  if (!input.success || !mappingOwner(access, input.data.workspaceId)) return "unavailable";
  const p = input.data;
  try {
    const result = await access.supabase.rpc("confirm_legacy_evidence_mapping_v1", {
      p_workspace_id: access.workspaceId, p_provider: p.provider, p_connection_id: p.connectionId,
      p_business_entity_id: p.entityId, p_expected_incarnation_hash: p.incarnationHash,
    });
    return !result.error && z.string().uuid().safeParse(result.data).success ? "saved" : "unavailable";
  } catch { return "unavailable"; }
}
