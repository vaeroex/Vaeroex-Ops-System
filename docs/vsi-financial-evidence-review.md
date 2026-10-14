# VSI cost and profitability retrieval

## Confirmed gap and focused change

PR #497 correctly identified that VSI called the integration dashboard, whose QuickBooks contribution was limited to partial monthly posted-revenue subtotals. The stored P&L browser already held cost and profit rows, but VSI did not read them. No additional OAuth scope, merchant authorization or provider collection is necessary for the supported stored reports.

`retrieveFinancialEvidence` now uses the existing authenticated `qbo_customer_source_browse_v1` owner/session RPC. It independently binds workspace and actor, checks the production accounting consent scope and active/degraded connection, and requires an active source, completed valid validation and current mapping. It uses the same contextual-observation eligibility as the existing browser; disconnected retained records remain browsable under their old rules but are not promoted into VSI financial evidence. No private-table service-role read is added. Existing subscription, Google read-ticket/pilot, file, note, privacy, quota and model controls remain in place.

The evidence producer retains source and provider record identity, connection/entity label, account labels and hierarchy, currency, basis, reporting period, observation/synchronization dates and a content hash. Original QBO source links remain inspectable in the existing permission-checked browser. They resolve the current retained version, not an immutable accounting archive; hashes identify the answer's retrieved content without claiming the link cannot change.

## Calculations and scope

- Explicit reported totals only: revenue, COGS, gross profit, operating expenses and net income. Parent totals and child rows are never summed together. Missing or ambiguous totals remain unknown.
- Application decimal arithmetic supplies margins, expense ratios, absolute/percentage changes, margin percentage-point changes and matched account-line changes and revenue ratios. Every result includes source inputs and row references. Money and percentages are rounded to two decimals; no currency conversion is performed.
- Comparisons require the same connection/entity, known matching currency and cash/accrual basis, complete projection and nonoverlapping equal-length periods (or two complete calendar months). Missing/zero/negative denominators produce explicit unavailable results. Negative profit remains a supported numerator.
- Profit is not cash flow. Square payments, approved spreadsheet sales and file-derived sales must not be added to overlapping QuickBooks revenue. Recorded costs establish category changes, not vendor causes, dish/SKU/location/channel economics or allocation assumptions. A gross-margin target is not a separately recorded food-cost target.
- Existing permitted KPIs, approved notes, files, findings, Health and supported integration dashboard data remain available alongside these reports. No new Square aggregate or Google import path is claimed.

## Bounds and remaining limitations

This initial path supports validated two-column P&Ls with explicit supported English total labels. The current browser projection does not retain native QuickBooks group identifiers/account IDs; ambiguous totals, multi-column reports and truncated reports do not produce totals or calculations. Complex reports exceeding 6,000 report characters are omitted whole. Retrieval examines at most 75 stored reports per connection, selects two by report-end date within that bounded set, and uses at most two eligible connections and 16,000 financial-context characters within VSI's unchanged 24,000-character overall selection. This is not exhaustive history or reconciliation.

Freshness means the saved source's synchronization time, not proof of current books or complete provider coverage. Degraded connections or observations older than 24 hours are labeled stale; invalid/future synchronization timestamps are excluded. Only owners receive these financial sources because the existing source browser is owner-only. The customer-facing result remains advisory and may need an owner to supply underlying account/transaction detail.

## Isolated qualification

The reproducible fictional Coastal Kitchen fixture adds two native validated report versions to the owned loopback Supabase stack. It uses the existing native task/source commit/validation path; fake authorization fixtures never contact Intuit or change merchant connections. The temporary native-ingestion database role grant is confined to the fixture transaction and revoked before commit. Read tests use a real GoTrue session and normal owner JWT, not a service-role retrieval bypass.

| USD accrual P&L | Sep 29–Oct 5 | Oct 6–12 | Application change |
| --- | ---: | ---: | ---: |
| Revenue | 27,200.00 | 27,600.00 | +400.00 |
| Cost of goods sold | 8,214.40 | 8,280.00 | +65.60 |
| Gross profit | 18,985.60 | 19,320.00 | +334.40 |
| Labor expense | 8,132.80 | 8,224.80 | +92.00 |
| Other operating expenses | 1,800.00 | 2,400.00 | +600.00 |
| Operating expenses total | 9,932.80 | 10,624.80 | +692.00 |
| Net income | 9,052.80 | 8,695.20 | −357.60 |
| Net margin | 33.28% | 31.50% | −1.78 percentage points |

