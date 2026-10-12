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
  activityDisabled = false,
  pendingContent,
  pendingOverride,
  timeoutMs = LOCAL_PENDING_TIMEOUT_MS
}: {
  children: ReactNode;
  pendingLabel?: string;
  className: string;
  disabled?: boolean;
  activityDisabled?: boolean;
  pendingContent?: ReactNode;
  pendingOverride?: boolean;
  timeoutMs?: number;
}) {
  const { pending: formPending } = useFormStatus();
  const pending = pendingOverride ?? formPending;
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
      if (event.defaultPrevented) {
        return;
      }

      const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;

      if (submitter && submitter !== button) {
        return;
      }

      if (clickLockedRef.current) {
        event.preventDefault();
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
      setLocalError("");
    }
  }, [pending]);

  useEffect(() => {
    if (!localPending) {
      return;
    }

    const timer = window.setTimeout(() => {
      setLocalError("This is taking longer than expected. Keep this page open while Vaeroex finishes. Check the result before submitting again.");
    }, timeoutMs);

    return () => window.clearTimeout(timer);
  }, [localPending, timeoutMs]);

  const resolvedClassName = showingPending ? `${className} pointer-events-none opacity-70` : className;

  return (
    <div className="inline-flex flex-col items-start gap-2">
      <button
        type="submit"
        ref={buttonRef}
        disabled={disabled || showingPending}
        className={resolvedClassName}
        aria-busy={showingPending}
        data-vaeroex-local-activity="true"
        data-vaeroex-activity-label={pendingLabel}
      >
        {showingPending ? pendingLabel : children}
      </button>
      {showingPending ? pendingContent : null}
      {localError ? (
        <span role="status" aria-live="polite" className="text-xs font-medium text-amber-200">
          {localError}
        </span>
      ) : null}
    </div>
  );
}
