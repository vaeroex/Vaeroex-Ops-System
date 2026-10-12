/** Reject recognizable prohibited identifiers and patient-record descriptions before
 * persistence or provider use. These local patterns are a limited safeguard, not a
 * comprehensive PHI detector; do not use them to authorize collecting health records.
 * General healthcare education, business operations, and clearly fictional writing remain supported.
 */
export const VSI_PROHIBITED_INPUT_MESSAGE = "Remove Social Security numbers, medical record numbers, insurance IDs, and patient-identifying information before continuing. Nothing was saved.";

const clinicalInformation = /\b(?:diagnos(?:is|es|ed)|symptoms?|medical\s+(?:history|condition|treatment)|medications?|prescri(?:bed|ption)|lab\s+results?|blood\s+(?:pressure|sugar|test)|heart\s+rate|test(?:ed)?\s+positive|treat(?:ment|ed)\s+for|diabet(?:es|ic)|cancer|asthma|hypertension|hiv|aids|depression|anxiety\s+disorder|clinical\s+anxiety|pregnan(?:t|cy)|allerg(?:y|ies|ic)|infection|pneumonia|insulin|chemotherapy|fever|headaches?|pain(?!\s+points?\b)|seizures?)\b/i;
const actualPatientContext = /\b(?:(?:my|our|this|that|actual|real|existing)\s+patient|(?:actual|real)\s+(?:clinical|medical|patient)\s+(?:case|record)|(?:my|our)\s+(?:clinical|medical)\s+(?:case|record))\b/i;
const clinicalRecordContext = /\b(?:patient\s+(?:record|chart|details|information)|clinical\s+(?:case|note)|medical\s+(?:record|chart)|case\s+(?:report|history))\s*[:=]/i;
const personalHealthFact = new RegExp(`\\b(?:I\\s+(?:have|had)|my\\s+(?:wife|husband|mother|father|mom|dad|son|daughter|child)\\s+(?:has|had))\\s+(?:(?:been|just|recently|a|an|the|severe|mild|chronic|acute|type\\s+[12])\\s+){0,4}${clinicalInformation.source}`, "i");
const educationalTitle = /\b(?:education|safety|privacy|care|information|experience|engagement|communication|support|portal|rights|consent|advocacy|billing|scheduling|services|management|health|prevention|awareness|training)\b/i;
const namePart = "[\\p{Lu}][\\p{L}\\p{M}'’\\-]*";
const fullName = `${namePart}(?:[ \\t]+${namePart}){1,3}`;
const namedPatient = new RegExp(`\\b(?:[Pp]atient|PATIENT)\\s+(?:(?:named|is)\\s+|name\\s*[:=]\\s*)?(${fullName})`, "gu");
const namedClinicalFact = new RegExp(`(${fullName})(?:,?[ \\t]+(?:age[d]?[ \\t]+)?\\d{1,3}[^.;\\n]{0,35})?[, \\t]+(?:has|had|takes|was|is|reports|tested|diagnosed|presents|suffers|underwent|received)\\b`, "gu");

function clearlyFictionalRequest(text: string): boolean {
  // Only an explicit writing/example frame qualifies. A trailing "fictional" label
  // cannot exempt pasted actual-patient or clinical-record content.
  if (actualPatientContext.test(text)) return false;
  return /^\s*(?:(?:please\s+)?(?:write|create|invent|draft|imagine|describe|outline|give|explain)\b[^\n.!?]{0,120}\b(?:fictional|hypothetical|imaginary|made-up)\b|(?:a\s+)?(?:fictional|hypothetical|imaginary|made-up)\s+(?:story|case|scenario|character|example|patient)\b|(?:in|for)\s+(?:my|a|the)\s+(?:novel|screenplay|fictional\s+story)\b)/i.test(text);
}

function hasPatientInformation(text: string): boolean {
  if (clearlyFictionalRequest(text)) return false;
  // Explicit patient labels and named-patient statements already identify a care
  // relationship, even without a recognizable condition or diagnosis keyword.
  if (/\bpatient(?:['’]s)?[\s_-]*name["']?\s*[:=]\s*["']?\p{L}/iu.test(text) || /\bpatient\s*[:=]\s*\p{L}+(?:[ \t]+\p{L}+)+/iu.test(text)) return true;
  for (const match of text.matchAll(namedPatient)) if (!educationalTitle.test(match[1]) && !clinicalInformation.test(match[1])) return true;
  if (!clinicalInformation.test(text)) return false;
  if (actualPatientContext.test(text) || clinicalRecordContext.test(text)) return true;
  for (const match of text.matchAll(namedClinicalFact)) if (!educationalTitle.test(match[1]) && !clinicalInformation.test(match[1])) return true;
  if (/\bpatient\s+(?:named\s+)?\p{L}+[ \t]+\p{L}+[ \t]+(?:has|had|is|was|takes|reports|tested)\b/iu.test(text)) return true;
  if (/\b(?:patient\s+(?:email|phone|address)|date\s+of\s+birth|dob)["']?\s*[:=]\s*\S/i.test(text)) return true;
  if (/\bmy\s+(?:diagnosis|medications?|blood\s+(?:pressure|sugar|test)|lab\s+results?|symptoms?)\s+(?:is|are|include|show|was|were)\b/i.test(text)) return true;
  if (/\bI(?:['’]m|\s+am)\s+(?:taking|diagnosed|pregnant|diabetic|allergic|HIV[- ]positive)\b/i.test(text)) return true;
  return personalHealthFact.test(text) || /\b(?:I\s+was\s+diagnosed|my\s+(?:wife|husband|mother|father|mom|dad|son|daughter|child)\s+(?:was\s+diagnosed|is\s+taking))\b/i.test(text);
}

export function hasProhibitedVsiIdentifiers(text: string): boolean {
  if (/(?:^|\D)\d{3}[- ]\d{2}[- ]\d{4}(?:\D|$)/.test(text)) return true;
  if (/\b(?:ssn|social\s+security(?:\s+(?:number|no\.?))?)\s*(?:[:#=-]\s*|is\s+)?\d{9}\b/i.test(text)) return true;
  const identifiers = text.matchAll(/\b(?:mrn|medical\s+record(?:\s+(?:number|no\.?|id))?|insurance\s+(?:id|identifier|member\s+(?:id|number))|patient\s+(?:id|identifier|number))\s*(?:[:#=-]\s*|is\s+)?([a-z0-9][a-z0-9-]{0,39})\b/gi);
  for (const match of identifiers) if (/\d/.test(match[1])) return true;
  return hasPatientInformation(text);
}
