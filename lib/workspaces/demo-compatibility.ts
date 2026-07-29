export function isDemoWorkspaceRecord(
  workspace?: { name?: string | null; subscription_status?: string | null } | null
) {
  return Boolean(
    workspace
      && (workspace.subscription_status === "demo"
        || workspace.name?.startsWith("Vaeroex Demo Workspace"))
  );
}
