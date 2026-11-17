import type { SystemLink } from "@/lib/systems/routing";

export function SystemNavigation({ systems = [] }: { systems?: readonly SystemLink[] }) {
  return <nav aria-label="Your systems" className="flex flex-wrap items-center gap-3 py-3 text-sm font-semibold">
    {/* Full navigations retain browser beforeunload protections and shared cookies. */}
    <a href="/systems" className="rounded px-2 py-2 underline underline-offset-4 focus-visible:outline focus-visible:outline-2">Your Systems</a>
    {systems.length > 1 ? <details className="relative">
      <summary className="min-h-11 cursor-pointer rounded px-2 py-3">Switch system</summary>
      <ul className="absolute left-0 z-30 min-w-56 rounded-lg border border-slate-300 bg-white p-2 text-slate-900 shadow-lg">{systems.map(system => <li key={system.id}><a className="block min-h-11 rounded px-3 py-3 hover:bg-slate-100 focus-visible:outline" href={system.href}>{system.name}</a></li>)}</ul>
    </details> : null}
  </nav>;
}
