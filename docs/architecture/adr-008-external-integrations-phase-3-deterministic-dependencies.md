# ADR-008: Incremental Deterministic Dependencies

**Status:** Proposed for Phase 3 architecture and security review
**Date:** 2026-08-21
**Scope:** Provider-neutral, shadow-only deterministic aggregate and KPI recalculation

## Context

The Phase 2 contribution ledger is the approved numerical input boundary for external integrations. Phase 3 needs to prove that a bounded contribution change can update only affected deterministic state while producing exactly the same result as a clean calculation over the current accepted contribution set.

The existing customer-visible KPI path is intentionally unchanged:

- `loadActiveWorkspaceKpis` reads active rows from `public.kpis` in pages of 1,000, ordered by metric date, creation time, and ID;
- it loads complete workspace-wide history and fails closed if more than 20,000 active observations exist;
- the routes pass the full legacy row shape into `buildCanonicalKpiProducerOutputV1`;
- that producer owns canonical KPI identity, semantic targets, trends, and display-facing number projections;
- `IntelligenceSnapshotV1` adapts the canonical producer output; and
- Business Health, deterministic risk/opportunity logic, and snapshot composition remain downstream owners of their existing calculations.

That path is safe for its current bounded use, but it is not an incremental Business Entity-scoped calculation engine. Replacing it before equivalence is proven would create a second interpretation of KPI truth. Phase 3 therefore adds a private shadow path alongside it.

## Decision

### Deterministic Flow

The approved Phase 3 flow is:

~~~text
immutable accepted canonical fact version
  -> current Phase 2 contribution event state
  -> old and new contribution mutations
  -> affected aggregate instances
  -> versioned dependency registry
  -> coalesced dirty nodes
  -> deterministic topological traversal
  -> exact aggregate and KPI state
  -> deterministic state fingerprint and watermark
  -> clean full-recompute equivalence check
  -> publish or quarantine
~~~

External source records, provider payloads, unaccepted facts, and control-only observations cannot enter the numerical path directly. Phase 3 does not generate Business State Deltas and makes no model call.

### Contract Versions

Phase 3 defines these strict contracts:

- `deterministic_dependency_registry_v1`;
- `deterministic_aggregate_state_v1`;
- `deterministic_change_set_v1`;
- `dependency_dirty_node_v1`;
- `deterministic_watermark_v1`; and
- `deterministic_calculation_policy_v1`.

The code registry version is `vaeroex_deterministic_dependencies_v1`. Its canonical fingerprint is `sha256:fb4ad433246fcd58a9edb9029a72058c21b354514e93b804e7b0b0234c5a23c5`. A different registry or calculation-policy version cannot reuse prior state as equivalent.

### Dependency Registry

The registry is immutable code, not mutable database configuration. Every node has a globally unique key and versioned calculation metadata. Graph validation rejects duplicate keys or edges, unknown dependencies, self-dependencies, and cycles. A stable lexical Kahn traversal supplies deterministic execution order.

The initial bounded registry is:

| Node | Kind | Input/Dependency | Rule | Phase 3 ownership |
| --- | --- | --- | --- | --- |
| `recognized_revenue_month_total` | aggregate | accepted additive `recognized_revenue` contributions | monthly exact sum, accrual, currency required | calculated |
| `revenue` | KPI | `recognized_revenue_month_total` | identity, same period | calculated through existing producer semantics |
| `business_health_revenue_invalidation` | downstream | `revenue` | same-period invalidation | invalidation only |
| `deterministic_revenue_risk_invalidation` | downstream | `revenue` | same-period invalidation | invalidation only |
| `deterministic_revenue_opportunity_invalidation` | downstream | `revenue` | same-period invalidation | invalidation only |
| `snapshot_revenue_invalidation` | downstream | the three preceding invalidations | same-period invalidation | invalidation only |

Definitions carry contribution family and kind, measure and aggregate selectors, reducer, correction strategy, period granularity, dimensions, accounting basis, currency mode, dependencies, window, calculation version, target dependencies, and freshness dependency metadata. They contain no provider-specific vocabulary.

The contract can represent same-period, trailing-period, quarter-to-date, year-to-date, prior-period, year-over-year, and trend invalidation. Future registry entries may use those windows without changing identity rules.

