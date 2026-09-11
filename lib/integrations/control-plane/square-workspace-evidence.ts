import "server-only";
import { parseSquareWorkspaceEvidence } from "@/lib/integrations/providers/square/workspace-evidence";

/** Negative deployment gate, never an authorization grant. Production uses a
 * different database and cannot query this Sandbox-only reader. */
export function squareWorkspaceEvidenceCandidate() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL === "https://oysjpoondtcrqpghhrbd.supabase.co" &&
    process.env.NEXT_PUBLIC_APP_URL === "https://square-sandbox.vaeroex.com" &&
    process.env.VERCEL_PROJECT_ID !== "prj_J810bZ9ECoN4CyLKujUoEEH8N6ja";
}
type Reader = { rpc(name: "read_square_workspace_evidence_v1", args: { p_workspace_id: string }):
  PromiseLike<{ data: unknown; error: unknown }> };

export async function readSquareWorkspaceEvidence(client: Reader, workspaceId: string) {
  if (!squareWorkspaceEvidenceCandidate() || !/^[a-f0-9-]{36}$/i.test(workspaceId)) return null;
  try {
    // Uses the existing authenticated workspace client's JWT, not an admin key.
    // No caching, retries, diagnostics, raw payload fallback or model dispatch.
    const result = await client.rpc("read_square_workspace_evidence_v1", { p_workspace_id: workspaceId });
    return result.error ? null : parseSquareWorkspaceEvidence(result.data);
  } catch { return null; }
}
