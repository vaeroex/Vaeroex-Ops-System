# Google Sheets connection

Vaeroex Executive Intelligence reads selected spreadsheet columns after a workspace owner grants Google consent and approves their field mapping. The connector is disabled until configuration and migrations are complete. It never writes to Google Sheets and does not use Google Drive.

## Verified production callback

```text
https://www.vaeroex.com/api/integrations/google-sheets/callback
```

On October 2, 2026 UTC, the public `vaeroex.com` host returned a redirect to `www.vaeroex.com`; the current production application and Square connector also use `https://www.vaeroex.com`. Register the callback above exactly, including `www`, without a trailing slash. This implementation derives its origin from the explicit Sheets redirect URI and validates the production origin against the application's canonical public origin.

**Preserve `NEXT_PUBLIC_APP_URL`.** Sheets setup does not require changing this existing variable or any Square/QuickBooks credentials. The existing Vercel entry is write-only, so its value was not revealed or replaced during inspection.

## Google Auth Platform

Use the existing project **Vaeroex Prod Integrations** (`vaeroex-integrations-prod`). The Sheets API is already enabled. The owner has reported configuring External/Testing access, the designated test user, the read-only scope, and the Web application client with the callback above. Review the existing configuration using the checklist below; do not create a duplicate OAuth client. Live consent remains to be verified.

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview?project=vaeroex-integrations-prod) using the authorized Vaeroex Google account.
2. **Branding:** use the customer-facing name **Vaeroex Executive Intelligence**, an actively monitored support email, the public home page `https://www.vaeroex.com`, the application's published privacy policy and terms, and developer contact information. Add `vaeroex.com` as an authorized domain and complete domain ownership verification if Google requests it. Preserve existing brand settings if another integration has configured them since inspection.
3. **Audience:** choose **External** for customer Google accounts. Start in **Testing** and add each designated test account. A Vaeroex sign-in and a Google test-user entry are separate requirements.
4. **Data Access:** add only `https://www.googleapis.com/auth/spreadsheets.readonly`. Do not add Drive scopes, Sheets write access, email, profile, or OpenID scopes. The permission is classified as sensitive. It grants read access to spreadsheets the consenting Google account can access; Vaeroex restricts its requests to the configured spreadsheet ID, tab, and selected columns. Google does not offer a narrower read-only scope restricted to a pasted spreadsheet URL.
5. **Clients:** select the configured OAuth client of type **Web application**. Confirm the exact callback above under **Authorized redirect URIs**. No JavaScript origin is required by this server-side authorization-code flow. Keep other integrations' clients and callbacks unchanged.
6. Store the client ID and client secret through protected server environment configuration. Never paste a client secret, token, encryption key, or credential JSON in chat, an issue, a commit, or browser-visible code.
7. Complete customer Google consent from Vaeroex. The application requests offline access and consent, allowing the server to refresh tokens for automatic reads. Account permissions and Workspace administrator restrictions still apply.

In External **Testing**, refresh tokens for this Sheets scope normally expire after **seven days**. The owner must reconnect when that happens. Testing therefore cannot prove indefinite automatic refresh. For broad customer use, move through Google's branding/domain and sensitive-scope verification requirements, provide the requested scope-use explanation and demonstration video, and address the verification findings. Publishing status alone does not make an application verified. Google may apply unverified-app warnings and user caps until verification is complete. Refresh tokens can also be revoked or expire for other reasons after verification.

