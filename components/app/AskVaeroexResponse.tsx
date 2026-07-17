import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { ExecutiveIntelligenceAnswer } from "@/components/app/ExecutiveIntelligenceAnswer";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import type { GlobalSearchAnswer } from "@/lib/search/types";

type AskVaeroexResponseProps = {
  answer: GlobalSearchAnswer;
};

export function AskVaeroexResponse({ answer }: AskVaeroexResponseProps) {
  if (answer.kind === "security_response") {
    return <SecurityResponseNotice />;
  }

  if (answer.executiveBriefing) {
    return <ExecutiveIntelligenceAnswer briefing={answer.executiveBriefing} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Executive Answer</p>
        <p className="mt-2 text-base leading-7 text-white">{answer.directAnswer}</p>
      </div>

      {answer.evidenceNote ? <p className="border-l-2 border-vaeroex-accent/45 pl-4 text-sm leading-6 text-slate-300">{answer.evidenceNote}</p> : null}

      {answer.recommendationConfidence ? (
        <p className="text-sm text-slate-300">
          <span className="font-semibold text-white">Recommendation Confidence:</span> {answer.recommendationConfidence}
        </p>
      ) : null}

      {answer.relevantDestinations?.length ? (
        <nav className="grid gap-2 sm:grid-cols-2" aria-label="Relevant workspace destinations">
          {answer.relevantDestinations.map((destination) => (
            <Link
              key={`${destination.href}-${destination.label}`}
              href={destination.href as Route}
              className="group flex min-h-12 items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3 text-sm font-semibold text-white transition hover:border-vaeroex-accent/45 hover:bg-cyan-950/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"
            >
              <span className="min-w-0">
                <span className="block">{destination.label}</span>
                {destination.context ? <span className="mt-1 block text-xs font-normal leading-5 text-slate-400">{destination.context}</span> : null}
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-vaeroex-accent transition group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
