import { redirect } from "next/navigation";
import type { Route } from "next";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function adminEmails() {
  return String(process.env.VAEROEX_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function getVaeroexAdminAccess() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  if (!supabase) {
    return { allowed: false, error: "Supabase is not configured.", supabase: null, admin: null, user: null };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { allowed: false, error: "Sign in to access Vaeroex admin tools.", supabase, admin, user: null };
  }

  if (!admin) {
    return { allowed: false, error: "Supabase service role is not configured.", supabase, admin: null, user };
  }

  const email = String(user.email || "").toLowerCase();
  const allowedEmails = adminEmails();

  if (!allowedEmails.length) {
    return { allowed: false, error: "Set VAEROEX_ADMIN_EMAILS before using internal admin tools.", supabase, admin, user };
  }

  if (!email || !allowedEmails.includes(email)) {
    return { allowed: false, error: "Vaeroex admin access is required.", supabase, admin, user };
  }

  return { allowed: true, error: null, supabase, admin, user };
}

export async function requireVaeroexAdmin(returnPath = "/app/admin") {
  const access = await getVaeroexAdminAccess();

  if (!access.user) {
    redirect("/login");
  }

  if (!access.allowed || !access.admin) {
    redirect(`${returnPath}?error=${encodeURIComponent(access.error || "Vaeroex admin access is required.")}` as Route);
  }

  return {
    supabase: access.supabase,
    admin: access.admin,
    user: access.user
  };
}
