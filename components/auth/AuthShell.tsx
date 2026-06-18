import Link from "next/link";
import type { ReactNode } from "react";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-ink">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1fr_440px]">
        <section className="hidden lg:block">
          <Link href="/" className="text-sm font-semibold text-vaeroex-blue">
            Vaeroex Ops System
          </Link>
          <h1 className="mt-6 max-w-xl text-5xl font-semibold tracking-tight">
            Build the structure your growth depends on.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-muted">
            Set up workspaces, forms, checklists, reports, and manager review systems before asking
            Vaeroex for operational recommendations.
          </p>
        </section>
        <section className="rounded-lg border border-line bg-white p-7 shadow-panel">
          <div className="mb-7">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Vaeroex Ops System</p>
            <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{subtitle}</p>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}
