# Inactive QBO + Square Sandbox admission bridge

Local-only candidate layered on the same shared VSI/brief generation, manifests,
terminal accounting, owner audience and exact saved-citation paths. This is not a
new production engine, a completed hosted demo, or permission to restart the old
Coastal Kitchen runner. The production forward SQL package is unchanged.

## What is implemented

- Separate `qbo_sandbox_version` and `square_sandbox_observation` identities, with
  explicit Sandbox environment, installation, immutable version and authority hash.
  Bare discovery identities are preview-only. Seal/save/reopen require the exact
  canonical identity; a mapping/generation/version change invalidates old input.
- A private installation policy binds one workspace, canonical entity, both
  connections/generations, fixed existing Sandbox issuer, policy version and expiry.
  The draft inserts **no policy row**. Code gates return null/false. Disabled rows
  cannot be enabled by UPDATE; a reviewed activation must provide a new exact row.
- QBO reads existing current active Sandbox source records with valid Phase8B
  projection/realm binding, current mapping/generation and faithful period, basis
  and currency. The production preview helper remains unchanged; a Sandbox-only
  clone performs the same minimization with the Sandbox environment check.
- Square reuses the existing complete workspace authority algorithm with explicit
  actor/session binding and owner-only membership. Service settlement uses a
  private transaction-bound resolution claim after live actor validation, never
  JWT/role impersonation. Exact admitted source/receipt/fact/interpretation and
  current partition/generation/retention are rechecked. Stable fingerprints omit
  volatile validation timestamps.
- Sixteen actual Square dependency tables take SHARE locks for the short read or
  final validation transaction, not during model execution. Existing workspace
  fencing protects the QBO path. No generic new fence/trigger framework is added.
- The existing manifest stores the installation. Direct, inherited, copied and
  empty-fresh-source paths cannot cross installations/environments. Existing
  original-actor private VSI copies and owner-only briefs remain enforced.
- Both actual consumer entry points select the same Sandbox preparation/sealing
  layer only when its separate code binding is reviewed on. Brief construction
  drops unbound normal business content before extending with admitted Sandbox
  records; direct extension rejects a contaminated base. Existing snapshot
  receipt/control metadata is retained as a control dependency, not model evidence.
- Existing reviewed file/approved-note previews and mandatory semantic receipts
  are reused. Their first preview does not require a pre-existing receipt. No raw
  upload, unreviewed extraction, invented item/entity link or Sandbox relabelling
  of their internal publication channel is introduced.

No existing validation-role RPC is granted to application roles. Private tables,
helpers and transaction claims have no direct application/service access. The
three new authenticated entry points perform owner/session/policy checks. Server
completion, privacy, entitlement and once-only accounting use the existing paths.

## Model-use policy remains a separate decision

See [DESCRIPTIVE-POLICY.md](DESCRIPTIVE-POLICY.md). Square's original operational
contract still says `aiDispatch: disabled`, `economic: blocked`, and
`historical: unknown`. No original source or policy record is changed. A future
explicit policy would permit only the new descriptive projection, not economic
contributions, production routing, arbitrary provider data or unrestricted AI use.

## Exact supported local demonstration and remaining semantic limit

The local consumer fixture invokes actual VSI answer generation and actual brief
service validation, then their existing protected SQL completion and citation
reopening. Two mocked VSI responses and one mocked brief response are used; zero
real provider/model calls occur. It demonstrates transporting and preserving
cited Sandbox records and a two-source non-additivity/uncertainty statement.
QBO records/reports are minimized; reports require the qualified two-column
summary shape. Square supports descriptive payment/refund/order/catalog/inventory
observation kind/status/time and available monetary minor-unit fields, retaining
non-economic and incomplete-coverage restrictions.

The bridge commit alone is **not proof of broad qualitative synthesis**. Its brief validation
binds each claim to one canonical signal and requires exact wording for shared
relationships. VSI's joint-claim guard likewise recognizes canonical relationship
statements. The mock repeats that boundary; it does not demonstrate a model
independently discovering a useful business explanation. Rich records do not
supply missing complete aggregates, tax/refund reconciliation, workforce scope or
item/file/note correspondence. Relaxing or redesigning those narrative constraints
needs a separate scoped change preserving citations, uncertainty and numeric
support. This admission patch deliberately does not make that change.

The later, separately gated local [qualified interpretation candidate](../QUALITATIVE-SYNTHESIS.md)
adds novel hypothesis handling with exact premises and explicit uncertainty. Its
mechanical mocked checks still do not establish real-model synthesis quality.

The existing twelve-provider production projections and processed-file/note
objective remain intact. This bridge is only the QBO/Square Sandbox layer, not a
five- or ten-plugin cap or a substitute for the larger objective.

## Local verification scope

- `node --test scripts/sandbox-shared-evidence-tests.mjs`: closed defaults, exact
  authority cloning, production rejection, preview-to-seal drift, owner/session/
  issuer/installation denials, real SQL completion/reopen, private copies,
  cross-installation and production inheritance denial, once-only cost, and
  first-use file/note preview while semantic certification stays mandatory.
- `node scripts/sandbox-shared-consumer-tests.cjs`: actual consumer functions,
  mocked model responses, SQL save/reopen and isolated-base regression.
- The existing focused production consumer regression and TypeScript checks are
  reused/run for the shared-code changes; completed broad audits/races are not rerun.

The database fixture is PGlite single-backend with minimum synthetic table layouts.
Repository Square observation/scope/materialization/hashing and QBO Phase8B
projection/realm checks run. A generic source payload assertion is a bounded
fixture substitute; the interpretation envelope is synthetic. This does not
qualify full provider ingestion, installed schema/trigger parity, native table-lock
concurrency, a real model, browser navigation or a hosted deployment.

Verified local checkpoint: all five targeted SQL tests pass; the actual VSI and
brief consumer fixture passes generation/validation, protected save and citation
reopening with two mocked VSI responses and one mocked brief response. TypeScript
and the focused production consumer regression pass. Targeted lint has no errors
(three existing unused-variable warnings in the wider changed-file check).
Independent review's canonical-identity, first-preview and unbound-brief findings
are resolved; the new sealer has explicit 2-second lock and 5-second statement
settings. These are local test/review results, not live Sandbox acceptance.

## Prerequisites before any hosted/paid acceptance

1. Confirm an explicitly isolated runtime/database with compatible shared-engine
   contracts and QBO+Square Sandbox records in the same workspace/entity. Existing
   separate-project preparation records do not prove they currently coexist.
2. Confirm current owner/session, ordinary billing/usage authority, connection
   generations, QBO mapping/realm/validation, Square seller/location enrollment,
   admitted observations/interpretation and unexpired retention/configuration.
3. Obtain separate approval for the exact schema/grants and installation policy,
   descriptive model-use activation, isolated host/credential handling and cost
   ceiling. Never reuse expired credentials or import into a live merchant workspace.
4. Qualify the actual source writer/final-save lock interaction in native PostgreSQL
   before activation. The current local result does not substitute for it.
5. Only after approval/current state: one normal VSI request and one brief, reopen
   both and every cited original; stop on denial/configuration error. Do not repeat
   paid generations to improve appearances. Label provider-Sandbox/model proof
   separately from live merchant production proof.

No external read, schema apply, publication, CI, ingestion, model call, account
creation, deployment or activation is authorized by this local package.
