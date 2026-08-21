import { z } from "zod";

import {
  BoundedIdentifierSchema,
  ContractVersionSchema,
  CurrencyCodeSchema,
  IsoDateSchema,
  PersistedFactDecimalSchema,
  Sha256FingerprintSchema,
  UuidSchema,
  uniqueStringArray
} from "@/lib/integrations/contracts/primitives";
import {
  CanonicalDimensionsSchema,
  ContributionFamilyKindSchema
} from "@/lib/integrations/reconciliation/contracts";

export const DETERMINISTIC_CONTRACT_VERSIONS = {
  dependencyRegistry: "deterministic_dependency_registry_v1",
  aggregateState: "deterministic_aggregate_state_v1",
  changeSet: "deterministic_change_set_v1",
  dirtyNode: "dependency_dirty_node_v1",
  watermark: "deterministic_watermark_v1"
} as const;

export const DETERMINISTIC_CALCULATION_POLICY_VERSION =
  "deterministic_calculation_policy_v1" as const;

export const DeterministicNodeKindSchema = z.enum(["aggregate", "kpi", "downstream"]);
export const DeterministicPeriodGranularitySchema = z.enum(["day", "month", "all_time"]);
export const AccountingBasisSchema = z.enum(["accrual", "cash", "not_applicable", "unknown"]);

const uniqueIdentifiers = (maximum: number) =>
  uniqueStringArray(BoundedIdentifierSchema, maximum);

export const ContributionSelectorSchema = z
  .object({
    contributionFamilyKeys: uniqueIdentifiers(64),
    contributionFamilyKinds: z.array(ContributionFamilyKindSchema).min(1).max(2),
    measureKeys: uniqueIdentifiers(64),
    aggregateKeys: uniqueIdentifiers(64)
  })
  .strict();

export const AggregateDependencyDefinitionSchema = z
  .object({
    nodeKind: z.literal("aggregate"),
    nodeKey: BoundedIdentifierSchema,
    contribution: ContributionSelectorSchema,
    reducer: z.enum([
      "additive_sum",
      "control_latest",
      "targeted_set_recompute",
      "full_clean_recompute_only"
    ]),
    correctionStrategy: z.enum([
      "subtract_readd",
      "set_recompute",
      "latest_reselect",
      "full_clean"
    ]),
    periodGranularity: DeterministicPeriodGranularitySchema,
    groupByDimensions: uniqueIdentifiers(16),
    allowedAccountingBases: z.array(AccountingBasisSchema).min(1).max(4),
    currencyMode: z.enum(["required", "forbidden", "optional"]),
    calculationVersion: ContractVersionSchema,
    freshnessDependencyKeys: uniqueIdentifiers(32)
  })
  .strict()
  .superRefine((definition, context) => {
    if (
      definition.reducer === "additive_sum" &&
      definition.correctionStrategy !== "subtract_readd"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correctionStrategy"],
        message: "Additive reducers require subtract/re-add correction semantics"
      });
    }
    if (
      definition.reducer === "control_latest" &&
      definition.correctionStrategy !== "latest_reselect"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correctionStrategy"],
        message: "Latest-control reducers require deterministic reselection"
      });
    }
  });

export const DependencyWindowSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("same_period") }).strict(),
  z.object({ kind: z.literal("trailing_periods"), count: z.number().int().min(1).max(365) }).strict(),
  z.object({ kind: z.literal("quarter_to_date") }).strict(),
  z.object({ kind: z.literal("year_to_date") }).strict(),
  z.object({ kind: z.literal("prior_period_comparison") }).strict(),
  z.object({ kind: z.literal("year_over_year_comparison") }).strict(),
  z.object({ kind: z.literal("trend_periods"), count: z.number().int().min(2).max(120) }).strict()
]);

