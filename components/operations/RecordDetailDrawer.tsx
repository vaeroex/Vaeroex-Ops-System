"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

type RecordDetailDrawerProps = {
  title: string;
  description?: string | null;
  triggerLabel?: string;
  children: ReactNode;
};

export function RecordDetailDrawer({ title, description, triggerLabel = "View details", children }: RecordDetailDrawerProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="mt-1 inline-flex text-xs font-semibold text-vaeroex-blue hover:underline"
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/35"
            aria-label="Close details"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col overflow-y-auto border-l border-line bg-white shadow-2xl">
            <header className="sticky top-0 z-10 border-b border-line bg-white px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-blue">Record details</p>
                  <h2 id={titleId} className="mt-1 truncate text-xl font-semibold text-ink">
                    {title}
                  </h2>
                  {description ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{description}</p> : null}
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setOpen(false)}
                >
                  Close
                </button>
              </div>
            </header>
            <div className="space-y-4 p-5">{children}</div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