### Reducer Strategy

Reducer behavior is explicit rather than inferred:

| Reducer | Safe incremental strategy | Correction behavior |
| --- | --- | --- |
| `additive_sum` | exact additive delta | subtract old, add new |
| `control_latest` | deterministic set reselection | reselect latest eligible control |
| `targeted_set_recompute` | recompute the affected aggregate set | discard no unrelated state |
| `full_clean_recompute_only` | clean full calculation | no incremental publication |

The initial recognized-revenue node uses only `additive_sum`. Count, average, ratio, min/max, or conversion semantics are not silently approximated. Ratios require separately declared inputs, an explicit output scale, and half-away-from-zero rounding. Unsupported reducers fail closed.

### Exact Numerical State

Canonical decimal strings remain accounting truth. Decimal arithmetic converts validated strings into integer coefficients plus scale and uses `bigint`; it never uses binary floating-point tolerance. Addition, subtraction, negation, and explicitly scaled division return canonical strings. Precision and scale remain bounded by the Phase 0.1 persisted-decimal contracts before hashing or persistence.

An aggregate instance is scoped by:

~~~text
workspace + Business Entity + node key + period + dimensions
+ accounting basis + currency + registry/calculation version
~~~

No currency, accounting basis, Business Entity, period, or dimension is mixed implicitly. The source fingerprint is a deterministic accumulator over the current accepted contribution-event fingerprints for that instance. The node fingerprint covers its complete exact state and identity.

### Corrections and Windows

Every mutation carries old and new contribution state. A correction, void, deletion, restore, backdate, forward-date, reclassification, authority result change, or reconciliation outcome change invalidates the union of old and new aggregate identities. Moving January revenue to February therefore dirties both months; moving a department dirties both dimension paths.

Period expansion maps the changed economic period, not synchronization time, through each dependent window. Same-period, rolling, quarter-to-date, year-to-date, prior-period, year-over-year, and trend consumers receive deterministic affected output scopes. Unsupported granularity or incompatible scope fails closed.

### Dirty-Node Coalescing

Dirty identity is stable across change set, node, and scope. Repeated causes merge into one row, increment a bounded cause count, and retain at most 32 sorted unique cause fingerprints. An identical replay is idempotent. A replay with the same dirty identity but different causal coverage is rejected rather than replacing evidence.

Topological traversal visits only reachable aggregate, KPI, and invalidation nodes. An unrelated KPI cannot become dirty unless a registry dependency connects it to the changed aggregate.

### Change Sets and Watermarks

`private.deterministic_change_sets` is immutable recalculation history and the idempotency boundary. It records workspace, Business Entity, input contribution fingerprint, registry and policy versions, prior and resulting state fingerprints/watermarks, execution mode, counts, lifecycle state, and redacted integrity failure evidence.

Idempotency is scoped by input state, registry/policy, prior state, and execution mode. This permits exact replay while allowing a quarantined incremental attempt and a distinct clean-full recovery attempt to coexist as evidence.

The deterministic watermark is a canonical fingerprint stating that one accepted contribution-state fingerprint was processed through one registry, policy, and complete deterministic state. It is not a provider synchronization watermark, an AI watermark, or a timestamp standing in for truth.

### Persistence and Concurrency

The migration introduces only:

- `private.deterministic_change_sets`;
- `private.deterministic_aggregate_states`; and
- `private.dependency_dirty_nodes`.

Checked public RPCs begin a change set, read current Phase 2 contribution state, read current deterministic state, coalesce dirty nodes, and finalize a result. The database independently rebuilds canonical node, state, watermark, and failure fingerprints. Finalization locks `private.fact_contribution_events` in share mode while validating the current contribution fingerprint and publishing, preventing a concurrent contribution insert from creating a false watermark.

Aggregate rows use row-version compare-and-swap and carry node-level identity/source/state fingerprints. The global state fingerprint and watermark live on the change set so an unrelated aggregate row is not rewritten for every change. Completed or quarantined change sets, completed dirty nodes, and historical rows are immutable.

### Equivalence, Quarantine, and Recovery

