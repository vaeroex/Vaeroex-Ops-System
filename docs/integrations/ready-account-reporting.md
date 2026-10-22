# Ready-account reporting plug-ins

The baseline six-provider release was deployed through [PR #520](https://github.com/vaeroex/Vaeroex-Ops-System/pull/520), and all six designated test connections completed read-only reports on October 19, 2026. Historical import controls described here require the additional migrations in [historical imports](historical-imports.md); their release is tracked separately. A developer account or registered OAuth application alone is not a connected Executive Intelligence workspace.

## Implemented behavior

Workspace owners can authorize a provider or enter an API key, explicitly select one account, manually sync a report, and disconnect/remove stored credentials and the report. Existing Square, QuickBooks, Sheets, Zoho Books, Loyverse, and Wix paths remain independent. Reports appear in the workspace Plug-ins area using its existing components.

| Plug-in | Authentication | Report | Important boundary |
|---|---|---|---|
| Xero | Authorization code + offline refresh | Selected invoice dates, retained across imports: approved/paid sales invoices and purchase bills by currency; balances observed when imported | No journals, bank transactions, payroll, payments or financial writes. Invoice totals are not cash revenue or profit. |
| Harvest | Registered multi-account OAuth app, Harvest product only | Completed entry count, tracked hours, billable hours; running entries excluded | Access follows authorizing user's role; Harvest's grant is broader than read-only. No rates, employee names or notes persisted. |
| Zoho Inventory | U.S. OAuth | Current active inventory item count and low-stock item count | Separate scopes/data from Zoho Books. No adjustments or order writes. Counts are not inventory valuation. |
| Clockify | Owner-supplied API key | Key owner's entries/hours in a selected workspace, filtered by entry-start date in UTC and retained across imports | Personal time coverage, not workforce payroll. Key may permit broader actions than this reader. |
| Toggl 2.0 | Owner-supplied `toggl_sk_` bearer key plus organization/workspace IDs | Visible active project count and lifetime tracked hours for those projects | Focus API, not legacy Track. Not a weekly timesheet. One active key per Toggl user; this code never generates/replaces one. |
| Katana | Owner-supplied private API key | Current variant/location stock records and records whose on-hand less committed stock is nonpositive | No public OAuth partnership claim. Mixed units are not added together. Factory metadata has no account ID; the immutable key binds the account for the life of the connection. |

Xero and Harvest reports use provider calendar dates. The UI labels the current date as partial; these are not workspace-local business-day KPIs. Clockify and Zoho Inventory saved summaries may be retrieved by VSI as explicitly limited reported context, with source links and coverage metadata. Clockify remains key-owner time only; Zoho remains current stock counts only. Reports are **not** promoted to model training, canonical financial KPIs, Business Health, or combined accounting revenue. This avoids double-counting when an owner also connects QuickBooks or Zoho Books. Provider-specific report admission into wider intelligence is a separate change.

## Secure configuration

Apply `supabase/migrations/20261019001207_ready_account_reporting_connectors.sql` through the normal reviewed production migration process before enabling a provider. The migration was created with `supabase migration new`; database behavior is tested locally with PGlite. It does not alter existing connector tables.

Existing server-only environment requirements: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

Additional server-only secret: `REPORTING_CONNECTOR_TOKEN_KEY`, a canonical base64 encoding of 32 cryptographically random bytes. Provision it through the approved secret store; do not paste credentials into chat, source, PRs or logs. Retain this key while connections exist; replacing it makes existing ciphertext unreadable and requires reconnection.

| Provider | Enable only after configuration/qualification | OAuth credentials |
|---|---|---|
| Xero | `XERO_REPORTING_ENABLED=true` | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` |
| Harvest | `HARVEST_REPORTING_ENABLED=true` | `HARVEST_CLIENT_ID`, `HARVEST_CLIENT_SECRET` |
| Zoho Inventory | `ZOHO_INVENTORY_REPORTING_ENABLED=true` | `ZOHO_INVENTORY_CLIENT_ID`, `ZOHO_INVENTORY_CLIENT_SECRET` |
| Clockify | `CLOCKIFY_REPORTING_ENABLED=true` | None; owner enters a key directly in the workspace form |
| Toggl 2.0 | `TOGGL_REPORTING_ENABLED=true` | None; owner enters a key directly in the workspace form |
| Katana | `KATANA_REPORTING_ENABLED=true` | None; owner enters a key directly in the workspace form |

Do not set any credential variable with a `NEXT_PUBLIC_` prefix. Do not reuse the Zoho Books token or request additional Inventory scopes silently. If reusing its developer client, register the Inventory callback explicitly and obtain separate Inventory consent; this implementation maintains separate connection records and encrypted tokens.

Exact registered callbacks:

- `https://www.vaeroex.com/api/integrations/xero/callback`
- `https://www.vaeroex.com/api/integrations/harvest/callback`
- `https://www.vaeroex.com/api/integrations/zoho-inventory/callback`

No arbitrary deployment URL is accepted. This deliberately requires the canonical production origin for OAuth and mutation requests. Use a controlled test deployment with the canonical host in HTTP-boundary tests; do not casually add wildcard callbacks.

Xero scopes: `offline_access accounting.settings.read accounting.invoices.read` (granular invoice scope for the new developer app). Zoho scopes: `ZohoInventory.settings.READ,ZohoInventory.items.READ`. Harvest product access is configured on its registered app. Recheck scopes in each provider consent screen before completing a live grant.

## Storage and failure behavior

- `reporting_connections`: workspace/provider/account identity, legacy numeric summary, status and sync metadata. `reporting_history_facts` stores minimized provider IDs/date/numeric contributions for Xero, Harvest and Clockify; `reporting_history_days` records imported date coverage and persistent cutoffs. RLS permits active members of that workspace to read. Clients cannot write.
- `reporting_credentials`: AES-256-GCM ciphertext, authenticated with provider + workspace + connection + format version. No client access. Discovered account choices are encrypted and only shown to the initiating owner; only the chosen account remains after selection.
- `reporting_oauth_states`: random state hashes, bound to workspace, provider, initiating user and connection, ten-minute expiry, atomic single consumption. No client access.
- All mutating routes require current owner access through the existing subscription/workspace guard and check the canonical request Origin/Host. Callback checks the original workspace and actor before consuming state.
- OAuth connect returns a standalone same-origin document using Square's existing fixed, hash-authorized navigation script. Exact Next header rules protect only the Xero, Harvest and Zoho Inventory connect documents; the global form-action restriction and provider allowlists remain unchanged. This avoids the browser blocking a native form's cross-origin 303 after its pending connection was created. Optimized Next/Chromium qualification reproduces that failure and checks the repaired navigation, no-referrer policy, script-hash enforcement and unaffected neighboring routes without contacting providers.
- Account selection is one-time. Changing accounts requires an explicit disconnect and new connection; old reports cannot be silently attributed to a different account.
- Database functions have empty search paths, explicit service-role checks and no public/anon/authenticated execute grants. Credential refresh and disconnect take the same connection lock.
- Sync lease: 65 seconds; provider request budget: 45 seconds, at most 12 fixed-host GET requests, 4 MiB per response. No automatic retries or paid quota upgrades. Manual sync is limited to once per hour, including failed attempts.
- All pages must complete within bounds before an import is committed. A selected date window is replaced atomically, matching IDs are upserted across that connection, and other windows remain. Duplicate IDs, malformed values, quota errors, oversized results, expired leases or disconnects prevent a partial import. On an ambiguous database response, check saved history and import time before retrying.
- Disconnect erases the local credential, account selection, state, legacy report, historical facts and coverage. Signing out does not erase them. The provider's own permission/key must separately be revoked in its settings; the UI says this explicitly. Disabling an enable flag does not block local disconnect.

## Qualification and release

Automated checks:

- `pnpm test:reporting-connectors`: provider fixtures, transport limits, encryption, OAuth/CSRF/owner/actor boundaries and local database isolation/concurrency/erasure.
- `pnpm test:reporting-connectors:oauth-browser`: isolated optimized Next wire headers and actual native-form navigation under both global CSP modes, with synthetic provider destinations intercepted.
- `pnpm typecheck`
- Focused ESLint on changed files.
- Existing Loyverse/Zoho Books database tests and integration UI regression tests.
- Production build, plus rendered owner/member/connected UI checks.

Before live activation, finish secure secret provisioning, apply the migration, deploy the reviewed code and complete provider consent/key entry from the intended workspace owner account. Qualify each provider using a synthetic/demo account where supported: connect, select, sync an empty and a known nonempty report, compare totals against the provider, verify the identity and reporting period, disconnect, and confirm stored data disappears. Provider fixture tests do not establish live API approval or a successful customer connection.

The designated Xero demo, Harvest, Zoho Inventory test, Clockify, Toggl 2.0 and Katana accounts were connected in the baseline release. Existing credentials and grants are reused by historical imports; no new scopes or paid provider plans are requested. FreeAgent login and the Jibble/Planday/Paychex partner decisions are outside this release.

Rollback: disable the affected provider's `_REPORTING_ENABLED` flag. Keep the encryption key until owners disconnect, so credentials remain decryptable. The local disconnect route does not require provider OAuth settings. Retain the additive database schema for erasure and audit of connection status; do not delete other providers' data or secrets.

## Primary API references inspected

- [Xero accounting OpenAPI](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml), [scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/)
- [Harvest OAuth and account discovery](https://help.getharvest.com/api-v2/authentication-api/authentication/authentication/), [time entries](https://help.getharvest.com/api-v2/timesheets-api/timesheets/time-entries/)
- [Zoho Inventory organizations](https://www.zoho.com/inventory/api/v1/organizations/), [items](https://www.zoho.com/inventory/api/v1/items/)
- [Clockify API](https://docs.clockify.me/)
- [Toggl 2.0 authentication](https://engineering.toggl.com/docs/focus/start/authentication/), [project API](https://engineering.toggl.com/docs/focus/api/projects/)
- [Katana factory](https://developer.katanamrp.com/reference/getfactory), [inventory](https://developer.katanamrp.com/reference/list-current-inventory), [pagination](https://developer.katanamrp.com/reference/api-pagination)
