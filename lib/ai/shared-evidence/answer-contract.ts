import { z } from "zod";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
export type SynthesisSource = Readonly<{ ref: string; binding: string; dependencies: readonly string[]; facts: readonly string[]; reported: "file" | "note" | false; environment: "production" | "sandbox" | "supporting"; installation?: string; provider?: string; supportOnly?: boolean }>;

/** Shared business answers have no free-form factual content field. Models
 * select immutable issued facts/results; the application renders their values,
 * dates, units and attribution. Draft narrative is never verified business data.
 * Reference validity does not establish semantic entailment or usefulness. */
const factSelection = z.object({ ref: z.string().min(1).max(80), binding: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/), factIndex: z.number().int().min(0).max(1999) }).strict();
const draft = z.object({ premises: z.array(factSelection).max(24), text: z.string().trim().min(1).max(1600) }).strict();
export const sharedAnswerSchema = z.object({
  observations: z.array(factSelection).max(96), results: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(12),
  hypotheses: z.array(draft).max(3), missing_information: z.array(draft).max(6), next_checks: z.array(draft).max(6)
}).strict();
export type SharedStructuredAnswer = z.infer<typeof sharedAnswerSchema>;
export type IssuedAnswerResult = Readonly<{ id: string; fact: string; inputSourceIds: readonly string[] }>;
type FactSelection = z.infer<typeof factSelection>;
type Draft = z.infer<typeof draft>;
export const sharedAnswerRules = ["context_reference", "fact_reference", "duplicate_fact", "source_coverage", "result_reference", "result_dependencies", "draft_support", "draft_format", "numeric_draft", "hypothesis_disabled", "independent_sources", "environment", "answer_bounds"] as const;
export type SharedAnswerRule = typeof sharedAnswerRules[number];
export type SharedAnswerCoverageDiagnostic = Readonly<{ availableReferences: number; observedReferences: number; requiredGroups: number; missingGroups: number }>;
export class SharedAnswerContractError extends Error {
  constructor(readonly rule: SharedAnswerRule, readonly coverage?: SharedAnswerCoverageDiagnostic) { super("shared_answer_contract_denied"); }
}
const fail = (rule: SharedAnswerRule): never => { throw new SharedAnswerContractError(rule); };

const factJson = { type: "object", additionalProperties: false, required: ["ref", "binding", "factIndex"], properties: { ref: { type: "string", minLength: 1, maxLength: 80 }, binding: { type: "string", pattern: "^(?:sha256:)?[a-f0-9]{64}$" }, factIndex: { type: "integer", minimum: 0, maximum: 1999 } } } as const;
export const sharedDraftTextPattern = "^[^0-9$€£%\\[\\]<>\\r\\n]*$";
const draftJson = { type: "object", additionalProperties: false, required: ["premises", "text"], properties: {
  premises: { type: "array", maxItems: 24, items: factJson }, text: { type: "string", minLength: 1, maxLength: 1600, pattern: sharedDraftTextPattern }
} } as const;
export const sharedAnswerJsonSchema = { type: "object", additionalProperties: false,
  required: ["observations", "results", "hypotheses", "missing_information", "next_checks"], properties: {
    observations: { type: "array", maxItems: 96, items: factJson }, results: { type: "array", maxItems: 12, items: { type: "string", pattern: "^[a-f0-9]{64}$" } },
    hypotheses: { type: "array", maxItems: 3, items: draftJson }, missing_information: { type: "array", maxItems: 6, items: draftJson }, next_checks: { type: "array", maxItems: 6, items: draftJson }
  }
} as const;

