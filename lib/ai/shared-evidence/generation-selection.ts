import { z } from "zod";
import { pluginProviders, type PluginProvider } from "./contracts";
import { requestedVsiProviders, vsiRelevanceScore } from "@/lib/vsi/context-selection";

// These aliases express requested source scope, not permission, entity matching,
// completeness or a demand that every available source support an answer.
export function requestedSharedProviders(question = ""): PluginProvider[] {
  const requested = new Set(requestedVsiProviders(question));
  return pluginProviders.filter(provider => requested.has(provider));
}

/** Keep whole source groups and preserve their internal order. One candidate
 * from each requested provider precedes its next candidate. This is ranking
 * only; every returned candidate still requires the protected read/admission. */
export function prioritizeSharedCandidates<T extends { provider: string }>(
  candidates: readonly T[], requested: readonly PluginProvider[],
): T[] {
  const counts = new Map<string, number>();
  const preferred = new Set<string>(requested);
  return candidates.map((candidate, index) => {
    const ordinal = counts.get(candidate.provider) ?? 0;
    counts.set(candidate.provider, ordinal + 1);
    return { candidate, index, ordinal, tier: preferred.has(candidate.provider) ? 0 : 1 };
  }).sort((a, b) => a.tier - b.tier || a.ordinal - b.ordinal || a.index - b.index)
    .map(item => item.candidate);
}

/** Rank protected source scopes before the preparation budget. Relevance never
 * removes individual facts, authorizes a row, or establishes a join. Matching
 * text is only a priority hint; exact ties retain the catalog order. */
export function prioritizeSharedRows<T extends { provider: string; facts: readonly string[]; scope: Record<string, unknown>; factTimes?: unknown }>(
  rows: readonly T[], requested: readonly PluginProvider[], question = "",
): T[] {
  const uuid = z.string().uuid();
  const entries = rows.map((row, index) => {
    const scopeKey = row.scope.entityBinding === "protected" && uuid.safeParse(row.scope.entityId).success && uuid.safeParse(row.scope.connectionId).success
      ? JSON.stringify([row.provider, row.scope.entityId, row.scope.connectionId]) : `original:${index}`;
    // Match the canonical title/text envelope used by the engine's sources,
    // not a shorter summary with different token evidence.
    const text = `${row.provider.replace(/[_-]/g, " ")} ${JSON.stringify({ scope: row.scope, observations: row.facts, ...(row.factTimes ? { factTimes: row.factTimes } : {}) })}`;
    return { row, index, scopeKey, text, score: vsiRelevanceScore(question, text) };
  });
  // Later model packing scores the union of an entire protected scope. Use
  // that same union here so facts distributed across rows are not discarded
  // before packing in favor of a weaker but repetitive competing scope.
  const scopeTexts = new Map<string, string[]>();
  for (const entry of entries) scopeTexts.set(entry.scopeKey, [...(scopeTexts.get(entry.scopeKey) ?? []), entry.text]);
  const scopeScores = new Map([...scopeTexts].map(([key, texts]) => [key, vsiRelevanceScore(question, texts.join(" "))]));
  const ranked = entries.sort((a, b) => (scopeScores.get(b.scopeKey)! - scopeScores.get(a.scopeKey)!) || b.score - a.score || a.index - b.index);
  return prioritizeSharedCandidates(ranked.map(entry => entry.row), requested);
}

const providerSchema = z.enum([...pluginProviders, "file", "business_note"]);
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const sharedDiscoveryCountsSchema = z.array(z.object({
  provider: providerSchema, total: countSchema, returned: countSchema.max(96),
}).strict()).max(pluginProviders.length + 2);
const catalogSchema = z.object({
  stage: z.literal("catalog_only"),
  candidates: z.array(z.object({ provider: providerSchema, identity: z.record(z.unknown()) }).strict()).max(96),
  truncated: z.boolean(), totalCandidates: countSchema, providerCounts: sharedDiscoveryCountsSchema,
}).strict();

export function decodeSharedDiscoveryCatalog(value: unknown) {
  const catalog = catalogSchema.parse(value);
  const providers = catalog.providerCounts.map(row => row.provider);
  if (new Set(providers).size !== providers.length
    || catalog.providerCounts.some(row => row.returned > row.total)
    || catalog.providerCounts.reduce((total, row) => total + row.total, 0) !== catalog.totalCandidates
    || catalog.providerCounts.reduce((total, row) => total + row.returned, 0) !== catalog.candidates.length
    || catalog.truncated !== (catalog.totalCandidates > catalog.candidates.length)
    || catalog.candidates.some(candidate => !providers.includes(candidate.provider))
    || catalog.providerCounts.some(row => catalog.candidates.filter(candidate => candidate.provider === row.provider).length !== row.returned)) {
    throw new Error("shared_discovery_counts_invalid");
  }
  return catalog;
}
