# Cross-source selection and date comparison

This is a local, inactive correction. It changes no source records, saved answers,
authority rules, feature switches, provider routes, budgets or citation access.
The production-equivalent base is `2e64b0f0c3a25461eba095b6804c63463bbeac85`,
tree `4e9fdb467e30852c3e42290083e2e05ed8d74b1d` (production merge `35a7d18b`).

## Evidence and limits

Retained real synthetic evaluation answers demonstrated a useful qualified
invoice/order-reference check and a useful refusal to infer billing-to-operations
causation from sparse observations. That is more than separately listing two
sources, but proves only those two cases. The hosted flow also admitted sources,
saved an answer and reopened it. Its saved answer incorrectly described selected
Xero contributions dated October 13 as being for the Sheets dates October 14–15.
The answer hash still matches its original receipt; it has not been rewritten.

A narrow current-source read finds purchase-bill records carrying zero invoice,
billed and outstanding contributions, alongside real invoice contributions on
other dates. Current data is not an exact captured model request. The complete
historical projection hash was not recomputed, so current invoice availability
does not prove which records were available in that earlier call. Source packing
preserves whole originals and fact order; it cannot selectively remove later
facts from an admitted original. The failing sentence is reproduced with a
sanitized structurally equivalent fixture, not an invented recovered response.

## Correction

Xero facts identify sales-invoice versus purchase-bill contributions only from
unambiguous per-record count markers and currency consistency. Missing,
contradictory or ambiguous markers stay unclassified. All zero values remain,
including valid zero-value invoices. Provider and scope are retained once in
source context and application attribution instead of repeated in each fact;
values, units, dates, order, original hashes and canonical data are unchanged.
New fact presentation changes future preparation/snapshot hashes as intended.

Cross-original `missing_information` accepts the closed item
`{kind: "selected_fact_time_comparison", premises: [...]}`. Each premise must be
an exact observed ref/binding/fact-index tuple, with independent business roots
and compatible access environments. Model text, verdicts or dates in that item
are rejected. The application compares only those selected facts' typed dates.
Unselected matching dates cannot change the result. Unknown timing stays
unknown; equal labels do not establish equal measurement periods. An outstanding
balance at import is not measured on its document date.

The former free-text cross-original limitation is rejected rather than rendered
alongside a contradictory warning. This deliberately restricts that field:
specific linkage, coverage and status requests belong in proposed `next_checks`.
Hypotheses, proposed checks and single-original assessments remain explicitly
unverified prose. This is a narrow contract boundary, not a language classifier
or a guarantee that no misleading date/causal statement can appear elsewhere.
Invalid draft prose is not automatically moved into another field.

## What an acceptable answer must do

- Compatible synthetic case: preserve the outstanding balance and payment-hold
  count, propose checking existing order/invoice references and payment status,
  and withhold any balance allocation or claim that nonpayment caused a hold.
- Mismatched case: report the selected document date versus supplied row dates
  and request aligned observations and identifiers before comparison. Neither
  retrieval-window overlap nor an unselected invoice repairs the mismatch.
- Sparse/unknown case: explain the temporal uncertainty, withhold the requested
  causal conclusion, and ask whether delays occurred and what linked records,
  status history and population coverage would support further investigation.
- Merely listing sources or saying "review alongside" remains a manual quality
  failure, even when the schema and citations pass.

Offline tests cover the actual engine with mocked transport, aligned labels,
mismatched labels, missing timing, exact reference and independence attacks,
cross-workspace/revocation failures, count/money semantics and complete request
budgets. The closed item rejects injected causal or alignment verdicts; other
unverified prose still needs honest semantic review. No test here proves model
accuracy, invoice/order reconciliation, general multi-provider performance or
working hosted citation navigation. No paid evaluation or release is included.
