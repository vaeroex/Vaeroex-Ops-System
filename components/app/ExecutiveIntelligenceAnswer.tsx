import type { ExecutiveEvidenceReference, ExecutiveIntelligenceBriefing } from "@/lib/search/types";

function EvidenceReferences({ references }: { references: ExecutiveEvidenceReference[] }) {
  if (!references.length) return null;

  return (
    <ul className="mt-3 space-y-2 border-l border-white/10 pl-3">
      {references.map((reference) => (
        <li key={`${reference.citationId}-${reference.title}`} className="text-xs leading-5 text-slate-300">
          <span className="font-semibold text-slate-100">{reference.sourceType} · {reference.title}</span>
          <span className="block text-slate-400">{reference.support}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionHeading({ children }: { children: string }) {
  return <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">{children}</h3>;
}

function LimitedExecutiveIntelligenceAnswer({ briefing }: { briefing: ExecutiveIntelligenceBriefing }) {
  const limited = briefing.limitedEvidence;
  const visibleEvidenceGroups = briefing.supportingEvidence.filter((group) => group.items.length);

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <SectionHeading>Executive Answer</SectionHeading>
          <span className="rounded-full border border-white/10 bg-slate-950/45 px-2.5 py-1 text-[0.7rem] font-semibold text-slate-200">
            {briefing.evidenceSufficiency.state} evidence
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-white">{briefing.executiveSummary}</p>
      </section>

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
                <EvidenceReferences references={finding.evidence} />
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
                <EvidenceReferences references={item.evidence} />
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
                <EvidenceReferences references={item.evidence} />
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
              <p className="mt-1 text-sm leading-6 text-slate-300"><span className="font-semibold text-slate-100">Why now:</span> {action.urgency}</p>
              <p className="mt-1 text-sm leading-6 text-slate-300"><span className="font-semibold text-slate-100">Expected impact:</span> {action.expectedBusinessImpact}</p>
              <p className="mt-1 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-200">This would change if:</span> {action.wouldChangeIf}</p>
              <EvidenceReferences references={action.evidence} />
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

      {visibleEvidenceGroups.length ? (
        <details className="border-t border-white/10 pt-5">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Supporting Evidence</summary>
          <div className="mt-3 space-y-4">
            {visibleEvidenceGroups.map((group) => (
              <div key={group.category}>
                <p className="text-sm font-semibold text-white">{group.category}</p>
                <EvidenceReferences references={group.items} />
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Leadership Brief</SectionHeading>
        <p className="mt-3 text-sm leading-6 text-slate-200">{briefing.leadershipBrief.firstLeadershipMeeting}</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-200">
          {briefing.leadershipBrief.priorities.map((priority) => <li key={priority}>{priority}</li>)}
        </ol>
        <p className="mt-3 text-sm leading-6 text-slate-300">{briefing.leadershipBrief.biggestDecision}</p>
        <p className="mt-1 text-sm leading-6 text-slate-400">{briefing.leadershipBrief.biggestUnknown}</p>
      </section>
    </div>
  );
}

export function ExecutiveIntelligenceAnswer({ briefing }: { briefing: ExecutiveIntelligenceBriefing }) {
  if (briefing.variant === "limited") {
    return <LimitedExecutiveIntelligenceAnswer briefing={briefing} />;
  }

  const visibleEvidenceGroups = briefing.supportingEvidence.filter((group) => group.items.length);

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <SectionHeading>Executive Summary</SectionHeading>
          <span className="rounded-full border border-white/10 bg-slate-950/45 px-2.5 py-1 text-[0.7rem] font-semibold text-slate-200">
            {briefing.evidenceSufficiency.state} evidence
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-white">{briefing.executiveSummary}</p>
      </section>

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Key Findings</SectionHeading>
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
              <EvidenceReferences references={finding.evidence} />
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
              <EvidenceReferences references={cause.evidence} />
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
              <p className="mt-1 text-sm leading-6 text-slate-300"><span className="font-semibold text-slate-100">Why now:</span> {action.urgency}</p>
              <p className="mt-1 text-sm leading-6 text-slate-300"><span className="font-semibold text-slate-100">Expected impact:</span> {action.expectedBusinessImpact}</p>
              <p className="mt-1 text-sm leading-6 text-slate-300"><span className="font-semibold text-slate-100">Expected outcome:</span> {action.expectedOutcome}</p>
              <p className="mt-1 text-sm leading-6 text-slate-400">{action.whyPrioritized}</p>
              <p className="mt-1 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-200">This would change if:</span> {action.wouldChangeIf}</p>
              <EvidenceReferences references={action.evidence} />
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Supporting Evidence</SectionHeading>
        {visibleEvidenceGroups.length ? (
          <div className="mt-3 space-y-4">
            {visibleEvidenceGroups.map((group) => (
              <div key={group.category}>
                <p className="text-sm font-semibold text-white">{group.category}</p>
                <EvidenceReferences references={group.items} />
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm leading-6 text-slate-400">No additional supporting evidence was used.</p>
        )}
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

      <section className="border-t border-white/10 pt-5">
        <SectionHeading>Leadership Brief</SectionHeading>
        <p className="mt-3 text-sm font-semibold leading-6 text-white">If I were leading this organization tomorrow morning, my priorities would be:</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-200">
          {briefing.leadershipBrief.priorities.map((priority) => <li key={priority}>{priority}</li>)}
        </ol>
        <div className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
          <p>{briefing.leadershipBrief.firstLeadershipMeeting}</p>
          <p>{briefing.leadershipBrief.biggestDecision}</p>
          <p>{briefing.leadershipBrief.biggestOpportunity}</p>
          <p>{briefing.leadershipBrief.biggestUnknown}</p>
        </div>
      </section>
    </div>
  );
}