export const KpiDependencyDefinitionSchema = z
  .object({
    nodeKind: z.literal("kpi"),
    nodeKey: BoundedIdentifierSchema,
    dependencies: uniqueIdentifiers(32).refine((values) => values.length > 0),
    calculation: z.enum(["identity", "sum", "difference", "ratio"]),
    dependencyWindow: DependencyWindowSchema,
    missingInput: z.enum(["fail", "zero"]),
    divisionScale: z.number().int().min(0).max(9).nullable(),
    divisionRounding: z.enum(["half_away_from_zero"]).nullable(),
    calculationVersion: ContractVersionSchema,
    targetDependencyKeys: uniqueIdentifiers(32),
    freshnessDependencyKeys: uniqueIdentifiers(32)
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.calculation === "identity" && definition.dependencies.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dependencies"],
        message: "Identity KPI calculations require exactly one dependency"
      });
    }
    if (
      definition.calculation === "difference" &&
      definition.dependencyWindow.kind !== "prior_period_comparison" &&
      definition.dependencyWindow.kind !== "year_over_year_comparison"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dependencyWindow"],
        message: "Difference calculations require an explicit comparison window"
      });
    }
    if (
      (definition.calculation === "ratio") !==
      (definition.divisionScale !== null && definition.divisionRounding !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["divisionScale"],
        message: "Ratio calculations require an explicit scale and rounding policy"
      });
    }
  });

export const DownstreamDependencyDefinitionSchema = z
  .object({
    nodeKind: z.literal("downstream"),
    nodeKey: BoundedIdentifierSchema,
    dependencies: uniqueIdentifiers(32).refine((values) => values.length > 0),
    owner: z.enum([
      "business_health",
      "deterministic_risk",
      "deterministic_opportunity",
      "snapshot"
    ]),
    invalidationWindow: DependencyWindowSchema,
    calculationVersion: ContractVersionSchema,
    freshnessDependencyKeys: uniqueIdentifiers(32)
  })
  .strict();

export const DependencyRegistrySchema = z
  .object({
    contractVersion: z.literal(DETERMINISTIC_CONTRACT_VERSIONS.dependencyRegistry),
    registryVersion: ContractVersionSchema,
    calculationPolicyVersion: z.literal(DETERMINISTIC_CALCULATION_POLICY_VERSION),
    aggregates: z.array(AggregateDependencyDefinitionSchema).min(1).max(256),
    kpis: z.array(KpiDependencyDefinitionSchema).max(256),
    downstream: z.array(DownstreamDependencyDefinitionSchema).max(256),
    registryFingerprint: Sha256FingerprintSchema.optional()
  })
  .strict()
  .superRefine((registry, context) => {
    const keys = [
      ...registry.aggregates.map((definition) => definition.nodeKey),
      ...registry.kpis.map((definition) => definition.nodeKey),
      ...registry.downstream.map((definition) => definition.nodeKey)
    ];
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aggregates"],
        message: "Dependency node keys must be globally unique"
      });
    }
  });

export type DependencyRegistry = Readonly<z.infer<typeof DependencyRegistrySchema>>;
export type AggregateDependencyDefinition = Readonly<
  z.infer<typeof AggregateDependencyDefinitionSchema>
>;
export type KpiDependencyDefinition = Readonly<z.infer<typeof KpiDependencyDefinitionSchema>>;
export type DownstreamDependencyDefinition = Readonly<
  z.infer<typeof DownstreamDependencyDefinitionSchema>
>;

export const ActiveContributionSchema = z
  .object({
    id: UuidSchema,
    eventFingerprint: Sha256FingerprintSchema,
    sourceFactFingerprint: Sha256FingerprintSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    contributionFamilyKey: BoundedIdentifierSchema,
    contributionFamilyKind: ContributionFamilyKindSchema,
    measureKey: BoundedIdentifierSchema,
    aggregateKey: BoundedIdentifierSchema,
    valueCanonical: PersistedFactDecimalSchema,
    economicDate: IsoDateSchema,
    periodStart: IsoDateSchema.nullable(),
    periodEnd: IsoDateSchema.nullable(),
    dimensions: CanonicalDimensionsSchema,
    accountingBasis: AccountingBasisSchema,
    currency: CurrencyCodeSchema.nullable(),
    observationKind: z.enum(["active_additive", "control_observation"])
  })
  .strict()
  .superRefine((contribution, context) => {
    if ((contribution.periodStart === null) !== (contribution.periodEnd === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodStart"],
        message: "Contribution period bounds must be both present or both absent"
      });
    }
    if (
      contribution.periodStart !== null &&
      contribution.periodEnd !== null &&
      contribution.periodStart > contribution.periodEnd
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodEnd"],
        message: "Contribution period end must not precede its start"
      });
    }
    if (
      (contribution.observationKind === "active_additive") !==
      (contribution.contributionFamilyKind === "additive_transaction")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observationKind"],
        message: "Additive and control contribution families cannot be mixed"
      });
    }
  });

export type ActiveContribution = Readonly<z.infer<typeof ActiveContributionSchema>>;

