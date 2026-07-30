import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import type { BusinessHealthExplanationModelOutput, BusinessHealthExplanationPackage } from "@/lib/ai/business-health-explanation/contracts";
import { extractClaimsV1 } from "@/lib/ai/trust/claim-extraction";
import { materialTerms, normalizedTrustNumber, normalizedTrustText, ruleResult, runDeterministicTrustRulesV1, strongestValidationOutcomeV1, termsOverlap, type DeterministicTrustRuleV1 } from "@/lib/ai/trust/deterministic-rules";
import { TRUST_CLAIM_EXTRACTOR_VERSION_V1, TRUST_RESULT_CONTRACT_VERSION_V1, TRUST_RULESET_VERSION_V1, type ClaimV1, type ReferencedValueV1, type RuleResultV1, type TrustProjectionBindingV1, type TrustResultV1, type TrustShadowExecutionV1, type UserVisibleTrustStatusV1, type ValidationOutcomeV1 } from "@/lib/ai/trust/contracts";
import type { BusinessHealthExplanationProjectionV1 } from "@/lib/intelligence/snapshot/v1/projections";

const WORKFLOW_ID = "business_health_explanation_v1" as const;
const NUMBER_PATTERN = /(?<![A-Za-z0-9])-?\$?\d[\d,]*(?:\.\d+)?%?/g;
const DATE_PATTERN = /\b(?:\d{4}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?)\b/gi;
const QUALIFIER_PATTERN = /\b(?:may|might|could|suggests?|appears?|reported|according to|the business note|the note)\b/i;
const ATTRIBUTION_PATTERN = /\b(?:business note|reported context|according to the note|the note reports?|the author reports?|user-provided)\b/i;
const CAUSAL_PATTERN = /\b(?:caused? by|because of|results? in|leads? to|drives?|due to|therefore|consequently)\b/i;
const OVERCONFIDENT_PATTERN = /\b(?:certain|definitiv(?:e|ely)|proven|conclusive|guaranteed|without doubt)\b/i;
const DIRECTION_PAIRS = [["above", "below"], ["higher", "lower"], ["increase", "decrease"], ["increased", "decreased"], ["improved", "worsened"], ["favorable", "unfavorable"], ["maximize", "minimize"]] as const;

type KnownValue = ReferencedValueV1 & Readonly<{ canonicalPath: string; sourceText: string; aliases: readonly string[]; evidenceIds: readonly string[]; citationIds: readonly number[] }>;
type DriverText = Readonly<{ path: string; label: string; text: string; citationIds: readonly number[]; evidenceIds: readonly string[] }>;
type BusinessHealthTrustContext = Readonly<{
  workspaceId: string;
  analysisPackage: BusinessHealthExplanationPackage;
  binding: TrustProjectionBindingV1 | null;
  expectedSnapshotFingerprint: string | null;
  expectedProjectionFingerprint: string | null;
  knownValues: readonly KnownValue[];
  approvedDates: readonly string[];
  driverTexts: readonly DriverText[];
  contextualTexts: readonly string[];
  contradictionExposed: boolean;
  execution: TrustShadowExecutionV1;
}>;

export type BusinessHealthTrustShadowInputV1 = Readonly<{
  workspaceId: string;
  validatedOutput: BusinessHealthExplanationModelOutput;
  boundedProjection: BusinessHealthExplanationPackage;
  provider: string;
  model: string;
  requestId: string | null;
  generationTimestamp: string;
  releaseChannel: "production" | "preview" | "development";
  execution: TrustShadowExecutionV1;
  expectedSnapshotFingerprint?: string | null;
  expectedProjectionFingerprint?: string | null;
}>;

