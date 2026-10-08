const SOURCE_STOP_WORDS = new Set([
  "the", "underlying", "source", "records", "record", "measurements", "measurement", "kpi", "imported",
  "original", "and", "for", "from", "each", "dated", "data", "row", "rows", "this", "that",
  "figures", "latest", "results", "behind", "current"
]);

/** Technical provenance belongs in linked evidence, not in the owner's next step. */
export function hasTechnicalAdviceLanguage(value: string) {
  return /\b(?:numerator|denominator|row-level|source rows?|current imported records|refresh source first|verify repeatability|kpi source row|row\s*#?\d+)\b/i.test(value);
}

/** Reject generic model paraphrases that discard the approved source and investigation. */
export function followsApprovedInvestigation(output: string, approved: string, stale: boolean) {
  const text = output.toLowerCase();
  if (/\b(?:decide whether to investigate|continue monitoring|review the (?:data|source records|kpi) and decide)\b/i.test(output)) return false;
  const planned = /\b(?:inspect|examine|review|check|update|get)\b/i.test(approved);
  if (!planned) return true;
  if (!/\b(?:inspect|examine|review|check|compare|refresh|update|obtain|get)\b/.test(text)) return false;
  const currentDataStep = /\b(?:refresh|update|recheck|get (?:the )?(?:latest|current))\b/i;
  if (stale && currentDataStep.test(approved) && !currentDataStep.test(output)) return false;

  const sourcePhrase = approved.match(/\b(?:check|review|get)(?:\s+the|\s+latest)?\s+records\s+(?:from|behind)\s+(.+?)(?:\s+(?:now|for|before)\b|[.,;])/i)?.[1]
    || approved.match(/\b(?:inspect|examine|review|check|update)\s+(.+?)\s+(?:for|from|before)\b/i)?.[1]
    || approved.match(/\b(?:inspect|examine|review|check|update|get)\s+(.+?)(?:\.|;)/i)?.[1]
    || "";
  const sourceTerms = sourcePhrase.toLowerCase().match(/[a-z][a-z-]{3,}/g)?.filter((term) => !SOURCE_STOP_WORDS.has(term)) || [];
  if (sourceTerms.length && !sourceTerms.some((term) => text.includes(term))) return false;
  if (/\bcompare\b/i.test(approved) && !/\b(?:compare|segment|group|contrast|check .{0,60} against)\b/i.test(output)) return false;
  return true;
}
