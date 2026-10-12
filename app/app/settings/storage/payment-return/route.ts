import { NextResponse, type NextRequest } from "next/server";

/** Stripe may append payment query parameters during authentication redirects.
 * Do not read, retain, or forward them. The webhook remains the only payment authority.
 */
export function GET(request: NextRequest) {
  const destination = new URL("/app/settings/storage", request.url);
  destination.searchParams.set("checkout", "complete");
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (workspaceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) {
    destination.searchParams.set("returnWorkspaceId", workspaceId);
  }
  // A relative Location preserves the browser origin when Next uses an internal bind host.
  const response = new NextResponse(null, { status: 303, headers: { Location: `${destination.pathname}${destination.search}` } });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
