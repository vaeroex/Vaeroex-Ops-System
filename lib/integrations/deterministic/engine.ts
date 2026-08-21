import { createHash } from "node:crypto";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { IsoDateSchema } from "@/lib/integrations/contracts/primitives";
import {
  ActiveContributionSchema,
  ContributionMutationSchema,
  DETERMINISTIC_CALCULATION_POLICY_VERSION,
  DETERMINISTIC_CONTRACT_VERSIONS,
  DeterministicNodeStateSchema,
  DeterministicStateSnapshotSchema,
  DeterministicWatermarkSchema,
  DirtyNodeSchema,
  type ActiveContribution,
  type AggregateDependencyDefinition,
  type ContributionMutation,
  type DependencyRegistry,
  type DeterministicNodeScope,
  type DeterministicNodeState,
  type DeterministicStateSnapshot,
  type DeterministicWatermark,
  type DeterministicWorkMetrics,
  type DirtyNode,
  type KpiDependencyDefinition
} from "@/lib/integrations/deterministic/contracts";
import {
  addCanonicalDecimals,
  divideCanonicalDecimals,
  negateCanonicalDecimal,
  subtractCanonicalDecimals
} from "@/lib/integrations/deterministic/decimal";
import {
  affectedOutputScopes,
  dependencyInputScopes,
  periodScopeForDate,
  scopeBeginsOnOrBefore
} from "@/lib/integrations/deterministic/periods";
import {
  assertDependencyRegistry,
  deterministicDependencyOrder
} from "@/lib/integrations/deterministic/registry";
import { canonicalizeDimensions } from "@/lib/integrations/reconciliation/contracts";

export const PHASE_3_MODEL_CALL_COUNT = 0 as const;

type MutableMetrics = {
  contributionsScanned: number;
  aggregateKeysTouched: number;
  dirtyNodesGenerated: number;
  nodesRecalculated: number;
  stateReads: number;
  stateWrites: number;
};

type InternalDirtyNode = {
  workspaceId: string;
  businessEntityId: string;
  nodeKey: string;
  nodeKind: "aggregate" | "kpi" | "downstream";
  nodeIdentityFingerprint: string;
  scope: DeterministicNodeScope;
  mutationKeys: Set<string>;
  causeContributionEventIds: Set<string>;
  dependencyDepth: number;
};

function emptyMetrics(): MutableMetrics {
  return {
    contributionsScanned: 0,
    aggregateKeysTouched: 0,
    dirtyNodesGenerated: 0,
    nodesRecalculated: 0,
    stateReads: 0,
    stateWrites: 0
  };
}

function readonlyMetrics(metrics: MutableMetrics): DeterministicWorkMetrics {
  return { ...metrics };
}

function sortedStates(states: Iterable<DeterministicNodeState>) {
  return [...states].sort((left, right) =>
    left.nodeIdentityFingerprint.localeCompare(right.nodeIdentityFingerprint)
  );
}

function validateContributionScope(
  contributions: readonly ActiveContribution[],
  workspaceId: string,
  businessEntityId: string
) {
  for (const contribution of contributions) {
    if (
      contribution.workspaceId !== workspaceId ||
      contribution.businessEntityId !== businessEntityId
    ) {
      throw new Error("deterministic_contribution_scope_mismatch");
    }
  }
  const ids = contributions.map((contribution) => contribution.id);
  const fingerprints = contributions.map((contribution) => contribution.eventFingerprint);
  if (new Set(ids).size !== ids.length || new Set(fingerprints).size !== fingerprints.length) {
    throw new Error("deterministic_contribution_state_duplicate");
  }
}

export function contributionStateFingerprint(input: unknown) {
  const contributions = ActiveContributionSchema.array().max(100_000).parse(input);
  const fingerprints = contributions
    .map((contribution) => contribution.eventFingerprint)
    .sort();
  const digest = createHash("sha256")
    .update("deterministic_contribution_state_v1\n", "utf8")
    .update(fingerprints.join("\n"), "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}

function nodeIdentityFingerprint({
  workspaceId,
  businessEntityId,
  nodeKey,
  scope
}: {
  workspaceId: string;
  businessEntityId: string;
  nodeKey: string;
  scope: DeterministicNodeScope;
}) {
  return contractSha256({
    fingerprintPurpose: "deterministic_node_identity",
    fingerprintVersion: "deterministic_node_identity_v1",
    payload: { workspaceId, businessEntityId, nodeKey, scope }
  });
}

function nodeSourceFingerprint({
  nodeIdentity,
  valueCanonical,
  supportingContributionCount,
  sourceContributionAccumulator,
  dependencyFingerprints = []
}: {
  nodeIdentity: string;
  valueCanonical: string;
  supportingContributionCount: number;
  sourceContributionAccumulator: string;
  dependencyFingerprints?: readonly string[];
}) {
  return contractSha256({
    fingerprintPurpose: "deterministic_node_source",
    fingerprintVersion: "deterministic_node_source_v1",
    payload: {
      nodeIdentity,
      valueCanonical,
      supportingContributionCount,
      sourceContributionAccumulator,
      dependencyFingerprints: [...dependencyFingerprints].sort()
    }
  });
}

const EMPTY_CONTRIBUTION_ACCUMULATOR = `sha256:${"0".repeat(64)}`;

function xorFingerprints(values: readonly string[]) {
  const bytes = new Uint8Array(32);
  for (const value of values) {
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
      throw new Error("deterministic_contribution_fingerprint_invalid");
    }
    const hex = value.slice("sha256:".length);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] ^= Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
  }
  return `sha256:${Buffer.from(bytes).toString("hex")}`;
}

