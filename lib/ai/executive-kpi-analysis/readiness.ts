import type {
  ExecutiveKpiAnalysisPackage,
  ExecutiveKpiAnalysisReadiness,
  ExecutiveKpiMetricFact
} from "@/lib/ai/executive-kpi-analysis/contracts";

const MINIMUM_SHARED_PERIODS = 2;
const READY_SHARED_PERIODS = 3;
const READY_OBSERVATIONS_PER_KPI = 3;
const READY_CONFIDENCE_SCORE = 70;

function reportingPeriods(metric: ExecutiveKpiMetricFact) {
  return new Set(metric.values.map((value) => value.observedAt.slice(0, 7)));
}

function sharedReportingPeriodCount(metrics: readonly ExecutiveKpiMetricFact[]) {
  if (!metrics.length) return 0;
  const [first, ...rest] = metrics.map(reportingPeriods);
  return Array.from(first).filter((period) => rest.every((periods) => periods.has(period))).length;
}

function readiness(
  code: ExecutiveKpiAnalysisReadiness["code"],
  canGenerate: boolean,
  title: string,
  explanation: string,
  nextSteps: readonly string[]
): ExecutiveKpiAnalysisReadiness {
  return { code, canGenerate, title, explanation, nextSteps };
}

export function evaluateExecutiveKpiAnalysisReadiness(
  analysisPackage: ExecutiveKpiAnalysisPackage
): ExecutiveKpiAnalysisReadiness {
  const metrics = analysisPackage.facts.metrics;

  if (metrics.length > 3) {
    return readiness(
      "COMPARISON_TOO_BROAD",
      false,
      "This comparison is currently too broad for a meaningful executive interpretation.",
      "A smaller group makes it easier to distinguish a useful business pattern from unrelated movement.",
      ["Select two or three closely related KPIs."]
    );
  }

  if (metrics.length < 2 || metrics.some((metric) => metric.observationCount < 2)) {
    return readiness(
      "NEEDS_MORE_HISTORY",
      false,
      "More history is needed.",
      "These KPIs do not yet contain enough shared measurements for a meaningful executive interpretation.",
      ["Select a longer timeframe.", "Continue collecting KPI history.", "Compare again after additional reporting periods."]
    );
  }

  const sharedPeriods = sharedReportingPeriodCount(metrics);
  if (sharedPeriods < MINIMUM_SHARED_PERIODS) {
    return readiness(
      "INSUFFICIENT_DATE_OVERLAP",
      false,
      "These KPIs do not currently share enough reporting periods to compare reliably.",
      "Their available histories cover different periods, so the timing cannot support a dependable combined interpretation.",
      ["Select KPIs with overlapping dates.", "Upload more recent values where needed."]
    );
  }

  const movingMetrics = metrics.filter((metric) => metric.trendDirection === "up" || metric.trendDirection === "down");
  if (movingMetrics.length < 2) {
    return readiness(
      "NO_CLEAR_PATTERN",
      false,
      "Executive Analysis completed.",
      "No meaningful pattern currently stands out across the selected KPIs.",
      ["Continue monitoring these KPIs as additional history becomes available."]
    );
  }

  if (metrics.some((metric) => metric.directionality === "neutral_contextual")) {
    return readiness(
      "MISSING_DIRECTIONALITY",
      false,
      "Vaeroex can describe how these KPIs moved but cannot determine whether every movement is favorable.",
      "At least one selected KPI does not define whether higher or lower values are better.",
      ["Define KPI directionality to strengthen future analysis."]
    );
  }

  const limited = sharedPeriods < READY_SHARED_PERIODS
    || metrics.some((metric) => metric.observationCount < READY_OBSERVATIONS_PER_KPI || metric.freshness !== "current")
    || analysisPackage.facts.confidenceScore < READY_CONFIDENCE_SCORE;
  if (limited) {
    return readiness(
      "LIMITED",
      true,
      "Executive Analysis is available.",
      "This interpretation is based on limited history and should be treated as an early pattern rather than a confirmed business trend.",
      ["Use the analysis as a starting point and continue monitoring the selected KPIs."]
    );
  }

  return readiness(
    "READY",
    true,
    "Executive Analysis is ready.",
    "The selected KPIs have enough shared history and directional context for a bounded executive interpretation.",
    ["Generate Executive Analysis."]
  );
}

export function temporaryExecutiveKpiProviderFailure(): ExecutiveKpiAnalysisReadiness {
  return readiness(
    "TEMPORARY_PROVIDER_FAILURE",
    false,
    "Executive Analysis is temporarily unavailable.",
    "Validated KPI facts remain available below.",
    ["Please try again shortly."]
  );
}
