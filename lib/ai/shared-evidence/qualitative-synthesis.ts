import { z } from "zod";

/** A bounded hypothesis channel, not a semantic-entailment verifier. Complete
 * issued premises and immutable bindings are checked mechanically. Novel prose
 * remains explicitly unverified; real-model/adversarial evaluation is required
 * before activation. It can never confer source eligibility or numeric authority. */
export const qualitativeInterpretationSchema = z.object({
  premises: z.array(z.object({ ref: z.string().min(1).max(80), binding: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/), quote: z.string().min(20).max(8_000) }).strict()).min(2).max(8),
  hypothesis: z.string().trim().min(30).max(500),
  missing_information: z.string().trim().min(20).max(500),
  next_check: z.string().trim().min(20).max(500)
}).strict();
export type QualitativeInterpretation = z.infer<typeof qualitativeInterpretationSchema>;
export const qualitativeAuthoredFields = ["hypothesis", "missing_information", "next_check"] as const;
export const qualitativeAssertionRules = ["quantitative_language", "causal_language", "certainty_language", "record_linkage_language", "calculation_language", "formatting", "restricted_language"] as const;
export type QualitativeAuthoredField = typeof qualitativeAuthoredFields[number];
export type QualitativeAssertionRule = typeof qualitativeAssertionRules[number];
/** Static metadata only. Never retain the rejected field, match or premise. */
export class QualitativeAssertionError extends Error {
  constructor(readonly rule: QualitativeAssertionRule, readonly field: QualitativeAuthoredField) {
    super("interpretation_assertion_denied");
  }
}
export type SynthesisSource = Readonly<{ ref: string; binding: string; dependencies: readonly string[]; facts: readonly string[]; reported: "file" | "note" | false; environment: "production" | "sandbox" | "supporting"; installation?: string }>;
export const qualitativeInterpretationJsonSchema = {
  description: "All authored fields are single English sentences using exact premise business words and neutral review language, without new paraphrases or inflections. No source labels, references, URLs, brackets, braces, angle brackets, semicolons, line breaks or abbreviations; no numbers, dates or calculations.",
  type: "object", additionalProperties: false, required: ["premises", "hypothesis", "missing_information", "next_check"], properties: {
    premises: { type: "array", minItems: 2, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["ref", "binding", "quote"], properties: { ref: { type: "string" }, binding: { type: "string" }, quote: { type: "string" } } } },
    hypothesis: { type: "string", description: "Contains may, might or could. The application adds the unverified label and disclaimer." },
    missing_information: { type: "string", description: "Begins Whether, Which, What or How; ask about comparability, coverage or missing context. Restricted words remain prohibited even in questions or negations." },
    next_check: { type: "string", description: "Begins Review, Inspect, Check, Verify, Collect or Compare." }
  }
} as const;

// Grammar/grounding vocabulary, not a whitelist of business relationships.
// Business-specific nouns must occur in the complete cited premises. This is
// deliberately conservative; token reuse is not proof that a hypothesis follows.
const neutral = new Set(("a an the this these those it its their they them and or but of to for with without in on at by as from into about between alongside across whether which what how if when may might could possible possibly potential hypothesis interpretation observations evidence context reported measured business review reviewing inspect inspecting check checking verify verifying collect collecting confirm compare comparing relevant relevance warrant warrants attention priority questions question understanding understand clarification clarify availability available timing pattern patterns uncertainty uncertain information missing unknown records record original originals scope coverage period periods same different difference differences entity entities item items transaction transactions matching comparable comparison compatibility completeness concern concerns support supported establish established causal conclusion conclusions not no is are be been being can cannot does do would should need needs needed more further separately remains remain only useful focus consider considering test testing before after must also each any all than then we you our your" ).split(/\s+/));
const words = (text: string) => text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
const businessWords = (text: string) => words(text).filter(word => word.length > 2 && !neutral.has(word));
const forbidden = /[\d$€£%]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|percent|ratio|per.hour|profitability|caus(?:e[ds]?|ing)|because|due to|therefore|proves?|proven|guarantee[ds]?|definitely|correlat\w*|reconcil\w*|matched|linked|identical|attribut\w*|driv(?:e[sn]?|ing)|drove|result(?:s|ed|ing)? in|leads? to|offset\w*|higher than|lower than|greater than|less than|equals?|sum(?:med)?|add(?:ed|ing)?|combined total)\b/i;
// Classification cannot change acceptance: the unchanged forbidden expression
// above remains the gate. These groups only explain its content-free category.
const assertionCategories: readonly (readonly [QualitativeAssertionRule, RegExp])[] = [
  ["quantitative_language", /[\d$€£%]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|percent|ratio|per.hour|profitability)\b/i],
  ["causal_language", /\b(?:caus(?:e[ds]?|ing)|because|due to|therefore|driv(?:e[sn]?|ing)|drove|result(?:s|ed|ing)? in|leads? to)\b/i],
  ["certainty_language", /\b(?:proves?|proven|guarantee[ds]?|definitely)\b/i],
  ["record_linkage_language", /\b(?:correlat\w*|reconcil\w*|matched|linked|identical|attribut\w*)\b/i],
  ["calculation_language", /\b(?:offset\w*|higher than|lower than|greater than|less than|equals?|sum(?:med)?|add(?:ed|ing)?|combined total)\b/i]
];

