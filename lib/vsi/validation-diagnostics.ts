import { z } from "zod";
import { SharedAnswerContractError, sharedAnswerRules, type SharedAnswerRule, type SharedAnswerCoverageDiagnostic } from "@/lib/ai/shared-evidence/answer-contract";

export type VsiValidationStage = "answer_json" | "answer_schema" | "shared_relationships"
  | "qualitative_interpretation" | "shared_answer_contract" | "planner_clarification" | "citation_resolution" | "public_source_coverage";

const reasons = [
  "shared_relationship_dependency_missing", "shared_relationship_citation_missing", "shared_relationship_claim_changed",
  "interpretation_duplicate_reference", "interpretation_duplicate_context_reference", "interpretation_duplicate_premise",
  "interpretation_premise_changed", "interpretation_distinct_dependencies_required",
  "interpretation_environment_changed", "interpretation_qualification_required", "interpretation_unsupported_characters",
  "interpretation_assertion_denied", "interpretation_attribution_denied", "interpretation_unsupported_term", "interpretation_grounding_missing"
] as const;
type Reason = typeof reasons[number] | "malformed_json" | "schema_invalid" | "unknown_citation"
  | "unverified_url" | "financial_input_missing" | "uncomposed_interpretation" | "web_source_missing" | "shared_answer_contract_denied" | "unclassified";
export type VsiValidationDiagnostic = Readonly<{
  stage: VsiValidationStage; category: "output_validation" | "citation_validation"; reason: Reason;
  schemaIssueCount?: number; schemaIssueCodes?: string[]; schemaFields?: string[];
  contractRule?: SharedAnswerRule;
  coverage?: SharedAnswerCoverageDiagnostic;
}>;

const schemaCodes = new Set(["invalid_type", "invalid_value", "invalid_string", "invalid_format", "too_big", "too_small", "unrecognized_keys", "invalid_union", "custom"]);
const schemaFields = new Set(["content", "citationIds", "interpretations", "premises", "ref", "binding", "quote", "hypothesis", "missing_information", "next_check", "observations", "results", "hypotheses", "next_checks", "factIndex", "text"]);
const messages = new Map<string, Reason>([
  ...reasons.map(reason => [reason, reason] as const),
  ["Vaeroex could not verify the answer's citations. Please retry.", "unknown_citation"],
  ["Vaeroex could not verify a link in the answer. Please retry.", "unverified_url"],
  ["Vaeroex could not verify a financial calculation's input source. Please retry.", "financial_input_missing"],
  ["Interpretations require current admitted source composition before citation validation.", "uncomposed_interpretation"],
  ["The live answer omitted its source.", "web_source_missing"]
]);

/** Closed enums and counts only. Never return/log exception messages, unknown
 * keys, received values, quotes, source identities, URLs or provider output. */
export function vsiValidationDiagnostic(stage: VsiValidationStage, error: unknown): VsiValidationDiagnostic {
  const category = stage === "answer_json" || stage === "answer_schema" || stage === "planner_clarification" ? "output_validation" : "citation_validation";
  if ((stage === "shared_answer_contract" || stage === "planner_clarification") && error instanceof SharedAnswerContractError) return { stage, category, reason: "shared_answer_contract_denied",
    ...(sharedAnswerRules.some(rule => rule === error.rule) ? { contractRule: error.rule } : {}),
    ...(error.rule === "source_coverage" && error.coverage ? { coverage: {
      availableReferences: boundedCount(error.coverage.availableReferences), observedReferences: boundedCount(error.coverage.observedReferences),
      requiredGroups: boundedCount(error.coverage.requiredGroups), missingGroups: boundedCount(error.coverage.missingGroups)
    } } : {}) };
  if (error instanceof z.ZodError) {
    const issues = error.issues.slice(0, 32);
    return { stage, category, reason: "schema_invalid", schemaIssueCount: Math.min(error.issues.length, 999),
      schemaIssueCodes: [...new Set(issues.map(issue => schemaCodes.has(issue.code) ? issue.code : "other"))],
      schemaFields: [...new Set(issues.map(issue => issue.path.filter((part): part is string => typeof part === "string" && schemaFields.has(part)).join(".") || "root"))] };
  }
  return { stage, category, reason: stage === "answer_json" ? "malformed_json"
    : error instanceof Error ? messages.get(error.message) || "unclassified" : "unclassified" };
}

function boundedCount(value: number) { return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 999) : 0; }
