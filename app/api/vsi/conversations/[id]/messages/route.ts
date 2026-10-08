import { vsiRoute } from "@/lib/vsi/http";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return vsiRoute(request, "messages", (await context.params).id); }
