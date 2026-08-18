import "server-only";

import type { IntelligenceBriefingEvidencePeriod } from "@/lib/ai/intelligence-briefing/contracts";

export type IntelligenceBriefingNumericTokenKind = "plain" | "currency" | "percentage" | "date";

export type IntelligenceBriefingNumericToken = Readonly<{
  key: string;
  display: string;
  kind: IntelligenceBriefingNumericTokenKind;
}>;

const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;
const NUMBER_ATOM = String.raw`(?:\(\s*)?[+-]?\s*(?:[$€£]\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%?\s*\)?`;
const RANGE_PATTERN = new RegExp(`(?<![A-Za-z0-9])(${NUMBER_ATOM})\\s*(?:-|\\u2013|\\u2014|\\bto\\b)\\s*(${NUMBER_ATOM})(?![A-Za-z0-9])`, "gi");
const NUMBER_PATTERN = new RegExp(`(?<![A-Za-z0-9])${NUMBER_ATOM}(?![A-Za-z0-9])`, "g");

function normalizedDecimal(raw: string, negative: boolean) {
  const digits = raw.replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(digits)) return null;
  const [integerPart, fractionPart = ""] = digits.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionPart.replace(/0+$/, "");
  const magnitude = fraction ? `${integer}.${fraction}` : integer;
  return negative && magnitude !== "0" ? `-${magnitude}` : magnitude;
}

function parseNumberAtom(value: string): IntelligenceBriefingNumericToken | null {
  const compact = value.replace(/\s+/g, "").trim();
  const parenthesized = compact.startsWith("(") && compact.endsWith(")");
  const percentage = compact.includes("%");
  const currencySymbol = compact.match(/[$€£]/)?.[0] || null;
  const withoutDecorators = compact.replace(/[()%$€£]/g, "");
  const explicitlyNegative = withoutDecorators.startsWith("-");
  const explicitlyPositive = withoutDecorators.startsWith("+");
  const unsigned = explicitlyNegative || explicitlyPositive ? withoutDecorators.slice(1) : withoutDecorators;
  const decimal = normalizedDecimal(unsigned, parenthesized || explicitlyNegative);
  if (!decimal) return null;
  const kind: IntelligenceBriefingNumericTokenKind = percentage ? "percentage" : currencySymbol ? "currency" : "plain";
  const key = `${kind}:${currencySymbol || ""}:${decimal}`;
  const display = kind === "percentage"
    ? `${decimal}%`
    : kind === "currency"
      ? `${currencySymbol}${decimal}`
      : decimal;
  return { key, display, kind };
}

function withKind(token: IntelligenceBriefingNumericToken, kind: "currency" | "percentage", currencySymbol = "$") {
  const decimal = token.key.split(":").at(-1) || token.display;
  return {
    key: `${kind}:${kind === "currency" ? currencySymbol : ""}:${decimal}`,
    display: kind === "percentage" ? `${decimal}%` : `${currencySymbol}${decimal}`,
    kind
  } satisfies IntelligenceBriefingNumericToken;
}

function commonRangeKind(left: IntelligenceBriefingNumericToken, right: IntelligenceBriefingNumericToken) {
  if (left.kind === "percentage" || right.kind === "percentage") return "percentage" as const;
  if (left.kind === "currency" || right.kind === "currency") return "currency" as const;
  return null;
}

function addToken(target: Map<string, IntelligenceBriefingNumericToken>, token: IntelligenceBriefingNumericToken | null) {
  if (token && !target.has(token.key)) target.set(token.key, token);
}

export function intelligenceBriefingNumericTokens(value: string): readonly IntelligenceBriefingNumericToken[] {
  const tokens = new Map<string, IntelligenceBriefingNumericToken>();
  const masked = value.split("");

  for (const match of value.matchAll(DATE_PATTERN)) {
    const date = match[0];
    addToken(tokens, { key: `date:${date}`, display: date, kind: "date" });
    const start = match.index || 0;
    for (let index = start; index < start + date.length; index += 1) masked[index] = " ";
  }

  const withoutDates = masked.join("");
  for (const match of withoutDates.matchAll(RANGE_PATTERN)) {
    let left = parseNumberAtom(match[1]);
    let right = parseNumberAtom(match[2]);
    const sharedKind = left && right ? commonRangeKind(left, right) : null;
    if (left && right && sharedKind === "percentage") {
      if (left.kind === "plain") left = withKind(left, "percentage");
      if (right.kind === "plain") right = withKind(right, "percentage");
    }
    if (left && right && sharedKind === "currency") {
      const currencySymbol = match[0].match(/[$€£]/)?.[0] || "$";
      if (left.kind === "plain") left = withKind(left, "currency", currencySymbol);
      if (right.kind === "plain") right = withKind(right, "currency", currencySymbol);
    }
    addToken(tokens, left);
    addToken(tokens, right);
    const start = match.index || 0;
    for (let index = start; index < start + match[0].length; index += 1) masked[index] = " ";
  }

  for (const match of masked.join("").matchAll(NUMBER_PATTERN)) addToken(tokens, parseNumberAtom(match[0]));
  return [...tokens.values()];
}

export function intelligenceBriefingPeriodNumericTokens(period: IntelligenceBriefingEvidencePeriod) {
  const dates = [period.start, period.end, period.cutoff.slice(0, 10)].map((date) => ({
    key: `date:${date}`,
    display: date,
    kind: "date" as const
  }));
  const dayCount = parseNumberAtom(String(period.dayCount));
  const tokens = new Map<string, IntelligenceBriefingNumericToken>();
  dates.forEach((token) => addToken(tokens, token));
  addToken(tokens, dayCount);
  return [...tokens.values()];
}

export function intelligenceBriefingAllowedNumericTokenDisplays(value: string) {
  return intelligenceBriefingNumericTokens(value).map((token) => token.display);
}
