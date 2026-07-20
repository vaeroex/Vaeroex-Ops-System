import "server-only";

import {
  EVIDENCE_CANDIDATE_VERSION,
  type EvidenceCandidate
} from "@/lib/ai/evidence-engine/contracts";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import type {
  StageThreeAContractId,
  StageThreeAFixture,
  StageThreeASyntheticRecord
} from "@/lib/ai/qualification/stage-three-a-types";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000003";
const FOREIGN_WORKSPACE_ID = "00000000-0000-4000-8000-000000000099";
const FIXTURE_VERSION = "nvidia_capability_stage_3a_fixture_v1";
const CURRENT_AT = "2026-07-18T00:00:00.000Z";
const STALE_AT = "2025-10-31T00:00:00.000Z";

type Signal = Readonly<{
  id: string;
  domain: string;
  label: string;
  fact: string;
  kind: "risk" | "opportunity";
  scoreImpact: number;
  source: string;
  relevant?: boolean;
  material?: boolean;
  contradictory?: boolean;
  stale?: boolean;
  duplicateOf?: string;
  quality?: string;
}>;

type Archetype = Readonly<{
  id: string;
  state: string;
  queryFocus: string;
  signals: readonly Signal[];
  buryRelevant?: boolean;
  includeLifecycleExclusions?: boolean;
  permittedRelationships?: readonly Readonly<{ leftSignalId: string; rightSignalId: string }>[];
  confidence?: "High" | "Medium" | "Low";
  freshness?: "current" | "stale";
  limitations?: readonly string[];
}>;

const signal = (
  id: string,
  domain: string,
  label: string,
  fact: string,
  kind: "risk" | "opportunity",
  scoreImpact: number,
  source: string,
  options: Partial<Omit<Signal, "id" | "domain" | "label" | "fact" | "kind" | "scoreImpact" | "source">> = {}
): Signal => ({ id, domain, label, fact, kind, scoreImpact, source, relevant: true, material: true, ...options });

const distractors: readonly Signal[] = [
  signal("office-supply-count", "Administration", "Office supply count", "The office supply register contains 84 listed items.", "opportunity", 0, "admin", { relevant: false, material: false }),
  signal("parking-spaces", "Facilities", "Parking spaces", "The facilities register lists 41 parking spaces.", "opportunity", 0, "facilities", { relevant: false, material: false }),
  signal("policy-review-date", "Governance", "Policy review date", "The handbook review date is September 2026.", "opportunity", 0, "policy", { relevant: false, material: false }),
  signal("brand-color-count", "Marketing", "Brand color count", "The current brand guide lists six approved colors.", "opportunity", 0, "brand", { relevant: false, material: false }),
  signal("meeting-room-count", "Facilities", "Meeting room count", "The facilities list contains seven meeting rooms.", "opportunity", 0, "facilities-rooms", { relevant: false, material: false }),
  signal("training-module-count", "People", "Training module count", "The onboarding checklist contains twelve training modules.", "opportunity", 0, "training", { relevant: false, material: false }),
  signal("vendor-contact-count", "Procurement", "Vendor contact count", "The vendor directory contains 29 contacts.", "opportunity", 0, "vendor-directory", { relevant: false, material: false }),
  signal("template-version", "Operations", "Template version", "The standard intake template is version 4.", "opportunity", 0, "templates", { relevant: false, material: false }),
  signal("asset-tag-range", "Assets", "Asset tag range", "The active asset tag sequence ends at 2,410.", "opportunity", 0, "assets", { relevant: false, material: false }),
  signal("newsletter-count", "Marketing", "Newsletter count", "Six newsletters were scheduled for the quarter.", "opportunity", 0, "newsletters", { relevant: false, material: false }),
  signal("calendar-entry-count", "Administration", "Calendar entry count", "The shared calendar contains 73 future entries.", "opportunity", 0, "calendar", { relevant: false, material: false }),
  signal("document-page-count", "Governance", "Document page count", "The operations handbook contains 112 pages.", "opportunity", 0, "handbook", { relevant: false, material: false })
];

const workspaceDistractors: readonly Signal[] = [
  ...distractors,
  ...distractors.map((item) => ({
    ...item,
    id: `${item.id}-secondary`,
    label: `${item.label} secondary reference`,
    source: `${item.source}-secondary`
  }))
];

