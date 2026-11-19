"use client";
import Link from "next/link";
import type { Route } from "next";
import { ChevronDown, Menu, ArrowUpRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { SOLUTIONS } from "@/lib/marketing/solutions";

const company = [
  ["About", "/about"],
  ["Why Vaeroex", "/about/why-vaeroex"],
  ["Contact", "/contact"],
  ["Network", "/networking"],
  ["Careers", "/careers"],
] as const;
export function PublicNavigation({ loggedIn }: { loggedIn: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const currentPage = (href: string) => pathname === href ? "page" : undefined;
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
            Solutions
            <ChevronDown size={12} aria-hidden="true" />
          </summary>
          <div className="vx-dropdown">
            {SOLUTIONS.map((system) => (
              <div key={system.route} className="vx-nav-product" role="group" aria-label={system.name}>
                <Link href={system.route} aria-current={currentPage(system.route)}>
                  <strong>{system.name}</strong>
                  <small className="vx-nav-description">{system.description}</small>
                </Link>
              </div>
            ))}
            <Link href="/executive-intelligence" aria-current={currentPage("/executive-intelligence")} className="vx-dropdown-overview">
              Executive Intelligence
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </details>
        <Link
          href="/pricing"
          aria-current={currentPage("/pricing")}
        >
          Pricing
        </Link>
        <Link
          href="/trust"
          aria-current={currentPage("/trust")}
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
              <Link key={href} href={href} aria-current={currentPage(href)}>
                {label}
              </Link>
            ))}
          </div>
        </details>
      </nav>
      <div className="vx-mobile-nav">
        <Link href={(loggedIn ? "/systems" : "/login") as Route}>
          {loggedIn ? "Your Systems" : "Log in"}
        </Link>
        <details>
          <summary aria-label="Open navigation menu">
            <Menu size={20} aria-hidden="true" />
          </summary>
          <nav className="vx-mobile-menu" aria-label="Public navigation mobile">
            <span>EXPLORE VAEROEX</span>
            <Link href="/" aria-current={currentPage("/")}>Home</Link>
            {SOLUTIONS.map((system) => (
              <div key={system.route} className="vx-nav-product" role="group" aria-label={system.name}>
                <Link href={system.route} aria-current={currentPage(system.route)}>
                  {system.name}
                  <small className="vx-nav-description">{system.description}</small>
                </Link>
              </div>
            ))}
            <Link href="/executive-intelligence" aria-current={currentPage("/executive-intelligence")}>Executive Intelligence</Link>
            <Link href="/pricing" aria-current={currentPage("/pricing")}>Pricing</Link>
            <Link href="/trust" aria-current={currentPage("/trust")}>Trust Center</Link>
            {company.map(([label, href]) => (
              <Link key={href} href={href} aria-current={currentPage(href)}>
                {label}
              </Link>
            ))}
            <Link href="/help" aria-current={currentPage("/help")}>Help</Link>
            <Link
              href="/contact?inquiry=custom-business-systems"
              className="vx-button vx-button--primary"
            >
              Discuss a Project
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </nav>
        </details>
      </div>
    </div>
  );
}
