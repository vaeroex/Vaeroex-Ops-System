const phaseItems = [
  "Project scaffold",
  "Vaeroex prompt system",
  "Supabase schema and RLS",
  "Seed data structure",
  "Environment and README draft"
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-ink">
      <section className="mx-auto max-w-5xl rounded-lg border border-line bg-white p-8 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Phase 1 scaffold</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Vaeroex Ops System</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          Build the structure your growth depends on. This workspace is prepared for the protected app,
          Supabase tenant data, and Vaeroex operations recommendations.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {phaseItems.map((item) => (
            <div key={item} className="rounded-lg border border-line bg-slate-50 p-4">
              <p className="text-sm font-medium">{item}</p>
              <p className="mt-2 text-sm text-muted">Ready for the next implementation phase.</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
