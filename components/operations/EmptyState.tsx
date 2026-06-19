import type { ReactNode } from "react";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white p-8 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg border border-vaeroex-accent/30 bg-vaeroex-navy shadow-sm shadow-blue-950/20">
        <VaeroexLogo variant="symbol" size="sm" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
