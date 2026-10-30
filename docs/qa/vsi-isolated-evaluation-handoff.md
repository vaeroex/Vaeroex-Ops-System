# Fixed synthetic evaluator cases and review

This public package is credential-free. Its CLI supports `--plan` and mocked `--dry-run` only; it has no live mode, credential reader or supplied real transport. Owner-only launcher, key-input, transport and review-file helpers are not included. Preparing or testing these fixtures does not authorize key creation or model requests.

Both cases use the actual full engine prompt, schema, packing and validators with mocked source authority and no production clients or writes. Every observation is invented locally, not imported from a provider. The neutral first question does not state the expected conclusion. Each case receives fresh objects and distinct original/version/connection identities and citations; the second question cannot inherit the first case's answer or evidence.

## Case-specific evidence and expected usefulness

- `qualified-brief`: one fictional entity, 14 October 2026 at 17:00 UTC. A Xero-shaped observation records **USD 1,200 outstanding as of import**; an independent Sheets-shaped observation records **3 orders explicitly recorded on payment hold**. Both have partial supplied coverage. A useful answer identifies a specific qualified payment-hold/receivables follow-up and cites both originals. It must explicitly identify missing invoice/order linkage and propose checking the hold reason, matching identifier and current payment status before assigning any balance to an order. Coexistence supports that follow-up, not a cause, matched balance, ratio, profit, cash loss or trend. Separate summaries or generic “warrant review” wording fail usefulness.
- `unsupported-cause`: the original sparse fixture and question remain unchanged: a single-day **USD 50 invoice balance**, **6 dispatches** and **4 end-of-day backlog items**, with unknown coverage and no record linkage. A useful answer explains with both citations why these different quantities do not establish a billing-to-operations relationship or causation, and specifies missing evidence and a next check. An empty interpretation list is appropriate. It must not inherit payment-hold observations or conclusions from the first case.

Neither USD balance is revenue, cash received, profit or a period flow. Counts are not money. Neither fixture supplies matched invoices/orders, complete business coverage or causal evidence. Source coexistence is not proof of a business relationship. A mechanical validation pass is not a usefulness judgment, and mocked replies do not establish real-model quality or provider ingestion.

## Manual review and unchanged safeguards

After a mechanically passing answer, the evaluator stops at `awaiting_manual_review`. The injected caller must inspect the exact retained answer and supply an honest manual assessment with an exact 20+ character passage, at least 80 characters of specific rationale, and the required boolean fields. Missing fields are rejected; any false field stops the run without another request. No answer is automatically approved.

All cases require `factsCorrect`, `bothOriginalsSupport`, `uncertaintyPreserved`, `noUnsupportedCausationOrJoin`, `noUnsupportedMath`, and `specificMissingEvidenceAndNextCheck`. The first also requires `meaningfulCrossSourceConnection`, `notMerelySeparateSummaries`, `specificQualifiedFollowUp`, `missingInvoiceOrderLinkageExplicit`, `noBalanceAllocationOrRatio`, and `noProfitCashLossOrTrend`. The second requires `unsupportedConclusionWithheld`.

The default mocked answer deliberately remains generic so an honest review rejects it. Richer mocked replies test only the review workflow. Exact premises, independent sources, canonical citations, workspace boundaries and the pinned application trees remain enforced. Limits remain two fixed questions, at most two requests per question/four total, and a one-dollar request reservation budget. Requests must use `gpt-6-luna`, `store:false`, the fixed official OpenAI Responses destination and no web/tools, fallback or automatic retry. Synthetic outputs are retained privately outside Git with 0700 directories/0600 files; no authentication headers are retained.

## Credential-free checks

The current offline evaluator pins snapshot
`62adf118466394eda92ed1459d83af1d23c9e237`, incorporating the reviewed legal action
and its TypeScript RPC declaration. The exact application-tree and dirty-worktree
guards remain mandatory. This snapshot update is synthetic regression evidence
only; prior real-model results retain their original provenance.

```sh
node scripts/vsi-isolated-contract-evaluation-tests.cjs
node scripts/vsi-evaluator-runtime-guard-tests.cjs
node scripts/qualitative-evidence-assessment-tests.cjs
```

These checks include fresh case-local data, distinct actual engine payloads/citations, rejection of cross-case premises in both directions, the unchanged sparse limitation, forbidden assertions and budget/privacy boundaries. GitHub runs the existing credential-free VSI suite and Linux build. No application gate, deployment, import, key or paid call is enabled by this fixture update. Any future paid evaluation requires a separate reviewed secure transport and explicit approval; it is not available through this CLI.
