# External Integrations Phase 8A.0 Provider Contract Convergence

**Status:** Implementation and disposable-verification review only
**Date:** 2026-08-21
**Branch:** codex/external-integrations-phase-8a0-provider-contract-convergence
**Base:** a45873c4cf6b295a143cf2666e145f7b9d5a820f
**Scope:** Provider runtime contract and persistence convergence only

## Environment Model

`providerEnvironment` and `provider_environment` mean one thing: the bounded
environment key registered by a provider descriptor. They do not mean the
Vaeroex deployment environment.

| Provider | Authoritative provider environments |
| --- | --- |
| `synthetic` | `test` |
| `quickbooks_online` | `sandbox`, `production` |

`unknown` remains parsing-only QBO metadata. It cannot become a connection,
mapping, OAuth state, credential, runtime task, or provider-source authority
environment. `development`, `test`, `preview`, and `production` remain valid
examples of a separate Vaeroex deployment-environment concept only where that
concept is explicitly named. Phase 8A.0 does not add or overload such a field.

Generic TypeScript contracts use the shared bounded
`ProviderEnvironmentKeySchema`. Provider membership is enforced by the reviewed
descriptor registry before new persistence and again by checked database
authority. Bounded syntax alone does not establish provider authority.

## Contract Decisions

`oauth_credential_envelope_v1.environment` and
`oauth_credential_aad_v1.environment` already meant the provider environment.
Their canonical bytes, fingerprint input, KMS AAD construction, and persisted
binding all use the connection's `provider_environment`. The legacy field name
is now documented explicitly. No rename or V2 bump is made because that would
change AAD bytes without changing semantics.

The following contracts remain V1 with additive registered vocabulary:

- `integration_connection_v1`
- `provider_entity_mapping_v1`
- `integration_sync_run_v1`
- `integration_oauth_state_v1`
- `integration_credential_authority_v1`
- `oauth_credential_envelope_v1`
- `oauth_credential_aad_v1`

Two new authority boundaries receive explicit V1 contracts:

- `integration_provider_credential_read_v1`
- `integration_provider_source_commit_v1`

The canonical reviewed registry for new persistence is the Phase 7
QBO-inclusive `vaeroex_provider_descriptors_v1` projection with fingerprint
`sha256:6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758`.
The QBO descriptor fingerprint is
`sha256:e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac`
and its adapter is `qbo_provider_adapter_v1`. Historical synthetic rows remain
recognizable with the prior registry fingerprint; new QBO persistence accepts
only the reviewed QBO-inclusive registry values.

## Synthetic-Only Audit

| Assumption | Classification | Resolution |
| --- | --- | --- |
| Phase 5 TypeScript enum treated deployment environments as provider environments. | Must extend for Phase 8B. | Replaced by the shared bounded provider-environment key; provider membership remains descriptor-bound. |
| Phase 5 OAuth and credential checks allowed only `development`, `test`, `preview`, or `production`. | Must extend for Phase 8B. | Forward constraints and checked RPCs now accept only registered provider/environment pairs. |
| Phase 4 connection descriptor validation recognized only synthetic/test. | Must extend for Phase 8B. | Exact QBO registry, descriptor, environment, and adapter values are allowlisted. |
| Phase 4 scope validation recognized only synthetic read scopes. | Must extend for Phase 8B. | QBO accepts exactly `com.intuit.quickbooks.accounting`; no optional or implicit scope is accepted. |
| Phase 4 capability validation recognized one synthetic snapshot. | Must extend for Phase 8B. | The exact minimized Phase 7 QBO capability snapshot is allowlisted; arbitrary JSON is rejected. |
| Phase 4 workspace policy recognized synthetic policy identifiers. | Must extend for Phase 8B. | QBO policy identifiers are versioned and provider/environment checked. |
| Phase 4 freshness validation fixed the synthetic general-ledger policy. | Must extend for Phase 8B. | Registered QBO domains are supported with versioned bounded policy parameters. |
| Phase 4 mapping verification mode was `synthetic_phase_4`. | Must extend for Phase 8B. | QBO mappings normalize to `qbo_realm_mapping_v1`; synthetic history stays valid. |
| Phase 4 sync initialization trigger was synthetic-specific. | Must extend for Phase 8B. | `provider_initialization` is admitted for QBO while the existing trigger values remain valid. |
| Phase 4 activation required a successful `synthetic_verification` run. | Must extend for Phase 8B. | The lifecycle now requires `synthetic_verification` for synthetic and `provider_initialization` for QBO, with all mapping, freshness, and state gates preserved. |
| Phase 4 exported registry remains the historical synthetic registry. | Generic and already safe for history. | A separate reviewed registered-provider registry drives all new persistence. |
| Phase 7 QBO fixtures and parsing allow `unknown`. | Intentionally parsing-only. | The QBO source mapper rejects `unknown` and any mismatch before source authority. |
| Synthetic provider credentials, tests, and adapter fixtures use `synthetic/test`. | Intentionally synthetic-test-only. | Preserved and rerun as legacy regression coverage. |
| Provider-source commit currently admits only QBO envelopes. | Intentionally deferred broader support. | A later provider requires a separately reviewed registry and source contract update. |

