"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useActivitySignal } from "@/components/app/ActivityProvider";

export function PendingSubmitButton({
  children,
  pendingLabel = "Working...",
  className,
  disabled = false
}: {
  children: ReactNode;
  pendingLabel?: string;
  className: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const [optimisticPending, setOptimisticPending] = useState(false);
  const showingPending = pending || optimisticPending;
  useActivitySignal(showingPending, pendingLabel, { source: "form-submit" });

  useEffect(() => {
    if (pending || !optimisticPending) {
      return;
    }

    const timer = window.setTimeout(() => setOptimisticPending(false), 1800);
    return () => window.clearTimeout(timer);
  }, [optimisticPending, pending]);

  useEffect(() => {
    if (pending && optimisticPending) {
      setOptimisticPending(false);
    }
  }, [optimisticPending, pending]);

  return (
    <button
      disabled={disabled || pending}
      className={className}
      aria-busy={showingPending}
      data-vaeroex-local-activity="true"
      data-vaeroex-activity-label={pendingLabel}
      onClick={(event) => {
        const form = event.currentTarget.form;

        if (disabled || pending || (form && !form.checkValidity())) {
          return;
        }

        setOptimisticPending(true);
      }}
    >
      {showingPending ? pendingLabel : children}
    </button>
  );
}