function numericMatches(value: string) {
  return Array.from(value.matchAll(new RegExp(NUMBER_PATTERN.source, "g")), (match) => match[0]);
}
function dates(value: string) {
  return Array.from(value.matchAll(new RegExp(DATE_PATTERN.source, "gi")), (match) => match[0]);
}
function precision(raw: string) {
  const normalized = raw.replace(/[$,%\s,]/g, "");
  return normalized.includes(".") ? normalized.split(".")[1]?.length || 0 : 0;
}
function valueKind(raw: string): ReferencedValueV1["kind"] {
  return raw.includes("$") ? "currency" : raw.includes("%") ? "percentage" : "number";
}
function valueRole(sourceText: string, raw: string): ReferencedValueV1["role"] {
  const index = sourceText.indexOf(raw);
  const before = sourceText.slice(Math.max(0, index - 24), index).toLowerCase();
  const after = sourceText.slice(index + raw.length, index + raw.length + 18).toLowerCase();
  const local = `${before} ${after}`;
  if (/target\s*(?:is|was|:|=)?\s*$/.test(before) || /^\s*(?:is\s+)?(?:the\s+)?target\b/.test(after)) return "target";
  if (/(?:actual|current|latest)\s*(?:is|was|:|=)?\s*$/.test(before)) return "actual";
  if (/previous\s*(?:is|was|:|=)?\s*$/.test(before)) return "comparison";
  if (local.includes("score")) return "score";
  if (local.includes("penalty") || local.includes("adjustment") || local.includes("base")) return "component";
  return "unknown";
}

function knownValue(input: { raw: string; canonicalPath: string; sourceText: string; aliases?: readonly string[]; evidenceIds?: readonly string[]; citationIds?: readonly number[]; asOf?: string | null; role?: ReferencedValueV1["role"] }): KnownValue {
  const normalized = normalizedTrustNumber(input.raw);
  const index = input.sourceText.indexOf(input.raw);
  const local = input.sourceText.slice(Math.max(0, index - 18), index + input.raw.length + 20).toLowerCase();
  const explicitUnit = local.match(/\b(?:minutes?|hours?|days?|weeks?|months?|years?|points?|items?|orders?|transports?|staff)\b/)?.[0] || null;
  return {
    raw: input.raw, normalized, kind: valueKind(input.raw), canonicalPath: input.canonicalPath,
    role: input.role || valueRole(input.sourceText, input.raw),
    sign: normalized.startsWith("-") ? "negative" : input.raw.startsWith("+") ? "positive" : "unsigned",
    unit: input.raw.includes("$") ? "currency" : input.raw.includes("%") ? "percent" : explicitUnit?.replace(/s$/, "") || null,
    precision: precision(input.raw), asOf: input.asOf || null, sourceText: input.sourceText,
    aliases: input.aliases || [], evidenceIds: input.evidenceIds || [], citationIds: input.citationIds || []
  };
}

function buildKnownValues(analysisPackage: BusinessHealthExplanationPackage) {
  const values: KnownValue[] = [];
  const scalarFacts = [["facts.score", analysisPackage.facts.score, "score"], ["facts.comparisonDelta", analysisPackage.facts.comparisonDelta, "comparison"], ["facts.dataQualityBase", analysisPackage.facts.dataQualityBase, "component"], ["facts.riskPenalty", analysisPackage.facts.riskPenalty, "component"], ["facts.opportunityAdjustment", analysisPackage.facts.opportunityAdjustment, "component"]] as const;
  for (const [canonicalPath, value, role] of scalarFacts) if (value !== null) values.push(knownValue({ raw: String(value), canonicalPath, sourceText: `${canonicalPath} ${value}`, role }));
  analysisPackage.facts.drivers.forEach((driver, index) => {
    const sourceText = `${driver.label} ${driver.fact}`;
    for (const raw of numericMatches(sourceText)) values.push(knownValue({ raw, canonicalPath: `facts.drivers.${index}.fact`, sourceText, aliases: [driver.label], citationIds: driver.citationIds }));
    values.push(knownValue({ raw: String(driver.scoreImpact), canonicalPath: `facts.drivers.${index}.scoreImpact`, sourceText: `${driver.label} score impact ${driver.scoreImpact}`, aliases: [driver.label], citationIds: driver.citationIds, role: "component" }));
  });
  analysisPackage.manifest.evidence.forEach((entry, index) => {
    const sourceText = `${entry.title} ${entry.excerpt} ${entry.summary || ""}`;
    for (const raw of numericMatches(sourceText)) values.push(knownValue({ raw, canonicalPath: `manifest.evidence.${index}`, sourceText, aliases: [entry.title], evidenceIds: [entry.candidateId], citationIds: [entry.citationId], asOf: entry.recordedAt }));
  });
  (analysisPackage.contextualEvidence || []).forEach((record, index) => {
    const sourceText = [record.title, record.summary, ...record.statements.map((statement) => statement.text)].join(" ");
    for (const raw of numericMatches(sourceText)) values.push(knownValue({ raw, canonicalPath: `contextualEvidence.${index}`, sourceText, aliases: [record.title], evidenceIds: [record.contextRef], asOf: record.observedAt }));
  });
  return values;
}

