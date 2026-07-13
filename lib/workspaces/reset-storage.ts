import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logSecurityAuditEvent } from "@/lib/security/tool-execution-gateway";
import type { Database, Json } from "@/lib/supabase/types";
import {
  isExactWorkspaceStoragePath,
  WORKSPACE_RESET_MAX_OBJECTS_PER_REMOVE,
  WORKSPACE_RESET_MAX_OBJECTS_PER_PURGE_RUN,
  WORKSPACE_RESET_RETENTION_DAYS,
  WORKSPACE_RESET_STORAGE_BUCKET,
  workspaceStoragePrefix
} from "@/lib/workspaces/reset-policy";

type AdminClient = SupabaseClient<Database>;
type FileRow = Pick<
  Database["public"]["Tables"]["file_uploads"]["Row"],
  "id" | "workspace_id" | "storage_bucket" | "storage_path" | "file_size_bytes" | "mime_type" | "legal_hold"
>;
type ResetOperation = Database["public"]["Tables"]["workspace_reset_operations"]["Row"];
type StorageManifestRow = Database["public"]["Tables"]["workspace_reset_storage_objects"]["Row"];

type ListedWorkspaceObject = {
  path: string;
  sizeBytes: number | null;
  contentType: string | null;
  checksum: string | null;
  etag: string | null;
};

const STORAGE_LIST_PAGE_SIZE = 1_000;
const MAX_MANIFEST_OBJECTS = 10_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function listWorkspaceStorageObjects(admin: AdminClient, workspaceId: string): Promise<ListedWorkspaceObject[]> {
  const prefix = workspaceStoragePrefix(workspaceId);
  const pendingFolders = [prefix.slice(0, -1)];
  const visitedFolders = new Set<string>();
  const objects: ListedWorkspaceObject[] = [];

  while (pendingFolders.length) {
    const folder = pendingFolders.shift() || "";
    if (visitedFolders.has(folder)) continue;
    visitedFolders.add(folder);

    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(WORKSPACE_RESET_STORAGE_BUCKET).list(folder, {
        limit: STORAGE_LIST_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" }
      });

      if (error) {
        throw new Error("Vaeroex could not create the private storage manifest.");
      }

      const rows = data || [];
      for (const item of rows) {
        const objectPath = `${folder}/${item.name}`.replace(/^\/+/, "");
        if (!isExactWorkspaceStoragePath(workspaceId, objectPath)) {
          throw new Error("Storage manifest enumeration left the exact workspace prefix.");
        }

        const metadata = record(item.metadata);
        const isFolder = !item.id && !Object.keys(metadata).length;
        if (isFolder) {
          pendingFolders.push(objectPath);
          continue;
        }

        objects.push({
          path: objectPath,
          sizeBytes: numberValue(metadata.size),
          contentType: text(metadata.mimetype) || text(metadata.contentType),
          checksum: text(metadata.checksum),
          etag: text(metadata.eTag) || text(metadata.etag)
        });

        if (objects.length > MAX_MANIFEST_OBJECTS) {
          throw new Error("This workspace has too many stored objects for an interactive reset. Contact Vaeroex support for a controlled reset.");
        }
      }

      if (rows.length < STORAGE_LIST_PAGE_SIZE) break;
      offset += rows.length;
    }
  }

  return objects;
}

