import { z } from "zod";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  BoundedIdentifierSchema,
  IsoTimestampSchema,
  PersistedFactDecimalSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import {
  CanonicalEconomicIdentitySchema,
  LegacyKpiProvenanceSchema,
  RECONCILIATION_CONTRACT_VERSIONS,
  RECONCILIATION_FINGERPRINT_VERSION,
  ShadowReconciliationCandidateSchema,
  canonicalizeDimensions,
  type ShadowReconciliationCandidateV1
} from "@/lib/integrations/reconciliation/contracts";

export const ProjectLegacyKpiShadowInputSchema = z
  .object({
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    legacyKpiId: UuidSchema,
    kpiKey: BoundedIdentifierSchema,
    exactValue: PersistedFactDecimalSchema,
    economicIdentity: CanonicalEconomicIdentitySchema,
    provenance: LegacyKpiProvenanceSchema,
    projectedAt: IsoTimestampSchema
  })
  .strict();

export function shadowReconciliationCandidateFingerprintInput(input: unknown) {
  const candidate = ShadowReconciliationCandidateSchema.parse(input);
  return {
    fingerprintPurpose: "shadow_reconciliation_candidate",
    fingerprintVersion: RECONCILIATION_FINGERPRINT_VERSION,
    payload: {
      contractVersion: candidate.contractVersion,
      id: candidate.id,
      workspaceId: candidate.workspaceId,
      businessEntityId: candidate.businessEntityId,
      legacyKpiId: candidate.legacyKpiId,
      kpiKey: candidate.kpiKey,
      exactValue: candidate.exactValue,
      economicIdentity: {
        ...candidate.economicIdentity,
        dimensions: canonicalizeDimensions(candidate.economicIdentity.dimensions)
      },
      provenance: candidate.provenance,
      shadowOnly: candidate.shadowOnly,
      promotionAuthorized: candidate.promotionAuthorized
    }
  } as const;
}

export function shadowReconciliationCandidateFingerprint(input: unknown) {
  return contractSha256(shadowReconciliationCandidateFingerprintInput(input));
}

export function projectLegacyKpiShadowCandidate(
  input: unknown
): ShadowReconciliationCandidateV1 {
  const parsed = ProjectLegacyKpiShadowInputSchema.parse(input);
  const withoutFingerprint = ShadowReconciliationCandidateSchema.parse({
    contractVersion: RECONCILIATION_CONTRACT_VERSIONS.shadowCandidate,
    ...parsed,
    economicIdentity: {
      ...parsed.economicIdentity,
      dimensions: canonicalizeDimensions(parsed.economicIdentity.dimensions)
    },
    shadowOnly: true,
    promotionAuthorized: false
  });
  const candidateFingerprint = shadowReconciliationCandidateFingerprint(withoutFingerprint);

  return ShadowReconciliationCandidateSchema.parse({
    ...withoutFingerprint,
    candidateFingerprint
  });
}

export const projectLegacyKpiToShadowReconciliationCandidate =
  projectLegacyKpiShadowCandidate;
