import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-ink">
      <section className="mx-auto max-w-2xl rounded-lg border border-line bg-white p-7 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Vaeroex</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-muted">The page may have moved, or this module may not be available yet.</p>
        <Link href="/app" className="mt-5 inline-flex rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
