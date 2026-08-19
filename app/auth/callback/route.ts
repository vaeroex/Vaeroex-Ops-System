import { NextResponse, type NextRequest } from "next/server";
import { safeAuthRedirectPath } from "@/lib/auth/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeAuthRedirectPath(requestUrl.searchParams.get("next"));
  const supabase = await createSupabaseServerClient();

  if (!code) {
    return NextResponse.redirect(new URL("/", requestUrl.origin));
  }

  if (!supabase) {
    return NextResponse.redirect(
      new URL("/login?error=Authentication%20is%20temporarily%20unavailable.", requestUrl.origin)
    );
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL("/login?error=Authentication%20could%20not%20be%20completed.", requestUrl.origin)
    );
  }

  await supabase.rpc("accept_workspace_invites_for_current_user");

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
