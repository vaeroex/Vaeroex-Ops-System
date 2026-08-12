import type { IntelligenceLayerResult } from "@/lib/intelligence/layer";
import { kpiSemantics, normalizeKpiName, type KpiSettingRow } from "@/lib/kpis/settings";

export type IntelligenceBlockedState = Readonly<{
  code:
    | "insufficient_source_evidence"
    | "kpi_semantics_unconfirmed"
    | "targets_unavailable"
    | "no_evaluable_findings";
  title: string;
  description: string;
  actionLabel: string;
  actionHref: "/app/sources" | "/app/kpis" | "/app/kpis/settings";
}>;

export function buildIntelligenceBlockedState({
  intelligence,
  kpis,
  settings
}: {
  intelligence: IntelligenceLayerResult;
  kpis: Array<{ name: string; target: number | null }>;
  settings: KpiSettingRow[];
}): IntelligenceBlockedState | null {
  if (intelligence.businessHealth.available) return null;

  if (intelligence.businessHealth.unavailableReason === "insufficient_original_evidence") {
    return {
      code: "insufficient_source_evidence",
      title: "Independent source evidence is still limited",
      description: "Business Health needs enough eligible evidence from more than one authoritative source type before it can score the workspace.",
      actionLabel: "Review sources",
      actionHref: "/app/sources"
    };
  }

  const names = [...new Map(kpis.map((row) => [normalizeKpiName(row.name), row.name])).values()];
  const unknownSemantics = names.filter((name) => kpiSemantics(name, settings).desiredDirection === "unknown").length;
  const authoritativeTargets = new Set(kpis
    .filter((row) => row.target !== null)
    .map((row) => normalizeKpiName(row.name))).size;

  if (names.length && unknownSemantics === names.length) {
    return {
      code: "kpi_semantics_unconfirmed",
      title: "KPI performance meaning is not confirmed",
      description: `${names.length} KPI series are available, but none has an authoritative maximize/minimize meaning. Confirm KPI targets and direction before Business Health can classify performance.`,
      actionLabel: "Review KPI meaning",
      actionHref: "/app/kpis/settings"
    };
  }

  if (names.length && authoritativeTargets === 0) {
    return {
      code: "targets_unavailable",
      title: "Authoritative KPI targets are unavailable",
      description: "KPI history is present, but no reviewed target is available and the current movement does not establish an evaluable performance outcome.",
      actionLabel: "Review KPI targets",
      actionHref: "/app/kpis/settings"
    };
  }

  return {
    code: "no_evaluable_findings",
    title: "No evaluable performance finding is available",
    description: "The current eligible evidence does not establish a material target result or a sufficiently supported favorable trend. This is not the same as missing data.",
    actionLabel: "Review KPI history",
    actionHref: "/app/kpis"
  };
}
