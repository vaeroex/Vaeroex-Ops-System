import Link from "next/link";
import type { Route } from "next";
import type { IntegrationResultVisibility } from "@/lib/integrations/control-plane/result-visibility";

export type SquareSheetsResult = {
  key: string;
  provider: "Square" | "Google Sheets";
  label: string;
  href: string;
  hasImportedData: boolean;
  visibility: IntegrationResultVisibility;
};

export function SquareSheetsResultsView({ results }: { results: SquareSheetsResult[] }) {
  const visible = results.filter(result => result.visibility.visible);
  if (!visible.length) return null;
  return <section aria-label="Connected data" className="border-y border-white/10 py-3 text-slate-200">
    <ul className="divide-y divide-white/10">
      {visible.map(result => <li key={result.key} className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-2 py-3 text-sm">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="break-words font-semibold text-white">{result.provider}: {result.label}</p>
          {result.visibility.status ? <p className={`break-words ${result.visibility.requiresReconnect ? "text-amber-200" : "text-slate-300"}`} role={result.visibility.requiresReconnect ? "status" : undefined}>{result.visibility.status}</p> : null}
          {result.visibility.lastSuccessfulSyncAt ? <p className="text-xs text-slate-400">Last successful import: <time dateTime={result.visibility.lastSuccessfulSyncAt}>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(result.visibility.lastSuccessfulSyncAt))} UTC</time></p> : null}
          {result.provider === "Square" && result.hasImportedData ? <p className="text-xs text-slate-400">Saved Payment records; these are not accounting totals.</p> : null}
        </div>
        <Link href={result.href as Route} prefetch={false} className="inline-flex min-h-10 shrink-0 items-center font-semibold text-cyan-200 underline underline-offset-4 hover:text-cyan-100">
          {result.visibility.requiresReconnect ? `Review ${result.provider} access` : result.provider === "Square" && result.hasImportedData ? "View saved Payments" : `View ${result.provider}`}
        </Link>
      </li>)}
    </ul>
  </section>;
}
