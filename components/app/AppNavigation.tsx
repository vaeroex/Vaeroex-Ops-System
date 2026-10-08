"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { ChartNoAxesCombined, ChevronRight, FileText, FolderOpen, House, MessagesSquare, Plug, Settings2, Sparkles, type LucideIcon } from "lucide-react";
import { currentWorkspaceDestination, isWorkspacePathActive } from "@/lib/presentation/app-navigation";

type NavItem = {
  href: string;
  label: string;
};

type NavSection = {
  label: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  items: NavItem[];
};

type AppNavigationProps = {
  sections: NavSection[];
  mobile?: boolean;
};

const destinationIcons: Record<string, LucideIcon> = {
  "/app": House,
  "/app/intelligence": Sparkles,
  "/app/si": MessagesSquare,
  "/app/kpis": ChartNoAxesCombined,
  "/app/sources": FolderOpen,
  "/app/reports": FileText,
  "/app/integrations": Plug,
  "/app/settings": Settings2
};

function DestinationIcon({ href }: { href: string }) {
  const Icon = destinationIcons[href];
  return Icon ? <Icon aria-hidden="true" className="workspace-nav-icon" size={18} strokeWidth={1.6} /> : null;
}

function DesktopSection({
  section,
  pathname
}: {
  section: NavSection;
  pathname: string;
}) {
  const links = section.items.map((item) => {
    const active = isWorkspacePathActive(pathname, item.href);

    return (
      <Link
        key={`${item.href}-${item.label}`}
        href={item.href as Route}
        aria-current={active ? "page" : undefined}
        className={`workspace-nav-link flex min-h-10 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          active ? "bg-vaeroex-blue text-white shadow-sm shadow-blue-950/20" : "text-slate-100 hover:bg-cyan-950/40 hover:text-vaeroex-accent"
        }`}
      >
        <span className="flex min-w-0 items-center gap-3"><DestinationIcon href={item.href} /><span>{item.label}</span></span>
        {active ? <ChevronRight aria-hidden="true" className="workspace-nav-active" size={14} /> : null}
      </Link>
    );
  });

  if (section.collapsible === false) {
    return <div className="grid gap-1">{links}</div>;
  }

  return (
    <details open={section.defaultOpen} className="group rounded-lg border border-white/10 bg-white/[0.04] shadow-sm shadow-black/10">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-silver">
        {section.label}
        <span className="text-vaeroex-accent transition group-open:rotate-90">&gt;</span>
      </summary>
      <div className="grid gap-1 px-2 pb-2">{links}</div>
    </details>
  );
}

function MobileSection({ section, pathname }: { section: NavSection; pathname: string }) {
  if (section.collapsible === false) {
    return (
      <>
        {section.items.map((item) => {
          const active = isWorkspacePathActive(pathname, item.href);
          return (
            <Link
              key={`${section.label}-${item.label}`}
              href={item.href as Route}
              aria-current={active ? "page" : undefined}
              className={`workspace-nav-link flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold ${
                active ? "bg-vaeroex-blue text-white" : "border border-line bg-white text-slate-700 hover:bg-cyan-50 hover:text-vaeroex-blue"
              }`}
            >
              <DestinationIcon href={item.href} /><span>{item.label}</span>
            </Link>
          );
        })}
      </>
    );
  }

  return (
    <details className="col-span-full rounded-md border border-line bg-white px-3 py-2 shadow-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center whitespace-nowrap text-sm font-semibold text-slate-700">{section.label}</summary>
      <div className="mt-2 grid gap-1">
        {section.items.map((item) => {
          const active = isWorkspacePathActive(pathname, item.href);

          return (
            <Link
              key={`${section.label}-${item.label}`}
              href={item.href as Route}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center justify-between gap-3 whitespace-nowrap rounded-md px-2 py-2 text-sm ${
                active ? "bg-vaeroex-blue text-white" : "text-slate-700 hover:bg-cyan-950/40 hover:text-vaeroex-accent"
              }`}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </details>
  );
}

export function AppNavigation({ sections, mobile = false }: AppNavigationProps) {
  const pathname = usePathname();

  if (mobile) {
    const current = currentWorkspaceDestination(pathname, sections.flatMap((section) => section.items));
    return (
      <details key={pathname} className="group rounded-lg border border-line bg-white">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-ink">
          <span>Menu <span className="mx-2 text-muted">/</span> {current?.label || "Workspace"}</span>
          <span aria-hidden="true" className="text-vaeroex-blue transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="grid grid-cols-2 gap-2 border-t border-line p-2" onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) {
            event.currentTarget.closest("details")?.removeAttribute("open");
          }
        }}>
          {sections.map((section) => <MobileSection key={section.label} section={section} pathname={pathname} />)}
        </div>
      </details>
    );
  }

  return (
    <nav className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
      {sections.map((section) => (
        <DesktopSection key={section.label} section={section} pathname={pathname} />
      ))}
    </nav>
  );
}
