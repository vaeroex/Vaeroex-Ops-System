import "server-only";
import { z } from "zod";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { EVIDENCE_CANDIDATE_VERSION, type EvidenceCandidate } from "@/lib/ai/evidence-engine/contracts";
import { buildSourceRegistry } from "@/lib/ai/evidence-engine/source-registry";
import { buildEvidenceManifest } from "@/lib/ai/evidence-engine/manifest";
import { buildIntelligenceSnapshotFromProducersV1 } from "@/lib/intelligence/snapshot/v1/composition";
import { projectIntelligenceBriefingV1 } from "@/lib/intelligence/snapshot/v1/briefing-projection";
import { intelligenceBriefingExplicitDate } from "./plain-language";
import { intelligenceBriefingPeriod } from "./period";
import type { IntelligenceBriefingPackage, IntelligenceBriefingSignal } from "./contracts";
import { QboJournalPeriodSchema, type QboJournalPeriod } from "@/lib/integrations/qbo-customer/journal-accounting";
import { addCanonicalDecimals, negateCanonicalDecimal } from "@/lib/integrations/deterministic/decimal";

export const OWNER_FINANCIAL_BRIEFING_VERSION = "owner_financial_journal_briefing_v1";
const fields = [
  ["recognizedRevenue", "admitted revenue"], ["costOfGoodsSold", "admitted food and other goods costs"],
  ["labor", "admitted labor costs"], ["otherOperatingCosts", "admitted other operating costs"],
  ["operatingProfit", "admitted operating profit"]
] as const;

/** A separate owner-only projection of native, versioned journal receipts.
 * No shared KPI writes, report-summary promotion, or overall Health eligibility change.
 * Callers must re-read every receipt under the current owner's session before use. */
