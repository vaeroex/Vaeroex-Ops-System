"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useActivitySignal } from "@/components/app/ActivityProvider";

const LOCAL_PENDING_TIMEOUT_MS = 90000;

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
  const [localPending, setLocalPending] = useState(false);
  const observedFormPendingRef = useRef(false);
  const showingPending = pending || localPending;
  useActivitySignal(showingPending, pendingLabel, { source: "form-submit", timeoutMs: LOCAL_PENDING_TIMEOUT_MS });

  useEffect(() => {
    if (pending) {
      observedFormPendingRef.current = true;
      setLocalPending(true);
      return;
    }

    if (observedFormPendingRef.current) {
      observedFormPendingRef.current = false;
      setLocalPending(false);
    }
  }, [pending]);

  useEffect(() => {
    if (!localPending) {
      return;
    }

    const timer = window.setTimeout(() => {
      observedFormPendingRef.current = false;
      setLocalPending(false);
    }, LOCAL_PENDING_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [localPending]);

  const resolvedClassName = showingPending ? `${className} pointer-events-none opacity-70` : className;

  return (
    <button
      disabled={disabled || showingPending}
      className={resolvedClassName}
      aria-busy={showingPending}
      data-vaeroex-local-activity="true"
      data-vaeroex-activity-label={pendingLabel}
      onClick={(event) => {
        const form = event.currentTarget.form;

        if (disabled || showingPending || (form && !form.checkValidity())) {
          return;
        }

        setLocalPending(true);
      }}
    >
      {showingPending ? pendingLabel : children}
    </button>
  );
}
