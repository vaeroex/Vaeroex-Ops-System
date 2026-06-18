"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function selectWorkspaceAction(formData: FormData) {
  const workspaceId = String(formData.get("workspace_id") || "").trim();
  const supabase = await createSupabaseServerClient();

  if (!workspaceId || !supabase) {
    redirect("/app");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (data) {
    const cookieStore = await cookies();
    cookieStore.set("vaeroex_workspace_id", workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/"
    });
  }

  redirect("/app");
}
