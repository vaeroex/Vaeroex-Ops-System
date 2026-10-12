# Admin operations review and release

This change updates Vaeroex Usage, AI Trust, and Support Requests for the existing platform-admin role across all workspaces. It does not change customer subscription gates, allowances, percentage displays, private conversation permissions, pricing, or production deployment settings.

## Review surfaces

- `/app/admin/ai-usage`: period/workspace scope; full-period estimates and uncertainty; current reservations; daily trends; independent questions, attempts, retries, artifacts and saved analyses; paginated workspace budgets and safe ledger details.
- `/app/admin/ai-trust`: compact execution reliability and measurement coverage, VSI outcomes, and expandable shadow/provider diagnostics. Successful execution and valid citations do not establish answer correctness.
- `/app/admin/support-requests`: filters before pagination, page-local selection, bulk reversible archive/delete/restore, exact-count deletion confirmation, pending protection, and content-free atomic audit receipts.

The hosted review fixture renders these actual UI components with synthetic data and simulated local support actions. Its banner identifies it as a synthetic preview. It has no database credentials, real customer data, provider access, or production mutation capability. It demonstrates UI behavior; isolated PostgreSQL and server-action tests verify authorization, aggregation and mutation behavior separately. A normal application preview requires the new migration on an appropriately current, isolated database; the older existing preview database has not been modified.

## Data and privacy contract

The migration adds service-role-only, SECURITY INVOKER RPCs and explicit nested scalar/enum allowlists. Its helpers and operation receipts occupy a dedicated `admin_telemetry` schema. Existing denial of API-role access to the integration `private` schema remains unchanged. Each reusable server loader independently checks the existing platform-admin authorization. Usage and Trust never fall back to fetching raw JSON when their RPC is unavailable. Unsupported or missing financial data is unavailable, uncertain, or unknown rather than silently zero.

No customer prompts, answers, chat titles, summaries, Business Note/file contents, research queries, full research URLs, or raw provider payloads are returned by the admin telemetry RPCs. Support messages are excluded from the inbox list and load only through a separately authorized action when a request is expanded. Audit metadata contains actor, operation, request IDs and counts, not message bodies. Each affected workspace receives its own audit row containing only its local requested/changed IDs and counts; the existing manager-read RLS exposes it only to authorized administrators of that workspace. Truly unassigned requests remain in an admin-only null-workspace row. The aggregate batch result and no-op receipts stay service-only. All rows, audit groups and the retry receipt commit atomically.

## Accounting and measurement limits

- Selected periods are start-inclusive and end-exclusive. Budget/reset boundaries and daily buckets remain UTC; visible timestamps identify the viewer's local time zone.
- VSI cost events are the spending authority. Request cumulative costs and mirrored usage are excluded. Known estimates and uncertain estimates are disjoint. Current outstanding reservations are outside period spending.
- Questions are the cohort created in the period, with their current outcome. Cost-event attempts use their recorded event timestamp. These counts describe different stages and are not summed as questions.
- Estimated web-search charges are an included subset of VSI spending using recorded search counts and the current $0.01/search catalog assumption; open/find activity has no separately recorded fee. Estimates are not invoices.
- Cost coverage is incomplete for enabled KPI semantic suggestions, evidence embeddings/optional reranking, and document-extraction services because those paths do not write complete costs to these ledgers. They are inventoried explicitly; no contents are fetched to infer missing costs.
- Historical records without workspace identity contribute to platform totals and are labeled separately from workspace totals.
- Usage financial aggregates cover the complete period; detail and workspace pages are bounded. Trust legacy diagnostic rows are bounded to 5,000 per source and report actual truncation. A count-only saved-analysis query never causes a truncation warning.
- Structured VSI coverage starts when this code is deployed. Earlier records and checks not reached remain unmeasured. Confirmed Business Note outcomes and pre-admission quota blocks are explicitly not measured by these ledgers. Shadow checks retain existing observation/enforcement behavior; there is no accuracy score.

## Verification

`pnpm test:admin-operations` checks safe loaders, authorization, report scope, privacy projections, truncation, support validation and pagination. `pnpm test:admin-operations:browser` exercises the actual hydrated components with synthetic fixtures at desktop and mobile sizes, keyboard selection, pending states, retry identity, and on-demand support content.

`ADMIN_METRICS_PG_BIN=/path/to/postgres/bin node scripts/admin-metrics-database-tests.cjs` creates a disposable local Unix-socket-only database and refuses hosted database configuration. It exercises aggregates beyond 6,000 rows, precision/uncertainty, VSI deduplication, periods and workspace scope, malicious nested metadata, ordinary-role denial, support concurrency/replay, and audit-failure rollback. CI also replays the canonical migration sequence and runs existing security, VSI, integration and application checks. All provider responses used by these tests are synthetic.

## Production release procedure

1. Review and merge the tested PR through normal CI. Preserve the existing `main` auto-deployment hold.
2. Take the normal protected database backup, verify the production project and migration history, and apply **only** `20261012091842_admin_usage_trust_support_telemetry.sql` after `20261012082738_pre_checkout_legal_entitlement_boundary.sql`. No older migrations need replaying in production.
3. Stage the resulting application commit without assigning production domains. Verify owner/platform-admin access, ordinary-user denial, safe telemetry responses and source availability. Use synthetic support records for mutations.
4. Promote the tested build after normal release checks, verify the three pages, and retain the auto-deployment hold. New VSI telemetry accrues on subsequent requests; historical content is not backfilled.

Until that release, production remains unchanged. The new migration and admin/support functions can remain in place if the application is rolled back; they have no customer grants or changes to existing subscription/transcript policies.