export const SHARED_ANSWER_INSTRUCTIONS = "Use the shared-answer schema, without content or citationIds. observations select complete issued qualitative_sources facts by ref, exact binding and zero-based factIndex. Include at least one observation from each answerSourceRequirements group; select relevant facts from other available originals only when useful. Context availability is not a claim or complete population coverage. Do not infer totals, trends or completeness from a selected subset. contextFactSources select productSources text at index zero or matching livePublicLookup claims in order, with issued binding. results select only supplied sharedRelationships ids with every exact input observed; never invent a calculation. The app renders facts, values, dates, units and attribution. Draft prose has no factual or calculation authority. hypotheses are optional unverified possibilities supported by at least two independent business originals; do not force a hypothesis when an evidence check is useful. missing_information and next_checks may use ordinary language, questions and negations; distinguish absent information from facts and ask a specific check before a decision, not generic review-alongside prose. Draft premises must be observed facts; use at most thirty source references. Use no URLs, inline citation markup or numeric literals in draft text; refer to adjacent observations instead. No business-word whitelist applies. Never invent causes, correspondence, completeness, actions performed or measured results. Draft usefulness needs manual review; valid references do not prove claims.";

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
  const resolve = (selection: FactSelection) => {
    const source = byRef.get(selection.ref);
    if (!source || source.binding !== selection.binding || selection.factIndex >= source.facts.length || !source.dependencies.length) return fail("fact_reference");
    return { source, fact: source.facts[selection.factIndex] };
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
  const validateDraft = (item: Draft, hypothesis: boolean) => {
    const keys = item.premises.map(keyOf);
    if (new Set(keys).size !== keys.length || (context.sources.length && !keys.length)
      || keys.some(key => !observed.has(key))) fail("draft_support");
    const used = [...new Map(item.premises.map(selection => { const { source } = resolve(selection); return [source.ref, source] as const; })).values()];
    if (hypothesis) {
      if (!context.hypothesesEnabled) fail("hypothesis_disabled");
      const originals = used.filter(source => !source.supportOnly);
      if (new Set(originals.map(source => source.binding)).size < 2 || originals.some((source, index) => originals.slice(0, index).some(prior => prior.dependencies.some(binding => source.dependencies.includes(binding))))) fail("independent_sources");
    }
    const environments = new Set(used.filter(source => source.environment !== "supporting").map(source => source.environment));
    const installations = new Set(used.filter(source => source.environment === "sandbox").map(source => source.installation));
    if (environments.size > 1 || installations.size > 1 || (installations.size && installations.has(undefined))) fail("environment");
    // A representation boundary, not semantic validation: factual numbers/dates
    // are rendered from selections. Spelled-out quantitative claims, causal
    // insinuations or false prose attribution still need honest manual review.
    validateDraftText(item.text);
    return `${escape(item.text)} ${[...new Set(item.premises.map(selection => selection.ref))].map(ref => `[${ref}]`).join(" ")}`.trim();
  };
  const observations = [...observed.values()].map(({ source, fact }) => {
    const label = source.provider === "product_context" ? "Application product context" : source.provider === "public_context" ? "Completed public lookup (reported context)" : source.reported === "file" ? "Reviewed file (reported context)" : source.reported === "note" ? "Approved Business Note (reported context)" : source.environment === "sandbox" ? "Sandbox observation" : "Stored observation";
    return `${label}${source.provider ? ` — ${escape(source.provider.replace(/[_-]/g, " "))}` : ""}: ${displayIssuedText(fact)} [${source.ref}]`;
  });
  const scopeLines = observedSources.flatMap(source => {
    const scope = context.scopes?.get(source.ref);if (!scope) return [];
    const value = (key: string) => typeof scope[key] === "string" ? displayIssuedText(scope[key] as string) : "not established";
    return [`Source reporting window: ${value("start")} through ${value("end")}; scope time zone ${value("timeZone")}; scope currency ${value("currency")}; coverage ${value("coverage")}. These fields do not establish cross-source comparability. [${source.ref}]`];
  });
  const results = chosenResults.map(result => `${displayIssuedText(result.fact)} ${context.sources.filter(source => result.inputSourceIds.includes(source.binding)).map(source => `[${source.ref}]`).join(" ")}`);
  const hypotheses = answer.hypotheses.map(item => `Hypothesis (unverified model draft): ${validateDraft(item, true)}`);
  const missing = answer.missing_information.map(item => `Missing information / limitation (model assessment): ${validateDraft(item, false)}`);
  const checks = answer.next_checks.map(item => `Recommended check (model draft; not performed): ${validateDraft(item, false)}`);
  if (!observations.length && !results.length && !hypotheses.length && !missing.length && !checks.length) fail("source_coverage");
  const content = [observations.length ? `Stored observations (source-reported, not independently verified):\n${observations.join("\n")}` : "",
    ...scopeLines,
    results.length ? `Application-issued results / boundaries:\n${results.join("\n")}` : "", ...hypotheses, ...missing, ...checks,
    "Draft reasoning is not a verified finding, calculation or completed action. Source presence does not establish record correspondence, causation, complete coverage or comparable periods."].filter(Boolean).join("\n\n");
  if (content.length > 24_000 || citations.size > 30) fail("answer_bounds");
  return { content, citationIds: [...citations] };
}
