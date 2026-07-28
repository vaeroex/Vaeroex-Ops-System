import type { Database } from "@/lib/supabase/types";

export const KPI_DESIRED_DIRECTIONS = ["maximize", "minimize", "target_range", "exact_target", "maintain", "unknown"] as const;
export const KPI_TARGET_BEHAVIORS = ["minimum_goal", "maximum_limit", "acceptable_range", "exact_threshold", "stability_goal", "unknown"] as const;
export const KPI_SEMANTIC_VERSION = "kpi_semantics_v1" as const;

export type KpiDesiredDirection = (typeof KPI_DESIRED_DIRECTIONS)[number];
export type KpiTargetBehavior = (typeof KPI_TARGET_BEHAVIORS)[number];
export type KpiSettingRow = Database["public"]["Tables"]["kpi_settings"]["Row"];
export type KpiObservation = { actual_value: number | null; metric_date?: string; created_at?: string };

export type KpiSemantics = {
  canonicalName: string;
  displayName: string;
  originalSourceLabel: string;
  unit: string | null;
  scale: number;
  desiredDirection: KpiDesiredDirection;
  targetBehavior: KpiTargetBehavior;
  idealValue: number | null;
  idealRangeMin: number | null;
  idealRangeMax: number | null;
  metricRole: "actual" | "target" | "benchmark" | "unknown";
  classificationSource: "user" | "deterministic" | "luna" | "migration" | "unknown";
  classificationConfidence: number | null;
  classificationConfirmed: boolean;
  rationale: string | null;
};

const KPI_CLASSIFICATION_SOURCES = ["user", "deterministic", "luna", "migration", "unknown"] as const;

export const KPI_TARGET_BEHAVIOR_BY_DIRECTION: Record<KpiDesiredDirection, KpiTargetBehavior> = {
  maximize: "minimum_goal",
  minimize: "maximum_limit",
  target_range: "acceptable_range",
  exact_target: "exact_threshold",
  maintain: "stability_goal",
  unknown: "unknown"
};

export function targetBehaviorForDirection(direction: KpiDesiredDirection) {
  return KPI_TARGET_BEHAVIOR_BY_DIRECTION[direction];
}

export function validateKpiSemanticSelection({
  desiredDirection,
  targetBehavior,
  idealValue,
  idealRangeMin,
  idealRangeMax
}: {
  desiredDirection: KpiDesiredDirection;
  targetBehavior: KpiTargetBehavior;
  idealValue: number | null;
  idealRangeMin: number | null;
  idealRangeMax: number | null;
}) {
  if (targetBehavior !== targetBehaviorForDirection(desiredDirection)) {
    return { ok: false as const, reason: "Target behavior does not match the selected performance direction." };
  }
  if (desiredDirection === "target_range") {
    if (idealRangeMin === null || idealRangeMax === null) {
      return { ok: false as const, reason: "Target range requires both an acceptable minimum and maximum." };
    }
    if (idealRangeMin > idealRangeMax) {
      return { ok: false as const, reason: "Acceptable minimum cannot exceed the acceptable maximum." };
    }
  }
  if (desiredDirection === "exact_target" && idealValue === null) {
    return { ok: false as const, reason: "Exact target requires an exact desired value." };
  }
  if (desiredDirection === "unknown" && (idealValue !== null || idealRangeMin !== null || idealRangeMax !== null)) {
    return { ok: false as const, reason: "An unresolved KPI direction cannot define a theoretical ideal or acceptable range." };
  }

  return { ok: true as const };
}

export type KpiPerformanceEvaluation = {
  rawMovement: "increased" | "decreased" | "unchanged" | "insufficient_data";
  latestPerformanceEffect: "favorable" | "unfavorable" | "neutral" | "indeterminate";
  selectedRangeTrend: "favorable" | "unfavorable" | "stable" | "mixed" | "insufficient_data" | "indeterminate";
  targetStatus:
    | "achieved"
    | "within_range"
    | "above_acceptable_maximum"
    | "below_required_minimum"
    | "moving_toward_target"
    | "moving_away_from_target"
    | "no_target"
    | "direction_unknown";
  latestValue: number | null;
  previousValue: number | null;
  rangeStartValue: number | null;
  change: number | null;
  changePercent: number | null;
};

