# ADR-004: Final IntelligenceSnapshotV1 Consumer Migration

- Status: Proposed in Draft PR
- Date: 2026-07-28
- Baseline: `f225253b9c0a87ca10459cd058f7e4664d9c27ba`
- Scope: Active deterministic customer surfaces only

## Decision

The remaining active deterministic customer surfaces consume bounded `IntelligenceSnapshotV1` projections at their existing composition boundaries:

| Consumer | Projection | Existing output retained |
| --- | --- | --- |
| Executive Overview homepage model | `ExecutiveOverviewProjectionV1` | `ExecutiveHomepageModel` |
| Intelligence inbox | `IntelligenceInboxProjectionV1` | ordered `IntelligenceInsight[]` |
| Explain Finding | `FindingExplanationProjectionV1` | `FindingExplanationPackage` |
| KPI Overview and records | `KpiPageProjectionV1` | existing KPI page state and presentation |
| KPI Detail | `KpiDetailProjectionV1` | existing detail state and controls |
| KPI Compare | `KpiCompareProjectionV1` | existing chart and comparison notes |

Business Health explanation remains on its previously approved `BusinessHealthExplanationProjectionV1` path. No consumer receives the full snapshot. Existing presentation-only fields that are outside the canonical contract are retained only after strict identity and semantic parity checks.

The composition order is:

```text
existing deterministic producers
  -> buildIntelligenceSnapshotFromProducersV1
  -> bounded consumer projection
  -> strict legacy-contract materializer
  -> unchanged consumer, provider package, or page
```

## Parity policy

Every migrated adapter validates the canonical fields it uses against the legacy value before returning the existing consumer contract. Comparisons cover workspace and record identity, KPI semantics and targets, deterministic evaluations and recommendations, Business Health, data quality, findings, priorities, evidence references, and complete provider package or rendered-model envelopes where applicable.

Ordering differences are allowed only for the Intelligence inbox, where the existing visible presentation order is deliberately retained after set-level canonical parity is proven. All other unexplained differences are adapter defects. Preview may fail closed to the complete legacy result for qualification; Production has no parity fallback. KPI workspaces beyond the contract's 200-metric bound remain wholly on the legacy page path rather than being truncated.

## Consumers intentionally left on legacy

### Executive reasoning and bounded workspace context

`buildBoundedWorkspaceContext`, `buildExecutiveReasoningContext`, and the lightweight conversational KPI overview remain legacy. Their provider payloads require raw source excerpts, table history, definitions, category labels, per-observation targets, reports, files, Business Memory matches, source manifests, and query-specific retrieval results. V1 intentionally does not retain those fields. Rebuilding them in a snapshot adapter would broaden the contract, change provider payload meaning, or create a second evidence-retrieval system. These paths therefore cannot prove exact parity in this migration.

### Retired parallel intelligence

At the time of this migration, Prestige remained outside V1. ADR-005 subsequently retires that parallel producer and its presentation instead of broadening V1 to preserve legacy diagnostics.

### People

The People page was explicitly excluded and was later retired in its dedicated product PR. Shared people and assignment data remains independent compatibility infrastructure.

### Other exclusions

- Executive Brief is retired and excluded.
- Saved Analyses and Reports persist or render completed artifacts; they are not live deterministic context consumers.
- Inactive, unreachable, and test-only builders are not migrated.

## Consequences

- Business Health formulas, KPI semantics, findings, priorities, confidence, freshness, limitations, evidence lineage, citations, prompts, provider routing, generated-artifact contracts, and caches are unchanged.
- Snapshot composition performs no provider call or persistence.
- Explain Finding continues to pass its existing bounded package to the existing Sol/Terra service; the full snapshot is never provider input.
- Legacy implementations, context builders, adapters, and fallbacks remain in the repository for qualification and later cleanup.
- No database migration, environment change, or Production configuration is required.

## Follow-up

A later cleanup PR may remove unrelated legacy consumer assembly only after Production qualification. Raw executive-reasoning context remains a separate architecture decision.