export function deterministicStateFingerprint(input: unknown) {
  const states = DeterministicNodeStateSchema.array().max(100_000).parse(input);
  return contractSha256({
    fingerprintPurpose: "deterministic_state",
    fingerprintVersion: "deterministic_state_fingerprint_v1",
    payload: sortedStates(states)
  });
}

function deterministicWatermark(
  inputContributionFingerprint: string,
  registry: DependencyRegistry,
  stateFingerprint: string
): DeterministicWatermark {
  const draft = {
    contractVersion: DETERMINISTIC_CONTRACT_VERSIONS.watermark,
    inputContributionFingerprint,
    registryVersion: registry.registryVersion,
    registryFingerprint: registry.registryFingerprint as string,
    calculationPolicyVersion: DETERMINISTIC_CALCULATION_POLICY_VERSION,
    stateFingerprint
  } as const;
  return DeterministicWatermarkSchema.parse({
    ...draft,
    watermarkFingerprint: contractSha256({
      fingerprintPurpose: "deterministic_watermark",
      fingerprintVersion: DETERMINISTIC_CONTRACT_VERSIONS.watermark,
      payload: draft
    })
  });
}

function stateSnapshot({
  workspaceId,
  businessEntityId,
  states,
  inputContributionFingerprint,
  registry
}: {
  workspaceId: string;
  businessEntityId: string;
  states: Iterable<DeterministicNodeState>;
  inputContributionFingerprint: string;
  registry: DependencyRegistry;
}) {
  const values = sortedStates(states);
  const stateFingerprint = deterministicStateFingerprint(values);
  return DeterministicStateSnapshotSchema.parse({
    workspaceId,
    businessEntityId,
    states: values,
    watermark: deterministicWatermark(inputContributionFingerprint, registry, stateFingerprint)
  });
}

function selectedDimensions(
  contribution: ActiveContribution,
  definition: AggregateDependencyDefinition
) {
  const byKey = new Map(contribution.dimensions.map((dimension) => [dimension.key, dimension]));
  return canonicalizeDimensions(
    definition.groupByDimensions.map((key) => {
      const dimension = byKey.get(key);
      if (!dimension) throw new Error(`deterministic_dimension_required:${key}`);
      return dimension;
    })
  );
}

function aggregateDefinitionCandidates(
  contribution: ActiveContribution,
  registry: DependencyRegistry
) {
  return registry.aggregates.filter((definition) =>
    definition.contribution.contributionFamilyKeys.includes(contribution.contributionFamilyKey) &&
    definition.contribution.contributionFamilyKinds.includes(contribution.contributionFamilyKind) &&
    definition.contribution.measureKeys.includes(contribution.measureKey) &&
    definition.contribution.aggregateKeys.includes(contribution.aggregateKey)
  );
}

function aggregateInstances(
  contribution: ActiveContribution,
  registry: DependencyRegistry
) {
  const candidates = aggregateDefinitionCandidates(contribution, registry);
  if (candidates.length === 0) {
    throw new Error(
      `deterministic_contribution_dependency_unknown:${contribution.aggregateKey}`
    );
  }

  return candidates.map((definition) => {
    if (!definition.allowedAccountingBases.includes(contribution.accountingBasis)) {
      throw new Error(`deterministic_accounting_basis_mismatch:${definition.nodeKey}`);
    }
    if (definition.currencyMode === "required" && contribution.currency === null) {
      throw new Error(`deterministic_currency_required:${definition.nodeKey}`);
    }
    if (definition.currencyMode === "forbidden" && contribution.currency !== null) {
      throw new Error(`deterministic_currency_forbidden:${definition.nodeKey}`);
    }
    if (
      contribution.periodStart !== null &&
      contribution.periodEnd !== null &&
      definition.periodGranularity !== "all_time" &&
      contribution.periodStart.slice(0, definition.periodGranularity === "month" ? 7 : 10) !==
        contribution.periodEnd.slice(0, definition.periodGranularity === "month" ? 7 : 10)
    ) {
      throw new Error(`deterministic_period_allocation_policy_required:${definition.nodeKey}`);
    }

    const scope = periodScopeForDate(contribution.economicDate, definition.periodGranularity, {
      dimensions: selectedDimensions(contribution, definition),
      accountingBasis: contribution.accountingBasis,
      currency: contribution.currency
    });
    return {
      definition,
      scope,
      identity: nodeIdentityFingerprint({
        workspaceId: contribution.workspaceId,
        businessEntityId: contribution.businessEntityId,
        nodeKey: definition.nodeKey,
        scope
      })
    };
  });
}

