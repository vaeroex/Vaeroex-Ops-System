"use client";

import { useState, type ReactNode } from "react";
import { EvidenceLifecycleSelection, type EvidenceLifecycleResult } from "@/components/evidence/EvidenceLifecycleSelection";

type EvidenceBatchItem = Readonly<{
  id: string;
  label: string;
  approvable?: boolean;
  content: ReactNode;
}>;

const BATCH_SIZE = 25;

/** Display batches of the already-loaded matching records; this does not fetch history. */
export function EvidenceBatchList({
  items,
  pluralLabel,
  className = "space-y-3",
  selection
}: {
  items: readonly EvidenceBatchItem[];
  pluralLabel: string;
  className?: string;
  selection?: {
    singularLabel: string;
    archived?: boolean;
    action: (input: { ids: string[]; action: "approve" | "archive" | "restore" | "delete"; typedConfirmation?: string }) => Promise<EvidenceLifecycleResult>;
  };
}) {
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const visibleItems = items.slice(0, visibleCount);
  const records = <div className={className}>{visibleItems.map((item) => <div key={item.id}>{item.content}</div>)}</div>;

  return (
    <div>
      <p className="mb-3 text-xs text-slate-400" role="status">
        Showing {visibleItems.length} of {items.length} loaded {pluralLabel} matching this view.
      </p>
      {selection ? (
        <>
          <p className="mb-2 text-xs text-slate-400">Selection applies only to the records shown below.</p>
          <EvidenceLifecycleSelection items={visibleItems} {...selection}>
            {records}
          </EvidenceLifecycleSelection>
        </>
      ) : records}
      {visibleItems.length < items.length ? (
        <button
          type="button"
          onClick={() => setVisibleCount((current) => current + BATCH_SIZE)}
          className="mt-4 min-h-11 rounded-md border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/[0.08]"
        >
          Show {Math.min(BATCH_SIZE, items.length - visibleItems.length)} more {pluralLabel}
        </button>
      ) : null}
    </div>
  );
}
