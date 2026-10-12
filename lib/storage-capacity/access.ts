import "server-only";

import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

export class StorageAccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function requireStorageAccess(options: { edit?: boolean; owner?: boolean; allowExpired?: boolean } = {}) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new StorageAccessError(503, "Storage is temporarily unavailable.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new StorageAccessError(401, "Sign in to manage workspace storage.");
  const context = await getWorkspaceContext(undefined, { supabase, user });
  const { activeWorkspace: workspace, membership } = context;
  if (!workspace || !membership || membership.workspace_id !== workspace.id || membership.status !== "active") {
    throw new StorageAccessError(403, "An active workspace membership is required.");
  }
  if (options.owner && membership.role !== "owner") throw new StorageAccessError(403, "Only the workspace owner can buy or manage capacity.");
  if (options.edit && !["owner", "admin", "manager", "staff"].includes(membership.role)) throw new StorageAccessError(403, "You do not have permission to upload files.");
  if (!options.allowExpired) {
    const subscription = await getSubscriptionStatus({ supabase, userId: user.id, email: user.email, workspaceId: workspace.id });
    if (!subscription.allowed) throw new StorageAccessError(402, "An active workspace subscription is required for new uploads.");
  }
  return { supabase, user, workspaceId: workspace.id, membership, workspace, context };
}

export type StorageAccess = Awaited<ReturnType<typeof requireStorageAccess>>;

export function assertStorageWorkspace(access: StorageAccess, workspaceId: string) {
  if (access.workspaceId !== workspaceId) throw new StorageAccessError(409, "Your workspace changed. Reload this page before continuing.");
}

export function assertStorageOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") || new URL(request.url).host;
  let parsed: URL | null = null;
  try { parsed = origin ? new URL(origin) : null; } catch { /* Fail closed below. */ }
  // Next may construct request.url with its internal bind hostname. The Host
  // delivered by the browser is the public authority; do not trust a forwarded
  // host supplied by an arbitrary client or accept a path-bearing Origin.
  if (!parsed || parsed.origin !== origin || parsed.host !== host || !["http:", "https:"].includes(parsed.protocol)) {
    throw new StorageAccessError(403, "This request did not come from Vaeroex.");
  }
}

export async function storageJson(request: Request, maxBytes = 4096): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new StorageAccessError(415, "Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new StorageAccessError(400, "Missing request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new StorageAccessError(413, "Request is too large."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof StorageAccessError) throw error;
    throw new StorageAccessError(400, "Invalid request.");
  } finally { reader.releaseLock(); }
}

export function storageErrorResponse(error: unknown) {
  return Response.json({ error: error instanceof StorageAccessError ? error.message : "Storage could not confirm this request. Refresh before trying again." },
    { status: error instanceof StorageAccessError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
}