function makeAggregateState({
  workspaceId,
  businessEntityId,
  definition,
  scope,
  valueCanonical,
  supportingContributionCount,
  sourceContributionAccumulator,
  registry
}: {
  workspaceId: string;
  businessEntityId: string;
  definition: AggregateDependencyDefinition;
  scope: DeterministicNodeScope;
  valueCanonical: string;
  supportingContributionCount: number;
  sourceContributionAccumulator: string;
  registry: DependencyRegistry;
}) {
  const identity = nodeIdentityFingerprint({
    workspaceId,
    businessEntityId,
    nodeKey: definition.nodeKey,
    scope
  });
  return DeterministicNodeStateSchema.parse({
    contractVersion: DETERMINISTIC_CONTRACT_VERSIONS.aggregateState,
    workspaceId,
    businessEntityId,
    nodeKey: definition.nodeKey,
    nodeKind: "aggregate",
    nodeIdentityFingerprint: identity,
    scope,
    valueCanonical,
    supportingContributionCount,
    sourceContributionAccumulator,
    sourceContributionFingerprint: nodeSourceFingerprint({
      nodeIdentity: identity,
      valueCanonical,
      supportingContributionCount,
      sourceContributionAccumulator
    }),
    registryVersion: registry.registryVersion,
    registryFingerprint: registry.registryFingerprint,
    calculationPolicyVersion: registry.calculationPolicyVersion,
    calculationVersion: definition.calculationVersion
  });
}

function calculateKpiValue(
  definition: KpiDependencyDefinition,
  inputs: readonly DeterministicNodeState[]
) {
  const values = inputs.map((input) => input.valueCanonical);
  if (definition.calculation === "identity") return values[0] || "0";
  if (definition.calculation === "sum") return addCanonicalDecimals(values);
  if (definition.calculation === "difference") {
    if (values.length !== 2) throw new Error(`deterministic_difference_input_invalid:${definition.nodeKey}`);
    return subtractCanonicalDecimals(values[0], values[1]);
  }
  if (
    values.length !== 2 ||
    definition.divisionScale === null ||
    definition.divisionRounding === null
  ) {
    throw new Error(`deterministic_ratio_input_invalid:${definition.nodeKey}`);
  }
  return divideCanonicalDecimals({
    numerator: values[0],
    denominator: values[1],
    scale: definition.divisionScale,
    rounding: definition.divisionRounding
  });
}

function makeKpiState({
  workspaceId,
  businessEntityId,
  definition,
  scope,
  inputs,
  registry
}: {
  workspaceId: string;
  businessEntityId: string;
  definition: KpiDependencyDefinition;
  scope: DeterministicNodeScope;
  inputs: readonly DeterministicNodeState[];
  registry: DependencyRegistry;
}) {
  const identity = nodeIdentityFingerprint({
    workspaceId,
    businessEntityId,
    nodeKey: definition.nodeKey,
    scope
  });
  const valueCanonical = calculateKpiValue(definition, inputs);
  const supportingContributionCount = inputs.reduce(
    (total, input) => total + input.supportingContributionCount,
    0
  );
  const sourceContributionAccumulator = xorFingerprints(
    inputs.map((input) => input.sourceContributionAccumulator)
  );
  return DeterministicNodeStateSchema.parse({
    contractVersion: DETERMINISTIC_CONTRACT_VERSIONS.aggregateState,
    workspaceId,
    businessEntityId,
    nodeKey: definition.nodeKey,
    nodeKind: "kpi",
    nodeIdentityFingerprint: identity,
    scope,
    valueCanonical,
    supportingContributionCount,
    sourceContributionAccumulator,
    sourceContributionFingerprint: nodeSourceFingerprint({
      nodeIdentity: identity,
      valueCanonical,
      supportingContributionCount,
      sourceContributionAccumulator,
      dependencyFingerprints: inputs.map((input) => input.sourceContributionFingerprint)
    }),
    registryVersion: registry.registryVersion,
    registryFingerprint: registry.registryFingerprint,
    calculationPolicyVersion: registry.calculationPolicyVersion,
    calculationVersion: definition.calculationVersion
  });
}

function stateLookup(
  states: Map<string, DeterministicNodeState>,
  workspaceId: string,
  businessEntityId: string,
  nodeKey: string,
  scope: DeterministicNodeScope,
  metrics: MutableMetrics
) {
  metrics.stateReads += 1;
  return states.get(nodeIdentityFingerprint({ workspaceId, businessEntityId, nodeKey, scope }));
}

