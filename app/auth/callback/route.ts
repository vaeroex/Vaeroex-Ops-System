import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") || "/app";
  const supabase = await createSupabaseServerClient();

  if (!code) {
    return NextResponse.redirect(new URL("/", requestUrl.origin));
  }

  if (code && supabase) {
    await supabase.auth.exchangeCodeForSession(code);
    await supabase.rpc("accept_workspace_invites_for_current_user");
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
