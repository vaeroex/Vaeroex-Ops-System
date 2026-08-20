# External Integrations Phase 0.1 Contract/Persistence Alignment

**Status:** Review candidate
**Date:** 2026-08-20
**Branch:** codex/external-integrations-phase-0-1-alignment
**Base:** a5ca668fd595448543e50c449fc804aa240a54c7
**Scope:** Contract and logical persistence specification only; no executable schema or runtime

## Normative Order

ADR-007 and the strict Phase 0 TypeScript/Zod contracts are normative. This record corrects the logical implementation specification where it conflicted with those contracts. A runtime contract changes only where its accepted value domain could not be represented exactly by the approved persistence type.

Classification labels used below are:

- **exact match:** persisted directly with the same semantic name and vocabulary;
- **contract-derived:** reconstructed deterministically from normalized rows or fixed contract rules;
- **persistence-only:** operational metadata that cannot alter contract truth or identity;
- **intentionally deferred:** belongs to a later approved phase and is not implemented by Phase 0.1;
- **incompatible resolved:** the prior specification conflicted and is replaced by the stated design.

## Decimal Boundary

| Semantic role | Runtime schema | Future persistence | Exact accepted boundary |
|---|---|---|---|
| money, decimal, percentage, absolute/relative delta, impact value | PersistedFactDecimalSchema | canonical text; exact numeric(30,9) query projection where needed | 21 integer digits and 9 fractional digits; positive, negative, or zero |
| integer fact value | PersistedFactIntegerSchema | canonical text; exact numeric(30,9) query projection where needed | 21 integer digits and no fraction |
| contribution weight | PersistedNonNegativeFactDecimalSchema | canonical text; exact numeric(30,9) query projection | same precision/scale, non-negative |
| confidence | PersistedUnitIntervalDecimalSchema | canonical text in the V2 delta document | same precision/scale and zero through one |
| exchange rate | PersistedExchangeRateSchema | canonical text; exact numeric(30,12) query projection | 18 integer digits and 12 fractional digits; positive only |

All remain canonical strings at contract, persistence-authority, and hashing boundaries. Fixed-scale numeric output can add display zeroes, so a numeric column is never the lexical source for a contract or fingerprint. If Phase 1 adds a numeric query/calculation projection, the server-controlled operation derives it from the already validated canonical string and enforces exact numeric equality; it cannot replace or contradict the string. Validation does not round, truncate, clamp, pad, strip, or convert a value. An out-of-range value is invalid before fingerprint construction and before persistence.

## BusinessEntity Field Audit

| Contract field | Logical persistence | Classification and invariant |
|---|---|---|
| contractVersion | contract_version | exact match; fixed business_entity_v1 |
| id | id | exact match |
| workspaceId | workspace_id | exact match; tenant authority always includes workspace |
| parentBusinessEntityId | parent_business_entity_id | exact match; same-workspace FK; cannot equal id |
| entityKey | entity_key | incompatible resolved; direct, bounded, immutable, UNIQUE (workspace_id, entity_key) |
| displayName | display_name | exact match |
| legalName | legal_name | exact match and nullable |
| status | status | incompatible resolved; exact active, inactive, archived vocabulary |
| baseCurrency | base_currency | exact match |
| timeZone | timezone | exact match |
| createdAt | created_at | exact match |
| updatedAt | updated_at | exact match |
| entityType, reportingCurrency, fiscalYearStartMonth, consolidationPolicyVersion | same snake-case metadata columns | persistence-only; they cannot alter entity identity or contract status |
| rowVersion, createdBy, updatedBy | same snake-case control columns | persistence-only concurrency/audit metadata |
| deletion/erasure transition | separate future erasure workflow | intentionally deferred; never encoded as deleting/deleted Business Entity status |

entity_key is provider-neutral and stable after creation. It may be used with workspace_id for lookup and uniqueness, but it never grants cross-workspace access or substitutes for an authenticated workspace authorization check.

## IntegrationConnection Field Audit

| Contract field | Logical persistence | Classification and invariant |
|---|---|---|
| contractVersion | contract_version | exact match; fixed integration_connection_v1 |
| id | id | exact match |
| workspaceId | workspace_id | exact match |
| businessEntityId | business_entity_id | incompatible resolved; required same-workspace entity ownership |
| providerKey | provider_key | exact match |
| providerEnvironment | provider_environment | incompatible resolved; bounded descriptor environment key, not a hard-coded two-value identity |
| providerTenantReferenceFingerprint | provider_tenant_reference_fingerprint | incompatible resolved; nullable SHA-256 fingerprint, never raw provider tenant identity |
| status | status | incompatible resolved; replaces the competing state column name and uses the exact contract lifecycle |
| requestedScopes | requested_scopes | exact match |
| grantedScopes | granted_scopes | exact match; subset of requested scopes |
| configurationVersion | configuration_version | incompatible resolved; positive compare-and-swap version |
| createdAt | created_at | exact match |
| statusChangedAt | status_changed_at | incompatible resolved; exact status transition time |
| displayName, statusReasonCode, capability snapshot/version, adapter/sync policy metadata | same snake-case columns | persistence-only; bounded and unable to redefine contract identity or status |
| authorization, replacement, row-version, updated/deleted metadata | same snake-case columns | persistence-only control/audit state |

