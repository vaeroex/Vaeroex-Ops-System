import {
  EVIDENCE_CANDIDATE_VERSION,
  type EvidenceCandidate,
  type EvidenceRole
} from "@/lib/ai/evidence-engine/contracts";
import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";

export type FrozenEvidenceRecord = Readonly<{
  id: string;
  workspaceId?: string;
  title: string;
  excerpt: string;
  domain: string;
  sourceKey: string;
  evidenceRole?: EvidenceRole;
  lifecycle: "active" | "archived" | "deleted";
  parentEligible: boolean;
  evidenceEligible: boolean;
  setupOnly?: boolean;
  relevanceGrade: 0 | 1 | 2 | 3;
  signalId: string | null;
  stale?: boolean;
}>;

export type FrozenEvidenceFixture = Readonly<{
  fixtureId: string;
  query: string;
  shouldRetrieve: boolean;
  requiredSignalIds: readonly string[];
  records: readonly FrozenEvidenceRecord[];
}>;

const WORKSPACE_ID = "fixture-workspace";
const OTHER_WORKSPACE_ID = "fixture-other-workspace";

function record(
  id: string,
  title: string,
  excerpt: string,
  domain: string,
  sourceKey: string,
  relevanceGrade: FrozenEvidenceRecord["relevanceGrade"],
  signalId: string | null,
  overrides: Partial<FrozenEvidenceRecord> = {}
): FrozenEvidenceRecord {
  return {
    id,
    title,
    excerpt,
    domain,
    sourceKey,
    lifecycle: "active",
    parentEligible: true,
    evidenceEligible: true,
    relevanceGrade,
    signalId,
    ...overrides
  };
}

export const EVIDENCE_ENGINE_FROZEN_FIXTURES: readonly FrozenEvidenceFixture[] = deepFreeze([
  {
    fixtureId: "navigation_query",
    query: "Open the Reports page",
    shouldRetrieve: false,
    requiredSignalIds: [],
    records: [record("nav-1", "Report evidence", "Saved report context", "reports", "report:1", 0, null)]
  },
  {
    fixtureId: "factual_query",
    query: "What was current monthly revenue?",
    shouldRetrieve: true,
    requiredSignalIds: ["revenue"],
    records: [
      record("fact-1", "Inventory count", "Current inventory contains 430 units.", "inventory", "file:inventory", 0, null),
      record("fact-2", "Monthly revenue", "Monthly revenue was $125,000 for June 2026.", "finance", "file:finance", 3, "revenue"),
      record("fact-3", "Customer rating", "Customer rating was 4.2 out of 5.", "customers", "file:feedback", 0, null)
    ]
  },
  {
    fixtureId: "cross_domain_query",
    query: "What changed across sales and customer returns?",
    shouldRetrieve: true,
    requiredSignalIds: ["sales_change", "returns_change"],
    records: [
      record("cross-1", "Staff schedule", "The staffing rota covers the next two weeks.", "people", "file:people", 0, null),
      record("cross-2", "Sales change", "Sales increased from 910 to 980 orders.", "sales", "file:sales", 3, "sales_change"),
      record("cross-3", "Returns change", "Returned orders increased from 34 to 49.", "customers", "file:returns", 3, "returns_change"),
      record("cross-4", "Vendor list", "Five vendors are currently active.", "vendors", "file:vendors", 0, null)
    ]
  },
  {
    fixtureId: "low_evidence",
    query: "What is happening with supplier delays?",
    shouldRetrieve: true,
    requiredSignalIds: ["supplier_delay"],
    records: [
      record("low-1", "Supplier note", "One delivery was marked late without a confirmed cause.", "vendors", "file:supplier-note", 1, "supplier_delay")
    ]
  },
  {
    fixtureId: "stale_evidence",
    query: "What is the current customer satisfaction trend?",
    shouldRetrieve: true,
    requiredSignalIds: ["customer_satisfaction"],
    records: [
      record("stale-1", "Customer satisfaction", "Customer satisfaction declined from 4.4 to 4.1.", "customers", "file:feedback-old", 3, "customer_satisfaction", { stale: true }),
      record("stale-2", "Marketing plan", "A campaign plan was approved.", "marketing", "file:marketing", 0, null)
    ]
  },
  {
    fixtureId: "lifecycle_exclusion",
    query: "Which operating costs changed?",
    shouldRetrieve: true,
    requiredSignalIds: ["cost_change"],
    records: [
      record("life-1", "Current operating costs", "Operating costs increased by 4%.", "finance", "file:current-costs", 3, "cost_change"),
      record("life-2", "Archived operating costs", "Operating costs increased by 40%.", "finance", "file:archived-costs", 3, "cost_change", { lifecycle: "archived" }),
      record("life-3", "Deleted operating costs", "Operating costs fell by 18%.", "finance", "file:deleted-costs", 3, "cost_change", { lifecycle: "deleted" }),
      record("life-4", "Other workspace costs", "Operating costs increased by 90%.", "finance", "file:foreign-costs", 3, "cost_change", { workspaceId: OTHER_WORKSPACE_ID })
    ]
  },
  {
    fixtureId: "orphan_and_setup_exclusion",
    query: "What operational risk needs attention?",
    shouldRetrieve: true,
    requiredSignalIds: ["operational_risk"],
    records: [
      record("orphan-1", "Current queue risk", "The active queue contains 18 overdue orders.", "operations", "file:orders", 3, "operational_risk"),
      record("orphan-2", "Orphan queue record", "The queue contains 80 overdue orders.", "operations", "file:missing", 3, "operational_risk", { parentEligible: false }),
      record("orphan-3", "Starter risk", "Create the first operating checklist.", "operations", "setup:starter", 2, "operational_risk", { setupOnly: true })
    ]
  },
  {
    fixtureId: "duplicates_and_dependent_sources",
    query: "What does the inventory workbook show?",
    shouldRetrieve: true,
    requiredSignalIds: ["inventory_change"],
    records: [
      record("dup-1", "Inventory worksheet row 10", "Inventory declined from 500 to 430 units.", "inventory", "file:inventory-workbook", 3, "inventory_change"),
      record("dup-2", "Inventory worksheet row 11", "Inventory declined from 500 to 430 units.", "inventory", "file:inventory-workbook", 3, "inventory_change"),
      record("dup-3", "Inventory Business Memory", "Inventory declined to 430 units.", "business_memory", "file:inventory-workbook", 2, "inventory_change", { evidenceRole: "supporting" })
    ]
  },
  {
    fixtureId: "multi_source_diversity",
    query: "Which business areas need executive attention?",
    shouldRetrieve: true,
    requiredSignalIds: ["margin", "returns", "wait_time"],
    records: [
      record("diverse-1", "Gross margin", "Gross margin declined from 31% to 28%.", "finance", "file:financials", 3, "margin"),
      record("diverse-2", "Returns", "Product returns increased from 34 to 49.", "customers", "file:returns", 3, "returns"),
      record("diverse-3", "Checkout wait time", "Average checkout wait time increased from 4 to 7 minutes.", "operations", "file:operations", 3, "wait_time"),
      record("diverse-4", "Margin duplicate", "Gross margin was 28%.", "finance", "file:financials", 2, "margin")
    ]
  },
  {
    fixtureId: "conflicting_evidence",
    query: "Did on-time delivery improve?",
    shouldRetrieve: true,
    requiredSignalIds: ["delivery_conflict"],
    records: [
      record("conflict-1", "Carrier delivery log", "On-time delivery increased from 88% to 92%.", "operations", "file:carrier-log", 3, "delivery_conflict"),
      record("conflict-2", "Customer delivery survey", "Reported on-time delivery declined from 90% to 85%.", "customers", "file:customer-survey", 3, "delivery_conflict"),
      record("conflict-3", "Warehouse layout", "The warehouse layout has five loading zones.", "operations", "file:layout", 0, null)
    ]
  }
]);

