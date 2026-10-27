# VSI stored-evidence mapping: all 12 offered integrations

This inventory describes the local mapping correction, not a live qualification of
12 accounts or a promise that every requested business question is answerable.
The shared engine reads authorized retained originals. It does not fetch new
provider data, turn an empty import into a zero total, or make source labels into
verified business correspondence. Square Sandbox is a conditional environment of
Square, not a thirteenth production provider.

## Field and meaning inventory

| Integration | Retained fields used by the protected projection | Typed facts / time meaning | Intentional limits and exclusions |
| --- | --- | --- | --- |
| Google Sheets | Current source/version, exact approved column mapping, admitted metric name/value/unit, supplied row `date`, entity timezone, last sync, KPI read roots | Exact decimal metric values and supplied units; supplied row date is separate from import observation time | Only accepted current fact links whose stored KPI agrees with the approved normalized row. A spreadsheet label does not establish accounting meaning, causation, complete coverage or a join. Unknown/mixed units are not converted. Limited-pilot availability is unchanged. |
| QuickBooks Online | Current source/version and validation-work record; record type/status, posting date, accounting basis/currency, `total` and `balance`; or report type/basis/currency/period, bounded columns/rows | Record total belongs to its posting/document date; balance is a balance observed at import, not historical cash on that date. Qualified two-column report summary facts retain their report period and basis | Current validated production records with active entity mapping only. Unsupported/truncated report shapes cannot become comparable totals. Summary rows may overlap and must not be added. No universal reconciliation, cash-flow or ratio engine is supplied. |
| Square | Completed stored payment, connection/payment/location identity, creation/update instants, integer `amount_minor`, currency, entity timezone | Payment amount stays in declared minor units; payment creation instant and corresponding date/timezone remain explicit | Completed payments only, not orders, settlements, complete sales, accounting revenue or profit. No guessed currency exponent, FX, refund coverage or payroll ratio. Native Sandbox proof is not production-provider proof. |
| Loyverse | Reviewed merchant connection currency; receipt original key/store, `receipt_type`, `total_money`, `total_tax`, `total_discount`, `cancelled`, `receipt_date`, `created_at`, `updated_at` | SALE and REFUND values retain stored signs and units; cancellation is explicit. Receipt business instant is distinct from server creation instant used by the retrieval filter | No netting refunds into sales, adding tax/discount again, sign inversion, invented tax treatment or accounting revenue. Missing merchant currency cannot authorize monetary comparison. No customer/payment/line-item records are retained by this connector. |
| Zoho Books | Invoice/expense kind and source ID, document `day`, `counted`, currency, total, outstanding | Counted USD invoice/expense totals retain document date; invoice outstanding is a balance at import with exact as-of time unavailable. Expense `outstanding=0` is not a measured receivable | US organization / USD restriction remains. Draft/void and non-USD rows retain exclusion meaning and cannot be interpreted as business zero totals. Invoice balance does not establish collection history, cash received or profit. Status details beyond `counted` were not retained. |
| Wix Orders | Approved order original key, `created_at`, `total_amount`, `currency_code`, `payment_status` | Order creation instant and reported payment status accompany exact order amount | Only approved orders. A PAID status is provider-reported order status, not a bank settlement or posted revenue. No implicit matching to invoice/payment sources. A safely displayed unknown status label has no established paid/settled meaning. |
| Xero | Per-original history `record_id`, invoice/bill `day`; currency-partitioned `invoices`, `billed`, `outstanding`, `bills`, `purchases` | Count markers distinguish supported sales-invoice versus purchase-bill contributions; counts remain counts despite currency partition. Document date is not observation time; outstanding is balance at last import, exact as-of unavailable | Import retains numeric contribution rather than full invoice payload. Excluded statuses can leave all-zero contributions; zero money alone cannot identify record type. No journals, payroll, payments, bank records, cash receipts or complete collections claim. Prior typed invoice-selection safeguards remain. |
| Harvest | History entry ID, `spent_date`; `entries`, `hours`, `billable_hours`, `running` | Completed tracked and billable hours by supplied spent date; running entries explicitly excluded from completed contributions | Only entries visible to the connected account's permissions. No employee names/rates/notes or payroll cost. Visibility is not proof of complete workforce coverage. |
| Clockify | History entry ID, UTC start day; completed `entries`, duration `hours`, `billable_hours`, `running` | Entry-start date in UTC; completed duration can cross a range boundary and is not split. Running entries are excluded from completed contributions | Connected user's entries only, not team-wide labor or payroll. No inferred dates from duration or allocations to another provider's business day. |
| Toggl 2.0 | Current selected organization/workspace snapshot; visible active `projects` and summed lifetime `hours`; snapshot endpoints / last sync | Project count is a current snapshot; hours are lifetime totals for currently visible active projects, observed at snapshot time | Not weekly hours, team payroll, project profitability or historical trend. Snapshot endpoints do not turn lifetime hours into period measurements. No legacy Toggl Track token route is added. |
| Zoho Inventory | Current selected organization snapshot; active inventory `items` and `low_stock` counts; snapshot endpoints / last sync | Aggregate count snapshot observed at its own instant | US data-center scope unchanged. No per-item quantities/SKU correspondence/cost, order linkage or inventory adjustments. Low-stock count cannot explain why stock changed. |
| Katana | Current key-bound account snapshot; `stock_rows` and `unavailable` variant/location-record counts; snapshot endpoints / last sync | Aggregate current availability-count snapshot; unavailable means retained adapter classification of stock minus committed quantity at or below zero | No SKU identities/quantities/cost in the retained projection, manufacturing profitability, shortage cause or historical trend. Key incarnation and installation boundary remain. No public OAuth partnership or write scope is added. |

