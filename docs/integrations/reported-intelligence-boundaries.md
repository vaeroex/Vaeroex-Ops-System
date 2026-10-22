# Reported financial and operational evidence

Saved QuickBooks P&Ls can supply owner-only reported financial metrics and VSI context. Report-level Summary-only sections are interpreted as totals only when the parser emits a single summary immediately under an empty root wrapper. Named, nested, duplicate, truncated and multi-child structures remain ineligible. Row numbers and original observations are preserved.

The KPI page shows these measurements separately from canonical tracked KPIs. They do not assert coverage, reconciliation, cash flow, workforce completeness or Business Health eligibility. Authenticated owner/session/source checks remain required; no report is copied into shared reports or briefing storage by this feature.

Clockify saved history and Zoho Inventory snapshots may provide VSI context through their existing permission-filtered reads. Clockify contains the authenticated provider user's entries. The person's business role and ownership are unknown; these are not workforce or payroll totals. Its period membership uses UTC entry start and full completed durations, including boundary-crossing entries. Missing dates are unavailable, not zero; observation freshness uses selected-history import time rather than an unrelated connection refresh. Zoho provides current item counts, not historical purchasing, consumption, inventory valuation or COGS. Neither report contributes canonical KPIs or Health evidence.

The final model input omits redundant chart layout metadata while retaining source text, hashes and calculation dependencies. Citation cards retain their charts. Current source IDs receive short turn-local aliases; historical IDs remain reserved. Structured citation IDs are restricted to available sources, and independent inline/link/dependency validation still runs. Final context truncation is disclosed. Retrieval does not guarantee that every available record fits or that every supplied source is cited.

## Opt-in canonical journal subtotals and private financial briefs

The separate `qbo_journal_accounting_v2` contract admits current, validated, balanced JournalEntry lines against owner-approved Account versions. Revenue, cost of goods sold, labor and other operating costs are nonadditive to P&L reports and other transaction types. Operating profit is a decimal-derived subtotal, never a fabricated original fact. Missing classifications, invalid journals, changed source heads, authority/session revocation and incompatible currency/periods fail closed. Whole-ledger coverage remains unknown.

Owners configure `/app/settings/integrations/quickbooks/journals` with explicit v2 consent and process at most 25 imported journals per action. The existing revenue-only policy is unchanged. `/app/intelligence/briefings/financial` reads current receipts, shows journal subtotals and uses the existing bounded briefing writer/validator under a separate limited financial projection. It stores prose only in an owner-private table. No artifact is copied to member-readable `ai_agent_runs` or `reports`; no shared KPI row or global Health score is created. Source links revalidate the full receipt before showing exact-version Account classification or Journal debit/credit lines.

Generation uses the existing subscription, token-budget and provider-rate policies, a native owner claim, a server-only completion lease, and atomic source revalidation at completion/read. At most ten claims per owner/workspace per day are admitted. Same-state processing/failed attempts remain retained; they are not silently regenerated. A changed source receipt or UTC day creates a distinct generation key. No explicit same-state retry UI is included.

Apply the CLI-created journal migration before the private briefing migration after the existing QBO production candidates. Both are included in the disposable database qualification tail. They are review candidates; adding files does not apply a remote database change. The KPI page discovers up to four journal periods from saved P&L periods; journal-only users can choose dates from the journal settings link.

## Remaining contracts

Full canonical financial coverage still requires other transaction families, reconciliation, complete-period evidence and retraction qualification. Overall Health and shared normal-brief gates remain unchanged. The narrow private briefing supplies financial comparisons, not multi-source operational diagnosis, calibrated confidence or complete business health.

Inventory valuation needs historical purchases, opening/closing stock and movements; current counts or purchase_rate multiplied by stock are insufficient. Workforce time needs explicit workforce scope and verified coverage, not an expansion of a connection advertised as personal time. Square production gates remain unchanged.

## Validation

Run `pnpm test:vsi`, `pnpm test:intelligence-briefings`, `pnpm test:reporting-connectors`, `pnpm typecheck`, and targeted ESLint checks. New tests cover provider-shaped P&L parsing, exact row provenance, losses/zero/profit, tenant/status/freshness/missing-history boundaries, owner-only panel rendering, currency separation and citation aliases. Synthetic end-to-end evaluation used fresh isolated local tenants and real model responses, with independent ground truth outside retrieval. It is not live provider synchronization or a calibrated accuracy benchmark.
