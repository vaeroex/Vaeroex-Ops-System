import type { IntelligenceEvidenceRecord, IntelligenceInsight } from "@/lib/intelligence/layer";
import { evidenceScopeForFinding } from "@/lib/intelligence/business-signal-evidence";

export const collapsedEvidenceGroupLimit = 5;
export const collapsedEvidenceRepresentativeLimit = 5;
export const representativesPerEvidenceGroup = 2;

export type IntelligenceEvidenceGroup = {
  key: string;
  title: string;
  explanation: string;
  records: IntelligenceEvidenceRecord[];
  firstObserved: string;
  lastObserved: string;
};

export type EvidenceActivityPoint = {
  key: string;
  label: string;
  count: number;
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function safeDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function recordTimestamp(record: IntelligenceEvidenceRecord) {
  return safeDate(record.date)?.getTime() || 0;
}

function evidenceGroupKey(record: IntelligenceEvidenceRecord) {
  return normalize(`${record.recordType}:${record.groupHint || record.recordType || "Supporting evidence"}`) || "supporting evidence";
}

function evidenceGroupTitle(record: IntelligenceEvidenceRecord) {
  const hint = (record.groupHint || record.recordType || "Supporting evidence").trim();
  const normalizedHint = normalize(hint);
  const normalizedType = normalize(record.recordType);

  if (normalizedHint === normalizedType) return hint;
  if (normalizedType.includes("signal")) return `${hint} signals`;
  if (normalizedType.includes("kpi") || normalizedType.includes("metric")) return `${hint} measurements`;
  return `${hint} evidence`;
}

function representativeSignature(record: IntelligenceEvidenceRecord) {
  return normalize(`${record.title}|${record.value}`);
}

function sourceSignature(record: IntelligenceEvidenceRecord) {
  return normalize(record.sourceKey || record.id);
}

function uniqueRecords(records: IntelligenceEvidenceRecord[]) {
  const seenIds = new Set<string>();

  return records.filter((record) => {
    if (seenIds.has(record.id)) return false;
    seenIds.add(record.id);
    return true;
  });
}

export function buildEvidenceGroups(records: IntelligenceEvidenceRecord[]): IntelligenceEvidenceGroup[] {
  const groups = new Map<string, IntelligenceEvidenceRecord[]>();

  for (const record of uniqueRecords(records)) {
    const key = evidenceGroupKey(record);
    groups.set(key, [...(groups.get(key) || []), record]);
  }

  return Array.from(groups.entries())
    .map(([key, groupRecords]) => {
      const recordsByDate = [...groupRecords].sort((a, b) => recordTimestamp(b) - recordTimestamp(a) || a.id.localeCompare(b.id));
      const datedRecords = recordsByDate.filter((record) => safeDate(record.date));
      const representative = recordsByDate[0];

      return {
        key,
        title: evidenceGroupTitle(representative),
        explanation: representative.support,
        records: recordsByDate,
        firstObserved: datedRecords.at(-1)?.date || "",
        lastObserved: datedRecords[0]?.date || ""
      };
    })
    .sort((a, b) => b.records.length - a.records.length || recordTimestamp(b.records[0]) - recordTimestamp(a.records[0]) || a.title.localeCompare(b.title));
}

export function selectCollapsedRepresentatives(
  groups: IntelligenceEvidenceGroup[],
  totalLimit = collapsedEvidenceRepresentativeLimit,
  perGroupLimit = representativesPerEvidenceGroup
) {
  const selected: Record<string, IntelligenceEvidenceRecord[]> = {};
  const seenContent = new Set<string>();
  const seenSources = new Set<string>();
  let remaining = totalLimit;

  for (const group of groups) {
    if (remaining <= 0) break;
    const groupRecords: IntelligenceEvidenceRecord[] = [];

    const qualityRank = { Original: 3, Manual: 2, Derived: 1 };
    const candidateRecords = [...group.records].sort(
      (a, b) => qualityRank[b.classification] - qualityRank[a.classification] || recordTimestamp(b) - recordTimestamp(a) || a.id.localeCompare(b.id)
    );

    for (const record of candidateRecords) {
      if (groupRecords.length >= perGroupLimit || remaining <= 0) break;
      const contentKey = representativeSignature(record);
      const sourceKey = sourceSignature(record);
      if (seenContent.has(contentKey) || seenSources.has(sourceKey)) continue;

      seenContent.add(contentKey);
      seenSources.add(sourceKey);
      groupRecords.push(record);
      remaining -= 1;
    }

    if (groupRecords.length) selected[group.key] = groupRecords;
  }

  return selected;
}

export function buildEvidenceActivity(records: IntelligenceEvidenceRecord[], monthLimit = 6): EvidenceActivityPoint[] {
  const counts = new Map<string, number>();

  for (const record of uniqueRecords(records)) {
    const date = safeDate(record.date);
    if (!date) continue;
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-monthLimit)
    .map(([key, count]) => {
      const [year, month] = key.split("-").map(Number);
      return {
        key,
        count,
        label: new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)))
      };
    });
}

function appendFindingContext(href: string, insight: IntelligenceInsight) {
  const url = new URL(href, "https://vaeroex.local");
  url.searchParams.set("finding", insight.id);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function supportingEvidenceHref(insight: IntelligenceInsight) {
  const records = uniqueRecords(insight.supportingRecords);
  const signalIds = records
    .filter((record) => record.recordType === "Business Signal" && record.id.startsWith("signal:"))
    .map((record) => record.id.slice("signal:".length));

  if (signalIds.length === records.length && signalIds.length) {
    const params = new URLSearchParams({
      view: "active",
      finding: insight.id
    });
    const encodedIds = signalIds.join(",");
    const scope = evidenceScopeForFinding(insight.id);
    if (encodedIds.length <= 3000) params.set("evidence_ids", encodedIds);
    else if (scope) params.set("evidence_scope", scope);
    return `/app/tasks?${params.toString()}`;
  }

  const recordTypes = new Set(records.map((record) => record.recordType));
  const recordTitles = new Set(records.map((record) => normalize(record.title)));
  if (records.length === 1 || (recordTypes.size === 1 && recordTitles.size === 1)) {
    return appendFindingContext(records[0].href, insight);
  }

  return appendFindingContext(insight.sourceHref || records[0]?.href || "/app/intelligence", insight);
}
