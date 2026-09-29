# Customer workspace redesign — release qualification

Base: merged PR #446, `75c3d61196db8536e97e066310d7fb785a8c51c2`.
Separate branch: `codex/customer-workspace-redesign`. The user approved the shown visuals and conditionally authorized normal merge and automatic Production deployment after exact-candidate CI and review. No database migration, backend expansion or real-account mutation is authorized.

## Release correction record

- The user explicitly authorized nine exact presentation paths in `scripts/square-dormant-scope-test-support.js`; the focused test rejects neighboring and backend paths. This is a persistent file-level allowance, not inspection of future edits. No directory exemption or test waiver was added.
- Both upload entry points now use the single header form. The empty-state button opens and focuses that existing form rather than mounting a second upload. Its one inline reminder, selected file, fields, duplicate lock, validation, consent and import-approval boundaries remain. The secondary-only entry regression replaces the earlier incomplete two-form reminder test.
- Redesign-introduced lint warnings were corrected without changing rules or the 59-warning ceiling. Full local lint passes with 57 existing warnings and zero errors. TypeScript passes.
- Five new focused suites and the four modified legacy presentation suites run through the existing `test:workspace-clarity` CI command. The complete command passed locally with pinned pnpm 9.15.4: 38 existing interaction tests, 29 redesign tests, 56 isolated route/state/role renders, all four legacy presentation suites and 17 Admin preservation tests. Counts overlap earlier runs below. The optimized Next.js Production build also passed. Final hosted results must be recorded separately.
- Corrected shared-upload browser verification passed at 1440×1000 and 390×844: opening only the empty-state entry opens the primary form, the single reminder is rendered there, entered display name survives closing/reopening, no page-wide overflow, no captured console warnings/errors. No file was submitted. The browser check does not prove real upload/import.
- The sole authorized potential CI exception is the unchanged **Phase 5 synthetic-provider credential-security assertions 47–48**: `security-database` remains red, step 13 skipped, and twelve later SQL suites unrun. It is not a QBO-only exception and does not cover new failures.
- Historical preview results below remain explicitly local/synthetic, not Production or hosted exact-head verification. No final-head hosted security clearance is claimed before its actual result.

## Design contract

Preserve the existing blue/cyan/navy brand palette and theme preference. Use restrained typography, borders and spacing; keep important primary actions visible and place secondary actions/details behind clearly labeled disclosures. Customer-only styling must not restyle the Admin account-management release or public pages. No permissions, entitlements, calculations, integrations, database schema, approved-data semantics or provider dispatch changes.

`/app/sources` contains files **and business notes**, so customer navigation becomes **Files & Notes**. Supporting evidence retains that name where it means sources behind a finding. Knowledge, Legal & Agreements, Archived and legacy `/app/files` redirects remain supported.

## Pre-change action inventory

This inventory was completed before changing the corresponding screens. Existing function bodies, form fields, IDs, permission gates and URL builders are the behavior contract, not the fixture adapters.

