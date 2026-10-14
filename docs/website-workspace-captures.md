# Actual workspace website captures

## Provenance and isolation

Application source: `3f5431207c43534caf2c4f3b9d4b9057c8583799` (main after #495/#496). The imagery work changes marketing presentation, static images, capture documentation and script-only fixtures. The separately requested Performance clarification uses application commit `dc3e650bb1d651046701ab4f72ba79e33b5272f5`: explicit historical target counts, chart scope and a read-only All history option. Calculations, metric inputs, data access, billing and production configuration remain unchanged. The main auto-deployment hold remains enabled.

`scripts/website-demo-preview.cjs` renders the actual AppShell, Intelligence route's final JSX/client components, Performance page and Files & Notes page. Authentication/database reads are replaced by bounded local adapters; all actions are inert. The normal operational-evidence producer, Intelligence layer, coverage calculator, snapshot composition/projections and consumers calculate the displayed results. Performance uses its normal page logic. This is a real-component capture, not an end-to-end import/provider test or a recreated dashboard.

No environment file, customer account, production workspace, merchant connection or paid provider is used. The loopback server rejects writes/non-loopback hosts; CSP blocks connections/form submissions. The webpack dependency boundary rejects live Supabase clients and model providers. No fixture route or fixture module ships in production runtime imports.

## Coastal Kitchen scenario and calculations

Coastal Kitchen is a fictional 54-seat restaurant. Maya Rowan, Harbor Produce, Bay Pantry and Cove Dairy are fictional. Source text lives in `scripts/website-demo/data.ts` and can be reconstructed from `sourceDocuments` / `csvContents`:

- 168 KPI observations: six metrics, 28 Monday-ending weeks, April 6–October 12, 2026. Monthly exports retain separate original dates; observations are not duplicated.
- 64 source files: 42 monthly KPI exports, seven staffing ledgers, seven procedure reviews, seven risk reviews and one supplier invoice register.
- 20 operational records: 14 role-cost observations plus six supplier invoices. Each monthly role-cost total reconciles to the same week's sales × labor percentage.
- Latest values: sales $27,600 / $24,000 minimum; gross margin 70% / 68% minimum; labor 29.8% / 32% maximum; ticket time 16.2 / 18 minutes maximum; satisfaction 96% / 90% minimum; waste 3.5% / 5% maximum.
- One seeded, reviewed Business Note in `context.ts` supplies operating context and the supplier follow-up. Its quote validation and contextual eligibility use the normal application contracts. It is explicitly an authored fixture, not a claimed provider-generated extraction. It contributes supporting context, not independent original evidence or extra health points.

**Health: 90/100, Strong.** The unchanged formula starts at 50; six supported target achievements reach the existing +50 positive cap. The Medium supplier risk subtracts 10. No score or finding is authored/overridden.

**Readiness: 87%, Strong.** The unchanged ten-category coverage calculation produces Revenue 90, Financials 90, Operations 100, Customers 90, Customer Revenue Context 90, Processes/SOPs 68, Staffing/People 90, Issues/Risks 68, Historical Trends 90, Business Memory 90. Their mean is 86.6, rounded to 87. Process/risk coverage remains narrower and is not represented as perfect. This visible coverage percentage is distinct from the internal data-quality/confidence score.

**Previous reviews:** `historicalReviews()` filters the source inputs to August 31, September 28 and October 5, runs the normal producers for each cutoff, then calls `recordDailyBusinessHealthSnapshot` against a closed in-memory upsert sink. The real recorder supplies calculation versions, date and retry-protected shape. No historical scores are typed into the fixture. The current UI truthfully shows a 10-point decrease from the prior stored review: the newly recorded supplier exception accounts for it. These are reproducible simulated historical reviews, not claims that a production workspace existed on those dates.

## Showcased finding and limits

The normal operational producer reads six invoice records; CK-410 (Harbor Produce, $420, due October 8) and CK-411 (Bay Pantry, $180, due October 9) are explicitly marked Overdue. It calculates two of six (33%), totaling $600. The app's existing investigation planner asks the owner to check invoice/supplier records, confirm payment status and supplier dependency. The evidence tab displays both original records, one independent source, Medium confidence and missing current payment status / supplier dependency.

The register does not prove a cash shortage, delivery disruption, continuing unpaid balance or the cause. Those limitations remain visible. The reviewed note supplies the intended bank/statement reconciliation and says no disruption was recorded; it is not elevated into causal proof. The normal deterministic finding is useful without a paid model call. This local harness does not execute provider-backed finding analysis or VSI, so it cannot demonstrate richer generated causal synthesis. No answer is scripted or presented as generated, and no reasoning engine was changed.

Performance's normal summary uses its performance-effect semantics: “Latest movement: unchanged” can appear while raw sales rise when both observations remain on target. The chart and recorded values remain unaltered.

## Capture reproduction and quality

1. Run `node scripts/website-demo-preview.cjs` with the lockfile dependencies. Open `http://127.0.0.1:3190/app/intelligence`. The local clock is fixed at `2026-10-12T18:00:00.000Z`.
2. Use Chrome's native DevTools device toolbar, Responsive dimensions, **DPR 2**, height 1000. Read `innerWidth`, `devicePixelRatio`, `document.fonts.status` and the visible DOM bounds before export. Wait for settled UI and loaded fonts.
3. Intelligence overview: 1200 CSS pixels wide; capture the actual Health/Readiness content. Mobile: 390 CSS pixels, both complete cards.
4. Findings: 1440 desktop / 390 mobile. Open the real direct link `/app/intelligence?finding=operational-overdue-suppliers-source-file%3Acoastal-invoices`. Capture the complete Summary panel. Select Evidence and expand the supplier group; capture both records and missing evidence.
5. Performance: 1200 desktop / 390 mobile. Open Weekly net sales via `/app/kpis?timeline=90D&metric=Weekly+net+sales&section=detail#kpi-detail`. Desktop captures the real KPI detail; mobile includes the historical target card, record count and scoped chart.
6. Notes: 1200 desktop / 390 mobile. Add business note; fill `noteDraft` for desktop or the concise mobile draft below, date October 12. Do not submit. Scroll the page to the top so fixed headers cannot overlay captured content. Capture the actual editor, date and review action.
7. Use **DevTools → More options → Capture full size screenshot**, which saves a native PNG at exactly twice the CSS width. Move the pointer outside the crop using normal UI controls before capture. The general browser screenshot API emits JPEG and is used only for review images, never these marketing assets.
8. Apply the integer pixel crop in `scripts/website-demo/captures.json`, then encode **lossless WebP once**. No resizing, compositing, retouching, color/text/control changes or invented values. Verify hashes/dimensions and inspect every resulting image.

Mobile draft (379 characters, unsubmitted):

> Coastal Kitchen — Monday review
>
> Weekly sales reached $27,600 against our $24,000 target. Guest satisfaction is 96%.
>
> The supplier register marks two invoices totaling $600 overdue. Maya will check bank settlement and supplier statements before approving another payment. No delivery disruption is recorded.
>
> Keep the smaller prep batches while monitoring waste and service time.

### Why the old images were soft

The previous browser API supplied JPEG originals, which were encoded again as lossy WebP quality 92. They were approximately 1× captures. The 719-pixel evidence image could render around 884 CSS pixels wide, enlarging it even before accounting for a high-density screen. Mobile sources were roughly 335 pixels wide for a ~329 CSS pixel display. A larger nominal export after the fact would not repair those originals.

The replacements are native 2× PNG → lossless WebP, with no intermediate resizing. The viewer now caps overviews at 900 CSS pixels and finding/evidence details at 720; mobile at 340 with separate real mobile captures. `srcSet` explicitly declares the 2× source, and width/height attributes describe CSS dimensions to reserve the correct aspect ratio. No optimizer or CDN resizing path is involved: the browser requests the static asset directly. The ten overview/detail files total approximately 600 KB, with individual files below 85 KB despite the sharper resolution.

## Privacy and qualification

All final images show only fictional business content and ordinary workspace controls. No real account details, emails, private identifiers, credentials, customer records or admin-only controls appear. Source invoice numbers are fictional business references, not system IDs.

`node scripts/website-workspace-imagery-tests.cjs` rebuilds the component harness and verifies source counts/bytes, calculated health/readiness, historical records, contextual evidence, supplier totals/limitations, asset hashes/density/size, the local write/network boundary and the main deployment hold. It runs in required public CI. Website review covers desktop, 390 and 320 CSS pixels at DPR 2, actual delivered sources, image loading/aspect ratio, tabs, keyboard navigation, overflow and existing CTA destinations. Public copy outside capture-specific captions, pricing, checkout, integration disclosures and all 3D scenes remain unchanged.

## Integration imagery extension

The ten overview/detail assets were preserved for the integration addition; the two Performance assets were subsequently recaptured for the requested history-scope clarification below. Six new native 2× lossless captures show the actual Square saved-Payments browser, QuickBooks report observation, and Google Sheets selected-cell preview. See [Coastal Kitchen reusable scenario](coastal-kitchen-demo.md) and `scripts/website-demo/integration-captures.json` for provider relationships, capture provenance and reproduction. No live connection, account, import or production mutation is involved.

## Target history scope clarification — October 13

The normal Performance calculation evaluates every eligible recorded value for the selected KPI, using its confirmed direction and target rules. For Coastal Kitchen weekly net sales this is **17 of 28 = 60.71%**. Eleven earlier observations missed the unchanged $24,000 target. The latest twelve observations (July 27–October 12) all met it. The values, dates, eligibility and mathematical result are unchanged.

The actual workspace component now labels the card **Historical target hit rate**, gives the numerator and denominator, visibly labels **Latest 12 recorded values**, and offers **All history**. All history displays the same 28 values from April 6–October 12; it does not change the card or redefine the date-filtered comparison workflow. URL links retain the metric/list/date context and work with Back/Forward. Missing values or targets remain excluded and the supporting text reports exclusions.

Only `performance-desktop.webp` and `performance-mobile.webp` were recaptured at native DPR 2 from that updated component. The mobile crop intentionally keeps the historical count and chart scope together. Their per-asset provenance, crops and hashes override the original manifest-level application commit. All other 20 approved workspace, integration and VSI images and the genuine VSI response remain byte-for-byte unchanged. No provider call or database write was needed.

Focused verification covers normal target directions, ranges, zeros, missing values/targets, unknown direction, 12/all-28 rendering, unchanged percentages, preserved URL filters, Back/Forward, keyboard navigation and 390/320px overflow. The target-persistence runner also now resolves two existing imports in its isolated loader; KPI writes fail the test if they attempt to read Sheets.


## Chart and QuickBooks refresh — October 14, 2026

Application capture source: `8d6bb23b67cf6e03c3728bf9afa292c7fdea8d3e` (the final PR #500 comparison-chart tree, including PR #499 financial retrieval). Twelve additional images in `scripts/website-demo/chart-captures.json` preserve the previous approved assets unchanged. The website tour adds KPI comparisons and a monthly briefing; VSI leads with financial analysis while retaining the campaign-planning examples.

The existing isolated Coastal Kitchen database was used for two real workflows. `scripts/coastal-kitchen-chart-capture-local.cjs --config-dir <owned-private-config-dir> --generate` runs the normal authorized VSI engine and monthly briefing service, with the same provider policy, retrieval, calculations and claim validator as the application. It verifies the loopback database belongs to the private local stack. It reads the development credential only from `~/.config/vaeroex/coastal-kitchen/provider.env` (owner-only, outside Git). Never copy credentials into this repository or documentation. The first attempt completed VSI but the opt-in briefing policy was unset; `--briefing-only` reused the completed VSI result and ran the briefing once with the normal policy selector. Existing output files block accidental paid replays.

Provider spend: VSI $0.0020395 estimated, monthly briefing $0.09 estimated; total $0.0920395. The monthly validator accepted 17 claims and rejected five unsupported relationships before rendering. The omitted Business Updates section was not manually restored. The accepted artifact and unedited VSI answer/citations are recorded in `monthly-briefing.json` and `chart-response.json`; capture adapters replay only these outputs. They cannot make live requests or writes. The display timestamp is the recording assembly time; citation retrieval timestamps retain the actual retrieval time.

### Evidence and limits

- KPI comparison: gross margin 70% against 68%, prior observation 69.8%. All 168 KPI records, targets, health 90 and readiness 87 are unchanged.
- Monthly briefing: September 13–October 12, 20 eligible records and seven independent sources. The normal chart selector compares first/latest observed ticket time 16.6 → 16.2 minutes, food waste 3.6 → 3.5%, and gross margin 69.3 → 70%. These are five observations within the briefing period, **not two monthly totals**. Desktop shows the accepted summary plus two charts; mobile focuses on the complete ticket-time chart, including its dates and limitation.
- VSI: recorded QuickBooks accrual P&Ls for September 29–October 5 and October 6–12, USD. Revenue $27,200 → $27,600; COGS $8,214.40 → $8,280; operating expenses $9,932.80 → $10,624.80; net income $9,052.80 → $8,695.20. The validated citation snapshot supplies three real comparison charts. The answer recommends examining the $600 increase in other operating expenses and explicitly avoids causal certainty. This $600 is **not** the separate overdue supplier-invoice total. Profit is not cash flow; source coverage/reconciliation remain unestablished. No automatic cross-provider reconciliation or live merchant connection is claimed.

### Reproduce the exact captures without model calls

Run `WORKSPACE_PREVIEW_PORT=3212 node scripts/website-demo-preview.cjs` and capture at 1200, 390 and 320 CSS pixels, height 1000, DPR 2. Wait for loaded fonts and settled UI.

1. `/app/kpis?timeline=90D&metric=Gross+margin&section=detail`: native full-page PNG; use the Performance crops in the manifest.
2. `/app/intelligence/briefings/monthly`: actual `IntelligenceBriefingViewer` with the recorded accepted artifact; native full-page PNG and manifest crop.
3. `/app/si?example=financial`: actual VSI conversation component, recorded authorized answer and validated chart snapshots. Home in the transcript for the question/answer crop. For desktop charts, scroll the transcript to 770 CSS pixels; 390px mobile to 1856; 320px to 2190. Use normal keyboard scrolling, check visible chart bounds, and move the pointer outside the capture before exporting.
4. Export native Chrome DevTools PNG at DPR 2, crop at exactly twice `cropCssPixels`, encode lossless WebP once. Never resize, edit text, replace values or retouch controls. `sourceSha256` identifies each original PNG; `sha256` verifies the delivered WebP. All new assets are 79–296 KB, with separate 390/320px crops and explicit source dimensions. Original masters are retained in the private local capture folder.

No production account, database, integration configuration, application component, 3D scene, billing behavior, Google Sheets disclosure or deployment hold is changed by this imagery refresh.
