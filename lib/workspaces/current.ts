import { cookies } from "next/headers";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { isDemoWorkspaceRecord } from "@/lib/demo/workspace-demo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile, Workspace, WorkspaceMember } from "@/lib/supabase/types";

type MembershipWithWorkspace = WorkspaceMember & {
  workspaces: Workspace | Workspace[] | null;
};

export type WorkspaceContext = {
  profile: Profile | null;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  membership: WorkspaceMember | null;
};

export async function getWorkspaceContext(preferredWorkspaceId?: string | null): Promise<WorkspaceContext> {
  const supabase = await createSupabaseServerClient();
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

  const {
    data: { user }
  } = await supabase.auth.getUser();

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