function resolveKpiInputs({
  states,
  definition,
  scope,
  workspaceId,
  businessEntityId,
  registry,
  metrics
}: {
  states: Map<string, DeterministicNodeState>;
  definition: KpiDependencyDefinition;
  scope: DeterministicNodeScope;
  workspaceId: string;
  businessEntityId: string;
  registry: DependencyRegistry;
  metrics: MutableMetrics;
}) {
  const inputs: DeterministicNodeState[] = [];
  for (const dependency of definition.dependencies) {
    for (const inputScope of dependencyInputScopes(scope, definition.dependencyWindow)) {
      const state = stateLookup(
        states,
        workspaceId,
        businessEntityId,
        dependency,
        inputScope,
        metrics
      );
      if (state) {
        inputs.push(state);
        continue;
      }
      if (definition.missingInput === "fail") {
        throw new Error(`deterministic_dependency_state_missing:${definition.nodeKey}:${dependency}`);
      }
      const dependencyDefinition = registry.aggregates.find((value) => value.nodeKey === dependency)
        || registry.kpis.find((value) => value.nodeKey === dependency);
      if (!dependencyDefinition) {
        throw new Error(`deterministic_dependency_unknown:${definition.nodeKey}:${dependency}`);
      }
      const identity = nodeIdentityFingerprint({
        workspaceId,
        businessEntityId,
        nodeKey: dependency,
        scope: inputScope
      });
      inputs.push(DeterministicNodeStateSchema.parse({
        contractVersion: DETERMINISTIC_CONTRACT_VERSIONS.aggregateState,
        workspaceId,
        businessEntityId,
        nodeKey: dependency,
        nodeKind: dependencyDefinition.nodeKind,
        nodeIdentityFingerprint: identity,
        scope: inputScope,
        valueCanonical: "0",
        supportingContributionCount: 0,
        sourceContributionAccumulator: EMPTY_CONTRIBUTION_ACCUMULATOR,
        sourceContributionFingerprint: nodeSourceFingerprint({
          nodeIdentity: identity,
          valueCanonical: "0",
          supportingContributionCount: 0,
          sourceContributionAccumulator: EMPTY_CONTRIBUTION_ACCUMULATOR
        }),
        registryVersion: registry.registryVersion,
        registryFingerprint: registry.registryFingerprint,
        calculationPolicyVersion: registry.calculationPolicyVersion,
        calculationVersion: dependencyDefinition.calculationVersion
      }));
    }
  }
  return inputs;
}

function aggregateStatesFromContributions({
  contributions,
  registry,
  workspaceId,
  businessEntityId,
  scopeHints,
  metrics
}: {
  contributions: readonly ActiveContribution[];
  registry: DependencyRegistry;
  workspaceId: string;
  businessEntityId: string;
  scopeHints: readonly DeterministicNodeState[];
  metrics: MutableMetrics;
}) {
  const buckets = new Map<string, {
    definition: AggregateDependencyDefinition;
    scope: DeterministicNodeScope;
    contributions: ActiveContribution[];
  }>();

  for (const contribution of contributions) {
    metrics.contributionsScanned += 1;
    for (const instance of aggregateInstances(contribution, registry)) {
      const bucket = buckets.get(instance.identity) || {
        definition: instance.definition,
        scope: instance.scope,
        contributions: []
      };
      bucket.contributions.push(contribution);
      buckets.set(instance.identity, bucket);
    }
  }

  for (const hint of scopeHints) {
    if (hint.nodeKind !== "aggregate" || buckets.has(hint.nodeIdentityFingerprint)) continue;
    const definition = registry.aggregates.find((candidate) => candidate.nodeKey === hint.nodeKey);
    if (definition) buckets.set(hint.nodeIdentityFingerprint, { definition, scope: hint.scope, contributions: [] });
  }

  const states = new Map<string, DeterministicNodeState>();
  for (const [identity, bucket] of buckets) {
    let selected = bucket.contributions;
    if (bucket.definition.reducer === "control_latest" && selected.length > 1) {
      selected = [...selected]
        .sort((left, right) =>
          left.economicDate.localeCompare(right.economicDate) ||
          left.eventFingerprint.localeCompare(right.eventFingerprint)
        )
        .slice(-1);
    }
    const valueCanonical = addCanonicalDecimals(
      selected.map((contribution) => contribution.valueCanonical)
    );
    states.set(identity, makeAggregateState({
      workspaceId,
      businessEntityId,
      definition: bucket.definition,
      scope: bucket.scope,
      valueCanonical,
      supportingContributionCount: selected.length,
      sourceContributionAccumulator: xorFingerprints(
        selected.map((contribution) => contribution.eventFingerprint)
      ),
      registry
    }));
  }
  return states;
}

