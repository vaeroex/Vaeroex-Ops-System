import "server-only";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { ActiveContributionSchema, DETERMINISTIC_CALCULATION_POLICY_VERSION, DETERMINISTIC_CONTRACT_VERSIONS,
  type ActiveContribution, type ContributionMutation, type DeterministicStateSnapshot } from "@/lib/integrations/deterministic/contracts";
import { createDependencyRegistry } from "@/lib/integrations/deterministic/registry";
import { runDeterministicIncremental } from "@/lib/integrations/deterministic/engine";
import { assertSquareInterpretation, squareInterpretationId, type SquareInterpretation } from "./canonical-interpretation";

/** Private descriptive namespace. Never register this graph with Business Health
 * or persist these count controls as economic contribution events. */
export const SQUARE_DESCRIPTIVE_REGISTRY = createDependencyRegistry({
  contractVersion: DETERMINISTIC_CONTRACT_VERSIONS.dependencyRegistry,
  registryVersion: "square_descriptive_observations_v1",
  calculationPolicyVersion: DETERMINISTIC_CALCULATION_POLICY_VERSION,
  aggregates: ["payment", "refund", "order", "catalog", "inventory"].map(kind => ({
    nodeKind: "aggregate" as const, nodeKey: `square_observed_${kind}_count`,
    contribution: { contributionFamilyKeys: [`square_observed_${kind}`], contributionFamilyKinds: ["non_additive_control" as const],
      measureKeys: ["observation_count"], aggregateKeys: ["square_descriptive_only"] },
    reducer: "targeted_set_recompute" as const, correctionStrategy: "set_recompute" as const, periodGranularity: "all_time" as const,
    groupByDimensions: ["status", "location"], allowedAccountingBases: ["not_applicable" as const], currencyMode: "forbidden" as const,
    calculationVersion: "square_descriptive_count_v1", freshnessDependencyKeys: ["square_checked_authority"]
  })), kpis: [], downstream: []
});

export function squareDescriptiveControl(item: SquareInterpretation): ActiveContribution {
  assertSquareInterpretation(item);
  return ActiveContributionSchema.parse({
    id: squareInterpretationId({ resource: item.resourceKey, purpose: "descriptive_control" }),
    eventFingerprint: item.fact.factFingerprint, sourceFactFingerprint: item.fact.factFingerprint,
    workspaceId: item.scope.workspaceId, businessEntityId: item.scope.businessEntityId,
    contributionFamilyKey: `square_observed_${item.kind}`, contributionFamilyKind: "non_additive_control",
    measureKey: "observation_count", aggregateKey: "square_descriptive_only", valueCanonical: "1",
    // Generic engine requires a date. This is observation date, never an economic
    // posting date; all_time buckets deliberately avoid accounting periods.
    economicDate: item.fact.sourceObservedAt.slice(0, 10), periodStart: null, periodEnd: null,
    dimensions: [{key:"status",value:item.status ?? "unknown"}, {key:"location",value:contractSha256(item.locationId ?? "seller_scoped_or_unknown")}],
    accountingBasis: "not_applicable", currency: null, observationKind: "control_observation"
  });
}

/** Caller supplies the committed current set for ONE checked connection. The
 * engine recalculates only dirty buckets; clean recomputation is a test oracle. */
export function updateSquareDescriptiveState(prior: DeterministicStateSnapshot,
  before: readonly SquareInterpretation[], after: readonly SquareInterpretation[], asOfDate: string) {
  if (before.length > 1000 || after.length > 1000) throw new Error("square_descriptive_capacity");
  const all = [...before, ...after]; all.forEach(assertSquareInterpretation);
  if (new Set(all.map(i=>i.scopeKey)).size > 1 || all.some(i => i.scope.workspaceId !== prior.workspaceId || i.scope.businessEntityId !== prior.businessEntityId)) {
    throw new Error("square_descriptive_scope_denied");
  }
  const controls = (items: readonly SquareInterpretation[]) => {
    const result = new Map<string,ActiveContribution>();
    for (const item of items) {
      if (result.has(item.resourceKey)) throw new Error("square_descriptive_duplicate_resource");
      result.set(item.resourceKey,squareDescriptiveControl(item));
    }
    return result;
  };
  return updateSquareDescriptiveControls(prior,[...controls(before).values()],[...controls(after).values()],asOfDate);
}

/** Persisted controls are read only from the private checked transaction store.
 * Namespace/scope checks prevent this helper from touching economic state. */
export function updateSquareDescriptiveControls(prior: DeterministicStateSnapshot,
  before: readonly ActiveContribution[], after: readonly ActiveContribution[], asOfDate: string) {
  const validate=(items:readonly ActiveContribution[])=>new Map(ActiveContributionSchema.array().max(1000).parse(items).map(c=>{
    if(c.workspaceId!==prior.workspaceId || c.businessEntityId!==prior.businessEntityId ||
      !SQUARE_DESCRIPTIVE_REGISTRY.aggregates.some(a=>a.contribution.contributionFamilyKeys.includes(c.contributionFamilyKey)) ||
      c.contributionFamilyKind!=="non_additive_control" || c.observationKind!=="control_observation" ||
      c.measureKey!=="observation_count" || c.aggregateKey!=="square_descriptive_only" || c.valueCanonical!=="1" ||
      c.accountingBasis!=="not_applicable" || c.currency!==null) throw new Error("square_descriptive_control_invalid");
    return [c.id,c] as const;
  }));
  const old=validate(before),next=validate(after);
  if(old.size!==before.length || next.size!==after.length || prior.states.some(s=>!SQUARE_DESCRIPTIVE_REGISTRY.aggregates.some(a=>a.nodeKey===s.nodeKey))) {
    throw new Error("square_descriptive_state_invalid");
  }
  const mutations: ContributionMutation[] = [];
  for (const key of [...new Set([...old.keys(),...next.keys()])].sort()) {
    const a = old.get(key) ?? null, b = next.get(key) ?? null;
    if (contractSha256(a) === contractSha256(b)) continue;
    const change = contractSha256({ prior:a, next:b });
    mutations.push({mutationKey:change,prior:a,next:b,causeContributionEventIds:[squareInterpretationId(change)]});
  }
  return runDeterministicIncremental({ prior, contributions:[...next.values()],mutations,registry:SQUARE_DESCRIPTIVE_REGISTRY,asOfDate });
}
