import { z } from "zod";
import { requireSheetsManager } from "@/lib/integrations/google-sheets/route-helpers";
import { readSheetsForm } from "@/lib/integrations/google-sheets/server";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";
import { erasureArtifactSchema, erasureScopeSchema, type ErasureRpcClient } from "@/app/app/settings/integrations/google-sheets/erasure/scope";

const approvalSchema = z.object({
  requestId: z.string().uuid(),
  scopeHash: z.string().regex(/^[a-f0-9]{64}$/i),
  confirmation: z.literal("approve_erasure")
}).strict();
const responseHeaders = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

function failure(status: number) {
  return Response.json({ ok: false, error: "Erasure approval could not be confirmed. Refresh the request and review its current scope." }, { status, headers: responseHeaders });
}

export async function POST(request: Request) {
  const url = new URL(request.url), expected = new URL(PUBLIC_SITE_URL);
  if (request.method !== "POST" || url.origin !== expected.origin || url.search || url.hash ||
      request.headers.get("origin") !== expected.origin || request.headers.get("host") !== expected.host ||
      request.headers.has("x-forwarded-host") && request.headers.get("x-forwarded-host") !== expected.host ||
      request.headers.has("x-forwarded-proto") && request.headers.get("x-forwarded-proto") !== expected.protocol.slice(0, -1) ||
      request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin") return failure(403);

  let input: z.infer<typeof approvalSchema>;
  let selected: Array<z.infer<typeof erasureArtifactSchema>>;
  try {
    const fields = await readSheetsForm(request, 262_144);
    const { requestId, scopeHash, confirmation, ...artifacts } = fields;
    input = approvalSchema.parse({ requestId, scopeHash, confirmation });
    const entries = Object.entries(artifacts);
    if (entries.some(([key]) => !/^artifact_(0|[1-9][0-9]*)$/.test(key))) return failure(400);
    selected = entries.map(([, value]) => erasureArtifactSchema.parse(JSON.parse(value)));
    if (new Set(selected.map(({ table, id }) => `${table}:${id}`)).size !== selected.length) return failure(400);
  } catch { return failure(400); }

  let access: Awaited<ReturnType<typeof requireSheetsManager>>;
  try { access = await requireSheetsManager(undefined, false); }
  catch { return failure(403); }

  try {
    const client = access.supabase as unknown as ErasureRpcClient;
    const result = await client.rpc("read_google_sheets_erasure_request_v1", { p_request_id: input.requestId });
    const parsed = erasureScopeSchema.safeParse(result.data);
    if (result.error || !parsed.success || parsed.data.requestId !== input.requestId || parsed.data.workspaceId !== access.workspaceId) return failure(404);
    const scope = parsed.data;
    if ((scope.state !== "prepared" && scope.state !== "approved") || scope.scopeHash !== input.scopeHash) return failure(409);
    const candidates = scope.artifacts.filter(({ action }) => action === "delete");
    const keys = new Set(candidates.map(({ table, id }) => `${table}:${id}`));
    if (selected.length !== candidates.length || selected.some(({ table, id }) => !keys.has(`${table}:${id}`))) return failure(400);
    // The RPC derives the owner and session from this user's JWT and rechecks the scope atomically.
    const confirmation = await client.rpc("confirm_google_sheets_erasure_request_v1", {
      p_request_id: input.requestId, p_scope_hash: input.scopeHash, p_delete_artifacts: selected
    });
    if (confirmation.error) return failure(409);
    return Response.json({ ok: true }, { headers: responseHeaders });
  } catch { return failure(404); }
}
