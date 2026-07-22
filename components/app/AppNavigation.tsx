"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

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

function isActivePath(pathname: string, href: string) {
  if (href === "/app") {
    return pathname === "/app";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function DesktopSection({ section, pathname }: { section: NavSection; pathname: string }) {
  const links = section.items.map((item) => {
    const active = isActivePath(pathname, item.href);

    return (
      <Link
        key={`${item.href}-${item.label}`}
        href={item.href as Route}
        className={`flex min-h-10 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium ${
          active ? "bg-vaeroex-blue text-white shadow-sm shadow-blue-950/20" : "text-slate-100 hover:bg-cyan-950/40 hover:text-vaeroex-accent"
        }`}
      >
        <span>{item.label}</span>
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
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={`${section.label}-${item.label}`}
              href={item.href as Route}
              className={`flex min-h-11 shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold ${
                active ? "bg-vaeroex-blue text-white" : "border border-line bg-white text-slate-700 hover:bg-cyan-50 hover:text-vaeroex-blue"
              }`}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
      </>
    );
  }

  return (
    <details className="shrink-0 rounded-md border border-line bg-white px-3 py-2 shadow-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center whitespace-nowrap text-sm font-semibold text-slate-700">{section.label}</summary>
      <div className="mt-2 grid gap-1">
        {section.items.map((item) => {
          const active = isActivePath(pathname, item.href);

          return (
            <Link
              key={`${section.label}-${item.label}`}
              href={item.href as Route}
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
    return (
      <div className="vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto pb-1">
        {sections.map((section) => (
          <MobileSection key={section.label} section={section} pathname={pathname} />
        ))}
      </div>
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
