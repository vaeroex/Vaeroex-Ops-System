"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useActivitySignal } from "@/components/app/ActivityProvider";

type ConfirmSubmitButtonProps = {
  children: ReactNode;
  message: string;
  className?: string;
  pendingLabel?: string;
};

export function ConfirmSubmitButton({ children, message, className, pendingLabel = "Working..." }: ConfirmSubmitButtonProps) {
  const { pending } = useFormStatus();
  useActivitySignal(pending, pendingLabel, { source: "confirmed-submit" });

  return (
    <button
      disabled={pending}
      className={className || "rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950/70 hover:text-white hover:ring-1 hover:ring-vaeroex-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"}
      aria-busy={pending}
      data-vaeroex-local-activity="true"
      data-vaeroex-activity-label={pendingLabel}
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