| Area | Existing controls / handlers to preserve | Meaningful boundaries |
| --- | --- | --- |
| Shared shell | Canonical destination links, `selectWorkspaceAction`, `signOutAction`, GlobalSearch dialog/query/navigation, mobile menu, legal/help links | Selected-workspace cookie remains authoritative; Admin only for authorized accounts; search cancellation/error behavior preserved. The later requested reminder consolidation is recorded below. |
| Overview | `ExecutiveHomepage`, model-provided risk/opportunity links, readiness Add information, eligible-signal popover, trend ranges/points, View analysis/Prepare/Refresh, supporting evidence, Save Analysis | Health calculations and missing-vs-zero distinction unchanged; opening available analysis may request generation, so retained-account inspection does not invoke it; legacy Overview modes remain |
| Intelligence | Current/History, category + confidence filters, 10-item batches, selection, mobile Back/focus/scroll, Summary/Evidence/Analysis, evidence-group expansion, explain finding, acknowledge/pin/dismiss, briefings, saved artifact | Lifecycle token and owner/admin/manager gates unchanged; explicit reason/note confirmation; no automatic new generation or saved records |
| Performance | Overview/Compare, timeline/custom range GET forms, status filters, six-item batches, metric details/Back, compare selections, existing Add/Import links and edit/settings forms | Date-only meanings and UTC timeline rules preserved; detail intentionally shows full metric history; no formula/target semantics or mutation return-path changes |
| Files & Notes | Upload drawer/form, `uploadSourceAction`, notes composer/review, view tabs, search, 25-item batches, source detail, analysis/retry, explicit learning approval/discard, archive/restore/delete, legal/download links | Automatic preparation does not approve authoritative imports. Recoverable fields retained; uncertain upload acknowledgment stays locked, never blindly retried |
| Import review | `importFileAction`, worksheet inclusion/mapping, `saveExtractedImportAction`, explicit Save approved data / Import approved worksheets | Existing IDs, validation, disabled/archived/retired states, preview rows and approval decisions unchanged |
| Notes/knowledge | `submitBusinessNoteForReviewAction`, review edits, approve/cancel, bulk note/knowledge lifecycle forms | Workspace/author authority preserved; maximum100 selected records; typed DELETE and confirmations; feedback remains next to its source action |
| Saved Analyses | Search/type filters, 25-item batches, view detail, Back, selected/per-item delete confirmation, supporting evidence/source links | Existing loaded-set bound of300 and warning remain; no claim of full-history pagination or regeneration |
| Settings | Owner-gated Manage Square; independent QBO controls; password-change form; current workspace/role; theme controls | No integration gate changes; local theme selection unchanged; no retained-account password/form submissions |
| Square | Direct Back to Settings; connect, location mapping, bounded read/continue/history import; status refresh; manage/disconnect confirmation; history; stored-payment filters and 25-row pages | Canonical host + owner gates unchanged. Exact monetary minor units and business timezone preserved. Browsing never imports or moves checkpoints. No live provider actions in preview |

## Verification classification

### Requested generic-reminder consolidation

The generic sensitive-information reminder is now one discreet inline paragraph in the primary file-upload form. The duplicate empty-state upload form suppresses only that paragraph, so even when both existing upload disclosures are expanded the reminder appears once. Both entry interactions and their controls remain unchanged; other callers keep the reminder by default. Its repeated shared-shell disclosure/session dismissal and the duplicate Forms-page notice are removed. Browsing, dashboard cards, and note entry do not add another generic notice. The upload's analysis/import approval explanation, action-specific validation and warnings, legal-acceptance consent, support-form privacy warning, and all server checks remain unchanged. No permission or data-policy change is implied.

- **Real components, synthetic data:** local interactive preview; deterministic records and dates; before/after use identical fixtures. Simulated pending/error states must be labeled. No credential, API, provider or database access from the preview.
- **Focused tests:** existing handler/permission/query tests remain separate from visual simulation; no bypass or waiver to make presentation pass.
- **Read-only retained accounts:** visual inspection/navigation only. No uploads, generation requests, saved records, import approvals, account changes, provider dispatch or disconnect.
- **Not claimed:** complete ordinary-customer signup/confirmation/activation/agreement/end-access journey; real upload/import; real Saved Analyses detail; existing cross-page browser-Back state reset. These limitations remain tracked independently.

## Backend boundaries

No backend change is needed for this visual preview. Files, findings and Saved Analyses retain existing loaded-set batching; true full-history pagination would be separate backend scope. Existing non-atomic Admin pilot writes and unsupported account deletion/deactivation are unrelated and unchanged.

## Results

### Business Health comparison requested after the first preview

