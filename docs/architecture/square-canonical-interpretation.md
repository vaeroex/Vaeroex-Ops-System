# Square canonical interpretation and reconciliation v1

## Boundary

This is a Sandbox-only deterministic interpretation of **already admitted**
provider observations. It preserves generation 4 onboarding and the 13-record
baseline. It does not read Square, create fixtures, authorize a source, register
an integration, refresh consent, or produce economic contributions. QBO and the
shared economic registry are unchanged.

`square_canonical_interpretation_v1` stores a distinct immutable canonical-shaped
fact for each admitted source version. `square_observed_relationships_v1` records
explicit identifier relationships. Neither means accounting reconciliation.

| Resource | Interpretation | Explicitly not inferred |
| --- | --- | --- |
| Payment | Provider status, exact amount/tip/total/refunded aggregate, timestamps and order reference | Revenue, settlement, cash accounting, verified refunds |
| Refund | Provider status, exact Money, linked/unlinked declaration and payment/order references | Net payment value or economic reversal |
| Order | Provider lifecycle status, totals and tender payment references | Revenue, fulfillment, payment completion |
| Catalog variation | Seller-scoped object, listed price, timestamp and authorized-location applicability | Physical stock or inventory movement |
| Inventory | Distinct count snapshot, physical count or adjustment; exact quantity text, measurement reference, states/locations and Money | Computed stock, valuation, movement equivalence or complete history |

Existing minimized schemas remain the parsing authority. This policy adds no
Money coercion, currency conversion or changed provider acceptance rule. Nullable
Money/currency and optional fields remain nullable. Original projections remain
in immutable source provenance, including fields not promoted into this v1 view.

## Provenance and relationships

Every interpretation retains workspace/entity/connection/seller/environment/
generation/location scope, provider record ID/type/revision, source record/version
reference and fingerprint, observed time, provider timestamps, policy version and
rationale. Source and admitted observation records remain unchanged.

Fact identity excludes mutable scan/freshness assessment. A later source version
gets a new fact; replay of the same source does not. Freshness/scan changes belong
to the derived assessment. Identical duplicate delivery is idempotent; conflicting
duplicate versions or assessments reject rather than choosing arrival order.

Links require matching explicit IDs within one authority scope. Outcomes include
target unobserved, explicitly unlinked, stale/unknown, unknown/mismatched location,
currency mismatch, contradictory order reference and observed ID match. An ID
match **does not** establish monetary equivalence, completeness or permission to
net resource types. Catalog applicability is checked independently of seller scope.
Missing references do not create guessed relationships. Legacy Inventory refund
or transaction identifiers are not promoted to modern Payment/Refund authority.

The repository derives **source observation age**, not synchronization health:
at most 24 hours is `observed`, otherwise `stale`. An unchanged record may retain
an older observation time after a successful rescan. This intentionally makes no
claim about current sync health. Scan state defaults to unknown; even an exhausted
scan never proves complete history. Interruptions and unavailable pages do not
delete prior observations or imply zero activity.

## Incremental execution and durable commit

`interpretAdmittedSquareSources` uses an exclusive, injected native transaction
client; it does not obtain credentials. Migration `20260911205108` adds two private
FORCE-RLS tables and checked SECURITY INVOKER entrypoints. No browser, service-role,
broker or ingestion-runtime grants are added. The existing native administrative
observation approval is reused, including actor membership, current mapped
generation, revocation, retention, source-current-pointer and receipt checks.

The v1 execution partition is the existing finite approval manifest (at most 13
sources), not an entire business or connection-wide total. Checkpoints are keyed
by connection, generation and the sorted resource-key set hash. Renewed approvals
and corrected versions reuse that partition; different or overlapping subsets
have separate checkpoints and must never be summed as independent totals. Stored
output labels this manifest-limited coverage explicitly. It reads checked inputs, derives facts and
reference assessments, compares the prior input fingerprint, and atomically
commits immutable facts plus a revision-CAS derived checkpoint. Connection-local
serialization and authority/source locks span the transaction. Revocation blocks
even replay. Lost COMMIT acknowledgement returns uncertain; a fresh checked read
reconciles it. No automatic retry loop or model call occurs.

Descriptive count controls use the existing dependency registry, change-set,
dirty-node, correction and watermark engine in a separate `square_descriptive`
namespace. Only affected resource/status/location buckets recalculate. They never
enter generic economic contribution tables or Business Health. The new incremental
entrypoint omits the full recomputation oracle during ordinary processing; tests
compare its result with that oracle. The old equivalence API is unchanged.

Pure helpers allow at most 1,000 observations and 20,000 explicit references;
the durable approval remains capped at 13. Stored output is bounded to 16 MiB.
The existing raw-response and projection limits are unchanged. Facts/runs carry
source retention deadlines. No purge or retention-policy change is introduced.

## AI policy: no dispatch enabled

Ingestion, replay, reconciliation, recovery and this worker have **no AI client**.
Regression tripwires fail on AI-runtime imports or outbound network use while
running the actual synthetic ingestion/replay suite and interpretation scenarios.

The explanation helper produces a compact verified snapshot of counts, status
counts, reference states, source-age assessment and limitations—not raw records,
provider IDs, amounts, quantities, secrets or free text. It accepts only explicit
user requests, daily/weekly/monthly briefs or a changed validated descriptive
aggregate after five-minute coalescing. Raw record/version changes are insufficient.

The deterministic reservation policy imposes a one-hour cooldown, three requests /
3,000 reserved output tokens per UTC day, 1,000 output tokens per request, a 16-KiB
input bound and five-minute snapshot age. Request and material-aggregate dedupe
survive day rollover. The finite 128-claim retained-key capacity fails closed rather
than evicting replay protection. Reservations remain consumed after uncertain calls.
Static reason codes provide denial observability without sensitive data.

**This milestone does not wire AI dispatch or claim durable budget enforcement.**
Before any future dispatcher is enabled, its authority check, retained dedupe keys
and budget reservation must commit atomically in a durable store before the call;
uncertain results cannot dispatch again. AI may only explain this evidence, never
write/alter/reconcile/authorize facts. No new AI cost is introduced here.

## Qualification and operation

Focused tests exercise real parser→mapper projections for all seven record shapes,
nullable/absent references, contradictory references, currency/location isolation,
status corrections/reversals, stale/out-of-order denial, duplicates/permutations,
partial/interrupted/unavailable scans, exact quantities/Money, immutable identity,
incremental/full-oracle agreement and explanation budgets/cross-day dedupe.

The local native PostgreSQL harness applies the complete migration chain to an
owned disposable database. It exercises actual checked reads/commits, lost ACK,
CAS rejection, immutable tables, revocation and application-role denial, and proves
generic canonical/economic tables and QBO schema remain unchanged. It rejects
remote configuration. Local qualification is not hosted qualification.

After code review and CI, the hosted continuation is additive migration application
only to the existing isolated database, followed by this native checked worker
under a fresh finite observation approval for the existing admitted records.
Reuse consent/mapping/credentials/fixtures; do not rerun onboarding. Inspect fact
counts, provenance and replay receipts; keep economic and Production gates closed.
No VM window or private credential entry is needed for code/CI qualification.
