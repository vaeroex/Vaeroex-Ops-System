import type { EvidenceGroup } from "./relationships";
import { uniqueDependencies } from "./relationships";

/** Consumer drafts intentionally cannot be passed directly as VsiEvidence or
 * EvidenceCandidate: admission/owner audience and immutable citations must be
 * implemented against reviewed deployed contracts first. */
export function projectSharedEvidence(groups: readonly EvidenceGroup[], consumer: "vsi" | "briefing") {
  const unique = new Map<string, EvidenceGroup["observations"][number]>();
  for (const row of groups.flatMap(group => group.observations)) {
    if (unique.has(row.id) && JSON.stringify(unique.get(row.id)) !== JSON.stringify(row)) throw new Error("conflicting_observation");
    unique.set(row.id, row);
  }
  const records = [...unique.values()].map(row => ({ id: row.id, provider: row.provider,
    workspaceId: row.workspaceId, connectionId: row.connectionId, entityId: row.entityId, entityBinding: row.entityBinding,
    scopeKey: row.scopeKey, scopeVerified: row.scopeVerified, observedAt: row.observedAt, lifecycle: row.lifecycle,
    qualifications: row.qualifications, metric: row.metric, value: row.value, unit: row.unit, currency: row.currency, partition: row.partition,
    period: { start: row.start, end: row.end, timeZone: row.timeZone, kind: row.temporalKind },
    basis: row.basis, coverage: row.coverage, dependencyIds: row.dependencies.map(source => source.id) }));
  const signals = groups.flatMap(group => group.relationships.map(signal => ({
    id: signal.id, fact: signal.statement, value: signal.value, unit: signal.unit,
    inputIds: signal.inputIds, dependencyIds: signal.dependencies.map(source => source.id)
  })));
  const reportedContext = groups.flatMap(group => group.contexts.map(note => ({ id: note.id,
    attribution: "The business reported", text: note.text, limitation: "Reported context; not independently measured and does not establish causation.",
    dependencyIds: note.dependencies.map(source => source.id) })));
  return { stage: "unadmitted" as const, consumer, records, signals, reportedContext,
    dependencies: uniqueDependencies(groups.flatMap(group => [...group.observations, ...group.relationships, ...group.contexts])) };
}
