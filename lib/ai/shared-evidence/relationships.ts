import type { Dependency, Observation } from "./contracts";

const scale = BigInt(10) ** BigInt(24);
function amount(text: string): bigint {
  if (!/^-?\d{1,15}(?:\.\d{1,24})?$/.test(text)) throw new Error("invalid_decimal");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  return (BigInt(whole) * scale + BigInt(fraction.padEnd(24, "0"))) * (text.startsWith("-") ? BigInt(-1) : BigInt(1));
}
function fixed(value: bigint, denominator = scale, precision = 2): string {
  const sign = value < BigInt(0) ? "-" : "", absolute = value < BigInt(0) ? -value : value;
  const factor = BigInt(10) ** BigInt(precision);
  const rounded = (absolute * factor + denominator / BigInt(2)) / denominator;
  return `${rounded ? sign : ""}${rounded / factor}.${String(rounded % factor).padStart(precision, "0")}`;
}
export function uniqueDependencies(rows: readonly { dependencies: readonly Dependency[] }[]): Dependency[] {
  const sources = new Map<string, Dependency>();
  const versions = new Map<string, string | null>();
  for (const row of rows) for (const dependency of row.dependencies) {
    const identity = JSON.stringify([dependency.workspaceId, dependency.provider, dependency.connectionId, dependency.sourceId]);
    if (versions.has(identity) && versions.get(identity) !== dependency.version) throw new Error("ambiguous_source_versions");
    versions.set(identity, dependency.version);
    const previous = sources.get(dependency.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(dependency)) throw new Error("conflicting_dependency");
    sources.set(dependency.id, dependency);
  }
  return [...sources.values()];
}
function comparable(rows: readonly Observation[]) {
  const first = rows[0];
  if (!first || rows.some(row => !row.entityId || row.entityBinding !== "protected" || !row.scopeVerified
    || row.lifecycle !== "active" || row.coverage !== "complete" || row.temporalKind !== "period"
    || row.workspaceId !== first.workspaceId || row.entityId !== first.entityId || row.scopeKey !== first.scopeKey
    || row.start !== first.start || row.end !== first.end || row.timeZone !== first.timeZone
    || !row.dependencies.length || row.dependencies.some(source => !source.version || source.workspaceId !== row.workspaceId
      || source.connectionId !== row.connectionId))) throw new Error("incompatible_or_unverified_scope");
}

export type Relationship = Readonly<{ id: string; kind: "waste_share" | "payment_per_tracked_hour"; value: string;
  unit: string; statement: string; inputIds: readonly string[]; dependencies: readonly Dependency[]; stage: "unadmitted" }>;
/** Closed recipes: no arbitrary multiplication, causal inference, or financial addition. */
export function relationship(kind: Relationship["kind"], numerator: Observation, denominator: Observation): Relationship {
  comparable([numerator, denominator]);
  let unit: string, label: string, multiplier = BigInt(1);
  if (kind === "waste_share") {
    if (numerator.provider !== "google_sheets" || denominator.provider !== "file" || numerator.metric !== "waste_kg"
      || denominator.metric !== "purchased_kg" || numerator.unit !== "kg" || denominator.unit !== "kg"
      || numerator.currency !== null || denominator.currency !== null) throw new Error("unsupported_recipe_inputs");
    unit = "percent"; label = "Recorded waste as a share of recorded purchases"; multiplier = BigInt(100);
  } else {
    if (numerator.provider !== "square" || numerator.metric !== "completed_payment_total" || numerator.unit !== "currency"
      || !numerator.currency || !["harvest", "clockify"].includes(denominator.provider) || denominator.metric !== "hours"
      || denominator.unit !== "hours" || denominator.currency !== null) throw new Error("unsupported_recipe_inputs");
    unit = `${numerator.currency}/tracked hour`; label = "Completed payment amount per recorded tracked hour (not revenue or payroll productivity)";
  }
  const top = amount(numerator.value), bottom = amount(denominator.value);
  if (top < BigInt(0) || bottom <= BigInt(0)) throw new Error("invalid_ratio_inputs");
  const value = fixed(top * multiplier, bottom);
  return { id: JSON.stringify([kind, numerator.id, denominator.id]), kind, value, unit,
    statement: `${label}: ${value} ${unit}, ${numerator.start} through ${numerator.end}. This comparison does not establish causation.`,
    inputIds: [numerator.id, denominator.id], dependencies: uniqueDependencies([numerator, denominator]), stage: "unadmitted" };
}

