import { vsiRoute } from "@/lib/vsi/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return vsiRoute(request, "list"); }
export async function POST(request: Request) { return vsiRoute(request, "create"); }

