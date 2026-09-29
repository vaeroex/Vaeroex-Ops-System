// Synthetic retail operations only. Shared, immutable input for BOTH comparison builds.
import type { Database } from "../../lib/supabase/types";
export const AS_OF = "2026-09-29T08:00:00.000Z";
export const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export type FixtureState = "populated" | "empty" | "loading" | "error";
export type FixtureRole = "owner" | "viewer";
export function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(item => { if (item && typeof item === "object" && !Object.isFrozen(item)) freeze(item); }); } return value; }
export const workspace = freeze({ id: WORKSPACE_ID, name: "Harbor Supply · Synthetic", business_type: "Retail", industry: "Retail", created_at: AS_OF, updated_at: AS_OF, subscription_status: "active", subscription_required: true, manually_unlocked: false });
export const profile = freeze({ id: "00000000-0000-4000-8000-000000000002", email: "preview@example.invalid", full_name: "Jordan Preview", created_at: AS_OF });
const common = { workspace_id: WORKSPACE_ID, created_at: AS_OF, updated_at: AS_OF, archived_at: null, deleted_at: null, folder_id: null, created_by: profile.id };
const metricNames = ["Revenue", "Gross margin", "Order fulfillment", "Customer retention", "Inventory accuracy", "Operating expenses", "Repeat purchases", "Customer satisfaction"];
export const kpis = freeze(metricNames.flatMap((name, metric) => Array.from({ length: 8 }, (_, index) => ({
  ...common, id: `kpi-${metric}-${index}`, name, category: metric < 2 ? "Financial" : "Operations", target: metric === 0 ? 90000 : metric === 5 ? 28000 : 95,
  actual_value: metric === 0 ? 71000 + index * 1700 : metric === 5 ? 29000 - index * 400 : 80 + ((index * 2 + metric) % 18),
  metric_date: `2026-09-${String(29 - index * 3).padStart(2, "0")}`, owner: "Operations", notes: "Synthetic record for visual review only.", source: "manual", source_file_id: null, import_id: null, import_row_id: null, raw_data_json: {},
}))));