function calculateAllKpis({
  states,
  registry,
  workspaceId,
  businessEntityId,
  asOfDate,
  metrics
}: {
  states: Map<string, DeterministicNodeState>;
  registry: DependencyRegistry;
  workspaceId: string;
  businessEntityId: string;
  asOfDate: string;
  metrics: MutableMetrics;
}) {
  const order = deterministicDependencyOrder(registry);
  for (const nodeKey of order) {
    const definition = registry.kpis.find((candidate) => candidate.nodeKey === nodeKey);
    if (!definition) continue;
    const scopes = new Map<string, DeterministicNodeScope>();
    for (const dependency of definition.dependencies) {
      for (const state of states.values()) {
        if (state.nodeKey !== dependency) continue;
        for (const scope of affectedOutputScopes(state.scope, definition.dependencyWindow)) {
          if (!scopeBeginsOnOrBefore(scope, asOfDate)) continue;
          scopes.set(contractSha256(scope), scope);
        }
      }
    }
    for (const scope of scopes.values()) {
      const inputs = resolveKpiInputs({
        states,
        definition,
        scope,
        workspaceId,
        businessEntityId,
        registry,
        metrics
      });
      const state = makeKpiState({
        workspaceId,
        businessEntityId,
        definition,
        scope,
        inputs,
        registry
      });
      states.set(state.nodeIdentityFingerprint, state);
      metrics.nodesRecalculated += 1;
    }
  }
}

export function cleanFullRecompute({
  workspaceId,
  businessEntityId,
  contributions: rawContributions,
  registry: rawRegistry,
  asOfDate,
  scopeHints = []
}: {
  workspaceId: string;
  businessEntityId: string;
  contributions: readonly ActiveContribution[];
  registry: DependencyRegistry;
  asOfDate: string;
  scopeHints?: readonly DeterministicNodeState[];
}) {
  IsoDateSchema.parse(asOfDate);
  const registry = assertDependencyRegistry(rawRegistry);
  const contributions = ActiveContributionSchema.array().max(100_000).parse(rawContributions);
  validateContributionScope(contributions, workspaceId, businessEntityId);
  const metrics = emptyMetrics();
  const states = aggregateStatesFromContributions({
    contributions,
    registry,
    workspaceId,
    businessEntityId,
    scopeHints,
    metrics
  });
  metrics.aggregateKeysTouched = states.size;
  metrics.nodesRecalculated += states.size;
  calculateAllKpis({ states, registry, workspaceId, businessEntityId, asOfDate, metrics });
  metrics.stateWrites = states.size;
  const inputFingerprint = contributionStateFingerprint(contributions);
  return {
    snapshot: stateSnapshot({
      workspaceId,
      businessEntityId,
      states: states.values(),
      inputContributionFingerprint: inputFingerprint,
      registry
    }),
    metrics: readonlyMetrics(metrics)
  } as const;
}

function mergeDirty(
  dirty: Map<string, InternalDirtyNode>,
  value: Omit<InternalDirtyNode, "mutationKeys" | "causeContributionEventIds"> & {
    mutationKeys: Iterable<string>;
    causeContributionEventIds: Iterable<string>;
  }
) {
  const existing = dirty.get(value.nodeIdentityFingerprint);
  if (existing) {
    for (const mutationKey of value.mutationKeys) existing.mutationKeys.add(mutationKey);
    for (const eventId of value.causeContributionEventIds) {
      existing.causeContributionEventIds.add(eventId);
    }
    existing.dependencyDepth = Math.max(existing.dependencyDepth, value.dependencyDepth);
    return;
  }
  dirty.set(value.nodeIdentityFingerprint, {
    ...value,
    mutationKeys: new Set(value.mutationKeys),
    causeContributionEventIds: new Set(value.causeContributionEventIds)
  });
}

function materializeDirtyNodes(dirty: Map<string, InternalDirtyNode>): DirtyNode[] {
  return [...dirty.values()]
    .sort((left, right) => left.nodeIdentityFingerprint.localeCompare(right.nodeIdentityFingerprint))
    .map((node) => {
      const eventIds = [...node.causeContributionEventIds].sort();
      return DirtyNodeSchema.parse({
        contractVersion: DETERMINISTIC_CONTRACT_VERSIONS.dirtyNode,
        workspaceId: node.workspaceId,
        businessEntityId: node.businessEntityId,
        nodeKey: node.nodeKey,
        nodeKind: node.nodeKind,
        nodeIdentityFingerprint: node.nodeIdentityFingerprint,
        scope: node.scope,
        causeCount: node.mutationKeys.size,
        boundedCauseContributionEventIds: eventIds.slice(0, 32),
        causeFingerprint: contractSha256({
          fingerprintPurpose: "deterministic_dirty_node_causes",
          fingerprintVersion: "deterministic_dirty_node_causes_v1",
          payload: {
            mutationKeys: [...node.mutationKeys].sort(),
            causeContributionEventIds: eventIds
          }
        }),
        dependencyDepth: node.dependencyDepth
      });
    });
}

