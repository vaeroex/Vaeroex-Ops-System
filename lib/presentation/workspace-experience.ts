export type WorkspaceExperience = "intel3d" | "simple";

export const VAEROEX_WORKSPACE_EXPERIENCE_STORAGE_KEY = "vaeroex-workspace-experience";
export const DEFAULT_WORKSPACE_EXPERIENCE: WorkspaceExperience = "intel3d";

export function isWorkspaceExperience(value: string | null): value is WorkspaceExperience {
  return value === "intel3d" || value === "simple";
}

export function normalizeWorkspaceExperience(value: string | null): WorkspaceExperience {
  return isWorkspaceExperience(value) ? value : DEFAULT_WORKSPACE_EXPERIENCE;
}
