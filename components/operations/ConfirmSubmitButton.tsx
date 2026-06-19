"use client";

import type { ReactNode } from "react";

type ConfirmSubmitButtonProps = {
  children: ReactNode;
  message: string;
  className?: string;
};

export function ConfirmSubmitButton({ children, message, className }: ConfirmSubmitButtonProps) {
  return (
    <button
      className={className || "rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy"}
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