function contributionForInstance(
  contribution: ActiveContribution,
  definition: AggregateDependencyDefinition,
  identity: string,
  registry: DependencyRegistry
) {
  return aggregateInstances(contribution, registry).some(
    (instance) => instance.definition.nodeKey === definition.nodeKey && instance.identity === identity
  );
}

function recomputeAggregateInstance({
  contributions,
  definition,
  identity,
  scope,
  workspaceId,
  businessEntityId,
  registry,
  metrics
}: {
  contributions: readonly ActiveContribution[];
  definition: AggregateDependencyDefinition;
  identity: string;
  scope: DeterministicNodeScope;
  workspaceId: string;
  businessEntityId: string;
  registry: DependencyRegistry;
  metrics: MutableMetrics;
}) {
  const matching: ActiveContribution[] = [];
  for (const contribution of contributions) {
    metrics.contributionsScanned += 1;
    if (contributionForInstance(contribution, definition, identity, registry)) {
      matching.push(contribution);
    }
  }
  const selected = definition.reducer === "control_latest"
    ? [...matching]
      .sort((left, right) =>
        left.economicDate.localeCompare(right.economicDate) ||
        left.eventFingerprint.localeCompare(right.eventFingerprint)
      )
      .slice(-1)
    : matching;
  return makeAggregateState({
    workspaceId,
    businessEntityId,
    definition,
    scope,
    valueCanonical: addCanonicalDecimals(selected.map((value) => value.valueCanonical)),
    supportingContributionCount: selected.length,
    sourceContributionAccumulator: xorFingerprints(
      selected.map((contribution) => contribution.eventFingerprint)
    ),
    registry
  });
}

