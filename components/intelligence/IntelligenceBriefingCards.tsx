"use client";

import Link from "next/link";
import { CalendarRange, Loader2, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateIntelligenceBriefingAction } from "@/app/app/intelligence/briefings/actions";
import {
  briefingTypeLabel,
  type IntelligenceBriefingState,
  type IntelligenceBriefingType
} from "@/lib/ai/intelligence-briefing/contracts";
import { briefingPeriodLabel } from "@/lib/ai/intelligence-briefing/period";

function statusLabel(state: IntelligenceBriefingState) {
  if (state.status === "current") return "Current";
  if (state.status === "unchanged") return "No significant change";
  if (state.status === "generating") return "Preparing";
  if (state.status === "unavailable") return state.eligibility === "no_eligible_evidence" ? "Not enough evidence" : "Unavailable";
  if (state.status === "failed") return "Not prepared";
  return state.eligibility === "limited" ? "Limited evidence" : "Ready";
}

function generatedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Generation time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function BriefingCard({ initialState }: { initialState: IntelligenceBriefingState }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [pending, startTransition] = useTransition();
  const type = state.briefingType;
  const canGenerate = state.status === "ready" || state.status === "failed";

  function generate() {
    if (!canGenerate || pending) return;
    startTransition(async () => {
      const next = await generateIntelligenceBriefingAction({ briefingType: type });
      setState(next);
      if (next.status === "current") router.refresh();
    });
  }

  return (
    <article className="rounded-lg border border-white/10 bg-[#08111f] p-5 shadow-panel" data-intelligence-briefing-card={type}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">{type === "weekly" ? "Rolling 7 days" : "Rolling 30 days"}</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{briefingTypeLabel(type)}</h2>
        </div>
        <CalendarRange aria-hidden="true" className="h-5 w-5 shrink-0 text-cyan-300" />
      </div>
      <p className="mt-3 text-sm text-slate-400">Evidence period: {briefingPeriodLabel(state.period)}</p>
      <p className="mt-2 text-sm leading-6 text-slate-300">
        {type === "weekly"
          ? "Synthesize the last 7 days of business evidence into a leadership-ready intelligence briefing."
          : "Synthesize the last 30 days of business evidence into a broader executive intelligence briefing."}
      </p>
      {state.artifact ? <p className="mt-2 text-xs text-slate-500">Last generated {generatedLabel(state.artifact.generatedAt)}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-cyan-300/25 bg-cyan-950/25 px-2.5 py-1 font-semibold text-cyan-100">{statusLabel(state)}</span>
        <span className="rounded-full border border-white/10 px-2.5 py-1 font-semibold text-slate-300">Confidence {state.confidence}</span>
      </div>
      {state.message ? <p className="mt-4 text-sm leading-6 text-slate-300" role="status">{state.message}</p> : null}
      <div className="mt-5 flex flex-wrap gap-3 border-t border-white/10 pt-4">
        {state.artifact ? (
          <Link href={`/app/intelligence/briefings/${type}`} className="inline-flex min-h-11 items-center rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-400 hover:text-vaeroex-navy">
            View briefing
          </Link>
        ) : null}
        {canGenerate ? (
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
            {pending
              ? "Preparing..."
              : state.artifact
                ? "Prepare updated briefing"
                : type === "weekly"
                  ? "Generate Weekly Briefing"
                  : "Generate Monthly Briefing"}
          </button>
        ) : null}
        {state.eligibility === "no_eligible_evidence" && !state.artifact ? (
          <Link href="/app/sources" className="inline-flex min-h-11 items-center rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.06]">
            Add business information
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function IntelligenceBriefingCards({ states }: { states: Readonly<Record<IntelligenceBriefingType, IntelligenceBriefingState>> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <BriefingCard initialState={states.weekly} />
      <BriefingCard initialState={states.monthly} />
    </div>
  );
}
