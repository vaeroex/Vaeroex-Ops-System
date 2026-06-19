"use server";

import { cookies } from "next/headers";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type WorkspaceSwitchRow = {
  id: string;
  workspaces: { name: string } | { name: string }[] | null;
};

function workspaceName(row: WorkspaceSwitchRow | null) {
  const workspace = Array.isArray(row?.workspaces) ? row?.workspaces[0] : row?.workspaces;
  return workspace?.name || "selected workspace";
}

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
    .select("id, workspaces(name)")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle<WorkspaceSwitchRow>();

  if (data) {
    const cookieStore = await cookies();
    cookieStore.set("vaeroex_workspace_id", workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/"
    });

    redirect(`/app?message=${encodeURIComponent(`Switched to ${workspaceName(data)}.`)}` as Route);
  }

  redirect("/app?error=Workspace could not be switched. You only have access to workspaces where you are an active member." as Route);
}
