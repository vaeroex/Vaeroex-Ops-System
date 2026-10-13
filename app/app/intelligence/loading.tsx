export default function IntelligenceLoading() {
  return <div aria-busy="true" aria-label="Loading Intelligence" className="space-y-5">
    <div className="h-12 w-64 max-w-full animate-pulse rounded-lg bg-slate-800" />
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">{[0, 1].map(item => <div key={item} className="h-52 animate-pulse rounded-xl bg-slate-800" />)}</div>
    <div className="grid gap-4 xl:grid-cols-[.8fr_1.6fr]"><div className="space-y-2">{[0, 1, 2, 3].map(item => <div key={item} className="h-24 animate-pulse rounded-lg bg-slate-800" />)}</div><div className="hidden h-96 animate-pulse rounded-xl bg-slate-800 xl:block" /></div>
    <span className="sr-only">Loading eligible business evidence. Scores will appear when available.</span>
  </div>;
}