## Authority and lifecycle boundaries

Sheets, QBO and Square retain their dedicated protected typed readers. Xero,
Harvest, Clockify, Toggl, Zoho Inventory, Katana, Loyverse, Zoho Books and Wix require
an active owner-reviewed `legacy_evidence_bindings` entry for the exact connection
incarnation and business entity. Connected status or an account name is not an
entity mapping. The actor must have a live verified session and current workspace
authority. Every selected original is rechecked at capture/sealing and reopening;
revocation, lifecycle, binding, workspace and integrity failures still fail closed.

Canonical source identities, hashes and exact stored originals remain unchanged by
model-context selection. Bounded packing may omit whole groups; it must disclose
which requested scopes have no selected evidence. Authorized empty history and
supported-but-unprojectable shapes are coverage limitations, not authorization
successes and not permission to swallow arbitrary exceptions. A malformed or
changed original is never silently treated as empty.

## Dates, windows and financial use

The current product supports a bounded default last-30-day discovery window and a
60-day window for explicit last-30-versus-prior-30 comparisons. This does not mean
all days have been imported or that arbitrary requested history was searched.
The exact supported window and omissions must be exposed. Stored report periods,
document dates, business instants, observation/import timestamps and lifetime
measures have different meanings even when their displayed dates match.

The application has four closed relationship limitation recipes: invoice/order
stage boundaries, payment/accounting boundaries, payment/tracked-time coverage
boundaries and inventory/reported-context boundaries. They are not general
arithmetic or record-linking recipes. Source facts and authorized calculations
can support qualified next checks and explicit missing-evidence explanations;
they do not establish arbitrary all-provider ratios, causal conclusions, common
transactions or complete profitability.

## SQL dependency prepared locally

`docs/security-drafts/01-legacy-evidence.sql` adds only protected Loyverse currency
to `private.resolve_legacy_evidence_v1` after the exact reviewed incarnation is
verified. Currency was already retained by the callback and part of the
incarnation/revocation contract. No new grant, secret field, credential access,
table, or provider permission is introduced.

