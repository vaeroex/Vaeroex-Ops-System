# Historical plug-in imports

Xero, Harvest, Clockify, Zoho Books, Loyverse and Wix orders support chosen historical periods instead of a fixed seven-day report. This follows the existing Square pattern of importing older data separately from browsing saved records. Square and QuickBooks behavior is unchanged.

## Customer behavior

- Choose 30, 90 or 365 days, or enter older custom dates. An import contains at most 366 inclusive UTC calendar dates. There is no one-year lookback floor: older years can be imported in separate batches.
- Every provider page must finish within the existing request, time and record limits. Busy periods may need smaller batches. No incomplete response is committed and no paid quota or plan is enabled.
- A successful import replaces the selected period and upserts matching provider IDs. Saved periods outside it remain. Corrections and moved records returned by the provider update their prior contributions rather than being duplicated.
- Filter any date span of saved history, or view all saved history. Filters do not fetch provider data. PostgreSQL totals are computed before REST row limits.
- Coverage distinguishes missing dates, imported empty dates and partial dates. A date imported before its end stays marked partial until imported again. Saved records reflect each import's observation; they do not update automatically when the provider later changes.
- Signing out retains history. Explicit disconnect erases the relevant connection's history and credentials. Provider-side permission revocation remains a separate action.

## What the dates mean

| Provider | Inclusion date | Interpretation |
|---|---|---|
| Xero | Invoice/bill date | Approved/paid totals by currency. Outstanding amounts are balances observed when imported, not a historical balance sheet. Excluded-status records may be retained as zero contributions to correct moved IDs. |
| Harvest | `spent_date` | Completed time totals; running entries do not contribute hours. Access follows the authorizing user's visibility. |
| Clockify | Entry start in UTC | Key owner's entries only. A completed entry spanning midnight contributes its entire duration to its start date. |
| Zoho Books | Invoice/expense date | USD totals only; foreign amounts are counted as excluded. Outstanding means observed when imported. |
| Loyverse | Server `created_at` | May differ from back-office receipt dates. Provider availability controls accessible history; free back-office report history and API receipt access are distinct and longer free API history is not guaranteed. |
| Wix | Order `createdDate` | Approved order totals separated by currency. Provider search uses the documented `createdDate` field. |

Zoho Inventory and Katana remain current inventory snapshots. Toggl 2.0 remains active-project/lifetime totals. These providers cannot reconstruct earlier inventory state from the current endpoints.

Old generic seven-day aggregates remain visible separately because daily IDs cannot be recovered from totals. Old Books summaries are also separate until those dates are re-imported. Existing Loyverse rows lacking server creation time remain in all saved history with a warning; dates and coverage are not invented. Existing Wix facts remain saved without claiming a verified complete window.

## Release and recovery

This history release requires these additive migrations, created with the Supabase CLI, in order:

1. `20261019070945_reporting_import_history.sql`
2. `20261019070949_zoho_books_import_history.sql`
3. `20261019070953_loyverse_import_history.sql`
4. `20261019071008_wix_orders_import_history.sql`

Apply through the reviewed production migration process before deploying the new application code. The earlier reporting foundation and JWT-role compatibility migrations are already deployed and must not be rerun. The new migrations add history/coverage tables, one nullable Loyverse timestamp, read RPCs, and scoped import/disconnect functions; they do not import or erase existing customer records when applied.

Before release, inspect current function definitions/permissions and migration history, retain a targeted rollback snapshot, and verify the current backup status. Verify new function signatures, restricted write grants, membership RLS, and migration history after application. No new secrets, OAuth callbacks, customer grants or paid accounts are needed.

Do not roll back to the old Books/Loyverse/Wix sync code while allowing imports: the older functions/routes assumed rolling replacement and Loyverse lacked creation timestamps. Pause imports for the affected connector and retain the additive schema while a fix is prepared. Never drop saved history as a rollback step.

Verification commands: `pnpm test:plugin-import-history`, `pnpm test:plugin-import-history:browser`, `pnpm typecheck`, `pnpm lint`, and the normal production build/CI. Tests use synthetic providers and disposable local PostgreSQL, including overlap, corrections, deletion, empty periods, persistent partial days, currency isolation, tenant/lease rejection, disconnect erasure and more than 1,000 saved records. Provider fixture tests do not establish a customer's available historical depth or a paid entitlement.

## Provider references

- [Square payment date filters](https://developer.squareup.com/reference/square/payments-api/list-payments)
- [Xero accounting API](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml)
- [Harvest time entries](https://help.getharvest.com/api-v2/timesheets-api/timesheets/time-entries/)
- [Clockify API](https://docs.clockify.me/) and [free API limits](https://clockify.me/help/getting-started/webhook-and-api-limitations)
- [Zoho Books invoices](https://www.zoho.com/books/api/v3/invoices/) and [expenses](https://www.zoho.com/books/api/v3/expenses/)
- [Loyverse receipt API](https://developer.loyverse.com/docs/API-Reference__v1.0.yaml) and [plan limits](https://loyverse.com/pricing)
- [Wix order search](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/search-orders)
