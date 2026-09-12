import "server-only";
import { parseSquareWorkspaceEvidence } from "@/lib/integrations/providers/square/workspace-evidence";
import { parseSquareWorkspaceOperational } from "@/lib/integrations/providers/square/workspace-operational";

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

type CardReader = { rpc(name: "read_square_workspace_card_v1", args: { p_workspace_name: string }):
  PromiseLike<{ data: unknown; error: unknown }> };

/** Restricted host: never discovers rows/IDs or performs a billing table read. */
export async function readSquareWorkspaceCard(client: CardReader, workspaceName: string, headers?: RequestHeaders) {
  if (!squareWorkspaceEvidenceCandidate(headers) || workspaceName.length < 1 || workspaceName.length > 200) return null;
  try {
    const result = await client.rpc("read_square_workspace_card_v1", { p_workspace_name: workspaceName });
    return result.error ? null : parseSquareWorkspaceEvidence(result.data);
  } catch { return null; }
}

type OperationalReader={rpc(name:"read_square_workspace_operational_v1",args:{p_workspace_name:string;p_kind:string|null;p_status:string|null;p_page:number}):PromiseLike<{data:unknown;error:unknown}>};
export async function readSquareWorkspaceOperational(client:OperationalReader,workspaceName:string,filter:{kind:string|null;status:string|null;page:number},headers?:RequestHeaders){
  if(!squareWorkspaceEvidenceCandidate(headers)||workspaceName.length<1||workspaceName.length>200||filter.page<1||filter.page>40) return null;
  try{const result=await client.rpc("read_square_workspace_operational_v1",{p_workspace_name:workspaceName,p_kind:filter.kind,p_status:filter.status,p_page:filter.page});
    return result.error?null:parseSquareWorkspaceOperational(result.data);}catch{return null;}
}
