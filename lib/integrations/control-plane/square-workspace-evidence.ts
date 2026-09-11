import "server-only";
import { parseSquareWorkspaceEvidence } from "@/lib/integrations/providers/square/workspace-evidence";

/** Negative deployment gate, never an authorization grant. Production uses a
 * different database and cannot query this Sandbox-only reader. */
type RequestHeaders = { get(name: string): string | null };
export function squareWorkspaceEvidenceCandidate(headers?: RequestHeaders) {
  // Only the separately configured GCP workspace process may opt in. This is
  // not an authorization grant; the JWT-bound database check remains mandatory.
  return process.env.SQUARE_EVIDENCE_HOST === "gcp-square-sandbox-workspace-v1" &&
    process.env.NODE_ENV === "production" &&
    ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_PROJECT_ID", "VERCEL_URL"].every(key => process.env[key] === undefined) &&
    process.env.NEXT_PUBLIC_SUPABASE_URL === "https://oysjpoondtcrqpghhrbd.supabase.co" &&
    process.env.NEXT_PUBLIC_APP_URL === "https://square-sandbox.vaeroex.com" &&
    headers?.get("host") === "square-sandbox.vaeroex.com" &&
    headers.get("x-forwarded-host") === "square-sandbox.vaeroex.com" &&
    headers.get("x-forwarded-proto") === "https" &&
    headers.get("forwarded") === null;
}
type Reader = { rpc(name: "read_square_workspace_evidence_v1", args: { p_workspace_id: string }):
  PromiseLike<{ data: unknown; error: unknown }> };

export async function readSquareWorkspaceEvidence(client: Reader, workspaceId: string, headers?: RequestHeaders) {
  if (!squareWorkspaceEvidenceCandidate(headers) || !/^[a-f0-9-]{36}$/i.test(workspaceId)) return null;
  try {
    // Uses the existing authenticated workspace client's JWT, not an admin key.
    // No caching, retries, diagnostics, raw payload fallback or model dispatch.
    const result = await client.rpc("read_square_workspace_evidence_v1", { p_workspace_id: workspaceId });
    return result.error ? null : parseSquareWorkspaceEvidence(result.data);
  } catch { return null; }
}
