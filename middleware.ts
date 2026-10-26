import type { NextRequest } from "next/server";
import { refreshWorkspaceSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return refreshWorkspaceSession(request);
}

// Workspace Server Components cannot persist refreshed cookies themselves.
// APIs, OAuth callbacks and public pages retain their existing handling.
export const config = { matcher: ["/app/:path*"] };
