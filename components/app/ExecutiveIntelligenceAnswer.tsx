import {
  ExecutiveEvidenceRenderer,
  ExecutiveEvidenceSummary
} from "@/components/app/ExecutiveEvidenceRenderer";
import { dedupeExecutiveEvidence, summarizeExecutiveEvidence, uniqueExecutiveLines } from "@/lib/presentation/executive-evidence";
import type { ExecutiveEvidenceReference, ExecutiveIntelligenceBriefing } from "@/lib/search/types";

function SectionHeading({ children }: { children: string }) {
  return <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">{children}</h3>;
}

function BusinessHealthDrivers({ briefing }: { briefing: ExecutiveIntelligenceBriefing }) {
  const score = briefing.executiveSummary.match(/business health(?: score)?(?: is|:)?\s*(\d{1,3})/i)?.[1];
  const drivers = uniqueExecutiveLines(briefing.keyFindings.map((finding) => finding.finding)).slice(0, 4);
  if (!score || !drivers.length) return null;

  return (
    <div className="mt-4 border-l-2 border-vaeroex-accent/40 pl-3">
      <p className="text-sm leading-6 text-slate-300">
        Business Health is {score}/100. The highest-ranked validated drivers in this assessment are:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-200">
        {drivers.map((driver) => <li key={driver}>{driver}</li>)}
      </ul>
    </div>
  );
}

