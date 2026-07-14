"use server";

import { cookies } from "next/headers";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { isDemoWorkspaceRecord } from "@/lib/demo/workspace-demo";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type WorkspaceSwitchRow = {
  id: string;
  workspaces: { id: string; name: string; subscription_status: string | null } | { id: string; name: string; subscription_status: string | null }[] | null;
};

function normalizeWorkspace(row: WorkspaceSwitchRow | null) {
  return Array.isArray(row?.workspaces) ? row?.workspaces[0] : row?.workspaces;
}

function workspaceName(row: WorkspaceSwitchRow | null) {
  const workspace = normalizeWorkspace(row);
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
    .select("id, workspaces(id,name,subscription_status)")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle<WorkspaceSwitchRow>();

  if (data) {
    const workspace = normalizeWorkspace(data);

    if (isDemoWorkspaceRecord(workspace) && !isVaeroexAdminUser(user)) {
      redirect("/app?error=The sample business environment is only available to authorized Vaeroex internal users." as Route);
    }

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
