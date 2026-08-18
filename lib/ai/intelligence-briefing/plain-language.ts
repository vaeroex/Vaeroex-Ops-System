import {
  INTELLIGENCE_BRIEFING_DEFAULT_LOCALE,
  type IntelligenceBriefingCitation,
  type IntelligenceBriefingEvidencePeriod,
  type IntelligenceBriefingSignal
} from "@/lib/ai/intelligence-briefing/contracts";

const INTERNAL_IDENTIFIER = /\b(?:preview_fixture|workspace_id|source_file_id|candidate_id|manifest_id|raw_data_json|input_json|output_json|intelligence_snapshot_v\d+|intelligence_briefing_(?:prompt|schema|validator|generation_policy|claim_acceptance)[a-z0-9_]*)\b/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const SNAKE_CASE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const GENERIC_METRIC = /\b(?:the KPI|the metric)\b/i;
const IDIOM = /\b(?:move(?:d|s)? the needle|low-hanging fruit|ballpark|game changer|at the end of the day|boil the ocean|silver bullet)\b/i;

const CUSTOMER_LANGUAGE_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bNo authoritative target is configured\./gi, "No target has been set for this metric."],
  [/\bMovement insufficient_data\./gi, "There is not enough recent data to determine whether this result is improving or declining."],
  [/\bPerformance effect indeterminate\./gi, "The available evidence does not show the business impact."],
  [/\bcanonical KPI semantics\b/gi, "confirmed metric definition"],
  [/\bauthoritative target\b/gi, "target"],
  [/\bcanonical freshness policy\b/gi, "current-data standard"],
  [/\bdated periods\b/gi, "recorded dates"],
  [/\bperformance effect indeterminate\b/gi, "the available evidence does not show the business impact"],
  [/\bmovement insufficient_data\b/gi, "there is not enough recent data to determine whether this result is improving or declining"],
  [/\babove_acceptable_maximum\b/gi, "above the maximum target"],
  [/\bbelow_acceptable_minimum\b/gi, "below the minimum target"],
  [/\bbelow_required_minimum\b/gi, "below the minimum target"],
  [/\bmoving_toward_target\b/gi, "moving toward the target"],
  [/\bmoving_away_from_target\b/gi, "moving away from the target"],
  [/\bwithin_range\b/gi, "within the target range"],
  [/\bno_target\b/gi, "no target has been set"],
  [/\bdirection_unknown\b/gi, "the preferred direction has not been set"],
  [/\binsufficient_data\b/gi, "not enough data"],
  [/\bdeterministic confidence\b/gi, "evidence confidence"],
  [/\bdeterministic result\b/gi, "evidence-based result"],
  [/\bKPI observation\b/gi, "metric record"],
  [/\bKPI evidence\b/gi, "metric evidence"]
];

const SOURCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  "canonical kpi observation": "Metric record",
  "kpi evidence": "Metric evidence",
  "kpi record": "Metric record",
  "business memory": "Business record",
  "historical trend": "Historical metric record",
  "intelligence layer source": "Business evidence",
  "intelligence_layer_source": "Business evidence",
  manual: "Manual business record"
};

const SMALL_COUNTS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"] as const;

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function normalizedNumber(value: number) {
  return Number(finite(value).toPrecision(12));
}

function sentenceWords(sentence: string) {
  return sentence.trim().split(/\s+/).filter(Boolean).length;
}

function syllables(word: string) {
  const normalized = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return 0;
  if (normalized.length <= 3) return 1;
  const trimmed = normalized.replace(/(?:es|ed|e)$/i, "");
  return Math.max(1, (trimmed.match(/[aeiouy]+/g) || []).length);
}

export function intelligenceBriefingExplicitDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date unavailable";
  return new Intl.DateTimeFormat(INTELLIGENCE_BRIEFING_DEFAULT_LOCALE, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value));
}

export function intelligenceBriefingPlainPeriodLabel(period: IntelligenceBriefingEvidencePeriod) {
  return `${intelligenceBriefingExplicitDate(period.start)} through ${intelligenceBriefingExplicitDate(period.end)}`;
}

export function intelligenceBriefingCountLabel(value: number) {
  return Number.isInteger(value) && value >= 0 && value < SMALL_COUNTS.length
    ? SMALL_COUNTS[value]
    : new Intl.NumberFormat(INTELLIGENCE_BRIEFING_DEFAULT_LOCALE).format(value);
}