Provider environment endpoint class remains descriptor metadata. A Business Central or NetSuite adapter can supply its own bounded environment key and sandbox, production, or private endpoint class without changing this connection contract.

## ExternalSourceRecordVersion Field Audit

| Contract field | Logical persistence | Classification and invariant |
|---|---|---|
| contractVersion | contract_version | exact match; fixed external_source_record_version_v1 |
| id | id | exact match |
| workspaceId | workspace_id | exact match |
| businessEntityId | business_entity_id | exact match |
| connectionId | connection_id | exact match and nullable; required only for provider sources |
| immutableVersion | immutable_version | exact match; positive and unique per source identity |
| priorVersionId | prior_version_id | exact match; same source identity |
| recordKind | record_kind | exact match |
| source.kind | source_kind | incompatible resolved; exact provider, upload, manual vocabulary |
| source provider fields | provider_key, provider_record_type, provider_record_id, provider_version_reference | exact decomposed match for provider variant |
| source upload fields | artifact_fingerprint, row_reference | exact decomposed match for upload variant |
| source manual fields | actor_id, entry_reference | exact decomposed match for manual variant |
| temporal.basis | temporal_basis | exact match |
| temporal providerCreatedAt/providerUpdatedAt | provider_created_at/provider_updated_at | exact match and nullable |
| temporal observedAt/synchronizedAt/ingestedAt | observed_at/synchronized_at/ingested_at | exact match |
| temporal effectiveAt/postingDate | effective_at/posting_date | exact match and nullable |
| temporal periodStart/periodEnd | period_start/period_end | exact match and nullable with paired period invariant |
| temporal sourceTimeZone | source_timezone | exact match and nullable |
| accounting.basis/currency | accounting_basis/accounting_currency | exact match |
| normalizedSchemaVersion | normalized_schema_version | exact match |
| changeKind | change_kind | exact match |
| normalizedProjection | normalized_projection | incompatible resolved; nullable JSONB |
| trust | fixed untrusted_external_input CHECK | contract-derived literal |
| validation.state | validation_state | exact pending, valid, invalid, quarantined vocabulary |
| validation.validatorVersion | validator_version | incompatible resolved; persisted exactly |
| validation.issues | validation_issues | incompatible resolved; bounded structured array |
| receivedAt | received_at | exact match |
| sourceFingerprint | source_fingerprint | exact match after deterministic generation |
| source_record_id, mapping_id, sync_run_id, current pointer, lifecycle timestamps | normalized identity/control rows | persistence-only; cannot alter immutable version content |

The future database check is `change_kind = 'deleted'` if and only if `normalized_projection IS NULL`. Every non-deleted version requires a projection. The version row rejects UPDATE and DELETE; controlled erasure is separate. Variant checks make exactly one provider/upload/manual source descriptor reconstructable.

## CanonicalBusinessFactVersion Field Audit

