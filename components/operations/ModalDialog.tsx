"use client";

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

let openDialogCount = 0;
let originalOverflow = "";

/** Native modal isolation plus explicit keyboard wrapping and invoker restoration. */
export function ModalDialog({ children, labelId, className = "", onClose, initialFocusRef, search = false }: {
  children: ReactNode;
  labelId: string;
  className?: string;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  search?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openDialogCount++ === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialog.showModal();
    (initialFocusRef?.current || dialog.querySelector<HTMLElement>("button:not([tabindex='-1']), input, select, textarea, a[href]") || dialog).focus();
    return () => {
      dialog.close();
      if (--openDialogCount === 0) document.body.style.overflow = originalOverflow;
      if (invoker?.isConnected) invoker.focus({ preventScroll: true });
    };
  }, [initialFocusRef]);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={labelId}
      data-global-search={search || undefined}
      className={`fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-inherit backdrop:bg-transparent ${className}`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== "Tab") return;
        const dialog = event.currentTarget;
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]"))
          .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
    >
      {children}
    </dialog>,
    // Keep workspace theme selectors while escaping responsive trigger wrappers.
    document.querySelector(".vaeroex-app-shell") || document.body
  );
}
