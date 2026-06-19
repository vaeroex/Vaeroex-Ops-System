import "server-only";

import type { WorkspaceScopedRecord } from "@/lib/security/types";

export function assertWorkspaceScope(record: WorkspaceScopedRecord | null | undefined, workspaceId: string, label = "Record") {
  if (!record || record.workspace_id !== workspaceId) {
    throw new Error(`${label} is not available in the active workspace.`);
  }

  return record;
}

export function assertWorkspaceId(workspaceId: string | null | undefined, activeWorkspaceId: string, label = "Record") {
  if (!workspaceId || workspaceId !== activeWorkspaceId) {
    throw new Error(`${label} is not available in the active workspace.`);
  }
}
