import { z } from "zod";
import { invoiceSelections, type InvoiceSelection } from "./invoice-selection";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { expandFactTimes, selectedFactTimeLines, type FactTime, type FactTimeGroup } from "./fact-time";
export type SynthesisSource = Readonly<{ ref: string; binding: string; dependencies: readonly string[]; facts: readonly string[]; factTimes?: readonly FactTimeGroup[]; salesInvoiceFactGroups?: readonly (readonly number[])[]; reported: "file" | "note" | false; environment: "production" | "sandbox" | "supporting"; installation?: string; provider?: string; supportOnly?: boolean }>;

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
export const sharedAnswerRules = ["context_reference", "fact_reference", "duplicate_fact", "invoice_selection", "source_coverage", "result_reference", "result_dependencies", "draft_support", "draft_format", "numeric_draft", "hypothesis_disabled", "independent_sources", "temporal_assessment_required", "environment", "answer_bounds"] as const;
export type SharedAnswerRule = typeof sharedAnswerRules[number];
export type SharedAnswerCoverageDiagnostic = Readonly<{ availableReferences: number; observedReferences: number; requiredGroups: number; missingGroups: number }>;
export const factReferenceReasons = ["unknown_ref", "binding_mismatch", "fact_index_out_of_bounds", "source_dependencies_missing"] as const;
export type FactReferenceDiagnostic = Readonly<{ reason: typeof factReferenceReasons[number]; bindingMatchesOtherSource?: boolean }>;
export const resultReferenceReasons = ["invalid_issued_id", "duplicate_issued_id", "duplicate_selected_id", "unknown_selected_id"] as const;
export type ResultReferenceDiagnostic = Readonly<{ reason: typeof resultReferenceReasons[number]; issuedCount: number; selectedCount: number }>;
export class SharedAnswerContractError extends Error {
  constructor(readonly rule: SharedAnswerRule, readonly coverage?: SharedAnswerCoverageDiagnostic, readonly factReference?: FactReferenceDiagnostic, readonly resultReference?: ResultReferenceDiagnostic) { super("shared_answer_contract_denied"); }
}
const fail = (rule: SharedAnswerRule): never => { throw new SharedAnswerContractError(rule); };
const resultFailure = (reason: ResultReferenceDiagnostic["reason"], issuedCount: number, selectedCount: number): never => {
  throw new SharedAnswerContractError("result_reference", undefined, undefined, { reason, issuedCount, selectedCount });
};

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

export type AnswerSchemaSource = Readonly<{ ref: string; binding: string; supportOnly?: boolean }>;
const answerSchemaSource = z.object({ ref: factSelection.shape.ref, binding: factSelection.shape.binding,
  supportOnly: z.boolean().optional() }).strict();

/** The general parser describes syntax, not source-dependent authority. Generate
 * prose limitation alternatives from the exact packed originals so the wire
 * schema cannot invite the cross-original draft that rendering rejects. Group
 * by binding, just like validateDraft; reported files/notes are still originals.
 * Supporting context may accompany one original but never establishes another.
 * This does not move prose, prove entailment, or replace rendering validation. */
function limitationJsonForSources(sources: readonly AnswerSchemaSource[] | undefined,
  selections: (group: readonly AnswerSchemaSource[]) => Record<string, unknown>) {
  if (sources === undefined) return { ...sharedAnswerJsonSchema.properties.missing_information,
    items: { anyOf: [timeComparisonJson] } }; // No source context: do not offer unbounded prose.
  const parsed = z.array(answerSchemaSource).safeParse(sources);
  if (!parsed.success || new Set(parsed.data.map(source => source.ref)).size !== parsed.data.length) return fail("context_reference");
  // Reuse the same exact ref/binding definitions as observations and other
  // premises. Grouping refs alone would still permit a wrong well-formed hash.
  const originals = parsed.data.filter(source => !source.supportOnly), supporting = parsed.data.filter(source => source.supportOnly);
  const bindings = [...new Set(originals.map(source => source.binding))];
  const proseGroups = bindings.map(binding => [...originals.filter(source => source.binding === binding), ...supporting]);
  if (supporting.length || !parsed.data.length) proseGroups.push(supporting);
  // Keep anyOf around complete arrays: choosing per item would mix originals.
  const prose = [{ ...draftJson, properties: { ...draftJson.properties,
    premises: parsed.data.length ? { type: "array", minItems: 1, maxItems: 24,
      anyOf: proseGroups.map(group => ({ type: "array", items: selections(group) })) }
      : { type: "array", minItems: 0, maxItems: 0, items: { $ref: "#/$defs/s" } },
    text: { $ref: "#/$defs/t" }
  } }];
  const comparisons = bindings.length >= 2 ? [{ ...timeComparisonJson, properties: { ...timeComparisonJson.properties,
    premises: { ...timeComparisonJson.properties.premises, items: selections(originals) }
  } }] : [];
  return { ...sharedAnswerJsonSchema.properties.missing_information, items: { anyOf: [...prose, ...comparisons] } };
}

