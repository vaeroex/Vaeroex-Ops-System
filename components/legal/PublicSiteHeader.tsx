import Link from "next/link";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const navLinks = [
  { href: "/#platform", label: "Platform" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/trust", label: "Trust" },
  { href: "/help", label: "Help" },
  { href: "/contact", label: "Contact" }
] as const;

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
    <header className="border-b border-white/10 bg-vaeroex-navy px-6 py-4 text-white shadow-command">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3" aria-label="Vaeroex home">
          <span className="grid h-10 w-12 place-items-center rounded-lg border border-white/10 bg-white/10">
            <VaeroexLogo variant="symbol" size="xs" priority />
          </span>
          <span>
            <span className="block text-base font-semibold leading-none">Vaeroex</span>
            <span className="mt-1 block text-xs font-medium text-vaeroex-silver">Operations Intelligence Platform</span>
          </span>
        </Link>

        <nav className="hidden flex-wrap items-center gap-1 lg:flex" aria-label="Public navigation">
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
          <Link href="/demo" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
            Book a Demo
          </Link>
        </div>
      </div>
      <nav className="mx-auto mt-4 flex max-w-6xl flex-wrap gap-2 lg:hidden" aria-label="Public navigation mobile">
        {navLinks.map((link) => (
          <Link key={link.href} href={link.href} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-vaeroex-accent hover:text-vaeroex-accent">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
