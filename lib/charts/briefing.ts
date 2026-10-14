import type { IntelligenceBriefingArtifact } from "@/lib/ai/intelligence-briefing/contracts";
import { parseComparisons } from "./comparison";
export function briefingComparisons(artifact: IntelligenceBriefingArtifact) {
  const cited = new Set([artifact.analysis.executive_summary, ...artifact.analysis.sections.flatMap(s => s.claims)].flatMap(claim => claim.support_refs));
  return parseComparisons(artifact.signals.filter(signal => cited.has(signal.ref)).flatMap(signal => {
    const line = signal.temporalLineage;
    if (signal.kind !== "kpi" || signal.authority !== "measured_evidence" && signal.authority !== "deterministic_result" || signal.comparisonUnit === undefined || !line || !line.fullyInsideBriefingPeriod || line.observationCount < 2 || line.startValue === line.endValue || line.startDate >= line.endDate || line.startDate < artifact.period.start || line.endDate > artifact.period.end || signal.semanticState?.metricRole !== "actual") return [];
    return [{ version: 1, id: signal.ref, title: signal.label, unit: signal.comparisonUnit,
      before: { label: "First recorded", value: line.startValue, context: line.startDate }, after: { label: "Latest recorded", value: line.endValue, context: line.endDate },
      kind: "observation", direction: ["maximize", "minimize"].includes(signal.semanticState.desiredDirection) ? signal.semanticState.desiredDirection : "neutral",
      context: `${line.startDate} → ${line.endDate} · ${line.observationCount} observations within ${artifact.period.start}–${artifact.period.end}`,
      limitations: ["Recorded observations within this briefing period; not totals for two reporting periods.", ...(signal.limitation ? [signal.limitation] : [])],
      sources: artifact.citations.filter(c => signal.citationIds.includes(c.citationId)).map(c => ({ label: `[${c.citationId}] ${c.title}`, href: c.href })) }];
  })).slice(0, 3);
}