The local Overview preview includes a preview-only selector for **Executive scorecard** and **Segmented arc**. Both render the same `BusinessHealthInstrument` with a presentation-only variant. The current model's score/status remain authoritative; the ten equal segments represent the existing 0–100 scale, not new thresholds or additional metrics. Existing current-state, previous-review, confidence, driver, analysis, eligible-signal and trend controls remain unchanged. No product preference, calculation or database field was added.

- Scorecard: http://127.0.0.1:3186/app?healthVisual=scorecard
- Arc: http://127.0.0.1:3186/app?healthVisual=arc
- The approved release default is the Executive scorecard. The arc remains an isolated comparison option, not a new saved customer preference.
- The original frozen ExecutiveHomepage logic fingerprint is retained after removing only the exact optional variant type/default declarations for comparison. Protected action bindings remain identical. Focused rendered tests cover both visuals at zero, threshold boundaries, fractional scores and unavailable data; the unchanged formula suite also passes.
- Entire rendered Overview content outside the instrument is compared byte-for-byte between alternatives. The full preview has no live service clients. State-changing controls remain simulations, not real workflow verification.
- Browser verification completed at **1440 × 1000** and **390 × 844**: both alternatives retain score76/Watch and the identical supplied breakdown, with no page-wide horizontal overflow. Existing eligible-signal breakdown and View analysis open on the first click; Escape closes the analysis. The empty arc is unfilled and labeled Insufficient data/Limited evidence. Loading has no displayed score; the synthetic error remains explicit. Browser console had no warning/error entries during this pass.
- Historical reminder check counted one copy across both disclosures; release review found that the secondary-only path hid it. The single-form correction and its targeted verification supersede that insufficient check. Note entry has no generic reminder; review/import-approval explanations remain. No live file or note was submitted.
- Current tests: **21/21** focused instrument/workflow/reminder tests; unchanged Business Health formula suite; TypeScript no-emit; **56/56** route/state/role renders with extra exact-content/empty-fact assertions all passed. Counts overlap the prior qualification and are not additive. Independent focused review found no material application regression; it caught and corrected a fixture-only populated-driver leak into the empty preview.
- Desktop captures: `/private/tmp/business-health-scorecard-desktop.png`, `/private/tmp/business-health-arc-desktop.png`.
- Mobile captures: `/private/tmp/business-health-scorecard-mobile.png`, `/private/tmp/business-health-arc-mobile.png`.
- This update is still local and unmerged. No hosted CI, deployment, live upload/import or real-record Saved Analyses verification is newly claimed.

### Performance list refinement — preview only

The primary Performance view now uses one compact metric list, not repeated KPI cards. Rows retain the existing value/target formatting, status and performance-effect interpretation, and open the existing detail/history view. The summary distinguishes matching metrics, the total with recorded values, and the currently shown batch. Configured metrics without observations are separately disclosed; missing values are not counted as zero performance.

