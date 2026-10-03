"use client";

import type { ReactNode } from "react";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";

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
  return (
      <PendingSubmitButton className={className} pendingLabel={pendingLabel} timeoutMs={timeoutMs} pendingContent={
        <div className="rounded-lg border border-vaeroex-accent/40 bg-vaeroex-soft p-3">
          <p role="status" className="text-sm font-semibold text-slate-200">Request received. Processing automatically…</p>
          <details className="mt-3 text-slate-300">
          <summary className="cursor-pointer text-xs font-semibold">What happens next</summary>
          <p className="mt-2 text-xs">These are the processing steps, not live step-by-step status. Your result will appear when processing finishes.</p>
          <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-800 text-[11px] font-semibold text-slate-300">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          </details>
        </div>
      }>{children}</PendingSubmitButton>
  );
}