const archetypes: readonly Archetype[] = [
  {
    id: "single-domain-clear",
    state: "at_risk_and_worsening",
    queryFocus: "sales performance and revenue pressure",
    signals: [
      signal("monthly-revenue", "Sales", "Monthly Revenue declined", "Monthly Revenue moved from $840,000 to $760,000 in June 2026.", "risk", -10, "sales-ledger"),
      signal("online-sales", "Sales", "Online Sales declined", "Online Sales moved from $265,000 to $231,000 in June 2026.", "risk", -6, "channel-ledger"),
      signal("average-order-value", "Sales", "Average Order Value declined", "Average Order Value moved from $86 to $79 in June 2026.", "risk", -4, "orders")
    ]
  },
  {
    id: "cross-domain-supported",
    state: "at_risk_and_worsening",
    queryFocus: "margin, returns, and customer experience",
    signals: [
      signal("gross-margin", "Finance", "Gross Margin declined", "Gross Margin moved from 37% to 30% in Q2 2026.", "risk", -12, "finance"),
      signal("return-rate", "Operations", "Return Rate increased", "Return Rate moved from 5% to 9% in Q2 2026.", "risk", -9, "returns"),
      signal("customer-rating", "Customer", "Customer Rating declined", "Customer Rating moved from 4.3 to 3.9 out of 5 in Q2 2026.", "risk", -5, "feedback")
    ],
    permittedRelationships: [{ leftSignalId: "gross-margin", rightSignalId: "return-rate" }],
    limitations: ["The evidence supports concurrent movement, not causation."]
  },
  {
    id: "distractor-heavy-buried",
    state: "watch_and_declining",
    queryFocus: "inventory availability, lost sales, and supplier delays",
    buryRelevant: true,
    signals: [
      signal("stockout-rate", "Inventory", "Stockout Rate increased", "Stockout Rate moved from 6% to 11% in June 2026.", "risk", -8, "inventory"),
      signal("lost-sales", "Sales", "Lost Sales increased", "Lost Sales moved from $41,000 to $73,000 in June 2026.", "risk", -7, "sales-ledger"),
      signal("supplier-delay", "Procurement", "Supplier Delay increased", "Average Supplier Delay moved from 2.1 to 4.8 days in June 2026.", "risk", -5, "supplier-log")
    ]
  },
  {
    id: "duplicates-dependent-sources",
    state: "watch_and_declining",
    queryFocus: "margin, returns, and repeat purchasing",
    signals: [
      signal("gross-margin", "Finance", "Gross Margin declined", "Gross Margin moved from 36% to 31% in Q2 2026.", "risk", -10, "retail-workbook"),
      signal("gross-margin-duplicate", "Finance", "Gross Margin duplicate row", "Gross Margin moved from 36% to 31% in Q2 2026.", "risk", -10, "retail-workbook", { duplicateOf: "gross-margin", material: false }),
      signal("return-rate", "Operations", "Return Rate increased", "Return Rate moved from 4% to 8% in Q2 2026.", "risk", -8, "retail-workbook"),
      signal("repeat-purchase", "Customer", "Repeat Purchase Rate declined", "Repeat Purchase Rate moved from 44% to 39% in Q2 2026.", "risk", -4, "customer-survey")
    ],
    confidence: "Medium",
    limitations: ["Two metrics share one original workbook and count as one independent source."]
  },
  {
    id: "stale-conflicting",
    state: "stale_and_conflicting",
    queryFocus: "channel revenue and customer demand",
    signals: [
      signal("online-revenue", "Sales", "Online Revenue increased", "Online Revenue moved from $210,000 to $246,000 in Q4 2025.", "opportunity", 4, "online", { stale: true }),
      signal("store-revenue", "Sales", "Store Revenue declined", "Store Revenue moved from $570,000 to $515,000 in Q4 2025.", "risk", -6, "stores", { stale: true, contradictory: true }),
      signal("customer-demand", "Customer", "Customer Demand remained mixed", "Customer inquiry volume increased while completed purchases declined in Q4 2025.", "risk", -3, "customer", { stale: true, contradictory: true })
    ],
    confidence: "Low",
    freshness: "stale",
    limitations: ["The latest eligible evidence is stale and includes conflicting channel movement."]
  },
  {
    id: "sparse-low-evidence",
    state: "evidence_limited",
    queryFocus: "first-period operating evidence",
    signals: [
      signal("monthly-revenue", "Sales", "Monthly Revenue first observation", "Monthly Revenue was $510,000 in June 2026.", "risk", -1, "single-upload"),
      signal("order-volume", "Operations", "Order Volume first observation", "Order Volume was 6,200 in June 2026.", "opportunity", 1, "single-upload"),
      signal("customer-rating", "Customer", "Customer Rating first observation", "Customer Rating was 3.9 out of 5 in June 2026.", "risk", -1, "single-upload")
    ],
    confidence: "Low",
    limitations: ["Only one original source and one reporting period are available."]
  },
  {
    id: "similar-content-distinct-provenance",
    state: "watch_and_declining",
    queryFocus: "checkout wait time and customer experience",
    signals: [
      signal("checkout-wait-pos", "Operations", "Checkout Wait Time increased", "Checkout Wait Time moved from 4.2 to 6.8 minutes in June 2026.", "risk", -6, "pos-log"),
      signal("checkout-wait-survey", "Customer", "Checkout Wait Time feedback worsened", "Customer feedback reported longer checkout waits in June 2026.", "risk", -4, "customer-survey"),
      signal("customer-rating", "Customer", "Customer Rating declined", "Customer Rating moved from 4.2 to 3.8 out of 5 in June 2026.", "risk", -5, "feedback-score")
    ],
    limitations: ["Similar observations come from distinct original sources."]
  },
  {
    id: "strong-versus-weak-sources",
    state: "watch_and_recovering",
    queryFocus: "verified margin recovery and operating stability",
    signals: [
      signal("gross-margin", "Finance", "Gross Margin increased", "Audited Gross Margin moved from 29% to 33% in Q2 2026.", "opportunity", 6, "audited-financials", { quality: "high" }),
      signal("return-rate", "Operations", "Return Rate remained elevated", "Return Rate remained at 8% in Q2 2026.", "risk", -5, "returns", { quality: "high" }),
      signal("customer-rating", "Customer", "Customer Rating increased", "Customer Rating moved from 3.8 to 4.0 out of 5 in Q2 2026.", "opportunity", 2, "survey", { quality: "medium" }),
      signal("margin-anecdote", "Finance", "Unverified Margin comment", "A planning note described margin as strong without a measured value.", "opportunity", 0, "planning-note", { relevant: false, material: false, quality: "low" })
    ]
  },
  {
    id: "lifecycle-and-derived-exclusions",
    state: "stable",
    queryFocus: "current revenue, margin, and returns",
    includeLifecycleExclusions: true,
    signals: [
      signal("monthly-revenue", "Sales", "Monthly Revenue remained stable", "Monthly Revenue remained near $760,000 in May and June 2026.", "opportunity", 2, "sales-ledger"),
      signal("gross-margin", "Finance", "Gross Margin remained stable", "Gross Margin remained at 33% in Q2 2026.", "opportunity", 1, "finance"),
      signal("return-rate", "Operations", "Return Rate remained controlled", "Return Rate remained at 4% in Q2 2026.", "opportunity", 1, "returns")
    ]
  },
  {
    id: "independent-support-and-minority-conflict",
    state: "watch_and_recovering",
    queryFocus: "revenue recovery, margin position, and customer confidence",
    signals: [
      signal("revenue-ledger", "Sales", "Monthly Revenue increased", "Monthly Revenue moved from $690,000 to $735,000 in June 2026.", "opportunity", 5, "sales-ledger"),
      signal("revenue-bank", "Finance", "Revenue receipts increased", "Recorded revenue receipts increased in June 2026 compared with May 2026.", "opportunity", 3, "bank-summary"),
      signal("gross-margin", "Finance", "Gross Margin remained below prior level", "Gross Margin was 31% in Q2 2026 compared with 35% in Q4 2025.", "risk", -6, "financials", { contradictory: true }),
      signal("customer-rating", "Customer", "Customer Rating increased", "Customer Rating moved from 3.8 to 4.1 out of 5 in Q2 2026.", "opportunity", 3, "survey")
    ],
    permittedRelationships: [{ leftSignalId: "revenue-ledger", rightSignalId: "revenue-bank" }],
    limitations: ["Revenue recovery has independent support, while the margin position remains a counter-signal."]
  }
];