export function intelligenceBriefingMetricValue(value: number, unit: string | null, metricName = "") {
  const normalizedUnit = (unit || "").trim().toLowerCase();
  const number = new Intl.NumberFormat(INTELLIGENCE_BRIEFING_DEFAULT_LOCALE, { maximumFractionDigits: 2 }).format(value);
  if (normalizedUnit === "%" || normalizedUnit.includes("percent")) return `${number}%`;
  if (normalizedUnit === "count" || normalizedUnit === "units") return number;
  if (["min", "minute", "minutes"].includes(normalizedUnit)) return `${number} ${Math.abs(value) === 1 ? "minute" : "minutes"}`;
  if (["hr", "hour", "hours"].includes(normalizedUnit)) return `${number} ${Math.abs(value) === 1 ? "hour" : "hours"}`;

  const isCurrency = /(?:^|\s)(?:\$|usd|dollar)/i.test(unit || "") || /revenue|sales|cost|expense|profit|margin \$|value/i.test(metricName);
  if (isCurrency) {
    const absolute = Math.abs(value);
    if (absolute >= 1_000_000) {
      return `${value < 0 ? "-" : ""}$${new Intl.NumberFormat(INTELLIGENCE_BRIEFING_DEFAULT_LOCALE, { maximumFractionDigits: 2 }).format(absolute / 1_000_000)} million`;
    }
    return new Intl.NumberFormat(INTELLIGENCE_BRIEFING_DEFAULT_LOCALE, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2
    }).format(value);
  }
  return unit ? `${number} ${unit}` : number;
}

export function intelligenceBriefingMetricName(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (/^(?:1|one)-star reviews$/i.test(compact)) return "One-star reviews";
  return compact;
}

export function intelligenceBriefingCustomerText(value: string) {
  let text = value.replace(/\s+/g, " ").trim();
  text = text.replace(
    /1-Star Reviews was ([\d,.]+) count on (\d{4}-\d{2}-\d{2})\.\s*Target status is above_acceptable_maximum against the authoritative target of ([\d,.]+)\./gi,
    (_match, actualText: string, date: string, targetText: string) => {
      const actual = Number(actualText.replace(/,/g, ""));
      const target = Number(targetText.replace(/,/g, ""));
      const difference = normalizedNumber(actual - target);
      return `The business recorded ${intelligenceBriefingMetricValue(actual, "count")} one-star reviews on ${intelligenceBriefingExplicitDate(date)}. One-star reviews reached ${intelligenceBriefingMetricValue(actual, "count")}, which is ${intelligenceBriefingMetricValue(difference, "count")} above the maximum target of ${intelligenceBriefingMetricValue(target, "count")}.`;
    }
  );
  for (const [pattern, replacement] of CUSTOMER_LANGUAGE_REPLACEMENTS) text = text.replace(pattern, replacement);
  text = text.replace(new RegExp(INTERNAL_IDENTIFIER.source, "gi"), "business evidence");
  text = text.replace(new RegExp(UUID.source, "gi"), "business record");
  text = text.replace(ISO_DATE, (match) => intelligenceBriefingExplicitDate(match));
  text = text.replace(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g, (match) => match.replace(/_/g, " "));
  return text;
}

export function intelligenceBriefingCustomerSourceLabel(value: string, fallback: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact || UUID.test(compact) || INTERNAL_IDENTIFIER.test(compact) || /\b(?:row|record|object)\s*#?\d+\b/i.test(compact)) {
    return intelligenceBriefingCustomerText(fallback);
  }
  return intelligenceBriefingCustomerText(compact);
}

export function intelligenceBriefingCustomerSourceType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || INTERNAL_IDENTIFIER.test(normalized) || UUID.test(normalized)) return "Business evidence";
  if (/\brow\b/i.test(normalized)) return "Business record";
  return SOURCE_TYPE_LABELS[normalized] || intelligenceBriefingCustomerText(value || "Business evidence");
}

export function intelligenceBriefingCustomerCitation<
  T extends Omit<IntelligenceBriefingCitation, "href"> & { href?: `/app/${string}` }
>(citation: T): T {
  const title = intelligenceBriefingCustomerSourceLabel(citation.title, "Business evidence");
  return {
    ...citation,
    title,
    sourceLabel: intelligenceBriefingCustomerSourceLabel(citation.sourceLabel, title),
    sourceType: intelligenceBriefingCustomerSourceType(citation.sourceType),
    excerpt: intelligenceBriefingCustomerText(citation.excerpt)
  } as T;
}

export function intelligenceBriefingReadingGrade(value: string) {
  const sentences = value.split(/[.!?]+/).map((sentence) => sentence.trim()).filter(Boolean);
  const words = value.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
  if (!sentences.length || !words.length) return 0;
  const totalSyllables = words.reduce((sum, word) => sum + syllables(word), 0);
  return Math.max(0, 0.39 * (words.length / sentences.length) + 11.8 * (totalSyllables / words.length) - 15.59);
}

