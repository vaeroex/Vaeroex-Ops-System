import Link from "next/link";

export default function AppNotFound() {
  return (
    <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
      <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Module not found</p>
      <h2 className="mt-2 text-2xl font-semibold">This operations page is not available</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        Return to the dashboard and choose an active Vaeroex Ops System module.
      </p>
      <Link href="/app" className="mt-5 inline-flex rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
        Back to dashboard
      </Link>
    </section>
  );
}
