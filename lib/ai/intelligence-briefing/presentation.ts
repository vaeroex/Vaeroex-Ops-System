import type {
  IntelligenceBriefingArtifact,
  IntelligenceBriefingClaim,
  IntelligenceBriefingSignal
} from "@/lib/ai/intelligence-briefing/contracts";
import {
  intelligenceBriefingCustomerText,
  intelligenceBriefingMetricName
} from "@/lib/ai/intelligence-briefing/plain-language";

type BriefingPresentationInput = Pick<
  IntelligenceBriefingArtifact,
  "analysis" | "signals" | "eligibility" | "evidenceCoverage" | "limitations" | "contextReferences"
>;

type SummaryCandidate = Readonly<{
  claim: IntelligenceBriefingClaim;
  sentence: string;
  signal: IntelligenceBriefingSignal;
  sectionId: string;
  order: number;
  outcome: "favorable" | "risk" | "other";
  outcomeRank: number;
}>;

const FAVORABLE_TARGETS = new Set(["achieved", "within_range", "moving_toward_target"]);
const RISK_TARGETS = new Set([
  "above_acceptable_maximum",
  "below_acceptable_minimum",
  "below_required_minimum",
  "moving_away_from_target"
]);

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function sentences(value: string) {
  return intelligenceBriefingCustomerText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function customerSentence(value: string) {
  const choices = sentences(value);
  if (!choices.length) return "";
  return [...choices].sort((left, right) => {
    const leftWords = wordCount(left);
    const rightWords = wordCount(right);
    const leftBounded = leftWords <= 24 ? 1 : 0;
    const rightBounded = rightWords <= 24 ? 1 : 0;
    const leftNumeric = /\d/.test(left) ? 1 : 0;
    const rightNumeric = /\d/.test(right) ? 1 : 0;
    return rightBounded - leftBounded
      || rightNumeric - leftNumeric
      || Math.abs(15 - leftWords) - Math.abs(15 - rightWords)
      || left.localeCompare(right);
  })[0];
}

function outcome(signal: IntelligenceBriefingSignal) {
  const semantic = signal.semanticState;
  if (!semantic) return { outcome: "other" as const, rank: 0 };
  if (RISK_TARGETS.has(semantic.targetStatus)) return { outcome: "risk" as const, rank: 4 };
  if (semantic.performanceEffect === "unfavorable") return { outcome: "risk" as const, rank: 3 };
  if (FAVORABLE_TARGETS.has(semantic.targetStatus)) return { outcome: "favorable" as const, rank: 4 };
  if (semantic.performanceEffect === "favorable") return { outcome: "favorable" as const, rank: 3 };
  return { outcome: "other" as const, rank: 0 };
}

function summaryCandidates(input: BriefingPresentationInput) {
  const signalByRef = new Map(input.signals.map((signal) => [signal.ref, signal]));
  const byRef = new Map<string, SummaryCandidate>();
  let order = 0;
  for (const section of input.analysis.sections) {
    for (const claim of [{ text: section.summary, support_refs: section.support_refs }, ...section.claims]) {
      const ref = claim.support_refs.length === 1 ? claim.support_refs[0] : null;
      const signal = ref ? signalByRef.get(ref) : null;
      const sentence = customerSentence(claim.text);
      if (!ref || !signal || !sentence || signal.authority === "reported_context") continue;
      const result = outcome(signal);
      const candidate: SummaryCandidate = {
        claim,
        sentence,
        signal,
        sectionId: section.section_id,
        order,
        outcome: result.outcome,
        outcomeRank: result.rank
      };
      order += 1;
      const current = byRef.get(ref);
      if (!current || (/\d/.test(candidate.sentence) && !/\d/.test(current.sentence))) byRef.set(ref, candidate);
    }
  }
  return [...byRef.values()];
}

function ranked(candidates: readonly SummaryCandidate[], kind: SummaryCandidate["outcome"]) {
  return candidates
    .filter((candidate) => candidate.outcome === kind)
    .sort((left, right) => right.outcomeRank - left.outcomeRank || left.order - right.order)[0] || null;
}

function selectFacts(candidates: readonly SummaryCandidate[]) {
  const favorable = ranked(candidates, "favorable");
  const risk = ranked(candidates, "risk");
  const selected: SummaryCandidate[] = [];
  if (favorable) selected.push(favorable);
  if (risk && risk.claim.support_refs[0] !== favorable?.claim.support_refs[0]) selected.push(risk);
  if (!selected.length && candidates[0]) selected.push(candidates[0]);
  if (selected.length === 1) {
    const differentSection = candidates.find((candidate) =>
      candidate.claim.support_refs[0] !== selected[0].claim.support_refs[0]
      && candidate.sectionId !== selected[0].sectionId
    );
    const next = differentSection || candidates.find((candidate) =>
      candidate.claim.support_refs[0] !== selected[0].claim.support_refs[0]
    );
    if (next) selected.push(next);
  }
  return selected.slice(0, 2);
}

function actionClause(
  input: BriefingPresentationInput,
  candidates: readonly SummaryCandidate[],
  facts: readonly SummaryCandidate[]
) {
  const representedSections = new Set(facts.map((fact) => fact.sectionId));
  const signalByRef = new Map(input.signals.map((signal) => [signal.ref, signal]));
  const leadership = input.analysis.leadership_considerations
    .filter((claim) => claim.support_refs.length === 1 && signalByRef.get(claim.support_refs[0])?.authority !== "reported_context")
    .map((claim) => ({ claim, signal: signalByRef.get(claim.support_refs[0])! }));
  const acceptedAction = leadership.find(({ signal }) => signal.sectionId && !representedSections.has(signal.sectionId))
    || leadership.find(({ claim }) => claim.support_refs[0] === facts.find((fact) => fact.outcome === "risk")?.claim.support_refs[0])
    || leadership[0]
    || null;
  const fallback = candidates.find((candidate) => !representedSections.has(candidate.sectionId))
    || facts.find((fact) => fact.outcome === "risk")
    || facts[0]
    || candidates[0]
    || null;
  const supportRef = acceptedAction?.claim.support_refs[0] || fallback?.claim.support_refs[0] || null;
  const raw = acceptedAction
    ? customerSentence(acceptedAction.claim.text)
    : fallback
      ? `Review ${intelligenceBriefingMetricName(fallback.signal.label)} using the cited evidence.`
      : "Review the available evidence.";
  const clause = raw
    .replace(/[.!?]+$/, "")
    .replace(/^Leadership should\s+/i, "")
    .replace(/^([A-Z])/, (letter) => letter.toLowerCase());
  return { clause, supportRef };
}

export function composeIntelligenceBriefingExecutiveSummary(input: BriefingPresentationInput): IntelligenceBriefingClaim {
  const candidates = summaryCandidates(input);
  const facts = selectFacts(candidates);
  if (!facts.length) return {
    text: intelligenceBriefingCustomerText(input.analysis.executive_summary.text),
    support_refs: input.analysis.executive_summary.support_refs
  };

  const action = actionClause(input, candidates, facts);
  const prefix = input.eligibility === "limited"
    ? "Because this briefing is based on limited evidence, leadership should"
    : input.evidenceCoverage.freshness === "stale"
      ? "Because some supporting evidence needs updating, leadership should"
      : input.evidenceCoverage.missingOrWeakDomains.length
        ? "Because some business areas have limited coverage, leadership should"
        : "Leadership should";
  const factualText = facts.map((fact) => fact.sentence).join(" ");
  const baseAction = `${prefix} ${action.clause}`;
  const addendum = /\b(?:confirm|verify|continued|reporting period)\b/i.test(action.clause)
    ? "and use the next verified records before deciding whether further action is needed"
    : "and verify whether the supported condition continued before deciding whether further action is needed";
  const baseText = `${factualText} ${baseAction}.`;
  const expandedText = `${factualText} ${baseAction} ${addendum}.`;
  const text = wordCount(baseText) < 45 && wordCount(expandedText) <= 80 ? expandedText : baseText;
  const support_refs = [...new Set([
    ...facts.flatMap((fact) => fact.claim.support_refs),
    ...(action.supportRef ? [action.supportRef] : [])
  ])];
  return { text, support_refs };
}

function limitationCategory(value: string) {
  const normalized = value.toLowerCase();
  if (/\bhas limited evidence coverage\b/.test(normalized)) return "weak_area";
  if (/\b(?:business updates|business notes|reported context)\b/.test(normalized)
    && /\b(?:context|not independently measured|does not establish causation)\b/.test(normalized)) return "reported_context";
  if (/\b(?:kpi|metric|historical).*(?:does not|do not).*(?:caus\w*|explain\w*)/.test(normalized)) return "historical_causation";
  if (/\b(?:limited eligible evidence|evidence coverage is limited|supported by limited)\b/.test(normalized)) return "limited_evidence";
  if (/\bunsupported or insufficiently grounded conclusions were excluded\b/.test(normalized)) return "filtered_content";
  return normalized.replace(/[^a-z0-9]+/g, " ").trim();
}

export function intelligenceBriefingPresentationLimitations(input: BriefingPresentationInput) {
  const values = [
    ...input.limitations.map((limitation) => limitation.text),
    ...(input.contextReferences.length ? ["Business Updates provide context. They are not independently measured evidence."] : []),
    ...(input.eligibility === "limited" ? ["This briefing is based on limited eligible evidence and may not cover every part of the business."] : [])
  ];
  const byCategory = new Map<string, string>();
  for (const value of values) {
    const text = intelligenceBriefingCustomerText(value);
    const category = limitationCategory(text);
    if (!text || category === "weak_area" || byCategory.has(category)) continue;
    if (category === "reported_context") {
      byCategory.set(category, "Business Updates provide context. They are not independently measured evidence.");
    } else if (category === "historical_causation") {
      byCategory.set(category, "Historical metric records do not show what caused a change.");
    } else if (category === "limited_evidence") {
      byCategory.set(category, "This briefing is based on limited eligible evidence and may not cover every part of the business.");
    } else if (category === "filtered_content") {
      byCategory.set(category, "Unsupported or weakly grounded conclusions were left out.");
    } else {
      byCategory.set(category, text);
    }
  }
  return [...byCategory.values()];
}

export function intelligenceBriefingEvidenceLimitsLabel(input: Pick<IntelligenceBriefingArtifact, "evidenceCoverage">) {
  const records = input.evidenceCoverage.supportingRecordCount;
  const sources = input.evidenceCoverage.independentSourceCount;
  return `Evidence limits · ${records} ${records === 1 ? "record" : "records"} from ${sources} ${sources === 1 ? "source" : "sources"} · ${intelligenceBriefingCustomerText(input.evidenceCoverage.coverageLabel)}`;
}
