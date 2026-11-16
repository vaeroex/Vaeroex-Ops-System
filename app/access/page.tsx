import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/security/require-auth";
import { loadSystemAccess } from "@/lib/systems/access";
import { defaultSystemDestination } from "@/lib/systems/routing";
export const dynamic = "force-dynamic";
export default async function AccessPage() {
  const { supabase, user } = await requireAuth();
  const { decisions } = await loadSystemAccess(supabase, user);
  redirect(defaultSystemDestination(decisions));
}
