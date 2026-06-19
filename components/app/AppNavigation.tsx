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
  items: NavItem[];
};

type AppNavigationProps = {
  sections: NavSection[];
  notificationUnreadCount: number;
  mobile?: boolean;
};

function NotificationBadge({ count, light = false }: { count: number; light?: boolean }) {
  if (!count) {
    return null;
  }

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${light ? "bg-white text-vaeroex-blue" : "bg-vaeroex-blue text-white shadow-sm shadow-blue-900/20"}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function isActivePath(pathname: string, href: string) {
  if (href === "/app") {
    return pathname === "/app";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function DesktopSection({ section, notificationUnreadCount, pathname }: { section: NavSection; notificationUnreadCount: number; pathname: string }) {
  return (
    <details open className="group rounded-lg border border-white/10 bg-white/[0.04] shadow-sm shadow-black/10">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-silver">
        {section.label}
        <span className="text-vaeroex-accent transition group-open:rotate-90">&gt;</span>
      </summary>
      <div className="pb-2">
        {section.items.map((item) => {
          const active = isActivePath(pathname, item.href);

          return (
            <Link
              key={`${item.href}-${item.label}`}
              href={item.href as Route}
              className={`mx-2 flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                active ? "bg-vaeroex-blue text-white shadow-sm shadow-blue-950/20" : "text-slate-100 hover:bg-vaeroex-accent hover:text-vaeroex-navy"
              }`}
            >
              <span>{item.label}</span>
              {item.href === "/app/notifications" ? <NotificationBadge count={notificationUnreadCount} light /> : null}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

function MobileSection({ section, notificationUnreadCount, pathname }: { section: NavSection; notificationUnreadCount: number; pathname: string }) {
  return (
    <details className="shrink-0 rounded-md border border-line bg-white px-3 py-2 shadow-sm">
      <summary className="cursor-pointer list-none whitespace-nowrap text-sm font-semibold text-slate-700">{section.label}</summary>
      <div className="mt-2 grid gap-1">
        {section.items.map((item) => {
          const active = isActivePath(pathname, item.href);

          return (
            <Link
              key={`${section.label}-${item.label}`}
              href={item.href as Route}
              className={`flex items-center justify-between gap-3 whitespace-nowrap rounded-md px-2 py-1 text-sm ${
                active ? "bg-vaeroex-blue text-white" : "text-slate-700 hover:bg-vaeroex-accent/20 hover:text-vaeroex-navy"
              }`}
            >
              <span>{item.label}</span>
              {item.href === "/app/notifications" ? <NotificationBadge count={notificationUnreadCount} /> : null}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

export function AppNavigation({ sections, notificationUnreadCount, mobile = false }: AppNavigationProps) {
  const pathname = usePathname();

  if (mobile) {
    return (
      <div className="flex gap-2 overflow-x-auto">
        {sections.map((section) => (
          <MobileSection key={section.label} section={section} notificationUnreadCount={notificationUnreadCount} pathname={pathname} />
        ))}
      </div>
    );
  }

  return (
    <nav className="mt-5 flex flex-1 flex-col gap-2 overflow-auto pr-1">
      {sections.map((section) => (
        <DesktopSection key={section.label} section={section} notificationUnreadCount={notificationUnreadCount} pathname={pathname} />
      ))}
    </nav>
  );
}
