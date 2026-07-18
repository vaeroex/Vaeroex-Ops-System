import type { ExecutiveEvidenceReference } from "@/lib/search/types";

export type ExecutiveEvidenceDetail = {
  label: string;
  value: string;
};

export type ExecutiveEvidencePresentation = {
  citationNumber: number;
  sourceName: string;
  sourceType: string;
  summary: string | null;
  details: ExecutiveEvidenceDetail[];
  provenance: ExecutiveEvidenceDetail[];
};

export type ExecutiveEvidenceSummary = {
  citationNumbers: number[];
  evidenceCount: number;
  sourceCount: number;
  text: string;
};

type UnknownRecord = Record<string, unknown>;

const UUID_PATTERN = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi;
const SERIALIZED_EVIDENCE_PATTERN = /(^\s*[\[{])|\b(?:raw_data_json|source_data_json|metadata_json|source_file_id|import_id|workspace_id|worksheet_index)\b/i;
const INTERNAL_KEY_PATTERN = /(^id$|_id$|^uuid$|^raw_data_json$|^source_data_json$|^metadata_json$|^created_at$|^updated_at$|^deleted_at$|^archived_at$|worksheet_index|source file id|dataset type)/i;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactText(value: string, maxLength = 240) {
  const compact = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeText(value: unknown, maxLength = 240) {
  if (typeof value !== "string") return "";
  return compactText(value.replace(UUID_PATTERN, ""), maxLength);
}

function normalizedKey(key: string) {
  return key.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function humanizeKey(key: string) {
  return key
    .replace(/^vaeroex[\s_-]+/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function sourceTypeLabel(value: string) {
  const normalized = value.toLowerCase();
  if (/kpi|metric|measurement/.test(normalized)) return "Operational metric";
  if (/memory|learned/.test(normalized)) return "Learned business evidence";
  if (/report|brief/.test(normalized)) return "Leadership report";
  if (/histor|snapshot|health/.test(normalized)) return "Historical assessment";
  if (/file|document|worksheet|source/.test(normalized)) return "Source document";
  return safeText(humanizeKey(value), 80) || "Business evidence";
}

function executiveLineTokens(value: string) {
  const stopWords = new Set(["a", "an", "and", "appears", "are", "currently", "indicates", "is", "may", "the"]);
  return safeText(value, 360)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token && !stopWords.has(token))
    .map((token) => token.replace(/(?:ing|ed|es|s)$/, ""));
}

export function areExecutiveLinesEquivalent(left: string, right: string) {
  const leftTokens = executiveLineTokens(left);
  const rightTokens = executiveLineTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  if (leftTokens.join(" ") === rightTokens.join(" ")) return true;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const shared = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return shared >= 3 && shared / union >= 0.85;
}

function formattedValue(value: unknown, key = ""): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
    return /percent|percentage|%|rate/i.test(key) ? `${formatted}%` : formatted;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return safeText(value);
  if (Array.isArray(value)) {
    const items: string[] = value.map((item) => formattedValue(item, key)).filter(Boolean).slice(0, 4);
    return items.join(", ");
  }
  return "";
}

function valuesMatch(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") return left === right;
  const leftText = typeof left === "string" || typeof left === "number" ? String(left).trim() : "";
  const rightText = typeof right === "string" || typeof right === "number" ? String(right).trim() : "";
  return Boolean(leftText && rightText && leftText === rightText);
}

function parseSupport(value: string) {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

type CollectedField = { key: string; label: string; value: unknown };

function collectFields(value: unknown, output: CollectedField[], depth = 0) {
  if (depth > 3 || !isRecord(value)) return;
  for (const [key, fieldValue] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (["raw_data_json", "source_data_json"].includes(normalized)) {
      collectFields(fieldValue, output, depth + 1);
      continue;
    }
    if (INTERNAL_KEY_PATTERN.test(normalized) || INTERNAL_KEY_PATTERN.test(key)) continue;
    if (isRecord(fieldValue)) {
      collectFields(fieldValue, output, depth + 1);
      continue;
    }
    if (Array.isArray(fieldValue) && fieldValue.some((item) => isRecord(item))) continue;
    const display = formattedValue(fieldValue, key);
    if (!display) continue;
    output.push({ key: normalized, label: humanizeKey(key), value: fieldValue });
  }
}

function firstField(fields: CollectedField[], keys: string[]) {
  return fields.find((field) => keys.includes(field.key));
}

function pushUnique(details: ExecutiveEvidenceDetail[], label: string, value: string) {
  if (!label || !value) return;
  const signature = `${label.toLowerCase()}\u0000${value.toLowerCase()}`;
  if (details.some((item) => `${item.label.toLowerCase()}\u0000${item.value.toLowerCase()}` === signature)) return;
  details.push({ label, value });
}

function structuredEvidencePresentation(reference: ExecutiveEvidenceReference, parsed: unknown) {
  const fields: CollectedField[] = [];
  if (Array.isArray(parsed)) {
    parsed.slice(0, 4).forEach((item) => collectFields(item, fields));
  } else {
    collectFields(parsed, fields);
  }

  const metricField = firstField(fields, ["metric_name", "kpi_name", "metric", "name"]);
  const valueField = firstField(fields, ["actual_value", "current_value", "value", "observed_value"]);
  const timeframeField = firstField(fields, ["metric_date", "reporting_period", "period", "timeframe", "date"]);
  const targetField = firstField(fields, ["target", "target_value", "benchmark", "goal"]);
  const comparisonField = firstField(fields, ["variance", "variance_percent", "change", "change_percent", "comparison"]);
  const trendField = firstField(fields, ["trend", "direction", "status"]);
  const countField = firstField(fields, ["evidence_count", "record_count", "count"]);
  const sourceField = firstField(fields, ["vaeroex_original_source", "original_source", "source_name", "file_name", "vaeroex_workbook", "workbook"]);
  const worksheetField = firstField(fields, ["vaeroex_worksheet", "worksheet", "sheet_name"]);
  const rowField = firstField(fields, ["vaeroex_source_row", "source_row", "excel_row", "row_number"]);

  const businessFields = fields.filter((field) => ![
    metricField,
    valueField,
    timeframeField,
    targetField,
    comparisonField,
    trendField,
    countField,
    sourceField,
    worksheetField,
    rowField
  ].includes(field));

  const metricMatch = metricField && /^[-+]?\d+(?:\.\d+)?$/.test(String(metricField.value).trim())
    ? businessFields.find((field) => valuesMatch(field.value, metricField.value))
    : null;
  const valueMatch = valueField ? businessFields.find((field) => valuesMatch(field.value, valueField.value)) : null;
  const details: ExecutiveEvidenceDetail[] = [];
  const provenance: ExecutiveEvidenceDetail[] = [];

  const metricName = metricMatch?.label || formattedValue(metricField?.value) || "";
  if (metricName) pushUnique(details, "Metric", metricName);
  if (metricMatch) pushUnique(details, "Observed value", formattedValue(metricMatch.value, metricMatch.label));
  if (valueField) pushUnique(details, valueMatch?.label || "Observed value", formattedValue(valueField.value, valueMatch?.label || valueField.label));
  if (trendField) pushUnique(details, trendField.label, formattedValue(trendField.value, trendField.label));
  if (targetField) pushUnique(details, "Target", formattedValue(targetField.value, targetField.label));
  if (comparisonField) pushUnique(details, "Comparison", formattedValue(comparisonField.value, comparisonField.label));
  if (timeframeField) pushUnique(details, "Timeframe", formattedValue(timeframeField.value));
  if (countField) pushUnique(details, "Evidence count", formattedValue(countField.value));

  for (const field of businessFields) {
    if (details.length >= 6 || field === metricMatch || field === valueMatch) continue;
    if (/^vaeroex_/.test(field.key)) continue;
    pushUnique(details, field.label, formattedValue(field.value, field.label));
  }

  const sourceName = safeText(formattedValue(sourceField?.value), 140)
    || safeText(reference.title, 140)
    || "Eligible business source";
  if (worksheetField) pushUnique(provenance, "Worksheet", formattedValue(worksheetField.value));
  if (rowField) pushUnique(provenance, "Source row", formattedValue(rowField.value));

  return { sourceName, details, provenance };
}

export function presentExecutiveEvidence(reference: ExecutiveEvidenceReference): ExecutiveEvidencePresentation {
  const parsed = parseSupport(reference.support);
  const structured = parsed === null ? null : structuredEvidencePresentation(reference, parsed);
  const sourceName = structured?.sourceName
    || safeText(reference.title, 140)
    || "Eligible business source";
  const summary = structured
    ? null
    : SERIALIZED_EVIDENCE_PATTERN.test(reference.support)
      ? "Validated source evidence supports this finding."
      : safeText(reference.support) || "Validated source evidence supports this finding.";

  return {
    citationNumber: reference.citationId,
    sourceName,
    sourceType: sourceTypeLabel(reference.sourceType),
    summary,
    details: structured?.details || [],
    provenance: structured?.provenance || []
  };
}

export function dedupeExecutiveEvidence(references: ExecutiveEvidenceReference[]) {
  const seen = new Set<number>();
  return references.filter((reference) => {
    if (seen.has(reference.citationId)) return false;
    seen.add(reference.citationId);
    return true;
  });
}

export function summarizeExecutiveEvidence(references: ExecutiveEvidenceReference[]): ExecutiveEvidenceSummary | null {
  const uniqueReferences = dedupeExecutiveEvidence(references);
  if (!uniqueReferences.length) return null;

  const evidence = uniqueReferences.map(presentExecutiveEvidence);
  const sourceNames = [...new Set(evidence.map((item) => item.sourceName))];
  const metricsOnly = evidence.every((item) => item.sourceType === "Operational metric");
  const evidenceLabel = metricsOnly
    ? `supporting metric${evidence.length === 1 ? "" : "s"}`
    : `supporting evidence record${evidence.length === 1 ? "" : "s"}`;
  const singleSource = evidence[0];
  const sourceDescription = sourceNames.length === 1
    ? /\.(?:xlsx?|xlsm)$/i.test(sourceNames[0]) || /workbook|worksheet/i.test(`${sourceNames[0]} ${singleSource.sourceType}`)
      ? "1 workbook"
      : "1 source"
    : `${sourceNames.length} sources`;

  return {
    citationNumbers: evidence.map((item) => item.citationNumber),
    evidenceCount: evidence.length,
    sourceCount: sourceNames.length,
    text: `${evidence.length} ${evidenceLabel} from ${sourceDescription}.`
  };
}

function numericTokens(value: string) {
  return [...value.matchAll(/[-+]?\d[\d,]*(?:\.\d+)?/g)].map((match) => match[0].replace(/,/g, ""));
}

export function presentExecutiveStatement(statement: string, references: ExecutiveEvidenceReference[]) {
  const evidence = dedupeExecutiveEvidence(references).map(presentExecutiveEvidence);
  const statementNumbers = new Set(numericTokens(statement));
  const matchedMetricNames = evidence.flatMap((item) => {
    const metric = item.details.find((detail) => detail.label === "Metric");
    const observedValue = item.details.find((detail) => detail.label === "Observed value");
    const matched: string[] = [];

    if (metric && observedValue && numericTokens(observedValue.value).some((value) => statementNumbers.has(value))) {
      matched.push(metric.value);
    }
    for (const detail of item.details) {
      if (["Metric", "Observed value", "Timeframe", "Target", "Comparison", "Evidence count"].includes(detail.label)) continue;
      if (numericTokens(detail.value).some((value) => statementNumbers.has(value))) matched.push(detail.label);
    }
    return matched;
  });
  const fallbackMetricNames = evidence.flatMap((item) => (
    item.details.filter((detail) => detail.label === "Metric").map((detail) => detail.value)
  ));
  const metricNames = [...new Set((matchedMetricNames.length ? matchedMetricNames : fallbackMetricNames)
    .filter((value) => value && !/^(?:customer context|operational|another operational) metric$/i.test(value)))];
  if (metricNames.length !== 1) return statement;

  const genericMetricPattern = /\b(?:current\s+)?(?:customer(?:\s+(?:context|engagement))?|another\s+operational|operational)\s+metrics?\b/i;
  const match = statement.match(genericMetricPattern);
  if (!match) return statement;

  const rendered = statement.replace(genericMetricPattern, metricNames[0]);
  if (!/metrics$/i.test(match[0]) || match.index === undefined) return rendered;

  const metricEnd = match.index + metricNames[0].length;
  return `${rendered.slice(0, metricEnd)}${rendered.slice(metricEnd).replace(
    /^\s+(show|reflect|indicate|suggest|demonstrate)\b/i,
    (_, verb: string) => ` ${verb}s`
  )}`;
}

export function distinctExecutiveLines(
  values: Array<string | null | undefined>,
  excludedValues: Array<string | null | undefined> = []
) {
  const excluded = uniqueExecutiveLines(excludedValues);
  return uniqueExecutiveLines(values).filter((value) => !excluded.some((item) => areExecutiveLinesEquivalent(value, item)));
}

export function uniqueExecutiveLines(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const display = safeText(value || "", 360);
    const signature = display.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!display || !signature || seen.has(signature)) return [];
    seen.add(signature);
    return [display];
  });
}
