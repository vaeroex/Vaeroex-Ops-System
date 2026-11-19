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
    <main className="min-h-dvh overflow-x-hidden bg-[#f8fafc] px-4 py-6 text-ink sm:px-6 sm:py-8 lg:py-10">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_8%,rgba(30,107,255,0.20),transparent_30%),radial-gradient(circle_at_86%_12%,rgba(56,189,248,0.16),transparent_26%),linear-gradient(135deg,#030712_0%,#07111f_46%,#11112b_100%)]" />
      <div className="mx-auto grid min-h-[calc(100dvh-3rem)] max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_430px]">
        <section className="relative hidden rounded-2xl border border-cyan-300/20 bg-vaeroex-navy p-10 text-white shadow-command lg:block">
          <Link href="/" aria-label="Vaeroex home"><VaeroexLogo variant="wordmark" size="lg" priority /></Link>
          <p className="mt-16 text-xs font-semibold uppercase tracking-widest text-cyan-200">Your Vaeroex account</p>
          <h2 className="mt-4 text-4xl font-semibold leading-tight">Products and connected systems.<br />One place to begin.</h2>
          <p className="mt-6 text-base leading-8 text-slate-200">Access the systems available to your account. Workspace permissions and product requirements apply when you open a system.</p>
          <Link href="/#solutions" className="mt-10 inline-flex min-h-11 items-center font-semibold text-cyan-200 underline underline-offset-4">Explore Solutions</Link>
        </section>
        <section className="rounded-2xl border border-line/80 bg-white/95 p-5 shadow-panel backdrop-blur sm:p-6 md:p-7">
          <div className="mb-7">
            <div className="mb-5 flex justify-center">
              <VaeroexLogo variant="stacked" size="md" priority />
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-vaeroex-blue">Vaeroex account</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
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
