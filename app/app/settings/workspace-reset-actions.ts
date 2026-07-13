"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireToolExecution } from "@/lib/security/tool-execution-gateway";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/types";
import { requireWorkspaceRole } from "@/lib/security/require-workspace-role";
import {
  isRecoverableOperation,
  workspaceResetRedirectTarget,
  workspaceResetRequestSchema
} from "@/lib/workspaces/reset-policy";
import {
  buildWorkspaceResetStorageManifest,
  claimWorkspaceResetPurge,
  markResetOperationFailed,
  markResetOperationPartial,
  purgeWorkspaceResetStorage
} from "@/lib/workspaces/reset-storage";

type ResetOperation = Database["public"]["Tables"]["workspace_reset_operations"]["Row"];

function value(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function settingsRedirect(kind: "message" | "error", message: string, operationId?: string): never {
  const params = new URLSearchParams({ [kind]: message });
  if (operationId) params.set("reset_operation", operationId);
  redirect(`/app/settings?${params.toString()}` as Route);
}

function friendlyResetError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/password-based account email/i.test(message)) {
    return "Workspace reset currently requires a password-based account. OAuth-only accounts cannot use this control yet.";
  }
  if (/recent authentication|password|invalid login credentials/i.test(message)) {
    return "Vaeroex could not verify your password. Password-based reauthentication is required, and OAuth-only accounts cannot use this control yet.";
  }
  if (/workspace name confirmation/i.test(message)) return "The workspace name confirmation does not match.";
  if (/permanent reset confirmation/i.test(message)) return "The permanent reset phrase does not match.";
  if (/another workspace reset|already active|advisory/i.test(message)) return "Another reset is already running for this workspace.";
  if (/storage manifest|storage prefix|out-of-scope|source file points outside/i.test(message)) {
    return "The reset was stopped because Vaeroex could not verify every private file inside this workspace. No database reset was performed.";
  }
  if (/legal hold/i.test(message)) return "Permanent reset is blocked because retained business content is under legal hold.";
  if (/too many stored objects/i.test(message)) return message;
  if (/too much business content/i.test(message)) {
    return "This workspace is too large for an interactive reset. Contact Vaeroex support for a controlled reset runbook.";
  }
  if (/not available for restoration|recovery period has expired|already been permanently purged/i.test(message)) return message;
  if (/business content created after reset|controlled recovery review/i.test(message)) {
    return "This workspace contains business content created after the reset. Self-service restore was stopped to avoid merging snapshots. Contact Vaeroex support for a controlled recovery review.";
  }
  return "Vaeroex could not complete the workspace reset safely. No unconfirmed step was treated as successful.";
}

async function reauthenticateCurrentUser(
  supabase: Awaited<ReturnType<typeof requireWorkspaceRole>>["supabase"],
  email: string | undefined,
  password: string
) {
  if (!email) throw new Error("A password-based account email is required for recent authentication.");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Recent authentication failed.");
}

async function scrubCompletedManifest(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  workspaceId: string,
  operationId: string
) {
  const { error } = await admin
    .from("workspace_reset_storage_objects")
    .delete()
    .eq("operation_id", operationId)
    .eq("workspace_id", workspaceId);
  return !error;
}

