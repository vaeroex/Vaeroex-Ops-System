# Square settings and saved-payment browsing

## Scope

This change simplifies the existing Square customer page. It does not change
consent, mapping, import, renewal, disconnect, credential storage or activation.
The existing mutation forms and their eligibility conditions are retained.

- Direct `← Back to Settings` navigation uses `/app/settings`. The existing
  verified `vaeroex_workspace_id` cookie preserves the selected workspace.
- One current connection; previous connections and unused attempts are collapsed.
- Disconnect confirmation is inside Manage connection, then Disconnect Square.
- Payment IDs and exact UTC timestamps are in native expandable details.
- Display dates and saved-record filters use the Business Entity's timezone.
- Saved browsing has 25-row server pages, exact matching counts, and date/status
  filters applied before pagination. It never starts an import.
- Mobile rows keep date, amount, status and Details visible without horizontal
  scrolling. Desktop retains a four-column table.
- Existing historical import dates remain explicitly **UTC**, with their existing
  bounded request and checkpoint-preservation semantics.

## Additive database prerequisite (not applied)

`supabase/production-migrations/20260929052211_square_customer_payment_browse.sql`

SHA-256: `0684a93aad10aeca9f55b415dc5c9b505f608a8a2ed42c42161b81be4d069ef2`

The migration requires the exact 107-entry baseline ending at
`20260929041048`. It adds one stored-payment index and one service-role-only
read RPC. The RPC reuses the existing owner/session/workspace authorization,
returns only public connection/payment fields, and does not read seller secrets
or change existing functions, records, checkpoints or gates. The index supports
the workspace/connection/date/tie-break ordering used by pagination.

The UI remains compatible before this migration: existing saved-record previews
and connection controls remain available, with an explicit limited-preview
notice rather than claiming full-history filtering. No remote migration or
deployment was performed during this implementation.

## Verification

- 57 actual PostgreSQL 17.5 assertions through disposable PGlite, using the exact
  existing authority helpers and new migration. This is a minimal dependency
  fixture, not a claim that the full canonical CI baseline was run locally.
- 375 current-connection payments across 15 database pages: stable ordering,
  tied timestamps, no omissions/duplicates, filters before pagination, stale-page
  clamping, and 23/25-hour daylight-saving boundaries.
- 42 connection summaries, including a current connection older than the old
  32-connection status limit; safe current-context parity and preserved history.
- Tenant/owner/session rejection, closed table/function ACLs, unchanged backend
  function definition and saved-state/checkpoint snapshots.
- 31 UI tests, including 413 synthetic records across 17 rendered pages,
  responsive row layout, all connection states, unavailable-browse fallback,
  exact existing mutation-form fields and recovery/eligibility boundaries.
- 5 server/page tests: server-derived identity, read-only RPC binding, invalid
  filters, safe failure rendering, and selected-workspace cookie preservation.
- Existing Square provider/crypto and service/HTTP boundary suites passed.
- Full TypeScript no-emit and focused ESLint passed.

The existing CI workflow runs the new server tests. The canonical disposable
PostgreSQL qualification runner now applies the additive browse migration and
runs its SQL suite. Hosted exact-head CI was not run as part of these local results.

## Browser verification

`scripts/square-payments-ui-preview.cjs` renders the actual component with project
styles and the actual new SQL in an in-memory PostgreSQL fixture. Identity,
workspace, records and the Settings landing page are synthetic. All four write
endpoints return 405; there are no Production or provider calls.

Verified in the browser:

- All 15 pages: 375 unique payment IDs, 25 per page, final next link disabled.
- May 4 Los Angeles filters: 16 failed attempts, 33 completed payments; the
  completed result's second page has 8 rows and preserves both date/status filters.
- Empty results state the searched dates and timezone.
- Direct Settings navigation and return retain the selected demo workspace.
- A selected archived record appears in the single table without replacing the
  current connection or import target.
- Manage/Disconnect confirmation and payment details expand only on selection.
- At 390px viewport width, page and table fit; Details remains visible.
- No captured browser error logs.

Before screenshot: read-only capture of the existing customer page.
After screenshots: local synthetic preview, not a deployed customer result.

To reproduce the preview, provide an already-installed PGlite 17 module with
`--pglite /absolute/path/to/pglite/dist/index.js`; `--self-test` runs the bounded
HTTP/database checks and exits. No dependency is downloaded by the harness.
