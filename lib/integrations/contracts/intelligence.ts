import { z } from "zod";

import {
  BoundedIdentifierSchema,
  BoundedLabelSchema,
  BoundedTextSchema,
  CurrencyCodeSchema,
  IsoDateSchema,
  IsoTimestampSchema,
  PersistedFactDecimalSchema,
  PersistedUnitIntervalDecimalSchema,
  ProviderKeySchema,
  Sha256FingerprintSchema,
  UuidSchema,
  uniqueStringArray
} from "@/lib/integrations/contracts/primitives";
import { CanonicalFactValueSchema } from "@/lib/integrations/contracts/source-facts";
import {
  EXTERNAL_INTEGRATION_CONTRACT_VERSIONS,
  EXTERNAL_INTEGRATION_LIMITS
} from "@/lib/integrations/contracts/versions";

export const FreshnessStatusSchema = z.enum([
  "current",
  "aging",
  "stale",
  "sync_error",
  "reauthorization_required",
  "disconnected",
  "unknown"
]);

export const FreshnessBlockingLevelSchema = z.enum([
  "none",
  "warning",
  "current_intelligence",
  "all_derived"
]);

export type FreshnessStatus = z.infer<typeof FreshnessStatusSchema>;
export type FreshnessBlockingLevel = z.infer<typeof FreshnessBlockingLevelSchema>;

export const FreshnessStateSchema = z
  .object({
    contractVersion: z.literal(EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.freshness),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema.nullable(),
    mappingId: UuidSchema.nullable(),
    domain: BoundedIdentifierSchema,
    scopeKey: BoundedIdentifierSchema,
    providerWatermarkAt: IsoTimestampSchema.nullable(),
    lastAttemptAt: IsoTimestampSchema.nullable(),
    lastSuccessfulSyncAt: IsoTimestampSchema.nullable(),
    lastReconciledAt: IsoTimestampSchema.nullable(),
    observedLagSeconds: z.number().int().nonnegative().safe().nullable(),
    status: FreshnessStatusSchema,
    blockingLevel: FreshnessBlockingLevelSchema,
    reasonCode: BoundedIdentifierSchema.nullable(),
    policyVersion: BoundedIdentifierSchema,
    calculatedAt: IsoTimestampSchema,
    currentMaxAgeSeconds: z.number().int().positive().safe(),
    staleAfterSeconds: z.number().int().positive().safe(),
    ageSeconds: z.number().int().nonnegative().safe().nullable(),
    rowVersion: z.number().int().positive().safe()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.currentMaxAgeSeconds >= value.staleAfterSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["staleAfterSeconds"],
        message: "The stale threshold must be greater than the current threshold"
      });
    }

    const timerState = value.status === "current" || value.status === "aging" || value.status === "stale";
    if (timerState && (value.lastSuccessfulSyncAt === null || value.ageSeconds === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Timer-derived freshness requires a successful sync and measured age"
      });
    }

    if (value.status === "current") {
      if (value.ageSeconds !== null && value.ageSeconds > value.currentMaxAgeSeconds) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["ageSeconds"], message: "Current freshness exceeds its current threshold" });
      }
      if (value.blockingLevel !== "none") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["blockingLevel"], message: "Current freshness cannot block derived state" });
      }
    }

    if (value.status === "aging") {
      if (
        value.ageSeconds !== null &&
        (value.ageSeconds <= value.currentMaxAgeSeconds || value.ageSeconds > value.staleAfterSeconds)
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["ageSeconds"], message: "Aging freshness must fall between current and stale thresholds" });
      }
      if (value.blockingLevel !== "warning") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["blockingLevel"], message: "Aging freshness must carry a warning" });
      }
    }

    if (value.status === "stale") {
      if (value.ageSeconds !== null && value.ageSeconds <= value.staleAfterSeconds) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["ageSeconds"], message: "Stale freshness must exceed its stale threshold" });
      }
      if (value.blockingLevel !== "current_intelligence" && value.blockingLevel !== "all_derived") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["blockingLevel"], message: "Stale freshness must fail closed" });
      }
    }

    const overrideState = ["sync_error", "reauthorization_required", "disconnected", "unknown"].includes(value.status);
    if (overrideState && value.blockingLevel !== "current_intelligence" && value.blockingLevel !== "all_derived") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["blockingLevel"], message: "Override freshness states must fail closed" });
    }
  });

export type FreshnessState = Readonly<z.infer<typeof FreshnessStateSchema>>;

