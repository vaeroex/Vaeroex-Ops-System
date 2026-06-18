import { NextResponse } from "next/server";
import { getSubscriptionUsageStatus } from "@/lib/billing/usage-limits";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

export async function GET() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const context = await getWorkspaceContext();
  const result = await getSubscriptionUsageStatus({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId: context.activeWorkspace?.id
  });

  return NextResponse.json({
    ok: true,
    ...result
  });
}
