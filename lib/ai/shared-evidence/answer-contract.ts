import { z } from "zod";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { expandFactTimes, selectedFactTimeLines, type FactTime, type FactTimeGroup } from "./fact-time";
export type SynthesisSource = Readonly<{ ref: string; binding: string; dependencies: readonly string[]; facts: readonly string[]; factTimes?: readonly FactTimeGroup[]; reported: "file" | "note" | false; environment: "production" | "sandbox" | "supporting"; installation?: string; provider?: string; supportOnly?: boolean }>;

/** Shared business answers have no free-form factual content field. Models
 * select immutable issued facts/results; the application renders their values,
 * dates, units and attribution. Draft narrative is never verified business data.
 * Reference validity does not establish semantic entailment or usefulness. */
const factBindingPattern = "^[a-f0-9]{64}$";
const factSelection = z.object({ ref: z.string().min(1).max(80), binding: z.string().length(64).regex(new RegExp(factBindingPattern)), factIndex: z.number().int().min(0).max(1999) }).strict();
const draft = z.object({ premises: z.array(factSelection).max(24), text: z.string().trim().min(1).max(1600) }).strict();
// A cross-original limitation cannot assert a date relationship in model prose.
// Its exact selected premises are resolved below; the application supplies the
// comparison, including unknown timing. This is not a semantic check of drafts.
const timeComparison = z.object({ kind: z.literal("selected_fact_time_comparison"), premises: z.array(factSelection).min(2).max(24) }).strict();
export const sharedAnswerSchema = z.object({
  observations: z.array(factSelection).max(96), results: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(12),
  hypotheses: z.array(draft).max(3), missing_information: z.array(z.union([draft,timeComparison])).max(6), next_checks: z.array(draft).max(6)
}).strict();
export type SharedStructuredAnswer = z.infer<typeof sharedAnswerSchema>;
export type IssuedAnswerResult = Readonly<{ id: string; fact: string; inputSourceIds: readonly string[] }>;
type FactSelection = z.infer<typeof factSelection>;
type Draft = z.infer<typeof draft>;
export const sharedAnswerRules = ["context_reference", "fact_reference", "duplicate_fact", "source_coverage", "result_reference", "result_dependencies", "draft_support", "draft_format", "numeric_draft", "hypothesis_disabled", "independent_sources", "temporal_assessment_required", "environment", "answer_bounds"] as const;
export type SharedAnswerRule = typeof sharedAnswerRules[number];
export type SharedAnswerCoverageDiagnostic = Readonly<{ availableReferences: number; observedReferences: number; requiredGroups: number; missingGroups: number }>;
export const factReferenceReasons = ["unknown_ref", "binding_mismatch", "fact_index_out_of_bounds", "source_dependencies_missing"] as const;
export type FactReferenceDiagnostic = Readonly<{ reason: typeof factReferenceReasons[number]; bindingMatchesOtherSource?: boolean }>;
export class SharedAnswerContractError extends Error {
  constructor(readonly rule: SharedAnswerRule, readonly coverage?: SharedAnswerCoverageDiagnostic, readonly factReference?: FactReferenceDiagnostic) { super("shared_answer_contract_denied"); }
}
const fail = (rule: SharedAnswerRule): never => { throw new SharedAnswerContractError(rule); };

const factJson = { type: "object", additionalProperties: false, required: ["ref", "binding", "factIndex"], properties: { ref: { type: "string", minLength: 1, maxLength: 80 }, binding: { type: "string", minLength: 64, maxLength: 64, pattern: factBindingPattern }, factIndex: { type: "integer", minimum: 0, maximum: 1999 } } } as const;
export const sharedDraftTextPattern = "^[^0-9$€£%\\[\\]<>\\r\\n]*$";
const draftJson = { type: "object", additionalProperties: false, required: ["premises", "text"], properties: {
  premises: { type: "array", maxItems: 24, items: factJson }, text: { type: "string", minLength: 1, maxLength: 1600, pattern: sharedDraftTextPattern }
} } as const;
const timeComparisonJson = { type: "object", additionalProperties: false, required: ["kind", "premises"], properties: {
  kind: { type: "string", enum: ["selected_fact_time_comparison"] }, premises: { type: "array", minItems: 2, maxItems: 24, items: factJson }
} } as const;
export const sharedAnswerJsonSchema = { type: "object", additionalProperties: false,
  required: ["observations", "results", "hypotheses", "missing_information", "next_checks"], properties: {
    observations: { type: "array", maxItems: 96, items: factJson }, results: { type: "array", maxItems: 12, items: { type: "string", pattern: "^[a-f0-9]{64}$" } },
    hypotheses: { type: "array", maxItems: 3, items: draftJson }, missing_information: { type: "array", maxItems: 6, items: { anyOf: [draftJson,timeComparisonJson] } }, next_checks: { type: "array", maxItems: 6, items: draftJson }
  }
} as const;

