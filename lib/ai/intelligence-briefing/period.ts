import type {
  IntelligenceBriefingEvidencePeriod,
  IntelligenceBriefingType
} from "@/lib/ai/intelligence-briefing/contracts";

const DAY_MS = 86_400_000;

function utcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function intelligenceBriefingPeriod(
  briefingType: IntelligenceBriefingType,
  cutoff = new Date()
): IntelligenceBriefingEvidencePeriod {
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Intelligence briefing cutoff must be a valid timestamp.");
  const dayCount = briefingType === "weekly" ? 7 : 30;
  const cutoffIso = cutoff.toISOString();
  const end = utcDate(cutoff);
  const start = utcDate(new Date(Date.parse(`${end}T00:00:00.000Z`) - (dayCount - 1) * DAY_MS));
  return { start, end, cutoff: cutoffIso, dayCount, timeZone: "UTC" };
}

export function dateFallsInBriefingPeriod(value: string | null | undefined, period: IntelligenceBriefingEvidencePeriod) {
  if (!value) return false;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= period.start && date <= period.end;
}

export function briefingPeriodLabel(period: IntelligenceBriefingEvidencePeriod) {
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${formatter.format(new Date(`${period.start}T00:00:00.000Z`))} - ${formatter.format(new Date(`${period.end}T00:00:00.000Z`))}`;
}
