import type { SynthesisSource } from "@/lib/ai/shared-evidence/qualitative-synthesis";
import type { VsiCitation } from "./types";

type AnswerContext = {
  businessSources: Array<VsiCitation & { text?: string }>;
  qualitative_sources: SynthesisSource[];
};

const observationLayout = "For a businessSources entry whose text contains observationsRef, its complete observations are the facts of qualitative_sources with that exact ref. Read those facts together with the entry's scope. This is one original source represented once, not independent corroboration. Citation IDs, bindings and source dependencies are unchanged.";

export class VsiAnswerContextLimit extends Error {
  constructor(public readonly serializedChars: number, public readonly maxChars: number) {
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
    compactedSources++;
    return { ...source, text: JSON.stringify({ ...context, observationsRef: source.id }) };
  });
  if (!compactedSources) return { json: original, compactedSources: 0 };
  const json = JSON.stringify({ ...payload, businessSources, sharedObservationLayout: observationLayout });
  // Reference overhead can exceed tiny facts; do not enlarge those requests.
  return json.length < original.length ? { json, compactedSources } : { json: original, compactedSources: 0 };
}

export function packVsiAnswerContext<T extends AnswerContext>(payload: T, systemPrompt: string, maxChars: number) {
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) throw new RangeError("invalid_vsi_context_budget");
  const packed = serializeVsiAnswerContext(payload);
  const serializedChars = packed.json.length + systemPrompt.length;
  if (serializedChars > maxChars) throw new VsiAnswerContextLimit(serializedChars, maxChars);
  return { ...packed, serializedChars };
}
