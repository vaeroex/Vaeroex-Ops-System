"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useActivitySignal } from "@/components/app/ActivityProvider";

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
  timeoutMs = 60000,
  persistedPending = false,
  showSteps = true,
  longRunningMessage = "This is taking longer than expected. The current request is still processing."
}: {
  children: ReactNode;
  pendingLabel?: string;
  className: string;
  steps?: string[];
  timeoutMs?: number;
  persistedPending?: boolean;
  showSteps?: boolean;
  longRunningMessage?: string;
}) {
  const { pending } = useFormStatus();
  const [localPending, setLocalPending] = useState(false);
  const [showTimeout, setShowTimeout] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const clickLockedRef = useRef(false);
  const observedFormPendingRef = useRef(false);
  const showingPending = pending || localPending || persistedPending;
  useActivitySignal(showingPending, pendingLabel, { source: "analysis-progress", timeoutMs });

  useEffect(() => {
    const button = buttonRef.current;
    const form = button?.form;

    if (!button || !form) return;

    function handleSubmit(event: SubmitEvent) {
      const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;

      if (submitter && submitter !== button) return;
      if (clickLockedRef.current || persistedPending) {
        event.preventDefault();
        return;
      }

      clickLockedRef.current = true;
      setLocalPending(true);
    }

    form.addEventListener("submit", handleSubmit, true);
    return () => form.removeEventListener("submit", handleSubmit, true);
  }, [persistedPending]);

  useEffect(() => {
    if (pending) {
      observedFormPendingRef.current = true;
      setLocalPending(true);
      return;
    }

    if (observedFormPendingRef.current && !persistedPending) {
      observedFormPendingRef.current = false;
      clickLockedRef.current = false;
      setLocalPending(false);
    }
  }, [pending, persistedPending]);

  useEffect(() => {
    if (!showingPending) {
      setShowTimeout(false);
      return;
    }

    const timer = window.setTimeout(() => setShowTimeout(true), timeoutMs);

    return () => window.clearTimeout(timer);
  }, [showingPending, timeoutMs]);

  const resolvedClassName = showingPending ? `${className} cursor-wait pointer-events-none opacity-70` : className;

  return (
    <div className={showingPending ? "space-y-3 cursor-wait" : "space-y-3"} aria-busy={showingPending}>
      <button
        ref={buttonRef}
        type="submit"
        disabled={showingPending}
        className={resolvedClassName}
        aria-busy={showingPending}
        data-vaeroex-local-activity="true"
        data-vaeroex-activity-label={pendingLabel}
      >
        <span className="inline-flex items-center gap-2">
          {showingPending ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
          <span>{showingPending ? pendingLabel : children}</span>
        </span>
      </button>
      {showingPending ? (
        <div role="status" aria-live="polite" aria-atomic="true" className="rounded-lg border border-vaeroex-accent/40 bg-vaeroex-soft p-3">
          <div className="flex items-center gap-2">
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-vaeroex-blue" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Analysis progress</p>
              <p className="mt-1 text-sm font-medium text-slate-700">{pendingLabel}</p>
            </div>
          </div>
          {showSteps ? (
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
          ) : null}
          {showTimeout ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              {longRunningMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
