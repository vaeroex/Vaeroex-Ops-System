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

The later hosted result-reference test succeeded mechanically: its answer was
saved/reopened and accounting completed once. Its selection was still weak:
purchase-bill and untyped zero contributions appeared in an explicitly
sales-invoice question. A scoped current-source audit contains relevant typed
invoices on October 13 and 14 that the answer did not select. That audit is not
an immutable replay of the entire historical request. The supported contract
defect is narrower: family labels were only advice; every Xero fact index was
selectable. Whole-original packing did not individually discard later invoices.

## Correction

Xero facts identify sales-invoice versus purchase-bill contributions only from
unambiguous per-record count markers and currency consistency. Missing,
contradictory or ambiguous markers stay unclassified. All zero values remain,
including valid zero-value invoices. Provider and scope are retained once in
source context and application attribution instead of repeated in each fact;
values, units, dates, order, original hashes and canonical data are unchanged.
New fact presentation changes future preparation/snapshot hashes as intended.

For an explicitly sales/customer-invoice, receivables or billing/collections
question, the prepared source now issues index groups for its unambiguous sales
invoices. The request schema and independent renderer both restrict Xero
observations to those groups. Neutral and purchase/mixed questions retain
ordinary selection. Eligibility comes from count/currency markers, never from
positive amounts: a genuine zero invoice remains eligible. Unknown record
families cannot substitute for required typed invoice evidence. If the required
scope has no eligible facts, the engine stops before planning/provider use with
known evidence-unavailable accounting. Malformed issued metadata also fails
closed. Existing negative-value parsing is unchanged.

The model receives at most three advisory invoice groups, prioritizing supplied
Sheets row-date labels and then newer invoice dates. Older eligible invoices
remain selectable. This does not establish shared entities, matching records,
balance observation times, comparable periods, completeness or causal links.
The original facts, fact indexes, canonical source text and bindings stay intact;
the preparation fingerprint binds the new eligibility metadata. Full request
measurement includes the dynamic selection schema and review-order metadata.

Cross-original `missing_information` accepts the closed item
`{kind: "selected_fact_time_comparison", premises: [...]}`. Each premise must be
an exact observed ref/binding/fact-index tuple, with independent business roots
and compatible access environments. Model text, verdicts or dates in that item
are rejected. The application renders one explicitly labeled date assessment
across all selected business observations. A model-supplied premise subset may
not narrow or duplicate that assessment, including answers with more than the
24-premise item limit. All premise authorization and independence checks remain.
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

The invoice regression uses 27 records/135 facts with the retained family/date
shape but invented identifiers and positive amounts. It covers typed zero
invoices, irrelevant bill zeros, ambiguous markers/currencies, strict bindings,
canonical packing, insufficient budgets, a single date assessment across 34
observations and the actual engine's full transmitted schema/request size.
Both existing isolated cases remain unchanged. These tests prove enforceable
selection boundaries, not that a model will choose every useful invoice or
produce good synthesis. Nonnumeric misleading draft claims can still pass
structural checks; manual usefulness and semantic review remain necessary.
