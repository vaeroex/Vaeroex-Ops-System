"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function ToastContent() {
  const searchParams = useSearchParams();
  const message = searchParams.get("saved") || searchParams.get("message");
  const error = searchParams.get("error");
  const [visible, setVisible] = useState(Boolean(message || error));

  useEffect(() => {
    setVisible(Boolean(message || error));

    if (!message && !error) {
      return;
    }

    const timer = window.setTimeout(() => setVisible(false), 6500);
    return () => window.clearTimeout(timer);
  }, [message, error]);

  if (!visible || (!message && !error)) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(380px,calc(100vw-2rem))]">
      <div
        className={`rounded-lg border p-4 text-sm shadow-panel ${
          error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"
        }`}
        role="status"
      >
        <div className="flex items-start justify-between gap-3">
          <p>{error || message}</p>
          <button className="text-xs font-semibold opacity-75" onClick={() => setVisible(false)}>
            Close
          </button>
        </div>
      </div>
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
