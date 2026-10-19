"use client";

import { useRef, useState, type ReactNode } from "react";
import { categories, inCategory, matchesSearch, type CatalogEntry, type Category } from "./_catalog";

export function PluginCatalog({ entries }: { entries: (CatalogEntry & { content: ReactNode })[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const search = useRef<HTMLInputElement>(null);
  const matching = entries.filter(entry => matchesSearch(entry, query));
  const visible = matching.filter(entry => inCategory(entry, category));
  const options = (Object.keys(categories) as Category[]).filter(key => entries.some(entry => inCategory(entry, key)));
  function reset() {
    setQuery("");
    setCategory("all");
    search.current?.focus();
  }

  if (!entries.length) return <p role="status" className="border-y border-line py-4 text-sm text-slate-600">No plug-ins are available for your workspace role right now.</p>;

  return <section aria-label="Browse plug-ins" className="space-y-4">
    <div className="space-y-4 rounded-lg border border-line bg-white p-4 sm:p-5">
      <div className="max-w-xl">
        <label htmlFor="plugin-search" className="block text-sm font-semibold text-ink">Search plug-ins</label>
        <input ref={search} id="plugin-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Search by name or capability" aria-controls="plugin-results" aria-describedby="plugin-search-help"
          className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue" />
        <p id="plugin-search-help" className="mt-2 text-xs text-slate-600">Search within a category, or choose All to browse every plug-in shown for your role.</p>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Categories</legend>
        <div className="flex flex-wrap gap-2">
          {(["all", ...options] as const).map(key => <button key={key} type="button" aria-pressed={category === key} aria-controls="plugin-results"
            onClick={() => setCategory(key)}
            className={`min-h-11 rounded-md border px-3 py-2 text-left text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue ${category === key ? "border-vaeroex-blue bg-vaeroex-soft text-vaeroex-blue" : "border-line text-ink hover:bg-vaeroex-soft"}`}>
            {category === key ? <span aria-hidden="true" className="mr-1">✓</span> : null}{key === "all" ? "All" : categories[key]} <span className="ml-1 tabular-nums">({matching.filter(entry => inCategory(entry, key)).length})</span>
          </button>)}
        </div>
      </fieldset>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-slate-600">Showing {visible.length} of {entries.length} plug-ins{category !== "all" ? ` in ${categories[category]}` : ""}{query.trim() ? ` matching “${query.trim()}”` : ""}.</p>
      {query || category !== "all" ? <button type="button" onClick={reset} className="min-h-11 text-sm font-semibold text-vaeroex-blue underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Clear filters</button> : null}
    </div>
    <div id="plugin-results" className="grid items-stretch gap-4 md:grid-cols-2">
      {visible.map(entry => <div key={entry.id} className="flex min-w-0 [&>article]:w-full">{entry.content}</div>)}
    </div>
    {!visible.length ? <div className="rounded-lg border border-line bg-white p-6 text-center">
      <h2 className="text-lg font-semibold text-ink">No matching plug-ins</h2>
      <p className="mt-2 text-sm text-slate-600">Try another name or capability, choose a different category, or clear the filters above.</p>
    </div> : null}
  </section>;
}