| Contract field | Logical persistence | Classification and invariant |
|---|---|---|
| contractVersion | contract_version | exact match; corrected canonical_business_fact_version_v2 |
| id | id | exact match |
| workspaceId | workspace_id | exact match |
| businessEntityId | business_entity_id | exact match |
| immutableVersion | immutable_version | exact match; positive and unique per canonical fact |
| factKind | canonical_business_facts.fact_kind | incompatible resolved; direct authoritative identity |
| factKey | canonical_business_facts.fact_key | incompatible resolved; direct authoritative identity |
| dimensions | dimensions | incompatible resolved; ordered contract array, unique keys, not a competing subject identity |
| temporal effectiveAt/postingDate | effective_at/posting_date | exact match and nullable |
| temporal periodStart/periodEnd | period_start/period_end | exact paired match |
| temporal fiscalYear/fiscalPeriod | fiscal_year/fiscal_period | exact match and nullable |
| temporal sourceTimeZone/closedPeriod | source_timezone/closed_period | exact match |
| accounting basis | accounting_basis | exact match |
| accounting sourceCurrency/reportingCurrency | source_currency/reporting_currency | exact match and nullable |
| accounting exchangeRate/exchangeRateSource | exchange_rate/exchange_rate_source | exact match and nullable with currency-coherence checks |
| value.kind | value_kind | incompatible resolved; exact money, decimal, percentage, integer, boolean, date, text, structured vocabulary |
| value payload | authoritative canonical text/typed value columns plus exact numeric query projection where applicable | contract-derived decomposition; exactly one value variant, or none only for tombstone; fingerprints use canonical text |
| reconciliationState | reconciliation_state | incompatible resolved; exact accepted, excluded_duplicate, excluded_authority, conflicted, tombstone vocabulary |
| validationState | validation_state | incompatible resolved; exact valid, invalid vocabulary |
| sources | business_fact_sources rows | contract-derived normalized array; at least one unique source version reference |
| decision.authority | decision_authority | incompatible resolved; exact deterministic_policy, customer_authorized_user, operator vocabulary |
| decision.policyVersion | decision_policy_version | incompatible resolved; required for deterministic policy |
| decision.actorId | decision_actor_id | incompatible resolved; required for customer/operator decisions |
| decision.decidedAt | decision_decided_at | incompatible resolved; persisted exactly |
| decision.reasonCodes | decision_reason_codes | incompatible resolved; bounded unique array |
| normalizationVersion | normalization_version | exact match |
| transformationVersion | transformation_version | exact match |
| sourceObservedAt | source_observed_at | exact match |
| createdAt | created_at | exact match |
| factFingerprint | fact_fingerprint | exact match after deterministic generation |
| fact_id, prior_version_id, current_version_id, lifecycle cache, row counters | normalized identity/control fields | persistence-only; cannot compete with factKind plus factKey |
| domain or subject classifications | versioned fact registry, dimensions, or denormalized metadata | intentionally deferred; never authoritative identity |
| source-authority policy/reconciliation case FKs | optional audit joins | persistence-only; contract decision fields remain sufficient to reconstruct truth |

factKind plus factKey is the sole authoritative canonical identity and is enforced as UNIQUE (workspace_id, business_entity_id, fact_kind, fact_key). A natural-key hash may be a contract-derived index over those exact values, but domain, fact_type, subject_type, or subject hashes cannot define a second canonical identity.

## Fact Source and Decision Atomicity

Each future business_fact_sources row stores fact_version_id, source_record_version_id, source_fingerprint, source_role, and nullable canonical contribution_weight exactly as FactSourceReferenceSchema. A numeric(30,9) query projection may accompany the canonical string under an equality invariant. Source-field paths or internal transformation metadata may be persistence-only, but direct KPI, operational-metric, or file-row alternatives are not contract source variants; uploads and manual entries first become ExternalSourceRecordVersion records.

Phase 1 must expose one narrow server-controlled transaction/RPC that validates the V2 fact, inserts the immutable fact version and all source edges, and then advances the current pointer. A deferred constraint trigger must verify at transaction end that every inserted/current fact version has at least one valid same-tenant source edge. Direct partial creation is denied. Phase 0.1 specifies this invariant but does not create it.

Decision checks remain exact: deterministic_policy requires decision_policy_version; customer_authorized_user and operator require decision_actor_id; no AI or model authority value exists.

## FreshnessState Field Audit

| Contract field group | Logical persistence | Classification and invariant |
|---|---|---|
| contractVersion | contract_version | incompatible resolved; fixed integration_freshness_v1 |
| workspaceId, businessEntityId, connectionId, mappingId | corresponding snake-case columns | exact match with same-tenant ownership |
| domain, scopeKey | domain, scope_key | exact match and uniqueness scope |
| providerWatermarkAt, lastAttemptAt, lastSuccessfulSyncAt, lastReconciledAt | corresponding snake-case timestamps | exact match |
| observedLagSeconds | observed_lag_seconds | exact match |
| status | status | incompatible resolved; replaces state and uses exact contract vocabulary |
| blockingLevel, reasonCode, policyVersion, calculatedAt | corresponding snake-case columns | exact match |
| currentMaxAgeSeconds, staleAfterSeconds, ageSeconds | corresponding snake-case columns | incompatible resolved; required for reconstructable timer state |
| rowVersion | row_version | exact match |
| id | id | persistence-only surrogate key |

The contract's timer and fail-closed checks remain normative. No provider-specific freshness status is added.

## Provider Adapter Field Audit

