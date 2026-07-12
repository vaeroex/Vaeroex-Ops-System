export default function AppLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading executive overview">
      <div className="flex items-end justify-between gap-4 border-b border-line/80 pb-5">
        <div className="space-y-2">
          <div className="h-7 w-52 animate-pulse rounded-md bg-slate-200" />
          <div className="h-4 w-64 max-w-full animate-pulse rounded-md bg-slate-200" />
        </div>
        <div className="hidden h-11 w-40 animate-pulse rounded-lg bg-slate-200 sm:block" />
      </div>
      <div className="h-72 animate-pulse rounded-lg bg-slate-200" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="h-56 animate-pulse rounded-lg bg-slate-200" />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <div className="h-52 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-52 animate-pulse rounded-lg bg-slate-200" />
      </div>
      <span className="sr-only">Loading the latest eligible business evidence.</span>
    </div>
  );
}