function buildDriverTexts(analysisPackage: BusinessHealthExplanationPackage): DriverText[] {
  const evidenceByCitation = new Map(analysisPackage.manifest.evidence.map((entry) => [entry.citationId, entry]));
  return analysisPackage.facts.drivers.map((driver, index) => ({
    path: `facts.drivers.${index}`,
    label: driver.label,
    text: `${driver.label} ${driver.fact}`,
    citationIds: driver.citationIds,
    evidenceIds: driver.citationIds.flatMap((id) => {
      const evidence = evidenceByCitation.get(id);
      return evidence ? [evidence.candidateId] : [];
    })
  }));
}
function driverIdentityMatches(claimText: string, label: string) {
  const generic = new Set(["above", "below", "better", "current", "explicit", "higher", "latest", "lower", "result", "target"]);
  const claimTerms = new Set(materialTerms(claimText));
  return materialTerms(label).filter((term) => !generic.has(term)).some((term) => claimTerms.has(term));
}
function matchingDrivers(claim: ClaimV1, context: BusinessHealthTrustContext) {
  return context.driverTexts.filter((driver) => driverIdentityMatches(claim.text, driver.label));
}
function matchingValues(claim: ClaimV1, context: BusinessHealthTrustContext) {
  return claim.referencedValues.flatMap((value) => context.knownValues.filter((known) => known.normalized === value.normalized));
}
function enrichClaims(claims: readonly ClaimV1[], context: BusinessHealthTrustContext) {
  return claims.map((claim) => {
    const drivers = matchingDrivers(claim, context);
    const values = matchingValues(claim, context);
    return { ...claim,
      supportingEvidenceIds: Array.from(new Set([...drivers.flatMap((driver) => driver.evidenceIds), ...values.flatMap((value) => value.evidenceIds)])),
      citationIds: Array.from(new Set([...claim.citationIds, ...drivers.flatMap((driver) => driver.citationIds), ...values.flatMap((value) => value.citationIds)])).sort((a, b) => a - b),
      deterministicReferences: Array.from(new Set([...drivers.map((driver) => driver.path), ...values.map((value) => value.canonicalPath)])).sort(),
      referencedValues: claim.referencedValues.map((value) => { const known = context.knownValues.find((item) => item.normalized === value.normalized); return known ? { ...value, canonicalPath: known.canonicalPath, asOf: known.asOf } : value; }),
      kpiReferences: drivers.map((driver) => driver.label)
    } satisfies ClaimV1;
  });
}
function claimsWithNumbers(claims: readonly ClaimV1[]) {
  return claims.filter((claim) => claim.referencedValues.some((value) => ["number", "currency", "percentage"].includes(value.kind)));
}
function oppositeDirection(claimText: string, sourceText: string) {
  const claim = normalizedTrustText(claimText);
  const source = normalizedTrustText(sourceText);
  return DIRECTION_PAIRS.some(([left, right]) => (claim.includes(left) && source.includes(right)) || (claim.includes(right) && source.includes(left)));
}

