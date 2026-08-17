import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import type {
  IntelligenceBriefingClaim,
  IntelligenceBriefingModelOutput,
  IntelligenceBriefingPackage
} from "@/lib/ai/intelligence-briefing/contracts";
import { extractClaimsV1 } from "@/lib/ai/trust/claim-extraction";
import {
  ruleResult,
  strongestValidationOutcomeV1
} from "@/lib/ai/trust/deterministic-rules";
import {
  TRUST_CLAIM_EXTRACTOR_VERSION_V1,
  TRUST_RESULT_CONTRACT_VERSION_V1,
  TRUST_RULESET_VERSION_V1,
  type ClaimV1,
  type RuleResultV1,
  type TrustResultV1,
  type TrustShadowExecutionV1,
  type UserVisibleTrustStatusV1,
  type ValidationOutcomeV1
} from "@/lib/ai/trust/contracts";

const WORKFLOW_ID = "intelligence_briefing_v1" as const;

export type IntelligenceBriefingTrustShadowInputV1 = Readonly<{
  workspaceId: string;
  validatedOutput: IntelligenceBriefingModelOutput;
  boundedProjection: IntelligenceBriefingPackage;
  provider: string;
  model: string;
  requestId: string | null;
  generationTimestamp: string;
  releaseChannel: "production" | "preview" | "development";
  execution: TrustShadowExecutionV1;
}>;

function outputClaims(output: IntelligenceBriefingModelOutput) {
  return [
    output.executive_summary,
    ...output.sections.flatMap((section) => [
      { text: section.summary, support_refs: section.support_refs } satisfies IntelligenceBriefingClaim,
      ...section.claims
    ]),
    ...output.leadership_considerations
  ];
}

function proseSections(output: IntelligenceBriefingModelOutput) {
  return {
    executive_interpretation: output.executive_summary.text,
    why_it_matters: output.sections.flatMap((section) => [section.summary, ...section.claims.map((claim) => claim.text)]).join(" "),
    leadership_consideration: output.leadership_considerations.map((claim) => claim.text).join(" "),
    provisional_hypothesis: null
  } as const;
}

function userVisibleStatus(outcome: ValidationOutcomeV1): UserVisibleTrustStatusV1 {
  return outcome === "accepted" ? "validated" : outcome === "qualifier_required" ? "qualified" : outcome === "would_reject" ? "unavailable" : "limited";
}

