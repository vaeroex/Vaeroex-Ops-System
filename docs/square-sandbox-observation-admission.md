# Sandbox provider observations

## Approved meaning

`square_sandbox_observation_admission_v1` admits explicitly approved retained Square source versions as **verified, non-economic provider observations**. It does not turn a provider observation into financial truth or a complete history. The original immutable pending/untrusted source version remains unchanged; an additional immutable admission records the policy, approval, source fingerprint and canonical-shaped observation.

The bounded current qualification covers 13 synthetic versions: one Payment, one Refund, three Orders with Tender detail, two Catalog item variations, two Inventory count snapshots, two physical counts and two adjustments. These seven record types remain distinct. Catalog is seller-scoped and retains its location-applicability data; it does not acquire location ownership from an unresolved reference. Payments and Refunds are not netted. Inventory observations do not calculate stock. No revenue, economic contribution, historical completeness or freshness guarantee is inferred.

## Checked administrative path

Migration `20260911151334_square_verified_provider_observations.sql` adds private immutable approval and observation-admission tables and two checked administrative functions. It adds no runtime role, credential, browser route or automatic admission worker. Both tables use FORCE RLS; no public, authenticated, service-role or existing broker/runtime access is granted.

An actual native `postgres` administrative session registers a finite manifest with current workspace-owner attribution, tenant/entity/connection/generation, policy fingerprint, expiry and pinned source/version/current-version identities. Admission rechecks current verified consent, enrollment, mapping, revocation and retention under transaction locks. It derives facts from stored immutable sources, not caller-supplied fact payloads. An expired portal session is not borrowed as authority. Existing runtime/consent gates can remain closed.

The historical sources are checked against the existing durable mapper, original task scope, immutable receipt and source fingerprints. Source and receipt insertion transaction identity corroborates their original atomic commit; it is not a claim that timestamps match or that a receipt encodes a per-record membership list. Unavailable corroboration rejects rather than inventing provenance. The original immutable source provenance remains the record of what was observed.

Each admitted source version has one deterministic fact identity and policy-scoped admission key. Admission time is the checked execution time, not backdated observation time. Replay retains the first immutable admission; a changed current version, conflict, expired approval or revoked authority cannot be converted into a successful new admission. Approval is separately immutable; each admitted fact batch commits atomically or not at all.

## Qualification and operational sequence

1. Run the pure-policy regression and local PostgreSQL qualification, including SQL/TypeScript fingerprint parity, wrong tenant/generation/location, revoked or stale authority, immutable mutation denial, duplicate/reordered input and replay. The database runner must reject remote targets.
2. Independently review the migration and policy; run normal required CI before delivery. Automatic application deployment does not apply this migration.
3. For the isolated Sandbox only, verify the canonical migration ledger and apply migration 111 through the authorized administrative path. Do not apply it remotely elsewhere.
4. Read the exact approved retained-source manifest, register its time-bounded approval, and admit it transactionally. The global account block is enforced, not ignored: the authorized administrator clears only that Sandbox block inside the admission transaction and restores it before commit. Surface, enrollment, provider-call and runtime gates remain false throughout. A failure rolls the whole transaction back to the original blocked state. Verify 13 unchanged source versions, 13 unique observations, stable fact fingerprints on replay, original pending source state, and no economic/canonical-pipeline writes.
5. Keep VMs stopped, broker LOGIN and runtime/consent gates closed, and credentials unchanged throughout this database-only qualification. No Square call or renewed consent is required.

## Next supported stage

The included deterministic reconciliation is limited to observation identity/version conflict handling, stable ordering and descriptive per-type counts. Its summary includes exclusions and explicit `economic: blocked` and `historical: unknown` markers. It does not join separate resource types into a financial event or introduce an accounting rule. Further business interpretation requires a separately implemented policy with evidence for its semantics; this change does not pre-authorize revenue, stock or contribution calculations.

Production Square registration and all QBO behavior remain unchanged. Deployment of code is distinct from applying a Sandbox migration or admitting Sandbox records.