/** Constrain generation to the exact results in this packed request. This is
 * not calculation authority: rendering still verifies IDs, hashes, observed
 * dependencies and uniqueness independently, including provider violations.
 * Keep the base schema immutable between requests. */
export function sharedAnswerJsonSchemaForResults(results: readonly { id: string }[], hypothesesEnabled: boolean, invoicePolicy: readonly InvoiceSelection[] = [], availableRefs: readonly string[] = [], sources?: readonly AnswerSchemaSource[]) {
  if (!Array.isArray(results)) resultFailure("invalid_issued_id", 0, 0);
  const ids = results.map(result => result?.id);
  if (ids.some(id => typeof id !== "string" || id.length !== 64 || !/^[a-f0-9]{64}$/.test(id))) resultFailure("invalid_issued_id", ids.length, 0);
  if (new Set(ids).size !== ids.length) resultFailure("duplicate_issued_id", ids.length, 0);
  const parsed = sources === undefined ? undefined : z.array(answerSchemaSource).safeParse(sources);
  if (parsed && (!parsed.success || new Set(parsed.data.map(source => source.ref)).size !== parsed.data.length)) return fail("context_reference");
  const issued = parsed?.success ? parsed.data : undefined;
  if (issued && invoicePolicy.some(policy => !issued.some(source => source.ref === policy.ref && source.binding === policy.binding))) return fail("context_reference");
  const selectable = issued?.filter(source => !invoicePolicy.some(policy => policy.ref === source.ref && !policy.eligible.length));
  const sourceDefinitions: Record<string, unknown> = {};
  const definitionByRef = new Map<string, string>();
  for (const [index, source] of (selectable || []).entries()) {
    const name = `f${index}`;
    const invoice = invoicePolicy.find(policy => policy.ref === source.ref);
    definitionByRef.set(source.ref, name);
    sourceDefinitions[name] = { ...factJson, properties: {
      ref: { type: "string", enum: [source.ref] }, binding: { type: "string", enum: [source.binding] },
      // Draft premises must already be observations, so the same existing
      // invoice eligibility applies without duplicating this source's hash.
      factIndex: invoice ? { type: "integer", enum: [...invoice.eligible] } : { $ref: "#/$defs/i" }
    } };
  }
  const exactSelections = (group: readonly AnswerSchemaSource[]): Record<string, unknown> => {
    const refs = group.map(source => ({ $ref: `#/$defs/${definitionByRef.get(source.ref)}` }));
    // Empty arrays are separately constrained to maxItems:0. Never generate
    // invalid anyOf:[] or an empty enum for that unreachable item schema.
    return refs.length === 1 ? refs[0] : refs.length ? { anyOf: refs } : factJson;
  };
  const otherRefs = availableRefs.filter(ref => !invoicePolicy.some(policy => policy.ref === ref));
  const selectionVariants = invoicePolicy.filter(policy => policy.eligible.length).map(policy => ({ ...factJson, properties: {
    ref: { type: "string", enum: [policy.ref] }, binding: { type: "string", enum: [policy.binding] }, factIndex: { type: "integer", enum: [...policy.eligible] }
  } }));
  const items = !issued && invoicePolicy.length ? { anyOf: [...selectionVariants, ...(otherRefs.length
    ? [{ ...factJson, properties: { ...factJson.properties, ref: { type: "string", enum: [...otherRefs] } } }] : [])] } : undefined;
  // Actual engine requests always supply the exact packed sources. Keep the
  // source-free syntax factory for non-transport callers, never as authority.
  // Hashes occur once per source definition, reused by every premise field.
  // All bytes participate in packing; runtime still checks exact bindings,
  // source-local indexes, observed premises and independent-source authority.
  const selection = { $ref: "#/$defs/s" };
  return { ...sharedAnswerJsonSchema, $defs: { t: draftJson.properties.text,
    ...(!issued ? { b: factJson.properties.binding } : {}), i: factJson.properties.factIndex,
    ...sourceDefinitions,
    s: selectable ? exactSelections(selectable) : { ...factJson, properties: { ...factJson.properties,
      binding: { $ref: "#/$defs/b" }, factIndex: { $ref: "#/$defs/i" } } },
    d: { ...draftJson, properties: { ...draftJson.properties,
      premises: { ...draftJson.properties.premises, ...(selectable?.length === 0 ? { maxItems: 0 } : {}), items: selection }, text: { $ref: "#/$defs/t" } } }
  }, properties: { ...sharedAnswerJsonSchema.properties,
    observations: { ...sharedAnswerJsonSchema.properties.observations, ...(selectable?.length === 0 || (items && !items.anyOf.length) ? { maxItems: 0, items: selection } : { items: items ?? selection }) },
    results: { ...sharedAnswerJsonSchema.properties.results, maxItems: Math.min(12, ids.length),
      items: { ...sharedAnswerJsonSchema.properties.results.items, ...(ids.length ? { enum: ids } : {}) } },
    missing_information: limitationJsonForSources(selectable, exactSelections),
    hypotheses: { ...sharedAnswerJsonSchema.properties.hypotheses, items: { $ref: "#/$defs/d" }, maxItems: hypothesesEnabled ? 3 : 0 },
    next_checks: { ...sharedAnswerJsonSchema.properties.next_checks, items: { $ref: "#/$defs/d" } }
  } };
}