Official references: [configure consent and scopes](https://developers.google.com/workspace/guides/configure-oauth-consent), [Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes), [token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

## Server configuration

Configure these on the existing Vaeroex Vercel project. Credentials and encryption keys belong only to their intended deployment environment; do not copy production secrets into untrusted previews.

| Name | Required value or purpose |
| --- | --- |
| `GOOGLE_SHEETS_ENABLED` | Keep `false` until migrations, credentials, and the redirect are verified; `true` opens the connector. |
| `GOOGLE_SHEETS_CLIENT_ID` | Google Web application OAuth client ID. |
| `GOOGLE_SHEETS_CLIENT_SECRET` | Secret for that same OAuth client. Server only. |
| `GOOGLE_SHEETS_REDIRECT_URI` | `https://www.vaeroex.com/api/integrations/google-sheets/callback` |
| `GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY` | Canonical Base64 encoding of 32 cryptographically random bytes. Server only; retain a secure recovery copy. |
| `CRON_SECRET` | Existing platform scheduler bearer secret, at least 32 characters. Configure privately if absent; preserve an existing suitable value. |

The existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` remain required by the application. None of the new secret variables may have a `NEXT_PUBLIC_` prefix. Generate encryption material privately, for example with `openssl rand -base64 32`, and store it directly in the protected environment/secret manager. Replacing the key without re-encrypting stored tokens prevents decryption; retain it during rollback.

## Customer flow and data admission

1. A signed-in workspace owner chooses an active business entity and a connection name, then authorizes Google. If needed, **Add business entity** creates one through the existing authenticated workspace RPC after explicit confirmation. The owner can edit its name, type, currency, time zone, and fiscal start month before creation. Expiring single-use state is bound to that owner, signed session, workspace, and connection generation.
2. Paste a `https://docs.google.com/spreadsheets/d/.../edit` URL. Vaeroex validates the ID and uses fixed Google API destinations.
3. Select a grid tab and its header row (1–25). Discovery considers the first 100 columns. Changing the spreadsheet, tab, or headers invalidates the previous mapping approval.
4. Select a stable, unique row-ID column, a date column and explicit date format, optional business location, and up to 12 numeric metrics. Select each metric's name, category, unit, and optional target. Use one row per metric date and location; repeated metric/date/location combinations are held for review. Preview the selected columns before approving. Use business-only row IDs; arbitrary row-ID text is hashed before persistence.
5. Approve the source mapping and choose whether to enable **Refresh every 15 minutes**. **Sync now** remains available when automatic refresh is off. This authorizes deterministic validation of future values under the saved mapping; it does not admit arbitrary spreadsheet text as truth.
6. Select **Sync now**. The status displays read rows, admitted metrics, rejected rows, held conflicts, the last successful sync, and recent runs. Admitted KPI observations flow through the application's existing active KPI reader into Executive Intelligence. Source identity, immutable version, connection, tab, row, mapping approval, business entity, and location remain in provenance. Metric display names include the business entity and a stable entity suffix so separate entities do not merge into one trend.
7. Custom metric names may need a confirmed performance direction. In **Performance**, select the metric, open **Chart settings**, choose its direction under **Performance meaning**, and select **Save chart and performance settings**. Repeat for each location series that needs confirmation, then reload **Intelligence**. Findings appear when the available observations support the existing evaluation thresholds.

Dates accept unambiguous ISO `YYYY-MM-DD` text or explicitly selected Google serial dates. Numbers are read as unformatted numeric values; ambiguous formatted text is rejected. Percent mappings distinguish percentage points (`25` means 25%) from fraction values such as Google-formatted percentages (`0.25` means 25%). Percentage targets are entered in percentage points, including when source cells store fractions. Currency and counts require the appropriate numeric meaning. A single row with an invalid mapped value is held rather than partially admitted. Duplicate stable row IDs fail the whole read.

The source-authority rule holds same-name/date observations that overlap another current source, duplicate metric/date/location rows, and conflicting accepted accounting money for the business entity/period. Resolve the conflicting source or correct the mapping, then sync again. It never sums conflicting sources. Google Sheets source versions retain `untrusted_external_input`; the separate approved/validated KPI projection is what Executive Intelligence consumes. This follows the existing spreadsheet KPI path rather than impersonating QuickBooks accounting canonical facts.

## Bounds, refresh, and recovery

- One configured spreadsheet/tab per connection; up to 100 tabs and 100 header columns discovered.
- Up to 10,000 data rows below the header and 15,000 numeric observations per complete sync. The row bound includes allocated empty rows below the header; remove unused excess rows or select a smaller report tab when needed. Reports above the limit fail explicitly without truncation.
- Reads use bounded batches and responses. A verification read detects changes during paging before replacing the current projection. A failed or incomplete read preserves the prior projection.
- Stable row identity and source fingerprints make unchanged imports idempotent. Edits create immutable versions and update the same KPI projection; reordering rows does not duplicate them. A completed consistent snapshot can retire rows no longer present.
- A single database lease prevents overlapping manual and scheduled syncs. The existing Vercel project receives an authenticated scheduler tick every 15 minutes. Each tick selects approved connections with automatic refresh enabled and a due next-run time, oldest due first. It starts at most 50 connections in five fresh batches of 10. All connections share a 240-second deadline for provider reads, token refresh, and database work; cleanup/backoff is bounded at 285 seconds within the route's 300-second limit. An already submitted atomic commit remains authoritative if its acknowledgement is lost, so check the latest run result before retrying a timeout. Connections left in the backlog remain due for a later tick. Successful connections become due at the next quarter-hour tick; failed or interrupted runs wait one hour before becoming eligible again. The 15-minute setting is a target polling cadence, and queue backlog, provider delays, authorization failures, or runtime interruptions can delay completion. **Sync now** is available between automatic runs. No per-customer infrastructure is created.
- Tokens are AES-256-GCM encrypted with authenticated workspace, connection, generation, version, provider, scope, and origin context. Refresh uses a separate lease and compare-and-set storage. Invalid authorization requires reconnect.
- Disconnect fences further reads and retires the current projection. It retains immutable source history. Google can revoke other grants for the same account and OAuth client; other Sheets connections using that account may need to reconnect. Failed Google revocation remains visibly pending and must be retried; it is not reported as completed. When an OAuth exchange outcome is unknown, the initiating owner must remove Vaeroex access in their Google Account connection controls and explicitly confirm that removal after the request lease expires. Recovery records their attestation and resets the local connection; it does not claim Google revocation was independently verified.

Do not connect patient records, regulated healthcare data, SSNs, medical record numbers, insurance identifiers, or other prohibited data. Header filtering is a guard, not a substitute for choosing an appropriate business report.

## Verification and release

Use the repository's pinned pnpm and Node version, unchanged lockfile, normal typecheck/build/lint, `test:google-sheets`, and `test:google-sheets-ui`. See [the verification record](google-sheets-verification.md) for completed checks and remaining live-test limits. The tests cover the actual SQL lifecycle and admission transactions as well as OAuth/crypto/provider behavior and desktop/mobile components. Synthetic tests do not substitute for real Google consent.

Migrations, in order:

- `20261002040024_google_sheets_complete.sql`
- `20261002040031_google_sheets_lifecycle.sql`

Use the repository's production migration staging/ledger procedure. First reconcile the live ledger and catalog read-only; do not run a broad migration push that includes unapplied sandbox history. If an apply acknowledgment is uncertain, inspect ledger/catalog before retrying. Keep the gate false through code review, migration, and deployment verification.

For the authorized live test, use the existing signed-in administrator account and current workspace, a separate named test connection/business entity, unique test metric names, and the non-sensitive test spreadsheet. Do not create another workspace or accept agreements on the user’s behalf. Complete consent, discover headers, preview and approve mapping, sync, and verify the admitted KPI and its provenance in Executive Intelligence. Repeat unchanged, edit an existing stable-ID row, try an invalid value, and verify recovery without duplicates. Confirm scheduler authentication/due behavior, then disconnect the test connection. Record the deployed commit, migration identities, gate state, and any verification limitations before enabling customer use.
