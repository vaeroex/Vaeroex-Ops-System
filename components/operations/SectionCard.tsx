import type { ReactNode } from "react";

type SectionCardProps = {
  title?: string;
  description?: string;
  children: ReactNode;
};

export function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <section className="rounded-lg border border-line bg-white p-4 shadow-sm">
      {title || description ? (
        <div className="flex flex-col gap-1 border-b border-line pb-3">
          {title ? <h3 className="text-base font-semibold">{title}</h3> : null}
          {description ? <p className="text-sm leading-6 text-muted">{description}</p> : null}
        </div>
      ) : null}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