`cleanFullRecompute` rebuilds all applicable aggregate and KPI state from the complete current accepted contribution set for one workspace and Business Entity. It is the correctness oracle. `runIncrementalFullEquivalence` compares canonical state fingerprints, exact decimal values, identities, source fingerprints, registry, policy, and deterministic ordering.

If the fingerprints differ:

1. the incremental state is not published;
2. the change set is quarantined;
3. prior known-safe aggregate state remains current;
4. a redacted canonical failure fingerprint and audit record are retained; and
5. a separately recorded clean-full execution may publish only after it independently passes current-input and state validation.

The clean result never silently overwrites a mismatched incremental attempt. No downstream intelligence or AI route becomes eligible from quarantined state.

### Shadow Adapter

The compatibility adapter maps exact deterministic KPI state to legacy KPI rows and calls `buildCanonicalKpiProducerOutputV1`. This preserves existing formula ownership and distinguishes exact canonical values from legacy JavaScript number projections. Its output is structurally fixed to `shadowOnly: true` and `promotionAuthorized: false`.

No customer route, loader, snapshot producer, Business Health formula, risk/opportunity engine, or Production flag changes in Phase 3.

### Security

All three tables are in `private`, have forced RLS and no policies, and grant no direct table authority to `anon`, `authenticated`, `service_role`, `external_integrations_authority`, or the Phase 3 role. `deterministic_calculation_authority` is `NOLOGIN NOINHERIT` and receives execute only on the five checked Phase 3 RPCs. It receives no provider, OAuth, source/fact mutation, model, or arbitrary private-schema authority.

RPCs bind workspace and Business Entity to current Phase 1/2 rows; validate contribution, dirty-node, change-set, registry, policy, state, and watermark identity; reject cross-tenant substitution; and write audit metadata. No deployed credential is provisioned.

## Verification Evidence

The deterministic regression suite covers graph failures, exact decimals, all old/new mutation categories, period expansion, scope mismatches, idempotency, mismatch quarantine, clean recovery, shadow adaptation, and a pinned 250-mutation randomized sequence. Every accepted randomized state matched a clean recomputation.

The bounded scale fixture used 10,000 current contributions. A historical correction scanned two old/new contributions incrementally versus 10,000 in the oracle. A 200-change event storm coalesced to one dirty node with bounded cause evidence. Unrelated KPI state remained byte-for-byte unchanged. Phase 3 model calls were zero.

The exact migration was applied after the complete canonical baseline to a fresh data-free disposable Supabase branch. Phase 3 database tests and the existing HIGH-security, billing, Phase 1, and Phase 2 suites passed, including hosted `dblink` concurrency tails. The disposable branch was then deleted.

## Consequences

### Positive

- Incremental work is proportional to affected dependency scope for supported reducers.
- The full path remains the single correctness oracle and customer-visible path.
- Exact accounting truth, tenant isolation, provenance, and immutable failure evidence are preserved.
- Registry changes and stale work fail closed.
- Later provider families can produce accepted contributions without entering the generic dependency vocabulary.

### Costs

- Every new KPI family needs an explicit registry entry and reducer proof.
- Clean equivalence remains expensive by design and must be scheduled deliberately in later runtime phases.
- The initial registry proves one bounded recognized-revenue path; it does not claim incremental coverage for all existing KPIs.
- XOR source-fingerprint accumulation is an incremental provenance accumulator, not a cryptographic multiset proof by itself; publication still validates current contribution state and the complete canonical state fingerprint.

## Excluded and Deferred

Phase 3 does not include provider connections, mappings, synchronization, OAuth, credentials, provider adapters, queues, checkpoints, webhooks, temporary payloads, GCP resources, customer UI, Business State Delta, materiality, freshness execution, AI claims, model routing, or Production promotion. Durable queue delivery and runtime scheduling remain later phases.

## Review Gate

Promotion requires architecture/security approval plus all Phase 3, database authorization, prior integration, Evidence Engine, KPI, snapshot, intelligence, Business Health, workspace, lifecycle, billing/legal, TypeScript, ESLint, build, and whitespace checks. This ADR and implementation are not authorization to commit, merge, deploy, migrate Preview/Production, or begin Phase 4.