The QBO freshness policy is architecture support, not a customer-facing SLA.
`qbo_control_plane_freshness_policy_v1` permits reviewed QBO domains and bounded,
versioned thresholds. It does not claim literal real time or establish a launch
default in customer-facing behavior.

## Credential Read Authority

Routine reads do not reuse the exclusive refresh lease. The checked
`read_integration_provider_credential_v1` RPC derives workspace, Business
Entity, connection, current generation, provider, environment, and mapping from
an active leased provider task. It verifies active connection and mapping state,
exact scopes, active credential state, exact credential generation, and a
30-to-900-second safety window.

The RPC uses shared row locks, does not update credential state, and returns one
of `available`, `refresh_required`, or `credential_version_stale`. Only
`integration_credential_broker_authority` can execute it. `anon`,
`authenticated`, `service_role`, deterministic authorities, provider runtime,
and provider-source authority cannot execute it or read credential tables.

Only encrypted credential material and canonical AAD metadata cross the database
boundary. The broker validates the configured provider/environment, AAD digest,
envelope identity, exact scopes, and expiration before creating a one-use,
redacted access-token capability. Refresh tokens never cross into the provider
request boundary. Credential-read audits use the existing `authorization`
retention class and contain status, version, generation, and task state only.
They contain no token, ciphertext, KMS plaintext, or provider payload.

Concurrent ordinary reads use compatible shared locks. Refresh CAS mutation
still takes an exclusive row lock, waits for in-flight read transactions, and
then safely supersedes the expected credential version.

## Provider Source Authority

`integration_provider_source_authority` is `NOLOGIN NOINHERIT`. It is not granted
to `service_role` or any existing authority and has no `private` schema usage or
direct table privileges. Its only Phase 8A.0 execution privilege is the checked
`commit_provider_external_source_record_version_v1` RPC.

The RPC derives scope from a leased provider task and requires the exact active
connection, current generation, active mapping, workspace, Business Entity,
provider key, and provider environment. The submitted normalized source version
must repeat those trusted identifiers exactly. Disconnected, deleted,
superseded, stale-generation, cross-tenant, cross-connection, cross-mapping, and
cross-environment work fails closed.

The authority appends immutable `source_kind = provider` source versions with
`untrusted_external_input` trust and `pending` validation. Idempotent replay
preserves one source version. It has no canonical-fact acceptance,
reconciliation, contribution, deterministic aggregate, KPI, model, credential,
or direct table-DML authority. Successful source commits emit minimized
`operational` audit metadata containing contract version, immutable version,
source kind, validation state, and prior-version ID only.

## Runtime Boundary

This phase creates no GCP resource, Intuit app or credential, OAuth
authorization, provider call, webhook endpoint, queue, route, UI, Preview
configuration, Production change, AI path, or KPI promotion. Model-call count is
zero and `promotionAuthorized` remains `false`.

Live Phase 8A GCP verification remains closed during this implementation review.
It may resume only after this convergence correction is reviewed and merged,
using the separately approved isolated non-Production GCP process and all Phase
5/6 live-cloud gates. Passing disposable Supabase and synthetic repository tests
does not itself authorize live cloud verification or Phase 8B.