export function validateQualitativeInterpretation(value: unknown, sources: readonly SynthesisSource[]): QualitativeInterpretation {
  const claim = qualitativeInterpretationSchema.parse(value);
  const byRef = new Map(sources.map(source => [source.ref, source]));
  if (byRef.size !== sources.length) throw new Error("interpretation_duplicate_context_reference");
  const resolved = claim.premises.map(p => {
    const source = byRef.get(p.ref);
    if (!source || p.binding !== source.binding || !source.facts.includes(p.quote)) throw new Error("interpretation_premise_changed");
    return source;
  });
  // A reference identifies an original with potentially several issued facts.
  // Different exact facts may reuse it; the same premise may not be repeated.
  const premiseKeys = new Set(claim.premises.map(p => JSON.stringify([p.ref, p.binding, p.quote])));
  if (premiseKeys.size !== claim.premises.length) throw new Error("interpretation_duplicate_premise");
  // Reusing an original never counts as independent corroboration and does not
  // evade shared-dependency checks between different source references.
  const used = [...new Map(resolved.map(source => [source.ref, source])).values()];
  if (new Set(used.map(s => s.binding)).size < 2) throw new Error("interpretation_distinct_dependencies_required");
  if(used.some((s,index)=>!s.dependencies.length||used.slice(0,index).some(previous=>previous.dependencies.some(id=>s.dependencies.includes(id))))) throw new Error("interpretation_distinct_dependencies_required");
  const environments = new Set(used.filter(s => s.environment !== "supporting").map(s => s.environment));
  const installations = new Set(used.filter(s => s.environment === "sandbox").map(s => s.installation));
  if (environments.size > 1 || installations.size > 1 || (installations.size && installations.has(undefined))) throw new Error("interpretation_environment_changed");
  if (!/\b(?:may|might|could)\b/i.test(claim.hypothesis) || !/^(?:Whether|Which|What|How)\b/i.test(claim.missing_information)
    || !/^(?:Review|Inspect|Check|Verify|Collect|Compare)\b/i.test(claim.next_check)) throw new Error("interpretation_qualification_required");
  const vocabulary = new Set(claim.premises.flatMap(p => words(p.quote)));
  for (const field of qualitativeAuthoredFields) {
    const text = claim[field];
    // The current product locale is English. Do not let invisible/non-Latin
    // assertions or Unicode numbers escape the bounded English token checks.
    if(!/^[\x20-\x7e\u2018\u2019\u201c\u201d\u2013\u2014]+$/u.test(text)||/\p{N}/u.test(text)) throw new Error("interpretation_unsupported_characters");
    if (forbidden.test(text)) throw new QualitativeAssertionError(assertionCategories.find(([, pattern]) => pattern.test(text))?.[0] || "restricted_language", field);
    if (/[\n\r;<>\[\]{}]|https?:|[.!?].*\S/.test(text)) throw new QualitativeAssertionError("formatting", field);
    // Attribution lives only in application-issued premises; an interpretation
    // cannot move a fact to another plugin/file/note or assert a hidden join.
    if(/\b(?:Square|QuickBooks|Google Sheets|Clockify|Harvest|Katana|Zoho|Xero|Loyverse|Wix|Business Notes?|reviewed file|according to|says?|reports?|shows?|confirms?|same (?:entity|item|transaction|period|record))\b/i.test(text)) throw new Error("interpretation_attribution_denied");
    if (businessWords(text).some(word => !vocabulary.has(word))) throw new Error("interpretation_unsupported_term");
  }
  const hypothesisWords = new Set(businessWords(claim.hypothesis));
  for (const premise of claim.premises) {
    // Each quoted fact must contribute to the hypothesis relative to the other
    // originals. Sibling facts from this original are not competing witnesses.
    const otherWords=new Set(claim.premises.filter(p=>p.ref!==premise.ref).flatMap(p=>businessWords(p.quote)));
    if (!businessWords(premise.quote).some(word => !otherWords.has(word)&&hypothesisWords.has(word))) throw new Error("interpretation_grounding_missing");
  }
  return claim;
}

export function renderQualitativeInterpretation(claim: QualitativeInterpretation, sources: readonly SynthesisSource[], cite: (ref: string) => string = () => ""): string {
  // Also used when reopening stored metadata; never render an unchecked object.
  const checked = validateQualitativeInterpretation(claim, sources);
  const premises = checked.premises.map(p => {
    const source = sources.find(s => s.ref === p.ref)!;
    const label = source.reported === "file" ? "Reviewed file (reported context)" : source.reported === "note" ? "Approved Business Note (reported context)" : source.environment === "sandbox" ? "Sandbox observation" : "Recorded observation";
    return `${label}: “${p.quote}”${cite(p.ref)}`;
  });
  return [`Interpretation (unverified hypothesis): ${checked.hypothesis}`, ...premises,
    `Missing information: ${checked.missing_information}`, `Next check: ${checked.next_check}`,
    "These premises do not establish a causal explanation, matched records, comparable periods or complete coverage. This interpretation is not a measured finding or a calculation."].join("\n");
}
