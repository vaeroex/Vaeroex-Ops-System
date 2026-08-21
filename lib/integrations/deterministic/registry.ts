import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  DETERMINISTIC_CALCULATION_POLICY_VERSION,
  DETERMINISTIC_CONTRACT_VERSIONS,
  DependencyRegistrySchema,
  type DependencyRegistry
} from "@/lib/integrations/deterministic/contracts";

type RegistryDraft = Omit<DependencyRegistry, "registryFingerprint">;

function definitions(registry: DependencyRegistry) {
  return [...registry.aggregates, ...registry.kpis, ...registry.downstream];
}

function registryFingerprintInput(registry: RegistryDraft) {
  return {
    fingerprintPurpose: "deterministic_dependency_registry",
    fingerprintVersion: "deterministic_dependency_fingerprint_v1",
    payload: registry
  } as const;
}

function validateGraph(registry: DependencyRegistry) {
  const nodes = definitions(registry);
  const nodeByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  const incoming = new Map(nodes.map((node) => [node.nodeKey, 0]));
  const outgoing = new Map(nodes.map((node) => [node.nodeKey, [] as string[]]));

  for (const node of nodes) {
    const dependencies = node.nodeKind === "aggregate" ? [] : node.dependencies;
    for (const dependency of dependencies) {
      if (!nodeByKey.has(dependency)) {
        throw new Error(`deterministic_dependency_unknown:${node.nodeKey}:${dependency}`);
      }
      if (dependency === node.nodeKey) {
        throw new Error(`deterministic_dependency_cycle:${node.nodeKey}`);
      }
      incoming.set(node.nodeKey, (incoming.get(node.nodeKey) || 0) + 1);
      outgoing.get(dependency)?.push(node.nodeKey);
    }
  }

  const ready = [...incoming.entries()]
    .filter(([, count]) => count === 0)
    .map(([key]) => key)
    .sort();
  const order: string[] = [];
  while (ready.length) {
    const key = ready.shift();
    if (!key) break;
    order.push(key);
    for (const child of [...(outgoing.get(key) || [])].sort()) {
      const remaining = (incoming.get(child) || 0) - 1;
      incoming.set(child, remaining);
      if (remaining === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }

  if (order.length !== nodes.length) {
    throw new Error("deterministic_dependency_cycle");
  }
  return order;
}

export function createDependencyRegistry(input: RegistryDraft): DependencyRegistry {
  const { registryFingerprint: _ignoredFingerprint, ...parsed } = DependencyRegistrySchema.parse(input);
  void _ignoredFingerprint;
  const registryFingerprint = contractSha256(registryFingerprintInput(parsed));
  const registry = DependencyRegistrySchema.parse({ ...parsed, registryFingerprint });
  validateGraph(registry);
  return registry;
}

export function assertDependencyRegistry(input: unknown): DependencyRegistry {
  const registry = DependencyRegistrySchema.parse(input);
  const { registryFingerprint, ...draft } = registry;
  const expected = contractSha256(registryFingerprintInput(draft));
  if (!registryFingerprint || registryFingerprint !== expected) {
    throw new Error("deterministic_dependency_registry_fingerprint_mismatch");
  }
  validateGraph(registry);
  return registry;
}

export function deterministicDependencyOrder(input: unknown) {
  return validateGraph(assertDependencyRegistry(input));
}

export const PHASE_3_DEPENDENCY_REGISTRY = createDependencyRegistry({
  contractVersion: DETERMINISTIC_CONTRACT_VERSIONS.dependencyRegistry,
  registryVersion: "vaeroex_deterministic_dependencies_v1",
  calculationPolicyVersion: DETERMINISTIC_CALCULATION_POLICY_VERSION,
  aggregates: [
    {
      nodeKind: "aggregate",
      nodeKey: "recognized_revenue_month_total",
      contribution: {
        contributionFamilyKeys: ["recognized_revenue_transactions"],
        contributionFamilyKinds: ["additive_transaction"],
        measureKeys: ["recognized_revenue"],
        aggregateKeys: ["recognized_revenue_actual"]
      },
      reducer: "additive_sum",
      correctionStrategy: "subtract_readd",
      periodGranularity: "month",
      groupByDimensions: [],
      allowedAccountingBases: ["accrual"],
      currencyMode: "required",
      calculationVersion: "recognized_revenue_month_total_v1",
      freshnessDependencyKeys: ["recognized_revenue_source"]
    }
  ],
  kpis: [
    {
      nodeKind: "kpi",
      nodeKey: "revenue",
      dependencies: ["recognized_revenue_month_total"],
      calculation: "identity",
      dependencyWindow: { kind: "same_period" },
      missingInput: "zero",
      divisionScale: null,
      divisionRounding: null,
      calculationVersion: "revenue_kpi_v1",
      targetDependencyKeys: ["revenue_target"],
      freshnessDependencyKeys: ["recognized_revenue_source"]
    }
  ],
  downstream: [
    {
      nodeKind: "downstream",
      nodeKey: "business_health_revenue_invalidation",
      dependencies: ["revenue"],
      owner: "business_health",
      invalidationWindow: { kind: "same_period" },
      calculationVersion: "business_health_invalidation_v1",
      freshnessDependencyKeys: ["recognized_revenue_source"]
    },
    {
      nodeKind: "downstream",
      nodeKey: "deterministic_revenue_risk_invalidation",
      dependencies: ["revenue"],
      owner: "deterministic_risk",
      invalidationWindow: { kind: "same_period" },
      calculationVersion: "deterministic_risk_invalidation_v1",
      freshnessDependencyKeys: ["recognized_revenue_source"]
    },
    {
      nodeKind: "downstream",
      nodeKey: "deterministic_revenue_opportunity_invalidation",
      dependencies: ["revenue"],
      owner: "deterministic_opportunity",
      invalidationWindow: { kind: "same_period" },
      calculationVersion: "deterministic_opportunity_invalidation_v1",
      freshnessDependencyKeys: ["recognized_revenue_source"]
    },
    {
      nodeKind: "downstream",
      nodeKey: "snapshot_revenue_invalidation",
      dependencies: [
        "business_health_revenue_invalidation",
        "deterministic_revenue_risk_invalidation",
        "deterministic_revenue_opportunity_invalidation"
      ],
      owner: "snapshot",
      invalidationWindow: { kind: "same_period" },
      calculationVersion: "snapshot_invalidation_v1",
      freshnessDependencyKeys: ["recognized_revenue_source"]
    }
  ]
});
