import { vsiRoute } from "@/lib/vsi/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return vsiRoute(request, "detail", (await context.params).id); }
export async function PATCH(request: Request, context: Context) { return vsiRoute(request, "rename", (await context.params).id); }
export async function DELETE(request: Request, context: Context) { return vsiRoute(request, "delete", (await context.params).id); }

