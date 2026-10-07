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
  const sourceNouns = context?.definition?.toLowerCase().match(/\b(?:share|rate|ratio|percentage) of ([a-z]{3,24})(?:\s+([a-z]{3,24}))?/);
  const sourceEntity = sourceNouns && /^(?:items|orders|records|reviews|transactions|shipments|customers|cases|units)$/.test(sourceNouns[2] || "")
    ? `${sourceNouns[1]} ${sourceNouns[2]}` : sourceNouns?.[1];
  const entity = sourceEntity && !/^(?:total|actual|the|all|each|other|overall)$/.test(sourceEntity)
    ? `${sourceEntity.replace(/s$/, "")}-level ` : "";
  if (/\b(?:share|rate|ratio|percent(?:age)?|divided by|per hundred|per thousand)\b/.test(meaning)) {
    return `Obtain dated ${entity}numerator and denominator rows with IDs; verify the calculation before assigning a cause.`;
  }
  if (/\b(?:elapsed|duration|latency|time between|time from|hours between)\b/.test(meaning)) {
    return "Obtain row-level start and end timestamps before assigning a cause.";
  }
  if (/\b(?:count|number|total|volume)\b/.test(meaning)) {
    return "Obtain dated item-level rows, IDs, and the counting rule before assigning a cause.";
  }
  return "Obtain measurement rows, dates, and calculation inputs before assigning a cause.";
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
    ? `${dated[0]} to ${dated.at(-1)}` : insight.timePeriod || "the recorded period", 36);
  const isKpi = context?.kind === "kpi" || originals.some((record) => /KPI/i.test(record.recordType));
  const label = isKpi
    ? `${short(names[0] || insight.title, 52)} KPI measurements`
    : names.length > 1 ? names.map((name) => short(name, 32)).join(" and ")
      : names.length ? short(names[0], 52) : `${short(insight.affectedArea, 52)} source records`;
  const comparison = segments.length
    ? originals.length > 1
      ? `Compare by ${segments.map((field) => short(field, 16)).join(", ")} if comparable dated groups exist; otherwise obtain them.`
      : `Check ${[...identifiers, ...segments].slice(0, 3).map((field) => short(field, 16)).join(", ")} against comparable rows from that source.`
    : identifiers.length
      ? `Check ${identifiers.map((field) => short(field, 16)).join(", ")} against comparable rows from that source.`
    : isKpi
      ? `Compare dated values with the ${context?.direction === "minimize" ? "maximum" : context?.direction === "maximize" ? "minimum" : "configured"} target and prior periods${context?.unit ? ` (${short(context.unit, 16)})` : ""}.`
      : "Compare earlier records from that source; obtain them if missing.";
  const detail = isKpi
    ? missingCalculationDetail(context, insight.title)
    : `Obtain ${(insight.missingEvidence[0]?.length || 0) > 48 ? "the missing row-level source detail" : (insight.missingEvidence[0] || "the missing source detail").toLowerCase()} before assigning a cause.`;
  const decision = insight.type === "Opportunity"
    ? "Assign an owner to verify repeatability and decide what to preserve or test."
    : insight.type === "Recommendation"
      ? "Assign an owner to decide and document follow-up."
      : isKpi
        ? "Assign an owner to verify the largest gap and document action or unknowns."
        : "Assign an owner to verify, resolve or escalate each affected record.";
  const prefix = stale(insight, asOf) ? "Refresh source first; then inspect" : insight.priority === "High" ? "Now inspect" : "Inspect";
  const first = `${prefix} ${label} for ${period}.`;
  const sourceAction = context?.sourceAction?.trim() || "";
  const full = [first, comparison, sourceAction, detail, decision].filter(Boolean).join(" ");
  if (full.length <= 420) return full;
  const core = [first, comparison, detail, decision].join(" ");
  const boundedCore = core.length <= 420
    ? [first, comparison, detail, decision]
    : [first, comparison, "Obtain row-level source detail before assigning a cause.", "Assign an owner to document follow-up."];
  const room = 420 - boundedCore.join(" ").length - 1;
  if (!sourceAction || room < 45) return boundedCore.join(" ");
  const firstClause = sourceAction.split(/[,;](?:\s+|$)/)[0].replace(/[.!?]+$/, "");
  const leadingAction = firstClause.split(/\s+(?:by|with|against|using)\s+/i)[0];
  const boundedSource = firstClause.length >= 35 && firstClause.length + 1 <= room
    ? `${firstClause}.`
    : leadingAction.length >= 35 && leadingAction.length + 1 <= room
      ? `${leadingAction}.` : short(sourceAction, room);
  return [boundedCore[0], boundedCore[1], boundedSource, boundedCore[2], boundedCore[3]].join(" ");
}
