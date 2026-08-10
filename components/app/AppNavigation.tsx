"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect, useRef, type MouseEvent } from "react";
import {
  isSpatialWorkspaceDestination,
  spatialDestinationForPathname,
  spatialTravelPlan,
  SPATIAL_NAVIGATION_INTENT_EVENT,
  type SpatialNavigationIntentDetail
} from "@/components/spatial/spatial-destinations";

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
  if (href === "/app" || href === "/app/admin") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

type DesktopNavigationHandler = (event: MouseEvent<HTMLAnchorElement>, item: NavItem, active: boolean) => void;

function DesktopSection({
  section,
  pathname,
  onNavigate
}: {
  section: NavSection;
  pathname: string;
  onNavigate: DesktopNavigationHandler;
}) {
  const links = section.items.map((item) => {
    const active = isActivePath(pathname, item.href);
    const spatialDestination = spatialDestinationForPathname(item.href);

    return (
      <Link
        key={`${item.href}-${item.label}`}
        href={item.href as Route}
        data-spatial-destination={spatialDestination === "flat" ? undefined : spatialDestination}
        data-active={active ? "true" : "false"}
        onClick={(event) => onNavigate(event, item, active)}
        className={`vaeroex-navigation-link flex min-h-10 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium ${
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
  const router = useRouter();
  const navigationTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (navigationTimer.current) window.clearTimeout(navigationTimer.current);
  }, []);

  const navigateWithSpatialHandoff: DesktopNavigationHandler = (event, item, active) => {
    if (
      active
      || event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || event.currentTarget.target === "_blank"
    ) return;

    const from = spatialDestinationForPathname(pathname);
    const to = spatialDestinationForPathname(item.href);
    const shell = document.querySelector<HTMLElement>(
      '.vaeroex-workspace-shell--active[data-spatial-ready="true"]'
    );
    const capability = shell?.dataset.spatialCapability;
    if (
      !shell
      || (capability !== "full" && capability !== "constrained")
      || !isSpatialWorkspaceDestination(from)
      || !isSpatialWorkspaceDestination(to)
      || from === to
    ) return;

    event.preventDefault();
    if (navigationTimer.current) window.clearTimeout(navigationTimer.current);
    const travel = spatialTravelPlan(from, to);
    const detail: SpatialNavigationIntentDetail = { from, to };
    window.dispatchEvent(new CustomEvent(SPATIAL_NAVIGATION_INTENT_EVENT, { detail }));
    navigationTimer.current = window.setTimeout(() => {
      navigationTimer.current = null;
      router.push(item.href as Route);
    }, travel.departureMs);
  };

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
        <DesktopSection key={section.label} section={section} pathname={pathname} onNavigate={navigateWithSpatialHandoff} />
      ))}
    </nav>
  );
}
