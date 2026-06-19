import type { ReactNode } from "react";

type SectionCardProps = {
  title?: string;
  description?: string;
  children: ReactNode;
};

export function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <section className="rounded-lg border border-vaeroex-silver/80 bg-white p-5 shadow-panel">
      {title || description ? (
        <div className="flex flex-col gap-1 border-b border-vaeroex-silver pb-3">
          {title ? <h3 className="text-base font-semibold text-ink">{title}</h3> : null}
          {description ? <p className="max-w-4xl text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>
      ) : null}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
