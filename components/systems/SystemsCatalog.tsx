import Link from "next/link";
import type { Route } from "next";
import { SYSTEM_CATALOG } from "@/lib/systems/catalog";
import { accessibleSystemLinks, type SystemDecision } from "@/lib/systems/routing";
import { SystemNavigation } from "./SystemNavigation";

export function SystemsCatalog({ decisions, reason, needsWorkspaceSetup = false }: { decisions: readonly SystemDecision[]; reason: string; needsWorkspaceSetup?: boolean }) {
  const accessible = accessibleSystemLinks(decisions);
  return <>
    <SystemNavigation systems={accessible} />
    <div className="mb-10 max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-widest text-vaeroex-blue">Vaeroex account</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">Your Systems</h1>
      <p className="mt-5 text-base leading-7 text-slate-600">{reason}</p>
      <div className="mt-5 flex flex-wrap gap-5 text-sm font-semibold text-vaeroex-blue"><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/#solutions">Explore Solutions</Link><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/contact">Contact Vaeroex</Link></div>
    </div>
    <div className="grid items-stretch gap-5 lg:grid-cols-3">
      {SYSTEM_CATALOG.map(system => {
        const access = accessible.find(item => item.id === system.id);
        const development = system.status === "development";
        return <article key={system.id} aria-labelledby={`system-${system.id}`} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${development ? "bg-slate-100 text-slate-700" : access ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{development ? "In Development" : access ? "Access active" : "Access required"}</p>
          <h2 id={`system-${system.id}`} className="mt-7 text-2xl font-semibold leading-snug text-ink">Vaeroex {system.name}</h2>
          <p className="mt-4 flex-1 text-sm leading-7 text-slate-600">{system.description}</p>
          <div className="mt-7 border-t border-slate-100 pt-5">
            {development ? <p className="text-sm leading-6 text-slate-600">Not available to open. Release dates have not been announced.</p> : access ? <a href={access.href} className="inline-flex min-h-11 items-center rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vaeroex-blue">{String(access.href) === "/systems" ? "Choose workspace" : "Open"}</a> : <div className="space-y-3"><p className="text-sm leading-6 text-slate-600">{needsWorkspaceSetup ? "Complete workspace setup for your existing access." : "An active workspace and verified product access are required."}</p><Link className="inline-flex min-h-11 items-center font-semibold text-vaeroex-blue underline underline-offset-4" href={(needsWorkspaceSetup ? "/app/setup" : "/executive-intelligence") as Route}>{needsWorkspaceSetup ? "Continue workspace setup" : "Explore product and access options"}</Link></div>}
          </div>
        </article>;
      })}
    </div>
  </>;
}
