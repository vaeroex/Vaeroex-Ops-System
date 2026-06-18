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
    <nav className="flex gap-2 overflow-x-auto rounded-lg border border-line bg-white p-2 shadow-sm" aria-label="Page sections">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold ${tab.active ? "bg-vaeroex-blue text-white" : "text-slate-700 hover:bg-slate-50"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
