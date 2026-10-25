import type { SynthesisSource } from "@/lib/ai/shared-evidence/answer-contract";
import type { VsiCitation } from "./types";
import { VSI_MODEL } from "./config";
import { vsiContextGroups, vsiAnswerCoverageGroups } from "./context-selection";

type AnswerContext = {
  businessSources: Array<VsiCitation & { text?: string }>;
  qualitative_sources: SynthesisSource[];
  question?: string;
  sharedRelationships?: Array<{ inputSourceIds: readonly string[] }>;
  evidenceLimitations?: string[];
  historicalSources?: VsiCitation[];
};

export function serializeVsiProviderRequest(body: Record<string, unknown>, maxOutputTokens: number) {
  return JSON.stringify({ reasoning: { effort: "low" }, max_output_tokens: maxOutputTokens, ...body, model: VSI_MODEL, store: false, stream: false });
}
type PackingOptions = { requestJSON?: (contextJSON: string) => string; maxBytes?: number; selectRelevant?: boolean };
export type VsiContextMetrics = { requestChars: number; requestBytes: number; contextChars: number; systemChars: number; envelopeAndEscapingChars: number; inputFramingAndEscapingChars: number; schemaAndOutputFormatChars: number; otherRequestEnvelopeChars: number; sourceGroups: number; selectedSourceGroups: number; omittedSourceGroups: number; sectionChars: Record<string, number> };

const observationLayout = "For a businessSources entry whose text contains observationsRef, its complete observations are the facts of qualitative_sources with that exact ref. Read those facts together with the entry's scope. This is one original source represented once, not independent corroboration. Citation IDs, bindings and source dependencies are unchanged.";

export class VsiAnswerContextLimit extends Error {
  constructor(public readonly serializedChars: number, public readonly maxChars: number, public readonly metrics?: VsiContextMetrics) {
    super("vsi_answer_context_limit");
  }
}

/** Lossless transport view only. Canonical source text/snapshots remain intact
 * for validation, saved citations and protected reopening. Never select or cut
 * source groups, relationships, product facts, history or issued premises here. */
export function serializeVsiAnswerContext<T extends AnswerContext>(payload: T) {
  const original = JSON.stringify(payload);
  const byRef = new Map(payload.qualitative_sources.map(source => [source.ref, source]));
  if (byRef.size !== payload.qualitative_sources.length
    || new Set(payload.businessSources.map(source => source.id)).size !== payload.businessSources.length) {
    return { json: original, compactedSources: 0 };
  }
  let compactedSources = 0;
  const businessSources = payload.businessSources.map(source => {
    const issued = byRef.get(source.id);
    if (!source.sourceType.startsWith("shared_") || !issued || source.sourceId !== issued.binding || typeof source.text !== "string") return source;
    let record: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(source.text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return source;
      record = parsed as Record<string, unknown>;
    } catch { return source; }
    if (!Array.isArray(record.observations) || !record.observations.length
      || record.observations.some(fact => typeof fact !== "string")
      || JSON.stringify(record.observations) !== JSON.stringify(issued.facts)
      || Object.hasOwn(record, "observationsRef")) return source;
    const context = { ...record };
    delete context.observations;
    // Date metadata participates in the canonical snapshot. Deduplicate it only
    // when the issued index-aligned metadata is identical, never truncate it.
    if (Object.hasOwn(record, "factTimes") && JSON.stringify(record.factTimes) === JSON.stringify(issued.factTimes)) delete context.factTimes;
    compactedSources++;
    return { ...source, text: JSON.stringify({ ...context, observationsRef: source.id }) };
  });
  if (!compactedSources) return { json: original, compactedSources: 0 };
  const json = JSON.stringify({ ...payload, businessSources, sharedObservationLayout: observationLayout });
  // Reference overhead can exceed tiny facts; do not enlarge those requests.
  return json.length < original.length ? { json, compactedSources } : { json: original, compactedSources: 0 };
}

