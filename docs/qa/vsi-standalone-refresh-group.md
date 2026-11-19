# Standalone connector refresh — isolated implementation

This extends PR #571 after the six reporting connectors. The code is dormant
until its migration, deployment scope and individual owner consent are present.
No Production deployment, hosted migration, provider record change or model call
is part of this receipt.

## Behavior implemented

Loyverse, Zoho Books and Wix Orders now share atomic manual/scheduled admission
and the original complete-window parsers and commit functions. Explicit owner
consent authorizes a daily refresh of the last seven completed UTC dates:

| Connector | Supported recurring window | Meaning retained |
| --- | --- | --- |
| Loyverse | Receipt **creation** timestamps | Receipt date may differ; SALE/REFUND sign, cancellation, verified currency and tax remain separate. No accounting-revenue or cash-flow equivalence. |
| Zoho Books | Invoice and expense dates | Supported US/USD and document eligibility rules remain; outstanding is balance at import, not collections or profit. |
| Wix Orders | Approved order creation timestamps | Provider order amount/status; PAID does not establish settlement or accounting revenue. |

Older imports remain available with their original observed timing. Corrections
outside the recurring window require a supported historical import. The cadence
cannot reconstruct records that the provider does not expose.

The new service-only functions require current owner membership, a nondeleted,
nonbanned authorizer, the existing workspace billing rule, current connection
identity and a matching unexpired lease. Disabling consent, changing the source
identity or disconnecting fences scheduled commits. Renewal token writes carry
the same lease and authority checks. The original complete-window SQL validation
is retained behind nonpublic functions with caller execution revoked.

Manual and scheduled work shares a four-active, one-per-workspace database
admission limit: nine reporting/import connectors at this increment, extended
to all ten with the completed Square overlay. Sheets and QuickBooks retain
their existing separate admission. The standalone cron
runs at most twenty candidates with two local workers and a 240-second work
window, leaving cleanup time within its 300-second route budget. Provider
pagination remains bounded by the existing adapters. A partial page sequence
never becomes a replacement snapshot. Retry-After and capped exponential retry
state prevent immediate manual or timer bypass; expired leases are recovered.

## Activation and compatibility

Required server-only deployment variables are
`IMPORT_AUTOMATIC_REFRESH_ENABLED`,
`IMPORT_AUTOMATIC_REFRESH_WORKSPACE_IDS`, and
`IMPORT_AUTOMATIC_REFRESH_PROVIDERS`. Empty/wildcard scope does not mean all
workspaces. The provider's existing configuration must also be valid. The route
`/api/integrations/imports/scheduled-sync` requires the existing scheduler secret.
No variable was set and no timer was activated during this work.

Apply `20261117012702_import_recurring_refresh.sql` only after its reporting
recurring dependency and existing connector/history schema have been reviewed
on the exact target. This migration is **not applied here**. The new sync route
needs these RPCs; it must not be released ahead of its migration. Existing pages
continue showing saved data/manual controls when new status columns are absent.
An in-flight old manual lease retains its original apply validation during the
migration/deployment transition. Do not describe that compatibility as recurring
consent or use an old app deployment as an unattended worker.

The settings show last successful import, scheduled/retry time, explicit owner
renewal, and paused/revoked/unknown authorization. Turning recurring access off
remains available when provider configuration is paused. Display uses the
workspace time zone and daylight-saving rules already used by reporting pages.

## Local verification

The standalone suite passed **36 tests**, the reporting suite passed **33**,
and the existing historical-import suite passed **59**. Targeted lint, TypeScript
and whitespace checks passed. Exact-head CI is reported separately in PR #571;
local results do not imply CI or hosted execution has passed.

- Actual scheduler → existing provider parsers → actual SQL claim/atomic commit
  → existing reviewed legacy mapping/capture/reopen → VSI typed facts and checked
  three-source citations. Two successful ticks change source hashes while keeping
  the same reviewed source/entity mapping; old source references report changed.
- Separate incomplete-page, duplicate-record and HTTP 429 ticks preserve prior
  content hashes and freshness. A revoked source cannot reopen; another actor or
  workspace cannot capture the source. No overlapping monetary sources are added.
- Service-only SQL, manual/scheduled mutual exclusion, shared nine-provider
  capacity at this increment (extended to ten by the Square overlay),
  consent/owner/billing revocation, token-write fences, retry/recovery
  and existing historical windows are exercised in isolated PGlite databases.
- Settings POST routes check signed-in owner, fixed provider, server-selected
  workspace, strict origin/form, explicit confirmation and scoped activation.
- Browser fixtures exercise all three pages at 1280px, 390px and 320px, keyboard
  and touch controls, renewal, paused/revoked states, retained data, backoff,
  missing new schema and timezone display. Existing reporting and historical
  import browser suites remain part of verification.

These tests use controlled HTTP responses and synthetic identity/session
fixtures. They do not prove hosted Auth/PostgREST, real provider arrival, live
scheduler execution, multi-backend races or a Luna-generated answer. The source
readers and typed projection are real; the rendered composition is a checked
fixture, not a showcase model response. Model/provider testing spend: **$0**.

## All twelve remain in scope

See `vsi-cross-integration-coverage-2026-11-16.md` for the full connector matrix.
Sheets and QuickBooks already have unattended paths; their current hosted proof
limits remain explicit. Six reporting and these three standalone paths are local
candidates. The completed [Square group](vsi-square-refresh-group.md) adds its
own consented recurring authority around the existing atomic read cores; manual
operations retain their live owner/session checks. Its guarded incremental overlay
must precede application deployment. All twelve paths are implemented locally,
while shared VSI gates remain off. Hosted automatic-arrival and paid-answer
qualification is still separate from this local implementation.
