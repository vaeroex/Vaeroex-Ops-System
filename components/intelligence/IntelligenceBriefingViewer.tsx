import Link from "next/link";
import { ArrowLeft, CalendarRange, ShieldCheck } from "lucide-react";
import { SaveAnalysisButton } from "@/components/reports/SaveAnalysisButton";
import {
  briefingTypeLabel,
  type IntelligenceBriefingArtifact,
  type IntelligenceBriefingClaim
} from "@/lib/ai/intelligence-briefing/contracts";
import { briefingPeriodLabel } from "@/lib/ai/intelligence-briefing/period";

function CitationLinks({ claim, artifact }: { claim: IntelligenceBriefingClaim; artifact: IntelligenceBriefingArtifact }) {
  const signalByRef = new Map(artifact.signals.map((signal) => [signal.ref, signal]));
  const ids = Array.from(new Set(claim.support_refs.flatMap((ref) => signalByRef.get(ref)?.citationIds || []))).sort((left, right) => left - right);
  if (!ids.length) return null;
  return (
    <span className="ml-1 inline-flex gap-1">
      {ids.map((id) => <a key={id} href={`#briefing-citation-${id}`} className="text-xs font-semibold text-cyan-200 hover:underline">[{id}]</a>)}
    </span>
  );
}

function readableTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

