# Inactive VSI evidence release

The application consolidation is based on production
`710bfa5ed93b6f4b01d233c94d5a3a4829fd6b73`. It preserves Suggested prompts,
VSI Chat navigation, retired standalone brief generation, and historical records.
Sandbox admission, callback/broker and VM changes are excluded. SQL stays outside
`supabase/migrations`. Shared evidence, qualitative synthesis and failure-accounting
runtime gates are all constant false. No hosted changes are authorized here.

See [QUALIFICATION.md](QUALIFICATION.md), [release/DEPLOYMENT.md](release/DEPLOYMENT.md)
and [release/PREREQUISITES.md](release/PREREQUISITES.md) for current scope and gates.
Historical qualification of separate brief generation is reused only where it
supports common evidence and preserved historical artifacts; it is not an active
product workflow or a new release acceptance target.

## Contracts retained without SQL changes

| Draft | Purpose |
| --- | --- |
| 01 | Live owner/session-bound legacy readers, explicit canonical-entity confirmation and immutable versioned evidence references for nine connectors. No matching by names. |
| 02 | Owner-only historical briefs/copies and original-actor restrictions for saved VSI copies and recursive ancestry. Metadata classification leaves historical content intact; ambiguous ancestry stays unavailable. |
| 03 | Private immutable manifests, original sources, output links and transaction claims. |
| 05 | Mandatory admission/inheritance and atomic completion through `vsi_mutate_v3`, preserving the installed v2 live-session fence and v1 revocation. Historical trusted-run handlers remain protected. |
| 06 | Typed QBO, Square, processed-file and approved-note admission, binding current source versions, mapping, validation and privacy. |
| 07 | Exact saved artifact and citation reopening; changed or inaccessible originals deny access. |
| 08 | Sheets current-version projection and actor-bound ticket roots. |
| 09 | Katana installation nonce; credential/installation replacement invalidates old references. |
| 10 | Canonical file/note semantic receipts. Raw uploads, unreviewed extraction and stale indexes are ineligible. |
| 11 | Protected bounded stored-source discovery. No provider fetch/import during reasoning. |
| 12 | Existing 64-relation writer/settlement interlock; conflicts abort with `40001`. No new fences added during consolidation. |
| 13 | Output-free, actor/session/request-bound failed-request settlement and once-only costs after expired evidence; no restored access or answer. |

Procedure 04 is a separately reviewed pause, excluded from the atomic forward
package. Drafts 01–03 and 05–13 retain their prior qualification and exact bytes.
The manifest lists source hashes. No direct grants to old VSI v1 or private
validation helpers are restored; no billing exemptions or seats are added.

## Application scope

All twelve implemented connector projections feed the same VSI admission path,
with reviewed file facts and approved notes. Models see only admitted stored
projections and complete dependencies. Exact citations reopen against current
identity, lifecycle and authority. The owner mapping UI is disabled with the
runtime gate. Existing QBO/Square/Sheets mapping contracts are reused.

Numeric claims retain typed financial/period/unit/coverage safeguards. A separate,
disabled qualitative channel permits novel labeled interpretations with exact
issued premises and qualified next checks. Citation syntax is not semantic proof;
real-model evaluation remains required. Missing labor coverage or inventory/item
correspondence cannot be created by richer records or a name-based mapping.

Discovery defaults to 30 inclusive UTC dates. Only an explicit last-30 versus
preceding/prior/previous-30 comparison selects 60 dates. Other requested ranges are
not generally parsed. Selection is not proof of complete comparable periods;
source-specific periods, time zones, budgets and omissions remain disclosed.

## Evidence and access boundaries

Completed native concurrency, bounded captured-contract comparisons and local
ordered-install/rollback receipts are reused, not restarted. Captured private
bodies stay outside Git. Synthetic/mock tests are not live merchant or model
quality proof. The scoped Vercel environment-metadata listing returned HTTP 403;
it is not retried through a different route. Owner-supplied non-secret identity
evidence closes project/organization comparison, not deployed secret equality or
current provider Sharing status. Standard retention is allowed by existing
notices; Zero Data Retention procurement is not a requirement.
