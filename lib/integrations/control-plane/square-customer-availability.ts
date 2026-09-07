import "server-only";

import {
  createSquareCustomerHandlers,
  squareCustomerConnectionsUnavailableResponse,
  squareLocalQualificationEnvironmentAllowed,
  type SquareCustomerAction,
  type SquareCustomerHandlers,
  type SquareLocalCustomerDependencies
} from "@/lib/integrations/control-plane/square-customer-routes";
import { SquareConnectionActorSchema } from "@/lib/integrations/providers/square/account-connection-contracts";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";

// No environment variable, production binding or import installs these capabilities.
let localHandlers: SquareCustomerHandlers | null = null;

export function squareCustomerConnectionsEnabled() {
  return localHandlers !== null && squareLocalQualificationEnvironmentAllowed();
}

export function installSquareLocalQualification(dependencies: SquareLocalCustomerDependencies) {
  if (localHandlers !== null) throw new Error("square_local_customer_already_installed");
  const handlers = createSquareCustomerHandlers(dependencies);
  localHandlers = handlers;
  return () => { if (localHandlers === handlers) localHandlers = null; };
}

export async function squareCustomerRoute(action: SquareCustomerAction, request: Request) {
  if (!localHandlers || !squareLocalQualificationEnvironmentAllowed()) return squareCustomerConnectionsUnavailableResponse();
  return localHandlers.handle(action, request);
}

export async function squareCustomerPageView(request: Request) {
  if (!localHandlers || !squareLocalQualificationEnvironmentAllowed()) return null;
  try { return await localHandlers.view(request); } catch { return null; }
}

/** Optional authenticated Next host adapter. Never called by the default closed surfaces. */
export async function authenticateSquareWorkspaceActor() {
  const access = await requireWorkspaceAccess();
  const { data, error } = await access.supabase.auth.getClaims();
  if (error || !data || data.claims.sub !== access.user.id) return null;
  const checked = SquareConnectionActorSchema.safeParse({
    actorId: access.user.id,
    workspaceId: access.workspaceId,
    sessionId: data.claims.session_id,
    role: access.membership.role
  });
  return checked.success ? checked.data : null;
}