export async function buildWorkspaceResetStorageManifest({
  admin,
  workspaceId,
  operationId
}: {
  admin: AdminClient;
  workspaceId: string;
  operationId: string;
}) {
  const { data: operation, error: operationError } = await admin
    .from("workspace_reset_operations")
    .select("*")
    .eq("id", operationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (operationError || !operation) {
    throw new Error("The prepared workspace reset operation could not be found.");
  }

  if (operation.status !== "manifesting") {
    if (operation.manifest_completed_at) {
      return { objectCount: Number(record(operation.storage_summary).object_count || 0), idempotent: true };
    }
    throw new Error("The workspace reset is not ready for storage manifesting.");
  }

  const { data: files, error: fileError } = await admin
    .from("file_uploads")
    .select("id,workspace_id,storage_bucket,storage_path,file_size_bytes,mime_type,legal_hold")
    .eq("workspace_id", workspaceId);

  if (fileError) {
    throw new Error("Vaeroex could not inventory source file records.");
  }

  const fileRows = (files || []) as FileRow[];
  const invalidFile = fileRows.find(
    (file) => file.storage_bucket !== WORKSPACE_RESET_STORAGE_BUCKET || !isExactWorkspaceStoragePath(workspaceId, file.storage_path)
  );

  if (invalidFile) {
    throw new Error("A source file points outside this workspace's approved private storage prefix. No reset was performed.");
  }

  const listedObjects = await listWorkspaceStorageObjects(admin, workspaceId);
  const { data: currentOperation, error: currentOperationError } = await admin
    .from("workspace_reset_operations")
    .select("id")
    .eq("id", operationId)
    .eq("workspace_id", workspaceId)
    .eq("status", "manifesting")
    .maybeSingle();

  if (currentOperationError || !currentOperation) {
    throw new Error("The workspace reset manifest is no longer active.");
  }

  const listedByPath = new Map(listedObjects.map((object) => [object.path, object]));
  const fileByPath = new Map(fileRows.map((file) => [file.storage_path, file]));
  const retentionDeadline = new Date(
    Date.now() + (operation.storage_mode === "recoverable" ? WORKSPACE_RESET_RETENTION_DAYS * 24 * 60 * 60 * 1_000 : 0)
  ).toISOString();

  const entries: Database["public"]["Tables"]["workspace_reset_storage_objects"]["Insert"][] = listedObjects.map((object) => ({
    operation_id: operationId,
    workspace_id: workspaceId,
    bucket_id: WORKSPACE_RESET_STORAGE_BUCKET,
    object_path: object.path,
    source_file_id: fileByPath.get(object.path)?.id || null,
    size_bytes: object.sizeBytes,
    content_type: object.contentType,
    checksum: object.checksum,
    etag: object.etag,
    retention_deadline: retentionDeadline,
    purge_status: "pending",
    legal_hold: fileByPath.get(object.path)?.legal_hold || false
  }));

  for (const file of fileRows) {
    if (listedByPath.has(file.storage_path)) continue;
    entries.push({
      operation_id: operationId,
      workspace_id: workspaceId,
      bucket_id: WORKSPACE_RESET_STORAGE_BUCKET,
      object_path: file.storage_path,
      source_file_id: file.id,
      size_bytes: file.file_size_bytes,
      content_type: file.mime_type,
      retention_deadline: retentionDeadline,
      purge_status: "missing",
      legal_hold: file.legal_hold,
      failure_summary: "The database source row existed, but the private storage object was already missing."
    });
  }

  const { error: clearError } = await admin
    .from("workspace_reset_storage_objects")
    .delete()
    .eq("operation_id", operationId)
    .eq("workspace_id", workspaceId);

  if (clearError) {
    throw new Error("Vaeroex could not safely refresh the storage manifest.");
  }

  for (const batch of chunks(entries, 500)) {
    if (!batch.length) continue;
    const { error } = await admin.from("workspace_reset_storage_objects").insert(batch);
    if (error) {
      throw new Error("Vaeroex could not store the complete private storage manifest.");
    }
  }

  const storageSummary = {
    object_count: entries.length,
    listed_object_count: listedObjects.length,
    missing_object_count: entries.filter((entry) => entry.purge_status === "missing").length,
    source_file_count: fileRows.length,
    bucket: WORKSPACE_RESET_STORAGE_BUCKET,
    prefix: workspaceStoragePrefix(workspaceId)
  } satisfies Json;

  const { data: completedOperation, error: completeError } = await admin
    .from("workspace_reset_operations")
    .update({
      manifest_completed_at: new Date().toISOString(),
      storage_summary: storageSummary,
      failure_summary: null
    })
    .eq("id", operationId)
    .eq("workspace_id", workspaceId)
    .eq("status", "manifesting")
    .select("id")
    .maybeSingle();

  if (completeError || !completedOperation) {
    throw new Error("Vaeroex could not finalize the storage manifest.");
  }

  return { objectCount: entries.length, idempotent: false };
}

async function updateManifestRows(
  admin: AdminClient,
  workspaceId: string,
  ids: string[],
  update: Database["public"]["Tables"]["workspace_reset_storage_objects"]["Update"]
) {
  if (!ids.length) return;
  const { error } = await admin
    .from("workspace_reset_storage_objects")
    .update(update)
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  if (error) throw new Error("Vaeroex could not update the storage purge ledger.");
}

export async function purgeWorkspaceResetStorage({
  admin,
  operation
}: {
  admin: AdminClient;
  operation: ResetOperation;
}) {
  if (operation.legal_hold) {
    throw new Error("This reset is under legal hold and cannot be purged.");
  }

  const { data, error } = await admin
    .from("workspace_reset_storage_objects")
    .select("*")
    .eq("operation_id", operation.id)
    .eq("workspace_id", operation.workspace_id);

  if (error) throw new Error("Vaeroex could not load the storage purge manifest.");

  const allRows = (data || []) as StorageManifestRow[];
  const invalid = allRows.find(
    (row) => row.bucket_id !== WORKSPACE_RESET_STORAGE_BUCKET || !isExactWorkspaceStoragePath(operation.workspace_id, row.object_path)
  );
  if (invalid) {
    throw new Error("Storage purge was blocked because the manifest contains an out-of-scope object.");
  }

  if (allRows.some((row) => row.legal_hold)) {
    throw new Error("This reset includes a private object under legal hold and cannot be purged.");
  }

  if (allRows.some((row) => row.purge_status === "restored")) {
    throw new Error("Restored storage cannot be purged by an old reset operation.");
  }

  const rows = allRows
    .filter((row) => ["pending", "retained", "failed", "purging"].includes(row.purge_status))
    .slice(0, WORKSPACE_RESET_MAX_OBJECTS_PER_PURGE_RUN);

  for (const batch of chunks(rows, WORKSPACE_RESET_MAX_OBJECTS_PER_REMOVE)) {
    const attemptedAt = new Date().toISOString();
    await updateManifestRows(admin, operation.workspace_id, batch.map((row) => row.id), {
      purge_status: "purging",
      purge_attempts: Math.max(...batch.map((row) => row.purge_attempts), 0) + 1,
      last_attempted_at: attemptedAt,
      failure_summary: null
    });

    const { error: removeError } = await admin.storage
      .from(WORKSPACE_RESET_STORAGE_BUCKET)
      .remove(batch.map((row) => row.object_path));

    if (removeError) {
      await updateManifestRows(admin, operation.workspace_id, batch.map((row) => row.id), {
        purge_status: "failed",
        failure_summary: "The Storage API did not confirm deletion."
      });
    }
  }

  const remainingPaths = new Set((await listWorkspaceStorageObjects(admin, operation.workspace_id)).map((object) => object.path));
  const purgedRows = rows.filter((row) => !remainingPaths.has(row.object_path));
  const failedRows = rows.filter((row) => remainingPaths.has(row.object_path));
  const purgedAt = new Date().toISOString();

  await updateManifestRows(admin, operation.workspace_id, purgedRows.map((row) => row.id), {
    purge_status: "purged",
    purged_at: purgedAt,
    failure_summary: null
  });
  await updateManifestRows(admin, operation.workspace_id, failedRows.map((row) => row.id), {
    purge_status: "failed",
    failure_summary: "The object remained after the Storage API deletion attempt."
  });

  const alreadyUnavailable = allRows.filter((row) => row.purge_status === "purged" || row.purge_status === "missing").length;
  return {
    total: allRows.length,
    purged: alreadyUnavailable + purgedRows.length,
    failed: failedRows.length
  };
}

async function finishServicePurge({
  admin,
  operation,
  result
}: {
  admin: AdminClient;
  operation: ResetOperation;
  result: { total: number; purged: number; failed: number };
}) {
  const successful = result.failed === 0 && result.purged === result.total;
  const finalStatus = successful ? (operation.storage_mode === "recoverable" ? "expired" : "completed") : "partial";
  const completedAt = successful ? new Date().toISOString() : operation.completed_at;

  const { error: auditError } = await admin.from("audit_logs").insert({
    workspace_id: operation.workspace_id,
    actor_user_id: operation.initiated_by,
    action: successful ? "workspace_reset_storage_purged" : "workspace_reset_storage_partial",
    entity_type: "workspace_reset_operation",
    entity_id: operation.id,
    metadata_json: {
      storage_mode: operation.storage_mode,
      status: finalStatus,
      storage_object_count: result.total,
      storage_failed: result.failed
    }
  });
  if (auditError) throw new Error("Vaeroex could not retain the workspace storage purge audit event.");

  await logSecurityAuditEvent({
    supabase: admin,
    workspaceId: operation.workspace_id,
    userId: operation.initiated_by,
    actionName: "system.workspace_reset_storage_purge",
    operationType: "SYSTEM",
    targetTable: "workspace_reset_operations",
    targetRecordId: operation.id,
    initiatedBy: "system",
    allowed: successful,
    reasonBlocked: successful ? null : "One or more exact-prefix objects remain pending purge.",
    requestId: operation.id,
    metadata: { storage_mode: operation.storage_mode, object_count: result.total, failed: result.failed }
  });

  if (successful) {
    const { error: backupError } = await admin
      .from("workspace_reset_record_backups")
      .delete()
      .eq("operation_id", operation.id)
      .eq("workspace_id", operation.workspace_id);
    if (backupError) throw new Error("Vaeroex purged storage but could not remove expired recovery rows.");

    const { error: manifestError } = await admin
      .from("workspace_reset_storage_objects")
      .delete()
      .eq("operation_id", operation.id)
      .eq("workspace_id", operation.workspace_id);
    if (manifestError) throw new Error("Vaeroex purged storage but could not minimize the completed storage manifest.");
  }

  const { error: updateError } = await admin
    .from("workspace_reset_operations")
    .update({
      status: finalStatus,
      completed_at: completedAt,
      failure_summary: successful ? null : "One or more private storage objects remain pending purge.",
      storage_summary: {
        object_count: result.total,
        purged_or_missing: result.purged,
        failed: result.failed
      },
      workspace_context_before: successful ? {} : operation.workspace_context_before
    })
    .eq("id", operation.id)
    .eq("workspace_id", operation.workspace_id);

  if (updateError) throw new Error("Vaeroex could not finalize the storage purge operation.");

  return { status: finalStatus, ...result };
}

export async function claimWorkspaceResetPurge(admin: AdminClient, operation: ResetOperation) {
  const staleClaimCutoff = new Date(Date.now() - 15 * 60 * 1_000).toISOString();
  let query = admin
    .from("workspace_reset_operations")
    .update({ status: "purging", failure_summary: null })
    .eq("id", operation.id)
    .eq("workspace_id", operation.workspace_id);

  query = operation.status === "purging"
    ? query.eq("status", "purging").lt("updated_at", staleClaimCutoff)
    : query.eq("status", operation.status);

  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw new Error("Vaeroex could not claim the workspace storage purge operation.");
  return (data as ResetOperation | null) || null;
}

export async function processDueWorkspaceResetPurges(admin: AdminClient, limit = 10) {
  const now = new Date().toISOString();
  const [{ data: recoverable, error: recoverableError }, { data: permanent, error: permanentError }] = await Promise.all([
    admin
      .from("workspace_reset_operations")
      .select("*")
      .eq("storage_mode", "recoverable")
      .in("status", ["recoverable", "partial", "purging"])
      .eq("legal_hold", false)
      .lte("purge_after", now)
      .order("purge_after", { ascending: true })
      .limit(limit),
    admin
      .from("workspace_reset_operations")
      .select("*")
      .eq("storage_mode", "permanent")
      .eq("legal_hold", false)
      .in("status", ["database_reset", "partial", "purging"])
      .order("created_at", { ascending: true })
      .limit(limit)
  ]);

  if (recoverableError || permanentError) {
    throw new Error("Vaeroex could not load due workspace reset purges.");
  }

  const operations = [...((recoverable || []) as ResetOperation[]), ...((permanent || []) as ResetOperation[])].slice(0, limit);
  const results: Array<{ operationId: string; status: string; failed?: number; error?: string }> = [];

  for (const operation of operations) {
    let claimedOperation: ResetOperation | null = null;
    try {
      claimedOperation = await claimWorkspaceResetPurge(admin, operation);
      if (!claimedOperation) {
        results.push({ operationId: operation.id, status: "deferred" });
        continue;
      }

      const purge = await purgeWorkspaceResetStorage({ admin, operation: claimedOperation });
      const final = await finishServicePurge({ admin, operation: claimedOperation, result: purge });
      results.push({ operationId: operation.id, status: final.status, failed: final.failed });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workspace reset purge failed.";
      if (claimedOperation) {
        await admin
          .from("workspace_reset_operations")
          .update({ status: "partial", failure_summary: message })
          .eq("id", operation.id)
          .eq("workspace_id", operation.workspace_id)
          .eq("status", "purging");
      }
      results.push({ operationId: operation.id, status: "partial", error: message });
    }
  }

  return results;
}

async function storageObjectExists(admin: AdminClient, objectPath: string) {
  const { data, error } = await admin.storage.from(WORKSPACE_RESET_STORAGE_BUCKET).exists(objectPath);
  if (data === false) return false;
  if (error) throw new Error("Vaeroex could not verify the source-file purge.");
  return data;
}

async function recordSourcePurgeFailure(admin: AdminClient, file: FileRow, message: string) {
  const { error } = await admin
    .from("file_uploads")
    .update({ purge_error: message })
    .eq("id", file.id)
    .eq("workspace_id", file.workspace_id)
    .is("purged_at", null);
  if (error) throw new Error("Vaeroex could not retain the source-file purge failure state.");
}

export async function processDueSourceFilePurges(admin: AdminClient, limit = 100) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("file_uploads")
    .select("id,workspace_id,storage_bucket,storage_path,file_size_bytes,mime_type,legal_hold")
    .not("deleted_at", "is", null)
    .is("purged_at", null)
    .eq("legal_hold", false)
    .lte("purge_after", now)
    .order("purge_after", { ascending: true })
    .limit(limit);

  if (error) throw new Error("Vaeroex could not load due source-file purges.");

  const files = (data || []) as FileRow[];
  const results: Array<{ fileId: string; status: "purged" | "failed" | "deferred" }> = [];
  for (const file of files) {
    const { data: claimed, error: claimError } = await admin.rpc("claim_source_file_purge", {
      p_workspace_id: file.workspace_id,
      p_file_id: file.id
    });
    if (claimError) {
      results.push({ fileId: file.id, status: "failed" });
      continue;
    }
    if (!claimed) {
      results.push({ fileId: file.id, status: "deferred" });
      continue;
    }

    if (file.storage_bucket !== WORKSPACE_RESET_STORAGE_BUCKET || !isExactWorkspaceStoragePath(file.workspace_id, file.storage_path)) {
      await recordSourcePurgeFailure(admin, file, "Storage path failed exact workspace-prefix validation.");
      results.push({ fileId: file.id, status: "failed" });
      continue;
    }

    const { error: removeError } = await admin.storage.from(WORKSPACE_RESET_STORAGE_BUCKET).remove([file.storage_path]);
    if (removeError) {
      await recordSourcePurgeFailure(admin, file, "The Storage API did not confirm deletion.");
      results.push({ fileId: file.id, status: "failed" });
      continue;
    }

    let remains = true;
    try {
      remains = await storageObjectExists(admin, file.storage_path);
    } catch {
      await recordSourcePurgeFailure(admin, file, "The Storage API deletion could not be verified.");
      results.push({ fileId: file.id, status: "failed" });
      continue;
    }

    if (remains) {
      await recordSourcePurgeFailure(admin, file, "The private object remained after the Storage API deletion attempt.");
      results.push({ fileId: file.id, status: "failed" });
      continue;
    }

    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_source_file_purge", {
      p_workspace_id: file.workspace_id,
      p_file_id: file.id
    });
    if (finalizeError || !finalized) {
      await recordSourcePurgeFailure(
        admin,
        file,
        "The private object was removed, but purge audit finalization must be retried."
      );
      results.push({ fileId: file.id, status: "failed" });
      continue;
    }
    results.push({ fileId: file.id, status: "purged" });
  }

  return results;
}

export async function markResetOperationFailed(
  admin: AdminClient,
  workspaceId: string,
  operationId: string,
  message: string
) {
  const { data } = await admin
    .from("workspace_reset_operations")
    .update({ status: "failed", failure_summary: message.slice(0, 1_000) })
    .eq("id", operationId)
    .eq("workspace_id", workspaceId)
    .in("status", ["manifesting", "in_progress"])
    .select("id")
    .maybeSingle();

  // Only an operation proven to remain pre-database is safe to minimize here.
  // If the reset committed but its HTTP response was lost, the status no longer
  // matches and its recovery/purge manifest remains intact.
  if (data) {
    await admin
      .from("workspace_reset_storage_objects")
      .delete()
      .eq("operation_id", operationId)
      .eq("workspace_id", workspaceId);
  }
}

export async function markResetOperationPartial(
  admin: AdminClient,
  workspaceId: string,
  operationId: string,
  message: string
) {
  await admin
    .from("workspace_reset_operations")
    .update({ status: "partial", failure_summary: message.slice(0, 1_000) })
    .eq("id", operationId)
    .eq("workspace_id", workspaceId)
    .in("status", ["database_reset", "purging", "completed", "partial"]);
}
