const SOURCE_STOP_WORDS = new Set([
  "the", "underlying", "source", "records", "record", "measurements", "measurement", "kpi", "imported",
  "original", "and", "for", "from", "each", "dated", "data", "row", "rows", "this", "that",
  "figures", "latest", "results", "behind", "current"
]);

/** Technical provenance belongs in linked evidence, not in the owner's next step. */
export function hasTechnicalAdviceLanguage(value: string) {
  return /\b(?:numerator|denominator|row-level|source rows?|current imported records|refresh source first|verify repeatability|kpi source row|row\s*#?\d+)\b/i.test(value);
}

// Keep details named by a later check from being mistaken for the object of a source request.
const NEXT_ACTION = /\b(?:and|then)\s+(?:confirm|check|review|examine|inspect|identify|find|see|verify|determine|decide|note|state|compare|group|assign)\b/i;
function sourceRequestObjects(text: string) {
  return [...text.matchAll(/\b(get|obtain|request|ask)\b([^.!?;]*)/gi)]
    .map(([, verb, rest]) => ({ verb: verb.toLowerCase(), object: rest.split(NEXT_ACTION, 1)[0].split(/\b(?:whether|if)\b/i, 1)[0].toLowerCase() }))
    .filter(({ verb, object }) => verb !== "ask" || /\bfor\b/.test(object))
    .map(({ object }) => object);
}

/** Reject generic model paraphrases that discard the approved source and investigation. */
function followsApprovedInvestigationCore(output: string, approved: string, stale: boolean, requireMissingDetail: boolean) {
  const text = output.toLowerCase();
  if (/\b(?:decide whether to investigate|continue monitoring|review the (?:data|source records|kpi) and decide)\b/i.test(output)) return false;
  const unavailableDetail = approved.match(/(?:^|[.;]\s*)([a-z][a-z -]{2,70}?)\s+(?:is|are)\s+not available\b/i)?.[1];
  if (requireMissingDetail && unavailableDetail) {
    const detailTerms = unavailableDetail.toLowerCase().match(/[a-z][a-z-]{3,}/g)?.filter((term) => !SOURCE_STOP_WORDS.has(term)) || [];
    if (!/\b(?:not available|unavailable|missing)\b/.test(text)
      || !sourceRequestObjects(text).some((object) => detailTerms.length === 0 || detailTerms.some((term) => object.includes(term)))) return false;
  }
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

export function followsApprovedInvestigation(output: string, approved: string, stale: boolean) {
  return followsApprovedInvestigationCore(output, approved, stale, true);
}

/** Retain the application's approved missing-source instruction when a model omits it. */
export function completeApprovedMissingDetail(output: string, approved: string, stale: boolean, maxLength: number) {
  const missingDetailSentence = approved.match(/(?:^|[.!?]\s+)([^.!?]*\b(?:is|are) not available\b[^.!?]*[.!?])/i)?.[1]?.trim();
  if (!missingDetailSentence || !/\b(?:get|obtain|request|ask)\b/i.test(missingDetailSentence)) return output;

  const [availability, request = ""] = missingDetailSentence.split(";");
  const requestTerms = request.toLowerCase().match(/[a-z][a-z-]{3,}/g)?.filter((term) => !SOURCE_STOP_WORDS.has(term)
    && !["obtain", "request"].includes(term)) || [];
  const alreadyRequested = (text: string) => requestTerms.length > 0
    && sourceRequestObjects(text).some((object) => requestTerms.every((term) => object.includes(term)));
  const exactSentenceAt = output.toLowerCase().indexOf(missingDetailSentence.toLowerCase());
  if (exactSentenceAt >= 0) {
    const withoutApprovedSentence = `${output.slice(0, exactSentenceAt)} ${output.slice(exactSentenceAt + missingDetailSentence.length)}`;
    if (alreadyRequested(withoutApprovedSentence)) {
      return `${output.slice(0, exactSentenceAt)}${availability.trim()}.${output.slice(exactSentenceAt + missingDetailSentence.length)}`.trim();
    }
  }
  if (followsApprovedInvestigation(output, approved, stale)
    || !followsApprovedInvestigationCore(output, approved, stale, false)) return output;

  const completed = `${output.trim()} ${alreadyRequested(output) ? `${availability.trim()}.` : missingDetailSentence}`;
  return completed.length <= maxLength ? completed : approved.length <= maxLength ? approved : output;
}
