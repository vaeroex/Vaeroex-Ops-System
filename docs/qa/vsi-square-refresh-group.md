# Square recurring refresh — isolated implementation

Square now has a default-off recurring path built on the current customer
backend. It does not revive the retired native login/broker/provisioner or change
provider scopes, merchant mappings, credential encryption or the Production-only
customer-backend gate. No hosted configuration or database was changed.

## Authority and supported work

An active workspace owner confirms recurring access through Square settings.
The consent binds the existing connection, merchant/location, Business Entity
and current owner. Subsequent work rechecks that owner, user status, entity,
billing eligibility, backend configuration, connection identity and exact lease
before provider dispatch and before commit. It does not manufacture a browser
session. Interactive operations retain their original live owner/session checks.

New update windows run hourly, using the existing five-minute overlap, initial
30-day window and maximum 31-day catch-up windows. A tick processes at most four
validated pages per connection, with at most 100 payment records per page. The
saved cursor and its original binding survive a bounded stop. A completed-page
receipt is progress; only the final page advances the completed-window timestamp
and checkpoint. An unfinished manual historical read pauses automatic work until
the owner finishes it. No historical reconstruction or settlement claim is added.

Manual and scheduled Square read admission shares the four-active,
one-per-workspace limit with the nine reporting/import connectors. Sheets and
QuickBooks keep their own existing worker admission. The Square dispatcher has
its own 240-second work / 285-second cleanup window, two local workers, twenty
candidate ceiling and a 300-second route budget. Each page has a bounded deadline.
Provider Retry-After applies to both automatic and interactive reads; automatic
failures additionally use capped retry delay and expired-lease recovery.

The new service-only scheduled RPC calls the same extracted atomic page and
credential-CAS validation core as interactive reads. The original interactive
backend still checks its live owner/session through reconciliation before that
core is reached. Disabling recurring consent fences its active lease; disconnect
retains the existing local fence and seller revocation behavior. Valid previously
committed pages remain stored on later failure. Partial results retain unknown
record coverage and do not become a complete accounting total.

## Required release order — no app-only rollout

The new server code **requires the matching Square overlay before application
deployment**. UI fallback when the status RPC is absent preserves presentation
only; it is not full runtime backward compatibility. In particular, the old
backend does not accept the new bounded Retry-After field on manual failure.
Do not deploy the changed manual read path against that old backend or retry an
ambiguous mutation with a different payload.

1. Review the exact target schema and apply the two reporting/import increments
   after their existing prerequisites. No blind canonical migration upgrade.
2. Review and apply only
   `supabase/production-migrations/20261117014116_square_customer_recurring_refresh.sql`
   on the approved compatible target. This is an incremental, initially dormant
   package. It verifies PostgreSQL 17, exact existing function definition hashes,
   ACLs, private FORCE RLS and the lease constraint shape. It does not replay the
   old 105-migration bootstrap or enable backend configuration.
3. Verify the public wrappers, private-core grants, recurring columns, shared
   ten-connector capacity view and original interactive/read/disconnect behavior.
   Then deploy the exact application candidate. No deployment occurred here.
4. Recurring execution still requires `SQUARE_AUTOMATIC_REFRESH_ENABLED=true`,
   an explicit `SQUARE_AUTOMATIC_REFRESH_WORKSPACE_IDS` list, the unchanged
   `SQUARE_CUSTOMER_BACKEND_ENABLED`/Production environment, current backend
   configuration, scheduler authentication and individual consent. These were
   not set or changed by this work.

The cron endpoint is `/api/integrations/square/scheduled-sync`; it returns inert
when the existing backend or the additional scope is closed. A regular Preview
cannot satisfy the existing Production-only Square gate. Any hosted Square
qualification therefore needs a separately reviewed exact staging arrangement;
pretending a Preview is Production or copying production credentials is excluded.

## Verification and limits

The controlled composition uses the real scheduler, encryption, provider parser,
atomic SQL functions, owner/session-protected typed source reader and VSI
projection. It checks a two-page completed scan, a changed payment amount/source
hash, rejection of obsolete references, a four-page stop and two-page resume,
unchanged completed timestamp during partial work, later-page 429 preservation
and 7200-second backoff, duplicate rejection, recovery, foreign workspace/viewer
denial, and actual manual disconnect invalidating dispatch and retrieval.

The runtime, actual-SQL composition, SQL authority/migration and settings tests
run in the focused suite. Existing provider/service/UI/browse-server tests also
pass locally. Browser fixtures cover 1280px, 390px and 320px, keyboard/touch
confirmation, owner renewal, paused status, retained payments, incomplete reads,
last completed ongoing refresh versus historical import timing, and missing new
status RPC. A native PostgreSQL increment regression is part of the existing
isolated CI database job; its result must be read at the final head.

Provider HTTP is synthetic. PGlite uses a single backend; passing local capacity
checks are not a claim of new multi-session race qualification. No real merchant
records, hosted timer, actual provider import or Luna response is established by
this test. Additional model/provider test spend is **$0**. Shared VSI gates remain
closed; the complete all-twelve matrix and hosted acceptance plan remain separate.