function makeRules(): readonly DeterministicTrustRuleV1<BusinessHealthTrustContext>[] {
  return [
    { id: "schema_workflow_binding", evaluate: (_claims, context) => context.analysisPackage.contractId === WORKFLOW_ID ? ruleResult({ deterministicReferences: ["contractId", "contractVersion", "validatorVersion"] }) : ruleResult({ outcome: "would_reject", reasonCodes: ["workflow_contract_mismatch"] }) },
    { id: "workspace_fingerprint_binding", evaluate: (_claims, context) => {
      const reasons: string[] = [];
      if (context.analysisPackage.manifest.workspaceId !== context.workspaceId) reasons.push("workspace_scope_mismatch");
      if (!context.binding) reasons.push("trust_projection_binding_missing");
      if (context.binding && context.expectedSnapshotFingerprint && context.binding.snapshotFingerprint !== context.expectedSnapshotFingerprint) reasons.push("snapshot_fingerprint_mismatch");
      if (context.binding && context.expectedProjectionFingerprint && context.binding.projectionFingerprint !== context.expectedProjectionFingerprint) reasons.push("projection_fingerprint_mismatch");
      return reasons.length ? ruleResult({ outcome: reasons.includes("workspace_scope_mismatch") ? "would_reject" : "unresolved", reasonCodes: reasons }) : ruleResult({ deterministicReferences: ["trustBinding.snapshotFingerprint", "trustBinding.projectionFingerprint", "manifest.workspaceId"] });
    } },
    { id: "numeric_value_occurrence", evaluate: (claims, context) => { const bad = claimsWithNumbers(claims).filter((claim) => matchingValues(claim, context).length === 0); return bad.length ? ruleResult({ outcome: "would_reject", reasonCodes: ["numeric_value_not_in_bounded_input"], claimIds: bad.map((claim) => claim.claimId) }) : ruleResult(); } },
    { id: "numeric_value_binding", evaluate: (claims, context) => {
      const unresolved = claimsWithNumbers(claims).filter((claim) => { const values = matchingValues(claim, context); return values.length > 1 && !values.some((value) => value.aliases.some((alias) => driverIdentityMatches(claim.text, alias))); });
      const unitMismatch = claimsWithNumbers(claims).filter((claim) => claim.referencedValues.some((value) => { const matches = context.knownValues.filter((known) => known.normalized === value.normalized); return matches.length > 0 && matches.every((known) => Boolean(known.unit) && value.unit !== known.unit); }));
      const precisionMismatch = claimsWithNumbers(claims).filter((claim) => claim.referencedValues.some((value) => { const matches = context.knownValues.filter((known) => known.normalized === value.normalized); return matches.length > 0 && matches.every((known) => known.precision !== null && value.precision !== known.precision); }));
      if (unitMismatch.length) return ruleResult({ outcome: "would_reject", reasonCodes: ["numeric_unit_mismatch"], claimIds: unitMismatch.map((claim) => claim.claimId) });
      if (precisionMismatch.length) return ruleResult({ outcome: "would_reject", reasonCodes: ["numeric_precision_mismatch"], claimIds: precisionMismatch.map((claim) => claim.claimId) });
      return unresolved.length ? ruleResult({ outcome: "unresolved", reasonCodes: ["numeric_binding_ambiguous"], claimIds: unresolved.map((claim) => claim.claimId) }) : ruleResult();
    } },
    { id: "kpi_identity", evaluate: (claims, context) => {
      const wrong = claimsWithNumbers(claims).filter((claim) => { const values = matchingValues(claim, context); const matched = matchingDrivers(claim, context); return values.some((value) => value.aliases.length && matched.length && !value.aliases.some((alias) => matched.some((driver) => driverIdentityMatches(alias, driver.label)))); });
      const unsupportedRecommendation = claims.filter((claim) => claim.claimTypes.includes("recommendation") && !matchingDrivers(claim, context).length);
      const unresolved = claims.filter((claim) => claim.claimType === "unknown_material_claim" && !matchingDrivers(claim, context).length);
      if (wrong.length) return ruleResult({ outcome: "would_reject", reasonCodes: ["numeric_value_bound_to_wrong_kpi"], claimIds: wrong.map((claim) => claim.claimId) });
      if (unsupportedRecommendation.length) return ruleResult({ outcome: "unresolved", reasonCodes: ["recommendation_rationale_unresolved"], claimIds: unsupportedRecommendation.map((claim) => claim.claimId) });
      return unresolved.length ? ruleResult({ outcome: "unresolved", reasonCodes: ["material_claim_kpi_identity_unresolved"], claimIds: unresolved.map((claim) => claim.claimId) }) : ruleResult();
    } },
    { id: "kpi_direction_semantics", evaluate: (claims, context) => { const bad = claims.filter((claim) => matchingDrivers(claim, context).some((driver) => oppositeDirection(claim.text, driver.text))); return bad.length ? ruleResult({ outcome: "would_reject", reasonCodes: ["kpi_direction_or_semantic_meaning_reversed"], claimIds: bad.map((claim) => claim.claimId) }) : ruleResult(); } },
    { id: "target_actual_distinction", evaluate: (claims, context) => {
      const bad = claimsWithNumbers(claims).filter((claim) => claim.referencedValues.some((value) => {
        if (value.role === "unknown") return false;
        const matches = context.knownValues.filter((known) => known.normalized === value.normalized);
        return matches.length > 0 && matches.every((known) => known.role !== "unknown" && known.role !== value.role);
      }));
      return bad.length ? ruleResult({ outcome: "would_reject", reasonCodes: ["actual_target_role_reversed"], claimIds: bad.map((claim) => claim.claimId) }) : ruleResult();
    } },
    { id: "date_reporting_period_consistency", evaluate: (claims, context) => { const bad = claims.filter((claim) => dates(claim.text).some((date) => !context.approvedDates.some((approved) => approved.toLowerCase().includes(date.toLowerCase()) || date.toLowerCase().includes(approved.toLowerCase())))); return bad.length ? ruleResult({ outcome: "would_reject", reasonCodes: ["date_or_reporting_period_not_in_bounded_input"], claimIds: bad.map((claim) => claim.claimId) }) : ruleResult(); } },
    { id: "confidence_ceiling_language", evaluate: (claims, context) => { const bad = claims.filter((claim) => OVERCONFIDENT_PATTERN.test(claim.text)); return bad.length ? ruleResult({ outcome: context.analysisPackage.facts.confidence === "High" ? "qualifier_required" : "would_reject", reasonCodes: ["confidence_language_exceeds_deterministic_ceiling"], claimIds: bad.map((claim) => claim.claimId), qualifierRequirements: ["Use language bounded by the application-owned confidence level."] }) : ruleResult({ deterministicReferences: ["facts.confidence"] }); } },
    { id: "evidence_citation_identity", evaluate: (claims, context) => {
      const permitted = new Set(context.analysisPackage.manifest.evidence.map((entry) => entry.citationId));
      const invalid = claims.filter((claim) => claim.citationIds.some((citationId) => !permitted.has(citationId)));
      const unresolvedTypes = new Set(["supported_evidence_fact", "citation_bearing_claim", "unknown_material_claim"]);
      const unresolved = claims.filter((claim) => claim.claimTypes.some((claimType) => unresolvedTypes.has(claimType)) && !claim.deterministicReferences.length && !claim.supportingEvidenceIds.length);
      if (invalid.length) return ruleResult({ outcome: "would_reject", reasonCodes: ["citation_identity_not_in_manifest"], claimIds: invalid.map((claim) => claim.claimId) });
      return unresolved.length ? ruleResult({ outcome: "unresolved", reasonCodes: ["claim_level_evidence_support_unresolved"], claimIds: unresolved.map((claim) => claim.claimId) }) : ruleResult({ deterministicReferences: ["manifest.manifestId"] });
    } },
    { id: "business_note_attribution", evaluate: (claims, context) => { const bad = claims.filter((claim) => context.contextualTexts.some((text) => termsOverlap(claim.text, text)) && !matchingDrivers(claim, context).length && !ATTRIBUTION_PATTERN.test(claim.text)); return bad.length ? ruleResult({ outcome: "would_reject", reasonCodes: ["business_note_claim_not_attributed"], claimIds: bad.map((claim) => claim.claimId) }) : ruleResult(); } },
    { id: "inference_qualifiers", evaluate: (claims) => { const bad = claims.filter((claim) => claim.claimTypes.includes("inference") && !QUALIFIER_PATTERN.test(claim.text)); return bad.length ? ruleResult({ outcome: "qualifier_required", reasonCodes: ["inference_requires_qualifier"], claimIds: bad.map((claim) => claim.claimId), qualifierRequirements: ["Mark the inference as tentative."] }) : ruleResult(); } },
    { id: "causal_language", evaluate: (claims) => { const bad = claims.filter((claim) => CAUSAL_PATTERN.test(claim.text)); return bad.length ? ruleResult({ outcome: "would_reject", reasonCodes: ["causal_relationship_not_authorized"], claimIds: bad.map((claim) => claim.claimId) }) : ruleResult(); } },
    { id: "required_limitations", evaluate: (claims, context) => { if (!context.analysisPackage.facts.limitations.length) return ruleResult(); const combined = claims.map((claim) => claim.text).join(" "); return context.analysisPackage.facts.limitations.some((limitation) => termsOverlap(combined, limitation)) ? ruleResult({ deterministicReferences: ["facts.limitations"] }) : ruleResult({ outcome: "qualifier_required", reasonCodes: ["required_limitation_not_visible_in_generated_prose"], qualifierRequirements: ["Keep the application-owned limitation visible with the explanation."] }); } },
    { id: "contradiction_visibility", evaluate: (claims, context) => !context.contradictionExposed || claims.some((claim) => /\b(?:conflict|disagree(?:s|d|ment)?|contradict(?:s|ed|ion)?|inconsistent)\b/i.test(claim.text)) ? ruleResult() : ruleResult({ outcome: "would_omit", reasonCodes: ["bounded_contradiction_not_visible"] }) },
    { id: "stale_snapshot_projection_binding", evaluate: (claims, context) => { if (!context.execution.stale) return ruleResult(); const bad = claims.filter((claim) => /\b(?:current|latest|now)\b/i.test(claim.text) && !/\b(?:stale|older|as of|last recorded)\b/i.test(claim.text)); return bad.length ? ruleResult({ outcome: "qualifier_required", reasonCodes: ["stale_input_described_as_current"], claimIds: bad.map((claim) => claim.claimId), qualifierRequirements: ["Disclose the stale evidence boundary."] }) : ruleResult(); } }
  ];
}