export type KpiTargetStatus = KpiPerformanceEvaluation["targetStatus"];

export function isKpiTargetMet(status: KpiTargetStatus) {
  return status === "achieved" || status === "within_range";
}

export function isKpiTargetMiss(status: KpiTargetStatus) {
  return status === "above_acceptable_maximum"
    || status === "below_required_minimum"
    || status === "moving_toward_target"
    || status === "moving_away_from_target";
}

export type KpiTargetRecommendation = {
  value: number | null;
  range: { min: number; max: number } | null;
  confidence: "Higher" | "Medium" | "Low" | "Unavailable";
  reason: string;
  dataUsed: string;
  limitation: string;
  outliers: number;
};

type RecognizedRule = Omit<KpiSemantics, "displayName" | "originalSourceLabel" | "scale" | "classificationConfirmed">;

const RECOGNIZED_RULES: Array<{ pattern: RegExp; rule: RecognizedRule }> = [
  {
    pattern: /^(?:number of )?1[ -]?star reviews?$/,
    rule: {
      canonicalName: "one_star_reviews",
      unit: "count",
      desiredDirection: "minimize",
      targetBehavior: "maximum_limit",
      idealValue: 0,
      idealRangeMin: null,
      idealRangeMax: null,
      metricRole: "actual",
      classificationSource: "deterministic",
      classificationConfidence: 1,
      rationale: "One-star review count is a recognized adverse-outcome metric."
    }
  },
  {
    pattern: /^(?:average|avg) (?:checkout )?wait(?: time)?(?: \(min(?:utes)?\))?$/,
    rule: {
      canonicalName: "average_checkout_wait",
      unit: "minutes",
      desiredDirection: "minimize",
      targetBehavior: "maximum_limit",
      idealValue: null,
      idealRangeMin: null,
      idealRangeMax: null,
      metricRole: "actual",
      classificationSource: "deterministic",
      classificationConfidence: 1,
      rationale: "Average wait duration is a recognized elapsed-time metric where lower is favorable."
    }
  },
  {
    pattern: /^(?:(?:average|avg) )?(?:response|resolution|reply)(?: time)?(?: \((?:hrs?|hours?|min(?:utes)?)\))?$/,
    rule: {
      canonicalName: "average_response_time",
      unit: "duration",
      desiredDirection: "minimize",
      targetBehavior: "maximum_limit",
      idealValue: null,
      idealRangeMin: null,
      idealRangeMax: null,
      metricRole: "actual",
      classificationSource: "deterministic",
      classificationConfidence: 0.98,
      rationale: "Response duration is a recognized elapsed-time metric where lower is favorable."
    }
  },
  {
    pattern: /^(?:conversion|customer conversion)(?: rate)?(?: \(%\))?$/,
    rule: {
      canonicalName: "conversion_rate",
      unit: "percent",
      desiredDirection: "maximize",
      targetBehavior: "minimum_goal",
      idealValue: null,
      idealRangeMin: null,
      idealRangeMax: null,
      metricRole: "actual",
      classificationSource: "deterministic",
      classificationConfidence: 0.98,
      rationale: "Conversion rate is a recognized outcome metric where higher is favorable."
    }
  },
  {
    pattern: /^customer satisfaction(?: score| rate)?(?: \(%\))?$/,
    rule: {
      canonicalName: "customer_satisfaction",
      unit: "percent",
      desiredDirection: "maximize",
      targetBehavior: "minimum_goal",
      idealValue: null,
      idealRangeMin: null,
      idealRangeMax: null,
      metricRole: "actual",
      classificationSource: "deterministic",
      classificationConfidence: 0.98,
      rationale: "Customer satisfaction is a recognized outcome metric where higher is favorable."
    }
  },
  {
    pattern: /^revenue(?: \(\$?m\))?$/,
    rule: {
      canonicalName: "revenue",
      unit: "currency",
      desiredDirection: "maximize",
      targetBehavior: "minimum_goal",
      idealValue: null,
      idealRangeMin: null,
      idealRangeMax: null,
      metricRole: "actual",
      classificationSource: "deterministic",
      classificationConfidence: 1,
      rationale: "Unqualified revenue is a recognized output metric where higher is favorable."
    }
  },
  {
    pattern: /^(?:gross )?margin(?: \(%\))?$/,
    rule: {
      canonicalName: "gross_margin",
      unit: "percent",
      desiredDirection: "maximize",
      targetBehavior: "minimum_goal",
      idealValue: null,
      idealRangeMin: null,
      idealRangeMax: null,
      metricRole: "actual",
      classificationSource: "deterministic",
      classificationConfidence: 0.98,
      rationale: "Gross margin is a recognized performance metric where higher is favorable."
    }
  }
];

