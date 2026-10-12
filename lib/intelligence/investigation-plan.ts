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
const REPORTING_PERIOD_FIELD = /(?:^|[ _-])(?:day|week|month|quarter|year|period)(?:$|[ _-])/i;
const INSTRUCTION_FIELD = /\b(?:ignore|instructions?|prompt|system|execute|delete|reveal|send|override|admin|model|policy)\b/i;

function readable(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function availableInvestigationFields(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw)
    // A populated KPI row can contain amounts and reporting dates as well as categories.
    // Only categorical text can justify asking for a breakdown by that field.
    .filter(([key, value]) => {
      const field = readable(key);
      if (PRIVATE_OR_SYSTEM_FIELD.test(field) || MEASURE_FIELD.test(field) || REPORTING_PERIOD_FIELD.test(field) || INSTRUCTION_FIELD.test(field) || field.split(" ").length > 3) return false;
      if (typeof value !== "string") return false;
      const detail = value.trim();
      return detail.length > 0 && detail.length <= 64 && !/^[+-]?(?:[$€£])?\d[\d,.]*(?:\s*%|\s*(?:hours?|minutes?|days?))?$/.test(detail)
        && !/^\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?$/.test(detail);
    })
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
    return { records: subject
      ? `dated records for ${subject} and the figures used to calculate the ${measure}`
      : `dated figures used to calculate the ${measure}`, check: "Check the calculation." };
  }
  if (/\b(?:elapsed|duration|latency|time between|time from|hours between|minutes between)\b/.test(meaning)) {
    return { records: "underlying records with start and end times", check: "" };
  }
  if (/\b(?:currency|revenue|cost|spend|sales|price|amount|usd|dollars?)\b/.test(meaning)) {
    return { records: "dated transactions and amounts behind the total", check: "" };
  }
  if (/\b(?:count|number|total|volume)\b/.test(meaning)) {
    return { records: "individual dated records behind the count", check: "Check what the count includes." };
  }
  return { records: "dated records behind this measure", check: "" };
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
      ? `Update ${name} before making a current decision.`
      : `Get the latest ${subject} before making a current decision.`
    : insight.priority === "High"
      ? `Check ${subject} now${period ? ` for ${period}` : ""}.`
      : `Review ${subject}${period ? ` for ${period}` : ""}.`;
  const review = isStale && !isKpi ? `Review the ${period || "past"} records while waiting for current data.` : "";
  const specific = context?.sourceAction ? sourceInstruction(context.sourceAction) : "";
  const missing = missingDetail(insight.missingEvidence[0]);

  // A KPI row is an aggregate even when it contains a grouping column. It does not prove
  // that comparable underlying groups or individual events are available.
  const comparison = isKpi
    ? context?.targetAvailable && dated.length > 1
      ? isStale ? `Compare the ${period || "recorded"} values with the target and earlier results.` : "Compare each period with the target and earlier results."
      : context?.targetAvailable ? `Check the ${isStale ? `${period || "recorded"} ` : ""}result against its target.`
        : dated.length > 1 ? `Compare the ${isStale ? `${period || "recorded"} ` : ""}results across periods.` : "Get another dated result for comparison."
    : specific ? "" : originals.length > 1 && dated.length > 1
      ? "Get other records from those dates before comparing the pattern."
      : originals.length > 1 ? "Compare the records from this period." :
        /\b(?:records?|transactions?|events?|cases?|entries)\b/i.test(insight.missingEvidence[0] || "")
          ? "" : "Get comparable records from the same source to see whether this repeats.";

  const sharedFields = distinct([...(context?.availableFields || []), ...originals.flatMap((record) => record.availableFields || [])]
    .map(readable)).filter((field) => !PRIVATE_OR_SYSTEM_FIELD.test(field) && !MEASURE_FIELD.test(field) && !REPORTING_PERIOD_FIELD.test(field)).slice(0, 2);
  const group = sharedFields.length && originals.length > 1 ? sharedFields.join(" and ").toLowerCase() : "";
  const detail = calculationDetail(context, name);
  const recordRequest = isKpi
    ? `Get ${detail.records}${group ? `, broken down by ${group}` : ""}.`
    : missing;
  const groupStep = !isKpi && group ? `Check ${group} for each record.` : "";
  const next = specific ? "" : isKpi
    ? insight.type === "Opportunity"
      ? "Have the person responsible for this measure review the best period's entries and document any confirmed process difference before repeating it."
      : context?.targetAvailable
        ? "Have the person responsible for this measure check the entries behind the largest gap and assign follow-up for affected records."
        : "Have the person responsible for this measure check the flagged entries and assign follow-up for affected records."
    : insight.type === "Opportunity"
      ? "Have the person responsible for these records document any confirmed change before repeating it."
      : "Have the person responsible for these records mark each flagged record as confirmed, corrected, or still unexplained.";

  // Never slice a sentence to satisfy an arbitrary character count. Under length pressure,
  // omit optional grouping and boilerplate; keep the source action and supported comparison.
  const parts = [first, review, comparison, groupStep, specific, recordRequest, isKpi ? detail.check : "", next].filter(Boolean);
  if (parts.join(" ").length <= 620) return parts.join(" ");
  const withoutOptionalGroup = [first, review, comparison, specific, recordRequest, next].filter(Boolean);
  if (withoutOptionalGroup.join(" ").length <= 620) return withoutOptionalGroup.join(" ");
  return [first, comparison, specific || recordRequest, specific ? recordRequest : next].filter(Boolean).join(" ");
}
