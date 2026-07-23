import Link from "next/link";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";

export default function OfflinePage() {
  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#030712] px-5 py-8 text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_8%,rgba(30,107,255,0.22),transparent_32%),radial-gradient(circle_at_88%_12%,rgba(56,189,248,0.14),transparent_28%),linear-gradient(135deg,#030712_0%,#07111f_48%,#11112b_100%)]" />
      <section className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-xl flex-col items-center justify-center text-center">
        <div className="rounded-2xl border border-cyan-300/20 bg-white/[0.055] p-5 shadow-command backdrop-blur">
          <VaeroexLogo variant="full" size="hero" priority />
        </div>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-vaeroex-accent">Offline</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Vaeroex is waiting for a connection.</h1>
        <p className="mt-4 max-w-lg text-sm leading-6 text-slate-300">
          Your device appears to be offline. Reconnect to continue using your Vaeroex workspace, Saved Analyses, Evidence, and Intelligence.
        </p>
        <Link
          href="/app"
          className="mt-7 inline-flex min-h-11 items-center justify-center rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-950/30 hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"
        >
          Try Vaeroex Again
        </Link>
      </section>
    </main>
  );
}
