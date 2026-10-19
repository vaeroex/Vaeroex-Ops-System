import Link from "next/link";
import type { Route } from "next";
import { Children, isValidElement, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { categories, providerCategories, type CatalogProvider } from "./_catalog";
import { PluginCatalog } from "./_PluginCatalog";

type ProviderCardProps = {
  id: CatalogProvider;
  name: string;
  description: string;
  reads?: string;
  requires?: string;
  statuses: readonly string[];
  href: string;
  action: string;
  availability?: string;
  availabilityNote?: string;
  children?: ReactNode;
};

// Build search metadata on the server and pass rendered cards through the client
// filter boundary. Provider queries and availability decisions stay server-side.
export function ProviderCatalog({ children }: { children: ReactNode }) {
  const entries = Children.toArray(children).filter(isValidElement<ProviderCardProps>).map(card => ({
    id: card.props.id,
    name: card.props.name,
    searchText: [card.props.description, card.props.reads].filter(Boolean).join(" "),
    content: card
  }));
  return <PluginCatalog entries={entries} />;
}

export function ProviderCard({ id, name, description, reads, requires, statuses, href, action, availability, availabilityNote, children }: ProviderCardProps) {
  return (
    <article aria-label={name} className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-white p-4 sm:p-5">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-ink">{name}</h2>
        <ul aria-label="Categories" className="mt-2 flex flex-wrap gap-2">
          {providerCategories[id].map(category => <li key={category} className="rounded border border-line px-2 py-1 text-xs text-slate-600">{categories[category]}</li>)}
        </ul>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>
      {availability ? <div className="text-sm">
        <p className="mb-1 font-semibold text-ink">Availability</p>
        <StatusBadge value={availability} />
        {availabilityNote ? <p className="mt-2 text-xs text-slate-600">{availabilityNote}</p> : null}
      </div> : null}
      {statuses.length ? <div className="space-y-1">
        <p className="text-sm font-semibold text-ink">Connection status</p>
        <div className="flex flex-wrap gap-2">
        {statuses.map((status) => <StatusBadge key={status} value={status} />)}
        </div>
      </div> : null}
      {reads || requires ? <dl className="space-y-2 text-sm leading-5 text-slate-600">
        {reads ? <div><dt className="inline font-semibold text-ink">Reads: </dt><dd className="inline">{reads}</dd></div> : null}
        {requires ? <div><dt className="inline font-semibold text-ink">Requires: </dt><dd className="inline">{requires}</dd></div> : null}
      </dl> : null}
      {children}
      <Link href={href as Route} prefetch={false} className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line px-4 py-2 text-sm font-semibold text-vaeroex-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue">
        {action}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
      </Link>
    </article>
  );
}
