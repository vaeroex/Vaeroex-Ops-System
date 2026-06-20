"use client";

import { useEffect, useState } from "react";
import { AnimatedMetric } from "@/components/motion/AnimatedMetric";

const previewSignals = [
  ["Profit Leak Detected", "7 leads without follow-up", "amber"],
  ["Predictive Insight", "Response time risk increasing", "red"],
  ["Recommended Action", "Assign CRM follow-up owner", "blue"],
  ["Task Assigned", "Sales Manager", "navy"],
  ["Outcome Improved", "Follow-up completion +18%", "green"]
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
    default:
      return "border-vaeroex-blue/25 bg-vaeroex-soft text-vaeroex-blue";
  }
}

export function MarketingDashboardPreview() {
  const [visibleCount, setVisibleCount] = useState<number>(previewSignals.length);
  const [motionDisabled, setMotionDisabled] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      setMotionDisabled(true);
      setVisibleCount(previewSignals.length);
      return;
    }

    setVisibleCount(0);

    const timers = previewSignals.map((_, index) =>
      window.setTimeout(() => setVisibleCount(index + 1), 520 + index * 620)
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <aside className="vaeroex-dashboard-preview rounded-xl border border-white/15 bg-white/95 p-4 text-ink shadow-command lg:p-5" aria-label="Operations Intelligence Suite demo preview">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Demo signal preview</p>
          <h2 className="mt-1 text-lg font-semibold">Operations Intelligence Suite</h2>
        </div>
        <span className="rounded-full bg-vaeroex-navy px-3 py-1 text-xs font-semibold text-white">Live loop</span>
      </div>
      <div className="mt-4 rounded-lg border border-line bg-slate-50 p-4">
        <AnimatedMetric
          label="Business Health Score"
          from={78}
          value={84}
          suffix="/100"
          helper="Example score movement after recommended follow-up actions."
          className="rounded-lg"
        />
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full w-[84%] rounded-full bg-gradient-to-r from-vaeroex-blue to-vaeroex-accent transition-[width] duration-700" />
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        {previewSignals.map(([title, body, tone], index) => {
          const visible = motionDisabled || index < visibleCount;

          return (
            <div
              key={title}
              className={[
                "rounded-lg border p-3 transition duration-500",
                toneClass(tone),
                visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
              ].join(" ")}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-75">{title}</p>
              <p className="mt-1 text-sm font-semibold">{body}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">Mock website animation only. Not connected to customer data.</p>
    </aside>
  );
}
