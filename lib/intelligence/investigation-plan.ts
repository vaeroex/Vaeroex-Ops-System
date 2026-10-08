import type { IntelligenceInsight } from "@/lib/intelligence/layer";

export type InvestigationContext = {
  kind: "kpi" | "records";
  definition?: string | null;
  unit?: string | null;
  direction?: string | null;
  targetAvailable?: boolean;
  availableFields?: string[];
  preserveSpecificAction?: boolean;
  sourceAction?: string;
};

// Field names guide an investigation; field values and record IDs stay in linked evidence.
const PRIVATE_OR_SYSTEM_FIELD = /(?:^|[ _-])(?:vaeroex|workspace|source|import|raw|created|updated|evidence|secret|token|password|email|phone|address|ssn|patient|medical|insurance)(?:$|[ _-])|(?:^|[ _-])id$|^row(?:[ _-]?(?:id|number))?$/i;
const MEASURE_FIELD = /(?:^|[ _-])(?:value|amount|total|count|rate|percent|percentage|hours?|minutes?|seconds?|date|time|timestamp|text|description|comment|notes?|reason|number)(?:$|[ _-])/i;
const INSTRUCTION_FIELD = /\b(?:ignore|instructions?|prompt|system|execute|delete|reveal|send|override|admin|model|policy)\b/i;

function readable(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function availableInvestigationFields(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .filter(([key, value]) => !PRIVATE_OR_SYSTEM_FIELD.test(readable(key)) && !INSTRUCTION_FIELD.test(readable(key)) && readable(key).split(" ").length <= 3 && value !== null && value !== undefined && String(value).trim() !== "")
    .map(([key]) => readable(key).replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 32))
    .filter(Boolean)
    .slice(0, 12);
}

function distinct(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stale(insight: IntelligenceInsight, asOf: Date | string) {
  const latest = Math.max(...insight.supportingRecords.map((record) => Date.parse(record.date)).filter(Number.isFinite));
  const now = new Date(asOf).getTime();
  return Number.isFinite(latest) && Number.isFinite(now) && now - latest > 45 * 86_400_000;
}

function dateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)
    : null;
}

function periodLabel(dates: readonly string[]) {
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return null;
  if (first === last) return dateLabel(first);
  const start = new Date(`${first}T00:00:00Z`);
  const end = new Date(`${last}T00:00:00Z`);
  if (start.getUTCDate() === 1 && end.getUTCDate() === 1 && start.getUTCFullYear() === end.getUTCFullYear()) {
    const month = (date: Date) => new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
    return `${month(start)}–${month(end)} ${end.getUTCFullYear()}`;
  }
  return `${dateLabel(first)} to ${dateLabel(last)}`;
}