export const SHARED_ANSWER_INSTRUCTIONS = "Use compact shared-answer JSON, no content/citationIds. Select observations by issued ref, exact bare binding (64 lowercase hex, never sha256: or snapshotHash), and source-local zero-based factIndex. Historical-only refs are invalid. Observe each answerSourceRequirements group; other facts only when relevant. Use needed premises; avoid repeated checks. Keep needed zeros, statuses and timing. Availability/subsets prove neither totals, trends nor completeness. contextFactSources indexes follow product text or public claims. results use only issued sharedRelationships IDs with all inputs observed; invent no calculation. The app renders factual values, units, dates and attribution. For invoice questions, inspect typed invoiceReviewOrder groups first; select only eligible invoice indexes, including zero-value invoices. Date-label ranking is not temporal alignment or a record join. factTimes indexes bind each fact: document/row dates, balances at import, retrieval times and selection windows differ; even equal dates prove no measurement alignment. For cross-original missing_information use {kind: selected_fact_time_comparison, premises: observed fact selections}, never text/dates/verdicts. The app's date assessment covers all selected business observations; premise subsets cannot narrow it. missing_information prose uses one original plus support; date checks never allow cross-original prose here. next_checks holds specific missing linkage/coverage/status questions, never factual recaps. hypotheses are optional, unverified and require two independent originals. Draft premises must be observed. Drafts have no factual authority: invent no cause, correspondence, completeness, performed action or result; do not contradict the app date check. No URLs, inline citations or numeric literals in prose; refer to observations. No business-word whitelist applies. Use ordinary questions/negation and a concrete check before a decision, not generic review-alongside prose. Valid references do not prove semantic correctness or usefulness; manual review remains required.";

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

/** Selected accounting records can describe the same business population in
 * different systems. Only protected, distinct entities exclude that pair; a
 * retrieval window, document date or coverage label is not a deduplication or
 * disjoint-population certificate. This renders a limitation, not a calculation
 * or a claim that duplication exists, and does not prohibit separate comparisons.
 * Scopes come from protected admission, never from model-authored prose. */