function attachRuleOutcomes(claims: readonly ClaimV1[], rules: readonly RuleResultV1[]) {
  return claims.map((claim) => { const claimRules = rules.filter((rule) => rule.claimIds.includes(claim.claimId)); return { ...claim, qualifierRequirements: Array.from(new Set(claimRules.flatMap((rule) => rule.qualifierRequirements))), ruleOutcomes: claimRules.map((rule) => rule.outcome), rejectedReasonCodes: Array.from(new Set(claimRules.filter((rule) => ["would_reject", "would_omit"].includes(rule.outcome)).flatMap((rule) => rule.reasonCodes))) } satisfies ClaimV1; });
}
function userVisibleStatus(outcome: ValidationOutcomeV1): UserVisibleTrustStatusV1 {
  return outcome === "accepted" ? "validated" : outcome === "qualifier_required" ? "qualified" : outcome === "would_reject" ? "unavailable" : "limited";
}
export function createBusinessHealthTrustBindingV1(projection: BusinessHealthExplanationProjectionV1): TrustProjectionBindingV1 {
  return { version: "trust_projection_binding_v1", snapshotFingerprint: projection.snapshotFingerprint, projectionFingerprint: evidenceEngineHash(projection), projectionAsOf: projection.asOf };
}

export function runBusinessHealthTrustShadowV1(input: BusinessHealthTrustShadowInputV1): TrustResultV1 {
  const binding = input.boundedProjection.trustBinding || null;
  const context: BusinessHealthTrustContext = {
    workspaceId: input.workspaceId, analysisPackage: input.boundedProjection, binding,
    expectedSnapshotFingerprint: input.expectedSnapshotFingerprint === undefined ? binding?.snapshotFingerprint || null : input.expectedSnapshotFingerprint,
    expectedProjectionFingerprint: input.expectedProjectionFingerprint === undefined ? binding?.projectionFingerprint || null : input.expectedProjectionFingerprint,
    knownValues: buildKnownValues(input.boundedProjection),
    approvedDates: Array.from(new Set([input.boundedProjection.facts.latestEvidenceAt || "", ...input.boundedProjection.citations.map((citation) => citation.recordedAt || ""), ...(input.boundedProjection.contextualEvidence || []).flatMap((record) => [record.observedAt || "", record.approvedAt])].filter(Boolean))),
    driverTexts: buildDriverTexts(input.boundedProjection),
    contextualTexts: (input.boundedProjection.contextualEvidence || []).map((record) => [record.title, record.summary, ...record.statements.map((statement) => statement.text)].join(" ")),
    contradictionExposed: (input.boundedProjection.contextualEvidence || []).some((record) => /\b(?:conflict|disagree(?:s|d|ment)?|contradict(?:s|ed|ion)?|inconsistent)\b/i.test(`${record.summary} ${record.statements.map((statement) => statement.text).join(" ")}`)),
    execution: input.execution
  };
  const enriched = enrichClaims(extractClaimsV1(input.validatedOutput), context);
  const evaluatedRules = runDeterministicTrustRulesV1({ claims: enriched, context, rules: makeRules() });
  const blockingReasons = evaluatedRules.filter((rule) => ["would_reject", "would_omit"].includes(rule.outcome)).flatMap((rule) => rule.reasonCodes);
  const saveRule: RuleResultV1 = { ruleId: "save_eligibility_shadow", ruleVersion: TRUST_RULESET_VERSION_V1, outcome: blockingReasons.length ? "would_reject" : "accepted", reasonCodes: blockingReasons.length ? ["shadow_save_eligibility_blocked"] : [], claimIds: [], deterministicReferences: ["shadow_rule_outcomes"], qualifierRequirements: [] };
  const rules = [...evaluatedRules, saveRule];
  const claims = attachRuleOutcomes(enriched, rules);
  const overallShadowStatus = strongestValidationOutcomeV1(rules.map((rule) => rule.outcome));
  const responseHash = evidenceEngineHash(input.validatedOutput);
  const workspaceScopeRef = `workspace_scope_${evidenceEngineHash({ workflow: WORKFLOW_ID, workspaceId: input.workspaceId }).slice(0, 24)}`;
  const sections = Object.keys(input.validatedOutput).map((sectionId) => ({ sectionId, claimIds: claims.filter((claim) => claim.sectionId === sectionId).map((claim) => claim.claimId) }));
  const semanticResult = { contractVersion: TRUST_RESULT_CONTRACT_VERSION_V1, rulesetVersion: TRUST_RULESET_VERSION_V1, workflowId: WORKFLOW_ID, workspaceScopeRef, releaseChannel: input.releaseChannel, snapshotFingerprint: binding?.snapshotFingerprint || null, projectionFingerprint: binding?.projectionFingerprint || null, manifestIdentity: input.boundedProjection.manifest.manifestId, provider: input.provider, model: input.model, requestId: input.requestId, generationTimestamp: input.generationTimestamp, responseHash, sections, claims: claims.map(({ text: _text, ...claim }) => claim), rules, overallShadowStatus };
  return Object.freeze({
    contractVersion: TRUST_RESULT_CONTRACT_VERSION_V1, rulesetVersion: TRUST_RULESET_VERSION_V1, claimExtractorVersion: TRUST_CLAIM_EXTRACTOR_VERSION_V1,
    workflowId: WORKFLOW_ID, mode: "shadow", outputContractVersion: input.boundedProjection.contractVersion,
    validatorVersion: input.boundedProjection.validatorVersion, workspaceScopeRef, releaseChannel: input.releaseChannel,
    snapshotFingerprint: binding?.snapshotFingerprint || null, projectionFingerprint: binding?.projectionFingerprint || null,
    manifestIdentity: input.boundedProjection.manifest.manifestId, provider: input.provider, model: input.model,
    requestId: input.requestId, generationTimestamp: input.generationTimestamp, repairCount: 0, additionalProviderCalls: 0,
    responseHash, sections, claims, rules, overallShadowStatus, userVisibleStatus: userVisibleStatus(overallShadowStatus),
    saveEligibility: { wouldBeEligible: blockingReasons.length === 0, enforced: false as const, reasonCodes: Array.from(new Set(blockingReasons)) },
    trustFingerprint: evidenceEngineHash(semanticResult)
  });
}
