import { z } from "zod";
import type { EvidenceManifest } from "@/lib/ai/evidence-engine/contracts";
import { CanonicalDecimalSchema, CurrencyCodeSchema, IsoTimestampSchema, Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import { snapshotHash } from "@/lib/intelligence/snapshot/v1/canonical";
import type { KpiProducerMetricV1, KpiProducerOutputV1 } from "@/lib/intelligence/snapshot/v1/types";
import { INTELLIGENCE_SNAPSHOT_LIMITS } from "@/lib/intelligence/snapshot/v1/versions";
import { kpiMeasurementAgeDays, kpiMeasurementFreshness } from "@/lib/kpis/freshness";

export const QBO_ACCOUNTING_INTELLIGENCE_CONNECTION_LIMIT = 5;
const count = z.string().max(19).regex(/^(0|[1-9][0-9]*)$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const monthSchema = z.object({
  stateId: UuidSchema, periodStart: date, periodEnd: date, currency: CurrencyCodeSchema,
  valueCanonical: z.string().max(96).pipe(CanonicalDecimalSchema), supportingContributionCount: count,
  stateFingerprint: Sha256FingerprintSchema,
  provenance: z.array(z.object({ factVersionId: UuidSchema, sourceVersionId: UuidSchema,
    sourceRecordId: UuidSchema, factFingerprint: Sha256FingerprintSchema }).strict()).max(32)
}).strict();
const summarySchema = z.object({
  contractVersion: z.literal("qbo_customer_accounting_summary_v1"), workspaceId: UuidSchema,
  businessEntityId: UuidSchema, businessEntityName: z.string().trim().min(1).max(200), connectionId: UuidSchema,
  authorityId: UuidSchema.nullable(), authorityEnabled: z.boolean(), coverage: z.literal("partial"),
  fullPostedRevenue: z.literal(false), calculationState: z.enum(["disabled", "pending", "current"]),
  counts: z.object({ mapped: count, reviewRequired: count, nonContributing: count, withdrawn: count }).strict(),
  months: z.array(monthSchema).max(24), calculatedAt: IsoTimestampSchema.nullable(), watermark: Sha256FingerprintSchema.nullable()
}).strict();
export type QboAccountingSummary = z.infer<typeof summarySchema>;

function invalid(): never { throw new Error("qbo_accounting_summary_invalid"); }

export function parseQboAccountingSummary(value: unknown, workspaceId: string, connectionId: string): QboAccountingSummary {
  const result = summarySchema.safeParse(value);
  if (!result.success) invalid();
  const summary = result.data;
  if (summary.workspaceId !== workspaceId || summary.connectionId !== connectionId) invalid();
  const current = summary.calculationState === "current";
  if (summary.authorityEnabled !== (summary.calculationState !== "disabled")
    || (summary.authorityEnabled && !summary.authorityId)
    || (current ? !summary.calculatedAt || !summary.watermark : summary.calculatedAt !== null || summary.watermark !== null || summary.months.length > 0)) invalid();
  const states = new Set<string>(), periods = new Set<string>(), facts = new Set<string>();
  for (const month of summary.months) {
    const end = new Date(`${month.periodStart}T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    const period = `${month.currency}:${month.periodStart}`;
    if (!month.periodStart.endsWith("-01") || end.toISOString().slice(0, 10) !== month.periodEnd
      || month.periodStart > new Date(summary.calculatedAt!).toISOString().slice(0, 10) || states.has(month.stateId) || periods.has(period)
      || BigInt(month.supportingContributionCount) < BigInt(month.provenance.length)
      || (month.supportingContributionCount === "0" && month.valueCanonical !== "0")
      || (month.supportingContributionCount !== "0" && !month.provenance.length)) invalid();
    states.add(month.stateId); periods.add(period);
    for (const ref of month.provenance) {
      if (facts.has(ref.factVersionId)) invalid();
      facts.add(ref.factVersionId);
    }
  }
  return { ...summary, months: summary.months.map((month) => ({ ...month,
    provenance: [...month.provenance].sort((a, b) => a.factVersionId.localeCompare(b.factVersionId))
  })).sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.currency.localeCompare(b.currency)) };
}

function decimalParts(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(value);
  if (!match) invalid();
  return { coefficient: BigInt(`${match[1]}${match[2]}${match[3] ?? ""}`),
    scale: (match[3]?.length ?? 0) - Number(match[4] ?? 0) };
}

// Numbers are read-only presentation values, never financial arithmetic inputs.
// Require decimal round-trip equality, not binary-rational equality: normal
// cents such as 100.01 must survive, while significant decimal digit loss must not.
export function exactQboAccountingNumber(value: string): number | null {
  if (!z.string().max(96).pipe(CanonicalDecimalSchema).safeParse(value).success) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > Number.MAX_SAFE_INTEGER) return null;
  const original = decimalParts(value), roundTrip = decimalParts(numeric.toString());
  const scale = Math.max(original.scale, roundTrip.scale);
  return original.coefficient * BigInt(10) ** BigInt(scale - original.scale)
    === roundTrip.coefficient * BigInt(10) ** BigInt(scale - roundTrip.scale) ? numeric : null;
}

export type QboAccountingIntelligence = {
  summaries: QboAccountingSummary[];
  kpis: KpiProducerOutputV1;
  evidenceManifests: EvidenceManifest[];
  withheldMetricIds: string[];
};

export function buildQboAccountingIntelligence(input: {
  workspaceId: string; summaries: readonly QboAccountingSummary[]; asOf: string;
}): QboAccountingIntelligence {
  UuidSchema.parse(input.workspaceId); IsoTimestampSchema.parse(input.asOf);
  if (input.summaries.length > QBO_ACCOUNTING_INTELLIGENCE_CONNECTION_LIMIT) invalid();
  const summaries = input.summaries.map((summary) => parseQboAccountingSummary(summary, input.workspaceId, summary.connectionId))
    .sort((a, b) => a.connectionId.localeCompare(b.connectionId));
  if (new Set(summaries.map((summary) => summary.connectionId)).size !== summaries.length) invalid();
  const kpis: KpiProducerMetricV1[] = [], evidenceManifests: EvidenceManifest[] = [], withheldMetricIds: string[] = [];
  const scopes = new Set<string>();
  for (const summary of summaries) {
    if (!summary.authorityEnabled || summary.calculationState !== "current") continue;
    const calculatedAt = summary.calculatedAt!;
    if (Date.parse(calculatedAt) > Date.parse(input.asOf)) invalid();
    const calculationDate = new Date(calculatedAt).toISOString().slice(0, 10);
    for (const currency of [...new Set(summary.months.map((month) => month.currency))].sort()) {
      const scope = `${summary.businessEntityId}:${currency}`;
      // Two connections must not publish the same entity's aggregate twice.
      if (scopes.has(scope)) invalid();
      scopes.add(scope);
      const metricId = `qbo_admitted_posted_revenue:${summary.businessEntityId}:${summary.connectionId}:${currency}`;
      const months = summary.months.filter((month) => month.currency === currency)
        .sort((a, b) => a.periodStart.localeCompare(b.periodStart)).slice(-INTELLIGENCE_SNAPSHOT_LIMITS.observationsPerKpi);
      // Period cutoff, capped by calculation time. An old period is not made
      // fresh by recalculation; an open month is not dated at a future month-end.
      const points = months.map((month) => ({ observationId: month.stateId,
        observedAt: month.periodEnd < calculationDate ? month.periodEnd : calculationDate,
        value: exactQboAccountingNumber(month.valueCanonical) }));
      if (points.some((point) => point.value === null)) { withheldMetricIds.push(metricId); continue; }
      const observations = points.map((point) => ({ ...point, value: point.value! }));
      const label = `${summary.businessEntityName.slice(0, 150)} (${currency}) - QBO admitted posted revenue subtotal (partial), as of ${calculationDate}`;
      const queryFingerprint = snapshotHash({ metricId, authorityId: summary.authorityId, watermark: summary.watermark, months });
      const manifestId = `qbo-accounting:${queryFingerprint.slice(7)}`;
      const baseManifest: EvidenceManifest = {
        version: "evidence_manifest_v1", manifestId, workspaceId: input.workspaceId, queryFingerprint, generatedAt: calculatedAt,
        evidence: [], sourceRegistry: { version: "source_registry_v1", workspaceId: input.workspaceId,
          entries: [], candidateToSourceOrdinal: {}, independentOriginalSourceCount: 0 },
        componentVersions: { candidateRetriever: "qbo_customer_accounting_summary_v1", embedding: null,
          reranker: "deterministic", sourceRegistry: "source_registry_v1", signalPlanner: "qbo_admitted_subtotal_v1",
          citationVerifier: "citation_verification_v1" },
        policy: { derivedOutputsExcludedFromOriginalEvidence: true, citationsApplicationGenerated: true, sourceIndependenceApplicationCalculated: true }
      };
      const refs = months.flatMap((month) => [
        { candidateId: month.stateId, sourceId: month.stateId, parentSourceId: null,
          fingerprint: month.stateFingerprint, type: "deterministic_aggregate_state" },
        // Six states plus up to three native fact references each fit the existing 24-reference KPI bound.
        ...month.provenance.slice(0, 3).map((ref) => ({ candidateId: ref.factVersionId, sourceId: ref.sourceVersionId,
          parentSourceId: ref.sourceRecordId, fingerprint: ref.factFingerprint, type: "canonical_business_fact_version" }))
      ]);
      const manifest: EvidenceManifest = { ...baseManifest,
        evidence: refs.map((ref, i) => ({ citationId: i + 1, candidateId: ref.candidateId,
        sourceOrdinal: `S${i + 1}`, domain: "qbo_admitted_posted_revenue", title: label,
        excerpt: `Derived admitted subtotal as of ${calculatedAt}; partial coverage, not total posted revenue or provider-sync freshness.`, summary: null,
        evidenceRole: "derived", originalEvidenceEligible: false, confidenceScore: 0,
        indexedAt: calculatedAt, recordedAt: calculatedAt, lineageVersion: ref.fingerprint,
        eligibilityDecisionVersion: "qbo_customer_accounting_summary_v1" })),
      sourceRegistry: { ...baseManifest.sourceRegistry,
        entries: refs.map((ref, i) => ({ sourceOrdinal: `S${i + 1}`,
          canonicalSourceKey: `${input.workspaceId}:${summary.businessEntityId}:${ref.type}:${ref.candidateId}`,
          independentSourceKey: null, sourceType: ref.type, title: label, evidenceRole: "derived",
          sourceId: ref.sourceId, sourceFileId: null, parentSourceId: ref.parentSourceId, candidateIds: [ref.candidateId] })),
        candidateToSourceOrdinal: Object.fromEntries(refs.map((ref, i) => [ref.candidateId, `S${i + 1}`])) } };
      const current = observations.at(-1)!, previous = observations.at(-2) ?? null, first = observations[0];
      kpis.push({ id: metricId, workspaceId: input.workspaceId,
        semantics: { canonicalName: metricId, displayName: label, originalSourceLabel: label, unit: currency, scale: 1,
          desiredDirection: "unknown", targetBehavior: "unknown", idealValue: null, idealRangeMin: null, idealRangeMax: null,
          metricRole: "actual", classificationSource: "deterministic", classificationConfidence: null, classificationConfirmed: false,
          rationale: "Partial QBO admitted accrual subtotal. Observation dates are period cutoffs capped by calculation time, not provider-sync freshness. No complete-revenue, payment-combination or business-health inference." },
        manualTarget: null, configuredSemanticTarget: { kind: "none" }, effectiveAuthoritativeTarget: { kind: "none" },
        evaluation: { rawMovement: "insufficient_data", latestPerformanceEffect: "indeterminate", selectedRangeTrend: "indeterminate",
          targetStatus: "direction_unknown", latestValue: current.value, previousValue: previous?.value ?? null,
          rangeStartValue: first.value, change: null, changePercent: null },
        recommendation: { value: null, range: null, confidence: "Unavailable", reason: "Partial coverage; no target recommendation.",
          dataUsed: "Native admitted contributions only.", limitation: "Not full posted revenue.", outliers: 0 },
        observations: { current, previous, rangeStart: first, selectedRange: { startAt: first.observedAt,
          endAt: current.observedAt, totalObservationCount: observations.length, boundedObservations: observations } },
        freshness: { status: kpiMeasurementFreshness(current.observedAt, new Date(input.asOf)),
          ageDays: kpiMeasurementAgeDays(current.observedAt, new Date(input.asOf)), latestMeasurementAt: current.observedAt },
        evidenceReferenceIds: refs.map((ref) => `manifest:${manifestId}:${ref.candidateId}`) });
      evidenceManifests.push(manifest);
    }
  }
  return { summaries, kpis, evidenceManifests, withheldMetricIds };
}
