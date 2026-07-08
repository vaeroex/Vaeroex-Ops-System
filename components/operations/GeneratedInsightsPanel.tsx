"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteGeneratedInsightsAction } from "@/app/app/sources/actions";

export type GeneratedInsightItem = {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  confidence?: string;
  evidenceHref?: Route;
};

function insightDeleteMessage(count: number) {
  return `Delete ${count} generated insight${count === 1 ? "" : "s"}? This removes ${count === 1 ? "it" : "them"} from saved context and future Vaeroex answers.`;
}

function insightSuccessMessage(count: number) {
  return `Deleted ${count} insight${count === 1 ? "" : "s"}.`;
}

export function GeneratedInsightsPanel({ insights }: { insights: GeneratedInsightItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(insights);
  const [expanded, setExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [showDelayedPending, setShowDelayedPending] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    setItems(insights);
    setSelectedIds(new Set());
  }, [insights]);

  useEffect(() => {
    if (!pending) {
      setShowDelayedPending(false);
      document.documentElement.style.cursor = "";
      return;
    }

    const timer = window.setTimeout(() => {
      setShowDelayedPending(true);
      document.documentElement.style.cursor = "progress";
    }, 500);

    return () => {
      window.clearTimeout(timer);
      document.documentElement.style.cursor = "";
    };
  }, [pending]);

  const visibleItems = expanded ? items : items.slice(0, 5);
  const visibleSelectedCount = visibleItems.filter((item) => selectedIds.has(item.id)).length;
  const allVisibleSelected = visibleItems.length > 0 && visibleSelectedCount === visibleItems.length;

  function toggleSelection(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      visibleItems.forEach((item) => {
        if (checked) {
          next.add(item.id);
        } else {
          next.delete(item.id);
        }
      });
      return next;
    });
  }

  async function deleteInsights(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids)).filter((id) => items.some((item) => item.id === id));

    if (!uniqueIds.length || pending) {
      return;
    }

    if (!window.confirm(insightDeleteMessage(uniqueIds.length))) {
      return;
    }

    setNotice(null);
    setPending(true);
    setPendingText(`Deleting ${uniqueIds.length} generated insight${uniqueIds.length === 1 ? "" : "s"}...`);

    try {
      const result = await deleteGeneratedInsightsAction(uniqueIds);

      if (!result.ok) {
        throw new Error(result.error || "Generated insights could not be deleted.");
      }

      setItems((current) => current.filter((item) => !uniqueIds.includes(item.id)));
      setSelectedIds((current) => {
        const next = new Set(current);
        uniqueIds.forEach((id) => next.delete(id));
        return next;
      });
      setNotice({ type: "success", message: insightSuccessMessage(result.deletedCount || uniqueIds.length) });
      router.refresh();
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Generated insights could not be deleted."
      });
    } finally {
      setPending(false);
      setPendingText("");
      setShowDelayedPending(false);
      document.documentElement.style.cursor = "";
    }
  }

  return (
    <div id="source-insights" className="scroll-mt-24 rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Generated Insights</h2>
          <p className="mt-1 text-sm text-slate-300">
            File reviews that may inform future Vaeroex answers, briefings, and Business Memory.
          </p>
        </div>
        {items.length > 5 ? (
          <button
            type="button"
            onClick={() => {
              setExpanded((value) => !value);
              setNotice(null);
            }}
            className="inline-flex min-h-10 w-fit items-center rounded-md border border-cyan-300/30 bg-cyan-950/25 px-3 py-2 text-xs font-semibold text-cyan-50 hover:border-cyan-300/60 hover:bg-cyan-950/40"
          >
            {expanded ? "Collapse insights" : "View all insights"}
          </button>
        ) : null}
      </div>

      {items.length ? (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-cyan-400/20 bg-cyan-950/15 p-3 md:flex-row md:items-center md:justify-between">
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-cyan-50">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => toggleAllVisible(event.currentTarget.checked)}
              className="h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent"
            />
            Select all visible
          </label>
          <p className="text-xs text-cyan-100">
            Showing {visibleItems.length} of {items.length}. {selectedIds.size ? `${selectedIds.size} selected.` : "No insights selected."}
          </p>
          <button
            type="button"
            disabled={!selectedIds.size || pending}
            onClick={() => deleteInsights(Array.from(selectedIds))}
            className="min-h-10 rounded-md border border-red-400/35 bg-red-950/35 px-3 py-2 text-xs font-semibold text-red-100 hover:border-red-300/60 hover:bg-red-950/55 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Deleting..." : "Delete selected insights"}
          </button>
        </div>
      ) : null}

      {showDelayedPending && pendingText ? (
        <div className="mt-3 rounded-lg border border-vaeroex-accent/35 bg-blue-950/30 p-3 text-sm text-cyan-50" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 animate-pulse rounded-full bg-vaeroex-accent" />
            <span>{pendingText}</span>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div
          className={`mt-3 rounded-lg border p-3 text-sm ${
            notice.type === "success" ? "border-emerald-400/35 bg-emerald-950/30 text-emerald-100" : "border-red-400/35 bg-red-950/35 text-red-100"
          }`}
          role="status"
          aria-live="polite"
        >
          {notice.message}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {visibleItems.map((item) => (
          <article key={item.id} className="rounded-lg border border-white/10 bg-slate-950/45 p-3 transition hover:border-cyan-300/35 hover:bg-cyan-950/20">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={(event) => toggleSelection(item.id, event.currentTarget.checked)}
                  aria-label={`Select ${item.title}`}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words text-sm font-semibold text-white">{item.title}</h3>
                    {item.confidence ? (
                      <span className="rounded-full border border-cyan-300/35 bg-cyan-950/35 px-2.5 py-1 text-xs font-semibold text-cyan-50">
                        Confidence: {item.confidence}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">{item.summary}</p>
                  <p className="mt-2 text-xs text-slate-500">Created {item.createdAt}</p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                {item.evidenceHref ? (
                  <Link href={item.evidenceHref} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-cyan-50 hover:border-cyan-300/40 hover:bg-cyan-950/30">
                    Open source evidence
                  </Link>
                ) : null}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => deleteInsights([item.id])}
                  className="rounded-md border border-red-400/35 bg-red-950/35 px-3 py-2 text-xs font-semibold text-red-100 hover:border-red-300/60 hover:bg-red-950/55 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          </article>
        ))}
        {!items.length ? <p className="text-sm leading-6 text-slate-400">No generated insights yet.</p> : null}
      </div>
    </div>
  );
}
