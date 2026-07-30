import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { TRUST_CLAIM_EXTRACTOR_VERSION_V1, type ClaimTypeV1, type ClaimV1, type ReferencedValueV1 } from "@/lib/ai/trust/contracts";

export type TrustProseSectionsV1 = Readonly<Record<"executive_interpretation" | "why_it_matters" | "leadership_consideration" | "provisional_hypothesis", string | null>>;

const NUMBER_PATTERN = /(?<![A-Za-z0-9])-?\$?\d[\d,]*(?:\.\d+)?%?/g;
const DATE_PATTERN = /\b(?:\d{4}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?)\b/gi;
const PERIOD_PATTERN = /\b(?:Q[1-4]\s*\d{4}|FY\s*\d{2,4}|this|last|previous|current|next)\s+(?:day|week|month|quarter|year|period)\b/gi;
const CITATION_PATTERN = /\[\s*(\d+)\s*\]/g;
const CAUSAL_PATTERN = /\b(?:caused? by|because of|results? in|leads? to|drives?|due to|therefore|consequently)\b/i;
const RECOMMENDATION_PATTERN = /\b(?:review|consider|prioritize|investigate|monitor|address|replace|implement|change|focus on|leadership should|recommend)\b/i;
const PREDICTION_PATTERN = /\b(?:will|forecast|predict|expected to|likely to)\b/i;
const INFERENCE_PATTERN = /\b(?:indicates?|implies?|may help explain|could reflect|appears? to)\b/i;
const ASSUMPTION_PATTERN = /\b(?:assum(?:e|ed|ption)|presum(?:e|ed)|if we assume)\b/i;
const LIMITATION_PATTERN = /\b(?:limitation|limited by|does not establish|cannot determine|insufficient|not available|no valid)\b/i;
const UNCERTAINTY_PATTERN = /\b(?:may|might|could|appears?|suggests?|uncertain|possibly|potentially|not clear)\b/i;
const COMPARISON_PATTERN = /\b(?:above|below|higher|lower|increased|decreased|declined|improved|worsened|versus|vs\.?|compared|from|to|target)\b/i;
const CONTEXT_PATTERN = /\b(?:business note|reported context|the author|the note|user-provided)\b/i;
const EVIDENCE_PATTERN = /\b(?:evidence|recorded|observed|latest eligible value|supporting source)\b/i;
const MATERIAL_PATTERN = /\b(?:business|health|score|status|risk|opportunity|driver|revenue|margin|retention|customer|cost|sales|target|evidence|leadership|performance|confidence)\b/i;
const CONNECTIVE_PATTERN = /^(?:however|therefore|meanwhile|in addition|as a result|overall|accordingly)[,\s]*$/i;

function splitSentences(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character !== "." && character !== "!" && character !== "?") continue;
    if (character === "." && /\d/.test(normalized[index - 1] || "") && /\d/.test(normalized[index + 1] || "")) continue;
    const sentence = normalized.slice(start, index + 1).trim();
    if (sentence) sentences.push(sentence);
    start = index + 1;
  }
  const remainder = normalized.slice(start).trim();
  if (remainder) sentences.push(remainder);
  return sentences;
}

function splitAtomicClaims(sentence: string) {
  const split = sentence.split(/;\s+|,\s+(?=(?:while|whereas|but|however)\b)|\s+(?=(?:whereas|but)\s+)/i)
    .map((part) => part.replace(/^(?:while|whereas|but|however)\s+/i, "").trim()).filter(Boolean);
  return split.length > 1 && split.every((part) => part.length >= 12) ? split : [sentence.trim()];
}

function referencedValueRole(text: string, raw: string, index: number): ReferencedValueV1["role"] {
  const before = text.slice(Math.max(0, index - 24), index).toLowerCase();
  const after = text.slice(index + raw.length, index + raw.length + 18).toLowerCase();
  if (/target\s*(?:is|was|:|=)?\s*$/.test(before) || /^\s*(?:is\s+)?(?:the\s+)?target\b/.test(after)) return "target";
  if (/(?:actual|current|latest)\s*(?:is|was|:|=)?\s*$/.test(before)) return "actual";
  if (/previous\s*(?:is|was|:|=)?\s*$/.test(before)) return "comparison";
  if (/score\s*(?:is|was|:|=)?\s*$/.test(before)) return "score";
  return "unknown";
}

