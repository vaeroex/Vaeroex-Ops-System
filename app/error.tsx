"use client";

export default function RootError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-ink">
      <section className="mx-auto max-w-2xl rounded-lg border border-red-200 bg-red-50 p-7 text-red-800 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-wide">Vaeroex Ops System</p>
        <h1 className="mt-2 text-2xl font-semibold">The app could not load</h1>
        <p className="mt-3 text-sm leading-6">{error.message || "Try again or check the deployment configuration."}</p>
        <button className="mt-5 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => reset()}>
          Try again
        </button>
      </section>
    </main>
  );
}