export function buildOwnerFinancialBriefingPackage(input: {
  workspaceId: string; periods: readonly QboJournalPeriod[]; asOf: string;
}): IntelligenceBriefingPackage {
  const asOf = new Date(input.asOf).toISOString();
  const periods = z.array(QboJournalPeriodSchema).min(1).max(2).parse(input.periods)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const latest = periods.at(-1)!;
  if (periods.some(p => p.workspaceId !== input.workspaceId || p.connectionId !== latest.connectionId
    || p.entityId !== latest.entityId || p.currency !== latest.currency || p.basis !== latest.basis
    || p.periodStart > p.periodEnd || p.periodEnd > asOf.slice(0, 10))
    || (periods.length === 2 && periods[0].periodEnd >= periods[1].periodStart)) throw Error("Incompatible journal periods.");
  const period = intelligenceBriefingPeriod("monthly", new Date(asOf));
  const candidates: EvidenceCandidate[] = periods.map((p, index) => ({
    version: EVIDENCE_CANDIDATE_VERSION, candidateId: "journal-receipt-" + p.receiptHash.slice(7),
    workspaceId: input.workspaceId, domain: "Financials", recordType: "admitted_journal_period",
    title: `Admitted journals ${p.periodStart}–${p.periodEnd}`,
    excerpt: `${p.currency}, ${p.basis}. ${p.coverage.journalCount} admitted journals. ${p.coverage.limitation}`,
    summary: null, evidenceRole: "derived",
    source: { sourceType: "qbo_journal_period_v2", sourceId: p.authorityId, sourceFileId: null,
      parentSourceId: p.connectionId, canonicalSourceKey: p.receiptHash,
      independentSourceKey: `quickbooks:${p.entityId}` },
    provenance: { recordId: p.authorityId, indexedAt: asOf, recordedAt: p.periodEnd + "T00:00:00.000Z",
      lineageVersion: p.contractVersion },
    eligibility: { eligible: true, lifecycleState: "active", originalEvidenceEligible: false,
      decisionVersion: OWNER_FINANCIAL_BRIEFING_VERSION },
    quality: "Validated canonical journal subtotal; whole-ledger completeness unknown", confidenceScore: 45,
    retrieval: { mode: "structured", baseRank: index + 1, score: null, embeddingVersion: null }
  }));
  const manifest = buildEvidenceManifest({ workspaceId: input.workspaceId,
    queryText: "Summarize admitted journal subtotals for the owner without asserting full ledger coverage.",
    candidates, sourceRegistry: buildSourceRegistry({ workspaceId: input.workspaceId, candidates }),
    generatedAt: asOf, candidateRetrieverVersion: OWNER_FINANCIAL_BRIEFING_VERSION,
    embeddingVersion: null, rerankerVersion: "deterministic_noop_reranker_v1",
    signalPlannerVersion: OWNER_FINANCIAL_BRIEFING_VERSION });
  const hrefs = new Map(candidates.map((candidate, i) => [candidate.candidateId,
    `/app/intelligence/briefings/financial?connectionId=${periods[i].connectionId}&from=${periods[i].periodStart}&to=${periods[i].periodEnd}#journal-evidence` as `/app/${string}`]));
  const snapshot = buildIntelligenceSnapshotFromProducersV1({ workspaceId: input.workspaceId,
    asOf: asOf, kpis: [], evidenceManifests: [manifest] });
  const base = projectIntelligenceBriefingV1({ snapshot: snapshot.snapshot, briefingType: "monthly", period,
    manifest, citationIdsByMetric: new Map(), citationIdsByFinding: new Map(), hrefByCandidateId: hrefs,
    sourceLabelByCandidateId: new Map(candidates.map(c => [c.candidateId, c.title])) });
  const signals: IntelligenceBriefingSignal[] = periods.flatMap((p, index) => fields.map(([field, label]) => {
    const ref = `J${index + 1}-${field}`;
    const historical = p.periodStart < period.start || p.periodEnd > period.end;
    const fact = `${historical ? `Historical context through ${intelligenceBriefingExplicitDate(p.periodEnd)}. ` : ""}For the admitted journal subset dated ${intelligenceBriefingExplicitDate(p.periodStart)}–${intelligenceBriefingExplicitDate(p.periodEnd)}, ${label} was ${p.currency} ${p[field]}.`;
    const citationId = manifest.evidence.find(e => e.candidateId === candidates[index].candidateId)!.citationId;
    return { ref, stableKey: evidenceEngineHash({ version: OWNER_FINANCIAL_BRIEFING_VERSION, receipt: p.receiptHash, field, fact }),
      kind: "kpi", authority: "deterministic_result", sectionId: "financial_performance", label, fact,
      confidence: "Low", citationIds: [citationId], evidenceReferenceIds: p.factVersionIds.map(id => `canonical-fact:${id}`),
      limitation: p.coverage.limitation, periodRelation: "current_state",
      periodContext: p.periodStart >= period.start && p.periodEnd <= period.end ? "briefing_period" : "historical_context" };
  }));
  const comparable = periods.length === 2 && Date.parse(periods[0].periodEnd) - Date.parse(periods[0].periodStart)
    === Date.parse(latest.periodEnd) - Date.parse(latest.periodStart);
  if (comparable) for (const [field, label] of fields) {
    const previous = periods[0], before = Number(previous[field]), after = Number(latest[field]);
    if (!Number.isFinite(before) || !Number.isFinite(after) || Math.abs(before) > Number.MAX_SAFE_INTEGER || Math.abs(after) > Number.MAX_SAFE_INTEGER) continue;
    const change = addCanonicalDecimals([latest[field], negateCanonicalDecimal(previous[field])]);
    const fact = `Historical context through ${intelligenceBriefingExplicitDate(latest.periodEnd)}: ${label} changed from ${latest.currency} ${previous[field]} to ${latest.currency} ${latest[field]}. The change was ${latest.currency} ${change}. Both values are admitted journal subtotals for equal-length periods; completeness remains unknown.`;
    signals.push({ ref: `JC-${field}`, stableKey: evidenceEngineHash({ receipts: periods.map(p => p.receiptHash), field, fact }),
      kind: "kpi", authority: "deterministic_result", sectionId: "financial_performance", label, fact,
      confidence: "Low", citationIds: manifest.evidence.map(e => e.citationId),
      evidenceReferenceIds: [...new Set(periods.flatMap(p => p.factVersionIds))].map(id => `canonical-fact:${id}`),
      limitation: "Comparison is between admitted journal subtotals, not verified whole-ledger totals or a causal trend.",
      periodRelation: "new_or_changed", periodContext: "historical_context", comparisonUnit: latest.currency,
      temporalLineage: { startDate: previous.periodEnd, endDate: latest.periodEnd, startValue: before, endValue: after,
        observationCount: 2, fullyInsideBriefingPeriod: previous.periodStart >= period.start,
        cadence: "recorded_dates" } });
  }
  const limitations = [
    { ref: "L-OWNER", text: "This financial briefing is private to the generating workspace owner. It is not shared workspace evidence." },
    { ref: "L-SCOPE", text: "Values are admitted journal subtotals, not established complete-period ledger totals. Missing journals or classifications may change the results. No live provider fetch was performed by this briefing." },
    { ref: "L-HEALTH", text: "One accounting source does not establish overall Business Health. No Health score, staffing coverage, cash position, causal explanation, or inventory cost-flow conclusion is supplied." },
    { ref: "L-PERIOD", text: "Use each signal's explicit journal dates. Historical periods are context and are not the rolling briefing period." }
  ];
  if (periods.length === 1) limitations.push({ ref: "L-COMPARISON", text: "The prior equal-length journal period is unavailable. No prior-period comparison is established." });
  const sections = [{ id: "financial_performance" as const, label: "Financial Performance", signalRefs: signals.map(s => s.ref) }];
  const evidenceFingerprint = evidenceEngineHash({ version: OWNER_FINANCIAL_BRIEFING_VERSION, receipts: periods.map(p => p.receiptHash) });
  const materialStateFingerprint = evidenceEngineHash({ evidenceFingerprint, signals, limitations, period, manifestId: manifest.manifestId });
  return { ...base, eligibility: "limited", confidence: "Low", signals, sections, limitations,
    evidenceCoverage: { supportingRecordCount: periods.reduce((n,p) => n + p.coverage.journalCount, 0),
      independentSourceCount: 1, freshness: latest.periodEnd >= period.start ? "current" : "stale",
      latestEvidenceAt: latest.periodEnd + "T00:00:00.000Z", overallCoverage: null,
      coverageLabel: "Admitted journal subset; full ledger coverage unknown", includedDomains: ["Financials"],
      missingOrWeakDomains: ["Full ledger coverage", "Workforce", "Inventory cost flow", "Cash", "Business Health"] },
    requiredSignalRefs: [signals.find(s => s.ref === "JC-operatingProfit")?.ref || `J${periods.length}-operatingProfit`],
    evidenceFingerprint, effectiveEvidenceFingerprint: evidenceFingerprint, materialStateFingerprint,
    generationKey: evidenceEngineHash({ version: OWNER_FINANCIAL_BRIEFING_VERSION, actorScope: "private_owner", materialStateFingerprint,
      prompt: base.promptVersion, validator: base.validatorVersion }),
    trustBinding: { ...base.trustBinding, projectionFingerprint: evidenceEngineHash({ signals, sections, limitations, evidenceFingerprint }) } };
}
