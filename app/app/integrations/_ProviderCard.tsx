import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/operations/StatusBadge";

export function ProviderCard({ name, description, statuses, href, action }: {
  name: string;
  description: string;
  statuses: readonly string[];
  href: string;
  action: string;
}) {
  return (
    <article aria-label={name} className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-white p-4 sm:p-5">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-ink">{name}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <div role="status" className="flex flex-wrap gap-2">
        {statuses.map((status) => <StatusBadge key={status} value={status} />)}
      </div>
      <Link href={href as Route} prefetch={false} className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line px-4 py-2 text-sm font-semibold text-vaeroex-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue">
        {action}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
      </Link>
    </article>
  );
}
