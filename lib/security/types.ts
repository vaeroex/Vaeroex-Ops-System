import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database, Workspace, WorkspaceMember, WorkspaceRole } from "@/lib/supabase/types";
import type { WorkspaceContext } from "@/lib/workspaces/current";

export type VaeroexSupabaseClient = SupabaseClient<Database>;
export type VaeroexUser = User;
export type AppWorkspaceRole = WorkspaceRole;

export type WorkspaceAccess = {
  supabase: VaeroexSupabaseClient;
  user: VaeroexUser;
  context: WorkspaceContext;
  workspace: Workspace;
  workspaceId: string;
  membership: WorkspaceMember;
};

export type WorkspaceScopedRecord = {
  workspace_id?: string | null;
};