function accountingScopeQualification(sources: readonly SynthesisSource[], scopes?: ReadonlyMap<string, Readonly<Record<string, unknown>>>): string {
  const labels: Readonly<Record<string, string>> = { quickbooks_online: "QuickBooks Online", xero: "Xero", "zoho-books": "Zoho Books" };
  const accounting = sources.filter(source => source.provider && Object.hasOwn(labels, source.provider)
    && source.reported === false && !source.supportOnly && source.environment !== "supporting");
  const entity = (source: SynthesisSource) => {
    const scope = scopes?.get(source.ref);
    const parsed = z.string().uuid().safeParse(scope?.entityId);
    return scope?.entityBinding === "protected" && parsed.success ? parsed.data.toLowerCase() : null;
  };
  const implicated = new Set<string>();
  for (let i = 0; i < accounting.length; i++) for (let j = i + 1; j < accounting.length; j++) {
    const left = accounting[i], right = accounting[j];
    if (left.provider === right.provider) continue;
    const leftEntity = entity(left), rightEntity = entity(right);
    if (leftEntity && rightEntity && leftEntity !== rightEntity) continue;
    implicated.add(left.ref);implicated.add(right.ref);
  }
  const selected = accounting.filter(source => implicated.has(source.ref));
  if (!selected.length) return "";
  const providers = [...new Set(selected.map(source => labels[source.provider!]))].join(", ");
  return `Accounting scope check (application-owned): Selected ${providers} observations include cross-system pairs with shared or unestablished entity scope. Their records may overlap or differ in coverage and accounting basis; duplication is not established. These excerpts do not establish a combined revenue or receivables total. Reconcile entity and record correspondence, non-overlapping coverage, dates, currency and accounting basis before adding amounts across those sources. Individual observations can still be compared separately with their stated limits. ${selected.map(source => `[${source.ref}]`).join(" ")}`;
}

/** All contexts here are supplied by the application after protected admission,
 * not by the model. Rendering repeats exact reference/dependency checks. */
export function renderSharedAnswer(value: unknown, context: {
  sources: readonly SynthesisSource[]; results: readonly IssuedAnswerResult[]; hypothesesEnabled: boolean; requiredRefs?: readonly string[];
  requiredSourceGroups?: readonly (readonly string[])[];
  question?: string;
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
  const invoicePolicy = invoiceSelections(context.sources, context.question || "");
  const observed = new Map<string, ReturnType<typeof resolve>>();
  for (const selection of answer.observations) {
    const key = keyOf(selection); if (observed.has(key)) fail("duplicate_fact");
    const resolved = resolve(selection);
    const policy = invoicePolicy.find(policy => policy.ref === selection.ref);
    if (policy && (policy.binding !== selection.binding || !policy.eligible.includes(selection.factIndex))) fail("invoice_selection");
    observed.set(key, resolved);
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
  if (resultById.size !== context.results.length) resultFailure("duplicate_issued_id", context.results.length, answer.results.length);
  if (new Set(answer.results).size !== answer.results.length) resultFailure("duplicate_selected_id", context.results.length, answer.results.length);
  const chosenResults = answer.results.map(id => {
    const result = resultById.get(id); if (!result) return resultFailure("unknown_selected_id", context.results.length, answer.results.length);
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
  // One application-owned assessment covers all displayed business observations.
  // Closed model premises still validate below, but cannot narrow this scope.
  const dateLines = selectedFactTimeLines(businessObservations.map(([,item]) => ({ref:item.source.ref,time:item.time})));
  const results = chosenResults.map(result => `${displayIssuedText(result.fact)} ${context.sources.filter(source => result.inputSourceIds.includes(source.binding)).map(source => `[${source.ref}]`).join(" ")}`);
  const hypotheses = answer.hypotheses.map(item => `Hypothesis (unverified model draft): ${validateDraft(item, true)}`);
  const missing = answer.missing_information.map(item => {
    if (!("kind" in item)) return `Missing information / limitation (unverified model assessment): ${validateDraft(item, false, true)}`;
    const used = validatePremises(item); requireIndependent(used);
    if (used.some(source => source.supportOnly)) fail("draft_support");
    return ""; // The all-observed date assessment above already renders this limitation.
  });
  const checks = answer.next_checks.map(item => `Recommended check (model draft; not performed): ${validateDraft(item, false)}`);
  if (!observations.length && !results.length && !hypotheses.length && !missing.length && !checks.length) fail("source_coverage");
  const content = [observations.length ? `Stored observations (source-reported, not independently verified):\n${observations.join("\n")}` : "",
    ...scopeLines, ...(dateLines.length ? ["Dates across all selected business observations (application-computed):", ...dateLines] : []),
    accountingScopeQualification(observedSources, context.scopes),
    results.length ? `Application-issued results / boundaries:\n${results.join("\n")}` : "", ...hypotheses, ...missing, ...checks,
    "Draft reasoning is not a verified finding, calculation or completed action. Source presence does not establish record correspondence, causation, complete coverage or comparable periods."].filter(Boolean).join("\n\n");
  if (content.length > 24_000 || citations.size > 30) fail("answer_bounds");
  return { content, citationIds: [...citations] };
}
