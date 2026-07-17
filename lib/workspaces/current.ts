import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { isDemoWorkspaceRecord } from "@/lib/demo/workspace-demo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Profile, Workspace, WorkspaceMember } from "@/lib/supabase/types";

type MembershipWithWorkspace = WorkspaceMember & {
  workspaces: Workspace | Workspace[] | null;
};

export type WorkspaceContext = {
  profile: Profile | null;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  membership: WorkspaceMember | null;
};

type AuthenticatedWorkspaceContext = {
  supabase: SupabaseClient<Database>;
  user: User;
};

export async function getWorkspaceContext(
  preferredWorkspaceId?: string | null,
  authenticated?: AuthenticatedWorkspaceContext
): Promise<WorkspaceContext> {
  const supabase = authenticated?.supabase || await createSupabaseServerClient();
  const effectivePreferredWorkspaceId =
    preferredWorkspaceId === undefined ? (await cookies()).get("vaeroex_workspace_id")?.value ?? null : preferredWorkspaceId;

  if (!supabase) {
    return {
      profile: null,
      workspaces: [],
      activeWorkspace: null,
      membership: null
    };
  }

  const user = authenticated?.user || (await supabase.auth.getUser()).data.user;

  if (!user) {
    return {
      profile: null,
      workspaces: [],
      activeWorkspace: null,
      membership: null
    };
  }

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("*, workspaces(*)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
  ]);

  const rows = (memberships ?? []) as MembershipWithWorkspace[];
  const canAccessDemoWorkspace = isVaeroexAdminUser(user);
  const visibleRows = rows.filter((row) => {
    const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
    return Boolean(workspace && (canAccessDemoWorkspace || !isDemoWorkspaceRecord(workspace)));
  });
  const workspaces = visibleRows
    .map((row) => (Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces))
    .filter((workspace): workspace is Workspace => Boolean(workspace));
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === effectivePreferredWorkspaceId) ?? workspaces[0] ?? null;
  const membership =
    visibleRows.find((row) => row.workspace_id === activeWorkspace?.id) ??
    visibleRows.find((row) => row.workspace_id === effectivePreferredWorkspaceId) ??
    null;

  return {
    profile: profile ?? null,
    workspaces,
    activeWorkspace,
    membership
  };
}