// Performance-only volume fixture. The original 64 KPI rows above deliberately
// remain unchanged for Sources and the other workspace screen comparisons.
// These are input observations/settings, not precomputed application statuses.
type PerformanceMetric = {
  name: string; category: "Financial" | "Operations"; unit: string; format: string;
  direction: "maximize" | "minimize" | "target_range" | "exact_target" | "maintain" | "unknown";
  target: number | null; values?: number[];
};
const performanceAreas = ["Flagship store", "North district", "South district", "East district", "West district", "Online store", "Wholesale accounts", "Special-order fulfillment and interbranch replenishment"];
const performanceMetrics: PerformanceMetric[] = [
  { name: "Net sales", category: "Financial", unit: "$", format: "currency", direction: "maximize", target: 90000 },
  { name: "Gross margin", category: "Financial", unit: "%", format: "percent", direction: "maximize", target: 38 },
  { name: "Operating expenses", category: "Financial", unit: "$", format: "currency", direction: "minimize", target: 28000 },
  { name: "Refund adjustments", category: "Financial", unit: "$", format: "currency", direction: "minimize", target: 0, values: [0, 400, 125, 0, 0, 90, 0, 175] },
  { name: "Average order value", category: "Financial", unit: "$", format: "currency", direction: "maximize", target: 75 },
  { name: "On-time dispatch", category: "Operations", unit: "%", format: "percent", direction: "maximize", target: 95 },
  { name: "Customer satisfaction", category: "Operations", unit: "%", format: "percent", direction: "maximize", target: 92 },
  { name: "Inventory accuracy", category: "Operations", unit: "%", format: "percent", direction: "maximize", target: 98 },
  { name: "Average picking time", category: "Operations", unit: "minutes", format: "decimal", direction: "minimize", target: 8 },
  { name: "Staff utilization", category: "Operations", unit: "%", format: "percent", direction: "target_range", target: null, values: [78, 92, 65, 84, 0, 80, 75, 88] },
  { name: "Cash reconciliation variance", category: "Financial", unit: "$", format: "currency", direction: "exact_target", target: 0, values: [0, 12, 4, 0, 0, 5, 0, 8] },
  { name: "Scheduled crew coverage", category: "Operations", unit: "people", format: "number", direction: "maintain", target: 12, values: [12, 16, 11, 12, 0, 13, 12, 10] },
  { name: "Service capacity index", category: "Operations", unit: "points", format: "decimal", direction: "unknown", target: null, values: [61, 58, 72, 65, 0, 63, 69, 55] },
  { name: "Returns processed", category: "Operations", unit: "returns", format: "number", direction: "maximize", target: null, values: [130, 90, 115, 125, 0, 100, 110, 135] },
];
const performanceColors = ["#10B981", "#38BDF8", "#F59E0B", "#EF4444", "#8B5CF6", "#F97316", "#14B8A6", "#D1D5DB"];
const performanceTargetBehaviors = { maximize: "minimum_goal", minimize: "maximum_limit", target_range: "acceptable_range", exact_target: "exact_threshold", maintain: "stability_goal", unknown: "unknown" };
const performanceSeries = performanceMetrics.flatMap((metric, metricIndex) => performanceAreas.map((area, areaIndex) => {
  const name = `${metric.name} — ${area}`;
  const target = areaIndex === 3 && [0, 1, 2, 4, 5, 6, 7, 8].includes(metricIndex) ? null : metric.target;
  const multipliers = metric.direction === "minimize" ? [0.82, 1.32, 1.08, 0.92, 0, 0.86, 1.24, 0.75] : [1.08, 0.82, 0.97, 1.03, 0, 1.05, 0.91, 1.11];
  const rawCurrent = metric.values?.[areaIndex] ?? (metric.target || 0) * multipliers[areaIndex];
  // A rate cannot exceed 100%; financial amounts and durations keep their units.
  const currentValue = metric.unit === "%" ? Math.min(100, rawCurrent) : rawCurrent;
  return { metric, metricIndex, area, areaIndex, name, target, currentValue };
}));
export const performanceKpiSettings = freeze(performanceSeries.map(({ metric, metricIndex, areaIndex, name, target }, index) => ({
  id: `performance-setting-${index}`, workspace_id: WORKSPACE_ID, kpi_name: name, category: metric.category,
  target, weight: 1, definition: `Synthetic weekly ${metric.name.toLowerCase()} for interface qualification only.`,
  color: performanceColors[areaIndex], color_source: "user", is_visible: true, sort_order: index,
  unit_type: metric.unit === "$" ? "currency" : metric.unit === "%" ? "percent" : metric.unit,
  display_unit: metric.unit, value_format: metric.format, x_axis_label: "Measurement date", y_axis_label: metric.name,
  preferred_chart_type: "line", canonical_name: `synthetic_${metricIndex}_${areaIndex}`, display_name: name, original_source_label: name,
  aliases: [], semantic_unit: metric.unit, semantic_scale: 1, aggregation_basis: "observed_value", period_basis: "weekly",
  desired_direction: metric.direction, target_behavior: performanceTargetBehaviors[metric.direction],
  ideal_value: metric.direction === "exact_target" ? 0 : metric.direction === "maintain" ? 12 : null,
  ideal_range_min: metric.direction === "target_range" ? 70 : null, ideal_range_max: metric.direction === "target_range" ? 85 : null,
  metric_role: "actual", classification_source: "user", classification_confidence: metric.direction === "unknown" ? null : 1,
  classification_version: "synthetic-preview-v1", classification_rationale: "Explicit synthetic setting; no classification service was called.",
  classification_confirmed: metric.direction !== "unknown", created_by: profile.id, created_at: AS_OF, updated_at: AS_OF,
} satisfies Database["public"]["Tables"]["kpi_settings"]["Row"])));
export const performanceKpis = freeze(performanceSeries.flatMap(({ metric, metricIndex, area, areaIndex, name, target, currentValue }) => Array.from({ length: 8 }, (_, observation) => {
  const latestDate = areaIndex === 6 ? "2026-07-15" : areaIndex === 7 ? "2026-04-20" : "2026-09-29";
  const metricDate = new Date(`${latestDate}T08:00:00.000Z`);
  metricDate.setUTCDate(metricDate.getUTCDate() - observation * 7);
  const imported = metricIndex % 4 === 0;
  const missing = areaIndex === 5 && observation === 0 || areaIndex === 6 && metricIndex >= 10;
  const historicalAdjustment = metric.direction === "minimize" ? 1 + observation * 0.025 : 1 - observation * 0.018;
  const historicalValue = observation === 0 ? currentValue : currentValue === 0 ? (metric.unit === "$" ? 15 : 2) * observation : currentValue * historicalAdjustment;
  const boundedValue = metric.unit === "%" ? Math.min(100, historicalValue) : historicalValue;
  const actualValue = missing ? null : metric.format === "number" ? Math.round(boundedValue) : Math.round(boundedValue * 100) / 100;
  return {
    ...common, id: `performance-${metricIndex}-${areaIndex}-${observation}`, name, category: metric.category, target,
    actual_value: actualValue, metric_date: metricDate.toISOString().slice(0, 10), owner: `${area} operations`,
    notes: areaIndex === 4 ? "Synthetic planned closure: zero activity is intentional, not missing data." : "Synthetic weekly observation for interface qualification only.",
    source: imported ? "file_import" : "manual", source_file_id: imported ? `source-${areaIndex + 1}` : null,
    import_id: null, import_row_id: null, raw_data_json: imported ? { synthetic: true, source_label: "Synthetic source-linked KPI; no import was executed." } : {},
  } satisfies Database["public"]["Tables"]["kpis"]["Row"];
})));
export const files = freeze(Array.from({ length: 32 }, (_, index) => ({
  ...common, id: `source-${index + 1}`, original_name: `${["Weekly operations", "Sales by category", "Inventory review", "Service feedback"][index % 4]} ${index + 1}.csv`,
  display_name: `${["Weekly operations", "Sales by category", "Inventory review", "Service feedback"][index % 4]} ${index + 1}`,
  file_extension: "csv", mime_type: "text/csv", file_size_bytes: 24560 + index * 211,
  storage_bucket: "synthetic-only", storage_path: "unavailable", import_type: "csv", import_status: index % 3 === 0 ? "ready_for_review" : "pending", imported_rows: 0,
  analysis_prompt: null, analysis_summary: index % 3 === 0 ? "Synthetic operations evidence is ready for review. No real extraction was performed." : null,
  processing_status: index % 3 === 0 ? "completed" : "pending", processing_error: null, processed_at: null, index_status: "pending", indexed_at: null, indexed_chunk_count: 0, index_error: null, metadata_json: {},
})));
export const analyses = freeze(Array.from({ length: 32 }, (_, index) => ({
  id: `analysis-${index}`, title: `${["Weekly leadership review", "Business health assessment", "Inventory findings", "Service performance review"][index % 4]} ${index + 1}`,
  analysisType: index % 2 ? "weekly_briefing" : "business_health", generatedAt: AS_OF, savedAt: AS_OF, confidence: index % 3 ? "High" : "Medium", evidenceStatus: "Synthetic evidence", dateRange: "September 2026", businessHealthState: null,
})));
export const cards = freeze(Array.from({ length: 32 }, (_, index) => {
  const type = index % 2 ? "Opportunity" : "Risk";
  const title = ["Order fulfillment needs attention", "Retention is above target", "Inventory variance increased", "Repeat purchases are improving"][index % 4];
  const snapshot = { version: "intelligence_card_lifecycle_v1", findingId: `fixture-${index}`, type, title: `${title}${index > 3 ? ` · ${index + 1}` : ""}`, summary: "Synthetic operating evidence suggests reviewing this area with the responsible team.", priority: index % 3 ? "Medium" : "High", confidence: index % 3 ? "High" : "Low", affectedArea: "Operations", lastUpdated: AS_OF };
  return { findingKeyHash: String(index).padStart(4, "0"), materialSignature: `fixture-${index}`, findingId: snapshot.findingId, snapshot,
    insight: { ...snapshot, id: snapshot.findingId, why: "Synthetic operating evidence", impact: "Review the effect on service and capacity.", recommendedAction: "Inspect the supporting evidence before deciding what to change.", evidence: ["Recorded performance: 87%", "Target: 95%"], evidenceCount: 2, supportingRecords: [{ id: `kpi-${index}`, title: "Order fulfillment", recordType: "KPI record", date: "2026-09-29", value: "Actual 87% · Target 95%", support: "Synthetic record", href: "/app/kpis?metric=Order%20fulfillment&section=detail", classification: "Original", sourceKey: "fixture" }], independentSourceCount: 1, contradictoryEvidence: [], missingEvidence: [], sourceTypes: ["KPIs"], sourceHref: "/app/kpis", timePeriod: "September 2026", limitation: "Synthetic fixture only.", fingerprint: `fixture-${index}` },
    lifecycleState: "active", pinned: false, view: "current", currentFeedStatus: "surfaced", reopenReason: null, reopenedFrom: null, reasonCode: null, reasonText: null, dismissedBy: null, recheckAfter: null, stateChangedAt: null, lifecycleToken: null };
}));
export const briefings = freeze(Object.fromEntries(["weekly", "monthly"].map(briefingType => [briefingType, {
  briefingType, status: "unavailable", eligibility: "no_eligible_evidence", confidence: "Low", artifact: null,
  message: "Briefing generation is unavailable in this isolated preview.", period: { start: "2026-09-01", end: "2026-09-29", cutoff: AS_OF, dayCount: 29, timeZone: "UTC" },
}])));
const emptyHealthSummary = "Vaeroex needs more eligible original evidence before it can score Business Health reliably.";
const emptyHealthDriver = "Setup context, generated outputs, and Business Memory do not count as independent business evidence.";
export function executiveModel(empty = false) {
  return {
    health: { available: !empty, score: empty ? null : 76, status: empty ? "Limited evidence" : "Watch", trend: empty ? null : "Improving", trendDelta: empty ? null : 4,
      summary: empty ? emptyHealthSummary : "Order fulfillment needs attention while retention is improving.", driver: empty ? emptyHealthDriver : "Order fulfillment: 87% vs 95% target", displayTitle: empty ? emptyHealthSummary : "Order fulfillment needs attention", driverPresentation: empty ? { identity: "Business Evidence Coverage", details: [emptyHealthDriver] } : { identity: "Order fulfillment", details: ["Actual: 87%", "Target: 95%"] }, confidence: empty ? "Low" : "Medium", memorySignals: empty ? 0 : 128, eligibleSignalCategories: empty ? [] : [{ id: "kpi_observations", label: "KPI observations", count: 64 }, { id: "files", label: "Files", count: 32 }] },
    priorities: (["risk", "opportunity", "decision"] as const).map((tone, index) => ({ label: ["Top risk", "Top opportunity", "Leadership decision"][index], title: empty ? "No active finding" : ["Order fulfillment is below target", "Retention is above target", "Review current operating priorities"][index], summary: empty ? "Add evidence to support a review." : "Use the supporting records to confirm the next practical step.", metadata: "Synthetic evidence · September 2026", confidence: "Medium", priority: "Medium", actionLabel: empty ? "Add information" : "Review finding", href: empty ? "/app/sources" : "/app/intelligence", tone, empty })),
    changes: { state: empty ? "first_review" : "changes", items: empty ? [] : [{ id: "change-1", title: "Business Health improved", detail: "Up 4 points from the previous synthetic review.", tone: "positive" }], message: empty ? "No previous review available." : "Compared with the previous review." },
    readiness: { available: !empty, coverage: empty ? 0 : 68, label: "Partial", strongestArea: "Operations", strongestCoverage: 78, largestGap: "Financial history", recommendedNextSource: "Add the latest monthly financial summary.", showAddInformation: true },
  };
}
export const facts = freeze({ available: true, score: 76, status: "Watch", trajectory: "Improving", comparison: "Up 4 points", comparisonDelta: 4, dataQualityBase: 80, riskPenalty: 8, opportunityAdjustment: 4, confidence: "Medium", freshness: "current", latestEvidenceAt: AS_OF, deterministicSummary: "Synthetic operations review.", drivers: [], limitations: ["Synthetic preview; not a business assessment."] });
export function businessHealthFacts(empty = false) {
  if (!empty) return facts;
  return { ...facts, available: false, score: null, status: "Limited evidence", trajectory: null,
    comparison: "No valid previous review is available for comparison.", comparisonDelta: null,
    dataQualityBase: 50, riskPenalty: 0, opportunityAdjustment: 0, confidence: "Low", freshness: "unavailable", latestEvidenceAt: null,
    deterministicSummary: emptyHealthSummary };
}
export function squareData(empty: boolean, role: FixtureRole, params: URLSearchParams) {
  const payments = Array.from({ length: 78 }, (_, index) => ({ id: `synthetic-payment-${index + 1}`, locationId: "location-preview", status: index % 8 ? "COMPLETED" : "APPROVED", createdAt: `2026-09-${String(29 - index % 20).padStart(2, "0")}T08:00:00.000Z`, updatedAt: AS_OF, amountMinor: String(3400 + index * 137), currency: "USD" }));
  const connection = { connectionId: "connection-preview", businessEntityId: "entity-preview", state: "connected", sellerLabel: "Harbor Supply · Synthetic seller", locations: [{ id: "location-preview", label: "Main location" }], locationId: "location-preview", lastSyncedAt: AS_OF, checkpointAt: AS_OF, activeRead: null, lastCompletedRead: null, lastError: null, hasMore: false, revocationPending: false, recoveryRequired: false, payments: payments.slice(0, 5) };
  const status = params.get("status") || "all", startDate = params.get("startDate"), endDate = params.get("endDate");
  const filtered = payments.filter(payment => (status === "all" || payment.status === status) && (!startDate || payment.createdAt.slice(0, 10) >= startDate) && (!endDate || payment.createdAt.slice(0, 10) <= endDate));
  const totalPages = Math.max(1, Math.ceil(filtered.length / 25));
  const page = Math.min(totalPages, Math.max(1, Number(params.get("page")) || 1));
  return { view: { available: role === "owner", historyAvailable: true, businessEntities: [{ id: "entity-preview", label: "Harbor Supply · Synthetic" }], connections: empty ? [] : [connection] },
    browser: empty ? null : { connectionId: connection.connectionId, currentConnection: connection, timeZone: "UTC", timeZoneFallback: false, page, pageSize: 25, totalCount: filtered.length, totalPages, payments: filtered.slice((page - 1) * 25, page * 25), connections: [{ connectionId: connection.connectionId, businessEntityId: connection.businessEntityId, businessEntityLabel: "Harbor Supply · Synthetic", sellerLabel: connection.sellerLabel, locationLabel: "Main location", state: "connected", timeZone: "UTC", timeZoneFallback: false, createdAt: AS_OF, paymentCount: payments.length }], filters: { startDate, endDate, status } },
  };
}
