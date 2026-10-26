import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/types";

function preventSessionCaching(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Vercel-CDN-Cache-Control", "no-store");
  return response;
}

/** Refresh transport only. Pages/actions still verify identity and authorization. */
export async function refreshWorkspaceSession(request: NextRequest) {
  let response = preventSessionCaching(NextResponse.next({ request }));
  const path = request.nextUrl.pathname.toLowerCase().replace(/\/+$/, "");
  // Preserve the unauthenticated payment-query scrub and Square's separate
  // availability/host gate, both of which intentionally run before Auth.
  if (path === "/app/settings/storage/payment-return" ||
      path === "/app/settings/integrations/square" || path.startsWith("/app/settings/integrations/square/")) return response;
  // Server Actions have a writable cookie store already. Avoid refreshing before
  // a sign-out or other action that deliberately replaces the session.
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  const config = getSupabaseConfig();
  if (!config) return response;

  // Never share this client or cookie state between requests/users.
  const supabase = createServerClient<Database>(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        const updated = preventSessionCaching(NextResponse.next({ request }));
        // A subsequent SDK cookie batch must not discard earlier writes/deletes.
        for (const cookie of response.cookies.getAll()) updated.cookies.set(cookie);
        for (const { name, value, options } of cookiesToSet) updated.cookies.set(name, value, options);
        response = updated;
      }
    }
  });

  // getUser validates with Auth; a cookie's embedded user/getSession is not proof
  // of identity. Existing page/RPC guards remain authoritative, including when
  // Auth returns an invalid/revoked session. Never pass a trusted-user header.
  try {
    await supabase.auth.getUser();
  } catch {
    // Unexpected SDK/transport exceptions must not authorize a request or drop
    // an already-issued cookie batch. Do not expose raw Auth errors/headers.
    const unavailable = preventSessionCaching(new NextResponse("Session verification unavailable.", { status: 503 }));
    for (const cookie of response.cookies.getAll()) unavailable.cookies.set(cookie);
    return unavailable;
  }
  return response;
}
