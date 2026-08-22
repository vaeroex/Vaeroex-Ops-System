# External Integrations Phase 6 Durable Runtime Readiness

**Status:** Implementation and disposable-verification review only
**Date:** 2026-08-22
**Branch:** codex/external-integrations-phase-6-runtime-foundation
**Base:** 24dbe766206251b3bf28123af813a8317f1bea46
**Scope:** Provider-neutral durable synchronization runtime foundation only

## Authority Model

Supabase is the authoritative task, checkpoint, webhook replay, circuit, and
rate-coordination ledger. Google Cloud Tasks is only an authenticated delivery
mechanism. A task is committed before dispatch, and a private worker must obtain
a checked database lease before executing one bounded unit of work.

The runtime separates four `NOLOGIN NOINHERIT` authorities:

- webhook ingress records verified, minimized event metadata;
- task dispatch creates and dispatches work, discovers due work, and sweeps;
- provider runtime leases provider work and commits checked page outcomes;
- deterministic runtime leases only deterministic shadow work.

The roles have no direct table DML. All five runtime tables are private, forced
RLS, policy-free authority stores. `anon`, `authenticated`, `service_role`, the
control plane, and the credential broker receive no runtime shortcut.

## Delivery And Recovery

The Cloud Tasks body is exactly an `integration_cloud_task_protocol_v1` object
containing `protocolVersion` and opaque `taskId`. It carries no tenant name,
credential, provider payload, financial value, or secret. The eventual Cloud Run
handler must cryptographically verify Google OIDC before passing verified claims
to the runtime authorizer. Database delivery fingerprints, leases, row-version
CAS, durable effect fingerprints, and checkpoint CAS make platform redelivery
idempotent.

The queue topology remains provider-neutral: control, provider interactive,
provider bulk, and deterministic intelligence. Due-work discovery may be invoked
by one authenticated Scheduler signal, but it performs no provider sync. Dispatch
selection rotates across workspaces, workspace and connection concurrency are
bounded, provider admission is coordinated transactionally, and the sweeper
recovers undispatched, stale-dispatch, expired-lease, retry, and dead-letter work.

Webhook rows retain only bounded hashes and safe metadata. Persisted provider
mapping authority, never webhook-provided workspace identity, determines scope.
Raw bodies and source payloads are rejected from the ledger.

## Runtime Boundaries

The connector-broker contract may lease provider tasks and call a credential
broker, but it receives no broad private DML, model credential, or direct KPI
mutation authority. The deterministic runtime has no provider credential or
provider-egress authority. The ingress boundary cannot decrypt credentials or
mutate source/fact state.

The in-memory ledger and rate limiter are deterministic synthetic test oracles
only. They are not deployment authority; real runtime state is relational and
CAS-controlled.

Model-call count is zero. `promotionAuthorized` remains `false`. Existing
customer-visible upload, KPI, billing, legal, authentication, Preview, and
Production behavior is unchanged.

## Deferred Live-GCP Gate

Live GCP runtime verification remains blocked pending an explicitly isolated non-Production integrations project.

The active local project is retained document-processing Preview infrastructure,
not a disposable integrations project. Its ownership, billing isolation, IAM
authority, and complete cleanup boundary are not established for Phase 6. No GCP
resource may be created there for this verification.

Before any real provider credential, OAuth authorization, or Production
integration runtime may be used, the Phase 5 KMS, Secret Manager, IAM, rotation,
audit-log, environment-isolation, and cleanup gate must pass in explicitly
isolated non-Production GCP resources. Phase 6 must additionally validate private
Cloud Run authentication, exact OIDC audience and service identity, unauthorized
caller denial, Cloud Tasks redelivery/idempotency, bounded retry, queue
rate/concurrency configuration, and complete resource cleanup.

## Phase 8 Gates

Phase 6 deliberately does not change merged foundation contracts to solve later
provider concerns:

- Phase 4 sync runs currently admit only `synthetic_verification`, `manual`, and
  `recovery`; webhook and scheduled work remain task-only until compatible
  control-plane semantics are approved.
- Phase 5 credential environments and Phase 7 QBO environments do not yet share
  a sandbox vocabulary.
- Phase 5 has no narrow normal provider-read credential lease; its refresh lease
  must not be repurposed.
- Phase 1 still defers real provider-source commit authority, and QBO webhook
  signature verification remains a future broker-boundary responsibility.

These gates block Phase 8 and any live provider runtime. They do not authorize a
QuickBooks connection, provider endpoint, credential, queue, Cloud Run service,
Scheduler job, customer UI, Business State Delta, AI routing, or KPI promotion.
