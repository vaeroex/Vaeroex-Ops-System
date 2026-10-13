# Coastal Kitchen connected-insights capture review

Reviewed against PR #497 application tree `1bb151d7b44d869899acc5ff4e7340c74f519b58`. This is a focused capability check for the requested marketing captures, not a new feature implementation.

## Capture decision

**Do not publish a “Connected insights” result yet.** The current connector browsers can display the three approved provider examples, but none of the four inspected analysis workflows consumes the full accounting observation needed to support the requested combined assessment. A polished answer based on separately uploaded financial files would demonstrate file analysis, not prove that those connector records are considered together.

| Existing workflow | What it actually uses | Suitability for this example |
| --- | --- | --- |
| Intelligence / Health explanation | Normal eligible metrics, operational records and approved supporting context; explanations are bounded to deterministic score drivers and approved investigation steps. | Useful for the approved health/finding captures. Not a general cross-source profit-and-loss assessment. |
| Weekly/monthly Briefings | Period-bounded package of eligible workspace records, KPI history, findings and Business Notes. Its package builder does not load the connector report browser’s P&L rows. | Structured reporting and history remain useful; cannot establish this connector example’s full costs/profitability. |
| VSI | Approved files/memory, Business Notes, KPIs, findings, health and saved analyses, plus bounded integration-dashboard results. | Best existing interface for a cited assessment and proposed campaign, once the relevant evidence is genuinely reachable. Current connector coverage is insufficient for the requested combined result. |
| Saved Analyses | Preserves completed Health explanations, finding explanations, weekly and monthly briefings. Reopening does not generate or expand evidence. | A destination for supported saved results, not an independent route around the retrieval gap. |

## Exact integration boundary

- `lib/vsi/retrieval.ts` calls `loadIntegrationDashboard`, not the QBO stored-report detail reader.
- `lib/integrations/dashboard/server.ts` exposes at most the latest saved completed Square payment per eligible connection. The payment is explicitly **not posted revenue or a settlement total**.
- QBO dashboard results are approved **monthly posted revenue subtotals**, explicitly partial accrual subtotals. They do not include the stored P&L’s cost of goods, labor, other expense or net income rows. Disconnected connections provide no financial results to this dashboard.
- The current marketing provider fixtures intentionally represent disconnected saved records, not invented OAuth connections. Their browsable records must not be silently promoted into connected analysis inputs.
- Eligible Google Sheets metrics can enter VSI through normal KPI loading, including source-conflict/read-ticket/provider-policy checks. The screenshot’s selected-cell preview itself is not an imported KPI and cannot be treated as one.
- `lib/ai/intelligence-briefing/workspace-context.ts` loads eligible workspace records; it does not fetch these QBO P&L report details or aggregate Square payment rows.
- `lib/ai/business-health-explanation/service.ts` expressly limits the writer to supplied immutable score facts and approved next investigations. Broad campaign planning does not belong in that explanation.
- `app/app/reports/saved-analysis-actions.ts` allows four existing completed-artifact types; there is no separate arbitrary cross-integration report generator.

## Smallest proposed workspace change — requires separate review

Extend the **existing VSI evidence producer**, without adding navigation or changing models:

1. Read permission-eligible stored QBO P&L observations with original source links, entity, currency, accrual/cash basis, exact period, retrieval time and freshness. Preserve the existing disconnected-record and source-authority rules; decide explicitly which historical records may be analyzed.
2. Supply a bounded Square payment coverage summary with refund/tax/settlement limitations. Never label a handful of payments as weekly revenue and never add overlapping Square and QBO totals.
3. Retain Google Sheets KPI provenance, mappings, targets, conflicts, expiry/deletion fences and dedicated-provider policy. A preview must remain distinct from an approved import.
4. Test overlapping revenue, incomplete coverage, period/basis/currency mismatch, stale/disconnected evidence, tenant isolation, deletion and citation links. The answer must separate observed relationships from unproven causal explanations and proposed actions.
5. Generate and review an actual Coastal Kitchen response through VSI, then capture its existing conversation interface for the new default website tab.

No provider-summary injection, fabricated citation, source-authority bypass or marketing-only analysis component is included in this PR. The existing three tabs remain until the combined result is supported.

## VSI campaign example

The dataset has no dish-level sales, recipe costs, guest comments or dish preferences. Aggregate guest satisfaction and accounting totals cannot establish which dish is most profitable or popular. Use the user-approved broader prompt:

> Based on the business information available, which marketing campaign should Coastal Kitchen prioritize over the next two weeks? Explain your recommendation and build a practical plan with a proposed budget, preparation steps, sample messaging, and measures of success.

Any future capture must retain the real generated text/citations and distinguish its proposed budget and expected outcomes from observed results. The current approved capture harness is read-only, has no model transport, and intentionally blocks live backend imports. It cannot produce this answer by itself. Do not insert a written answer into its fixture data.

## Reuse and boundaries

The reusable scenario remains in `scripts/website-demo/data.ts`, `context.ts`, `integration-data.ts`, and the existing manifests. See `docs/coastal-kitchen-demo.md` for periods, source relationships and regeneration. The hosted marketing preview serves static image assets only. There is no production Coastal Kitchen account or workspace. Existing scores, 16 approved images, pricing, disclosures, application behavior, 3D scenes and the main auto-deployment hold are preserved.

Visible captions now use **Coastal Kitchen · Fictional business example** beneath each image/group. Implementation and synthetic setup detail belongs in these internal records, not warning banners in the marketing interface.

## Environment verification (2026-10-13)

The existing Vercel Preview has its configured provider Secret; it is non-readable and was not extracted. Development has no provider variable. Supabase project inventory shows Production and one separate non-production project, `vaeroex-business-notes-preview`. An aggregate/schema-only inspection of that non-production project found four existing workspaces, latest migration `20260817185529`, no `vsi_conversations` table, and no `begin_google_sheets_read_v1(uuid,uuid)` function. No workspace content was read or modified.

That project cannot run the current VSI workflow as-is. Its upgrade and existing-workspace qualification are outside this imagery change. The existing capture fixture dataset is not seeded there. A Vercel-hosted function cannot use the isolated local database's loopback URL. No tunnel, source-authority bypass, credential extraction or production demo workspace was created.

The repository's guarded `workspace-closeout-local-stack.cjs` assembled a fresh disposable native stack with all current migrations under `/private/tmp/vaeroex-closeout-assembly-coastal-vsi`. Its private configuration remains outside Git. Provider configuration is absent; no model call or scripted answer was produced. For resumption, configure a dedicated local development key privately in `/private/tmp/vaeroex-closeout-assembly-coastal-vsi/provider.env` as `OPENAI_API_KEY=...` (file mode 0600). Never paste its value into chat. This file is separate from the local database configuration and must never be copied into the website build or repository. Loading a key does not authorize any customer/production data access.
