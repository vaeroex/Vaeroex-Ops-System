import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SquareConnectionActorSchema, type SquareConnectionActor } from "@/lib/integrations/providers/square/account-connection-contracts";
import { SQUARE_REMOTE_SANDBOX, type SquareRemoteSandboxBinding } from "@/lib/integrations/control-plane/square-remote-sandbox-contracts";

/** No workspace selector, request-body identity, metadata role or Production
 * Supabase client is trusted. getUser verifies the user at the isolated Auth
 * service; getClaims verifies the session JWT. Every subsequent checked account
 * RPC separately requires the current auth.sessions record and active membership.
 * Automatic table exposure/grants are not needed for this authentication path. */
export async function authenticateSquareRemoteSandboxActor(binding: SquareRemoteSandboxBinding): Promise<SquareConnectionActor | null> {
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${SQUARE_REMOTE_SANDBOX.projectRef}.supabase.co` ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || Date.parse(binding.approvalExpiresAt) <= Date.now()) return null;
    const jar = await cookies();
    const auth = createServerClient(`https://${SQUARE_REMOTE_SANDBOX.projectRef}.supabase.co`,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        cookies: {
          getAll: () => jar.getAll(),
          setAll(values) {
            // Auth cookies remain host-only; never broaden them to vaeroex.com.
            try { for (const { name, value, options } of values) jar.set(name, value, { ...options, domain: undefined, secure: true }); }
            catch { /* Server component rendering cannot write cookies. */ }
          }
        }
      });
    const user = await auth.auth.getUser();
    if (user.error || !user.data.user || user.data.user.id !== binding.operatorId) return null;
    const claims = await auth.auth.getClaims();
    if (claims.error || !claims.data || claims.data.claims.sub !== binding.operatorId ||
      claims.data.claims.iss !== `https://${SQUARE_REMOTE_SANDBOX.projectRef}.supabase.co/auth/v1` ||
      claims.data.claims.aud !== "authenticated") return null;
    const actor = SquareConnectionActorSchema.parse({ actorId: binding.operatorId, workspaceId: binding.workspaceId,
      sessionId: claims.data.claims.session_id, role: binding.operatorRole });
    return Object.freeze(actor);
  } catch { return null; }
}
