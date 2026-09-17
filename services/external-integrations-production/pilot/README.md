# Production Square internal-seller pilot package

This package is an offline, nonsecret assertion-consistency check for the first
one-workspace internal seller pilot. It does not activate Square or prove a hosted
operation. The checked-in example intentionally
describes the current blocked state: Production database foundation
`20260902191323` is present, the Square overlay and layered callback are pending,
credential containers are empty, the allowlist is empty, and every gate is
false.

A sanitized preflight candidate can currently attest only the reviewed 103-file
source baseline ending at Square overlay `20260902191324`. The executable
internal runtime dependency is still pending: this contract deliberately names
no runtime source commit, path, ledger head, fingerprint, digest, function or
authority surface. The merged native source retains 104-ledger planning pins for
`20260902191325`, but that migration is absent from the merged qualification
tree and those future pins are not a reviewed runtime dependency. A version-only
or boolean claim is rejected. The contract pins the corrected overlay's final
reviewed hash; activation evidence must prove that exact source object was
merged and applied. The qualifier independently hashes that path in the exact
Git object named by `--expect-head` and requires the qualifier itself to run
from that head. A future reviewed runtime must separately pin its own source and
prove that source commit is an ancestor of the qualification head. Readiness
remains blocked until that runtime is separately delivered and the native
execution identity and deployment manifest are reviewed and read back.

The immutable network contract is:

- project `vaeroex-integrations-prod`, region `us-west1`;
- callback `https://square.vaeroex.com/api/integrations/square/callback`;
- webhook `https://square.vaeroex.com/api/integrations/square/webhook`.

Run the committed baseline check without contacting Production:

```sh
node services/external-integrations-production/pilot/qualify.mjs \
  --evidence services/external-integrations-production/pilot/pilot-state.example.json \
  --expect-head "$(git rev-parse HEAD)" \
  --phase precredential_nonsecret \
  --expect-blocked
```

Use `--expect-consistent` only for a candidate whose sanitized assertions have
no findings. Exact catalog, ownership, ACL, role and concurrency qualification
belongs to the merged native/catalog test contract; this package does not
maintain a second SQL verifier or accept a catalog marker as proof. The current
merged tree qualifies the exact 103-file overlay baseline; its optional 104
planning pins become applicable only if that migration is separately reviewed
and merged. A
blocked result is not equivalent to a consistent result, and neither result
proves hosted execution or grants activation.

For a consistency candidate, create a sanitized evidence JSON outside the
repository from nonsecret readbacks only and select one exact `--phase`. The
checker accepts no extra fields, credential-shaped values,
URLs carrying database credentials, or open gate. `precredential_nonsecret`
requires every credential slot and pilot-scope count to remain empty and also
requires the reviewed executable runtime/authority contract; it cannot become
ready now, so private credential entry cannot start merely because infrastructure
checks pass.
`internal_consent_ready` requires the application credential and the OAuth and
broker database profiles at enabled version `1`, while runtime/evidence and
webhook/scheduler profiles remain absent. `post_initial_lifecycle` is explicitly
blocked until a separately reviewed scheduler/webhook runtime exists; the
checked-in contract cannot authorize webhook credential entry or that phase.
`external_customer_blocked` always fails. The
checker also compares
the deployed shared-bootstrap, OAuth-callback and callback-edge source/image
pairs to the separately reviewed release pins in the contract, and verifies all
three source commits are ancestors of the qualification head. It compares the
six pins to the prior reviewed release: the shared pair must remain unchanged,
while only the OAuth and edge pairs may advance. Pilot scope is represented only
by aggregate counts: exactly one allowlist entry, one distinct workspace and one
distinct seller. Those counts enforce the one-customer ceiling; they do not prove
which workspace or seller was selected, internal ownership, or the exact business
entity and location mapping. The qualifier rejects identifier fields and mapping
booleans. Fixed marker plus SHA-256 references for consent, mapping, bounded
initial sync, replay, workspace evidence and cleanup are sanitized references,
not hosted proof, and cannot override a missing SQL authority surface. They are
untrusted operator assertions: arbitrary unique fingerprints and booleans can be
internally consistent, so the offline checker always reports
`hostedQualificationProven: false` and `activationReadiness: false`. Exact
mapping is verified only in the private operating record under
`PRIVATE-HANDOFF.md` and remains required even after consistency checks have no
findings. The result reports `operatorAssertionsInternallyConsistent`,
`privateMappingVerification: "required_outside_qualifier"` and
`activationAuthority: "not_granted"`; it never grants authorization or mutates
a system.

Run the synthetic lifecycle coverage with:

```sh
node --test services/external-integrations-production/pilot/model.test.mjs
```

The authoritative database source and catalog checks are the merged
`productionSourcePins`, `production-native-qualify.cjs` and
`production-catalog-qualify.cjs` contracts. They validate the exact 102/103
source chain now and the planned 104 source only when that optional migration is
present. Their PostgreSQL catalog checks include ownership, FORCE RLS,
relation/column/routine ACLs, role membership, lifecycle constraints and the
concurrent ACL-race regression. This package consumes their immutable source
pins; it does not recreate or weaken those checks. At every pilot-package
checkpoint all six profiles must be fenced `NOLOGIN NOINHERIT`, with the exact
non-settable membership recorded by the native contract. A bounded operation
may activate only its exact profile under that contract and must return every
profile to the all-fenced checkpoint before producing sanitized pilot evidence.
CI/source qualification remains nonauthorizing: hosted catalog and role
readback is still required before a private action.