function candidateFor({
  fixtureId,
  spec,
  index,
  workspaceId = WORKSPACE_ID,
  originalEvidenceEligible = true
}: {
  fixtureId: string;
  spec: Signal;
  index: number;
  workspaceId?: string;
  originalEvidenceEligible?: boolean;
}): EvidenceCandidate {
  const duplicateSource = spec.duplicateOf ? spec.source : null;
  return {
    version: EVIDENCE_CANDIDATE_VERSION,
    candidateId: `${fixtureId}-C${String(index + 1).padStart(2, "0")}`,
    workspaceId,
    domain: spec.domain,
    recordType: "Synthetic Stage 3A benchmark evidence",
    title: spec.label,
    excerpt: spec.fact,
    summary: null,
    evidenceRole: originalEvidenceEligible ? "original" : "derived",
    source: {
      sourceType: "Synthetic frozen benchmark source",
      sourceId: null,
      sourceFileId: null,
      parentSourceId: null,
      canonicalSourceKey: `${fixtureId}-source-${duplicateSource || spec.source}`,
      independentSourceKey: originalEvidenceEligible ? `${fixtureId}-independent-${duplicateSource || spec.source}` : null
    },
    provenance: {
      recordId: `${fixtureId}-record-${index + 1}`,
      indexedAt: spec.stale ? STALE_AT : CURRENT_AT,
      recordedAt: spec.stale ? STALE_AT : CURRENT_AT,
      lineageVersion: "stage_3a_synthetic_lineage_v1"
    },
    eligibility: {
      eligible: true,
      lifecycleState: "active",
      originalEvidenceEligible,
      decisionVersion: "stage_3a_synthetic_eligibility_v1"
    },
    quality: spec.quality || "high",
    confidenceScore: spec.quality === "low" ? 40 : spec.quality === "medium" ? 65 : 82,
    retrieval: {
      mode: "vector",
      baseRank: index + 1,
      score: Math.max(0.05, 0.98 - index * 0.025),
      embeddingVersion: "openai_text_embedding_3_small_v1"
    }
  };
}