- Name/category search and category selection combine with the existing status filter before the existing six-row batching. The categories come only from the loaded workspace data. **Needs attention** retains the existing red/yellow (Behind/Near Target) predicate.
- Latest values still use all available history. The expandable **Chart date range** keeps the original presets/custom dates and explains that ranges apply to comparisons and records, not the latest-value list or all-history details. No calculations, database query, permission, action or import contract changed.
- The Performance-only fixture has **112 distinct metrics / 896 observations**, including zeros, missing values, stale dates, long names, imported/source-linked records and different native target directions. Other screens' fixtures are unchanged. Both comparison roots use this identical dataset, clock and synthetic workspace.
- Browser checks at **1440 × 1000** and **390 × 844** confirmed one-click filter submission, Needs attention (44 matching / 112 total), combined search/category/status (4 Net sales/Financial/Needs attention matches), no-match messaging, six-to-twelve row expansion, existing detail/history, and direct Back with the same filters/batch. Mobile category filtering produced 64 Operations matches; custom dates submitted and remained in the URL with that category. No horizontal page overflow was observed.
- The empty, loading and error states remain distinct. The preview's simulated error recovery retained category/custom dates; this is not a real transport-error test. A browser-observed dropdown selection issue when a category disappears was corrected by remounting only that selector when its available categories change.
- Focused preservation checks freeze 63 existing business helpers, 57 existing query/data statements and all seven mutation-form targets/fields/protections. This replaces only the obsolete whole-Performance presentation fingerprint, not the other screens' contracts. The old retirement test's compare regex was already stale on main; it now checks the unchanged shared section helper.
- Independent focused review found and verified correction of desktop screen-reader labels; no remaining material issue in the reviewed application change. Existing Business Health and reminder tests still pass. No state-changing browser action, real upload/import or Saved Analyses detail is newly claimed.
- Final focused Performance suite: **11/11 passed** after the disappearing-category correction; associated presentation/navigation checks and **14/14** exact-main preservation checks passed. TypeScript no-emit and **56/56** route/state/role render checks passed. Browser console warnings/errors were empty during the final pass. These are local results, not hosted CI.
- Browser recheck confirmed the corrected empty-state category reads **Operations (not available)** rather than silently selecting All categories. Desktop screen-reader row names include Current value and Recorded after the accessibility correction.
- Final captures: [desktop list](/private/tmp/performance-metric-list-desktop.png), [mobile rows](/private/tmp/performance-metric-list-mobile.png), [mobile filters](/private/tmp/performance-metric-filters-mobile.png). The pale toolbar is fixture-only and not part of the application.
- This remains an unmerged local preview; hosted exact-head CI has not run. No backend change or migration is needed for the metric list. Existing bounded source loading remains unchanged; this is not new database-wide pagination.

### Preview and comparison

- After: http://127.0.0.1:3186/app
- Before: http://127.0.0.1:3187/app
- Both are local-only, credential-free previews of real application components with identical deterministic synthetic records, clock and role fixtures. They are **not hosted deployments or proof of backend authorization**. Square retains its actual standalone layout; other screens use the real shared AppShell.
- The preview toolbar switches among seven screens, populated/empty/loading/error states, and owner/viewer contexts. Mutation controls are inert. No uploads, imports, provider calls, account updates, or database requests are possible through the fixture. Error recovery and mutation feedback are explicitly simulated.
- Production and PR #446 were not modified. No merge or deployment was performed for this redesign. No backend change or migration is required by this diff.

### Observed interactive checks

Desktop (1440 × 1000) and mobile (390 × 844):

- Shared navigation acknowledges the first click; mobile menu closes after choosing a destination. Canonical workspace routes remain unchanged. Files & Notes accurately includes business-note entry.
- Intelligence category filters, loaded batches, Summary/Evidence tabs and mobile Back to list work. Returning from the selected mobile finding preserves the Risks filter. Supporting records and date-only reporting values remain visible.
- Performance status filtering opens the correct metric; direct Back to Performance preserves the selected 90-day range and status filter on both widths.
- Files search and batching exposed all 32 synthetic records and the eight Inventory matches; source detail and its canonical breadcrumb return work. Upload and note entry remain explicit, with mapping/approval wording retained. Source breadcrumb return still uses its canonical list destination rather than retaining a search query.
- Saved Analyses type dropdown returned 16 weekly matches; a nonexistent search returned zero, and clearing the filters restored 25 of 32. The real saved-analysis detail route is not simulated or claimed verified.
- Square stored-payment paging reached page 2 of 4; a failed-attempt filter showed a genuine zero-match message. Payment details disclose IDs/UTC timestamps; Manage connection reveals the existing disconnect confirmation only after expansion. No import, disconnect or provider action was submitted. Back to Settings is direct on desktop and mobile.
- Simulated loading, empty and error states render without being confused with populated data. The simulated Try again action restores the filtered Performance screen. This is not evidence of a live failed-request recovery.
- In the inert note-entry preview, the first submit visibly changes to disabled “Extracting business context…”, then a persistent synthetic-unavailable notice; entered text remains. The preview adapter explicitly preserves this fixture input, so this is **not** a new claim about a real server failure. A demonstrated fixture-only default-GET classification error was corrected before this check passed; the application action was not changed.
- Mobile browser testing demonstrated overlapping Files tab labels/counts. The correction prevents flex shrinking and retains horizontal tab scrolling without page-wide overflow. Final scoped Light-theme contrast corrections cover the demonstrated list, note and filter surfaces.