Provider credentials have no local shell helper or CLI path. In one approved,
private, non-recorded GCP Secret Manager console session, the exact operator
`isaac@vaeroex.com` may enter each value only if the current provider UI first
presents a verified protected entry surface that does not render or reveal the
value. A plaintext textarea or unverified masking is not a no-echo path: stop
and wait for a separately reviewed private delivery mechanism. If the protected
surface is verified, use it first only for the already-existing empty
`square-production-application` container in `vaeroex-integrations-prod`. Keep
`square-production-webhook-signature` empty until internal consent, exact mapping,
bounded manual initial sync, replay, workspace readback and cleanup have all
succeeded with webhook intake closed. The webhook-signature container remains
empty because `post_initial_lifecycle` is blocked. Each phase-required metadata-only
readback must show exactly enabled version `1` and total count `1`. Any
cancellation, timeout or
lost acknowledgement is unresolved: stop, reconcile metadata/audit evidence
and do not retry. Secret values never belong in Git, a command, local
environment, chat, logs, screenshots or evidence.
Database credentials must use the merged Production native-SCRAM profiles; the
Sandbox-pinned profile must not be repurposed. This package pins the exact
six-profile source at `0efed0c395335b74af480fcc367ecdf5e0694f23`, including
the final concurrency/ACL-race regression, while the deployment-identity
manifest remains pending. It must remain blocked until the reviewed private
Production execution path is bound and passes hosted checks. Do not improvise
the operation from SQL, a shell, the Sandbox tooling or prose, and do not begin
provider-credential entry or pilot consent merely because the B source exists.
That fixed six-profile Production extension of `tools/native-broker-provisioning`
preserves private entry, native SCRAM, lost-ack reconciliation and secret-store
lifecycle. Its use still needs one explicit reviewed resource decision: the
dedicated private Production execution environment and identity. No such
Production provisioner is in the approved footprint, and the Sandbox VM/service
account must not be repurposed. The integrated source and deployment review must
pin the actual Production database identity/TLS inputs and one exact database
secret container per profile, qualify each fixed build with synthetic values,
and remain closed until its environment, minimum database rights and per-secret
IAM are independently reviewed.

The recommended resource decision is one short-lived, non-Spot Production VM
with no public IP in the existing VPC/subnet, plus a dedicated keyless
provisioner identity and expiring access only to the six existing database
secret containers. The operator enters through a private SSH TTY. This matches
the native tool's Linux/root-owned launcher, exact GCE metadata attestation and
durable local recovery journal. A Cloud Run Job has no such interactive TTY or
instance/journal contract; the operator laptop is not the attested execution
host. Do not create this VM/identity under this package: it is a new resource
scope requiring the explicit decision above. Preserve its recovery state on
an uncertain result; do not discard it merely because a timed window ended.

The currently deployed bootstrap and layered callback remain a deliberately
disabled path, not a pilot runtime. The bootstrap cannot exchange OAuth codes,
query the database or call Square, and the layered callback supplies no state
authority (`consumeState` returns `null`). The lifecycle model tests in this
package are synthetic contract checks only; they do not prove a hosted
lifecycle. An independently reviewed executable Production binding/runtime and
the fixed native provisioner above must exist, be deployed with every gate
closed, and pass hosted readbacks before credential entry or consent can begin.

The planned adjacent Production-only runtime migration is
`20260902191325_square_production_internal_pilot_runtime.sql`, but it is not in
the current merged qualification tree and has no reviewed source identity in
this contract. It must be delivered and reviewed separately before this package
can pin or apply it; the reviewed overlay itself stays byte-identical. The
planned dependency adds only durable state-create,
one-use consume/receipt,
broker credential commit, exact mapping, bounded manual page/replay, workspace
evidence and cleanup/fence surfaces. Each new entry point must be granted only to
its exact Square Production authority. The planned ledger-104 contract assigns
the OAuth, broker, runtime and evidence authorities to internal RPCs while
scheduler and webhook retain their baseline checked RPCs. No current readiness
claim relies on those planned objects or ACLs. Migration
text is only a source-integrity hint; an earlier `CREATE` or `GRANT` does not
survive a later `DROP` or `REVOKE` by implication. Do not grant generic `integration_*`
roles to Square logins, import later Sandbox/dormant migrations, enable a
scheduler or webhook, or make economics/AI reachable.
The existing OAuth preflight is not an internal-pilot permit: it requires
`customer_onboarding_enabled`, while the overlay constrains that flag (and the
runtime/provider-call flags) to false. The follow-up must introduce a distinct,
expiry-bound one-internal-seller allowlist check for consent and manual read
sync. It must not open the general customer-onboarding gate to make OAuth pass.

