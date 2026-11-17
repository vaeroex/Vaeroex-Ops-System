# Reporting refresh implementation group

Continues draft PR #571, `codex/vsi-bounded-qualification`, from main
`796ade18fde960c253b6023c29b182c9222c6f2f` and prior head
`7d105ddb182ce09bfdaa6e36090f84ca693466f9`. This is implemented local code,
not a claim that hosted unattended provider delivery or a new live-model answer
has been qualified. No production mutation, deployment, global gate activation,
provider record change, credential change, or paid model call was performed.

## Completed behavior

Xero, Harvest and Clockify can be explicitly authorized by a workspace owner to
refresh the **last seven completed UTC dates once daily**. Today, older dates,
and corrections outside that window remain available through the existing manual
import. Old invoice balances outside the window remain balances at their original
import, not current balances. The refresh does not claim complete historical coverage.

Toggl 2.0, Zoho Inventory and Katana can be explicitly authorized to refresh their
supported **current snapshot every six hours**. A new snapshot replaces the old
snapshot; it is not a historical series. Toggl hours remain lifetime totals of
visible active projects. Inventory counts do not become valuation, SKU profit,
historical stock, or explanations of shortages.

Connection settings show consent, last successful refresh, attempted/retry times,
stale evidence, failure preservation, and paused/unknown authorization. A current
owner can stop recurring access or explicitly renew a former owner's consent.
Members cannot change it. Existing manual imports and disconnect remain usable
on a database that has not received the new migration.

The dispatcher uses the existing parsers, credential envelope, and complete-page
atomic commits. It does not invoke a browser-only manual route. A tick selects at
most 20 due connections, runs at most two local workers, and never runs two from
one workspace together. SQL admits at most four active reporting leases across
all dispatchers/manual calls and one per workspace. Work stops launching with
less than 65 seconds left in the 240-second work window; cleanup is bounded to
285 seconds. Provider reads retain the existing 45-second and 12-request limits.
Pagination is completed and validated before committing; oversized windows fail
without replacing prior facts. This group does not add durable mid-page restart.

Successful commits schedule the next refresh. Failures use one-hour exponential
backoff capped at 24 hours and bounded provider `Retry-After`; the manual cooldown
also respects the delay. Expired scheduled or opted-in manual leases are recovered.
Lost responses and duplicate ticks cannot overwrite a newer lease. Disable,
disconnect, account replacement, owner removal/ban/deletion, or lost billing access
prevent scheduled commits and token writes. Disconnect retains the existing data
deletion behavior; merely turning off recurring access retains saved evidence.

## Rollout and schema

The new migration is
`supabase/migrations/20261117005822_reporting_recurring_refresh.sql`.
It defaults every connection to **off**. Original commit/token functions retain
their public signatures and delegate to their unchanged private implementations
after the new scheduled-authority check. The private implementations have no
client or service-role execute grant. The existing locked billing check is reused;
no exemption or role is created for scheduling.

The cron declaration `/api/integrations/reporting/scheduled-sync` runs every
15 minutes only after a future explicit deployment. It returns an inactive result
unless all three settings are valid:

- `REPORTING_AUTOMATIC_REFRESH_ENABLED=true`
- `REPORTING_AUTOMATIC_REFRESH_WORKSPACE_IDS`: explicit unique UUIDs, 1–100
- `REPORTING_AUTOMATIC_REFRESH_PROVIDERS`: explicit unique reporting provider keys, 1–6

No wildcard, empty-list-as-all, or implicit connection consent is accepted.
The route requires the existing `CRON_SECRET`; no secret is exposed in receipts.
Provider configuration is filtered before due selection to avoid starving
configured providers behind unconfigured candidates. This is a bounded rollout,
not a measured large-capacity claim. Main's automatic deployment hold is unchanged.

## Verification and its limits

- `pnpm test:reporting-recurring`: 31 tests, including 17 runtime, 13 SQL, and
  one combined scheduler-to-protected-source test. Runtime tests exercise all
  six actual provider parsers with controlled HTTP fixtures. SQL tests execute
  the migration, current billing functions, admission, commits, ACL/RLS, revocation,
  retries and lease recovery in PGlite.
- The combined test runs two successful scheduled ticks for Xero, Harvest and
  Katana through actual SQL writes, owner-confirmed bindings, unchanged protected
  capture/reopen readers, `sharedRow`, and checked cross-source citation rendering.
  A changed record produces a new hash under the same reviewed binding; reopening
  the former reference says `changed`. A subsequent failed tick leaves the new
  hash and freshness unchanged. A disconnected source and unauthorized actor or
  workspace are denied. It does not fabricate a model-written business conclusion.
