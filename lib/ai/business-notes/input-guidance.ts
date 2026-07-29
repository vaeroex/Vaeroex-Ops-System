export const BUSINESS_NOTE_RECOMMENDED_MIN_CHARACTERS = 300;
export const BUSINESS_NOTE_RECOMMENDED_MAX_CHARACTERS = 2_000;
export const BUSINESS_NOTE_LARGE_WARNING_CHARACTERS = 5_000;
export const BUSINESS_NOTE_SUBMISSION_MAX_CHARACTERS = 10_000;

export const BUSINESS_NOTE_MAX_LENGTH_MESSAGE =
  "Business Notes are intended for focused business context and are limited to 10,000 characters. Please upload larger materials as documents instead.";

export function businessNoteInputGuidance(characterCount: number) {
  return {
    showLargeNoteWarning: characterCount >= BUSINESS_NOTE_LARGE_WARNING_CHARACTERS,
    exceedsMaximum: characterCount > BUSINESS_NOTE_SUBMISSION_MAX_CHARACTERS
  } as const;
}
