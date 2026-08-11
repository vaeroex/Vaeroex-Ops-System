import Link from "next/link";
import type { Route } from "next";
import { ChevronDown, Menu } from "lucide-react";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { INTELLIGENCE_SYSTEMS_ROUTE, PUBLIC_SYSTEMS } from "@/lib/marketing/public-systems";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const primaryNavLinks: Array<{ href: Route; label: string }> = [
  { href: "/", label: "Home" },
  { href: INTELLIGENCE_SYSTEMS_ROUTE, label: "Intelligence" }
];

const productLinks: Array<{ href: Route; label: string; status: string }> = PUBLIC_SYSTEMS.map((system) => ({
  href: system.route,
  label: system.name,
  status: system.statusLabel
}));

const secondaryNavLinks: Array<{ href: Route; label: string }> = [
  { href: "/pricing", label: "Pricing" },
  { href: "/trust", label: "Trust" }
];

const companyLinks: Array<{ href: Route; label: string }> = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/networking", label: "Network" },
  { href: "/careers", label: "Careers" }
];

async function isLoggedIn() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return false;
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  return Boolean(user);
}

export async function PublicSiteHeader() {
  const loggedIn = await isLoggedIn();

  return (
    <header className="vaeroex-public-header sticky top-0 z-50 px-4 text-white sm:px-6">
      <div className="mx-auto flex h-[4.5rem] max-w-[86rem] items-center justify-between gap-4">
        <Link href="/" className="flex min-w-0 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60" aria-label="Vaeroex home">
          <span className="grid h-9 w-9 shrink-0 place-items-center">
            <VaeroexLogo variant="symbol" size="xs" priority />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold uppercase leading-none tracking-normal">Vaeroex</span>
            <span className="mt-1 hidden text-[0.66rem] font-medium uppercase tracking-normal text-slate-500 sm:block">Intelligence Systems</span>
          </span>
        </Link>

        <nav className="vaeroex-public-header__nav hidden items-center gap-1 lg:flex" aria-label="Public navigation">
          {primaryNavLinks.map((link) => (
            <Link key={link.href} href={link.href} className="px-3 py-2 text-xs font-semibold uppercase tracking-normal text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              {link.label}
            </Link>
          ))}
          <details className="group relative">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Intelligence Areas
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="vaeroex-public-menu absolute left-0 top-full mt-2 w-72 border border-white/10 p-2 shadow-command">
              {productLinks.map((link) => (
                <Link key={link.href} href={link.href} className="block rounded-md px-3 py-2.5 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                  <span className="block text-sm font-semibold text-slate-200">{link.label}</span>
                  <span className="mt-1 block text-[0.64rem] font-semibold uppercase tracking-normal text-cyan-200/70">{link.status}</span>
                </Link>
              ))}
            </div>
          </details>
          {secondaryNavLinks.map((link) => (
            <Link key={link.href} href={link.href} className="px-3 py-2 text-xs font-semibold uppercase tracking-normal text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              {link.label}
            </Link>
          ))}
          <details className="group relative">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Company
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="vaeroex-public-menu absolute left-0 top-full mt-2 w-52 border border-white/10 p-2 shadow-command">
              {companyLinks.map((link) => (
                <Link key={link.href} href={link.href} className="block rounded-md px-3 py-2.5 text-sm font-semibold text-slate-300 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                  {link.label}
                </Link>
              ))}
            </div>
          </details>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          {loggedIn ? (
            <Link href="/app" className="vaeroex-header-action inline-flex min-h-11 items-center px-4 py-2 text-sm font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Go to App
            </Link>
          ) : (
            <Link href="/login" className="vaeroex-header-action inline-flex min-h-11 items-center px-4 py-2 text-sm font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Login
            </Link>
          )}
          <StartWithVaeroexMenu align="right" label="Start Executive Intelligence" size="compact" />
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <Link href={loggedIn ? "/app" : "/login"} className="vaeroex-header-action inline-flex min-h-11 items-center px-3 py-2 text-sm font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
            {loggedIn ? "App" : "Login"}
          </Link>
          <details className="group relative">
            <summary className="vaeroex-header-action grid h-11 w-11 cursor-pointer list-none place-items-center text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60" aria-label="Open navigation menu">
              <Menu className="h-5 w-5" aria-hidden="true" />
            </summary>
            <nav className="vaeroex-public-menu absolute right-0 top-full mt-2 max-h-[calc(100dvh-5.5rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto border border-white/10 p-3 shadow-command" aria-label="Public navigation mobile">
              <p className="px-2 pb-2 text-[0.68rem] font-semibold uppercase tracking-normal text-slate-500">Explore Vaeroex</p>
              {[...primaryNavLinks, ...productLinks, ...secondaryNavLinks, ...companyLinks, { href: "/help" as Route, label: "Help" }].map((link) => {
                const className = "block min-h-11 rounded-md px-3 py-2.5 text-sm font-semibold text-slate-200 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60";
                return <Link key={link.href} href={link.href} className={className}>{link.label}</Link>;
              })}
              <StartWithVaeroexMenu className="mt-3 w-full" label="Start Executive Intelligence" />
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
