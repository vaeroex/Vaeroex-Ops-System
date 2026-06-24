import Link from "next/link";
import type { ReactNode } from "react";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { legalLinks } from "@/lib/legal/content";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

const intelligenceFeatures = [
  {
    label: "VISIBILITY",
    text: "See what others miss."
  },
  {
    label: "AWARENESS",
    text: "Understand what matters."
  },
  {
    label: "PREDICTION",
    text: "Anticipate what comes next."
  },
  {
    label: "EXECUTION",
    text: "Act with confidence."
  }
];

export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#f8fafc] px-4 py-6 text-ink sm:px-6 sm:py-8 lg:py-10">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_8%,rgba(30,107,255,0.20),transparent_30%),radial-gradient(circle_at_86%_12%,rgba(56,189,248,0.16),transparent_26%),linear-gradient(135deg,#030712_0%,#07111f_46%,#11112b_100%)]" />
      <div className="mx-auto grid min-h-[calc(100dvh-3rem)] max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_430px]">
        <section className="relative hidden overflow-hidden rounded-2xl border border-cyan-300/20 bg-vaeroex-navy p-8 text-white shadow-command lg:block">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(56,189,248,0.18),transparent_30%),radial-gradient(circle_at_84%_74%,rgba(124,58,237,0.20),transparent_32%)]" />
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-vaeroex-accent/70 to-transparent" />
          <div className="pointer-events-none absolute inset-y-8 right-0 w-px bg-gradient-to-b from-transparent via-vaeroex-blue/60 to-transparent" />
          <Link href="/" className="relative inline-flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.055] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur">
            <VaeroexLogo variant="full" size="lg" priority />
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-vaeroex-accent">Intelligence Platform</span>
          </Link>
          <div className="relative mt-12 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-vaeroex-accent">Vaeroex Access Terminal</p>
            <h1 className="mt-4 text-5xl font-semibold tracking-tight">
            The Advantage of Knowing First.
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-100">
              Organizations compete for information. Leaders compete for insight. Vaeroex helps transform information into visibility, awareness, prediction, and action.
            </p>
          </div>
          <div className="relative mt-9 grid gap-3 sm:grid-cols-2">
            {intelligenceFeatures.map((feature) => (
              <div key={feature.label} className="rounded-xl border border-white/10 bg-white/[0.07] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-vaeroex-accent">{feature.label}</p>
                <p className="mt-3 text-sm font-medium leading-6 text-slate-100">{feature.text}</p>
              </div>
            ))}
          </div>
          <div className="relative mt-8 rounded-xl border border-cyan-300/20 bg-slate-950/35 p-4 text-sm leading-6 text-slate-200 backdrop-blur">
            <span className="font-semibold text-vaeroex-accent">Information</span>
            <span className="mx-2 text-slate-500">/</span>
            <span>Visibility</span>
            <span className="mx-2 text-slate-500">/</span>
            <span>Awareness</span>
            <span className="mx-2 text-slate-500">/</span>
            <span>Prediction</span>
            <span className="mx-2 text-slate-500">/</span>
            <span>Action</span>
          </div>
        </section>
        <section className="rounded-2xl border border-line/80 bg-white/95 p-5 shadow-panel backdrop-blur sm:p-6 md:p-7">
          <div className="mb-7">
            <div className="mb-5 flex justify-center">
              <VaeroexLogo variant="full" size="hero" priority className="max-w-full" />
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-vaeroex-blue">Intelligence Platform</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h2>
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
