import Link from "next/link";
import type { ReactNode } from "react";

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
          <Link href="/" className="inline-flex items-center gap-3 text-sm font-semibold text-white">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-vaeroex-blue text-xs font-bold">V</span>
            <span>Vaeroex Ops System</span>
          </Link>
          <h1 className="mt-8 max-w-xl text-5xl font-semibold tracking-tight">
            Your company’s daily control panel starts here.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-blue-100">
            Sign in to review business health, focus priorities, risks, reports, and the work Vaeroex recommends next.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {["Health", "Risks", "Actions"].map((label) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">{label}</p>
                <p className="mt-2 text-sm text-blue-50">Visible in one workspace</p>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-lg border border-line/80 bg-white p-7 shadow-panel">
          <div className="mb-7">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Vaeroex Ops System</p>
            <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}
