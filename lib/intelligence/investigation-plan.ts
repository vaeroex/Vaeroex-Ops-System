import type { IntelligenceInsight } from "@/lib/intelligence/layer";

export type InvestigationContext = {
  kind: "kpi" | "records";
  definition?: string | null;
  unit?: string | null;
  direction?: string | null;
  availableFields?: string[];
  preserveSpecificAction?: boolean;
  sourceAction?: string;
};

const DETAIL_FIELD = /^(?:supplier|vendor|carrier|site|shift|store|location|region|product|item|sku|category|channel|customer|client|order|team|department|status|date|timestamp|period|review(?:\s+text)?|feedback(?:\s+text)?)$/i;
const META_FIELD = /^(?:vaeroex|evidence|source|import|workspace|raw|created|updated|row(?:\s+number)?)\b/i;

export function availableInvestigationFields(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .filter(([key, value]) => !META_FIELD.test(key) && DETAIL_FIELD.test(key.trim()) && value !== null && value !== undefined && String(value).trim() !== "")
    .map(([key]) => key.trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 32))
    .filter(Boolean)
    .slice(0, 12);
}

function distinct(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function short(value: string, length: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= length ? clean : `${clean.slice(0, length - 3).trimEnd()}...`;
}

function stale(insight: IntelligenceInsight, asOf: Date | string) {
  const latest = Math.max(...insight.supportingRecords.map((record) => Date.parse(record.date)).filter(Number.isFinite));
  const now = new Date(asOf).getTime();
  return Number.isFinite(latest) && Number.isFinite(now) && now - latest > 45 * 86_400_000;
}

function missingCalculationDetail(context: InvestigationContext | undefined, label: string) {
  const meaning = `${context?.definition || ""} ${label} ${context?.unit || ""}`.toLowerCase();
  const sourceEntity = context?.definition?.toLowerCase().match(/\b(?:share|rate|ratio|percentage) of ([a-z]{3,24})\b/)?.[1];
  const entity = sourceEntity && !/^(?:total|actual|the|all|each|other|overall)$/.test(sourceEntity)
    ? `${sourceEntity.replace(/s$/, "")}-level ` : "";
  if (/\b(?:share|rate|ratio|percent(?:age)?|divided by|per hundred|per thousand)\b/.test(meaning)) {
    return `Obtain dated ${entity}numerator and denominator source rows with IDs; verify the calculation before assigning a cause.`;
  }
  if (/\b(?:elapsed|duration|latency|time between|time from|hours between)\b/.test(meaning)) {
    return "Obtain start and end timestamps for individual source rows before assigning a cause.";
  }
  if (/\b(?:count|number|total|volume)\b/.test(meaning)) {
    return "Obtain dated item-level rows, unique IDs, and the counting rule before assigning a cause.";
  }
  return "Obtain underlying measurement rows, dates, and calculation inputs before assigning a cause.";
}

/** A bounded, source-specific investigation boundary shared by the inbox and generated explanations. */
export function planInvestigation(insight: IntelligenceInsight, asOf: Date | string = new Date()) {
  const context = insight.investigationContext;
  if (context?.preserveSpecificAction) return insight.recommendedAction;

  const originals = insight.supportingRecords.filter((record) => record.classification !== "Derived");
  const fields = distinct([
    ...(context?.availableFields || []),
    ...originals.flatMap((record) => record.availableFields || [])
  ]);
  const segments = fields.filter((field) => /^(?:supplier|vendor|carrier|site|shift|store|location|region|product|category|channel|team|department|status)$/i.test(field)).slice(0, 3);
  const identifiers = fields.filter((field) => /^(?:item|sku|customer|client|order)$/i.test(field)).slice(0, 3);
  const names = distinct(originals.map((record) => record.title)).slice(0, 2);
  const dated = originals.map((record) => record.date.slice(0, 10)).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const period = short(dated.length > 1 && dated[0] !== dated.at(-1)
    ? `${dated[0]} to ${dated.at(-1)}` : insight.timePeriod || "the recorded period", 52);
  const isKpi = context?.kind === "kpi" || originals.some((record) => /KPI/i.test(record.recordType));
  const label = isKpi
    ? `${short(names[0] || insight.title, 62)} KPI source measurements`
    : names.length > 1 ? names.map((name) => short(name, 40)).join(" and ")
      : names.length ? short(names[0], 55) : `${short(insight.affectedArea, 55)} source records`;
  const comparison = segments.length
    ? originals.length > 1
      ? `Compare dated records by ${segments.join(", ")} where comparable groups exist; otherwise obtain them.`
      : `Check ${[...identifiers, ...segments].slice(0, 3).join(", ")} in this row; obtain comparable rows from that source and period.`
    : identifiers.length
      ? `Check the ${identifiers.join(", ")} identifiers in each affected row; obtain comparable rows from that source.`
    : isKpi
      ? `Compare dated values with the ${context?.direction === "minimize" ? "maximum" : context?.direction === "maximize" ? "minimum" : "configured"} target and prior periods${context?.unit ? ` (${short(context.unit, 20)})` : ""}.`
      : "Compare with earlier comparable records from that source; obtain them if absent.";
  const detail = isKpi
    ? missingCalculationDetail(context, insight.title)
    : `Obtain ${short(insight.missingEvidence[0] || "the missing source detail", 72).toLowerCase()} before assigning a cause.`;
  const decision = insight.type === "Opportunity"
    ? "Assign an owner to verify repeatability and document what, if anything, should be preserved or tested."
    : insight.type === "Recommendation"
      ? "Assign an owner to decide and document follow-up."
      : isKpi
        ? "Assign an owner to verify the largest gap and document follow-up or unknowns."
        : "Assign an owner to verify each affected record and document resolution, escalation, or unknowns.";
  const prefix = stale(insight, asOf) ? "Refresh the source before a current decision; then inspect" : insight.priority === "High" ? "Now inspect" : "Inspect";
  const first = `${prefix} ${label} for ${period}.`;
  const sourceAction = context?.sourceAction?.trim() || "";
  const alternatives = [
    [first, comparison, sourceAction, detail, decision],
    [first, sourceAction, detail, decision],
    [first, comparison, detail, decision],
    [first, detail, decision]
  ].map((parts) => parts.filter(Boolean).join(" "));
  return alternatives.find((action) => action.length <= 420) || alternatives.at(-1)!;
}