export function IntelligenceBriefingViewer({ artifact }: { artifact: IntelligenceBriefingArtifact }) {
  const sectionLabelById = new Map(artifact.sections.map((section) => [section.id, section.label]));
  const analysisType = artifact.briefingType === "weekly" ? "weekly_briefing" : "monthly_briefing";
  return (
    <div className="space-y-6" data-intelligence-briefing-viewer={artifact.briefingType}>
      <Link href="/app/intelligence/briefings" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-cyan-200 hover:underline">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Intelligence Briefings
      </Link>
      <header className="border-b border-white/10 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-cyan-200">Executive Intelligence</p>
        <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{briefingTypeLabel(artifact.briefingType)}</h1>
        <p className="mt-2 text-sm font-semibold text-cyan-100">
          {artifact.eligibility === "limited" ? "Limited-evidence briefing" : "Evidence-backed briefing"}
        </p>
        {artifact.eligibility === "limited" ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">This briefing synthesizes the information currently available. Some business areas may be omitted, and the available evidence may not represent the entire business.</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-400">
          <span className="inline-flex items-center gap-1.5"><CalendarRange aria-hidden="true" className="h-4 w-4" /> {briefingPeriodLabel(artifact.period)}</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck aria-hidden="true" className="h-4 w-4" /> {artifact.confidence} confidence</span>
          <span>Generated {readableTimestamp(artifact.generatedAt)}</span>
          <span>{artifact.evidenceCoverage.supportingRecordCount} eligible records</span>
          <span>{artifact.evidenceCoverage.independentSourceCount} independent sources</span>
        </div>
      </header>

      <section className="border-l-2 border-cyan-300/45 pl-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Executive summary</p>
        <p className="mt-3 text-lg font-semibold leading-8 text-white">
          {artifact.analysis.executive_summary.text}
          <CitationLinks claim={artifact.analysis.executive_summary} artifact={artifact} />
        </p>
      </section>

      <div className="space-y-6">
        {artifact.analysis.sections.map((section) => (
          <section key={section.section_id} className="border-b border-white/10 pb-6">
            <h2 className="text-lg font-semibold text-white">{sectionLabelById.get(section.section_id) || section.section_id}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {section.summary}
              <CitationLinks claim={{ text: section.summary, support_refs: section.support_refs }} artifact={artifact} />
            </p>
            <ul className="mt-4 space-y-3">
              {section.claims.map((claim, index) => (
                <li key={`${section.section_id}-${index}`} className="flex gap-3 text-sm leading-6 text-slate-300">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                  <span>{claim.text}<CitationLinks claim={claim} artifact={artifact} /></span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="border-b border-white/10 pb-6">
        <h2 className="text-lg font-semibold text-white">Leadership considerations</h2>
        <ul className="mt-3 space-y-3">
          {artifact.analysis.leadership_considerations.map((claim, index) => (
            <li key={index} className="text-sm leading-6 text-slate-300">{claim.text}<CitationLinks claim={claim} artifact={artifact} /></li>
          ))}
        </ul>
      </section>

      {artifact.contextReferences.length ? (
        <section className="border-b border-white/10 pb-6">
          <h2 className="text-lg font-semibold text-white">Approved reported context</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Business Notes provide attributed context only. They do not independently prove causation or alter measured business evidence.</p>
          <ul className="mt-4 space-y-3">
            {artifact.contextReferences.map((context) => (
              <li key={context.ref} className="border-l-2 border-white/10 pl-4">
                <p className="text-sm font-semibold text-white">{context.title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-300">{context.summary}</p>
                <p className="mt-1 text-xs text-slate-500">Approved {readableTimestamp(context.approvedAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border-y border-white/10 py-5">
        <h2 className="text-lg font-semibold text-white">Evidence, confidence & limitations</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="font-semibold text-slate-300">Evidence period</dt><dd className="mt-1 text-slate-400">{briefingPeriodLabel(artifact.period)}</dd></div>
          <div><dt className="font-semibold text-slate-300">Evidence cutoff</dt><dd className="mt-1 text-slate-400">{readableTimestamp(artifact.period.cutoff)}</dd></div>
          <div><dt className="font-semibold text-slate-300">Freshness</dt><dd className="mt-1 capitalize text-slate-400">{artifact.evidenceCoverage.freshness}</dd></div>
          <div><dt className="font-semibold text-slate-300">Coverage</dt><dd className="mt-1 text-slate-400">{artifact.evidenceCoverage.coverageLabel}</dd></div>
          <div><dt className="font-semibold text-slate-300">Supporting records</dt><dd className="mt-1 text-slate-400">{artifact.evidenceCoverage.supportingRecordCount}</dd></div>
          <div><dt className="font-semibold text-slate-300">Independent sources</dt><dd className="mt-1 text-slate-400">{artifact.evidenceCoverage.independentSourceCount}</dd></div>
        </dl>
        {artifact.evidenceCoverage.includedDomains.length ? (
          <p className="mt-4 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-300">Included areas:</span> {artifact.evidenceCoverage.includedDomains.join(", ")}</p>
        ) : null}
        {artifact.evidenceCoverage.missingOrWeakDomains.length ? (
          <p className="mt-2 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-300">Missing or weak coverage:</span> {artifact.evidenceCoverage.missingOrWeakDomains.join(", ")}</p>
        ) : null}
        {artifact.limitations.length ? (
          <ul className="mt-4 space-y-2 border-l-2 border-amber-300/45 pl-4 text-sm leading-6 text-slate-400">
            {artifact.limitations.map((limitation) => <li key={limitation.ref}>{limitation.text}</li>)}
          </ul>
        ) : null}
      </section>

      <details className="border-y border-white/10 py-4">
        <summary className="min-h-10 cursor-pointer text-sm font-semibold text-cyan-200">Supporting evidence ({artifact.citations.length})</summary>
        <ol className="mt-3 divide-y divide-white/10">
          {artifact.citations.map((citation) => (
            <li key={citation.citationId} id={`briefing-citation-${citation.citationId}`} className="scroll-mt-24 py-4">
              <p className="text-sm font-semibold text-white">[{citation.citationId}] {citation.title}</p>
              <p className="mt-1 text-xs text-slate-500">{citation.sourceLabel} · {citation.sourceType}</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{citation.excerpt}</p>
              <Link href={citation.href} className="mt-2 inline-flex text-xs font-semibold text-cyan-200 hover:underline">Open source</Link>
            </li>
          ))}
        </ol>
      </details>

      <SaveAnalysisButton analysisType={analysisType} fingerprint={artifact.generationKey} generatedAt={artifact.generatedAt} />
    </div>
  );
}
