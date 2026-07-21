import { Clock3, ShieldCheck } from "lucide-react";
import {
  savedAnalysisTypeLabel,
  type SavedAnalysisEnvelope
} from "@/lib/reports/saved-analysis";

function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(date);
}

export function SavedAnalysisRenderer({ envelope }: { envelope: SavedAnalysisEnvelope }) {
  return (
    <div className="space-y-7 text-slate-100" data-saved-analysis-renderer>
      <header className="border-b border-white/10 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">{savedAnalysisTypeLabel(envelope.analysis_type)}</p>
        <h1 className="mt-2 text-2xl font-semibold leading-tight text-white sm:text-3xl">{envelope.title}</h1>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1"><ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" /> Confidence: {envelope.confidence}</span>
          <span className="inline-flex items-center gap-1"><Clock3 aria-hidden="true" className="h-3.5 w-3.5" /> Generated {readableDate(envelope.generated_at)}</span>
          <span>Saved {readableDate(envelope.saved_at)}</span>
          <span>Evidence {envelope.freshness}</span>
        </div>
      </header>

      <section className="rounded-lg border border-cyan-300/25 bg-cyan-950/15 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">{envelope.display.summary_label}</p>
        <p className="mt-3 text-lg font-semibold leading-8 text-white">{envelope.display.summary}</p>
      </section>

      <div className="space-y-5">
        {envelope.display.sections.map((section) => (
          <section
            key={section.id}
            className={section.tone === "limitation" ? "border-l-2 border-amber-300/45 pl-4" : "border-b border-white/10 pb-5"}
          >
            <h2 className="text-sm font-semibold text-white">{section.label}</h2>
            {typeof section.body === "string" ? (
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-300">{section.body}</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
                {section.body.map((item, index) => <li key={`${section.id}-${index}`} className="flex gap-2"><span aria-hidden="true">-</span><span className="whitespace-pre-line">{item}</span></li>)}
              </ul>
            )}
          </section>
        ))}
      </div>

      <details className="border-y border-white/10 py-4">
        <summary className="min-h-10 cursor-pointer text-sm font-semibold text-cyan-200">Supporting evidence ({envelope.citations.length})</summary>
        <p className="mt-2 text-sm leading-6 text-slate-400">The citations and source lineage below were copied with the validated analysis when it was saved.</p>
        <ol className="mt-3 divide-y divide-white/10">
          {envelope.citations.map((citation) => (
            <li key={citation.citationId} className="py-3">
              <p className="text-sm font-semibold text-white">[{citation.citationId}] {citation.title}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">{citation.sourceLabel} · {citation.sourceType}</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{citation.excerpt}</p>
              {citation.recordedAt ? <p className="mt-1 text-xs text-slate-500">Recorded {readableDate(citation.recordedAt)}</p> : null}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