export async function resetWorkspaceDataAction(formData: FormData) {
  const workspaceId = value(formData, "workspace_id");
  const access = await requireWorkspaceRole(["owner", "admin"]);
  if (!workspaceId || workspaceId !== access.workspaceId) {
    settingsRedirect("error", "Reset was blocked because the submitted workspace does not match your active workspace.");
  }
  const parsed = workspaceResetRequestSchema.safeParse({
    workspaceId,
    workspaceName: access.workspace.name,
    confirmationName: value(formData, "confirmation_name"),
    storageMode: value(formData, "storage_mode"),
    setupMode: value(formData, "setup_mode"),
    operationId: value(formData, "operation_id"),
    permanentPhrase: value(formData, "permanent_phrase") || undefined,
    currentPassword: value(formData, "current_password")
  });

  if (!parsed.success) {
    settingsRedirect("error", parsed.error.issues[0]?.message || "Review every reset confirmation field.");
  }

  const request = parsed.data;
  const admin = createSupabaseAdminClient();
  if (!admin) settingsRedirect("error", "Workspace reset storage processing is not configured.");

  let databaseResetCompleted = false;
  let storagePurgeClaimed = false;
  let anotherPurgeOwnsOperation = false;
  let successTarget: Route | null = null;
  try {
    await reauthenticateCurrentUser(access.supabase, access.user.email, request.currentPassword);

    await requireToolExecution(
      {
        supabase: access.supabase,
        workspaceId: access.workspaceId,
        userId: access.user.id,
        userRole: access.membership.role
      },
      {
        toolName: "reset_workspace_data",
        args: {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          storageMode: request.storageMode,
          setupMode: request.setupMode
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: request.workspaceId,
        requestId: request.operationId,
        metadata: {
          storage_mode: request.storageMode,
          setup_mode: request.setupMode,
          two_step_confirmation: true,
          recent_reauthentication: true
        } satisfies Json
      }
    );

    const { error: beginError } = await access.supabase.rpc("begin_workspace_data_reset", {
      p_workspace_id: request.workspaceId,
      p_confirmation_name: request.confirmationName,
      p_storage_mode: request.storageMode,
      p_setup_mode: request.setupMode,
      p_operation_id: request.operationId,
      p_permanent_phrase: request.permanentPhrase || null
    });
    if (beginError) throw new Error(beginError.message);

    await buildWorkspaceResetStorageManifest({
      admin,
      workspaceId: request.workspaceId,
      operationId: request.operationId
    });

    const { data: resetResult, error: resetError } = await access.supabase.rpc("reset_workspace_data", {
      p_workspace_id: request.workspaceId,
      p_confirmation_name: request.confirmationName,
      p_storage_mode: request.storageMode,
      p_setup_mode: request.setupMode,
      p_operation_id: request.operationId
    });
    if (resetError) throw new Error(resetError.message);
    databaseResetCompleted = true;

    if (request.storageMode === "permanent") {
      const { data: operation, error: operationError } = await admin
        .from("workspace_reset_operations")
        .select("*")
        .eq("id", request.operationId)
        .eq("workspace_id", request.workspaceId)
        .single();
      if (operationError || !operation) throw new Error("The reset ledger could not be loaded for storage purge.");

      let finalRecord: Record<string, unknown> = { status: operation.status };
      if (operation.status !== "completed") {
        const claimedOperation = await claimWorkspaceResetPurge(admin, operation as ResetOperation);
        if (!claimedOperation) {
          anotherPurgeOwnsOperation = true;
          throw new Error("Another verified storage purge is already running for this reset.");
        }
        storagePurgeClaimed = true;

        await purgeWorkspaceResetStorage({ admin, operation: claimedOperation });
        const { data: finalized, error: finalizeError } = await access.supabase.rpc("finalize_workspace_data_reset", {
          p_workspace_id: request.workspaceId,
          p_operation_id: request.operationId
        });
        if (finalizeError) throw new Error(finalizeError.message);
        finalRecord = finalized && typeof finalized === "object" && !Array.isArray(finalized) ? finalized : {};
      }

      if (finalRecord.status === "completed") {
        const scrubbed = await scrubCompletedManifest(admin, request.workspaceId, request.operationId);
        if (!scrubbed) {
          await markResetOperationPartial(
            admin,
            request.workspaceId,
            request.operationId,
            "Private files were purged, but the completed storage manifest still requires cleanup."
          );
          const params = new URLSearchParams({
            error: "Business records and private files were reset, but the storage audit manifest still requires a cleanup retry.",
            reset_operation: request.operationId
          });
          successTarget = `/app/settings?${params.toString()}` as Route;
        }
      }
      if (finalRecord.status === "partial") {
        const params = new URLSearchParams({
          error: "Business records were reset, but one or more private files still require a verified purge retry. Use the audit reference shown below.",
          reset_operation: request.operationId
        });
        successTarget = `/app/settings?${params.toString()}` as Route;
      }
    }

    revalidatePath("/app", "layout");
    successTarget ||= workspaceResetRedirectTarget(request.setupMode, request.operationId) as Route;
  } catch (error) {
    if (!databaseResetCompleted) {
      await markResetOperationFailed(admin, request.workspaceId, request.operationId, friendlyResetError(error));
    } else if (!anotherPurgeOwnsOperation && (storagePurgeClaimed || request.storageMode !== "permanent")) {
      await markResetOperationPartial(admin, request.workspaceId, request.operationId, friendlyResetError(error));
    }
    settingsRedirect("error", friendlyResetError(error), request.operationId);
  }

  redirect(successTarget as Route);
}

export async function restoreWorkspaceDataAction(formData: FormData) {
  const workspaceId = value(formData, "workspace_id");
  const operationId = value(formData, "operation_id");
  const currentPassword = value(formData, "current_password");
  const access = await requireWorkspaceRole(["owner", "admin"]);
  if (!workspaceId || workspaceId !== access.workspaceId) {
    settingsRedirect("error", "Restore was blocked because the submitted workspace does not match your active workspace.", operationId);
  }
  const admin = createSupabaseAdminClient();
  let manifestCleanupFailed = false;

  if (!admin) settingsRedirect("error", "Workspace reset recovery is not configured.", operationId);
  if (!operationId || !currentPassword) settingsRedirect("error", "Enter your password to restore workspace data.", operationId);

  try {
    await reauthenticateCurrentUser(access.supabase, access.user.email, currentPassword);
    const { data: operation, error: operationError } = await access.supabase
      .from("workspace_reset_operations")
      .select("*")
      .eq("id", operationId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (operationError || !operation || !isRecoverableOperation(operation.status, operation.storage_mode, operation.purge_after)) {
      throw new Error("This reset is not available for restoration.");
    }

    await requireToolExecution(
      {
        supabase: access.supabase,
        workspaceId,
        userId: access.user.id,
        userRole: access.membership.role
      },
      {
        toolName: "recover_workspace_data",
        args: { workspaceId, operationId, action: "restore" },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: operationId,
        requestId: operationId,
        metadata: { recovery_window_days: 30 }
      }
    );

    const { error } = await access.supabase.rpc("restore_workspace_data", {
      p_workspace_id: workspaceId,
      p_operation_id: operationId
    });
    if (error) throw new Error(error.message);

    manifestCleanupFailed = !(await scrubCompletedManifest(admin, workspaceId, operationId));
    if (manifestCleanupFailed) {
      await admin
        .from("workspace_reset_operations")
        .update({ failure_summary: "Workspace data was restored, but the private storage manifest still requires cleanup." })
        .eq("id", operationId)
        .eq("workspace_id", workspaceId)
        .eq("status", "restored");
    }
    revalidatePath("/app", "layout");
  } catch (error) {
    settingsRedirect("error", friendlyResetError(error), operationId);
  }

  if (manifestCleanupFailed) {
    settingsRedirect(
      "error",
      "Workspace business data was restored, but an internal storage-manifest cleanup still requires Vaeroex support.",
      operationId
    );
  }

  settingsRedirect("message", "Workspace business data was restored from the recoverable reset.", operationId);
}

export async function retryWorkspaceResetPurgeAction(formData: FormData) {
  const workspaceId = value(formData, "workspace_id");
  const operationId = value(formData, "operation_id");
  const currentPassword = value(formData, "current_password");
  const access = await requireWorkspaceRole(["owner", "admin"]);
  if (!workspaceId || workspaceId !== access.workspaceId) {
    settingsRedirect("error", "Purge retry was blocked because the submitted workspace does not match your active workspace.", operationId);
  }
  const admin = createSupabaseAdminClient();
  if (!admin) settingsRedirect("error", "Workspace reset purge is not configured.", operationId);

  let completed = false;
  let purgeClaimed = false;
  try {
    await reauthenticateCurrentUser(access.supabase, access.user.email, currentPassword);
    const { data: operation, error } = await admin
      .from("workspace_reset_operations")
      .select("*")
      .eq("id", operationId)
      .eq("workspace_id", workspaceId)
      .eq("storage_mode", "permanent")
      .in("status", ["database_reset", "partial", "purging"])
      .maybeSingle();
    if (error || !operation) throw new Error("Permanent reset purge operation not found.");

    await requireToolExecution(
      {
        supabase: access.supabase,
        workspaceId,
        userId: access.user.id,
        userRole: access.membership.role
      },
      {
        toolName: "recover_workspace_data",
        args: { workspaceId, operationId, action: "retry_purge" },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: operationId,
        requestId: operationId
      }
    );

    const claimedOperation = await claimWorkspaceResetPurge(admin, operation as ResetOperation);
    if (!claimedOperation) throw new Error("Another verified storage purge is already running for this reset.");
    purgeClaimed = true;
    await purgeWorkspaceResetStorage({ admin, operation: claimedOperation });
    const { data: finalized, error: finalizeError } = await access.supabase.rpc("finalize_workspace_data_reset", {
      p_workspace_id: workspaceId,
      p_operation_id: operationId
    });
    if (finalizeError) throw new Error(finalizeError.message);
    const finalRecord = finalized && typeof finalized === "object" && !Array.isArray(finalized) ? finalized : {};
    if (finalRecord.status === "completed") {
      const scrubbed = await scrubCompletedManifest(admin, workspaceId, operationId);
      if (scrubbed) {
        completed = true;
      } else {
        await markResetOperationPartial(
          admin,
          workspaceId,
          operationId,
          "Private files were purged, but the completed storage manifest still requires cleanup."
        );
      }
    }
  } catch (error) {
    if (purgeClaimed) {
      await markResetOperationPartial(admin, workspaceId, operationId, friendlyResetError(error));
    }
    settingsRedirect("error", friendlyResetError(error), operationId);
  }

  if (completed) settingsRedirect("message", "Permanent workspace reset and private-file purge completed.", operationId);
  settingsRedirect("error", "Some private files still require purge. Retry later or contact Vaeroex support.", operationId);
}
