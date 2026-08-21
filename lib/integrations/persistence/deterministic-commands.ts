import { z } from "zod";

import {
  BoundedIdentifierSchema,
  IsoTimestampSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import {
  DETERMINISTIC_CALCULATION_POLICY_VERSION,
  DETERMINISTIC_CONTRACT_VERSIONS,
  DeterministicNodeStateSchema,
  DirtyNodeSchema
} from "@/lib/integrations/deterministic/contracts";

export const DeterministicChangeSetCommitSchema = z
  .object({
    contractVersion: z.literal(DETERMINISTIC_CONTRACT_VERSIONS.changeSet),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    executionMode: z.enum(["incremental", "clean_full"]),
    inputContributionFingerprint: Sha256FingerprintSchema,
    dependencyRegistryVersion: BoundedIdentifierSchema,
    dependencyRegistryFingerprint: Sha256FingerprintSchema,
    calculationPolicyVersion: z.literal(DETERMINISTIC_CALCULATION_POLICY_VERSION),
    priorDeterministicWatermark: Sha256FingerprintSchema.nullable(),
    priorStateFingerprint: Sha256FingerprintSchema.nullable(),
    changeSetFingerprint: Sha256FingerprintSchema,
    requestedAt: IsoTimestampSchema
  })
  .strict();

export const DependencyDirtyNodeCommitSchema = DirtyNodeSchema.extend({
  changeSetId: UuidSchema
}).strict();

export const DeterministicStateCommitSchema = DeterministicNodeStateSchema;

export const DeterministicChangeSetResultSchema = z
  .object({
    changeSetId: UuidSchema,
    expectedRowVersion: z.number().int().positive().safe(),
    inputContributionFingerprint: Sha256FingerprintSchema,
    resultWatermark: Sha256FingerprintSchema.nullable(),
    resultStateFingerprint: Sha256FingerprintSchema.nullable(),
    incrementalStateFingerprint: Sha256FingerprintSchema,
    cleanStateFingerprint: Sha256FingerprintSchema,
    equivalenceStatus: z.enum(["matched", "mismatched"]),
    failureCode: BoundedIdentifierSchema.nullable(),
    failureFingerprint: Sha256FingerprintSchema.nullable(),
    completedAt: IsoTimestampSchema,
    states: z.array(DeterministicStateCommitSchema).max(10_000)
  })
  .strict()
  .superRefine((result, context) => {
    const matched = result.equivalenceStatus === "matched";
    if (
      matched !==
      (result.incrementalStateFingerprint === result.cleanStateFingerprint) ||
      matched !== (result.failureCode === null && result.failureFingerprint === null) ||
      matched !== (result.resultWatermark !== null && result.resultStateFingerprint !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Deterministic result and equivalence disposition disagree"
      });
    }
    if (!matched && result.states.length !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["states"],
        message: "Quarantined mismatches cannot publish candidate state"
      });
    }
  });

export type DeterministicChangeSetCommit = Readonly<
  z.infer<typeof DeterministicChangeSetCommitSchema>
>;
export type DependencyDirtyNodeCommit = Readonly<
  z.infer<typeof DependencyDirtyNodeCommitSchema>
>;
export type DeterministicChangeSetResult = Readonly<
  z.infer<typeof DeterministicChangeSetResultSchema>
>;
