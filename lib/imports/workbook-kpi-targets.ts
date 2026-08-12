export const WORKBOOK_KPI_TARGET_DIRECTIONS = ["maximize", "minimize"] as const;

export type WorkbookKpiTargetDirection = (typeof WORKBOOK_KPI_TARGET_DIRECTIONS)[number];

export type WorkbookKpiTargetInput = Readonly<{
  importRowId: string;
  domain: string;
  kpiName: string;
  target: number;
  unit: string;
  direction: WorkbookKpiTargetDirection;
}>;

export type WorkbookMetricInput = Readonly<{
  worksheetName: string;
  metricColumn: string;
}>;

export type WorkbookKpiTargetBinding = Readonly<{
  importRowId: string;
  worksheetName: string;
  metricColumn: string;
  storageName: string;
  displayName: string;
  canonicalName: string;
  category: string;
  target: number;
  sourceUnit: string;
  semanticUnit: string;
  semanticScale: number;
  displayUnit: string;
  valueFormat: "currency" | "percentage" | "duration" | "count" | "decimal";
  direction: WorkbookKpiTargetDirection;
  targetBehavior: "minimum_goal" | "maximum_limit";
}>;

export type WorkbookKpiTargetRegistry = Readonly<{
  bindings: readonly WorkbookKpiTargetBinding[];
  errors: readonly string[];
  targetRowIds: readonly string[];
  hasTargetContract: boolean;
}>;

function normalized(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\//g, " per ")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9<>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWorkbookDomain(value: string) {
  return normalized(value).replace(/\band\b/g, "").replace(/\s+/g, " ").trim();
}