| Contract surface | Persistence classification | Resolution |
|---|---|---|
| ProviderDescriptor all fields | intentionally deferred code registry | Exact V1 descriptor remains authoritative; accessMode is read_only, methods are GET-only, environments carry key and endpoint class, capabilities and unsupported capabilities are explicit. |
| ProviderAdapterContext all fields | intentionally deferred runtime binding | Workspace, entity, connection, provider, environment, tenant fingerprint, configuration version, and mapping version remain mandatory. |
| ProviderAdapterRequest all fields | intentionally deferred ephemeral request | The four V1 read-only operations remain exact; future OAuth/sync orchestration interfaces do not extend this envelope. |
| ProviderAdapterResult all fields | intentionally deferred ephemeral result | Strict tenant/provider-bound untrusted output remains exact and is not persisted as accepted truth. |

The implementation specification's broader conceptual authorization and synchronization methods are future internal provider services, not competing Phase 0 ProviderAdapterRequest operations. Business Central and NetSuite descriptors can express their provider-specific scopes, environments, streams, cursors/change hints, rate behavior, and unsupported capabilities without changing any generic schema.

## BusinessStateDelta Field Audit

| Contract field group | Logical persistence | Classification and invariant |
|---|---|---|
| contractVersion | delta_contract_version | exact match; corrected business_state_delta_v2 |
| id, workspaceId, businessEntityId, changeSetId | corresponding snake-case columns | exact match |
| from/to deterministic watermark and state fingerprint | corresponding snake-case columns | incompatible resolved; all four are persisted |
| asOf and window | as_of, window_start, window_end | exact match; window bounds are required and ordered |
| sourceWatermarks | source_watermarks JSONB | exact array shape with providerKey, mappingId, streamKey, watermarkAt |
| freshness | freshness JSONB | exact array of complete FreshnessState V1 objects |
| changes | delta JSONB changes | incompatible resolved; includes changeKey, changeKind, node fields, exact bounded before/after and delta values, severity/confidence, and immutable evidence references |
| correlatedGroups | delta JSONB groups | exact match with existing change-key references only |
| deterministicRisks and deterministicOpportunities | delta JSONB developments | exact key/priority/title/summary/impact/evidence shape |
| materiality | materiality columns plus exact JSONB | exact policy, fingerprint, level, decision, reasons, persistence, cooldown state |
| eligibleRoutes and limitations | corresponding arrays | exact match and fail-closed route checks |
| deltaFingerprint | delta_fingerprint | incompatible resolved; exact optional generated fingerprint |
| created_at | created_at | persistence-only receipt time |

The full V2 object must be reconstructable and validated before persistence. Outer query columns may duplicate contract-derived values from the immutable JSON document, but cannot contradict it.

## Canonical Serialization and Fingerprints

The V1 fingerprint envelope, purpose vocabulary, UTF-8 canonical JSON algorithm, key sorting, semantic-set sorting, and excluded receipt-time fields remain exact. Validation always precedes purpose-specific envelope construction. The canonical fact and delta goldens change only because their corrected V2 contractVersion values are included in semantic payloads; the source golden does not change.

## Resolved Incompatibility Summary

1. Syntax-only decimals could exceed persistence, and fixed-scale numeric output could not preserve canonical lexical identity: semantic bounded schemas reject before hash/persist; canonical text remains authoritative and any numeric column is an exact derived projection.
2. Persisted integers and contribution weights shared the same hidden storage conflict: they now use explicit numeric(30,9)-compatible schemas.
3. Business Entity lacked entity_key and overloaded lifecycle with deletion: entity_key is direct/stable/workspace-unique; status is active/inactive/archived; erasure is separate.
4. Connection persistence omitted entity ownership, tenant fingerprint, contract/configuration version, and exact status timing: all are restored.
5. Source vocabulary and fields could not reconstruct ExternalSourceRecordVersion: exact variants, temporal/accounting/validation fields, and nullable projection invariant are restored.
6. Canonical fact identity competed with domain/fact_type/subject hashes: factKind plus factKey is the only authority.
7. Dimensions were proposed as an object instead of the contract's ordered unique-key array: persistence now stores the exact array.
8. Value, source validation, fact validation, and reconciliation vocabularies diverged: all now use exact contract terms.
9. Fact decision provenance was incomplete: authority, policy version, actor, decided time, and reason codes are required with Phase 0 checks.
10. Fact provenance allowed zero or non-contract source alternatives: each fact version requires one or more exact ExternalSourceRecordVersion edges atomically.
11. Freshness omitted thresholds/age and renamed status: the complete FreshnessState V1 is reconstructable.
12. Business State Delta omitted normative fields and nested shapes: the specification now mirrors the complete corrected V2 contract.
13. The broad conceptual provider service could be mistaken for the strict adapter envelope: the two boundaries are explicitly separated.

## Phase Boundary

No migration, database, Supabase change, provider credential, OAuth configuration, GCP resource, route, UI, Preview change, Production change, adapter implementation, or runtime behavior is part of this alignment. Phase 1 remains unauthorized until this review candidate is approved.
