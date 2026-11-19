"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { discoveryDemo, discoveryWalkthrough } from "@/lib/marketing/discovery-evidence";

const product = "/drug-discovery-intelligence";
const links = [
  ["Drug Discovery", product],
  ["Research", product + "#research"],
  ["About", "/about"],
  ["Contact", "/contact"],
] as const;

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function PublicNavigation() {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const onResearch = useSyncExternalStore(subscribeToHash, () => window.location.hash === "#research", () => false);
  const location = pathname === product && onResearch ? product + "#research" : pathname;

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("click", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const navigationLinks = links.map(([label, href]) => (
    <a key={href} href={href} aria-current={location === href ? (onResearch && pathname === product ? "location" : "page") : undefined}>
      {label}
    </a>
  ));

  return (
    <div className="vx-navigation">
      <nav className="vx-desktop-nav" aria-label="Public navigation">{navigationLinks}</nav>
      <div className="vx-mobile-nav">
        <details ref={menu}>
          <summary aria-label="Open navigation menu"><Menu size={20} aria-hidden="true" /></summary>
          <nav className="vx-mobile-menu" aria-label="Public navigation mobile" onClick={event => {
            if ((event.target as Element).closest("a") && menu.current) menu.current.open = false;
          }}>
            {navigationLinks}
            <Link href={discoveryDemo} className="vx-button vx-button--primary">Explore sample compounds <ArrowUpRight size={15} aria-hidden="true" /></Link>
            <Link href={discoveryWalkthrough} className="vx-text-link">Request a walkthrough</Link>
          </nav>
        </details>
      </div>
    </div>
  );
}