function sourceLabel(title: string) {
  const label = title.replace(/\s*[·:–-]\s*row\s*#?\d+\s*$/i, "").replace(/\s+row\s*#?\d+\s*$/i, "").replace(/\s+/g, " ").trim();
  return INSTRUCTION_FIELD.test(label) || label.length > 70 ? "" : label;
}

function metricLabel(insight: IntelligenceInsight, sourceTitle: string) {
  const title = sourceTitle || insight.title.replace(/\s+(?:remained|is)\s+(?:above|below|on|outside).*/i, "");
  if (INSTRUCTION_FIELD.test(title)) return "this measure";
  return title.length <= 70 ? title : `${title.slice(0, 67).trimEnd()}…`;
}

function definedRecordSubject(definition: string | null | undefined) {
  const candidate = definition?.toLowerCase().match(/\b(?:share|percentage|number|count|rate) of ([a-z][a-z -]{2,50})/)?.[1]
    ?.split(/\b(?:with|that|which|matching|where|when|after|before|per|divided|completed|logged)\b/)[0]
    .trim();
  if (!candidate) return null;
  const words = candidate.split(/\s+/).slice(0, 2);
  if (words.length > 1 && /(?:ed|ing)$/.test(words[1])) words.pop();
  const subject = words.join(" ");
  return subject.length >= 3 && subject.length <= 30 && !/^(?:all|the|total|actual|overall)$/.test(subject) ? subject : null;
}

function calculationDetail(context: InvestigationContext | undefined, label: string) {
  const meaning = `${context?.definition || ""} ${label} ${context?.unit || ""}`.toLowerCase();
  if (/\b(?:share|rate|ratio|percent(?:age)?|divided by|per hundred|per thousand)\b/.test(meaning)) {
    const measure = /\b(?:percent|percentage|share)\b/.test(`${context?.definition || ""} ${context?.unit || ""}`.toLowerCase()) ? "percentage" : "rate";
    const subject = definedRecordSubject(context?.definition);
    return subject
      ? `Get dated records for ${subject} and the figures used to calculate the ${measure}; check the calculation.`
      : `Get the dated figures used to calculate the ${measure} and check the calculation.`;
  }
  if (/\b(?:elapsed|duration|latency|time between|time from|hours between|minutes between)\b/.test(meaning)) {
    return "Get the start and end times for the underlying records to check the delay.";
  }
  if (/\b(?:currency|revenue|cost|spend|sales|price|amount|usd|dollars?)\b/.test(meaning)) {
    return "Get the dated transactions and amounts behind the total.";
  }
  if (/\b(?:count|number|total|volume)\b/.test(meaning)) {
    return "Get the individual dated records and check what the count includes.";
  }
  return "Get the dated records and figures behind this measure.";
}

function missingDetail(value: string | undefined) {
  if (!value || value.length > 95) return "Get the missing details from the source before deciding why this happened.";
  const plain = readable(value).replace(/\brow level\b/gi, "individual record").replace(/\btimestamps?\b/gi, "times").replace(/\bIDs?\b/g, "identifiers");
  return `Get the ${plain[0].toLowerCase()}${plain.slice(1).replace(/\blevel\b/gi, "").replace(/\s+/g, " ")} from the source.`;
}

function sourceInstruction(value: string) {
  return value.replace(/\brow-level\b/gi, "individual-record").replace(/\bsource rows?\b/gi, "source records").trim();
}

/** One plain-language action shared by current findings and new generated explanations. */
export function planInvestigation(insight: IntelligenceInsight, asOf: Date | string = new Date()) {
  const context = insight.investigationContext;
  // A person's issue fix is authoritative; do not rewrite their instructions.
  if (context?.preserveSpecificAction) return insight.recommendedAction;

  const originals = insight.supportingRecords.filter((record) => record.classification !== "Derived");
  const names = distinct(originals.map((record) => sourceLabel(record.title)));
  const dated = distinct(originals.map((record) => record.date.slice(0, 10)).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))).sort();
  const period = periodLabel(dated);
  const isKpi = context?.kind === "kpi" || originals.some((record) => /KPI/i.test(record.recordType));
  const name = isKpi ? metricLabel(insight, names[0] || "") : names.length === 1 ? names[0] : sourceLabel(insight.title) || "the linked source";
  const subject = isKpi ? name === "this measure" ? "the measure's figures" : `${name} figures` : names.length === 1 ? `records from ${name}` : `records behind ${name}`;
  const isStale = stale(insight, asOf);
  const first = isStale
    ? isKpi
      ? `Update the figures behind ${name} before using this finding for a current decision.`
      : `Get the latest ${subject} before using this finding for a current decision.`
    : insight.priority === "High"
      ? `Check ${subject} now${period ? `, focusing on ${period}` : ""}.`
      : `Review ${subject}${period ? ` for ${period}` : ""}.`;
  const review = isStale ? `Then review the results from ${period || "the recorded period"}.` : "";

  // A KPI row is an aggregate even when it contains a grouping column. It does not prove
  // that comparable underlying groups or individual events are available.
  const comparison = isKpi
    ? context?.targetAvailable && dated.length > 1
      ? "Compare the dated values with the target and earlier periods."
      : context?.targetAvailable ? "Check the value against its target."
        : dated.length > 1 ? "Compare the dated values with earlier periods." : "Get another dated value for comparison."
    : originals.length > 1 && dated.length > 1
      ? "Get more records from those dates before comparing the pattern."
      : originals.length > 1 ? "Compare these records from the same period." :
        context?.sourceAction ? "" : "Get comparable records from the same source to see whether this repeats.";

  const sharedFields = distinct([...(context?.availableFields || []), ...originals.flatMap((record) => record.availableFields || [])]
    .map(readable)).filter((field) => !PRIVATE_OR_SYSTEM_FIELD.test(field) && !MEASURE_FIELD.test(field)).slice(0, 2);
  const groupStep = sharedFields.length && originals.length > 1
    ? isKpi
      ? `Get detailed records by ${sharedFields.join(" and ").toLowerCase()} before comparing those groups.`
      : `Check ${sharedFields.join(" and ").toLowerCase()} for each record.`
    : "";
  const specific = context?.sourceAction ? sourceInstruction(context.sourceAction) : "";
  const detail = isKpi ? calculationDetail(context, name) : missingDetail(insight.missingEvidence[0]);
  const next = specific ? "" : insight.type === "Opportunity"
    ? `Ask the ${isKpi ? "measure's" : "source"} owner what changed, then use the records to decide whether this result can be repeated.`
    : isKpi ? "Ask the measure's owner to check the largest gap and identify which underlying entries need follow-up."
      : "Ask the source owner to mark each flagged record as confirmed, corrected, or still unexplained.";

  // Never slice a sentence to satisfy an arbitrary character count. Under length pressure,
  // omit optional grouping and boilerplate; keep the source action and supported comparison.
  const parts = [first, review, comparison, groupStep, specific, detail, next].filter(Boolean);
  if (parts.join(" ").length <= 620) return parts.join(" ");
  const withoutOptionalGroup = [first, review, comparison, specific, detail, next].filter(Boolean);
  if (withoutOptionalGroup.join(" ").length <= 620) return withoutOptionalGroup.join(" ");
  return [first, comparison, specific || detail, specific ? detail : next].filter(Boolean).join(" ");
}
