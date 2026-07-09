"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useActivitySignal } from "@/components/app/ActivityProvider";

const LOCAL_PENDING_TIMEOUT_MS = 120000;

export function PendingSubmitButton({
  children,
  pendingLabel = "Working...",
  className,
  disabled = false,
  activityDisabled = false
}: {
  children: ReactNode;
  pendingLabel?: string;
  className: string;
  disabled?: boolean;
  activityDisabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const [localPending, setLocalPending] = useState(false);
  const [localError, setLocalError] = useState("");
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const clickLockedRef = useRef(false);
  const observedFormPendingRef = useRef(false);
  const showingPending = pending || localPending;
  useActivitySignal(!activityDisabled && showingPending, pendingLabel, { source: "form-submit", timeoutMs: LOCAL_PENDING_TIMEOUT_MS });

  useEffect(() => {
    const button = buttonRef.current;
    const form = button?.form;

    if (!button || !form) {
      return;
    }

    function handleSubmit(event: SubmitEvent) {
      const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;

      if (submitter && submitter !== button) {
        return;
      }

      clickLockedRef.current = true;
      setLocalError("");
      setLocalPending(true);
    }

    form.addEventListener("submit", handleSubmit, true);

    return () => form.removeEventListener("submit", handleSubmit, true);
  }, []);

  useEffect(() => {
    if (pending) {
      observedFormPendingRef.current = true;
      setLocalPending(true);
      return;
    }

    if (observedFormPendingRef.current) {
      observedFormPendingRef.current = false;
      clickLockedRef.current = false;
      setLocalPending(false);
    }
  }, [pending]);

  useEffect(() => {
    if (!localPending) {
      return;
    }

    const timer = window.setTimeout(() => {
      observedFormPendingRef.current = false;
      clickLockedRef.current = false;
      setLocalPending(false);
      setLocalError("Vaeroex did not receive a response. Please try again.");
    }, LOCAL_PENDING_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [localPending]);

  const resolvedClassName = showingPending ? `${className} pointer-events-none opacity-70` : className;

  return (
    <span className="inline-flex flex-col items-start gap-2">
      <button
        ref={buttonRef}
        disabled={disabled || showingPending}
        className={resolvedClassName}
        aria-busy={showingPending}
        data-vaeroex-local-activity="true"
        data-vaeroex-activity-label={pendingLabel}
      >
        {showingPending ? pendingLabel : children}
      </button>
      {localError ? (
        <span role="status" aria-live="polite" className="text-xs font-medium text-amber-200">
          {localError}
        </span>
      ) : null}
    </span>
  );
}
