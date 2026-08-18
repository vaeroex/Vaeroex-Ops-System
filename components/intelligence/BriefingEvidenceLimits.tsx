import type { IntelligenceBriefingArtifact } from "@/lib/ai/intelligence-briefing/contracts";
import {
  intelligenceBriefingCustomerText,
  intelligenceBriefingPlainPeriodLabel
} from "@/lib/ai/intelligence-briefing/plain-language";
import {
  intelligenceBriefingEvidenceLimitsLabel,
  intelligenceBriefingPresentationLimitations
} from "@/lib/ai/intelligence-briefing/presentation";

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

function freshnessLabel(value: IntelligenceBriefingArtifact["evidenceCoverage"]["freshness"]) {
  if (value === "current") return "Current";
  if (value === "stale") return "Needs newer evidence";
  return "Unavailable";
}

export function BriefingEvidenceLimits({ artifact }: { artifact: IntelligenceBriefingArtifact }) {
  const limitations = intelligenceBriefingPresentationLimitations(artifact);
  return (
    <details className="group border-y border-white/10 py-4" data-briefing-evidence-limits>
      <summary className="min-h-11 cursor-pointer list-none rounded-sm py-2 text-sm font-semibold text-cyan-200 outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 [&::-webkit-details-marker]:hidden">
        <span>{intelligenceBriefingEvidenceLimitsLabel(artifact)}</span>
        <span aria-hidden="true" className="ml-2 inline-block text-slate-500 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="pt-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="font-semibold text-slate-300">Evidence period</dt><dd className="mt-1 text-slate-400">{intelligenceBriefingPlainPeriodLabel(artifact.period)}</dd></div>
          <div><dt className="font-semibold text-slate-300">Evidence cutoff</dt><dd className="mt-1 text-slate-400">{readableTimestamp(artifact.period.cutoff)}</dd></div>
          <div><dt className="font-semibold text-slate-300">Freshness</dt><dd className="mt-1 text-slate-400">{freshnessLabel(artifact.evidenceCoverage.freshness)}</dd></div>
          <div><dt className="font-semibold text-slate-300">Supporting records</dt><dd className="mt-1 text-slate-400">{artifact.evidenceCoverage.supportingRecordCount}</dd></div>
          <div><dt className="font-semibold text-slate-300">Independent sources</dt><dd className="mt-1 text-slate-400">{artifact.evidenceCoverage.independentSourceCount}</dd></div>
          <div><dt className="font-semibold text-slate-300">Coverage</dt><dd className="mt-1 text-slate-400">{intelligenceBriefingCustomerText(artifact.evidenceCoverage.coverageLabel)}</dd></div>
        </dl>
        {artifact.evidenceCoverage.includedDomains.length ? (
          <p className="mt-4 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-300">Included areas:</span> {artifact.evidenceCoverage.includedDomains.map(intelligenceBriefingCustomerText).join(", ")}</p>
        ) : null}
        {artifact.evidenceCoverage.missingOrWeakDomains.length ? (
          <p className="mt-2 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-300">Missing or weak coverage:</span> {artifact.evidenceCoverage.missingOrWeakDomains.map(intelligenceBriefingCustomerText).join(", ")}</p>
        ) : null}
        {limitations.length ? (
          <ul className="mt-4 space-y-2 border-l-2 border-amber-300/45 pl-4 text-sm leading-6 text-slate-400">
            {limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
