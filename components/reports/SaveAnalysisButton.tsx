"use client";

import Link from "next/link";
import { BookmarkCheck, Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import {
  getSavedAnalysisState,
  saveAnalysisAction
} from "@/app/app/reports/saved-analysis-actions";
import type { SavedAnalysisType } from "@/lib/reports/saved-analysis";

export function SaveAnalysisButton({
  analysisType,
  fingerprint,
  generatedAt,
  light = false
}: {
  analysisType: SavedAnalysisType;
  fingerprint: string;
  generatedAt: string;
  light?: boolean;
}) {
  const [savedId, setSavedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    setSavedId(null);
    setMessage(null);
    setChecking(true);
    getSavedAnalysisState({ analysisType, fingerprint, generatedAt })
      .then((result) => {
        if (active && result.saved) setSavedId(result.id);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [analysisType, fingerprint, generatedAt]);

  function save() {
    if (savedId || pending) return;
    setMessage(null);
    startTransition(async () => {
      const result = await saveAnalysisAction({ analysisType, fingerprint, generatedAt });
      if ((result.status === "saved" || result.status === "already_saved") && result.id) {
        setSavedId(result.id);
      }
      setMessage(result.message);
    });
  }

  const base = light
    ? "border-line bg-white text-ink hover:bg-vaeroex-soft"
    : "border-white/15 bg-white/[0.05] text-white hover:bg-white/[0.1]";

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-current/10 pt-5" data-save-analysis>
      {savedId ? (
        <>
          <span className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold ${base}`}>
            <BookmarkCheck aria-hidden="true" className="h-4 w-4" /> Already saved
          </span>
          <Link href={`/app/reports/${savedId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue hover:underline">
            View saved analysis
          </Link>
        </>
      ) : (
        <button
          type="button"
          onClick={save}
          disabled={pending || checking}
          className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${base}`}
        >
          {pending || checking ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <BookmarkCheck aria-hidden="true" className="h-4 w-4" />}
          {pending ? "Saving..." : checking ? "Checking..." : "Save Analysis"}
        </button>
      )}
      {message && !savedId ? <p className="text-sm text-amber-200" role="status">{message}</p> : null}
    </div>
  );
}