export const SHARED_ANSWER_INSTRUCTIONS = "Use the shared-answer schema, no content/citationIds. Select observations by issued ref, exact bare binding (64 lowercase hex, never sha256: or snapshotHash), and source-local zero-based factIndex. Historical-only refs are invalid. Observe each answerSourceRequirements group; other facts only when relevant. Availability/subsets prove neither totals, trends nor completeness. contextFactSources indexes follow product text or public claims. results use only issued sharedRelationships IDs with all inputs observed; invent no calculation. The app renders factual values, units, dates and attribution. For billing/collections prefer sales-invoice contributions, not purchase-bill invoice zeros; preserve valid zero-value invoices. factTimes indexes bind each fact: document/row dates, balances at import, retrieval times and selection windows differ; even equal dates prove no measurement alignment. For cross-original missing_information use {kind: selected_fact_time_comparison, premises: observed fact selections}, never text/dates/verdicts. The app computes this limitation. Single-original missing_information may use text. Put specific missing linkage/coverage/status questions in next_checks; do not move factual recaps there. hypotheses are optional unverified possibilities requiring two independent originals; never force one. Draft premises must be observed. Drafts have no factual authority: invent no cause, correspondence, completeness, performed action or result; do not contradict the app date check. No URLs, inline citations or numeric literals in prose; refer to observations. No business-word whitelist applies. Use ordinary questions/negation and a concrete check before a decision, not generic review-alongside prose. Valid references do not prove semantic correctness or usefulness; manual review remains required.";

/** Reuse already-authorized app context and completed public lookup snapshots.
 * No extra retrieval, source text duplication, or historical-business promotion.
 * These sources never count as independent business originals. */
export function issueContextFactSources(products: readonly { id: string; text: string; snapshotHash?: string }[], lookup: {
  claims: readonly { text: string; citationIds: readonly string[]; evidenceDate: string | null; dateProvenance: unknown }[];
  sources: readonly { id: string; retrievedAt: string }[];
} | null): SynthesisSource[] {
  const output: SynthesisSource[] = products.map(source => {
    const binding = evidenceEngineHash({ contract: "shared_product_fact_v1", snapshot: source.snapshotHash, text: source.text });
    return { ref: source.id, binding, dependencies: [binding], facts: [source.text], reported: false, environment: "supporting", provider: "product_context", supportOnly: true };
  });
  for (const source of lookup?.sources || []) {
    const claims = lookup!.claims.filter(claim => claim.citationIds.includes(source.id));
    if (!claims.length) continue;
    const binding = evidenceEngineHash({ contract: "shared_public_fact_v1", source, claims });
    output.push({ ref: source.id, binding, dependencies: [binding], facts: claims.map(claim => `${claim.text} Source date: ${claim.evidenceDate ?? "not established"}; date provenance: ${JSON.stringify(claim.dateProvenance)}; lookup time: ${source.retrievedAt}.`), reported: false, environment: "supporting", provider: "public_context", supportOnly: true });
  }
  return output;
}

export function issueAnswerResults(relationships: readonly { fact: string; inputSourceIds: readonly string[] }[]): IssuedAnswerResult[] {
  return relationships.map(result => ({ ...result, id: evidenceEngineHash({ contract: "shared_answer_result_v1", fact: result.fact, inputSourceIds: result.inputSourceIds }) }));
}
const keyOf = (selection: FactSelection) => JSON.stringify([selection.ref, selection.binding, selection.factIndex]);
const escape = (text: string) => text.replace(/([\\`*_{}\[\]<>#|])/g, "\\$1").replace(/[\r\n]+/g, " ");
// A URL quoted in a permitted record is not a newly verified web source.
// Retain it in the immutable original; explicitly defer its display to that
// protected citation rather than minting an unchecked external answer link.
const displayIssuedText = (text: string) => escape(text.replace(/\b(?:https?:\/\/|www\.)[^\s<>"`]+/gi, "(URL recorded in cited original)"));
function validateDraftText(text: string) {
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>\[\]]|\b(?:https?|mailto|javascript|data):|\bwww\.|\b(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/iu.test(text)) fail("draft_format");
  if (/\p{N}|[$€£%]/u.test(text)) fail("numeric_draft");
}
export function renderSharedClarification(value: string): string {
  const text = z.string().trim().min(1).max(1600).parse(value);validateDraftText(text);
  return `Clarification requested (model draft): ${escape(text)}`;
}

/** All contexts here are supplied by the application after protected admission,
 * not by the model. Rendering repeats exact reference/dependency checks. */
