import type { ReactNode } from "react";

type DecisionPageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  help?: ReactNode;
};

export function DecisionPageHeader({ eyebrow, title, description, actions, help }: DecisionPageHeaderProps) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#071526] p-4 text-slate-100 shadow-panel sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">{eyebrow}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-white">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center [&>button]:min-h-11">
          {help}
          {actions}
        </div>
      </div>
    </section>
  );
}
