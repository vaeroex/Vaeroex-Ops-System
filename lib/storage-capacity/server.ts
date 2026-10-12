import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/types";
import { StorageAccessError, type StorageAccess } from "./access";
import type { WorkspaceStorageUsage, StorageTrashPage } from "./contracts";

type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };
export async function storageRpc(client: SupabaseClient<Database>, name: string, args: Record<string, unknown>) {
  const { data, error } = await (client as unknown as RpcClient).rpc(name, args);
  if (error) {
    if (/capacity|limit_reached|file_slots_reached|storage_bytes_reached/.test(error.message)) throw new StorageAccessError(409, "This action exceeds this workspace’s available storage or file slots. Review Usage & Storage or buy capacity.");
    if (/historical_trash|purge_unavailable/.test(error.message)) throw new StorageAccessError(409, "This file cannot be permanently deleted. Historical deleted files remain protected during their recovery window.");
    if (/workspace_source_unavailable/.test(error.message)) throw new StorageAccessError(404, "The original file is missing, permanently deleted, or already pending permanent deletion, so it cannot be restored.");
    if (/missing|not_found/.test(error.message)) throw new StorageAccessError(404, "The file or upload could not be found in this workspace.");
    if (/expired/.test(error.message)) throw new StorageAccessError(409, "This upload reservation expired. Refresh and start again.");
    if (/permission|denied|unauthoriz|forbidden/.test(error.message)) throw new StorageAccessError(403, "You do not have permission for this storage action.");
    throw new StorageAccessError(503, "Storage could not confirm the change. Refresh before trying again.");
  }
  return data;
}

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const group = z.object({ bytes: count, files: count });
const file = z.object({ id: z.string().uuid(), displayName: z.string(), bytes: count,
  state: z.enum(["active", "archived", "trash", "historical_trash"]), deletedAt: z.string().nullable(),
  purgeAfter: z.string().nullable(), legacyProtected: z.boolean(), storageMissing: z.boolean(), deletionPending: z.boolean().optional() });
const usageSchema = z.object({ workspaceId: z.string().uuid(), includedBytes: count, includedFiles: count, paidPacks: count,
  allowanceBytes: count, allowanceFiles: count, usedBytes: count, usedFiles: count, reservedBytes: count, reservedFiles: count,
  availableBytes: count, availableFiles: count, active: group, archived: group, trash: group, historicalTrash: group,
  unlinkedBytes: count, missingFiles: count, measuredAt: z.string().nullable(), largestFiles: z.array(file),
  separateData: z.array(z.object({ label: z.string(), estimatedBytes: count.nullable(), records: count.nullable(), explanation: z.string().optional() })),
  reconciled: z.boolean().optional() });

export async function getWorkspaceStorageUsage(access: StorageAccess): Promise<WorkspaceStorageUsage> {
  const data = usageSchema.parse(storageCamelCase(await storageRpc(access.supabase, "workspace_storage_usage_v1", { p_workspace_id: access.workspaceId })));
  if (data.workspaceId !== access.workspaceId) throw new StorageAccessError(503, "Workspace usage could not be verified.");
  return data;
}

export async function getWorkspaceStorageTrash(access: StorageAccess, page: number): Promise<StorageTrashPage> {
  return z.object({ files: z.array(file), total: count, page: count, pageSize: count }).parse(
    storageCamelCase(await storageRpc(access.supabase, "workspace_storage_trash_v1", { p_workspace_id: access.workspaceId, p_page: page })));
}

function storageCamelCase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(storageCamelCase);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), storageCamelCase(child)]));
  return value;
}
