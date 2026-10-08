/** Reject recognizable prohibited identifiers before persistence or provider use.
 * This is a narrow input guard, not a claim to detect all patient information.
 * General healthcare questions and business operations remain supported.
 */
export const VSI_PROHIBITED_INPUT_MESSAGE = "Remove Social Security numbers, medical record numbers, insurance IDs, and patient-identifying information before continuing. Nothing was saved.";

export function hasProhibitedVsiIdentifiers(text: string): boolean {
  if (/(?:^|\D)\d{3}[- ]\d{2}[- ]\d{4}(?:\D|$)/.test(text)) return true;
  if (/\b(?:ssn|social\s+security(?:\s+(?:number|no\.?))?)\s*(?:[:#=-]\s*|is\s+)?\d{9}\b/i.test(text)) return true;
  const identifiers = text.matchAll(/\b(?:mrn|medical\s+record(?:\s+(?:number|no\.?|id))?|insurance\s+(?:id|identifier|member\s+(?:id|number))|patient\s+(?:id|identifier|number))\s*(?:[:#=-]\s*|is\s+)?([a-z0-9][a-z0-9-]{0,39})\b/gi);
  for (const match of identifiers) if (/\d/.test(match[1])) return true;
  return false;
}