The genuine workflow is session → authenticated VSI API → permission-checked stored QBO evidence plus existing workspace evidence → configured VSI provider → persisted exchange → reopened exchange. Retrying the same request returns the stored result and consumes no additional question. The native foreign-workspace financial request returns `42501`; a wrong-workspace API mutation returns 403. The checked-in `financial-response.json` is the unedited actual saved answer, not a hand-written showcase. `financial-evidence.json` contains fictional retrieved inputs, including the calculations and both reports.

The display preview mounts the existing `VsiWorkspace`/`Exchange` components over that recorded response. It is clearly labeled read-only and exposes source snapshots for inspection. It does not pretend to be a hosted authenticated server or execute a new question. Marketing screens and the previous campaign recording are unchanged.

Reproduce after assembling/seeding the existing Coastal Kitchen local stack and its existing QuickBooks production-overlay schema:

```sh
node scripts/coastal-kitchen-financial-local.cjs --config-dir /absolute/owned/local/config-directory
# Opt-in paid API qualification: numbered attempt refuses overwrite, max $0.25 reservation.
node scripts/coastal-kitchen-financial-local.cjs --config-dir /absolute/owned/local/config-directory --api-generate --api-attempt 1
node scripts/coastal-kitchen-financial-preview.cjs
# Open http://127.0.0.1:3206/app/si
pnpm test:vsi
```

The local runner verifies loopback URLs, the owned Postgres data directory and private config permissions. The dedicated provider key stays outside Git. The review server binds only 127.0.0.1 and has no backend writes or provider key. Existing local fixture instructions and schema assembly are in `docs/coastal-kitchen-demo.md`; required QBO overlay functions are the already-established customer source-browse, ongoing-sync, source-validation and accounting-intake functions. The ordinary hosted Preview database remains behind current schema; this PR does not upgrade it or hide that limitation.

## Regression and release boundary

Focused tests cover decimal ratios, losses, missing costs, zero/negative denominators, currency/basis/entity/period mismatch, ambiguous/truncated/multicolumn reports, parent/child nonadditivity, stale labeling, consent filtering, replaced/invalid/quarantined/deleted sources, disconnected/foreign responses and unauthorized roles. Existing VSI engine, retrieval, quotas, note and UI suites run through `test:vsi`. Native QBO canonical and production-shaped disposable database suites pass, including source browsing, validation, expired/revoked sessions, tenant/role boundaries and unchanged private-table ACL/RLS.

No new schema migration, production record mutation, model-routing change, OAuth expansion, merchant reauthorization or main deployment-hold change is included. Stop for review. A later approved release must qualify the deployed environment's existing QBO RPCs and feature availability, run exact-head CI and use the explicit release procedure. A hosted isolated interactive preview needs a separately qualified non-production database; do not connect the old Preview to Production to obtain a green test.

## Measured answer quality and cost

The final saved answer correctly states that sales increased but less was retained as net profit, reports the $692 operating-expense rise and its $600 other-expense/$92 labor components, distinguishes the 1.78-point net-margin decline from the 3.95% decline in net income, and proposes investigating transactions without asserting a cause. It cites both P&Ls, their derived calculation record, the labor KPI, gross-margin finding and food-waste file/finding. Overlapping file sales are not added to QBO revenue. Its final food-waste sentence omits the percent sign in prose; the cited metric preserves its unit. This remains a reviewable advisory answer, not a guarantee of perfect financial prose.

Four bounded real answers were inspected during implementation (eight model requests total, no web calls, no retries). Estimated total for this focused work: **$0.00806483**. The final authenticated API answer used 14,837 input tokens (1,025 cached), 1,624 output tokens including 824 reasoning tokens, two provider calls, and cost **$0.00220345**, with 19,749 ms provider latency and about 22 seconds for the compiled API request. The original $25 qualification ceiling is unchanged. Estimates use the application's existing internal accounting; no customer allowance or spending safeguard was raised.
