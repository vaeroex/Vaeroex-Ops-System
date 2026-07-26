import {
  type BusinessNoteAdditionalContextKey,
  type BusinessNoteAdditionalContextPrompt,
  type BusinessNoteExtraction,
  type BusinessNoteUserAddedContext
} from "@/lib/ai/business-notes/contracts";

const MAX_PROMPTS = 3;
const MAX_VALUE_LENGTH = 240;

const PROMPTS: Readonly<Record<BusinessNoteAdditionalContextKey, BusinessNoteAdditionalContextPrompt>> = {
  reporting_period: {
    key: "reporting_period",
    label: "Reporting period",
    placeholder: "Example: July 2026 or Q2 2026"
  },
  delay_duration: {
    key: "delay_duration",
    label: "Approximate delay duration",
    placeholder: "Example: About 45 minutes"
  },
  department: {
    key: "department",
    label: "Department",
    placeholder: "Example: Transport operations"
  },
  location: {
    key: "location",
    label: "Location",
    placeholder: "Example: North facility"
  },
  relevant_team: {
    key: "relevant_team",
    label: "Relevant team",
    placeholder: "Example: Dispatch team"
  },
  organization_name: {
    key: "organization_name",
    label: "Customer or organization name",
    placeholder: "Add only when the relationship depends on it"
  },
  incident_identifier: {
    key: "incident_identifier",
    label: "Incident identifier",
    placeholder: "Add only when it is needed to connect related records"
  }
};

const LOW_VALUE_IDENTITY_REQUEST = /individual staff|staff names?|employee names?|customer (?:hospital )?by name|customer names?|vehicle|ambulance (?:number|identifier)|unit (?:number|identifier)/i;

function combinedMissingContext(extraction: BusinessNoteExtraction) {
  return extraction.missingContext.join(" ");
}

function mentions(value: string, pattern: RegExp) {
  return pattern.test(value);
}

export function businessNoteAdditionalContextPrompts(
  extraction: BusinessNoteExtraction
): BusinessNoteAdditionalContextPrompt[] {
  const missing = combinedMissingContext(extraction);
  const prompts: BusinessNoteAdditionalContextPrompt[] = [];
  const add = (key: BusinessNoteAdditionalContextKey, condition: boolean) => {
    if (condition && !prompts.some((prompt) => prompt.key === key)) prompts.push(PROMPTS[key]);
  };

  add(
    "reporting_period",
    extraction.reportingPeriod.inferred
      || extraction.reportingPeriod.start === null
      || extraction.reportingPeriod.end === null
      || mentions(missing, /reporting (?:period|date)|date (?:is|was) not specified|time ?frame|when (?:this|the)/i)
  );
  add("delay_duration", mentions(missing, /delay duration|duration of (?:the )?delay|how long|length of (?:the )?(?:delay|backup)|wait time/i));
  add("department", mentions(missing, /department|business area|responsible function/i));
  add("location", mentions(missing, /location|site|store|facility|where (?:the )?(?:event|incident)/i));
  add("relevant_team", mentions(missing, /relevant team|responsible team|which team|team involved/i));

  const identityIsMaterial = mentions(missing, /(?:customer|client|vendor|organization).*(?:relationship|contract|account|comparison|link related)|(?:relationship|contract|account).*(?:customer|client|vendor|organization)/i);
  add("organization_name", identityIsMaterial && !LOW_VALUE_IDENTITY_REQUEST.test(missing));

  const incidentIdentifierIsMaterial = extraction.noteType === "incident"
    && mentions(missing, /incident (?:identifier|number|reference)|case (?:number|reference)|reference number/i)
    && !LOW_VALUE_IDENTITY_REQUEST.test(missing);
  add("incident_identifier", incidentIdentifierIsMaterial);

  return prompts.slice(0, MAX_PROMPTS);
}

export function parseBusinessNoteUserAddedContext(
  formData: FormData,
  extraction: BusinessNoteExtraction
): BusinessNoteUserAddedContext[] {
  return businessNoteAdditionalContextPrompts(extraction).flatMap((prompt) => {
    const raw = formData.get(`additional_context_${prompt.key}`);
    if (typeof raw !== "string" || !raw.trim()) return [];
    const value = raw.trim();
    if (value.length > MAX_VALUE_LENGTH) {
      throw new Error(`${prompt.label} must be ${MAX_VALUE_LENGTH} characters or fewer.`);
    }
    return [{
      field: prompt.key,
      label: prompt.label,
      value,
      provenance: "supplied_during_review" as const,
      userProvided: true as const,
      partOfOriginalNoteQuotation: false as const,
      evidenceTreatment: "contextual_metadata" as const
    }];
  });
}

export function businessNoteUserAddedContextText(context: readonly BusinessNoteUserAddedContext[]) {
  return context.map((item) => (
    `User-provided review context (${item.label}; supplied during review; not part of the original note quotation; unverified): ${item.value}`
  ));
}
