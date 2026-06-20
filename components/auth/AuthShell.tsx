import Link from "next/link";
import type { ReactNode } from "react";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { legalLinks } from "@/lib/legal/content";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <main className="min-h-screen bg-[#f8fafc] px-6 py-10 text-ink">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1fr_440px]">
        <section className="hidden rounded-lg border border-slate-800 bg-vaeroex-navy p-8 text-white shadow-command lg:block">
          <Link href="/" className="inline-flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <VaeroexLogo variant="full" size="lg" priority />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-silver">Intelligence Platform</span>
          </Link>
          <h1 className="mt-8 max-w-xl text-5xl font-semibold tracking-tight">
            Build the structure your growth depends on.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-slate-100">
            Sign in to review business health, visibility gaps, accountability signals, reports, and the execution priorities Vaeroex recommends next.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {["Visibility", "Accountability", "Execution"].map((label) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-silver">{label}</p>
                <p className="mt-2 text-sm text-slate-100">Visible in one workspace</p>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-lg border border-line/80 bg-white p-7 shadow-panel">
          <div className="mb-7">
            <div className="mb-5 flex justify-center">
              <VaeroexLogo variant="full" size="hero" priority className="max-w-full" />
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Intelligence Platform</p>
            <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>
          </div>
          {children}
          <nav className="mt-6 flex flex-wrap gap-3 border-t border-line pt-4 text-xs text-muted" aria-label="Authentication legal links">
            {legalLinks.slice(0, 5).map((link) => (
              <Link key={link.href} href={link.href} className="font-semibold hover:text-vaeroex-blue">
                {link.label}
              </Link>
            ))}
          </nav>
        </section>
      </div>
    </main>
  );
}
