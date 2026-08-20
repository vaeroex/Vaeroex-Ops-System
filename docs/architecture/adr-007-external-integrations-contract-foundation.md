# ADR-007: External Integrations Contract Foundation

**Status:** Accepted for Phase 0; amended for Phase 0.1 review
**Date:** 2026-08-20
**Scope:** Provider-neutral contracts, deterministic fingerprints, and logical persistence alignment only

## Context

Vaeroex needs a reusable external connector foundation before adding QuickBooks Online or any later provider. The existing application already has strong workspace authorization, evidence lineage, deterministic intelligence, immutable fingerprint, and private worker patterns. It does not yet have a provider-neutral connection lifecycle, Business Entity boundary, immutable external source/fact contract, cross-source reconciliation boundary, domain freshness contract, or Business State Delta.

Phase 0 must freeze those boundaries without creating persistent data, runtime provider access, customer credentials, queues, routes, or user interface behavior.

Phase 0.1 reconciles these accepted runtime contracts with the logical persistence specification before any migration exists. The field-by-field result is recorded in [External Integrations Phase 0.1 Contract/Persistence Alignment](./external-integrations-phase-0-1-contract-persistence-alignment.md). It remains a design correction only and creates no schema or runtime behavior.

## Decision

### Layering

The approved flow is:

~~~text
external or uploaded source
  -> connector control plane and provider adapter
  -> untrusted external source envelope
  -> immutable source identity/version
  -> deterministic validation and normalization
  -> source authority and cross-source reconciliation
  -> accepted canonical business-fact version
  -> contribution/dependency calculation
  -> deterministic KPI state
  -> freshness and materiality
  -> Business State Delta
  -> selective model analysis
  -> existing evidence contracts and IntelligenceSnapshotV1
~~~

IntelligenceSnapshotV1 remains a downstream intelligence contract. It is not provider storage.

### Tenant and Entity Identity

- workspaceId is always the tenant boundary.
- A workspace can own multiple Business Entities.
- A Business Entity can later map to one or more provider companies, subsidiaries, or legal entities.
- Generic contracts never infer that one workspace equals one external company.
- Provider-returned identifiers never establish workspace or Business Entity authority.

### Strict Runtime Contracts

Phase 0 exports strict Zod schemas and inferred readonly TypeScript types for:

- BusinessEntity;
- IntegrationConnection and its lifecycle;
- ExternalSourceRecordVersion;
- CanonicalBusinessFactVersion;
- ProviderDescriptor and provider adapter result envelopes;
- FreshnessState;
- BusinessStateDeltaV2;
- canonical fingerprint inputs.

Unknown fields fail validation. Identifiers, timestamps, versions, hashes, currency values, and persisted decimal representations have bounded schemas. Accounting decimals are canonical strings, not floating-point numbers.

### Phase 0.1 Contract Correction

The syntax-level CanonicalDecimalSchema remains available for nonpersisted parsing. Persisted canonical accounting truth uses semantic schemas with exact storage-compatible bounds:

- money, general fact decimals, percentages, contribution weights, confidence values, deterministic deltas, and deterministic impact values fit PostgreSQL numeric(30,9): at most 21 integer digits and 9 fractional digits;
- persisted integer fact values fit the integer range of numeric(30,9): at most 21 digits;
- positive exchange rates fit PostgreSQL numeric(30,12): at most 18 integer digits and 12 fractional digits.

Validation preserves the supplied canonical string. That string remains the authoritative persisted contract representation and fingerprint input. A future fixed-scale numeric column may be an exact query/calculation projection, but it cannot replace the canonical string or become the lexical source for a contract or hash. Values outside the supported range fail before canonical hashing or persistence and are never rounded, truncated, clamped, or converted through floating point. Any future fact-specific rounding policy is a separately versioned deterministic transformation.

