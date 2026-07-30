import { TRUST_RULESET_VERSION_V1, type ClaimV1, type RuleResultV1, type ValidationOutcomeV1 } from "@/lib/ai/trust/contracts";

const OUTCOME_WEIGHT: Record<ValidationOutcomeV1, number> = {
  accepted: 0,
  qualifier_required: 1,
  unresolved: 2,
  would_omit: 3,
  would_reject: 4
};

export type DeterministicTrustRuleV1<TContext> = Readonly<{
  id: string;
  evaluate: (claims: readonly ClaimV1[], context: TContext) => Omit<RuleResultV1, "ruleId" | "ruleVersion">;
}>;

export function ruleResult({ outcome = "accepted", reasonCodes = [], claimIds = [], deterministicReferences = [], qualifierRequirements = [] }: Partial<Omit<RuleResultV1, "ruleId" | "ruleVersion">> = {}) {
  return { outcome, reasonCodes, claimIds, deterministicReferences, qualifierRequirements } satisfies Omit<RuleResultV1, "ruleId" | "ruleVersion">;
}

export function runDeterministicTrustRulesV1<TContext>({ claims, context, rules }: { claims: readonly ClaimV1[]; context: TContext; rules: readonly DeterministicTrustRuleV1<TContext>[] }) {
  return rules.map((rule) => ({ ruleId: rule.id, ruleVersion: TRUST_RULESET_VERSION_V1, ...rule.evaluate(claims, context) })) satisfies RuleResultV1[];
}

export function strongestValidationOutcomeV1(outcomes: readonly ValidationOutcomeV1[]) {
  return outcomes.reduce<ValidationOutcomeV1>((strongest, outcome) => OUTCOME_WEIGHT[outcome] > OUTCOME_WEIGHT[strongest] ? outcome : strongest, "accepted");
}

export function normalizedTrustNumber(value: string) {
  const compact = value.replace(/[$,%\s,]/g, "").replace(/^\+/, "");
  const numeric = Number(compact);
  return Number.isFinite(numeric) ? String(numeric) : compact;
}

export function normalizedTrustText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9%$.-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function materialTerms(value: string) {
  const stop = new Set(["about", "after", "also", "because", "business", "current", "during", "from", "health", "into", "more", "that", "their", "this", "through", "while", "with"]);
  return normalizedTrustText(value).split(" ").filter((term) => term.length >= 4 && !stop.has(term));
}

export function termsOverlap(left: string, right: string) {
  const rightTerms = new Set(materialTerms(right));
  return materialTerms(left).some((term) => rightTerms.has(term));
}
