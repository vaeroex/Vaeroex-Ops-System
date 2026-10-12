"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import { isSecurityResponseMessage } from "@/lib/security/security-response";

function ToastContent() {
  const searchParams = useSearchParams();
  const message = searchParams.get("saved") || searchParams.get("message");
  const error = searchParams.get("error");
  const [visible, setVisible] = useState(Boolean(message || error));

  useEffect(() => {
    setVisible(Boolean(message || error));
  }, [message, error]);

  function dismiss() {
    setVisible(false);
    // Remove only the acknowledged notice. Preserve filters, hash and the
    // mounted form; a later identical outcome can then be announced again.
    const url = new URL(window.location.href);
    for (const key of ["saved", "message", "error"]) url.searchParams.delete(key);
    // Next copies its internal history state for external updates. Passing its
    // existing marker back would bypass search-param synchronization.
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  if (!visible || (!message && !error)) {
    return null;
  }

  return (
    <div className={error && isSecurityResponseMessage(error) ? "fixed inset-0 z-[100] flex items-center justify-center bg-[#050b14] p-4" : "fixed bottom-4 right-4 z-50 w-[min(380px,calc(100vw-2rem))]"}>
      {error && isSecurityResponseMessage(error) ? (
        <div className="w-full max-w-3xl">
          <SecurityResponseNotice />
          <button type="button" onClick={dismiss} className="mt-4 min-h-11 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/5">
            Return to workspace
          </button>
        </div>
      ) : (
        <div
          className={`rounded-lg border p-4 text-sm shadow-panel ${
            error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <p>{error || message}</p>
            <button type="button" className="text-xs font-semibold opacity-75" onClick={dismiss}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ToastRegion() {
  return (
    <Suspense fallback={null}>
      <ToastContent />
    </Suspense>
  );
}
