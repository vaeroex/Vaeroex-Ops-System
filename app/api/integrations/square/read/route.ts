import {productionSquareReadAction} from "@/lib/integrations/control-plane/square-production-customer";
import {squareDirectEnabled,squareDirectRoute} from "@/lib/integrations/square-direct/server";
export const runtime="nodejs";
export const maxDuration=60;
export async function POST(request:Request){return squareDirectEnabled()?squareDirectRoute("read",request):productionSquareReadAction("read",request);}
export const GET=POST;export const PUT=POST;export const PATCH=POST;export const DELETE=POST;export const HEAD=POST;export const OPTIONS=POST;
