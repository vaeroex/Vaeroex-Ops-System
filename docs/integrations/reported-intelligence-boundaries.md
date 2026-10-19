# Reported financial and operational evidence

Saved QuickBooks P&Ls can supply owner-only reported financial metrics and VSI context. Report-level Summary-only sections are interpreted as totals only when the parser emits a single summary immediately under an empty root wrapper. Named, nested, duplicate, truncated and multi-child structures remain ineligible. Row numbers and original observations are preserved.

The KPI page shows these measurements separately from canonical tracked KPIs. They do not assert coverage, reconciliation, cash flow, workforce completeness or Business Health eligibility. Authenticated owner/session/source checks remain required; no report is copied into shared reports or briefing storage by this feature.

Clockify saved history and Zoho Inventory snapshots may provide VSI context through their existing permission-filtered reads. Clockify contains the API key owner's entries, not the workforce or payroll. Its period membership uses UTC entry start and full completed durations, including boundary-crossing entries. Missing dates are unavailable, not zero; observation freshness uses selected-history import time rather than an unrelated connection refresh. Zoho provides current item counts, not historical purchasing, consumption, inventory valuation or COGS. Neither report contributes canonical KPIs or Health evidence.

The final model input omits redundant chart layout metadata while retaining source text, hashes and calculation dependencies. Citation cards retain their charts. Current source IDs receive short turn-local aliases; historical IDs remain reserved. Structured citation IDs are restricted to available sources, and independent inline/link/dependency validation still runs. Final context truncation is disclosed. Retrieval does not guarantee that every available record fits or that every supplied source is cited.

## Remaining contracts

Canonical QBO mapping is revenue-only. Journal balancing does not make expense/payroll/inventory lines into cost facts; report summaries remain non-contributing. Cost/profit KPIs require versioned cost classification, contribution families, coverage/completeness, period, source-authority, deduplication and lifecycle-retraction contracts. Existing Health and normal brief gates must not be weakened to accommodate report-only evidence.

Normal brief and saved-report storage is workspace-member-readable. Owner-only QBO evidence cannot be silently persisted there. A reported-financial brief would require a distinct contract and owner-scoped storage/read/revocation semantics, or an explicit reviewed sharing policy. The present change does not create such a brief.

Inventory valuation needs historical purchases, opening/closing stock and movements; current counts or purchase_rate multiplied by stock are insufficient. Workforce time needs explicit workforce scope and verified coverage, not an expansion of a connection advertised as personal time. Square production gates remain unchanged.

## Validation

Run `pnpm test:vsi`, `pnpm test:reporting-connectors`, `pnpm typecheck`, and targeted ESLint checks. New tests cover provider-shaped P&L parsing, exact row provenance, losses/zero/profit, tenant/status/freshness/missing-history boundaries, owner-only panel rendering, currency separation and citation aliases. Synthetic end-to-end evaluation used fresh isolated local tenants and real model responses, with independent ground truth outside retrieval. It is not live provider synchronization or a calibrated accuracy benchmark.
