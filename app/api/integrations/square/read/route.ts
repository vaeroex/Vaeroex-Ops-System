import {productionSquareReadAction} from "@/lib/integrations/control-plane/square-production-customer";
export const runtime="nodejs";
export async function POST(request:Request){return productionSquareReadAction("read",request);}
export const GET=POST;export const PUT=POST;export const PATCH=POST;export const DELETE=POST;export const HEAD=POST;export const OPTIONS=POST;
