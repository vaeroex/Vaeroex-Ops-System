import { redirect } from "next/navigation";
import type { Route } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import type { Database } from "@/lib/supabase/types";

export async function requireActiveSubscription({
  supabase,
  userId,
  email,
  workspaceId,
  redirectTo = "/billing-required"
}: {
  supabase: SupabaseClient<Database>;
  userId?: string | null;
  email?: string | null;
  workspaceId?: string | null;
  redirectTo?: string;
}) {
  const status = await getSubscriptionStatus({ supabase, userId, email, workspaceId });

  if (!status.allowed) {
    redirect(`${redirectTo}?reason=${encodeURIComponent(status.reason)}` as Route);
  }

  return status;
}
