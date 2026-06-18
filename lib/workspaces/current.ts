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
  const workspaces = rows
    .map((row) => (Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces))
    .filter((workspace): workspace is Workspace => Boolean(workspace));
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === preferredWorkspaceId) ?? workspaces[0] ?? null;
  const membership =
    rows.find((row) => row.workspace_id === activeWorkspace?.id) ??
    rows.find((row) => row.workspace_id === preferredWorkspaceId) ??
    null;

  return {
    profile: profile ?? null,
    workspaces,
    activeWorkspace,
    membership
  };
}
