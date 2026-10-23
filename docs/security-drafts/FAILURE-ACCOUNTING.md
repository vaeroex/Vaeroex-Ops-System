# Inactive accounting-only VSI failure repair

Draft13 addresses a specific existing defect: when a previous conversation's
Sheets retention root expires, `vsi_mutate_v2` cannot settle even an output-free
failure, because its underlying wrapper checks conversation readability first.
The existing wrapper is left unchanged. This is not universal cleanup after
session, billing, membership or privacy authority has ended.

## Exact new contract

`public.fail_vsi_request_accounting_v1` takes nine required scalar arguments:
workspace UUID, actor UUID, session UUID, conversation UUID, request UUID,
attempt integer, cost numeric, nullable provider-call count, estimated-cost boolean.
It accepts no action selector, JSON payload, ticket, source, question, answer,
citation, summary, provider request identifier or user-supplied error text.

The inactive SQL draft specifies SECURITY DEFINER, empty search path and EXECUTE
only for service_role. Existing grants, public mutation guards and RLS policies
are unchanged. No production grant or function has been applied.

Authority and ordering preserve the current live actor/session and role checks,
privacy-open lock, actor/workspace advisory locks, billing check, conversation
identity/role lock and exact request lock. Deleted conversations fail closed.
Only READ COMMITTED transactions are accepted so checks after lock waits do not
use an older transaction snapshot.
Cost is finite, between zero and ten dollars, with at most eight decimal places;
provider calls are null (unknown) or an integer from zero through one thousand.
The application rounds to the existing ledger's eight-decimal precision.

A pending matching request becomes failed; reservation and lease clear; one
unique request/attempt cost event is inserted atomically. The event stores only
a fixed contract marker, failed flag, cost, provider-call count and estimated-cost
flag. Existing token/model telemetry is intentionally not copied into this minimal
accounting event. An exact duplicate returns `already_failed` without another
charge. A completed exchange, stale attempt, differing retry or conflicting ledger
row rejects. Neither answer rows, conversation content nor manifests are written.

The application has a separate constant-false gate in
`lib/vsi/failure-accounting-gate.ts`. In its enabled test path, status-only
reconciliation precedes the RPC; completed or uncertain status prevents a write.
The failed-save path never loads exchange content and always preserves its
original error. The generation-failure HTTP path still returns an answer error.
There is no automatic retry, fallback to a private function, or eligibility repair.

## Qualification and limits

- Seven PGlite SQL test groups pass: expired-lineage repair without content access;
  exact duplicate and unknown-count/estimated-cost handling; authority/privacy
  denials; grant/input/deleted-conversation checks; both serial success/failure
  orders; late rollback and pre-existing ledger conflict; the existing viewer
  role remains valid when its exact conversation role still matches.
- Application tests pass fixed scalar projection, status-only reconciliation,
  no success conversion, no retry/fallback, strict input/result validation, and
  unchanged disabled-gate behavior.
- Existing HTTP failure-cost regression (seven scenarios) and shared settlement
  reconciliation regression pass. TypeScript and independent review pass.
