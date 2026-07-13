import { z } from "zod";

export const WORKSPACE_RESET_STORAGE_BUCKET = "workspace-files";
export const WORKSPACE_RESET_RETENTION_DAYS = 30;
export const WORKSPACE_RESET_MAX_OBJECTS_PER_REMOVE = 500;
export const WORKSPACE_RESET_MAX_OBJECTS_PER_PURGE_RUN = 2_000;
export const WORKSPACE_RESET_REAUTH_WINDOW_MINUTES = 10;

export const workspaceResetStorageModeSchema = z.enum(["recoverable", "permanent"]);
export const workspaceResetSetupModeSchema = z.enum(["blank", "guided"]);

export type WorkspaceResetStorageMode = z.infer<typeof workspaceResetStorageModeSchema>;
export type WorkspaceResetSetupMode = z.infer<typeof workspaceResetSetupModeSchema>;

export const workspaceResetRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    workspaceName: z.string().trim().min(1).max(200),
    confirmationName: z.string().min(1).max(200),
    storageMode: workspaceResetStorageModeSchema,
    setupMode: workspaceResetSetupModeSchema,
    operationId: z.string().uuid(),
    permanentPhrase: z.string().max(260).optional(),
    currentPassword: z.string().min(8).max(1_024)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.confirmationName !== value.workspaceName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Workspace name confirmation does not match.",
        path: ["confirmationName"]
      });
    }

    if (value.storageMode === "permanent" && value.permanentPhrase !== permanentWorkspaceResetPhrase(value.workspaceName)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Permanent reset confirmation phrase does not match.",
        path: ["permanentPhrase"]
      });
    }
  });

export function permanentWorkspaceResetPhrase(workspaceName: string) {
  return `PERMANENTLY RESET ${workspaceName}`;
}

export function workspaceStoragePrefix(workspaceId: string) {
  return `${workspaceId}/`;
}

export function isExactWorkspaceStoragePath(workspaceId: string, objectPath: string) {
  const prefix = workspaceStoragePrefix(workspaceId);
  if (!objectPath.startsWith(prefix) || objectPath.length <= prefix.length || objectPath.includes("//")) {
    return false;
  }

  const segments = objectPath.slice(prefix.length).split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("\\") && !/[\u0000-\u001f]/.test(segment)
  );
}

export function workspaceResetRedirectTarget(setupMode: WorkspaceResetSetupMode, operationId: string) {
  return setupMode === "guided"
    ? `/app/setup?reset_operation=${encodeURIComponent(operationId)}`
    : `/app/settings?reset_operation=${encodeURIComponent(operationId)}&message=${encodeURIComponent(
        "Workspace business data was reset. The workspace is now blank."
      )}`;
}

export function isRecoverableOperation(status: string, storageMode: string, purgeAfter: string | null) {
  if (status !== "recoverable" || storageMode !== "recoverable" || !purgeAfter) {
    return false;
  }

  return new Date(purgeAfter).getTime() > Date.now();
}