This material narrowing increments CanonicalBusinessFactVersion from V1 to V2 and BusinessStateDelta from V1 to V2. Source-record, Business Entity, connection, provider-adapter, freshness, and fingerprint versions remain V1 because their runtime semantics and the fingerprint algorithm did not change. Fact and delta golden fingerprints change because contractVersion is semantic fingerprint input; the source golden remains unchanged.

### Numerical Truth

Provider adapter output is always marked untrusted_external_input. It cannot be accepted evidence, a canonical fact, or numerical truth.

Canonical fact decisions can come only from:

- deterministic policy;
- an authenticated customer-authorized user; or
- an authorized operator.

There is no model decision-authority value. A model can later interpret a validated Business State Delta, but it cannot create or mutate source records, fact values, contribution values, deterministic KPIs, freshness, or materiality.

### Persistence Identity and Reconstruction

- BusinessEntity.entityKey is persisted directly, stable after creation, unique within its workspace, and never sufficient authorization without workspace membership.
- Business Entity status remains active, inactive, or archived. A future erasure workflow is separate from business lifecycle status.
- ExternalSourceRecordVersion.normalizedProjection is nullable only for deleted versions; live versions require a projection.
- Canonical fact identity is the tenant/entity-scoped pair factKind plus factKey. Domain or subject metadata may be registry-derived or denormalized, but cannot become a competing identity.
- Canonical fact versions preserve the exact value, validation, reconciliation, decision, and provenance vocabulary from the runtime contract.
- Every canonical fact version has at least one reconstructable source reference. A future migration must insert the fact version and normalized source edges atomically and use a deferred invariant so a current fact version cannot commit without provenance.

### Provider Neutrality

The generic contracts contain no QuickBooks, Intuit, Microsoft, Business Central, Oracle, NetSuite, or SAP object names. Provider descriptors advertise bounded capabilities and side-effect-free data operations. Provider-specific scopes, entities, pagination, reports, webhooks, errors, and token behavior belong in later adapter packages.

The same Phase 0 contracts can be implemented by QuickBooks Online, Business Central, or NetSuite without changing tenant, source-version, fact-version, freshness, delta, or fingerprint identity.

### Connection Lifecycle

The generic lifecycle is:

~~~text
pending_authorization
  -> authorized_unmapped
  -> initializing
  -> active

active <-> degraded
active/degraded -> reauthorization_required
pending_authorization/initializing/degraded -> error
error -> pending_authorization/initializing/disconnected/deleting
authorized state -> disconnecting -> disconnected
disconnected/reauthorization_required -> pending_authorization
nondeleted state -> deleting -> deleted
~~~

Invalid transitions fail closed. Repeated application of the same state is idempotent.

### Canonical Serialization and Fingerprints

Canonical serialization:

- sorts object keys lexicographically;
- preserves array order unless a purpose-specific fingerprint builder defines an array as a semantic set and sorts it;
- rejects undefined, sparse arrays, cycles, non-plain objects, non-finite numbers, floating-point numbers, unsafe integers, bigint, functions, and symbols;
- represents accounting and metric decimals as canonical decimal strings;
- hashes UTF-8 canonical JSON with SHA-256 and the sha256: prefix;
- includes explicit fingerprint purpose and version.

Source, fact, and Business State Delta fingerprint builders include only semantic identity. Processing/receipt timestamps do not silently change source or fact truth.

### Freshness and Fail-Closed Behavior

Freshness is provider/domain scoped and versioned. Timer-derived state progresses through current, aging, and stale, with none, warning, current-intelligence, or all-derived blocking levels. The QBO timing values approved for V1 are launch defaults subject to sandbox/load evidence, not architectural constants.

aging data can remain eligible with an explicit warning. reauthorization_required, disconnected, sync_error, stale, and unknown inputs that block current intelligence cannot be eligible for current model analysis. Business State Delta validation removes no warning; an unsafe freshness state with an AI route is invalid.

### Business State Delta

BusinessStateDeltaV2 contains only compact deterministic before/after values, immutable evidence references, source/deterministic watermarks, correlation groups, freshness, deterministic risks/opportunities, versioned materiality/persistence/cooldown state, limitations, and explicit no-AI/defer/Luna/Terra/Sol eligibility. It contains no provider payload, token, or arbitrary source record.