function calculateIncremental({
  prior,
  contributions,
  mutations,
  registry,
  asOfDate
}: {
  prior: DeterministicStateSnapshot;
  contributions: readonly ActiveContribution[];
  mutations: readonly ContributionMutation[];
  registry: DependencyRegistry;
  asOfDate: string;
}) {
  const { workspaceId, businessEntityId } = prior;
  const inputFingerprint = contributionStateFingerprint(contributions);
  if (
    prior.watermark?.inputContributionFingerprint === inputFingerprint &&
    prior.watermark.registryFingerprint === registry.registryFingerprint &&
    prior.watermark.calculationPolicyVersion === registry.calculationPolicyVersion
  ) {
    return {
      snapshot: prior,
      dirtyNodes: [] as DirtyNode[],
      metrics: readonlyMetrics(emptyMetrics()),
      idempotent: true
    } as const;
  }

  if (
    prior.watermark &&
    (prior.watermark.registryFingerprint !== registry.registryFingerprint ||
      prior.watermark.calculationPolicyVersion !== registry.calculationPolicyVersion)
  ) {
    const full = cleanFullRecompute({
      workspaceId,
      businessEntityId,
      contributions,
      registry,
      asOfDate,
      scopeHints: prior.states
    });
    const dirtyNodes = full.snapshot.states.map((state) => DirtyNodeSchema.parse({
      contractVersion: DETERMINISTIC_CONTRACT_VERSIONS.dirtyNode,
      workspaceId,
      businessEntityId,
      nodeKey: state.nodeKey,
      nodeKind: state.nodeKind,
      nodeIdentityFingerprint: state.nodeIdentityFingerprint,
      scope: state.scope,
      causeCount: 1,
      boundedCauseContributionEventIds: [],
      causeFingerprint: contractSha256({
        fingerprintPurpose: "deterministic_registry_change",
        fingerprintVersion: "deterministic_registry_change_v1",
        payload: {
          priorRegistryFingerprint: prior.watermark?.registryFingerprint || null,
          registryFingerprint: registry.registryFingerprint
        }
      }),
      dependencyDepth: state.nodeKind === "aggregate" ? 0 : 1
    }));
    return { ...full, dirtyNodes, idempotent: false } as const;
  }

  const states = new Map(prior.states.map((state) => [state.nodeIdentityFingerprint, state]));
  const dirty = new Map<string, InternalDirtyNode>();
  const metrics = emptyMetrics();
  const affected = new Map<string, {
    definition: AggregateDependencyDefinition;
    scope: DeterministicNodeScope;
    valueDelta: string[];
    accumulatorDelta: string[];
    countDelta: number;
    recompute: boolean;
    mutationKeys: Set<string>;
    eventIds: Set<string>;
  }>();

  for (const mutation of mutations) {
    for (const [value, direction] of [[mutation.prior, -1], [mutation.next, 1]] as const) {
      if (!value) continue;
      metrics.contributionsScanned += 1;
      for (const instance of aggregateInstances(value, registry)) {
        const item = affected.get(instance.identity) || {
          definition: instance.definition,
          scope: instance.scope,
          valueDelta: [],
          accumulatorDelta: [],
          countDelta: 0,
          recompute: instance.definition.reducer !== "additive_sum",
          mutationKeys: new Set<string>(),
          eventIds: new Set<string>()
        };
        item.valueDelta.push(direction === 1 ? value.valueCanonical : negateCanonicalDecimal(value.valueCanonical));
        item.accumulatorDelta.push(value.eventFingerprint);
        item.countDelta += direction;
        item.recompute ||= instance.definition.reducer !== "additive_sum";
        item.mutationKeys.add(mutation.mutationKey);
        mutation.causeContributionEventIds.forEach((id) => item.eventIds.add(id));
        affected.set(instance.identity, item);
      }
    }
  }
  metrics.aggregateKeysTouched = affected.size;

  for (const [identity, item] of affected) {
    const priorState = states.get(identity);
    let nextState: DeterministicNodeState;
    if (item.recompute) {
      nextState = recomputeAggregateInstance({
        contributions,
        definition: item.definition,
        identity,
        scope: item.scope,
        workspaceId,
        businessEntityId,
        registry,
        metrics
      });
    } else {
      const priorValue = priorState?.valueCanonical || "0";
      const priorCount = priorState?.supportingContributionCount || 0;
      const priorAccumulator = priorState?.sourceContributionAccumulator || EMPTY_CONTRIBUTION_ACCUMULATOR;
      const supportingContributionCount = priorCount + item.countDelta;
      if (supportingContributionCount < 0) {
        throw new Error(`deterministic_stale_prior_state:${item.definition.nodeKey}`);
      }
      nextState = makeAggregateState({
        workspaceId,
        businessEntityId,
        definition: item.definition,
        scope: item.scope,
        valueCanonical: addCanonicalDecimals([priorValue, ...item.valueDelta]),
        supportingContributionCount,
        sourceContributionAccumulator: xorFingerprints([
          priorAccumulator,
          ...item.accumulatorDelta
        ]),
        registry
      });
    }
    states.set(identity, nextState);
    metrics.nodesRecalculated += 1;
    if (!priorState || deterministicStateFingerprint([priorState]) !== deterministicStateFingerprint([nextState])) {
      metrics.stateWrites += 1;
    }
    mergeDirty(dirty, {
      workspaceId,
      businessEntityId,
      nodeKey: item.definition.nodeKey,
      nodeKind: "aggregate",
      nodeIdentityFingerprint: identity,
      scope: item.scope,
      mutationKeys: item.mutationKeys,
      causeContributionEventIds: item.eventIds,
      dependencyDepth: 0
    });
  }

  const order = deterministicDependencyOrder(registry);
  const depthByNode = new Map<string, number>(registry.aggregates.map((value) => [value.nodeKey, 0]));
  for (const nodeKey of order) {
    const kpi = registry.kpis.find((value) => value.nodeKey === nodeKey);
    const downstream = registry.downstream.find((value) => value.nodeKey === nodeKey);
    const definition = kpi || downstream;
    if (!definition) continue;
    const dependencyDepth = 1 + Math.max(
      ...definition.dependencies.map((dependency) => depthByNode.get(dependency) ?? 0)
    );
    depthByNode.set(nodeKey, dependencyDepth);
    const window = kpi ? kpi.dependencyWindow : downstream?.invalidationWindow;
    if (!window) continue;
    const outputs = new Map<string, {
      scope: DeterministicNodeScope;
      mutationKeys: Set<string>;
      eventIds: Set<string>;
    }>();
    for (const dependency of definition.dependencies) {
      for (const dependencyDirty of dirty.values()) {
        if (dependencyDirty.nodeKey !== dependency) continue;
        for (const scope of affectedOutputScopes(dependencyDirty.scope, window)) {
          if (!scopeBeginsOnOrBefore(scope, asOfDate)) continue;
          const identity = nodeIdentityFingerprint({
            workspaceId,
            businessEntityId,
            nodeKey,
            scope
          });
          const output = outputs.get(identity) || {
            scope,
            mutationKeys: new Set<string>(),
            eventIds: new Set<string>()
          };
          dependencyDirty.mutationKeys.forEach((value) => output.mutationKeys.add(value));
          dependencyDirty.causeContributionEventIds.forEach((value) => output.eventIds.add(value));
          outputs.set(identity, output);
        }
      }
    }

    for (const [identity, output] of outputs) {
      mergeDirty(dirty, {
        workspaceId,
        businessEntityId,
        nodeKey,
        nodeKind: kpi ? "kpi" : "downstream",
        nodeIdentityFingerprint: identity,
        scope: output.scope,
        mutationKeys: output.mutationKeys,
        causeContributionEventIds: output.eventIds,
        dependencyDepth
      });
      if (!kpi) continue;
      const priorState = states.get(identity);
      const inputs = resolveKpiInputs({
        states,
        definition: kpi,
        scope: output.scope,
        workspaceId,
        businessEntityId,
        registry,
        metrics
      });
      const nextState = makeKpiState({
        workspaceId,
        businessEntityId,
        definition: kpi,
        scope: output.scope,
        inputs,
        registry
      });
      states.set(identity, nextState);
      metrics.nodesRecalculated += 1;
      if (!priorState || deterministicStateFingerprint([priorState]) !== deterministicStateFingerprint([nextState])) {
        metrics.stateWrites += 1;
      }
    }
  }

  const dirtyNodes = materializeDirtyNodes(dirty);
  metrics.dirtyNodesGenerated = dirtyNodes.length;
  return {
    snapshot: stateSnapshot({
      workspaceId,
      businessEntityId,
      states: states.values(),
      inputContributionFingerprint: inputFingerprint,
      registry
    }),
    dirtyNodes,
    metrics: readonlyMetrics(metrics),
    idempotent: false
  } as const;
}

