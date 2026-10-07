import type { Database } from "@/lib/supabase/types";
import { normalizeKpiName } from "@/lib/intelligence/kpi-identity";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];

function sourceRowHasReviewText(value: KpiRow["raw_data_json"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).some(([key, entry]) =>
    /^(?:review[ _-]?(?:text|body|comment)|customer[ _-]?(?:review|comment)|feedback[ _-]?(?:text|comment))$/i.test(key.trim())
    && typeof entry === "string"
    && entry.trim().length > 0
  );
}

function isStale(metricDate: string, asOf?: Date | string) {
  if (!asOf) return false;
  const observed = Date.parse(metricDate);
  const now = new Date(asOf).getTime();
  return Number.isFinite(observed) && Number.isFinite(now) && now - observed > 45 * 86_400_000;
}

export function kpiRiskInvestigation(kpi: KpiRow, asOf?: Date | string) {
  const name = normalizeKpiName(kpi.name);
  const stale = isStale(kpi.metric_date, asOf);

  if (/^(?:number of )?1[ -]?star reviews?$/.test(name)) {
    const reviewTextAvailable = sourceRowHasReviewText(kpi.raw_data_json);
    return {
      action: `${stale ? "Refresh the review KPI and source records now; then " : "Now "}examine the underlying reviews for the affected periods, group recurring complaint themes, and assign an owner to follow up on each verified theme. ${reviewTextAvailable ? "This KPI source row includes review text; inspect the full review-level records." : "No review text accompanies this KPI record; obtain review text, dates, and identifiers from the source."} Confirm how the KPI counts reviews before treating its value as unique reviews.`,
      missingEvidence: [
        ...(reviewTextAvailable ? [] : ["Review-level text, dates, and identifiers"]),
        "Verified KPI definition and whether the value counts unique reviews",
        "Documented owner and outcome of complaint follow-up"
      ]
    };
  }

  if (/^receiving delay(?: \((?:hrs?|hours?)\))?$/.test(name)) {
    return {
      action: `${stale ? "Refresh the receiving-delay KPI and source records now; then " : "Now "}inspect receiving transactions for the affected periods. Compare arrival and completion timestamps by supplier, site, and shift where recorded; obtain missing transaction detail from the receiving system. Assign an operations owner to investigate the largest verified delays and record findings or unknowns. Link order or customer exceptions only after matching period, site, and source records.`,
      missingEvidence: ["Receiving transaction timestamps and supplier, site, or shift details", "Verified cause of the delay"]
    };
  }

  return {
    action: `${stale ? "Refresh this KPI and its source records before a current operating decision. Then " : "Now "}inspect the underlying ${kpi.name} records for the affected reporting periods, compare the measured gap with the configured target, and assign an owner to verify what changed. Record any explanation only after checking the source records.`,
    missingEvidence: ["Source records explaining the measured change", "Documented investigation owner and outcome"]
  };
}
