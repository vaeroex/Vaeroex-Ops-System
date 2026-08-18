import Link from "next/link";
import { ArrowLeft, CalendarRange, ShieldCheck } from "lucide-react";
import { SaveAnalysisButton } from "@/components/reports/SaveAnalysisButton";
import {
  briefingTypeLabel,
  INTELLIGENCE_BRIEFING_SECTION_LABELS,
  type IntelligenceBriefingArtifact,
  type IntelligenceBriefingClaim
} from "@/lib/ai/intelligence-briefing/contracts";
import {
  intelligenceBriefingCustomerCitation,
  intelligenceBriefingCustomerText,
  intelligenceBriefingExplicitDate,
  intelligenceBriefingPlainPeriodLabel
} from "@/lib/ai/intelligence-briefing/plain-language";

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
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

export function IntelligenceBriefingViewer({ artifact }: { artifact: IntelligenceBriefingArtifact }) {
  const sectionLabelById = new Map(artifact.sections.map((section) => [
    section.id,
    INTELLIGENCE_BRIEFING_SECTION_LABELS[section.id] || intelligenceBriefingCustomerText(section.label)
  ]));
  const supportedSections = artifact.analysis.sections.filter((section) => section.section_id !== "business_updates_context");
  const businessUpdates = artifact.contextReferences.length
    ? artifact.analysis.sections.find((section) => section.section_id === "business_updates_context") || null
    : null;
  const citations = artifact.citations.map(intelligenceBriefingCustomerCitation);
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
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-400">
          <span className="inline-flex items-center gap-1.5"><CalendarRange aria-hidden="true" className="h-4 w-4" /> {intelligenceBriefingPlainPeriodLabel(artifact.period)}</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck aria-hidden="true" className="h-4 w-4" /> {artifact.confidence} confidence</span>
          <span>Generated {readableTimestamp(artifact.generatedAt)}</span>
          <span>{artifact.evidenceCoverage.supportingRecordCount} eligible records</span>
          <span>{artifact.evidenceCoverage.independentSourceCount} independent sources</span>
        </div>
      </header>

      <section className="border-l-2 border-cyan-300/45 pl-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Summary</p>
        <p className="mt-3 text-lg font-semibold leading-8 text-white">
          {intelligenceBriefingCustomerText(artifact.analysis.executive_summary.text)}
          <CitationLinks claim={artifact.analysis.executive_summary} artifact={artifact} />
        </p>
      </section>

      <div className="space-y-6">
        {supportedSections.map((section) => (
          <section key={section.section_id} className="border-b border-white/10 pb-6">
            <h2 className="text-lg font-semibold text-white">{sectionLabelById.get(section.section_id) || "Business area"}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {intelligenceBriefingCustomerText(section.summary)}
              <CitationLinks claim={{ text: section.summary, support_refs: section.support_refs }} artifact={artifact} />
            </p>
            <ul className="mt-4 space-y-3">
              {section.claims.map((claim, index) => (
                <li key={`${section.section_id}-${index}`} className="flex gap-3 text-sm leading-6 text-slate-300">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                  <span>{intelligenceBriefingCustomerText(claim.text)}<CitationLinks claim={claim} artifact={artifact} /></span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {businessUpdates ? (
        <section className="border-b border-white/10 pb-6">
          <h2 className="text-lg font-semibold text-white">Business Updates</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {intelligenceBriefingCustomerText(businessUpdates.summary)}
            <CitationLinks claim={{ text: businessUpdates.summary, support_refs: businessUpdates.support_refs }} artifact={artifact} />
          </p>
          {businessUpdates.claims.length ? (
            <ul className="mt-4 space-y-3">
              {businessUpdates.claims.map((claim, index) => (
                <li key={index} className="text-sm leading-6 text-slate-300">
                  {intelligenceBriefingCustomerText(claim.text)}<CitationLinks claim={claim} artifact={artifact} />
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-4 text-xs font-semibold text-slate-500">
            Sources: {artifact.contextReferences.map((context) => intelligenceBriefingCustomerText(context.title)).join(", ")}
          </p>
        </section>
      ) : null}

      {artifact.analysis.leadership_considerations.length ? (
        <section className="border-b border-white/10 pb-6">
          <h2 className="text-lg font-semibold text-white">Leadership Actions</h2>
          <ul className="mt-3 space-y-3">
            {artifact.analysis.leadership_considerations.map((claim, index) => (
              <li key={index} className="text-sm leading-6 text-slate-300">{intelligenceBriefingCustomerText(claim.text)}<CitationLinks claim={claim} artifact={artifact} /></li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border-y border-white/10 py-5">
        <h2 className="text-lg font-semibold text-white">Evidence Limits</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="font-semibold text-slate-300">Evidence period</dt><dd className="mt-1 text-slate-400">{intelligenceBriefingPlainPeriodLabel(artifact.period)}</dd></div>
          <div><dt className="font-semibold text-slate-300">Evidence cutoff</dt><dd className="mt-1 text-slate-400">{readableTimestamp(artifact.period.cutoff)}</dd></div>
          <div><dt className="font-semibold text-slate-300">Freshness</dt><dd className="mt-1 text-slate-400">{artifact.evidenceCoverage.freshness === "current" ? "Current" : artifact.evidenceCoverage.freshness === "stale" ? "Needs newer evidence" : "Unavailable"}</dd></div>
          <div><dt className="font-semibold text-slate-300">Coverage</dt><dd className="mt-1 text-slate-400">{intelligenceBriefingCustomerText(artifact.evidenceCoverage.coverageLabel)}</dd></div>
          <div><dt className="font-semibold text-slate-300">Supporting records</dt><dd className="mt-1 text-slate-400">{artifact.evidenceCoverage.supportingRecordCount}</dd></div>
          <div><dt className="font-semibold text-slate-300">Independent sources</dt><dd className="mt-1 text-slate-400">{artifact.evidenceCoverage.independentSourceCount}</dd></div>
        </dl>
        {artifact.evidenceCoverage.includedDomains.length ? (
          <p className="mt-4 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-300">Included areas:</span> {artifact.evidenceCoverage.includedDomains.map(intelligenceBriefingCustomerText).join(", ")}</p>
        ) : null}
        {artifact.evidenceCoverage.missingOrWeakDomains.length ? (
          <p className="mt-2 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-300">Missing or weak coverage:</span> {artifact.evidenceCoverage.missingOrWeakDomains.map(intelligenceBriefingCustomerText).join(", ")}</p>
        ) : null}
        {artifact.contextReferences.length ? (
          <p className="mt-3 text-sm leading-6 text-slate-400">Business Updates provide context. They are not independently measured evidence.</p>
        ) : null}
        {artifact.limitations.length ? (
          <ul className="mt-4 space-y-2 border-l-2 border-amber-300/45 pl-4 text-sm leading-6 text-slate-400">
            {artifact.limitations.map((limitation) => <li key={limitation.ref}>{intelligenceBriefingCustomerText(limitation.text)}</li>)}
          </ul>
        ) : null}
      </section>

      <details className="border-y border-white/10 py-4">
        <summary className="min-h-10 cursor-pointer text-sm font-semibold text-cyan-200">Supporting evidence ({citations.length})</summary>
        <ol className="mt-3 divide-y divide-white/10">
          {citations.map((citation) => (
            <li key={citation.citationId} id={`briefing-citation-${citation.citationId}`} className="scroll-mt-24 py-4">
              <p className="text-sm font-semibold text-white">[{citation.citationId}] {citation.title}</p>
              <p className="mt-1 text-xs text-slate-500">{citation.sourceLabel} · {citation.sourceType}</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{citation.excerpt}</p>
              {citation.recordedAt ? <p className="mt-1 text-xs text-slate-500">Recorded {intelligenceBriefingExplicitDate(citation.recordedAt)}</p> : null}
              <Link href={citation.href} className="mt-2 inline-flex text-xs font-semibold text-cyan-200 hover:underline">Open source</Link>
            </li>
          ))}
        </ol>
      </details>

      <SaveAnalysisButton analysisType={analysisType} fingerprint={artifact.generationKey} generatedAt={artifact.generatedAt} />
    </div>
  );
}
