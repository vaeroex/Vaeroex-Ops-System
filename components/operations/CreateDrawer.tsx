import type { ReactNode } from "react";

type CreateDrawerProps = {
  title: string;
  description?: string;
  triggerLabel: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function CreateDrawer({ title, description, triggerLabel, children, defaultOpen = false }: CreateDrawerProps) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-line bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-vaeroex-blue/40 sm:flex-row sm:items-center sm:justify-between">
        <span>
          <span className="block text-sm font-semibold text-ink">{title}</span>
          {description ? <span className="mt-1 block max-w-3xl text-sm leading-6 text-muted">{description}</span> : null}
        </span>
        <span className="inline-flex w-fit items-center rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white transition group-open:bg-slate-900">
          {triggerLabel}
        </span>
      </summary>
      <div className="border-t border-line bg-slate-50/70 p-4">{children}</div>
    </details>
  );
}
