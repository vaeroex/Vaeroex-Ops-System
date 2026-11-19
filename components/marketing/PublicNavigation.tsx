"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight, ChevronDown, Menu } from "lucide-react";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const groups = [
  {
    label: "Products",
    links: [
      ["Drug Discovery Intelligence", "/drug-discovery-intelligence"],
      ["Explore sample compounds", "/drug-discovery-intelligence/demo"],
      ["Executive Intelligence", "/executive-intelligence"],
      ["Executive Intelligence pricing", "/pricing#intelligence-pricing"],
    ],
  },
  {
    label: "Custom Software",
    links: [
      ["Custom software services", "/custom-business-systems"],
      ["Website development", "/website-development"],
      ["Discuss a project", "/contact?inquiry=custom-business-systems"],
    ],
  },
  {
    label: "Company",
    links: [
      ["About Vaeroex", "/about"],
      ["Why Vaeroex", "/about/why-vaeroex"],
      ["Vaeroex Super Intelligence", "/about#vsi"],
      ["Trust Center", "/trust"],
      ["Contact", "/contact"],
      ["Network", "/networking"],
      ["Careers", "/careers"],
    ],
  },
] as const;

export function PublicNavigation({ loggedIn }: { loggedIn: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && container.current?.contains(event.target as Node)) return;
      container.current?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach(item => {
        item.open = false;
        if (event instanceof KeyboardEvent) item.querySelector("summary")?.focus();
      });
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  function navigationLink([label, href]: readonly [string, Route]) {
    const current = pathname === href || (href === "/pricing#intelligence-pricing" && pathname === "/pricing");
    return <Link key={href} href={href} aria-current={current ? "page" : undefined}>{label}</Link>;
  }

  return (
    <div ref={container} className="vx-navigation" onClick={event => {
      if ((event.target as Element).closest("a")) {
        container.current?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach(item => { item.open = false; });
      }
    }}>
      <nav className="vx-desktop-nav" aria-label="Public navigation">
        {groups.map(group => (
          <details key={group.label} name="public-navigation">
            <summary>{group.label}<ChevronDown size={12} aria-hidden="true" /></summary>
            <div className="vx-dropdown">{group.links.map(navigationLink)}</div>
          </details>
        ))}
      </nav>
      <div className="vx-mobile-nav">
        <Link href={(loggedIn ? "/systems" : "/login") as Route} aria-label={loggedIn ? "Your Executive Intelligence systems" : "Executive Intelligence sign in"}>
          {loggedIn ? "Your systems" : "Sign in"}
        </Link>
        <details>
          <summary aria-label="Open navigation menu"><Menu size={20} aria-hidden="true" /></summary>
          <nav className="vx-mobile-menu" aria-label="Public navigation mobile">
            {groups.map(group => (
              <div key={group.label} className="vx-mobile-link-group">
                <span>{group.label}</span>
                {group.links.map(navigationLink)}
              </div>
            ))}
            <Link href="/contact?inquiry=drug-discovery" className="vx-button vx-button--primary">
              Request a walkthrough <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </nav>
        </details>
      </div>
    </div>
  );
}
