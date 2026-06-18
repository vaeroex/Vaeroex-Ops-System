"use client";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800 shadow-panel">
      <p className="text-sm font-semibold uppercase tracking-wide">Something needs attention</p>
      <h2 className="mt-2 text-2xl font-semibold">This page could not load</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6">{error.message || "Try again. If this continues, review the workspace configuration and environment variables."}</p>
      <button className="mt-5 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => reset()}>
        Try again
      </button>
    </section>
  );
}