export function incrementalChangeSetFingerprint({
  priorWatermark,
  currentInputContributionFingerprint,
  registry,
  mutations
}: {
  priorWatermark: DeterministicWatermark | null;
  currentInputContributionFingerprint: string;
  registry: DependencyRegistry;
  mutations: readonly ContributionMutation[];
}) {
  return contractSha256({
    fingerprintPurpose: "deterministic_change_set",
    fingerprintVersion: DETERMINISTIC_CONTRACT_VERSIONS.changeSet,
    payload: {
      priorWatermark: priorWatermark?.watermarkFingerprint || null,
      currentInputContributionFingerprint,
      registryVersion: registry.registryVersion,
      registryFingerprint: registry.registryFingerprint,
      calculationPolicyVersion: registry.calculationPolicyVersion,
      mutations: [...mutations].sort((left, right) =>
        left.mutationKey.localeCompare(right.mutationKey)
      )
    }
  });
}

export function runIncrementalFullEquivalence({
  prior: rawPrior,
  contributions: rawContributions,
  mutations: rawMutations,
  registry: rawRegistry,
  asOfDate
}: {
  prior: DeterministicStateSnapshot;
  contributions: readonly ActiveContribution[];
  mutations: readonly ContributionMutation[];
  registry: DependencyRegistry;
  asOfDate: string;
}) {
  IsoDateSchema.parse(asOfDate);
  const registry = assertDependencyRegistry(rawRegistry);
  const prior = DeterministicStateSnapshotSchema.parse(rawPrior);
  const contributions = ActiveContributionSchema.array().max(100_000).parse(rawContributions);
  const mutations = ContributionMutationSchema.array().max(10_000).parse(rawMutations);
  validateContributionScope(contributions, prior.workspaceId, prior.businessEntityId);
  for (const mutation of mutations) {
    const scope = mutation.prior || mutation.next;
    if (
      scope &&
      (scope.workspaceId !== prior.workspaceId ||
        scope.businessEntityId !== prior.businessEntityId)
    ) {
      throw new Error("deterministic_change_set_scope_mismatch");
    }
  }

  const incremental = calculateIncremental({ prior, contributions, mutations, registry, asOfDate });
  const clean = cleanFullRecompute({
    workspaceId: prior.workspaceId,
    businessEntityId: prior.businessEntityId,
    contributions,
    registry,
    asOfDate,
    scopeHints: prior.states
  });
  const incrementalFingerprint = incremental.snapshot.watermark?.stateFingerprint;
  const cleanFingerprint = clean.snapshot.watermark?.stateFingerprint;
  const matched = incrementalFingerprint === cleanFingerprint;
  const currentInputContributionFingerprint = contributionStateFingerprint(contributions);
  const changeSetFingerprint = incrementalChangeSetFingerprint({
    priorWatermark: prior.watermark,
    currentInputContributionFingerprint,
    registry,
    mutations
  });

  return {
    status: matched ? "completed" as const : "quarantined" as const,
    changeSetFingerprint,
    incremental,
    clean,
    safeSnapshot: matched ? incremental.snapshot : prior,
    integrityFailure: matched ? null : {
      code: "deterministic_incremental_full_mismatch",
      failureFingerprint: contractSha256({
        fingerprintPurpose: "deterministic_integrity_failure",
        fingerprintVersion: "deterministic_integrity_failure_v1",
        payload: {
          changeSetFingerprint,
          incrementalFingerprint,
          cleanFingerprint
        }
      })
    },
    modelCallCount: PHASE_3_MODEL_CALL_COUNT
  } as const;
}

export function emptyDeterministicStateSnapshot({
  workspaceId,
  businessEntityId
}: {
  workspaceId: string;
  businessEntityId: string;
}) {
  return DeterministicStateSnapshotSchema.parse({
    workspaceId,
    businessEntityId,
    states: [],
    watermark: null
  });
}
