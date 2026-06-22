import Link from "next/link";
import type { Route } from "next";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const navLinks: Array<{ href: Route; label: string }> = [
  { href: "/pricing", label: "Pricing" },
  { href: "/networking", label: "Network" },
  { href: "/trust", label: "Trust" },
  { href: "/help", label: "Help" }
];

const productLinks: Array<{ href: Route; label: string; description: string }> = [
  {
    href: "/operations-intelligence" as Route,
    label: "Operations Intelligence",
    description: "Current Vaeroex product"
  },
  {
    href: "/future-domains" as Route,
    label: "Future Domains",
    description: "Platform direction"
  }
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

function ProductsDropdown({ mobile = false }: { mobile?: boolean }) {
  if (mobile) {
    return (
      <details className="rounded-lg border border-white/10 bg-white/5 text-xs font-semibold text-slate-200">
        <summary className="cursor-pointer list-none px-3 py-2 hover:text-vaeroex-accent [&::-webkit-details-marker]:hidden">
          Products
        </summary>
        <div className="grid gap-1 border-t border-white/10 p-2">
          {productLinks.map((link) => (
            <Link key={link.href} href={link.href} className="rounded-md px-2 py-2 hover:bg-white/10 hover:text-vaeroex-accent">
              <span className="block">{link.label}</span>
              <span className="mt-0.5 block text-[11px] font-medium text-slate-400">{link.description}</span>
            </Link>
          ))}
        </div>
      </details>
    );
  }

  return (
    <details className="group relative">
      <summary className="cursor-pointer list-none rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 hover:text-vaeroex-accent focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/40 [&::-webkit-details-marker]:hidden">
        Products
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-white/10 bg-vaeroex-navy p-2 shadow-command group-open:grid">
        {productLinks.map((link) => (
          <Link key={link.href} href={link.href} className="rounded-lg px-3 py-3 hover:bg-white/10 hover:text-vaeroex-accent">
            <span className="block text-sm font-semibold text-slate-100">{link.label}</span>
            <span className="mt-1 block text-xs font-medium text-slate-400">{link.description}</span>
          </Link>
        ))}
      </div>
    </details>
  );
}

export async function PublicSiteHeader() {
  const loggedIn = await isLoggedIn();

  return (
    <header className="border-b border-white/10 bg-vaeroex-navy px-6 py-4 text-white shadow-command">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3" aria-label="Vaeroex home">
          <span className="grid h-10 w-12 place-items-center rounded-lg border border-white/10 bg-white/10">
            <VaeroexLogo variant="symbol" size="xs" priority />
          </span>
          <span>
            <span className="block text-base font-semibold leading-none">Vaeroex</span>
            <span className="mt-1 block text-xs font-medium text-vaeroex-silver">Intelligence Platform</span>
          </span>
        </Link>

        <nav className="hidden flex-wrap items-center gap-1 lg:flex" aria-label="Public navigation">
          <Link href="/" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 hover:text-vaeroex-accent">
            Platform
          </Link>
          <ProductsDropdown />
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 hover:text-vaeroex-accent">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {loggedIn ? (
            <Link href="/app" className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:bg-white/15">
              Go to App
            </Link>
          ) : (
            <Link href="/login" className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:bg-white/15">
              Login
            </Link>
          )}
          <Link href="/pricing" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
            Start With Vaeroex
          </Link>
        </div>
      </div>
      <nav className="mx-auto mt-4 flex max-w-6xl flex-wrap gap-2 lg:hidden" aria-label="Public navigation mobile">
        <Link href="/" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-vaeroex-accent hover:text-vaeroex-accent">
          Platform
        </Link>
        <ProductsDropdown mobile />
        {navLinks.map((link) => (
          <Link key={link.href} href={link.href} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-vaeroex-accent hover:text-vaeroex-accent">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
