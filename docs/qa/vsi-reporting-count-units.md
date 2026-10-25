# Shared reporting metric units

Local runtime correction: `fe0ca278404c8685d49904f0eb29895cdc08339f`. Its parent tree matches the released gates-off tree from PR #544. This correction is local only; no SQL, ingestion, credentials, model routing, feature activation or saved-record changes are included.

## Confirmed defect and scope

The hosted answer selected a valid Xero invoice-count fact but displayed `invoices: 1 USD`. The reporting adapter correctly stores a count of one and retains the invoice currency for grouping. The generic shared projection incorrectly treated any currency property as the metric's unit. This happened before fact issuance, so both the model context and application-rendered answer received the wrong unit. It was not merely a UI suffix or a rejected-reference problem.

The existing typed reporting adapters already distinguish units from partitions. One pure helper now supplies that same closed metric contract to those adapters and the runtime shared projection:

- Xero `invoices` and `bills`: counts, retaining the original currency as a labeled partition, for example `1 count (currency partition: USD)`.
- Xero `billed`, `outstanding` and `purchases`: monetary values in the source currency.
- Harvest/Clockify entries and running entries, Toggl projects, and inventory metrics: explicit counts. Time metrics retain explicit hours.

Unknown metric keys, incompatible provider/history/snapshot combinations, missing or malformed currency, and unsupported currency on non-Xero metrics fail closed. Counts require an exact integer decimal representation; nonzero fractional digits cannot be rounded away by conversion to a JavaScript number. Values are displayed from their original decimal strings without rounding.

## Preserved contracts

Extraction, raw metric values and currency metadata, source identity/hash, source-local fact order, workspace/actor/session authority, admission, revocation, calculation dependencies, and citation rules are unchanged. Corrected facts naturally produce new preparation fingerprints and citation text snapshot hashes; immutable original bindings and source-link anchors are not rewritten. Financial boundaries still use raw currency partitions.

Protected source reopening returns revalidated canonical projection JSON and preserves its raw metadata. Existing saved answer text is immutable and is **not retroactively repaired** by this code change. The observed hosted answer remains evidence of the old unit error.

## Local qualification

Regression coverage follows synthetic provider extraction through shared fact projection, issued fact selection, answer/UI rendering and mocked protected-source reopening. Mixed currencies, counts versus amounts, zero counts, decimal precision, fractional hours, incompatible metric/unit combinations, source immutability and invalid reference selections are covered.

Older synthetic packing/evaluator fixtures used invented Xero metric labels such as `invoice balance`. They now use the actual `outstanding` key while preserving values, scenario limitations, source separation and manual usefulness criteria. The context stress fixture uses additional valid records rather than padded metric names. Existing size ceilings, source coverage, authority and rejection assertions are retained. The credential-free evaluator remains pinned to the exact runtime tree with unchanged two-question/four-call/$1 controls and no live transport.

These are local mocked checks, not fresh provider ingestion or hosted quality proof. Source-link opening during activation remains unverified: the previous attempt restored gates off before opening the protected source page, whose off-state guard deliberately makes it unavailable. A separately approved future bounded activation must check the intended citation links before restoration, while reserving enough time to restore on any failure. Do not reactivate or repeat generation under the consumed prior approval.