### Focused qualification and review

- TypeScript no-emit check passed.
- Final presentation contract run: **22/22 passed**, including 11 exact-release form-target/named-field/helper comparisons plus seven protected Executive/Intelligence/Performance contracts. The latter preserve 157 protected JSX bindings and non-JSX workflow logic.
- The broader focused 14-script pass was **86/86** before the final CSS-only contrast correction; **29/29** relevant tests passed after that correction. Counts overlap and must not be added together.
- Preview server-render matrix: **56/56 current and 56/56 baseline** (seven screens × four states × two role contexts). Its import/network boundary was checked. Server-render coverage is not browser or real-permission coverage.
- Existing focused synthetic tests cover 320 Intelligence findings, 357 files, 300 Saved Analyses and 413 Square Payments. These larger counts were **not** the records in browser screenshots (32 findings/files/analyses, 78 Payments).
- Independent focused component and final CSS reviews found no remaining material handler, tenant-boundary, Admin-scope or navigation regression. Review caught and corrected the standalone Square theme boundary, Light contrast and preview fidelity issues.
- `git diff --check` passed. Hosted exact-head CI and review are release requirements; the candidate-specific exception is recorded above, not generalized to other failures.

### Comparable screenshots

All comparison screenshots below use the same synthetic account, data, theme, date and dimensions—not different live accounts. The pale toolbar is a preview-only safety/control surface, not part of the proposed application design.

| Screen | Before | After |
| --- | --- | --- |
| Overview, desktop | [/private/tmp/workspace-redesign-before-overview-desktop.png](/private/tmp/workspace-redesign-before-overview-desktop.png) | [/private/tmp/workspace-redesign-after-overview-desktop.png](/private/tmp/workspace-redesign-after-overview-desktop.png) |
| Files, desktop | [/private/tmp/workspace-redesign-before-files-desktop.png](/private/tmp/workspace-redesign-before-files-desktop.png) | [/private/tmp/workspace-redesign-after-files-desktop.png](/private/tmp/workspace-redesign-after-files-desktop.png) |
| Files, mobile | [/private/tmp/workspace-redesign-before-files-mobile.png](/private/tmp/workspace-redesign-before-files-mobile.png) | [/private/tmp/workspace-redesign-after-files-mobile.png](/private/tmp/workspace-redesign-after-files-mobile.png) |

State examples: [loading](/private/tmp/workspace-redesign-loading-mobile.png), [empty](/private/tmp/workspace-redesign-empty-mobile.png), [error](/private/tmp/workspace-redesign-error-mobile.png), [corrected Light-theme filters](/private/tmp/workspace-redesign-light-reports-mobile.png).

### Explicit remaining boundaries

- No live upload/import, real-record Saved Analyses detail, full ordinary-customer pilot journey, or new production permission exercise is claimed.
- Existing cross-page browser-Back state reset remains outside this presentation change; direct in-page return links were checked as specified above.
- Long-name wrapping is implemented in the scoped heading/list styles. The Performance refinement additionally exercised its long metric identities in the browser; other screens' extreme-length records were not separately exercised.
- Real loading latency, mutation duplicate prevention and recoverable server errors rely on the existing focused handler tests; the visual fixture does not prove those backend paths.
- Release qualification still requires exact-candidate review/CI. The nine explicitly authorized exact-path additions are covered by positive and neighboring/backend negative tests; no broad allowance was added.

Normal merge and automatic UI deployment may proceed only under the user's recorded candidate conditions. New material findings or backend scope expansion must stop the release.