function normalizedLabel(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function safeNumber(value: number | null | undefined, fallback: number | null = null) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function labelScale(label: string) {
  if (/\(\s*\$?m\s*\)$/i.test(label)) return 1_000_000;
  if (/\(\s*\$?k\s*\)$/i.test(label)) return 1_000;
  return 1;
}

function legacyDefinitionDirection(definition: string | null | undefined): KpiDesiredDirection {
  const text = (definition || "").toLowerCase();
  const maximize = /\b(higher|more) is better\b|\bincrease is (?:favorable|preferred)\b|\btarget is at least\b|\bminimum target\b/.test(text);
  const minimize = /\b(lower|less|fewer) is better\b|\bdecrease is (?:favorable|preferred)\b|\btarget is (?:under|below|at most)\b|\bmaximum target\b/.test(text);
  const exact = /\bexact target (?:is )?preferred\b|\btarget must be exact\b/.test(text);
  if ([maximize, minimize, exact].filter(Boolean).length !== 1) return "unknown";
  if (maximize) return "maximize";
  if (minimize) return "minimize";
  return "exact_target";
}

export function deterministicKpiSemantics(label: string): KpiSemantics {
  const normalized = normalizedLabel(label);
  const targetRole = /^(?:target|goal|budget|benchmark)\b/.test(normalized);
  const matched = targetRole ? undefined : RECOGNIZED_RULES.find(({ pattern }) => pattern.test(normalized));

  if (matched) {
    return {
      ...matched.rule,
      displayName: label.trim(),
      originalSourceLabel: label.trim(),
      scale: labelScale(label),
      classificationConfirmed: false
    };
  }

  const conservativeCanonical = normalized
    .replace(/\(\s*\$?[mk]\s*\)$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return {
    canonicalName: targetRole ? conservativeCanonical : conservativeCanonical || "unknown_metric",
    displayName: label.trim(),
    originalSourceLabel: label.trim(),
    unit: null,
    scale: labelScale(label),
    desiredDirection: "unknown",
    targetBehavior: "unknown",
    idealValue: null,
    idealRangeMin: null,
    idealRangeMax: null,
    metricRole: targetRole ? "target" : "actual",
    classificationSource: "unknown",
    classificationConfidence: null,
    classificationConfirmed: false,
    rationale: targetRole ? "Target-like labels remain separate from actual KPI measurements." : null
  };
}

export function resolveKpiSemantics(label: string, setting?: KpiSettingRow | null): KpiSemantics {
  const fallback = deterministicKpiSemantics(label);
  if (!setting) return fallback;

  const storedDirection = KPI_DESIRED_DIRECTIONS.includes(setting.desired_direction as KpiDesiredDirection)
    ? (setting.desired_direction as KpiDesiredDirection)
    : "unknown";
  const legacyDirection = storedDirection === "unknown" ? legacyDefinitionDirection(setting.definition) : "unknown";
  const resolvedStoredDirection = storedDirection !== "unknown" ? storedDirection : legacyDirection;
  const hasTrustedStoredClassification = resolvedStoredDirection !== "unknown" && (setting.classification_confirmed || legacyDirection !== "unknown");
  const usesDeterministicFallback = !hasTrustedStoredClassification
    && fallback.desiredDirection !== "unknown"
    && fallback.classificationSource === "deterministic"
    && setting.classification_source !== "luna"
    && setting.classification_source !== "user";
  const storedClassificationSource = KPI_CLASSIFICATION_SOURCES.includes(setting.classification_source as KpiSemantics["classificationSource"])
    ? setting.classification_source as KpiSemantics["classificationSource"]
    : fallback.classificationSource;

  return {
    canonicalName: setting.canonical_name?.trim() || fallback.canonicalName,
    displayName: setting.display_name?.trim() || fallback.displayName,
    originalSourceLabel: setting.original_source_label?.trim() || fallback.originalSourceLabel,
    unit: setting.semantic_unit || fallback.unit,
    scale: safeNumber(setting.semantic_scale, fallback.scale) || 1,
    desiredDirection: hasTrustedStoredClassification ? resolvedStoredDirection : usesDeterministicFallback ? fallback.desiredDirection : "unknown",
    targetBehavior: hasTrustedStoredClassification && setting.target_behavior !== "unknown" && KPI_TARGET_BEHAVIORS.includes(setting.target_behavior as KpiTargetBehavior)
      ? (setting.target_behavior as KpiTargetBehavior)
      : usesDeterministicFallback
        ? fallback.targetBehavior
      : legacyDirection === "maximize"
        ? "minimum_goal"
        : legacyDirection === "minimize"
          ? "maximum_limit"
          : legacyDirection === "exact_target"
            ? "exact_threshold"
            : "unknown",
    idealValue: hasTrustedStoredClassification || usesDeterministicFallback ? safeNumber(setting.ideal_value, fallback.idealValue) : null,
    idealRangeMin: hasTrustedStoredClassification || usesDeterministicFallback ? safeNumber(setting.ideal_range_min, fallback.idealRangeMin) : null,
    idealRangeMax: hasTrustedStoredClassification || usesDeterministicFallback ? safeNumber(setting.ideal_range_max, fallback.idealRangeMax) : null,
    metricRole: setting.metric_role === "target" || setting.metric_role === "benchmark" || setting.metric_role === "unknown"
      ? setting.metric_role
      : fallback.metricRole,
    classificationSource: legacyDirection !== "unknown" && setting.classification_source === "unknown" ? "user" : storedClassificationSource,
    classificationConfidence: safeNumber(setting.classification_confidence, fallback.classificationConfidence),
    classificationConfirmed: setting.classification_confirmed || legacyDirection !== "unknown",
    rationale: legacyDirection !== "unknown" ? "Preserved from an explicit legacy KPI definition." : hasTrustedStoredClassification ? setting.classification_rationale : fallback.rationale
  };
}

function movement(previous: number, current: number) {
  const threshold = Math.max(Math.abs(previous) * 0.02, 0.000001);
  if (Math.abs(current - previous) <= threshold) return "unchanged" as const;
  return current > previous ? "increased" as const : "decreased" as const;
}

function distanceToRange(value: number, min: number, max: number) {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

export function effectiveKpiTarget(semantics: KpiSemantics, target: number | null = null) {
  if (target !== null) return target;
  if (semantics.desiredDirection === "exact_target" || semantics.desiredDirection === "maintain") {
    return semantics.idealValue;
  }
  return null;
}

export function kpiTargetGapRatio({
  value,
  semantics,
  target = null
}: {
  value: number | null;
  semantics: KpiSemantics;
  target?: number | null;
}) {
  if (value === null || semantics.desiredDirection === "unknown") return null;

  if (semantics.desiredDirection === "target_range") {
    if (semantics.idealRangeMin === null || semantics.idealRangeMax === null) return null;
    const reference = value < semantics.idealRangeMin ? semantics.idealRangeMin : value > semantics.idealRangeMax ? semantics.idealRangeMax : null;
    if (reference === null) return 0;
    const gap = Math.abs(value - reference);
    return reference === 0 ? (gap === 0 ? 0 : Number.POSITIVE_INFINITY) : gap / Math.abs(reference);
  }

  const evaluationTarget = effectiveKpiTarget(semantics, target);
  if (evaluationTarget === null) return null;
  const gap = Math.abs(value - evaluationTarget);
  return evaluationTarget === 0 ? (gap === 0 ? 0 : Number.POSITIVE_INFINITY) : gap / Math.abs(evaluationTarget);
}

function effectBetween(previous: number, current: number, semantics: KpiSemantics, target: number | null) {
  const raw = movement(previous, current);
  if (raw === "unchanged") return "neutral" as const;
  if (semantics.desiredDirection === "maximize") return raw === "increased" ? "favorable" as const : "unfavorable" as const;
  if (semantics.desiredDirection === "minimize") return raw === "decreased" ? "favorable" as const : "unfavorable" as const;
  if (semantics.desiredDirection === "target_range" && semantics.idealRangeMin !== null && semantics.idealRangeMax !== null) {
    const priorDistance = distanceToRange(previous, semantics.idealRangeMin, semantics.idealRangeMax);
    const currentDistance = distanceToRange(current, semantics.idealRangeMin, semantics.idealRangeMax);
    if (currentDistance === priorDistance) return "neutral" as const;
    return currentDistance < priorDistance ? "favorable" as const : "unfavorable" as const;
  }
  if (semantics.desiredDirection === "exact_target" && target !== null) {
    const priorDistance = Math.abs(previous - target);
    const currentDistance = Math.abs(current - target);
    if (currentDistance === priorDistance) return "neutral" as const;
    return currentDistance < priorDistance ? "favorable" as const : "unfavorable" as const;
  }
  if (semantics.desiredDirection === "maintain" && target !== null) {
    const priorDistance = Math.abs(previous - target);
    const currentDistance = Math.abs(current - target);
    if (currentDistance === priorDistance) return "neutral" as const;
    return currentDistance < priorDistance ? "favorable" as const : "unfavorable" as const;
  }
  return "indeterminate" as const;
}

export function evaluateKpiPerformance({
  observations,
  semantics,
  target = null
}: {
  observations: KpiObservation[];
  semantics: KpiSemantics;
  target?: number | null;
}): KpiPerformanceEvaluation {
  const evaluationTarget = effectiveKpiTarget(semantics, target);
  const values = observations.map((item) => item.actual_value).filter((value): value is number => value !== null && Number.isFinite(value));
  const latestValue = values.at(-1) ?? null;
  const previousValue = values.at(-2) ?? null;
  const rangeStartValue = values[0] ?? null;
  const rawMovement = latestValue === null || previousValue === null ? "insufficient_data" : movement(previousValue, latestValue);
  const latestPerformanceEffect = latestValue === null || previousValue === null
    ? "indeterminate"
    : effectBetween(previousValue, latestValue, semantics, evaluationTarget);

  let selectedRangeTrend: KpiPerformanceEvaluation["selectedRangeTrend"] = "insufficient_data";
  if (latestValue !== null && rangeStartValue !== null && values.length >= 2) {
    const overall = effectBetween(rangeStartValue, latestValue, semantics, evaluationTarget);
    if (overall === "neutral") {
      const intervalEffects = values.slice(1).map((value, index) => effectBetween(values[index], value, semantics, evaluationTarget));
      const favorable = intervalEffects.filter((value) => value === "favorable").length;
      const unfavorable = intervalEffects.filter((value) => value === "unfavorable").length;
      selectedRangeTrend = favorable && unfavorable ? "mixed" : "stable";
    } else if (overall === "indeterminate") {
      selectedRangeTrend = "indeterminate";
    } else {
      selectedRangeTrend = overall;
    }
  }

  let targetStatus: KpiPerformanceEvaluation["targetStatus"] = "no_target";
  if (semantics.desiredDirection === "unknown") {
    targetStatus = "direction_unknown";
  } else if (latestValue !== null && semantics.desiredDirection === "target_range" && semantics.idealRangeMin !== null && semantics.idealRangeMax !== null) {
    targetStatus = latestValue >= semantics.idealRangeMin && latestValue <= semantics.idealRangeMax
      ? "within_range"
      : latestValue > semantics.idealRangeMax
        ? "above_acceptable_maximum"
        : "below_required_minimum";
  } else if (evaluationTarget !== null && latestValue !== null) {
    if (semantics.desiredDirection === "maximize") targetStatus = latestValue >= evaluationTarget ? "achieved" : "below_required_minimum";
    else if (semantics.desiredDirection === "minimize") targetStatus = latestValue <= evaluationTarget ? "achieved" : "above_acceptable_maximum";
    else if (semantics.desiredDirection === "exact_target" || semantics.desiredDirection === "maintain") {
      const tolerance = Math.max(Math.abs(evaluationTarget) * 0.02, 0.000001);
      targetStatus = Math.abs(latestValue - evaluationTarget) <= tolerance
        ? "achieved"
        : latestPerformanceEffect === "favorable"
          ? "moving_toward_target"
          : "moving_away_from_target";
    }
  }

  return {
    rawMovement,
    latestPerformanceEffect,
    selectedRangeTrend,
    targetStatus,
    latestValue,
    previousValue,
    rangeStartValue,
    change: latestValue !== null && rangeStartValue !== null ? latestValue - rangeStartValue : null,
    changePercent: latestValue !== null && rangeStartValue !== null && rangeStartValue !== 0
      ? ((latestValue - rangeStartValue) / Math.abs(rangeStartValue)) * 100
      : null
  };
}

export function directionLabel(direction: KpiDesiredDirection) {
  if (direction === "maximize") return "Higher is better";
  if (direction === "minimize") return "Lower is better";
  if (direction === "target_range") return "Target range";
  if (direction === "exact_target") return "Exact target";
  if (direction === "maintain") return "Maintain stability";
  return "Direction confirmation needed";
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardDeviation(values: number[]) {
  const mean = average(values);
  if (mean === null || values.length < 2) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export function recommendKpiTarget({
  observations,
  semantics
}: {
  observations: KpiObservation[];
  semantics: KpiSemantics;
}): KpiTargetRecommendation {
  const values = observations.map((item) => item.actual_value).filter((value): value is number => value !== null && Number.isFinite(value));
  if (semantics.desiredDirection === "unknown") {
    return {
      value: null,
      range: null,
      confidence: "Unavailable",
      reason: "Direction confirmation needed before Vaeroex can recommend a target.",
      dataUsed: `${values.length} KPI value${values.length === 1 ? "" : "s"} available`,
      limitation: "A target recommendation would be misleading until the KPI direction is confirmed.",
      outliers: 0
    };
  }
  if (values.length < 3) {
    return {
      value: null,
      range: null,
      confidence: "Unavailable",
      reason: "Not enough history to recommend a reliable target.",
      dataUsed: `${values.length} KPI value${values.length === 1 ? "" : "s"} available`,
      limitation: "Vaeroex needs at least 3 dated values for a conservative suggestion.",
      outliers: 0
    };
  }

  if (semantics.desiredDirection === "target_range") {
    if (semantics.idealRangeMin === null || semantics.idealRangeMax === null) {
      return {
        value: null,
        range: null,
        confidence: "Unavailable",
        reason: "Confirm the acceptable range before Vaeroex recommends a target.",
        dataUsed: `${values.length} KPI values available`,
        limitation: "Target-range KPIs require both a minimum and maximum bound.",
        outliers: 0
      };
    }
    return {
      value: (semantics.idealRangeMin + semantics.idealRangeMax) / 2,
      range: { min: semantics.idealRangeMin, max: semantics.idealRangeMax },
      confidence: "Higher",
      reason: "The recommended operating point is the midpoint of the confirmed acceptable range.",
      dataUsed: `${values.length} KPI values and the confirmed acceptable range`,
      limitation: "This is an operating point inside the accepted range, not a guarantee of business outcomes.",
      outliers: 0
    };
  }

  if (semantics.desiredDirection === "exact_target" && semantics.idealValue !== null) {
    return {
      value: semantics.idealValue,
      range: null,
      confidence: "Higher",
      reason: "The confirmed exact target is the appropriate recommendation for this KPI.",
      dataUsed: `${values.length} KPI values and the confirmed exact target`,
      limitation: "Vaeroex does not replace the confirmed exact target with a trend-derived value.",
      outliers: 0
    };
  }

  const mean = average(values) ?? values.at(-1) ?? 0;
  const deviation = standardDeviation(values);
  const outliers = values.filter((value) => deviation > 0 && Math.abs(value - mean) > deviation * 2).length;
  const cleanValues = outliers && values.length >= 6 ? values.filter((value) => Math.abs(value - mean) <= deviation * 2) : values;
  const recent = cleanValues.slice(-Math.min(3, cleanValues.length));
  const recentAverage = average(recent) ?? cleanValues.at(-1) ?? 0;
  const latest = cleanValues.at(-1) ?? recentAverage;
  const conservativeStep = Math.max(Math.abs(recentAverage) * 0.02, deviation * 0.1);
  let suggested: number | null = null;

  if (semantics.desiredDirection === "maximize") suggested = Math.max(latest, recentAverage + conservativeStep);
  if (semantics.desiredDirection === "minimize") suggested = Math.min(latest, recentAverage - conservativeStep);
  if (semantics.desiredDirection === "maintain") suggested = semantics.idealValue ?? recentAverage;
  if (suggested === null) {
    return {
      value: null,
      range: null,
      confidence: "Unavailable",
      reason: "The current semantic configuration does not support a directional recommendation.",
      dataUsed: `${values.length} KPI values available`,
      limitation: "Confirm a target behavior before using a recommendation.",
      outliers
    };
  }

  if (semantics.idealValue !== null) {
    suggested = semantics.desiredDirection === "minimize"
      ? Math.max(semantics.idealValue, suggested)
      : semantics.desiredDirection === "maximize"
        ? Math.min(semantics.idealValue, suggested)
        : suggested;
  }
  suggested = Math.max(0, suggested);
  const rounded = Math.abs(suggested) >= 1000 ? Math.round(suggested / 100) * 100 : Math.round(suggested * 100) / 100;
  const confidence = values.length >= 12 ? "Higher" : values.length >= 6 ? "Medium" : "Low";

  return {
    value: rounded,
    range: null,
    confidence,
    reason: semantics.desiredDirection === "minimize"
      ? "The recommendation is a conservative reduction from recent performance because lower is better."
      : semantics.desiredDirection === "maximize"
        ? "The recommendation is a conservative increase from recent performance because higher is better."
        : "The recommendation preserves the confirmed stability objective.",
    dataUsed: `${values.length} KPI values`,
    limitation: "This uses workspace history rather than an industry benchmark and never overwrites a manual target.",
    outliers
  };
}

export function potentialKpiDuplicateGroups(labels: string[], settings: KpiSettingRow[]) {
  const groups = new Map<string, Array<{ label: string; semantics: KpiSemantics }>>();
  for (const label of Array.from(new Set(labels))) {
    const setting = settings.find((item) => item.kpi_name.trim().toLowerCase() === label.trim().toLowerCase());
    const semantics = resolveKpiSemantics(label, setting);
    const key = `${semantics.canonicalName}|${semantics.unit || "unknown"}|${semantics.metricRole}`;
    groups.set(key, [...(groups.get(key) || []), { label, semantics }]);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      labels: group.map((item) => item.label),
      canonicalName: group[0].semantics.canonicalName,
      requiresScaleReview: new Set(group.map((item) => item.semantics.scale)).size > 1
    }));
}