This changes the resolved Loyverse content hash. An old captured Loyverse
reference without currency must report **changed**, rather than silently gaining
new monetary semantics. Existing references and saved answers are not rewritten.
Other providers' legacy projection hash shapes are unchanged by this SQL delta.
Deploying this application mapping without the SQL correction cannot establish
Loyverse currency; it must remain unsupported/unknown for monetary use.

The numbered source drafts are bootstrap specifications, not an incremental
production migration. A later reviewed upgrade must replace only the changed
function bodies and any separately qualified discovery function, with the
existing security attributes, permissions and bounded execution preserved. Do
not replay bootstrap table creation or prior installation steps.

## Verification boundaries

Focused isolated SQL tests execute the actual resolver against the existing
screened synthetic owner/session fixture: retained refund/cancellation fields, nullable
currency, workspace/member rejection, currency replacement revocation,
pre-currency reference change detection and unchanged non-Loyverse hash shape.
Application tests must additionally traverse import-shaped stored records through
admission, projection, budgeted selection, rendering and saved-answer reopening
for all 12 providers. Their exact final counts and receipts belong in the local
qualification report.

Passing these offline tests does not establish live provider access, deployed SQL
parity, actual model usefulness across 12 accounts, hosted source-page rendering,
or general business accuracy. Those are distinct later qualifications; no such
external action is part of this local correction.

## Source contracts inspected

- `lib/integrations/reporting/adapters.ts` and `catalog.ts`: six reporting imports and their retained scopes.
- `lib/integrations/loyverse/server.ts` and `app/api/integrations/loyverse/callback/route.ts`: receipt fields and verified merchant currency.
- `lib/integrations/zoho-books/server.ts`: USD/counting policy, total and outstanding behavior.
- `lib/integrations/wix-orders/server.ts`: approved order amount and reported payment status.
- `lib/integrations/qbo-customer/contracts.ts` and `lib/integrations/providers/qbo/contracts.ts`: minimized record/report previews.
- `docs/security-drafts/01-legacy-evidence.sql`, `06-typed-source-admission.sql`, `08-sheets-projection.sql`: protected projection and admission boundaries.
- `lib/ai/shared-evidence/generation.ts`, `fact-time.ts`, `financial-boundaries.ts`, `invoice-selection.ts`: application fact semantics and limits.
- `lib/vsi/evidence-window.ts`: bounded supported discovery windows.

## Qualification and next deployment dependency

Run `test:shared-evidence-mapping` for the credential-free projection, selection,
preparation and exact incremental-SQL assembly checks. The existing VSI aggregate
includes those checks. Run `test:shared-evidence-mapping:sql` locally with the
existing `SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR` to exercise actual isolated SQL
admission, atomic saving/reopening, all-provider revocation and the incremental
upgrade. The screened capture inputs stay outside Git and must not be uploaded
to CI. These SQL tests are not skipped or represented as public Linux coverage.

The inactive incremental dependency is
`docs/security-drafts/mapping-upgrade/forward.sql`, with an exact SHA256 in its
manifest. It replaces the protected legacy resolver and discovery-v1 wrapper,
and adds owner-checked discovery-v2 with the same authenticated caller class.
It changes no tables, source records, keys, settings or application switches.
Public/anon/service-role execute is explicitly revoked on v2; the existing
verified live owner/session checks remain inside the function. This is a new RPC
entry point and requires separate hosted SQL review/approval before activation.
The bootstrap `release/forward.sql` is fixture/install assembly and must not be
replayed over the existing installation. Missing v2 fails closed; there is no
silent old-discovery fallback.

The minimal next qualification is publishing this inactive candidate for fresh
Linux build/CI while deployment stays disabled, plus review of the exact SQL
delta. No hosted migration, connector connection, model test, activation or
deployment is authorized by the local qualification. Later hosted quality proof
needs eligible owner-reviewed sources for each selected connector; offline
fixtures cannot establish real-account coverage or model accuracy.
