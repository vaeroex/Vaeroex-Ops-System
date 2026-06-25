type CompactSummaryChip = {
  label: string;
  value: string | number;
  tone?: "default" | "attention" | "good" | "muted";
};

type CompactSummaryChipsProps = {
  items: CompactSummaryChip[];
  className?: string;
};

function chipTone(tone: CompactSummaryChip["tone"]) {
  if (tone === "attention") return "border-amber-400/35 bg-amber-950/25 text-amber-100";
  if (tone === "good") return "border-emerald-400/35 bg-emerald-950/25 text-emerald-100";
  if (tone === "muted") return "border-slate-600/40 bg-slate-950/30 text-slate-300";
  return "border-cyan-300/25 bg-cyan-400/10 text-cyan-100";
}

export function CompactSummaryChips({ items, className = "" }: CompactSummaryChipsProps) {
  return (
    <div className={`vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto pb-1 ${className}`}>
      {items.map((item) => (
        <span key={`${item.label}-${item.value}`} className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${chipTone(item.tone)}`}>
          {item.label}
          <span className="text-white">{item.value}</span>
        </span>
      ))}
    </div>
  );
}
