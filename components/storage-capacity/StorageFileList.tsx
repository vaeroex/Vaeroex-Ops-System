"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import type { StorageLifecycleAction, StorageUsageFile } from "@/lib/storage-capacity/contracts";
import { formatStorageBytes } from "@/lib/storage-capacity/policy";

const stateLabels = { active: "Active", archived: "Archived", trash: "Trash", historical_trash: "Protected historical Trash" };

function confirmation(file: StorageUsageFile, action: StorageLifecycleAction) {
  if (action === "purge") return `Permanently delete “${file.displayName}”? The original cannot be recovered after deletion. Its storage is released once deletion is confirmed. Saved analyses and imported business records are not deleted by this action.`;
  if (action === "delete") return `Move “${file.displayName}” to Trash? The original remains recoverable for 30 days and continues to use storage and a file slot until permanently deleted. Saved analyses and imported business records are retained.`;
  if (action === "restore") return `Restore “${file.displayName}” to active files? This retained original already uses storage and a file slot, so restoration remains available even above the workspace allowance.`;
  return `Archive “${file.displayName}”? It will remain stored and continue to use both bytes and a file slot.`;
}

export function StorageFileList({ workspaceId, files, canManage, emptyMessage = "No stored originals.", onChanged }: {
  workspaceId: string; files: StorageUsageFile[]; canManage: boolean; emptyMessage?: string; onChanged?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);

  async function changeFile(file: StorageUsageFile, action: StorageLifecycleAction) {
    if (busy || !window.confirm(confirmation(file, action))) return;
    setBusy(file.id);
    setFeedback(null);
    try {
      const response = await fetch("/api/storage-capacity/lifecycle", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, fileId: file.id, action }),
      });
      const result: { error?: string; message?: string; pending?: boolean } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The file change could not be confirmed.");
      setFeedback({ error: false, text: result.message ?? (result.pending ? "Permanent deletion is pending. Storage will be released when deletion completes." : "File updated. Refreshing workspace usage.") });
      onChanged?.();
      router.refresh();
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : "The file change could not be confirmed. Refresh before trying again." });
    } finally { setBusy(null); }
  }

  return <div>
    {feedback ? <p role={feedback.error ? "alert" : "status"} className={`mb-3 rounded-md border p-3 text-sm ${feedback.error ? "border-red-200 bg-red-50 text-red-800" : "border-line text-ink"}`}>{feedback.text}</p> : null}
    {files.length === 0 ? <p className="py-3 text-sm text-muted">{emptyMessage}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <caption className="sr-only">Original files, retained size, lifecycle state, and available actions</caption>
      <thead><tr className="border-b border-line text-xs text-muted"><th scope="col" className="pb-2 font-medium">File</th><th scope="col" className="px-3 pb-2 text-right font-medium">Size</th><th scope="col" className="px-3 pb-2 font-medium">State</th><th scope="col" className="pb-2 font-medium">Actions</th></tr></thead>
      <tbody>{files.map(file => {
        const inTrash = file.state === "trash" || file.state === "historical_trash";
        return <tr key={file.id} className="border-b border-line align-top last:border-0">
          <th scope="row" className="min-w-40 max-w-sm py-3 font-medium text-ink">
            {inTrash || file.storageMissing ? <span className="break-words">{file.displayName}</span> : <Link href={`/app/sources/${encodeURIComponent(file.id)}`} className="break-words text-vaeroex-blue underline underline-offset-2">{file.displayName}</Link>}
          </th>
          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{file.storageMissing ? "Original missing" : formatStorageBytes(file.bytes)}</td>
          <td className="min-w-36 px-3 py-3 text-muted">{stateLabels[file.state]}
            {file.deletionPending ? <span className="mt-1 block text-xs text-amber-800">Deletion pending; bytes still retained</span> : null}
            {file.legacyProtected ? <span className="mt-1 block text-xs">No automatic deletion scheduled</span> : file.purgeAfter ? <span className="mt-1 block text-xs">Permanent deletion after {new Date(file.purgeAfter).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" })} UTC</span> : null}
          </td>
          <td className="min-w-44 py-2"><div className="flex flex-wrap gap-x-3 gap-y-1">
            {!file.storageMissing && !file.deletionPending ? <a href={`/api/storage-capacity/download?workspaceId=${encodeURIComponent(workspaceId)}&fileId=${encodeURIComponent(file.id)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue">Download</a> : null}
            {canManage && !file.deletionPending ? <>
              {!file.storageMissing ? <button type="button" disabled={busy !== null} onClick={() => changeFile(file, file.state === "active" ? "archive" : "restore")} className="min-h-11 font-semibold text-vaeroex-blue disabled:opacity-50">{busy === file.id ? "Updating…" : file.state === "active" ? "Archive" : "Restore"}</button> : null}
              {!(inTrash && file.legacyProtected) ? <button type="button" disabled={busy !== null} onClick={() => changeFile(file, inTrash ? "purge" : "delete")} className="min-h-11 font-semibold text-red-700 disabled:opacity-50">{inTrash ? "Delete permanently" : "Move to Trash"}</button> : <span className="py-3 text-xs text-muted">Protected pending retention notice</span>}
            </> : null}
            {file.storageMissing && !canManage ? <span className="py-3 text-xs text-muted">Original unavailable</span> : null}
          </div></td>
        </tr>;
      })}</tbody>
    </table></div>}
  </div>;
}
