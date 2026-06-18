"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

const defaultSteps = [
  "Reading file",
  "Extracting content",
  "Sending to Vaeroex",
  "Generating insights",
  "Saving analysis",
  "Done"
];

export function AnalysisProgressSubmit({
  children,
  pendingLabel = "Working...",
  className,
  steps = defaultSteps,
  timeoutMs = 60000
}: {
  children: ReactNode;
  pendingLabel?: string;
  className: string;
  steps?: string[];
  timeoutMs?: number;
}) {
  const { pending } = useFormStatus();
  const [showTimeout, setShowTimeout] = useState(false);

  useEffect(() => {
    if (!pending) {
      setShowTimeout(false);
      return;
    }

    const timer = window.setTimeout(() => setShowTimeout(true), timeoutMs);

    return () => window.clearTimeout(timer);
  }, [pending, timeoutMs]);

  return (
    <div className="space-y-3">
      <button disabled={pending} className={className} aria-busy={pending}>
        {pending ? pendingLabel : children}
      </button>
      {pending ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Analysis progress</p>
          <ol className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${index === 0 ? "bg-vaeroex-blue text-white" : "bg-white text-slate-600"}`}>
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {showTimeout ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              Analysis is taking longer than expected. You can wait, retry, or return to Files.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