export function runIntelligenceBriefingTrustShadowV1(input: IntelligenceBriefingTrustShadowInputV1): TrustResultV1 {
  const signalByRef = new Map(input.boundedProjection.signals.map((signal) => [signal.ref, signal]));
  const modelClaims = outputClaims(input.validatedOutput);
  const claims = extractClaimsV1(proseSections(input.validatedOutput)).map((claim) => {
    const source = modelClaims.find((candidate) => candidate.text.includes(claim.text) || claim.text.includes(candidate.text));
    const refs = source?.support_refs || [];
    const signals = refs.flatMap((ref) => {
      const signal = signalByRef.get(ref);
      return signal ? [signal] : [];
    });
    return {
      ...claim,
      supportingEvidenceIds: Array.from(new Set(signals.flatMap((signal) => signal.evidenceReferenceIds))),
      citationIds: Array.from(new Set(signals.flatMap((signal) => signal.citationIds))).sort((left, right) => left - right),
      deterministicReferences: refs.map((ref) => `signals.${ref}`)
    } satisfies ClaimV1;
  });
  const knownRefs = new Set(input.boundedProjection.signals.map((signal) => signal.ref));
  const invalidRefs = modelClaims.flatMap((claim) => claim.support_refs).filter((ref) => !knownRefs.has(ref));
  const contextRefs = new Set(input.boundedProjection.signals.filter((signal) => signal.authority === "reported_context").map((signal) => signal.ref));
  const unattributedContext = modelClaims.filter((claim) =>
    claim.support_refs.some((ref) => contextRefs.has(ref))
    && !/\b(?:approved business note|business note reports?|leadership reported|reported context|the note reports?)\b/i.test(claim.text)
  );
  const requiredLimitations = new Set(input.boundedProjection.limitations.map((limitation) => limitation.ref));
  const suppliedLimitations = new Set(input.validatedOutput.limitation_refs);
  const rules: RuleResultV1[] = [
    {
      ruleId: "briefing_workflow_workspace_binding",
      ruleVersion: TRUST_RULESET_VERSION_V1,
      ...(input.boundedProjection.contractId === WORKFLOW_ID && input.boundedProjection.workspaceId === input.workspaceId
        ? ruleResult({ deterministicReferences: ["contractId", "workspaceId"] })
        : ruleResult({ outcome: "would_reject", reasonCodes: ["workflow_or_workspace_mismatch"] }))
    },
    {
      ruleId: "briefing_snapshot_projection_binding",
      ruleVersion: TRUST_RULESET_VERSION_V1,
      ...(input.boundedProjection.trustBinding.snapshotFingerprint === input.boundedProjection.snapshotFingerprint
        ? ruleResult({ deterministicReferences: ["trustBinding.snapshotFingerprint", "trustBinding.projectionFingerprint"] })
        : ruleResult({ outcome: "would_reject", reasonCodes: ["snapshot_fingerprint_mismatch"] }))
    },
    {
      ruleId: "briefing_support_reference_integrity",
      ruleVersion: TRUST_RULESET_VERSION_V1,
      ...(invalidRefs.length
        ? ruleResult({ outcome: "would_reject", reasonCodes: ["support_reference_not_in_projection"] })
        : ruleResult({ deterministicReferences: ["signals"] }))
    },
    {
      ruleId: "briefing_business_note_attribution",
      ruleVersion: TRUST_RULESET_VERSION_V1,
      ...(unattributedContext.length
        ? ruleResult({ outcome: "would_reject", reasonCodes: ["business_note_claim_not_attributed"] })
        : ruleResult())
    },
    {
      ruleId: "briefing_required_limitations",
      ruleVersion: TRUST_RULESET_VERSION_V1,
      ...([...requiredLimitations].every((ref) => suppliedLimitations.has(ref))
        ? ruleResult({ deterministicReferences: ["limitations"] })
        : ruleResult({ outcome: "would_omit", reasonCodes: ["required_limitation_not_preserved"] }))
    }
  ];
  const overallShadowStatus = strongestValidationOutcomeV1(rules.map((rule) => rule.outcome));
  const blockingReasons = rules.filter((rule) => ["would_reject", "would_omit"].includes(rule.outcome)).flatMap((rule) => rule.reasonCodes);
  const responseHash = evidenceEngineHash(input.validatedOutput);
  const sections = Array.from(new Set(claims.map((claim) => claim.sectionId))).map((sectionId) => ({
    sectionId,
    claimIds: claims.filter((claim) => claim.sectionId === sectionId).map((claim) => claim.claimId)
  }));
  const workspaceScopeRef = `workspace_scope_${evidenceEngineHash({ workflow: WORKFLOW_ID, workspaceId: input.workspaceId }).slice(0, 24)}`;
  const semanticResult = {
    workflowId: WORKFLOW_ID,
    workspaceScopeRef,
    snapshotFingerprint: input.boundedProjection.trustBinding.snapshotFingerprint,
    projectionFingerprint: input.boundedProjection.trustBinding.projectionFingerprint,
    responseHash,
    rules,
    overallShadowStatus
  };
  return Object.freeze({
    contractVersion: TRUST_RESULT_CONTRACT_VERSION_V1,
    rulesetVersion: TRUST_RULESET_VERSION_V1,
    claimExtractorVersion: TRUST_CLAIM_EXTRACTOR_VERSION_V1,
    workflowId: WORKFLOW_ID,
    mode: "shadow",
    outputContractVersion: input.boundedProjection.contractVersion,
    validatorVersion: input.boundedProjection.validatorVersion,
    workspaceScopeRef,
    releaseChannel: input.releaseChannel,
    snapshotFingerprint: input.boundedProjection.trustBinding.snapshotFingerprint,
    projectionFingerprint: input.boundedProjection.trustBinding.projectionFingerprint,
    manifestIdentity: input.boundedProjection.manifest.manifestId,
    provider: input.provider,
    model: input.model,
    requestId: input.requestId,
    generationTimestamp: input.generationTimestamp,
    repairCount: 0,
    additionalProviderCalls: 0,
    responseHash,
    sections,
    claims,
    rules,
    overallShadowStatus,
    userVisibleStatus: userVisibleStatus(overallShadowStatus),
    saveEligibility: { wouldBeEligible: blockingReasons.length === 0, enforced: false as const, reasonCodes: Array.from(new Set(blockingReasons)) },
    trustFingerprint: evidenceEngineHash(semanticResult)
  });
}