function LeadershipBrief({ briefing }: { briefing: ExecutiveIntelligenceBriefing }) {
  const priorities = uniqueExecutiveLines(briefing.keyFindings.map((finding) => finding.finding)).slice(0, 3);
  const actions = uniqueExecutiveLines(briefing.recommendedActions.map((action) => action.action)).slice(0, 3);
  const limitations = uniqueExecutiveLines([
    ...briefing.missingInformation,
    ...briefing.confidenceAssessment.uncertainty,
    ...briefing.confidenceAssessment.conflicts
  ]).slice(0, 3);

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <SectionHeading>Leadership Brief</SectionHeading>
        <span className="rounded-full border border-white/10 bg-slate-950/45 px-2.5 py-1 text-[0.7rem] font-semibold text-slate-200">
          {briefing.evidenceSufficiency.state} evidence
        </span>
      </div>
      <p className="mt-3 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-slate-500">Executive Summary</p>
      <p className="mt-1 text-sm leading-6 text-white">{briefing.executiveSummary}</p>
      <BusinessHealthDrivers briefing={briefing} />
      {priorities.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-100">Top priorities</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-200">
            {priorities.map((priority) => <li key={priority}>{priority}</li>)}
          </ol>
        </div>
      ) : null}
      {actions.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-100">Recommended actions</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">
            {actions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        </div>
      ) : null}
      {limitations.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-100">Known limitations</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-400">
            {limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function RecommendationDetails({ action }: { action: ExecutiveIntelligenceBriefing["recommendedActions"][number] }) {
  const whyNow = uniqueExecutiveLines([action.whyPrioritized, action.urgency])[0];
  const expectedImpact = uniqueExecutiveLines([action.expectedBusinessImpact, action.expectedOutcome])[0];
  return (
    <div className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
      {whyNow ? <p className="text-sm leading-6 text-slate-300"><span className="font-semibold text-slate-100">Why now:</span> {whyNow}</p> : null}
      {expectedImpact ? <p className="text-sm leading-6 text-slate-300"><span className="font-semibold text-slate-100">Expected impact:</span> {expectedImpact}</p> : null}
      <p className="text-sm leading-6 text-slate-400 sm:col-span-2"><span className="font-semibold text-slate-200">What would change this recommendation:</span> {action.wouldChangeIf}</p>
    </div>
  );
}

function collectExecutiveEvidence(briefing: ExecutiveIntelligenceBriefing) {
  return dedupeExecutiveEvidence([
    ...briefing.keyFindings.flatMap((finding) => finding.evidence),
    ...briefing.rootCauseAnalysis.flatMap((cause) => cause.evidence),
    ...briefing.recommendedActions.flatMap((action) => action.evidence),
    ...briefing.supportingEvidence.flatMap((group) => group.items),
    ...(briefing.limitedEvidence?.provisionalInterpretations.flatMap((item) => item.evidence) || []),
    ...(briefing.limitedEvidence?.alternativeExplanations.flatMap((item) => item.evidence) || [])
  ]);
}

function SupportingEvidenceSection({ references }: { references: ExecutiveEvidenceReference[] }) {
  const summary = summarizeExecutiveEvidence(references);

  return (
    <section id="executive-supporting-evidence" className="border-t border-white/10 pt-5">
      <SectionHeading>Supporting Evidence</SectionHeading>
      {summary ? (
        <details className="mt-3 rounded-md border border-white/10 bg-slate-950/25 px-3 py-2.5">
          <summary className="cursor-pointer text-sm font-semibold text-vaeroex-accent">View Evidence</summary>
          <p className="mt-2 break-words text-xs leading-5 text-slate-400">
            {summary.text} Each citation is shown once, even when it supports multiple conclusions.
          </p>
          <ExecutiveEvidenceRenderer references={references} />
        </details>
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-400">No additional supporting evidence was used.</p>
      )}
    </section>
  );
}

function LimitedExecutiveIntelligenceAnswer({ briefing }: { briefing: ExecutiveIntelligenceBriefing }) {
  const limited = briefing.limitedEvidence;
  const allEvidence = collectExecutiveEvidence(briefing);

  return (
    <div className="space-y-6">
      <LeadershipBrief briefing={briefing} />

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Evidence Readiness</SectionHeading>
        <p className="mt-2 text-sm leading-6 text-slate-300">{limited?.evidenceReadinessSummary || briefing.evidenceSufficiency.explanation}</p>
      </section>

      {briefing.keyFindings.length ? (
        <section className="border-t border-white/10 pt-5">
          <SectionHeading>What Can Be Said</SectionHeading>
          <div className="mt-3 space-y-4">
            {briefing.keyFindings.map((finding) => (
              <div key={finding.finding}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-semibold leading-6 text-white">{finding.finding}</p>
                  <span className="shrink-0 text-xs font-semibold text-slate-300">{finding.confidence}</span>
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-300">{finding.businessImpact}</p>
                <ExecutiveEvidenceSummary references={finding.evidence} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {limited?.provisionalInterpretations.length ? (
        <section className="border-t border-white/10 pt-5">
          <SectionHeading>Provisional Interpretations</SectionHeading>
          <div className="mt-3 space-y-4">
            {limited.provisionalInterpretations.map((item) => (
              <div key={item.statement}>
                <p className="text-sm leading-6 text-slate-200">{item.statement}</p>
                <ExecutiveEvidenceSummary references={item.evidence} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {limited?.alternativeExplanations.length ? (
        <section className="border-t border-white/10 pt-5">
          <SectionHeading>Alternative Explanations</SectionHeading>
          <div className="mt-3 space-y-4">
            {limited.alternativeExplanations.map((item) => (
              <div key={item.statement}>
                <p className="text-sm leading-6 text-slate-300">{item.statement}</p>
                <ExecutiveEvidenceSummary references={item.evidence} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {limited?.conflictAssessment ? (
        <section className="border-t border-white/10 pt-5">
          <SectionHeading>Evidence Conflict</SectionHeading>
          <p className="mt-2 text-sm leading-6 text-slate-200">{limited.conflictAssessment.conflictSummary}</p>
          <dl className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2">
            <div><dt className="text-xs font-semibold text-slate-100">Fresher source</dt><dd className="mt-1 text-sm leading-6 text-slate-300">{limited.conflictAssessment.fresherSource}</dd></div>
            <div><dt className="text-xs font-semibold text-slate-100">More direct source</dt><dd className="mt-1 text-sm leading-6 text-slate-300">{limited.conflictAssessment.moreDirectSource}</dd></div>
          </dl>
          <p className="mt-3 text-sm leading-6 text-slate-400">{limited.conflictAssessment.derivedSourceLimitations}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-white">Resolve it: {limited.conflictAssessment.resolutionAction}</p>
        </section>
      ) : null}

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Why Leadership Should Care</SectionHeading>
        <p className="mt-2 border-l-2 border-amber-300/50 pl-3 text-sm leading-6 text-slate-200">
          {limited?.leadershipRisk || briefing.businessImpact.strategic}
        </p>
      </section>

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Safe Next Actions</SectionHeading>
        <ol className="mt-3 space-y-5">
          {briefing.recommendedActions.map((action, index) => (
            <li key={`${action.priority}-${action.action}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-vaeroex-accent/25 bg-cyan-950/35 px-2 py-1 text-[0.7rem] font-semibold text-vaeroex-accent">{action.priority}</span>
                <span className="text-xs font-semibold text-slate-300">{action.timeHorizon}</span>
                <span className="text-xs text-slate-500">Confidence: {action.confidence}</span>
              </div>
              <p className="mt-2 text-sm font-semibold leading-6 text-white">{index + 1}. {action.action}</p>
              <RecommendationDetails action={action} />
              <ExecutiveEvidenceSummary references={action.evidence} />
            </li>
          ))}
        </ol>
      </section>

      {limited?.decisionsToDefer.length ? (
        <section className="border-t border-white/10 pt-5">
          <SectionHeading>Decisions To Defer</SectionHeading>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">
            {limited.decisionsToDefer.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Recommendation Confidence</SectionHeading>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-slate-950/45 px-3 py-1 text-xs font-semibold text-white">{briefing.confidenceAssessment.level}</span>
          <span className="text-xs text-slate-400">{briefing.confidenceAssessment.supportingSourceCount} independent source{briefing.confidenceAssessment.supportingSourceCount === 1 ? "" : "s"}</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-300">{briefing.confidenceAssessment.explanation}</p>
        {briefing.confidenceAssessment.conflicts.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-amber-100">
            {briefing.confidenceAssessment.conflicts.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}
      </section>

      {briefing.missingInformation.length ? (
        <section className="border-t border-white/10 pt-5">
          <SectionHeading>Missing Information</SectionHeading>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">
            {briefing.missingInformation.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      <SupportingEvidenceSection references={allEvidence} />

    </div>
  );
}

export function ExecutiveIntelligenceAnswer({ briefing }: { briefing: ExecutiveIntelligenceBriefing }) {
  if (briefing.variant === "limited") {
    return <LimitedExecutiveIntelligenceAnswer briefing={briefing} />;
  }

  const allEvidence = collectExecutiveEvidence(briefing);

  return (
    <div className="space-y-6">
      <LeadershipBrief briefing={briefing} />

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Top Priorities</SectionHeading>
        <ol className="mt-3 space-y-4">
          {briefing.keyFindings.map((finding, index) => (
            <li key={`${index}-${finding.finding}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm font-semibold leading-6 text-white">{index + 1}. {finding.finding}</p>
                <span className="shrink-0 rounded-full border border-white/10 bg-slate-950/45 px-2.5 py-1 text-[0.7rem] font-semibold text-slate-200">
                  {finding.confidence}
                </span>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-300"><span className="font-semibold text-slate-100">Business impact:</span> {finding.businessImpact}</p>
              <ExecutiveEvidenceSummary references={finding.evidence} />
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Root Cause Analysis</SectionHeading>
        <div className="mt-3 space-y-4">
          {briefing.rootCauseAnalysis.map((cause) => (
            <div key={`${cause.finding}-${cause.status}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm font-semibold leading-6 text-white">{cause.finding}</p>
                <span className="shrink-0 text-xs font-semibold text-slate-300">{cause.status}</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-300">{cause.analysis}</p>
              <ExecutiveEvidenceSummary references={cause.evidence} />
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Business Impact</SectionHeading>
        <dl className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {[
            ["Financial", briefing.businessImpact.financial],
            ["Operational", briefing.businessImpact.operational],
            ["Customer", briefing.businessImpact.customer],
            ["Strategic", briefing.businessImpact.strategic]
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs font-semibold text-slate-100">{label}</dt>
              <dd className="mt-1 text-sm leading-6 text-slate-300">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-l-2 border-amber-300/50 pl-3 text-sm leading-6 text-slate-200">
          <span className="font-semibold text-white">If leadership ignores this:</span> {briefing.businessImpact.ifIgnored}
        </p>
      </section>

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Recommended Actions</SectionHeading>
        <ol className="mt-3 space-y-5">
          {briefing.recommendedActions.map((action, index) => (
            <li key={`${action.priority}-${action.action}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-vaeroex-accent/25 bg-cyan-950/35 px-2 py-1 text-[0.7rem] font-semibold text-vaeroex-accent">{action.priority}</span>
                <span className="text-xs font-semibold text-slate-300">{action.timeHorizon}</span>
                <span className="text-xs text-slate-500">Confidence: {action.confidence}</span>
              </div>
              <p className="mt-2 text-sm font-semibold leading-6 text-white">{index + 1}. {action.action}</p>
              <RecommendationDetails action={action} />
              <ExecutiveEvidenceSummary references={action.evidence} />
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Confidence Assessment</SectionHeading>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-slate-950/45 px-3 py-1 text-xs font-semibold text-white">{briefing.confidenceAssessment.level}</span>
          <span className="text-xs text-slate-400">{briefing.confidenceAssessment.supportingSourceCount} independent source{briefing.confidenceAssessment.supportingSourceCount === 1 ? "" : "s"} · {briefing.confidenceAssessment.evidenceAgreement}</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-300">{briefing.confidenceAssessment.explanation}</p>
        {briefing.confidenceAssessment.conflicts.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-amber-100">
            {briefing.confidenceAssessment.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}
          </ul>
        ) : null}
        {briefing.confidenceAssessment.uncertainty.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-400">
            {briefing.confidenceAssessment.uncertainty.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}
      </section>

      {briefing.missingInformation.length ? (
        <section className="border-t border-white/10 pt-5">
          <SectionHeading>Missing Information</SectionHeading>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">
            {briefing.missingInformation.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      <SupportingEvidenceSection references={allEvidence} />

    </div>
  );
}