export function renderSharedAnswer(value: unknown, context: {
  sources: readonly SynthesisSource[]; results: readonly IssuedAnswerResult[]; hypothesesEnabled: boolean; requiredRefs?: readonly string[];
  requiredSourceGroups?: readonly (readonly string[])[];
  scopes?: ReadonlyMap<string, Readonly<Record<string, unknown>>>
}): { content: string; citationIds: string[] } {
  const answer = sharedAnswerSchema.parse(value);
  const byRef = new Map(context.sources.map(source => [source.ref, source]));
  if (byRef.size !== context.sources.length) fail("context_reference");
  const timesByRef = new Map<string, FactTime[]>();
  for (const source of context.sources) if (source.factTimes) {
    try { timesByRef.set(source.ref,expandFactTimes(source.factTimes,source.facts.length)); }
    catch { fail("context_reference"); }
  }
  const factFailure = (reason: FactReferenceDiagnostic["reason"], bindingMatchesOtherSource?: boolean): never => {
    throw new SharedAnswerContractError("fact_reference", undefined, { reason,
      ...(reason === "binding_mismatch" ? { bindingMatchesOtherSource } : {}) });
  };
  const resolve = (selection: FactSelection) => {
    const source = byRef.get(selection.ref);
    if (!source) return factFailure("unknown_ref");
    if (source.binding !== selection.binding) return factFailure("binding_mismatch", context.sources.some(other => other !== source && other.binding === selection.binding));
    if (selection.factIndex >= source.facts.length) return factFailure("fact_index_out_of_bounds");
    if (!source.dependencies.length) return factFailure("source_dependencies_missing");
    return { source, fact: source.facts[selection.factIndex], time: timesByRef.get(source.ref)?.[selection.factIndex] ?? null };
  };
  const observed = new Map<string, ReturnType<typeof resolve>>();
  for (const selection of answer.observations) {
    const key = keyOf(selection); if (observed.has(key)) fail("duplicate_fact");
    observed.set(key, resolve(selection));
  }
  const groups = context.requiredSourceGroups
    ? [...context.requiredSourceGroups, ...(context.requiredRefs || []).map(ref => [ref])]
    : (context.requiredRefs ?? context.sources.map(source => source.ref)).map(ref => [ref]);
  if (groups.some(group => !group.length || group.some(ref => !byRef.has(ref)))) fail("context_reference");
  const observedRefs = new Set(answer.observations.map(selection => selection.ref));
  const missingGroups = groups.filter(group => !group.some(ref => observedRefs.has(ref))).length;
  if (missingGroups) throw new SharedAnswerContractError("source_coverage", {
    availableReferences: byRef.size, observedReferences: observedRefs.size, requiredGroups: groups.length, missingGroups
  });
  const observedSources = [...new Map([...observed.values()].map(item => [item.source.ref,item.source])).values()];
  const observedEnvironments = new Set(observedSources.filter(source => source.environment !== "supporting").map(source => source.environment));
  const observedInstallations = new Set(observedSources.filter(source => source.environment === "sandbox").map(source => source.installation));
  if (observedEnvironments.size > 1 || observedInstallations.size > 1 || (observedInstallations.size && observedInstallations.has(undefined))) fail("environment");
  const resultById = new Map(context.results.map(result => [result.id, result]));
  if (resultById.size !== context.results.length || new Set(answer.results).size !== answer.results.length) fail("result_reference");
  const chosenResults = answer.results.map(id => {
    const result = resultById.get(id); if (!result) return fail("result_reference");
    // An id is an exact application-issued result, not a request to recalculate.
    if (issueAnswerResults([result])[0].id !== id || !result.inputSourceIds.length
      || result.inputSourceIds.some(binding => ![...observed.values()].some(item => item.source.binding === binding))) return fail("result_dependencies");
    return result;
  });
  const citations = new Set(answer.observations.map(selection => selection.ref));
  const validatePremises = (item: { premises: FactSelection[] }) => {
    const keys = item.premises.map(keyOf);
    if (new Set(keys).size !== keys.length || (context.sources.length && !keys.length)
      || keys.some(key => !observed.has(key))) fail("draft_support");
    const used = [...new Map(item.premises.map(selection => { const { source } = resolve(selection); return [source.ref, source] as const; })).values()];
    const environments = new Set(used.filter(source => source.environment !== "supporting").map(source => source.environment));
    const installations = new Set(used.filter(source => source.environment === "sandbox").map(source => source.installation));
    if (environments.size > 1 || installations.size > 1 || (installations.size && installations.has(undefined))) fail("environment");
    return used;
  };
  const requireIndependent = (used: readonly SynthesisSource[]) => {
    const originals = used.filter(source => !source.supportOnly);
    if (new Set(originals.map(source => source.binding)).size < 2 || originals.some((source, index) => originals.slice(0, index).some(prior => prior.dependencies.some(binding => source.dependencies.includes(binding))))) fail("independent_sources");
  };
  const validateDraft = (item: Draft, hypothesis: boolean, limitation = false) => {
    const used = validatePremises(item);
    if (hypothesis) {
      if (!context.hypothesesEnabled) fail("hypothesis_disabled");
      requireIndependent(used);
    }
    // A representation boundary, not semantic validation: factual numbers/dates
    // are rendered from selections. Spelled-out quantitative claims, causal
    // insinuations or false prose attribution still need honest manual review.
    validateDraftText(item.text);
    if (limitation && new Set(used.filter(source => !source.supportOnly).map(source => source.binding)).size > 1) fail("temporal_assessment_required");
    return `${escape(item.text)} ${[...new Set(item.premises.map(selection => selection.ref))].map(ref => `[${ref}]`).join(" ")}`.trim();
  };
  const observations = [...observed.values()].map(({ source, fact }) => {
    const label = source.provider === "product_context" ? "Application product context" : source.provider === "public_context" ? "Completed public lookup (reported context)" : source.reported === "file" ? "Reviewed file (reported context)" : source.reported === "note" ? "Approved Business Note (reported context)" : source.environment === "sandbox" ? "Sandbox observation" : "Stored observation";
    return `${label}${source.provider ? ` — ${escape(source.provider.replace(/[_-]/g, " "))}` : ""}: ${displayIssuedText(fact)} [${source.ref}]`;
  });
  const scopeLines = observedSources.flatMap(source => {
    const scope = context.scopes?.get(source.ref);if (!scope) return [];
    const value = (key: string) => typeof scope[key] === "string" ? displayIssuedText(scope[key] as string) : "not established";
    return [`${scope.windowKind === "retrieval_selection" ? "Source retrieval selection window" : "Source reporting window"}: ${value("start")} through ${value("end")}; scope time zone ${value("timeZone")}; scope currency ${value("currency")}; coverage ${value("coverage")}. These fields do not establish cross-source comparability or selected fact dates.${source.provider==='xero'?' Xero metrics are stored record contributions, not account/day totals; zero contributions do not establish absence of account activity.':''} [${source.ref}]`];
  });
  const businessObservations = [...observed].filter(([,item]) => !item.source.supportOnly);
  const businessKeys = new Set(businessObservations.map(([key]) => key));
  // Avoid repeating the identical date block when a closed comparison covers
  // every business observation. Subset comparisons cannot hide other dates.
  const fullDateComparison = answer.missing_information.some(item => "kind" in item
    && item.premises.length === businessKeys.size && item.premises.every(selection => businessKeys.has(keyOf(selection))));
  const dateLines = fullDateComparison ? [] : selectedFactTimeLines(businessObservations.map(([,item]) => ({ref:item.source.ref,time:item.time})));
  const results = chosenResults.map(result => `${displayIssuedText(result.fact)} ${context.sources.filter(source => result.inputSourceIds.includes(source.binding)).map(source => `[${source.ref}]`).join(" ")}`);
  const hypotheses = answer.hypotheses.map(item => `Hypothesis (unverified model draft): ${validateDraft(item, true)}`);
  const missing = answer.missing_information.map(item => {
    if (!("kind" in item)) return `Missing information / limitation (unverified model assessment): ${validateDraft(item, false, true)}`;
    const used = validatePremises(item); requireIndependent(used);
    if (used.some(source => source.supportOnly)) fail("draft_support");
    const rows = item.premises.map(selection => { const { source, time } = resolve(selection); return {ref:source.ref,time}; });
    return `Selected-date comparison (application-computed from cited premises):\n${selectedFactTimeLines(rows).join("\n")}`;
  });
  const checks = answer.next_checks.map(item => `Recommended check (model draft; not performed): ${validateDraft(item, false)}`);
  if (!observations.length && !results.length && !hypotheses.length && !missing.length && !checks.length) fail("source_coverage");
  const content = [observations.length ? `Stored observations (source-reported, not independently verified):\n${observations.join("\n")}` : "",
    ...scopeLines, ...dateLines,
    results.length ? `Application-issued results / boundaries:\n${results.join("\n")}` : "", ...hypotheses, ...missing, ...checks,
    "Draft reasoning is not a verified finding, calculation or completed action. Source presence does not establish record correspondence, causation, complete coverage or comparable periods."].filter(Boolean).join("\n\n");
  if (content.length > 24_000 || citations.size > 30) fail("answer_bounds");
  return { content, citationIds: [...citations] };
}
