"use client";
import Link from "next/link";
import { ChevronDown, Menu, ArrowUpRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { PUBLIC_SYSTEMS } from "@/lib/marketing/public-systems";

const company = [
  ["About", "/about"],
  ["Contact", "/contact"],
  ["Network", "/networking"],
  ["Careers", "/careers"],
] as const;
export function PublicNavigation({ loggedIn }: { loggedIn: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        container.current?.contains(event.target as Node)
      )
        return;
      container.current
        ?.querySelectorAll<HTMLDetailsElement>("details[open]")
        .forEach((item) => {
          item.open = false;
          if (event instanceof KeyboardEvent)
            item.querySelector("summary")?.focus();
        });
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  const closeMenus = () =>
    container.current
      ?.querySelectorAll<HTMLDetailsElement>("details[open]")
      .forEach((item) => {
        item.open = false;
      });
  return (
    <div
      ref={container}
      className="vx-navigation"
      onClick={(event) => {
        if ((event.target as Element).closest("a")) closeMenus();
      }}
    >
      <nav className="vx-desktop-nav" aria-label="Public navigation">
        <details name="public-navigation">
          <summary>
            Intelligence
            <ChevronDown size={12} aria-hidden="true" />
          </summary>
          <div className="vx-dropdown">
            <Link href="/intelligence-systems" className="vx-dropdown-overview">
              The Vaeroex approach
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
            {PUBLIC_SYSTEMS.map((system) => (
              <Link href={system.route} key={system.id}>
                <strong>{system.name}</strong>
                <small>{system.statusLabel}</small>
              </Link>
            ))}
          </div>
        </details>
        <Link
          href="/pricing"
          aria-current={pathname === "/pricing" ? "page" : undefined}
        >
          Pricing
        </Link>
        <Link
          href="/trust"
          aria-current={pathname === "/trust" ? "page" : undefined}
        >
          Trust
        </Link>
        <details name="public-navigation">
          <summary>
            Company
            <ChevronDown size={12} aria-hidden="true" />
          </summary>
          <div className="vx-dropdown vx-dropdown--small">
            {company.map(([label, href]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </div>
        </details>
      </nav>
      <div className="vx-mobile-nav">
        <Link href={loggedIn ? "/app" : "/login"}>
          {loggedIn ? "App" : "Login"}
        </Link>
        <details>
          <summary aria-label="Open navigation menu">
            <Menu size={20} aria-hidden="true" />
          </summary>
          <nav className="vx-mobile-menu" aria-label="Public navigation mobile">
            <span>EXPLORE VAEROEX</span>
            <Link href="/">Home</Link>
            <Link href="/intelligence-systems">Intelligence Systems</Link>
            {PUBLIC_SYSTEMS.map((system) => (
              <Link key={system.id} href={system.route}>
                {system.name}
                <small>{system.statusLabel}</small>
              </Link>
            ))}
            <Link href="/pricing">Pricing</Link>
            <Link href="/trust">Trust Center</Link>
            {company.map(([label, href]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
            <Link href="/help">Help</Link>
            <Link
              href="/checkout/legal"
              className="vx-button vx-button--primary"
            >
              Get Executive Intelligence
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </nav>
        </details>
      </div>
    </div>
  );
}
