# Evidence-backed workspace comparisons

Review-only implementation, stacked on financial-evidence PR #499. Do not merge or deploy without review. No database migration, production data change, connector privilege expansion, public website change, or 3D change is required.

## Where charts appear

- VSI: when an answer cites an admitted `financial_calculation` source, its validated revenue, net income and operating-expense pairs travel with that citation. Numeric data is prepared by application code from authorized stored P&Ls, never extracted from generated prose. A same-entity/connection, currency, basis and compatible-period check is inherited from the financial evidence implementation. Missing totals do not become zero. A maximum of six financial cards can be retained across eligible sources.
- Saved Analyses: a user explicitly confirms sharing a private VSI answer into the workspace's existing reports surface. The server reloads the actor/workspace-bound exchange, checks the existing record-creation gateway and evidence ticket, and saves the original answer, references and chart snapshot. Repeated saves use the existing unique report key. No client-supplied answer or chart values are accepted. VSI snapshots are labeled as responses requiring review, not given an invented confidence assessment. A VSI filter is included in Saved Analyses.
- Performance/KPI details: latest recorded value versus the previous distinct recorded date, plus actual versus the current configured target. Scalar targets and bounded target ranges are supported. Direction and target interpretation use existing KPI semantics. Existing line charts and historical statistics remain. Dates make clear these are observations, not inferred period totals. Unspecified units and non-actual metric series do not produce charts.
- Weekly/monthly briefings: up to three changed KPI signals cited in the accepted briefing, with explicit stored units and temporal lineage wholly inside the briefing period. The first/latest observations are labeled as observations, not prior/current period totals. Charts are stored in the saved briefing envelope. An existing gateway enum omission that rejected weekly/monthly briefing saves is corrected, preserving its owner/admin/manager permission rule.

## Boundaries and limitations

The first financial adapter supports only the bounded P&L cases admitted by PR #499 (including its owner-only financial retrieval). Other financial formats, currencies that do not match, incomplete reports, unsupported total labels and incompatible periods do not receive guessed charts. Expense increases are neutral: direction alone does not establish business desirability.

Old VSI conversations have no chart snapshot and are not backfilled from prose. Old saved analyses still render. Older briefings without explicit unit metadata omit charts instead of guessing units or consulting current source values. Briefings currently visualize supported KPI movements; they do not acquire a new P&L retrieval pipeline in this change.

Charts use a shared zero baseline per pair, support losses and sign crossings, retain exact displayed amounts and source links, and omit percentage change for zero/negative starting values. Percentage-unit differences are labeled in percentage points. Range targets show both bounds. Chart geometry is SVG, with an accessible values table and keyboard-operable evidence disclosure; no animation is introduced. Layout responds to the chart container and supports the existing light/dark palettes.

## Verification

- `pnpm test:workspace-comparisons`: financial eligibility, deltas, zero/negative inputs, safe source links, direction, ranges, unknown units, accepted briefing scope, immutable snapshots; server-action denied role/source/ticket paths, explicit confirmation, and duplicate-save behavior. Registered in CI.
- `pnpm test:vsi`, `pnpm test:intelligence-briefings`, `pnpm test:saved-analyses`: passed locally. The briefing replay suite includes 17 fixed cases and 105 property cases. Provider calls in those tests are stubbed.
- `node scripts/workspace-redesign-ui-tests.js`: 60 route/state/role server renders and preview boundary checks passed.
- Production build, TypeScript and repository lint checked. Lint permits the repository's existing warning allowance; no new lint errors.
- Actual Next.js app + disposable loopback Supabase: saved a labeled fictional VSI exchange through the real server action, reopened its report, repeated the save (existing report returned), and checked the stored chart JSON exactly matches the exchange snapshot. Both weekly and monthly fixture briefings saved and reopened with 8.1 → 6.2 minute comparisons. Wrong-workspace API access returned 403.
- Browser checks at 1440px desktop and 390px/320px mobile: VSI, saved analyses, KPI details and briefing comparisons; keyboard evidence disclosure, source report navigation, and no observed browser errors. The linked P&L shows the matching $27,200 prior revenue and $9,052.80 prior net income.

Browser data is fictional and isolated. VSI uses a previously recorded, genuine answer to the fictional P&Ls; no new paid model request was needed. Briefing save/reopen fixtures are explicitly synthetic and not presented as provider-generated results. No customer records were modified.

The working review is the local app at http://127.0.0.1:3211, using the disposable Coastal Kitchen workspace. Desktop/mobile screenshots and the persistence check are stored in the task's `outputs/workspace-comparison-charts/` directory outside the commit. Run the normal app against a separately provisioned development workspace to reproduce with other data; never seed a production workspace.
