import { pluginProviders } from "@/lib/ai/shared-evidence/contracts";
import type { VsiCitation } from "./types";

type Source = VsiCitation & { text?: string; inputSourceIds?: string[] };
const aliases: Record<string, string[]> = { quickbooks_online: ["quickbooks", "qbo"], google_sheets: ["google sheets", "sheets", "spreadsheet"], "wix-orders": ["wix orders", "wix"], business_note: ["business note", "approved note"], file: ["processed file", "reviewed file"] };
const providers = [...pluginProviders, "file", "business_note"];
const names = (provider: string) => aliases[provider] || [provider.replace(/[_-]/g, " ")];
const normalized = (value: string) => ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
export function requestedVsiProviders(question: string) {
  const text = normalized(question);
  return providers.filter(provider => names(provider).some(name => text.includes(normalized(name))));
}
export function explicitStoredVsiQuestion(question: string) {
  return /\b(?:stored|workspace|our|my|evidence|observations|executive brief|business brief)\b/i.test(question)
    && (requestedVsiProviders(question).length > 0 || /\b(?:executive|business) brief\b/i.test(question));
}
const stop = new Set("using use only the and from last days give short hypothetical executive brief connect supported with explicitly invented cite both originals retain dates units distinguish facts qualified interpretations missing information do not infer matching causation profit ratios search web stored evidence observations source sources records recorded workspace business our my what how compare review could should would data are is to in of for a an this that as or by at on".split(" "));
const tokens = (text: string) => new Set((text.toLowerCase().match(/[a-z]{3,}/g) || []).filter(word => !stop.has(word)).map(word => word.replace(/s$/, "")));
export function vsiRelevanceScore(question: string, sourceText: string): number {
  const query = tokens(question), words = tokens(sourceText);
  for (const provider of providers) for (const name of names(provider)) for (const token of tokens(name)) query.delete(token);
  return [...query].filter(word => words.has(word)).length;
}

/** Relevance chooses a model view of already authorized originals. It never
 * creates entity correspondence or changes sealed evidence. All rows of the
 * same protected connection/entity and all issued relationship dependencies
 * travel together. Ambiguous top matches stay together rather than picking one. */
export function vsiContextGroups(sources: readonly Source[], relationships: readonly { inputSourceIds: readonly string[] }[], question: string) {
  const parent = sources.map((_, index) => index);
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]));
  const join = (a: number, b: number) => { parent[root(b)] = root(a); };
  const scopes = new Map<string, number>(), byHash = new Map<string, number>();
  sources.forEach((source, index) => {
    if (source.sourceId) byHash.set(source.sourceId, index);
    if (!source.sourceType.startsWith("shared_") || typeof source.text !== "string") return;
    try {
      const scope = JSON.parse(source.text).scope;
      if (scope?.entityBinding === "protected" && typeof scope.entityId === "string" && typeof scope.connectionId === "string") {
        const key = JSON.stringify([source.sourceType, scope.entityId, scope.connectionId]);
        const previous = scopes.get(key);
        if (previous !== undefined) join(previous, index); else scopes.set(key, index);
      }
    } catch { /* Unknown layouts stay indivisible; never infer an authority key. */ }
  });
  for (const ids of [...relationships.map(item => item.inputSourceIds), ...sources.map(source => source.inputSourceIds || [])]) {
    const indexes = ids.flatMap(id => byHash.has(id) ? [byHash.get(id)!] : []);
    for (const index of indexes.slice(1)) join(indexes[0], index);
  }
  const groups = new Map<number, { indexes: number[]; providers: Set<string>; score: number; required: boolean }>();
  sources.forEach((source, index) => {
    const key = root(index), group = groups.get(key) || { indexes: [], providers: new Set<string>(), score: 0, required: false };
    group.indexes.push(index); group.providers.add(source.sourceType.replace(/^shared_/, ""));
    if (!source.sourceType.startsWith("shared_")) group.required = true;
    groups.set(key, group);
  });
  for (const group of groups.values()) {
    group.score = vsiRelevanceScore(question, group.indexes.map(index => `${sources[index].title} ${sources[index].text || ""}`).join(" "));
  }
  const result = [...groups.values()], requested = requestedVsiProviders(question);
  for (const provider of requested) {
    const eligible = result.filter(group => group.providers.has(provider));
    if (!eligible.length) throw new Error("vsi_requested_source_unavailable");
    const best = Math.max(...eligible.map(group => group.score));
    for (const group of eligible) if (group.score === best) group.required = true;
  }
  if (!requested.length) {
    const best = Math.max(0, ...result.map(group => group.score));
    for (const group of result) if (group.score === best) group.required = true;
  }
  return result.sort((a, b) => Number(b.required) - Number(a.required) || b.score - a.score || a.indexes[0] - b.indexes[0]);
}

/** Packing preserves whole scopes, but an answer need not recite every row it
 * could read. Require a cited observation from each requested protected scope.
 * Dependency joins used for packing must not merge independent provider/scope
 * requirements. An unknown scope remains a single exact original. */
export function vsiAnswerCoverageGroups(sources: readonly Source[], relationships: readonly { inputSourceIds: readonly string[] }[], question: string) {
  const requested = new Set(requestedVsiProviders(question)), requirements: string[][] = [];
  for (const group of vsiContextGroups(sources, relationships, question).filter(group => group.required)) {
    const scopes = new Map<string, string[]>();
    for (const index of group.indexes) {
      const source = sources[index], provider = source.sourceType.replace(/^shared_/, "");
      if (requested.size && !requested.has(provider)) continue;
      let key = JSON.stringify([source.sourceType, source.id]);
      try {
        const scope = JSON.parse(source.text || "{}").scope;
        if (scope?.entityBinding === "protected" && typeof scope.entityId === "string" && typeof scope.connectionId === "string") {
          key = JSON.stringify([source.sourceType, scope.entityId, scope.connectionId]);
        }
      } catch { /* Unknown authority is never inferred from titles or values. */ }
      scopes.set(key, [...(scopes.get(key) || []), source.id]);
    }
    requirements.push(...scopes.values());
  }
  return requirements;
}