export function intelligenceBriefingPlainLanguageIssue(text: string, signal?: Pick<IntelligenceBriefingSignal, "label">) {
  if (INTERNAL_IDENTIFIER.test(text) || UUID.test(text) || SNAKE_CASE.test(text)) return "internal_language" as const;
  if (/\b(?:canonical KPI semantics|authoritative target|dated periods|performance effect indeterminate|deterministic result|deterministic signal)\b/i.test(text)) return "internal_language" as const;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(text)) return "ambiguous_date" as const;
  if (IDIOM.test(text)) return "idiom" as const;
  if (signal && GENERIC_METRIC.test(text) && !text.toLowerCase().includes(signal.label.toLowerCase())) return "unnamed_metric" as const;
  if (text.split(/(?<=[.!?])\s+/).some((sentence) => sentenceWords(sentence) > 32)) return "sentence_too_long" as const;
  return null;
}

export function intelligenceBriefingMovementSentence({
  metricName,
  startValue,
  endValue,
  unit,
  startDate,
  endDate,
  observationCount,
  movement,
  fullyInsideBriefingPeriod
}: {
  metricName: string;
  startValue: number;
  endValue: number;
  unit: string | null;
  startDate: string;
  endDate: string;
  observationCount: number;
  movement: "increased" | "decreased" | "unchanged" | "insufficient_data";
  fullyInsideBriefingPeriod: boolean;
}) {
  const name = intelligenceBriefingMetricName(metricName);
  if (movement === "insufficient_data" || observationCount < 2) {
    return `There is not enough recent data to determine whether ${name} is improving or declining.`;
  }
  const context = fullyInsideBriefingPeriod
    ? "During this briefing period"
    : `Historical context through ${intelligenceBriefingExplicitDate(endDate)}`;
  if (!fullyInsideBriefingPeriod) {
    return `${context}, ${name} was ${intelligenceBriefingMetricValue(endValue, unit, metricName)}.`;
  }
  const verb = movement === "unchanged" ? "remained unchanged" : movement;
  return `${context}, ${name} ${verb} from ${intelligenceBriefingMetricValue(startValue, unit, metricName)} on ${intelligenceBriefingExplicitDate(startDate)} to ${intelligenceBriefingMetricValue(endValue, unit, metricName)} on ${intelligenceBriefingExplicitDate(endDate)} across ${intelligenceBriefingCountLabel(observationCount)} recorded dates.`;
}

export function intelligenceBriefingTargetSentence({
  metricName,
  latestValue,
  unit,
  target,
  status
}: {
  metricName: string;
  latestValue: number;
  unit: string | null;
  target: Readonly<{ kind: "scalar"; value: number } | { kind: "range"; min: number; max: number } | { kind: "none" }>;
  status: string;
}) {
  const name = intelligenceBriefingMetricName(metricName);
  if (target.kind === "none" || status === "no_target") return `No target has been set for ${name}.`;
  if (status === "direction_unknown") return `The preferred performance direction has not been set for ${name}.`;
  if (target.kind === "range") {
    if (status === "within_range") {
      return `${name} is within its target range of ${intelligenceBriefingMetricValue(target.min, unit, metricName)} to ${intelligenceBriefingMetricValue(target.max, unit, metricName)}.`;
    }
    const boundary = latestValue > target.max ? target.max : target.min;
    const difference = normalizedNumber(Math.abs(latestValue - boundary));
    const direction = latestValue > target.max ? "above the maximum" : "below the minimum";
    return `${name} reached ${intelligenceBriefingMetricValue(latestValue, unit, metricName)}, which is ${intelligenceBriefingMetricValue(difference, unit, metricName)} ${direction} target of ${intelligenceBriefingMetricValue(boundary, unit, metricName)}.`;
  }
  if (status === "achieved") {
    return `${name} reached its target of ${intelligenceBriefingMetricValue(target.value, unit, metricName)}.`;
  }
  const difference = normalizedNumber(Math.abs(latestValue - target.value));
  const direction = status === "above_acceptable_maximum"
    ? "above the maximum target"
    : status === "below_required_minimum"
      ? "below the minimum target"
      : latestValue > target.value
        ? "above the target"
        : "below the target";
  return `${name} reached ${intelligenceBriefingMetricValue(latestValue, unit, metricName)}, which is ${intelligenceBriefingMetricValue(difference, unit, metricName)} ${direction} of ${intelligenceBriefingMetricValue(target.value, unit, metricName)}.`;
}

export function intelligenceBriefingDesiredDirectionSentence(metricName: string, direction: string) {
  const name = intelligenceBriefingMetricName(metricName);
  if (direction === "maximize") return `Higher ${name} is desirable.`;
  if (direction === "minimize") return `Lower ${name} is desirable.`;
  return null;
}
