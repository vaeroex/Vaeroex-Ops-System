# Bounded customer Payments history

The initial customer read uses the last 30 days of Payment **updates**, not full
seller history. Normal updates continue from the saved checkpoint with the
existing five-minute overlap. A paid invoice from May can therefore be absent
from a first September read without a connection or location failure.

The historical form requests an explicit inclusive UTC date range of 1–31 days,
one page of at most 100 Payments per click. It searches Payment **creation** time
so later updates do not exclude a payment created in the selected period.
The seller and selected location remain bound to the existing connection.
Invoice records themselves are not imported or interpreted as Payments.

Historical pagination uses the existing fenced lease and query-bound cursor.
An active read must complete before a new historical range can begin. A
historical completion never advances or rewinds the ongoing update checkpoint
or its last-sync timestamp. A stale page cannot replace a newer saved payment.
The screen reports the active range and latest completed range, including empty
results. This is not a claim of continuous or complete historical coverage.

## Release and live verification

1. Review/qualify the additive history migration and this exact code head. Do
   not edit or reapply any previously merged/applied migration.
2. Deploy the compatible application code first. Against the current database,
   missing coverage metadata is shown honestly and historical import stays
   hidden (`historyAvailable` defaults false).
3. Separately approve the history migration's merged hash, exact 106-entry
   Production baseline, and a connected dry run selecting only that migration.
   The migration adds no credentials, grants, connections, or activation change.
4. Verify the existing seller, location, encrypted-credential version, and
   checkpoint are preserved; then request only the intended historical range.
5. For the supervised May 4, 2026 Pacific payment, select May 4–5 UTC. Confirm
   the provider-derived Payment ID, date, COMPLETED status, and USD 4,000.00 on
   the customer screen. Do not manufacture a row from the invoice UI.
6. Read back that the existing ordinary-sync checkpoint is unchanged. If the
   page is empty, report its actual searched dates and stop for evidence-based
   diagnosis rather than disconnecting or resetting the checkpoint.

No native proof VM, role provisioning, Square scope expansion, QBO, scheduler,
webhook, AI, or economics changes are part of this fix. The existing deployment
and Production migration remain separately approved actions.
