import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { loadIntegrationDashboard } from "@/lib/integrations/dashboard/server";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", vary: "Cookie", "x-content-type-options": "nosniff" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const expected = z.string().uuid().safeParse(params.get("workspaceId"));
  if (!expected.success || params.size !== 1) return Response.json({ error: "invalid_request" }, { status: 400, headers });
  try {
    const access = await requireWorkspaceAccess();
    if (access.workspaceId !== expected.data) return Response.json({ error: "workspace_changed" }, { status: 409, headers });
    const { dashboard, loadFailed } = await loadIntegrationDashboard({ access });
    if (loadFailed) return Response.json({ error: "status_unavailable" }, { status: 503, headers });
    return Response.json(dashboard, { headers });
  } catch { return Response.json({ error: "status_unavailable" }, { status: 503, headers }); }
}