- The later published candidate `f2d1547466edeadd586443e0e62afe6199f700da`
  passed [native CI](https://github.com/vaeroex/Vaeroex-Ops-System/actions/runs/39909522264).
  Three-session tests observed simultaneously pending failure/failure and both
  failure/success orders, one cost event, preserved successful output, and
  expired-source/authority/privacy denials. No provider or production call occurred.

Installed helper comparisons and bounded native races are complete. Activation
still requires the exact reviewed deployment and gate change. A blocked privacy epoch, ended session,
changed actor role or absent billing authority still denies bookkeeping by design.
No historical requests are backfilled by this draft.

## Rollback

Disable the application gate before removing the new function. Revoke its new
service-role EXECUTE and drop only its exact nine-argument signature after pending
application calls have drained. Preserve existing request/cost rows; never delete
ledger entries or restore old VSI grants. The disabled application path retains
existing v2 behavior, including its known expired-lineage limitation.

## Bounded installed-contract comparison

The approved read-only comparison found all six repository body fingerprints
equal to the installed definitions. Signatures, owners, security-definer flags,
empty search paths and ACLs were also checked. All six deny direct execution to
service_role, authenticated and anon; the database owner retains execution.
No body retrieval was needed and no customer/configuration rows were read.
Private metadata captures remain outside Git.

| Function | Why the installed comparison is needed |
| --- | --- |
| `private.square_production_customer_require_eligible_v1(uuid)` | Eligibility before Square payment commit. |
| `private.square_production_customer_require_keys_v1(jsonb,text[])` | Exact accepted Square payload boundary. |
| `private.assert_integration_provider_source_authority_v1()` | QBO source-writer authority. |
| `private.commit_provider_external_source_before_validation_v1(jsonb,text)` | Delegated QBO source-write effects. |
| `private.qbo_production_source_has_effects_v1(uuid)` | Unretracted accounting effects prevent unsafe deletion/void completion; use the later accounting-intake reconstruction. |
| `private.platform_admin_subscription_exempt_v1(uuid)` | Existing entitlement exception predicate, without seeding or adding exemptions. |

Bounded relation contracts needed for those reached paths:

- `square_customer_private.configuration`: `singleton`, `enabled`,
  `application_id`; types/defaults/uniqueness/checks, no values.
- `private.integration_sync_tasks`: `id`, `workspace_id`, `business_entity_id`,
  `connection_id`, `connection_generation`, `provider_key`, `provider_environment`,
  `state`, `lease_id`, `lease_owner_fingerprint`, `lease_expires_at`, `sync_run_id`,
  `stream_key`, `dispatch_generation`, `dispatcher_task_name`,
  `last_delivery_attempt_fingerprint`; applicable constraints/trigger bindings.
- QBO effects: `business_fact_sources` workspace/entity/source-version/fact-version
  keys; `canonical_business_facts(id,current_version_id)`;
  `canonical_business_fact_versions(id,fact_id,reconciliation_state)`;
  `reconciliation_case_members` source/fact/case/workspace/entity keys,
  `member_role`, `additive_candidate`; `fact_contribution_events` identifiers,
  target event, event kind, fact/case/workspace/entity; `reconciliation_cases`
  `id`, `contract_version`, `classification`.
- `private.integration_audit_events`: insert constraints/defaults and relevant
  triggers for workspace/entity/connection, actor, action/outcome, target, request,
  metadata and retention fields. Audit rejection must roll back completion.
- `public.subscription_plans`: `slug`, `max_ai_runs_per_month`, lookup uniqueness
  and relevant constraints.
- `private.workspace_usage_locks`: `workspace_id`, `revision`, primary/workspace
  foreign keys, default/not-null, privileges and relevant triggers.

The named relation metadata has now been captured and its selected column types,
nullability and defaults match repository reconstruction. The audit
relation uses actor_type/actor_id, target_type and retention_class; similarly
named guessed columns are not part of its contract. This closes the bounded
metadata acquisition gap, not native execution of every installed writer or
full relevant ACL/RLS and retention/erasure composition. Synthetic concurrency
qualification is tracked separately; no production mutation occurred.

## Semantic authority versus user data

The supported qualitative Square/QBO interpretation distinguishes payment from
accounting stages for a protected common entity and prevents double counting.
Eligible records and genuine owner-confirmed mappings are user-data prerequisites.
A numeric profit reconciliation additionally requires typed revenue/expense,
period/basis and refund/tax/timing or transaction correspondence contracts.

Hours ratios cannot be enabled just by connecting more data. Square declares
unknown coverage and provides minor units without a certified conversion or
complete sales total. Harvest exposes permission-visible entries; Clockify exposes
connected-user entries. Their runtime coverage is unknown and does not certify a
matched workforce or business timezone. Adapter authority must first establish
complete comparable aggregates, units, period/timezone and scope; then the user
can provide the matching records/mappings.

Inventory snapshots expose aggregate item/stock-row counts, not item-level
correspondence or historical movement. Reviewed file and note projections provide
provenance and reported text but deliberately have null entity IDs; reported
applicability dates are not measured-period coverage. A grounded operational
explanation needs an approved, version-bound relation between the particular
inventory item/entity/snapshot and the reviewed assertion. Clearer prose or more
connections cannot create that authority. Keep independently cited context and
an explicit limitation until that contract exists; do not infer causation.