export function isFreshnessEligibleForCurrentAnalysis(state: FreshnessState) {
  const parsed = FreshnessStateSchema.parse(state);
  return (
    (parsed.status === "current" || parsed.status === "aging") &&
    (parsed.blockingLevel === "none" || parsed.blockingLevel === "warning")
  );
}

const sourceWatermarkSchema = z
  .object({
    providerKey: ProviderKeySchema,
    mappingId: UuidSchema,
    streamKey: BoundedIdentifierSchema,
    watermarkAt: IsoTimestampSchema
  })
  .strict();

const deltaEvidenceReferenceSchema = z
  .object({
    factVersionId: UuidSchema,
    factFingerprint: Sha256FingerprintSchema,
    sourceFingerprints: uniqueStringArray(
      Sha256FingerprintSchema,
      EXTERNAL_INTEGRATION_LIMITS.evidenceReferencesPerItem
    )
  })
  .strict();

const deltaSeveritySchema = z.enum(["none", "low", "medium", "high", "critical"]);

export const BusinessStateChangeSchema = z
  .object({
    changeKey: BoundedIdentifierSchema,
    changeKind: z.enum(["created", "changed", "removed"]),
    nodeType: z.enum(["aggregate", "kpi", "business_health", "deterministic_risk", "deterministic_opportunity"]),
    nodeKey: BoundedIdentifierSchema,
    metricKey: BoundedIdentifierSchema.nullable(),
    period: z.object({ start: IsoDateSchema, end: IsoDateSchema }).strict().nullable(),
    before: CanonicalFactValueSchema.nullable(),
    after: CanonicalFactValueSchema.nullable(),
    absoluteDelta: PersistedFactDecimalSchema.nullable(),
    relativeDelta: PersistedFactDecimalSchema.nullable(),
    unit: BoundedIdentifierSchema.nullable(),
    currency: CurrencyCodeSchema.nullable(),
    thresholdTransition: z.enum(["none", "entered", "exited", "escalated", "deescalated"]),
    severityBefore: deltaSeveritySchema,
    severityAfter: deltaSeveritySchema,
    confidence: PersistedUnitIntervalDecimalSchema,
    evidence: z.array(deltaEvidenceReferenceSchema).min(1).max(EXTERNAL_INTEGRATION_LIMITS.evidenceReferencesPerItem)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.period && value.period.start > value.period.end) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["period"], message: "Change period start must not follow its end" });
    }
    if (value.changeKind === "created" && (value.before !== null || value.after === null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Created changes require only an after value" });
    }
    if (value.changeKind === "removed" && (value.before === null || value.after !== null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Removed changes require only a before value" });
    }
    if (value.changeKind === "changed" && (value.before === null || value.after === null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Changed values require both before and after values" });
    }
  });

const correlatedGroupSchema = z
  .object({
    groupKey: BoundedIdentifierSchema,
    memberChangeKeys: uniqueStringArray(BoundedIdentifierSchema, EXTERNAL_INTEGRATION_LIMITS.sourceFactsPerDelta),
    deterministicReason: BoundedTextSchema
  })
  .strict();

const deterministicDevelopmentSchema = z
  .object({
    developmentKey: BoundedIdentifierSchema,
    priority: z.enum(["high", "medium", "low"]),
    title: BoundedLabelSchema,
    summary: BoundedTextSchema,
    impactValue: PersistedFactDecimalSchema.nullable(),
    evidenceFactFingerprints: uniqueStringArray(
      Sha256FingerprintSchema,
      EXTERNAL_INTEGRATION_LIMITS.evidenceReferencesPerItem
    )
  })
  .strict();

export const MaterialityDecisionSchema = z.enum([
  "no_ai",
  "defer_to_brief",
  "luna_eligible",
  "terra_eligible",
  "sol_eligible"
]);

export const AnalysisRouteSchema = z.enum(["defer_to_brief", "luna", "terra", "sol"]);

export const BusinessStateDeltaV2Schema = z
  .object({
    contractVersion: z.literal(EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.businessStateDelta),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    changeSetId: UuidSchema,
    fromDeterministicWatermark: Sha256FingerprintSchema,
    toDeterministicWatermark: Sha256FingerprintSchema,
    fromStateFingerprint: Sha256FingerprintSchema,
    toStateFingerprint: Sha256FingerprintSchema,
    asOf: IsoTimestampSchema,
    window: z.object({ start: IsoTimestampSchema, end: IsoTimestampSchema }).strict(),
    sourceWatermarks: z.array(sourceWatermarkSchema).max(EXTERNAL_INTEGRATION_LIMITS.freshnessDomainsPerDelta),
    freshness: z.array(FreshnessStateSchema).max(EXTERNAL_INTEGRATION_LIMITS.freshnessDomainsPerDelta),
    changes: z.array(BusinessStateChangeSchema).max(EXTERNAL_INTEGRATION_LIMITS.sourceFactsPerDelta),
    correlatedGroups: z.array(correlatedGroupSchema).max(EXTERNAL_INTEGRATION_LIMITS.signalsPerDelta),
    deterministicRisks: z.array(deterministicDevelopmentSchema).max(EXTERNAL_INTEGRATION_LIMITS.signalsPerDelta),
    deterministicOpportunities: z.array(deterministicDevelopmentSchema).max(EXTERNAL_INTEGRATION_LIMITS.signalsPerDelta),
    materiality: z
      .object({
        policyVersion: BoundedIdentifierSchema,
        fingerprint: Sha256FingerprintSchema,
        level: z.enum(["none", "informational", "meaningful", "high", "critical"]),
        decision: MaterialityDecisionSchema,
        reasons: uniqueStringArray(BoundedIdentifierSchema, 32),
        persistenceState: z.enum(["not_required", "pending", "satisfied"]),
        cooldownState: z.enum(["clear", "active", "bypassed"])
      })
      .strict(),
    eligibleRoutes: uniqueStringArray(AnalysisRouteSchema, 4),
    limitations: z.array(BoundedTextSchema).max(64),
    deltaFingerprint: Sha256FingerprintSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.window.start > value.window.end) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["window"], message: "Delta window start must not follow its end" });
    }

    const watermarkKeys = value.sourceWatermarks.map(
      (item) => `${item.providerKey}:${item.mappingId}:${item.streamKey}`
    );
    if (new Set(watermarkKeys).size !== watermarkKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceWatermarks"], message: "Source watermarks must be unique" });
    }

    const freshnessKeys = value.freshness.map(
      (item) => `${item.connectionId ?? "none"}:${item.mappingId ?? "none"}:${item.domain}:${item.scopeKey}`
    );
    if (new Set(freshnessKeys).size !== freshnessKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["freshness"], message: "Freshness entries must be unique" });
    }

    const changeKeys = value.changes.map((item) => item.changeKey);
    if (new Set(changeKeys).size !== changeKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["changes"], message: "Delta change keys must be unique" });
    }

    const changeKeySet = new Set(changeKeys);
    const groupKeys = value.correlatedGroups.map((item) => item.groupKey);
    if (new Set(groupKeys).size !== groupKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["correlatedGroups"], message: "Correlation group keys must be unique" });
    }
    for (const [groupIndex, group] of value.correlatedGroups.entries()) {
      for (const member of group.memberChangeKeys) {
        if (!changeKeySet.has(member)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["correlatedGroups", groupIndex, "memberChangeKeys"],
            message: "Correlation groups may reference only changes in this delta"
          });
        }
      }
    }

    const developmentKeys = [...value.deterministicRisks, ...value.deterministicOpportunities].map(
      (item) => item.developmentKey
    );
    if (new Set(developmentKeys).size !== developmentKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Deterministic development keys must be unique" });
    }

    const hasUnsafeFreshness = value.freshness.some(
      (state) => state.blockingLevel === "current_intelligence" || state.blockingLevel === "all_derived"
    );
    if (hasUnsafeFreshness && value.eligibleRoutes.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["eligibleRoutes"], message: "Unsafe freshness must fail closed" });
    }
    if (hasUnsafeFreshness && value.materiality.decision !== "no_ai") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["materiality", "decision"], message: "Unsafe freshness cannot be analysis-eligible" });
    }

    const requiredRoute: Readonly<Record<z.infer<typeof MaterialityDecisionSchema>, z.infer<typeof AnalysisRouteSchema> | null>> = {
      no_ai: null,
      defer_to_brief: "defer_to_brief",
      luna_eligible: "luna",
      terra_eligible: "terra",
      sol_eligible: "sol"
    };
    const expectedRoute = requiredRoute[value.materiality.decision];
    if (expectedRoute === null && value.eligibleRoutes.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["eligibleRoutes"], message: "No-AI materiality cannot have an eligible route" });
    }
    if (expectedRoute !== null && !value.eligibleRoutes.includes(expectedRoute)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["eligibleRoutes"], message: "Materiality decision requires its matching route" });
    }
  });

export type BusinessStateDeltaV2 = Readonly<z.infer<typeof BusinessStateDeltaV2Schema>>;
