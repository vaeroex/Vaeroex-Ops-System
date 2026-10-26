import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SharedCitationReadTrace } from "@/lib/supabase/citation-read-trace";

export async function requireAuth(citationTrace?: SharedCitationReadTrace) {
  const supabase = await createSupabaseServerClient(citationTrace);

  if (!supabase) {
    redirect("/login?error=Supabase%20is%20not%20configured.");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return { supabase, user };
}