- `pnpm test:reporting-connectors`: 38 existing tests retain manual parser, route,
  consent, history and database behavior.
- `pnpm test:reporting-recurring:browser`: all six providers at 1280, 390 and 320px,
  keyboard/touch consent, renewal, saved fixture reopening, role/status failures,
  schema-missing compatibility and workspace daylight-saving time display.
  The existing reporting browser suite also passes.
- TypeScript, targeted ESLint, full VSI regression and required CI are recorded
  in the PR at the final tested commit. The new recurring checks run in CI.

PGlite is a single backend. Its atomic-state tests are not multi-session lock
contention proof. The combined test uses controlled provider HTTP and synthetic
live-session verification; it is not Supabase Auth/PostgREST, OAuth, or real merchant
qualification. Browser fixtures are not authenticated hosted sessions. No new
provider/model claim is inferred from them. Model spend for this group: **$0**.

## Every connector remains in scope

| Connector | Unattended implementation at this head | Next concrete qualification or implementation |
| --- | --- | --- |
| Google Sheets | Existing opted-in 15-minute dispatcher, recovery and pilot controls | Controlled new row → real scheduled tick → protected source version; preserve pilot and provider data policy |
| QuickBooks Online | Existing GCP scheduler/dispatch/queue/runtime/recovery | Controlled sandbox/company record → worker → validated accounting version; read-only infrastructure check below is complete |
| Square | Still manual customer refresh; checkpoints and atomic upserts exist | Add explicit recurring consent and native scheduling using its own customer authority, then new-payment witness |
| Xero | New daily bounded reporting refresh, local verified | Isolated OAuth/test account qualification; document old balances outside seven-day window |
| Harvest | New daily bounded reporting refresh, local verified | Isolated visible-entry change, pagination/rate limits and source attribution |
| Clockify | New daily bounded own-entry refresh, local verified | Isolated completed-entry change; no workforce inference |
| Toggl 2.0 | New six-hour current snapshot refresh, local verified | Isolated visible-project change; retain lifetime-hours semantics |
| Zoho Inventory | New six-hour current snapshot refresh, local verified | Isolated current-item count change; no invented inventory history |
| Katana | New six-hour current snapshot refresh, local verified | Isolated variant/location change, credential incarnation and source revocation |
| Loyverse | Still manual bounded history importer | Next implementation group: recurring consent/admission around its existing receipt importer and merchant-currency authority |
| Zoho Books | Still manual bounded history importer | Same next group around its invoice/expense importer, USD/exclusion policy and organization authority |
| Wix Orders | Still manual bounded history importer | Same next group around its cursor/order importer and app-instance lifecycle |

All twelve protected VSI projections remain implemented behind the existing
release gates. This group changes ingestion; it does not silently release the
shared runtime or remove entity confirmation, retention, source eligibility,
model routing, quota, or accounting checks. Ordinary QBO/Square/Sheets retrieval
remains unchanged. See the full [coverage matrix](vsi-cross-integration-coverage-2026-11-16.md).

## QuickBooks read-only liveness receipt

After the owner restored the existing local Google Cloud session, inspection of
`vaeroex-qbo-prod-20260827`, `us-central1`, showed:

- `qbo-production-initialization`, `qbo-production-dispatch`, and
  `qbo-production-dispatch-interactive`: **ENABLED**, `*/5 * * * *`.
- Queue `qbo-production`: **RUNNING**, max concurrency 10, max rate 5/second.
- Credential broker, OAuth ingress, provider runtime, task dispatcher and task
  scheduler: all **Ready**.
- The 30 most recent request-status samples from 00:35–01:00 UTC on November 17
  were HTTP 200 for scheduler, dispatchers, broker and runtime.

Only names, state, timing, limits, revision readiness and numeric request statuses
were read. No payload, credential, company record or production setting was read
or changed. HTTP 200 can mean no eligible work; it does not prove a new provider
record reached VSI. The local reauthentication blocker is resolved.

## Next executable step

Implement the three standalone reporting importers (Loyverse, Zoho Books, Wix)
using their current atomic and revocation boundaries; then handle Square's native
authority separately. In parallel, finish the nonproduction compatibility and
scoped Preview read path identified in the [hosted packet](vsi-reporting-hosted-qualification.md).
Do not request a paid/provider-change campaign while those code/schema prerequisites
are unresolved. Deployment, temporary provider access and record mutations must
have exact reviewed targets. No production or broad activation is needed to
complete those independent implementation steps.
