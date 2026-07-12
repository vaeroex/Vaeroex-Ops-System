import Link from "next/link";
import type { Route } from "next";
import { ChevronDown, Menu } from "lucide-react";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const primaryNavLinks: Array<{ href: Route; label: string }> = [
  { href: "/", label: "Platform" },
  { href: "/operations-intelligence", label: "Operations Intelligence" },
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
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#050b18]/95 px-4 py-3 text-white shadow-command backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <Link href="/" className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60" aria-label="Vaeroex home">
          <span className="grid h-10 w-11 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.07]">
            <VaeroexLogo variant="symbol" size="xs" priority />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold leading-none">Vaeroex</span>
            <span className="mt-1 hidden text-xs font-medium text-slate-400 sm:block">Operations Intelligence</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Public navigation">
          {primaryNavLinks.map((link) => (
            <Link key={link.href} href={link.href} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              {link.label}
            </Link>
          ))}
          <details className="group relative">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Company
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="absolute left-0 top-full mt-2 w-48 rounded-lg border border-white/10 bg-[#07111f] p-2 shadow-command">
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
            <Link href="/app" className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Go to App
            </Link>
          ) : (
            <Link href="/login" className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Login
            </Link>
          )}
          <StartWithVaeroexMenu align="right" size="compact" />
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <Link href={loggedIn ? "/app" : "/login"} className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
            {loggedIn ? "App" : "Login"}
          </Link>
          <details className="group relative">
            <summary className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-lg border border-white/15 bg-white/[0.06] text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60" aria-label="Open navigation menu">
              <Menu className="h-5 w-5" aria-hidden="true" />
            </summary>
            <nav className="absolute right-0 top-full mt-2 max-h-[calc(100dvh-5.5rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-white/10 bg-[#07111f] p-3 shadow-command" aria-label="Public navigation mobile">
              <p className="px-2 pb-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Explore Vaeroex</p>
              {[...primaryNavLinks, ...companyLinks, { href: "/help" as Route, label: "Help" }].map((link) => (
                <Link key={link.href} href={link.href} className="block min-h-11 rounded-md px-3 py-2.5 text-sm font-semibold text-slate-200 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                  {link.label}
                </Link>
              ))}
              <StartWithVaeroexMenu className="mt-3 w-full" />
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