function recordFor(
  fixtureId: string,
  spec: Signal,
  index: number,
  overrides: Partial<Pick<StageThreeASyntheticRecord, "authorizedWorkspace" | "active" | "originalEvidenceEligible">> = {}
): StageThreeASyntheticRecord {
  const authorizedWorkspace = overrides.authorizedWorkspace ?? true;
  const originalEvidenceEligible = overrides.originalEvidenceEligible ?? true;
  return {
    candidate: candidateFor({
      fixtureId,
      spec,
      index,
      workspaceId: authorizedWorkspace ? WORKSPACE_ID : FOREIGN_WORKSPACE_ID,
      originalEvidenceEligible
    }),
    signalId: spec.duplicateOf || spec.id,
    kind: spec.kind,
    scoreImpact: spec.scoreImpact,
    relevant: spec.relevant !== false,
    material: spec.material !== false,
    contradictory: spec.contradictory === true,
    stale: spec.stale === true,
    authorizedWorkspace,
    active: overrides.active ?? true,
    originalEvidenceEligible
  };
}

function buildRecords(fixtureId: string, archetype: Archetype) {
  const orderedSignals = archetype.buryRelevant
    ? [...workspaceDistractors, ...archetype.signals]
    : [...archetype.signals, ...workspaceDistractors];
  const records = orderedSignals.map((spec, index) => recordFor(fixtureId, spec, index));
  if (!archetype.includeLifecycleExclusions) return records;
  const excludedSpecs = [
    signal("archived-margin", "Finance", "Archived Gross Margin", "Archived Gross Margin was 18% in Q1 2024.", "risk", -20, "archived"),
    signal("deleted-revenue", "Sales", "Deleted Revenue", "Deleted Revenue was $100,000 in Q1 2024.", "risk", -20, "deleted"),
    signal("derived-risk", "Intelligence", "Generated Risk", "A generated analysis described a severe revenue risk.", "risk", -20, "derived"),
    signal("foreign-workspace", "Finance", "Foreign Gross Margin", "A different workspace recorded Gross Margin of 9%.", "risk", -20, "foreign")
  ];
  const offset = records.length;
  return [
    ...records,
    recordFor(fixtureId, excludedSpecs[0], offset, { active: false }),
    recordFor(fixtureId, excludedSpecs[1], offset + 1, { active: false }),
    recordFor(fixtureId, excludedSpecs[2], offset + 2, { originalEvidenceEligible: false }),
    recordFor(fixtureId, excludedSpecs[3], offset + 3, { authorizedWorkspace: false })
  ];
}

