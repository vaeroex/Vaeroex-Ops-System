import Link from "next/link";
import type { Route } from "next";

type ModuleTab = {
  label: string;
  href: Route;
  active?: boolean;
};

type ModuleTabsProps = {
  tabs: ModuleTab[];
};

export function ModuleTabs({ tabs }: ModuleTabsProps) {
  return (
    <nav className="vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto rounded-lg border border-line bg-white p-2 shadow-sm" aria-label="Page sections">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45 ${tab.active ? "bg-vaeroex-blue text-white" : "text-slate-700 hover:bg-cyan-950/40 hover:text-vaeroex-accent"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
