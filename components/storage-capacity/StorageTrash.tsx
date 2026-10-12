"use client";

import { useEffect, useState } from "react";
import { StorageFileList } from "@/components/storage-capacity/StorageFileList";
import type { StorageTrashPage } from "@/lib/storage-capacity/contracts";

export function StorageTrash({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<StorageTrashPage | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setError(null);
    fetch(`/api/storage-capacity/trash?workspaceId=${encodeURIComponent(workspaceId)}&page=${page}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data: StorageTrashPage & { error?: string } = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Trash could not be loaded.");
        if (!controller.signal.aborted) {
          if (data.files.length === 0 && page > 1) setPage(page - 1);
          else setResult(data);
        }
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Trash could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [workspaceId, page, version]);

  return <section id="storage-trash" aria-labelledby="storage-trash-heading" className="rounded-lg border border-line bg-white p-4 sm:p-5">
    <h2 id="storage-trash-heading" className="text-base font-semibold text-ink">Trash & recovery</h2>
    <p className="mt-1 text-sm text-muted">Restore or download retained originals before permanent deletion. Protected historical Trash has no automatic deletion date. Permanent deletion requires explicit confirmation.</p>
    <div className="mt-4" aria-busy={pending}>
      {pending ? <p role="status" className="py-3 text-sm text-muted">Loading Trash…</p> : null}
      {error ? <div role="alert" className="space-y-2 text-sm text-red-700"><p>{error}</p><button type="button" onClick={() => setVersion(value => value + 1)} className="min-h-11 font-semibold underline">Retry loading Trash</button></div> : null}
      {!pending && !error && result ? <>
        <StorageFileList workspaceId={workspaceId} files={result.files} canManage={canManage} emptyMessage="Trash is empty." onChanged={() => setVersion(value => value + 1)} />
        {result.total > result.pageSize ? <nav aria-label="Trash pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)} className="min-h-11 rounded-md border border-line px-3 font-semibold text-vaeroex-blue disabled:opacity-40">Previous</button>
          <span className="text-muted">Page {page} of {Math.ceil(result.total / result.pageSize)} · {result.total.toLocaleString("en-US")} retained files</span>
          <button type="button" disabled={page * result.pageSize >= result.total} onClick={() => setPage(value => value + 1)} className="min-h-11 rounded-md border border-line px-3 font-semibold text-vaeroex-blue disabled:opacity-40">Next</button>
        </nav> : null}
      </> : null}
    </div>
  </section>;
}
