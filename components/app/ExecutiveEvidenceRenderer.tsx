import { presentExecutiveEvidence } from "@/lib/presentation/executive-evidence";
import type { ExecutiveEvidenceReference } from "@/lib/search/types";

export function ExecutiveEvidenceRenderer({ references }: { references: ExecutiveEvidenceReference[] }) {
  if (!references.length) return null;

  return (
    <ol className="mt-3 space-y-3 border-l border-white/10 pl-3">
      {references.map((reference) => {
        const evidence = presentExecutiveEvidence(reference);
        return (
          <li key={`${reference.citationId}-${reference.title}`} className="min-w-0 text-xs leading-5 text-slate-300">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono text-[0.68rem] font-semibold text-vaeroex-accent">[{evidence.citationNumber}]</span>
              <span className="font-semibold text-slate-100">{evidence.sourceName}</span>
              <span className="text-slate-500">{evidence.sourceType}</span>
            </div>
            {evidence.summary ? <p className="mt-1 break-words text-slate-400">{evidence.summary}</p> : null}
            {evidence.details.length ? (
              <dl className="mt-2 grid min-w-0 gap-x-5 gap-y-1.5 sm:grid-cols-2">
                {evidence.details.map((detail) => (
                  <div key={`${detail.label}-${detail.value}`} className="min-w-0">
                    <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-slate-500">{detail.label}</dt>
                    <dd className="break-words text-slate-300">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {evidence.provenance.length ? (
              <p className="mt-2 break-words text-[0.7rem] text-slate-500">
                {evidence.provenance.map((item) => `${item.label}: ${item.value}`).join(" · ")}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
