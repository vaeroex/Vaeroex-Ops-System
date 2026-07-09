"use client";

import type { ReactNode } from "react";
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
  useActivitySignal(pending, pendingLabel, { source: "form-submit" });

  return (
    <button disabled={disabled || pending} className={className} aria-busy={pending} data-vaeroex-local-activity="true" data-vaeroex-activity-label={pendingLabel}>
      {pending ? pendingLabel : children}
    </button>
  );
}
