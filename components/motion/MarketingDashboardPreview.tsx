const previewSignals = [
  ["Anomaly Detected", "Unexpected pattern surfaced.", "amber"],
  ["Risk Detected", "Emerging condition requires attention.", "red"],
  ["Context Retrieved", "Relevant historical signal identified.", "violet"],
  ["Decision Required", "Leadership review recommended.", "blue"],
  ["Action Recommended", "Next step generated from intelligence.", "navy"],
  ["Evidence Connected", "Supporting source identified.", "green"],
  ["Outcome Tracked", "Impact monitored after action.", "cyan"]
] as const;

function toneClass(tone: (typeof previewSignals)[number][2]) {
  switch (tone) {
    case "amber":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "red":
      return "border-red-200 bg-red-50 text-red-800";
    case "green":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "navy":
      return "border-vaeroex-navy/20 bg-vaeroex-navy text-white";
    case "violet":
      return "border-fuchsia-300/25 bg-fuchsia-500/10 text-fuchsia-100";
    case "cyan":
      return "border-cyan-300/25 bg-cyan-400/10 text-cyan-100";
    default:
      return "border-vaeroex-blue/25 bg-vaeroex-soft text-vaeroex-blue";
  }
}

export function MarketingDashboardPreview() {
  return (
    <aside className="vaeroex-dashboard-preview rounded-xl border border-white/15 bg-[#08111f]/95 p-3 text-white shadow-command lg:p-4" aria-label="Example Vaeroex intelligence preview">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2.5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Example Intelligence Preview</p>
          <h2 className="mt-1 text-lg font-semibold">Sample Intelligence Signals</h2>
        </div>
        <span className="rounded-full border border-vaeroex-accent/40 bg-vaeroex-accent/10 px-3 py-1 text-xs font-semibold text-vaeroex-accent">Illustrative</span>
      </div>
      <div className="sm:hidden">
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-white/10 bg-white/[0.06] p-3">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-400">Signal Confidence</p>
            <p className="mt-1 text-2xl font-semibold text-vaeroex-accent">84%</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[84%] rounded-full bg-gradient-to-r from-vaeroex-blue to-vaeroex-accent" />
            </div>
          </div>
          <div className="rounded-lg border border-amber-300/25 bg-amber-400/10 p-3 text-amber-100">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] opacity-75">Anomaly Detected</p>
            <p className="mt-1 text-sm font-semibold leading-5">Unexpected pattern surfaced.</p>
          </div>
        </div>
        <div className="mt-2 rounded-lg border border-vaeroex-blue/25 bg-vaeroex-blue/10 px-3 py-2.5 text-vaeroex-accent">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] opacity-75">Decision Required</p>
          <p className="mt-1 text-sm font-semibold">Leadership review recommended.</p>
        </div>
      </div>

      <div className="hidden sm:block">
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.06] p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Signal Confidence</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-vaeroex-blue">84%</p>
          <p className="mt-2 text-sm leading-6 text-muted">Illustrative confidence score for a detected pattern.</p>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-[84%] rounded-full bg-gradient-to-r from-vaeroex-blue to-vaeroex-accent" />
          </div>
        </div>
        <div className="mt-2.5 grid gap-1.5">
          {previewSignals.map(([title, body, tone]) => (
            <div key={title} className={["rounded-lg border px-3 py-2.5", toneClass(tone)].join(" ")}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-75">{title}</p>
              <p className="mt-1 text-sm font-semibold">{body}</p>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-xs leading-5 text-slate-400">Illustrative website preview only. Not connected to customer data.</p>
      </div>
    </aside>
  );
}
