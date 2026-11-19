import { squareDirectRecurringRoute } from "@/lib/integrations/square-direct/server";

export async function POST(request: Request) { return squareDirectRecurringRoute(request); }
