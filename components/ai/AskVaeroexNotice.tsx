"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "vaeroex.ask-notice.dismissed";

export function AskVaeroexNotice() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(STORAGE_KEY) === "1");
    setReady(true);
  }, []);

  if (!ready || dismissed) {
    return null;
  }

  return (
    <details className="rounded-lg border border-amber-300/30 bg-amber-950/20 p-3 text-sm text-amber-50">
      <summary className="cursor-pointer font-semibold text-amber-100">
        Sensitive information reminder
      </summary>
      <div className="mt-3 space-y-3 text-xs leading-5 text-amber-50/85">
        <p>
          Do not enter patient data, PHI/ePHI, Social Security numbers, medical record numbers,
          insurance IDs, payment card numbers, or other regulated sensitive information unless
          proper controls and agreements are in place.
        </p>
        <p>
          <span className="font-semibold text-amber-100">About recommendations:</span> Vaeroex
          provides advisory operational-support drafts. Review and approve recommendations before
          saving records or relying on them for important business decisions.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/ai-disclaimer" className="font-semibold text-amber-100 underline">
            Vaeroex Disclaimer
          </Link>
          <Link href="/sensitive-data-policy" className="font-semibold text-amber-100 underline">
            Sensitive Data Policy
          </Link>
          <button
            type="button"
            className="rounded-md border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50"
            onClick={() => {
              sessionStorage.setItem(STORAGE_KEY, "1");
              setDismissed(true);
            }}
          >
            Dismiss for this session
          </button>
        </div>
      </div>
    </details>
  );
}