export function normalizeWorkbookKpiLabel(value: string) {
  return normalized(value)
    .replace(/^average\s+/, "")
    .replace(/^avg\s+/, "")
    .replace(/\s+(?:time)$/, "")
    .replace(/\s+(?:000|m)$/, "")
    .replace(/\s+(?:hrs?|hours?|min|mins|minutes?|days?)$/, "")
    .replace(/\s+(?:percent|percentage)$/, "")
    .replace(/\s+(?:usd|dollars?)$/, "")
    .replace(/\s+per\s+(?:5|7|10)$/, "")
    .replace(/\s+(?:x|score|count|units?)$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string) {
  return normalized(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown_metric";
}

function unitSemantics(unit: string) {
  const normalizedUnit = normalized(unit);
  if (["%", "percent", "percentage"].includes(unit.trim().toLowerCase()) || normalizedUnit === "percent" || normalizedUnit === "percentage") {
    return { semanticUnit: "percent", semanticScale: 1, displayUnit: "%", valueFormat: "percentage" as const };
  }
  if (/^\$\s*000$/.test(unit.trim()) || ["$000", "usd 000", "currency 000"].includes(normalizedUnit)) {
    return { semanticUnit: "currency", semanticScale: 1_000, displayUnit: "$000", valueFormat: "currency" as const };
  }
  if (unit.trim().startsWith("$") || ["$", "usd", "currency", "dollars", "dollar"].includes(unit.trim().toLowerCase()) || normalizedUnit === "usd") {
    return { semanticUnit: "currency", semanticScale: 1, displayUnit: "$", valueFormat: "currency" as const };
  }
  if (["hours", "hour", "hrs", "hr", "minutes", "minute", "mins", "min", "days", "day"].includes(normalizedUnit)) {
    return { semanticUnit: normalizedUnit, semanticScale: 1, displayUnit: unit.trim(), valueFormat: "duration" as const };
  }
  if (["count", "units", "unit"].includes(normalizedUnit)) {
    return { semanticUnit: "count", semanticScale: 1, displayUnit: unit.trim(), valueFormat: "count" as const };
  }
  return { semanticUnit: normalizedUnit || "number", semanticScale: 1, displayUnit: unit.trim(), valueFormat: "decimal" as const };
}

export function parseWorkbookKpiTargetDirection(value: unknown): WorkbookKpiTargetDirection | null {
  const candidate = String(value ?? "").trim().toLowerCase();
  return WORKBOOK_KPI_TARGET_DIRECTIONS.includes(candidate as WorkbookKpiTargetDirection)
    ? candidate as WorkbookKpiTargetDirection
    : null;
}

export function buildWorkbookKpiTargetRegistry({
  targets,
  metrics,
  hasTargetContract = targets.length > 0
}: {
  targets: readonly WorkbookKpiTargetInput[];
  metrics: readonly WorkbookMetricInput[];
  hasTargetContract?: boolean;
}): WorkbookKpiTargetRegistry {
  if (!hasTargetContract) {
    return { bindings: [], errors: [], targetRowIds: [], hasTargetContract: false };
  }

  const errors: string[] = [];
  const targetKeys = new Set<string>();
  const targetsByKey = new Map<string, WorkbookKpiTargetInput>();

  for (const target of targets) {
    const domain = normalizeWorkbookDomain(target.domain);
    const label = normalizeWorkbookKpiLabel(target.kpiName);
    const key = `${domain}::${label}`;
    if (!domain || !label) {
      errors.push(`Target row ${target.importRowId} must include an exact domain and KPI name.`);
      continue;
    }
    if (!Number.isFinite(target.target)) {
      errors.push(`Target row ${target.importRowId} must include a finite target value.`);
      continue;
    }
    if (targetKeys.has(key)) {
      errors.push(`Target row ${target.importRowId} duplicates ${target.domain} / ${target.kpiName}.`);
      continue;
    }
    targetKeys.add(key);
    targetsByKey.set(key, target);
  }

  const metricsByKey = new Map<string, WorkbookMetricInput[]>();
  for (const metric of metrics) {
    const key = `${normalizeWorkbookDomain(metric.worksheetName)}::${normalizeWorkbookKpiLabel(metric.metricColumn)}`;
    metricsByKey.set(key, [...(metricsByKey.get(key) || []), metric]);
  }

  const duplicateLabels = new Set<string>();
  const domainsByLabel = new Map<string, Set<string>>();
  for (const target of targetsByKey.values()) {
    const label = normalizeWorkbookKpiLabel(target.kpiName);
    const domains = domainsByLabel.get(label) || new Set<string>();
    domains.add(normalizeWorkbookDomain(target.domain));
    domainsByLabel.set(label, domains);
  }
  for (const [label, domains] of domainsByLabel) {
    if (domains.size > 1) duplicateLabels.add(label);
  }

  const bindings: WorkbookKpiTargetBinding[] = [];
  for (const [key, target] of targetsByKey) {
    const matches = metricsByKey.get(key) || [];
    if (matches.length !== 1) {
      errors.push(matches.length
        ? `Target ${target.domain} / ${target.kpiName} matches more than one metric column.`
        : `Target ${target.domain} / ${target.kpiName} does not match a metric column in that worksheet.`);
      continue;
    }

    const metric = matches[0];
    const label = normalizeWorkbookKpiLabel(target.kpiName);
    const duplicatedAcrossDomains = duplicateLabels.has(label);
    const storageName = duplicatedAcrossDomains ? `${target.domain} · ${target.kpiName}` : target.kpiName;
    const displayName = duplicatedAcrossDomains ? `${target.kpiName} (${target.domain})` : target.kpiName;
    const semantics = unitSemantics(target.unit);
    bindings.push({
      importRowId: target.importRowId,
      worksheetName: metric.worksheetName,
      metricColumn: metric.metricColumn,
      storageName,
      displayName,
      canonicalName: slug(storageName),
      category: target.domain,
      target: target.target,
      sourceUnit: target.unit,
      semanticUnit: semantics.semanticUnit,
      semanticScale: semantics.semanticScale,
      displayUnit: semantics.displayUnit,
      valueFormat: semantics.valueFormat,
      direction: target.direction,
      targetBehavior: target.direction === "maximize" ? "minimum_goal" : "maximum_limit"
    });
  }

  return {
    bindings,
    errors,
    targetRowIds: targets.map((target) => target.importRowId),
    hasTargetContract: true
  };
}

export function workbookKpiTargetBindingForMetric(
  registry: WorkbookKpiTargetRegistry,
  worksheetName: string,
  metricColumn: string
) {
  const domain = normalizeWorkbookDomain(worksheetName);
  const label = normalizeWorkbookKpiLabel(metricColumn);
  return registry.bindings.find((binding) =>
    normalizeWorkbookDomain(binding.worksheetName) === domain
    && normalizeWorkbookKpiLabel(binding.metricColumn) === label
  ) || null;
}