The smallest follow-up runtime composition adds a Production binding to the
currently closed Vaeroex `/api/integrations/square/connect` surface, reusing
`authenticateSquareWorkspaceActor` and existing Square customer/account-service
patterns for workspace/session checks and hash-only state persistence. It then
uses an ID-token-authenticated direct call from the existing OAuth service to
the existing internal broker service slot. It needs checked state-create,
state-consume/one-use-receipt and credential-commit RPCs, distinct OAuth/broker
executables, OAuth attachment to the existing
VPC, and one broker-service-scoped invoker grant. It does not need a new queue,
service, service account, network, key, or secret container. Those executable
adapters and IAM changes are not supplied or authorized for application by this
qualification package; do not infer readiness from its synthetic model. The
private native provisioner's execution environment/identity remains the
separate resource-scope prerequisite described above, not a reason to repurpose
the Sandbox VM or an image-builder identity.

## Agent-run nonsecret sequence

Run this sequence from fresh readbacks; do not assume the checked-in blocked
example still describes the hosted state.

1. Verify the exact merged heads, reviewed migration bytes, required CI and
   code/security reviews. Read back the exact Production project, ledger,
   credential-version metadata, release identities and closed gates. Stop on a
   stale, partial or conflicting result.
2. Produce and review the callback-only Terraform plan from the six exact
   contract pins. It must contain only independently reviewed in-place callback
   changes, with no create, destroy or replacement action and no IAM, peer-service,
   routing or gate change. Do not reuse an earlier plan's update count or assume
   that its image/source values remain current. Apply only the exact reviewed
   plan, then read back its exact plan/state addresses, deployed digests, source
   variables, ingress and disabled runtime state.
3. Do not apply `20260902191325` under the current package. The merged
   qualification tree ends at the reviewed 103-file overlay source and the
   runtime dependency is explicitly pending. Only after a separate runtime PR
   is reviewed and merged may a refreshed contract pin that migration's own
   source commit, source-controlled path, SHA-256, exact ledger head and reviewed
   object/function/trigger manifest. Leave LOGIN provisioning blocked
   until a reviewed private Production execution path is available
   for all six LOGINs; continue the independent nonsecret checks below. Keep the
   one-to-one non-settable authority memberships and retain only a sanitized
   all-profiles-fenced assertion and role/RPC inventory. A prose instruction is not an
   executable credential-delivery path.
4. Verify public health, exact callback/webhook host-method-path behavior,
   direct Cloud Run denial, query stripping before ordinary request logs, and
   absence of synthetic canaries, credentials, OAuth query values, cursors and
   raw provider payloads. Exercise primary and backup alert delivery with only
   non-sensitive approved probes.

   **Hold before steps 5–8:** do not begin the private handoff, credential entry,
   allowlist mutation or consent until the six-LOGIN native provisioning and
   executable Production runtime blockers above are resolved, independently
   reviewed, and verified through closed hosted readbacks.

5. After the first private console action in `PRIVATE-HANDOFF.md`, read only the
   application-secret and six database-profile metadata plus operator audit
   evidence; keep the webhook-signature container empty. Require enabled version
   `1` and total count `1` only for phase-required slots. A lost acknowledgement
   or any extra version remains unresolved and must never trigger a retry.
6. After Isaac privately selects and approves the exact tuple in
   `PRIVATE-HANDOFF.md`, use only the separately reviewed backend procedure to
   apply that tuple and verify that a foreign workspace, seller, business entity
   and location each fail closed. Keep the exact checks in the private operating
   record. Retain for the qualifier only a sanitized readback of aggregate scope:
   exactly one allowlist entry, one distinct workspace and one distinct seller.
   Do not ingest, infer or reproduce the private tuple; keep all identifiers out
   of source, logs and sanitized evidence.
7. Only after the separately reviewed executable Production binding/runtime is
   deployed closed, run one bounded manually initiated initial sync, its
   pagination/replay/cancellation/timeout/lost-ack checks, workspace evidence
   readback and cleanup/gate readback. Keep webhook intake and its credential
   absent. `post_initial_lifecycle` stays blocked; provisioning the webhook
   signature or qualifying scheduler/webhook behavior requires a separate
   reviewed executable runtime milestone.
   Do not contact QBO, enable economics or Vaeroex dispatch, claim historical
   completeness, or use real credentials/provider payloads as test values.
8. Assemble the sanitized evidence, run the offline qualifier at the exact
   reviewed head, and confirm only that the sanitized assertions are internally
   consistent, private mapping remains required outside the qualifier and no
   activation authority was granted. The qualifier does not validate or replace
   Isaac's private operating
   record. Do not open any gate before the explicit consent in
   `PRIVATE-HANDOFF.md`; after consent combines both separate reviews, apply only
   the separately reviewed one-customer read-only activation and retain the
   expiry/rollback monitoring.

The sole manual handoff is [PRIVATE-HANDOFF.md](PRIVATE-HANDOFF.md). Do not put
seller identifiers, credentials, private database endpoints, customer data or
provider payloads in Git, CI artifacts, issues, PR comments, chat, or the
sanitized qualification output.