/** Only complete, same-scope Square payment records may be added. Never add QBO, order or invoice evidence. */
export function aggregateSquarePayments(rows: readonly Observation[]): Observation {
  comparable(rows);
  const first = rows[0], unique = new Map<string, Observation>();
  for (const row of rows) {
    if (row.provider !== "square" || row.metric !== "completed_payment_amount" || row.unit !== "currency"
      || !row.currency || row.currency !== first.currency || row.connectionId !== first.connectionId || row.basis !== first.basis) throw new Error("incompatible_payments");
    const previous = unique.get(row.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error("conflicting_observation");
    unique.set(row.id, row);
  }
  const records = [...unique.values()];
  return { ...first, id: JSON.stringify(["payment_total", records.map(row => row.id).sort()]), metric: "completed_payment_total",
    value: fixed(records.reduce((sum, row) => sum + amount(row.value), BigInt(0)), scale, 6), dependencies: uniqueDependencies(records) };
}

export type EvidenceGroup = Readonly<{ id: string; observations: readonly Observation[]; relationships: readonly Relationship[];
  contexts: readonly { id: string; workspaceId: string; text: string; dependencies: readonly Dependency[]; kind: "approved_note";
    status: "approved"; lifecycle: "active" }[] }>;
/** Whole groups survive or are omitted. No model call, query, or live authority is performed here. */
export function selectEvidenceGroups(workspaceId: string, groups: readonly EvidenceGroup[], maxSources = 24, maxChars = 24_000) {
  if (!Number.isSafeInteger(maxSources) || !Number.isSafeInteger(maxChars) || maxSources < 0 || maxChars < 0) throw new Error("invalid_budget");
  const selected: EvidenceGroup[] = [], omitted: string[] = [];
  for (const group of groups) {
    if (group.observations.some(row => row.workspaceId !== workspaceId)
      || group.contexts.some(row => row.workspaceId !== workspaceId)) throw new Error("workspace_mismatch");
    if (group.contexts.some(row => row.status !== "approved" || row.lifecycle !== "active"
      || !row.dependencies.length || row.dependencies.some(source => !source.version || source.workspaceId !== workspaceId))) throw new Error("unverified_note");
    const observations = new Map(group.observations.map(row => [row.id, row]));
    if (observations.size !== group.observations.length) throw new Error("duplicate_observation");
    for (const signal of group.relationships) {
      if (signal.inputIds.some(id => !observations.has(id))) throw new Error("missing_relationship_input");
      const required = uniqueDependencies(signal.inputIds.map(id => observations.get(id)!)).map(row => row.id).sort();
      if (JSON.stringify(required) !== JSON.stringify(signal.dependencies.map(row => row.id).sort())) throw new Error("missing_relationship_citation");
    }
    const proposed = [...selected, group];
    const dependencies = uniqueDependencies(proposed.flatMap(row => [...row.observations, ...row.relationships, ...row.contexts]));
    if (dependencies.length > maxSources || JSON.stringify(proposed).length > maxChars) { omitted.push(group.id); continue; }
    selected.push(group);
  }
  return { stage: "unadmitted" as const, groups: selected, omitted,
    limitations: omitted.length ? ["Whole evidence groups were omitted to preserve the request budget; this is not an exhaustive audit."] : [] };
}