export function frozenRecordIsEligible(record: FrozenEvidenceRecord) {
  return (record.workspaceId || WORKSPACE_ID) === WORKSPACE_ID &&
    record.lifecycle === "active" &&
    record.parentEligible &&
    record.evidenceEligible &&
    !record.setupOnly;
}

export function fixtureEvidenceCandidates(fixture: FrozenEvidenceFixture): EvidenceCandidate[] {
  if (!fixture.shouldRetrieve) return [];
  return fixture.records.filter(frozenRecordIsEligible).map((item, index) => {
    const originalEvidenceEligible = (item.evidenceRole || "original") === "original";
    return {
      version: EVIDENCE_CANDIDATE_VERSION,
      candidateId: item.id,
      workspaceId: WORKSPACE_ID,
      domain: item.domain,
      recordType: "frozen_fixture_record",
      title: item.title,
      excerpt: item.excerpt,
      summary: null,
      evidenceRole: item.evidenceRole || "original",
      source: {
        sourceType: "fixture",
        sourceId: item.sourceKey,
        sourceFileId: item.sourceKey.startsWith("file:") ? item.sourceKey : null,
        parentSourceId: item.sourceKey,
        canonicalSourceKey: `${WORKSPACE_ID}:${item.sourceKey}`,
        independentSourceKey: originalEvidenceEligible ? `${WORKSPACE_ID}:${item.sourceKey}` : null
      },
      provenance: {
        recordId: item.id,
        indexedAt: item.stale ? "2025-01-01T00:00:00.000Z" : "2026-07-19T00:00:00.000Z",
        recordedAt: item.stale ? "2025-01-01T00:00:00.000Z" : "2026-07-19T00:00:00.000Z",
        lineageVersion: "frozen_fixture_lineage_v1"
      },
      eligibility: {
        eligible: true,
        lifecycleState: "active",
        originalEvidenceEligible,
        decisionVersion: "frozen_fixture_eligibility_v1"
      },
      quality: item.relevanceGrade >= 2 ? "high" : "low",
      confidenceScore: item.stale ? 42 : item.relevanceGrade >= 2 ? 78 : 45,
      retrieval: {
        mode: "structured",
        baseRank: index + 1,
        score: null,
        embeddingVersion: null
      }
    };
  });
}

export const EVIDENCE_ENGINE_FIXTURE_WORKSPACE_ID = WORKSPACE_ID;
