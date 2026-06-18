"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

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

  return (
    <button disabled={disabled || pending} className={className} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