export function packVsiAnswerContext<T extends AnswerContext>(payload: T, systemPrompt: string, maxChars: number, options: PackingOptions = {}) {
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) throw new RangeError("invalid_vsi_context_budget");
  const measure = (view: AnswerContext) => {
    const requiredSourceGroups = options.selectRelevant ? vsiAnswerCoverageGroups(view.businessSources, view.sharedRelationships || [], payload.question || "") : undefined;
    const packed = serializeVsiAnswerContext(requiredSourceGroups ? { ...view, answerSourceRequirements: {
      groups: requiredSourceGroups, rule: "Cite at least one issued observation from each group. Other available originals are optional context, not claims or proof of complete coverage."
    } } : view);
    const wire = options.requestJSON?.(packed.json) || `${systemPrompt}${packed.json}`;
    const request = options.requestJSON ? JSON.parse(wire) : null;
    const inputChars = request ? JSON.stringify(request.input).length : packed.json.length + systemPrompt.length;
    const schemaChars = request?.text ? JSON.stringify(request.text).length : 0;
    const metrics: VsiContextMetrics = {
      requestChars: wire.length, requestBytes: Buffer.byteLength(wire, "utf8"), contextChars: packed.json.length,
      systemChars: systemPrompt.length, envelopeAndEscapingChars: wire.length - packed.json.length - systemPrompt.length,
      inputFramingAndEscapingChars: inputChars - packed.json.length - systemPrompt.length,
      schemaAndOutputFormatChars: schemaChars, otherRequestEnvelopeChars: wire.length - inputChars - schemaChars,
      sourceGroups: payload.businessSources.length, selectedSourceGroups: view.businessSources.length,
      omittedSourceGroups: payload.businessSources.length - view.businessSources.length,
      sectionChars: Object.fromEntries(Object.entries(JSON.parse(packed.json)).map(([key, value]) => [key, JSON.stringify(value).length]))
    };
    return { ...packed, serializedChars: wire.length, metrics, sourceIds: view.businessSources.map(source => source.id), requiredSourceGroups };
  };
  const fits = (result: ReturnType<typeof measure>) => result.metrics.requestChars <= maxChars && result.metrics.requestBytes <= (options.maxBytes ?? Infinity);
  // The server keeps payload, sealed manifests and full canonical citations intact.
  // Only this explicit, disclosed model view may select whole authorized scopes.
  const groups = options.selectRelevant ? vsiContextGroups(payload.businessSources, payload.sharedRelationships || [], payload.question || "") : [];
  const historicalHashes = new Set((payload.historicalSources || []).filter(source => source.sourceType.startsWith("shared_")).map(source => source.sourceId));
  for (const group of groups) if (group.indexes.some(index => historicalHashes.has(payload.businessSources[index].sourceId))) group.required = true;
  const all = measure(payload);
  if (fits(all)) return { ...all, initialMetrics: all.metrics };
  if (!options.selectRelevant) throw new VsiAnswerContextLimit(all.serializedChars, maxChars, all.metrics);
  const view = (indexes: Set<number>): AnswerContext => {
    const businessSources = payload.businessSources.filter((_, index) => indexes.has(index));
    const refs = new Set(businessSources.map(source => source.id)), hashes = new Set(businessSources.map(source => source.sourceId));
    const omitted = payload.businessSources.length - businessSources.length;
    return { ...payload, businessSources, qualitative_sources: payload.qualitative_sources.filter(source => refs.has(source.ref)),
      sharedRelationships: payload.sharedRelationships?.filter(signal => signal.inputSourceIds.every(id => hashes.has(id))),
      evidenceLimitations: [...(payload.evidenceLimitations || []), `${omitted} eligible whole source groups are outside this question's bounded model context. Their details were not assessed. The complete canonical evidence remains stored; do not describe this answer as an exhaustive workspace review.`],
      ...{ contextCoverage: { complete: omitted === 0, selectedSourceGroups: businessSources.length, omittedSourceGroups: omitted, selection: "whole authorized scopes ranked for this question; no facts shortened" } }
    };
  };
  const selected = new Set(groups.filter(group => group.required).flatMap(group => group.indexes));
  let result = measure(view(selected));
  if (!selected.size || !fits(result)) throw new VsiAnswerContextLimit(result.serializedChars, maxChars, result.metrics);
  for (const group of groups.filter(group => !group.required)) {
    const candidate = new Set([...selected, ...group.indexes]), next = measure(view(candidate));
    if (fits(next)) { group.indexes.forEach(index => selected.add(index)); result = next; }
  }
  return { ...result, initialMetrics: all.metrics };
}
