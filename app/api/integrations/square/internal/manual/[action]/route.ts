import { executeSquareInternalPilotAction } from "@/lib/integrations/control-plane/square-internal-pilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  return executeSquareInternalPilotAction(request, (await context.params).action);
}
