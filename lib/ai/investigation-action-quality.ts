const SOURCE_STOP_WORDS = new Set([
  "the", "underlying", "source", "records", "record", "measurements", "measurement", "kpi", "imported",
  "original", "and", "for", "from", "each", "dated", "data", "row", "rows", "this", "that"
]);

/** Reject generic model paraphrases that discard the approved source and investigation. */
export function followsApprovedInvestigation(output: string, approved: string, stale: boolean) {
  const text = output.toLowerCase();
  if (/\b(?:decide whether to investigate|continue monitoring|review the (?:data|source records|kpi) and decide)\b/i.test(output)) return false;
  const planned = /\b(?:inspect|examine|review)\b/i.test(approved);
  if (!planned) return true;
  if (!/\b(?:inspect|examine|review|check|compare|refresh|obtain)\b/.test(text)) return false;
  if (stale && /\b(?:refresh|update|recheck)\b/i.test(approved) && !/\b(?:refresh|update|recheck)\b/.test(text)) return false;

  const sourcePhrase = approved.match(/\b(?:inspect|examine|review)\s+(.+?)\s+for\s+(?:the\s+affected\s+periods|\d{4}|the\s+recorded\s+period)/i)?.[1]
    || approved.match(/\b(?:inspect|examine|review)\s+(.+?)(?:\.|;)/i)?.[1]
    || "";
  const sourceTerms = sourcePhrase.toLowerCase().match(/[a-z][a-z-]{3,}/g)?.filter((term) => !SOURCE_STOP_WORDS.has(term)) || [];
  if (sourceTerms.length && !sourceTerms.some((term) => text.includes(term))) return false;
  if (/\bcompare\b/i.test(approved) && !/\b(?:compare|segment|group|contrast|check .{0,60} against)\b/i.test(output)) return false;
  return true;
}