export const ContributionMutationSchema = z
  .object({
    mutationKey: BoundedIdentifierSchema,
    prior: ActiveContributionSchema.nullable(),
    next: ActiveContributionSchema.nullable(),
    causeContributionEventIds: z.array(UuidSchema).min(1).max(256)
  })
  .strict()
  .superRefine((mutation, context) => {
    if (mutation.prior === null && mutation.next === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A contribution mutation requires a prior or next state"
      });
      return;
    }
    const scope = mutation.prior || mutation.next;
    for (const value of [mutation.prior, mutation.next]) {
      if (
        value &&
        scope &&
        (value.workspaceId !== scope.workspaceId ||
          value.businessEntityId !== scope.businessEntityId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Contribution mutations cannot cross workspace or Business Entity scope"
        });
      }
    }
  });

export type ContributionMutation = Readonly<z.infer<typeof ContributionMutationSchema>>;

export const DeterministicNodeScopeSchema = z
  .object({
    periodStart: IsoDateSchema.nullable(),
    periodEnd: IsoDateSchema.nullable(),
    dimensions: CanonicalDimensionsSchema,
    accountingBasis: AccountingBasisSchema,
    currency: CurrencyCodeSchema.nullable()
  })
  .strict();

export type DeterministicNodeScope = Readonly<z.infer<typeof DeterministicNodeScopeSchema>>;

export const DeterministicNodeStateSchema = z
  .object({
    contractVersion: z.literal(DETERMINISTIC_CONTRACT_VERSIONS.aggregateState),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    nodeKey: BoundedIdentifierSchema,
    nodeKind: z.enum(["aggregate", "kpi"]),
    nodeIdentityFingerprint: Sha256FingerprintSchema,
    scope: DeterministicNodeScopeSchema,
    valueCanonical: PersistedFactDecimalSchema,
    supportingContributionCount: z.number().int().nonnegative().safe(),
    sourceContributionAccumulator: Sha256FingerprintSchema,
    sourceContributionFingerprint: Sha256FingerprintSchema,
    registryVersion: ContractVersionSchema,
    registryFingerprint: Sha256FingerprintSchema,
    calculationPolicyVersion: z.literal(DETERMINISTIC_CALCULATION_POLICY_VERSION),
    calculationVersion: ContractVersionSchema
  })
  .strict();

export type DeterministicNodeState = Readonly<z.infer<typeof DeterministicNodeStateSchema>>;

export const DeterministicWatermarkSchema = z
  .object({
    contractVersion: z.literal(DETERMINISTIC_CONTRACT_VERSIONS.watermark),
    inputContributionFingerprint: Sha256FingerprintSchema,
    registryVersion: ContractVersionSchema,
    registryFingerprint: Sha256FingerprintSchema,
    calculationPolicyVersion: z.literal(DETERMINISTIC_CALCULATION_POLICY_VERSION),
    stateFingerprint: Sha256FingerprintSchema,
    watermarkFingerprint: Sha256FingerprintSchema
  })
  .strict();

export type DeterministicWatermark = Readonly<z.infer<typeof DeterministicWatermarkSchema>>;

export const DeterministicStateSnapshotSchema = z
  .object({
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    states: z.array(DeterministicNodeStateSchema).max(100_000),
    watermark: DeterministicWatermarkSchema.nullable()
  })
  .strict();

export type DeterministicStateSnapshot = Readonly<
  z.infer<typeof DeterministicStateSnapshotSchema>
>;

export const DirtyNodeSchema = z
  .object({
    contractVersion: z.literal(DETERMINISTIC_CONTRACT_VERSIONS.dirtyNode),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    nodeKey: BoundedIdentifierSchema,
    nodeKind: DeterministicNodeKindSchema,
    nodeIdentityFingerprint: Sha256FingerprintSchema,
    scope: DeterministicNodeScopeSchema,
    causeCount: z.number().int().positive().safe(),
    boundedCauseContributionEventIds: z.array(UuidSchema).max(32),
    causeFingerprint: Sha256FingerprintSchema,
    dependencyDepth: z.number().int().nonnegative().max(256)
  })
  .strict();

export type DirtyNode = Readonly<z.infer<typeof DirtyNodeSchema>>;

export type DeterministicWorkMetrics = Readonly<{
  contributionsScanned: number;
  aggregateKeysTouched: number;
  dirtyNodesGenerated: number;
  nodesRecalculated: number;
  stateReads: number;
  stateWrites: number;
}>;
