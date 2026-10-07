# Executive Intelligence advice: focused evaluation

Scope: the deterministic next step for KPI target misses, the fixed Explain Finding package and output check, and Business Health executive-analysis input and output check. Synthetic fixtures use the two customer-reported KPI values; no customer records or provider credentials are included. Baseline is merged main `271146e8`.

## Cause and evidence path

`/app/intelligence` loads workspace-scoped, parent-eligible KPI rows and builds findings in `lib/intelligence/layer.ts`. A material target miss previously received the same hard-coded next step regardless of metric. Explain Finding then copied that next step into `approvedInvestigationNext`, selected at most eight eligible supporting records for its citation manifest, and prohibited the model from inventing a different recommendation. Business Health selected its weighted drivers and citations, but its model payload contained driver facts without those approved next steps. Its four prose fields therefore had little distinct action to express. Both flows validate model output, attach application-owned citations, and save completed artifacts under the workspace.

The change uses the already eligible KPI row and confirmed KPI semantics. It does not retrieve or quote unrelated review text or join separate findings. Where the KPI row contains a review-text field, the advice reports only that the row has text; it still asks for review-level records and a verified metric definition. The Health model now receives each selected driver's approved investigation. Existing artifacts without that optional field still parse, while the changed package fingerprint requests fresh analysis for new evidence and actions.

## Representative comparisons

| Case | Current approved action or input | Improved approved action or input | Result |
| --- | --- | --- | --- |
| 1-Star Reviews, six periods, no review text | “Decide whether leadership should investigate the cause now or continue monitoring the next reporting period.” | Examine source reviews for the measured periods now; group recurring complaint themes and assign an owner to follow up. Obtain review text, dates and identifiers, and confirm what the KPI counts before treating its value as unique reviews. | Names records, investigation, owner and missing definition. No assumed review contents or unique-review count. |
| Same KPI, a review-text field in the eligible KPI row | Same generic action. | Says the source row includes review text, asks for the full review-level records, and retains the definition check. | Does not copy the text into advice or claim the one row represents all reviews. |
| Receiving Delay (hrs), three periods | Same generic action. | Inspect receiving transactions in the measured periods; compare arrival/completion timestamps by supplier, site and shift where recorded; assign an operations owner to check the largest verified delays. | Names the records and fields needed before a cause can be documented. |
| Stale review evidence | Generic action despite old evidence. | Refresh the KPI and source records first, then inspect the historical reviews. | Avoids presenting an old aggregate as a current operating condition. |
| Receiving delay plus unrelated customer exception | Two findings could be read together without matching source or period. | The receiving advice permits comparison only after matching period, site and source records. | Does not claim the delay caused customer or order exceptions. |
| Business Health executive analysis | Top driver facts reached the model; approved next investigations did not. The reported live result repeated that the KPI gap did not prove a cause. | Each selected driver brings its bounded investigation into the model input. The fields have distinct roles: score interpretation, leadership priority, specific next step. A repeated causal caveat or a generic next step for these two KPIs fails validation. | The output contract remains unchanged; citations and saved analyses remain application-owned. |

The automated set asserts source-specific action text, no unsupported causal or uniqueness claim, stale-first ordering, distinct-source non-linkage, output rejection of generic examples, unchanged citation identity, and parsing of both new and historical Health artifacts. A loopback-only browser fixture hydrates the actual Intelligence finding and Business Health analysis components at 1440px and 390px, opens the mobile finding and Health dialog, and checks the full action, stale warning, citation view, and viewport fit. The fixture simulates a validated model response and blocks external requests; it does not verify that a live provider will produce the sample prose or that an authenticated Supabase route saves it. No real model request was needed for this comparison; incremental test spend is **$0**.

## Customer evidence still needed

- For review advice: actual review text with dates and identifiers, the source's definition of the KPI and whether values count unique reviews, and an owner/outcome for follow-up.
- For receiving advice: transaction-level arrival and completion times with supplier, site and shift where available, plus a documented investigation result.
- To compare receiving delays with order or customer exceptions: matching reporting periods, entities and source records. The present KPI aggregates alone do not establish that relationship.

The model remains on the configured provider and model policy. Existing score calculations, source eligibility, workspace authorization, citations, quota controls and saved-history behavior are unchanged.
