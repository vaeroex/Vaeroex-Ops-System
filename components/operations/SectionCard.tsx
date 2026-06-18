import type { ReactNode } from "react";

type SectionCardProps = {
  title?: string;
  description?: string;
  children: ReactNode;
};

export function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
      {title ? <h3 className="text-lg font-semibold">{title}</h3> : null}
      {description ? <p className="mt-2 text-sm leading-6 text-muted">{description}</p> : null}
      <div className={title || description ? "mt-5" : ""}>{children}</div>
    </section>
  );
}
