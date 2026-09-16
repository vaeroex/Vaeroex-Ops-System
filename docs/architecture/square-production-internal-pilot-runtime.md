# Square Production internal-pilot database runtime

Migration `20260902191325_square_production_internal_pilot_runtime.sql` is a
Production-only, one-seller internal-pilot database contract. It is adjacent to
the exact 103-migration Production ledger ending at the reviewed Square overlay
`20260902191324`; it does not import the Sandbox migration chain or legacy
Square account tables.

This migration is repository-only and unapplied until its own reviewed change
is merged and a separate, bounded Production database action is authorized.
The broader internal-pilot package is a dependent workstream and must pin the
final reviewed bytes of this migration before either can be treated as ready.

The migration creates eight empty, private, `FORCE ROW LEVEL SECURITY` tables
and four checked RPCs for the exact OAuth, broker, manual runtime, and sanitized
evidence LOGIN profiles. Scheduler and webhook authorities receive no runtime
RPC. Direct table and column access remains absent. A postgres-only permit
installer binds one workspace, business entity, operator session, expected
seller, expected location, generation, and configuration fingerprint before an
internal consent flow can begin.

The callback/broker recovery contract distinguishes three receipts:

- `reconcile_state` uses only the pre-call state hash and consume-request
  fingerprint when the state-consume response was lost.
- `reconcile_acquire` uses only the known state ID and exchange-request
  fingerprint when the database acquire response was lost. It returns a
  durable exchange ID and exchange-receipt fingerprint only while the exact
  acquisition remains safe to continue, or the already-stored credential
  receipt. An uncertain acquisition fails closed.
- `reconcile_exchange` is a later boundary and requires the DB-generated
  exchange ID and exchange-receipt fingerprint in addition to the state ID and
  request fingerprint. It never substitutes for `reconcile_acquire`.

No row, LOGIN, credential value, provider call, provider response, allowlist,
mapping, scan, webhook, scheduled task, economic fact, or AI work is created by
the migration. Every general Square activation flag must remain false. The only
manual runtime slice is one bounded Payments page with minimized non-economic
observations and no continuation. QBO objects and behavior remain unchanged.

Required qualification is the static contract test, the PostgreSQL catalog
test, and the native disposable PostgreSQL lifecycle runner. Hosted or remote
application remains a separate decision after exact-head review; local passing
tests are not evidence that this migration was applied to Production.