function referencedValues(text: string): ReferencedValueV1[] {
  const dateMatches = Array.from(text.matchAll(new RegExp(DATE_PATTERN.source, "gi")));
  const periodMatches = Array.from(text.matchAll(new RegExp(PERIOD_PATTERN.source, "gi")));
  const citationMatches = Array.from(text.matchAll(new RegExp(CITATION_PATTERN.source, "g")));
  const excludedNumericRanges = [...dateMatches, ...periodMatches, ...citationMatches].map((match) => [match.index || 0, (match.index || 0) + match[0].length] as const);
  const numberMatches = Array.from(text.matchAll(new RegExp(NUMBER_PATTERN.source, "g")))
    .filter((match) => !excludedNumericRanges.some(([start, end]) => (match.index || 0) >= start && (match.index || 0) < end));
  const values: ReferencedValueV1[] = numberMatches.map((match) => {
    const raw = match[0];
    const numeric = raw.replace(/[$,%\s,]/g, "");
    const numberValue = Number(numeric);
    const decimals = numeric.includes(".") ? numeric.split(".")[1]?.length || 0 : 0;
    const index = match.index || 0;
    const local = text.slice(Math.max(0, index - 18), index + raw.length + 20).toLowerCase();
    const explicitUnit = local.match(/\b(?:minutes?|hours?|days?|weeks?|months?|years?|points?|items?|orders?|transports?|staff)\b/)?.[0] || null;
    return {
      raw,
      normalized: Number.isFinite(numberValue) ? String(numberValue) : numeric.replace(/^\+/, ""),
      kind: raw.includes("$") ? "currency" as const : raw.includes("%") ? "percentage" as const : "number" as const,
      canonicalPath: null,
      role: referencedValueRole(text, raw, index),
      sign: numeric.startsWith("-") ? "negative" as const : numeric.startsWith("+") ? "positive" as const : "unsigned" as const,
      unit: raw.includes("$") ? "currency" : raw.includes("%") ? "percent" : explicitUnit?.replace(/s$/, "") || null,
      precision: decimals,
      asOf: null
    };
  });
  for (const match of dateMatches) values.push({ raw: match[0], normalized: match[0].toLowerCase(), kind: "date", canonicalPath: null, role: "unknown", sign: "unsigned", unit: null, precision: null, asOf: match[0] });
  for (const match of periodMatches) values.push({ raw: match[0], normalized: match[0].toLowerCase(), kind: "reporting_period", canonicalPath: null, role: "comparison", sign: "unsigned", unit: null, precision: null, asOf: match[0] });
  return values;
}

function classifications(text: string): ClaimTypeV1[] {
  const found: ClaimTypeV1[] = [];
  if (CAUSAL_PATTERN.test(text)) found.push("causal_claim");
  if (RECOMMENDATION_PATTERN.test(text)) found.push("recommendation");
  if (PREDICTION_PATTERN.test(text)) found.push("prediction");
  if (ASSUMPTION_PATTERN.test(text)) found.push("assumption");
  if (LIMITATION_PATTERN.test(text)) found.push("limitation");
  if (UNCERTAINTY_PATTERN.test(text)) found.push("uncertainty_statement");
  if (COMPARISON_PATTERN.test(text)) found.push("comparison");
  if (CONTEXT_PATTERN.test(text)) found.push("contextual_business_note_fact");
  if (new RegExp(CITATION_PATTERN.source).test(text)) found.push("citation_bearing_claim");
  if (EVIDENCE_PATTERN.test(text)) found.push("supported_evidence_fact");
  if (INFERENCE_PATTERN.test(text)) found.push("inference");
  if ((new RegExp(NUMBER_PATTERN.source).test(text) || MATERIAL_PATTERN.test(text)) && !CONTEXT_PATTERN.test(text)) found.push("deterministic_fact");
  if (!found.length && CONNECTIVE_PATTERN.test(text)) found.push("connective_language");
  if (!found.length && MATERIAL_PATTERN.test(text)) found.push("unknown_material_claim");
  if (!found.length) found.push(text.length < 18 ? "non_material_language" : "unknown_material_claim");
  return Array.from(new Set(found));
}

function primaryType(types: readonly ClaimTypeV1[]) {
  const priority: ClaimTypeV1[] = ["causal_claim", "prediction", "recommendation", "assumption", "limitation", "contextual_business_note_fact", "comparison", "supported_evidence_fact", "deterministic_fact", "citation_bearing_claim", "uncertainty_statement", "inference", "unknown_material_claim", "connective_language", "non_material_language"];
  return priority.find((type) => types.includes(type)) || "unknown_material_claim";
}

export function extractClaimsV1(sections: TrustProseSectionsV1): ClaimV1[] {
  const claims: ClaimV1[] = [];
  for (const [sectionId, value] of Object.entries(sections)) {
    if (!value) continue;
    for (const sentence of splitSentences(value)) {
      for (const text of splitAtomicClaims(sentence)) {
        const ordinal = claims.length + 1;
        const textHash = evidenceEngineHash({ extractor: TRUST_CLAIM_EXTRACTOR_VERSION_V1, text });
        const claimTypes = classifications(text);
        const citationIds = Array.from(text.matchAll(new RegExp(CITATION_PATTERN.source, "g")), (match) => Number(match[1]));
        claims.push({ claimId: `claim_${evidenceEngineHash({ sectionId, ordinal, text }).slice(0, 24)}`, sectionId, ordinal, text, textHash, claimType: primaryType(claimTypes), claimTypes, supportingEvidenceIds: [], citationIds, deterministicReferences: [], referencedValues: referencedValues(text), kpiReferences: [], assumptions: claimTypes.includes("assumption") ? [textHash] : [], limitations: claimTypes.includes("limitation") ? [textHash] : [], qualifierRequirements: [], ruleOutcomes: [], rejectedReasonCodes: [] });
      }
    }
  }
  return claims;
}
