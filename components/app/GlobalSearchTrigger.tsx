"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type GlobalSearchTriggerProps = {
  children: ReactNode;
  initialQuery?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function GlobalSearchTrigger({ children, initialQuery = "", type = "button", onClick, ...props }: GlobalSearchTriggerProps) {
  return (
    <button
      {...props}
      type={type}
      onClick={(event) => {
        onClick?.(event);

        if (event.defaultPrevented) {
          return;
        }

        window.dispatchEvent(
          new CustomEvent("vaeroex:open-global-search", {
            detail: { query: initialQuery }
          })
        );
      }}
    >
      {children}
    </button>
  );
}
