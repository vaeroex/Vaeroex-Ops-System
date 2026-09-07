import { squareCustomerRoute } from "@/lib/integrations/control-plane/square-customer-availability";
export const runtime = "nodejs";
export async function GET(request: Request) { return squareCustomerRoute("callback", request); }
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const HEAD = GET;
export const OPTIONS = GET;
