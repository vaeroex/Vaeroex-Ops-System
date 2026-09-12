# Square operational intelligence v1

## Boundary and derived limits

This policy consumes only authenticated `SquareInterpretation` objects created by
the current canonical admission transaction. It does not parse provider payloads,
query Square, infer missing pages, or accept browser-supplied facts.

The current checked database contract admits one explicit approval manifest with
1–13 distinct resource/version entries. Therefore the maximum reachable v1
operational projection is 13 activity rows, 13 evidence references, five type
counts, three exact-money summaries, one order-status map with at most 13 keys,
and 20 relationship-derived states. The pure calculation is additionally capped
at 1,000 distinct facts and 20,000 checked relationship occurrences so a future
schema expansion fails closed rather than becoming unbounded. The authenticated
RPC returns at most 25 activity rows per request, permits no more than 40 pages,
and applies type/status filtering and pagination inside the database. These are
defence-in-depth ceilings; the current 13-entry approval contract is the tighter
reachable bound.

Every input must be an object authenticated by the current invocation's private
WeakSet, have one scope fingerprint, and have a unique resource key. The database
reader first executes the existing session, membership, subscription, entity,
connection, generation, mapping, source-version, retention and approval checks in
one transaction. Application roles receive EXECUTE on one checked RPC and no
table or private-schema read grants.

## Meanings

- Payment, Refund and Order amounts are exact provider minor-unit activity grouped
  by their stated currency. They are not revenue, settlement, net sales or profit.
- An average is emitted only when the exact integer minor-unit sum divides by the
  observed count. Otherwise its state is explicit; floating-point rounding is not
  used.
- The refund numerator and payment denominator are observed completed-record
  counts, not a financial refund rate and not a netting operation.
- Orders retain provider status but are not fulfillment or revenue. The current
  admitted projection does not establish fulfillment state, so fulfillment
  activity is unknown.
- Catalog variation labels may be displayed because they are already minimized,
  admitted fields. Active/inactive lifecycle is not admitted and remains unknown.
  Catalog applicability is not inventory.
- Inventory quantities remain individual observations. Units and completeness are
  unverified, so no movement total, stock balance or valuation is calculated.
- Historical completeness is unknown. Day-over-day, prior-period and trend claims
  are therefore withheld. The deterministic insight layer says why rather than
  guessing.

## Incremental and replay behavior

Operational calculation is committed in the existing interpretation revision.
Its version participates in the input fingerprint, so upgrading v1 produces one
new deterministic revision. Thereafter identical admitted versions replay the
existing revision. The established contribution change-set, dirty-node,
dependency and clean-recompute oracle remains the only incremental engine; this
policy does not add an economic contribution family or a second recomputation
engine. Corrected or removed source versions change only the existing checked
partition and its dirty descriptive controls.

## Activity and privacy

The explorer exposes only: a synthetic evidence reference, resource type, provider
status, admitted timestamp, a generic authority-location label, exact amount and
currency where admitted, individual quantity with an unverified-unit warning,
admitted Catalog label, relationship state, and non-economic admission state.
Provider IDs, workspace/entity/connection/generation IDs, private cursors, source
payloads, credentials, request fingerprints and raw relationship targets are not
returned. Unknown or ambiguous authority returns the same null result as no data.

The dedicated host keeps the existing exact TLS SNI/Host and forwarding-header
boundary. Only `/activity` and its bounded same-origin form join the already
approved sign-in, session, workspace and evidence routes. There are no query-string
filters, scripts, analytics, external assets, raw table reads or model endpoints.

## AI dispatch and abuse analysis

Ingestion, recovery, replay, interpretation, filtering and rendering import no AI
runtime and make no model/network dispatch. The Square dispatch gate is a literal
disabled policy returning `square_ai_dispatch_disabled`; duplicate delivery,
corrections, replay, stale observations and blocked economic changes cannot cross
it. Any future brief would require a separate reviewed milestone operating on a
compact verified snapshot, with user/schedule/material-change authority, budgets,
cooldowns and deduplication.

Reachable abuse is bounded by the 13-entry approval today, strict schemas, exact
integer arithmetic with 40-digit limits, the 1,000/20,000 calculation ceilings,
25-row pages, 5-second database statement timeout, 10-second host timeout, eight
active front-end requests, and one-hour host window. Malformed filters, oversized
forms, unknown routes/hosts, stale sessions, revoked generations and ambiguous
memberships fail before private data is returned.

## Qualification still requiring a separately authorized hosted window

After merge, apply migration 115 only to the isolated Sandbox database, rerun the
existing 13-source interpretation once to create the versioned operational output,
and install the reviewed restricted host. Verify mapped/denial workspaces, exact
counts and minor-unit summaries, pagination and filters, authority revocation,
zero model calls/network dispatch, rejected-host pre-database behavior, and
sanitized HTML. Then close the evidence gate, fence roles, remove temporary access
and stop the VM. Production Square, economics and QBO remain unchanged.
