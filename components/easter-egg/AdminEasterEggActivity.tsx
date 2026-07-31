"use client";

import { Check, Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateEasterEggDisplayNameAction } from "@/app/app/admin/easter-egg/actions";

type PendingName = { workspace_id: string; public_display_name: string | null; updated_at: string };

export function AdminEasterEggModeration({ pending }: { pending: PendingName[] }) {
  const router = useRouter();
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function moderate(workspaceId: string, decision: "approve" | "reject") {
    setActiveWorkspace(workspaceId);
    startTransition(async () => {
      const result = await moderateEasterEggDisplayNameAction({
        workspaceId,
        decision,
        reasonCode: decision === "reject" ? "inappropriate" : undefined
      });
      setMessage(result.message);
      setActiveWorkspace(null);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div>
      {message ? <p className="mb-3 rounded-md border border-line bg-slate-50 px-3 py-2 text-sm text-ink" role="status">{message}</p> : null}
      <div className="divide-y divide-line">
        {pending.length ? pending.map((item) => (
          <article key={item.workspace_id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{item.public_display_name || "Missing display name"}</p>
              <p className="mt-1 text-xs text-muted">Submitted {new Date(item.updated_at).toLocaleString()}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={isPending} onClick={() => moderate(item.workspace_id, "approve")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50">
                {isPending && activeWorkspace === item.workspace_id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}Approve
              </button>
              <button type="button" disabled={isPending} onClick={() => moderate(item.workspace_id, "reject")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" />Reject</button>
            </div>
          </article>
        )) : <p className="py-6 text-sm text-muted">No public display names are waiting for review.</p>}
      </div>
    </div>
  );
}
