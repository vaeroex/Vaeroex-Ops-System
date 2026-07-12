import { ArrowUpRight, FileCheck2, ShieldAlert } from "lucide-react";

const trendPoints = "8,66 42,58 76,61 110,48 144,42 178,36 212,31 246,28";

export function MarketingDashboardPreview() {
  return (
    <aside className="vaeroex-dashboard-preview overflow-hidden rounded-lg border border-white/15 bg-[#07111f]/95 text-white shadow-command" aria-label="Illustrative Vaeroex Operations Intelligence preview">
      <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-cyan-200">Leadership Brief</p>
          <h2 className="mt-1 text-lg font-semibold">What needs attention now</h2>
        </div>
        <span className="w-fit rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-300">Illustrative</span>
      </div>

      <div className="grid gap-2 bg-[#07111f] p-4 sm:hidden">
        <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.035] p-3">
          <div>
            <p className="text-xs font-semibold text-slate-400">Business Health</p>
            <p className="mt-1 text-2xl font-semibold text-white">78 <span className="text-xs text-slate-500">/ 100</span></p>
          </div>
          <span className="rounded-full border border-amber-300/30 bg-amber-950/30 px-2.5 py-1 text-xs font-semibold text-amber-100">Watch</span>
        </div>
        <div className="rounded-md border border-red-300/20 bg-red-950/20 p-3">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-red-200">Primary risk</p>
          <p className="mt-1 text-sm font-semibold leading-5 text-white">Customer response quality is weakening.</p>
        </div>
        <div className="rounded-md border border-blue-300/20 bg-blue-950/20 p-3">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-cyan-200">Recommended review</p>
          <p className="mt-1 text-sm leading-5 text-slate-200">Review staffing coverage and process consistency.</p>
        </div>
      </div>

      <div className="hidden gap-px bg-white/10 sm:grid sm:grid-cols-[0.8fr_1.2fr]">
        <div className="bg-[#07111f] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-slate-400">Business Health</p>
            <span className="rounded-full border border-amber-300/30 bg-amber-950/30 px-2.5 py-1 text-xs font-semibold text-amber-100">Watch</span>
          </div>
          <div className="mt-3 flex items-end gap-2">
            <span className="text-5xl font-semibold">78</span>
            <span className="pb-1 text-sm text-slate-400">/ 100</span>
          </div>
          <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center justify-between text-[0.68rem] font-semibold text-slate-400">
              <span>6-week movement</span>
              <span className="text-emerald-200">+4</span>
            </div>
            <svg viewBox="0 0 254 76" role="img" aria-label="Illustrative Business Health trend rising four points" className="mt-2 h-16 w-full">
              <defs>
                <linearGradient id="marketing-health-line" x1="0" x2="1">
                  <stop offset="0" stopColor="#2563EB" />
                  <stop offset="1" stopColor="#22D3EE" />
                </linearGradient>
              </defs>
              <path d="M8 68H246" stroke="rgba(148,163,184,.18)" strokeWidth="1" />
              <polyline points={trendPoints} fill="none" stroke="url(#marketing-health-line)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="246" cy="28" r="4" fill="#22D3EE" />
            </svg>
          </div>
        </div>

        <div className="bg-[#07111f] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="rounded-md border border-red-300/25 bg-red-950/35 p-2 text-red-100">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-red-200">Primary risk</p>
              <h3 className="mt-1 text-base font-semibold leading-6">Customer response quality is weakening.</h3>
            </div>
          </div>
          <div className="mt-4 border-l border-white/10 pl-4">
            <p className="text-xs font-semibold text-slate-400">Supporting evidence</p>
            <p className="mt-1 text-sm leading-6 text-slate-200">Response-time movement, customer feedback, and recent operating signals point in the same direction.</p>
          </div>
          <div className="mt-4 rounded-md border border-blue-300/20 bg-blue-950/25 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
              <FileCheck2 className="h-4 w-4" aria-hidden="true" />
              Recommended review
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-200">Determine whether staffing coverage or process consistency is the primary cause.</p>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-400">Evidence confidence</span>
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-200">High <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
          </div>
        </div>
      </div>
      <p className="border-t border-white/10 px-4 py-3 text-[0.68rem] leading-5 text-slate-500 sm:px-5">Illustrative product preview. Workspace conclusions depend on eligible customer evidence.</p>
    </aside>
  );
}