The same material development receives a deterministic fingerprint so synchronization volume does not become model-call volume.

### Credential and Temporary-Payload Encryption Boundary

Small per-connection OAuth credential envelopes use direct Google Cloud KMS encryption because they remain comfortably below the direct-encryption plaintext limit.

Potentially large temporary provider report/page/debug payloads do not use direct KMS encryption. They use:

~~~text
random per-object AES-256-GCM DEK
  -> local payload encryption with trusted versioned AAD
  -> KMS wrapping of the small DEK
  -> ciphertext-only private object storage
~~~

AAD binds environment, workspaceId, connectionId, temporaryPayloadId, purpose, and encryption schema version from trusted database state. Google Cloud Storage remains private with uniform bucket-level access, public-access prevention, short lifecycle deletion, no object versioning, and soft delete disabled for the exceptional temporary-payload bucket. Platform encryption remains enabled but does not replace client-side envelope encryption.

Phase 0 defines this boundary only. It does not implement encryption or object storage.

### QuickBooks Report Direction

The modernized Intuit Reports API response is the canonical target for later QBO development and fixtures. Permanent legacy report support is not part of the architecture. A temporary compatibility parser is allowed only if current sandbox behavior requires it and must remain isolated behind an explicit provider contract version.

This provider-specific direction is documented here but does not leak into the generic Phase 0 contracts.

## Phase 0 Boundaries

Phase 0 includes only:

- this ADR;
- pure TypeScript/Zod contracts;
- deterministic canonical serialization and fingerprint helpers;
- golden and invalid contract tests;
- architecture boundary regression tests.

Phase 0.1 additionally includes only the bounded contract correction, deliberate golden updates, this ADR amendment, the field-by-field alignment record, correction of the external implementation specification, and pure regressions.

Phase 0 includes no:

- database migration or Supabase schema/type change;
- provider SDK, provider call, OAuth route, callback, webhook, or credential storage;
- Google Cloud resource, key, secret, queue, service, scheduler, bucket, or deployment;
- Vercel or Preview configuration;
- customer UI;
- model invocation;
- Production access.

## Consequences

### Positive

- Later provider adapters share one tenant-safe contract.
- External data cannot be mistaken for accepted fact truth.
- Accounting values and fingerprints are deterministic.
- Stale/disconnected data and model-created numerical truth fail closed.
- Business Central and NetSuite can follow QBO without replacing the foundation.
- Phase 0 is independently reversible because nothing persists against the contracts.

### Costs

- Strict schemas require explicit contract upgrades when semantics change.
- Canonical decimal strings require conversion at display/calculation boundaries.
- Provider-specific adapters must normalize into the generic envelope instead of exposing raw responses.
- Later migrations must faithfully implement these identities and invariants.

## Deferred

- All tables, RLS, RPCs, migrations, task/checkpoint state, and reconciliation persistence.
- Google Cloud integrations infrastructure and encryption code.
- QuickBooks adapter, OAuth, reports, fixtures, and sandbox access.
- Freshness threshold tuning from measured evidence.
- Numerical materiality thresholds and Luna/Terra/Sol budgets.
- Long-lived security/authorization/deletion audit duration pending legal/compliance review.
- Intuit legal/commercial/Production approval.

## Verification Gates

Phase 0 is complete only when:

1. strict schemas accept golden provider-neutral fixtures;
2. invalid lifecycle, tenant, decimal, source-trust, fact-authority, freshness, and delta states fail;
3. canonical serialization is stable under object-key permutation;
4. purpose-specific semantic sets fingerprint identically under permutation;
5. exact golden SHA-256 fingerprints are pinned;
6. no provider-specific name or runtime/network/database dependency appears in generic contracts;
7. TypeScript, lint, build, contract, architecture, and applicable existing regressions pass;
8. the diff contains no migration, route, UI, provider, infrastructure, or deployment change.