function fixtureFor(archetype: Archetype, contractId: StageThreeAContractId): StageThreeAFixture {
  const id = `${contractId === "business_health_explanation_v1" ? "bh" : "lp"}-${archetype.id}`;
  const records = buildRecords(id, archetype);
  const materialSignals = archetype.signals.filter((item) => item.relevant !== false && item.material !== false);
  const requiredSignalIds = [...new Set(materialSignals.map((item) => item.duplicateOf || item.id))].slice(0, 3);
  const freshness = archetype.freshness || "current";
  const score = archetype.state.includes("risk") ? 44 : archetype.state.includes("recover") ? 63 : archetype.state.includes("limited") ? 58 : 71;
  return {
    id,
    contractId,
    state: archetype.state,
    queryText: contractId === "business_health_explanation_v1"
      ? `Explain the approved Business Health drivers for ${archetype.queryFocus}.`
      : `Explain the application-ranked leadership priorities for ${archetype.queryFocus}.`,
    corpusFingerprint: evidenceEngineHash({ fixtureVersion: FIXTURE_VERSION, id, records }),
    records,
    requiredSignalIds,
    permittedRelationships: archetype.permittedRelationships || [],
    score,
    status: archetype.state.includes("risk") ? "At risk" : archetype.state.includes("limited") ? "Watch" : "Stable",
    trajectory: archetype.state.includes("recover") ? "Recovering" : archetype.state.includes("declin") || archetype.state.includes("risk") ? "Worsening" : "Stable",
    comparison: archetype.state.includes("recover") ? "Up 4 points since the previous review." : archetype.state.includes("risk") ? "Down 6 points since the previous review." : "Unchanged since the previous review.",
    comparisonDelta: archetype.state.includes("recover") ? 4 : archetype.state.includes("risk") ? -6 : 0,
    dataQualityBase: archetype.confidence === "Low" ? 58 : 78,
    riskPenalty: materialSignals.filter((item) => item.kind === "risk").reduce((sum, item) => sum + Math.abs(item.scoreImpact), 0),
    opportunityAdjustment: materialSignals.filter((item) => item.kind === "opportunity").reduce((sum, item) => sum + Math.max(0, item.scoreImpact), 0),
    confidence: archetype.confidence || "Medium",
    freshness,
    limitations: archetype.limitations || []
  };
}

export const STAGE_THREE_A_FIXTURES: readonly StageThreeAFixture[] = archetypes.flatMap((archetype) => [
  fixtureFor(archetype, "business_health_explanation_v1"),
  fixtureFor(archetype, "leadership_priorities_v1")
]);

export function getStageThreeAFixture(fixtureId: string) {
  return STAGE_THREE_A_FIXTURES.find((fixture) => fixture.id === fixtureId) || null;
}

export function getStageThreeAFixtureMetadata() {
  return STAGE_THREE_A_FIXTURES.map((fixture) => ({
    id: fixture.id,
    contractId: fixture.contractId,
    state: fixture.state,
    corpusFingerprint: fixture.corpusFingerprint,
    recordCount: fixture.records.length,
    eligibleCandidateCount: fixture.records.filter((record) => record.authorizedWorkspace && record.active && record.originalEvidenceEligible).length,
    excludedRecordCount: fixture.records.filter((record) => !record.authorizedWorkspace || !record.active || !record.originalEvidenceEligible).length,
    requiredSignalCount: fixture.requiredSignalIds.length
  }));
}
