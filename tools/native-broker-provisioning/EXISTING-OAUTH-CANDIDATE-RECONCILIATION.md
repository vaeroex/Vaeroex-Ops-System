# Existing OAuth candidate: bounded verification procedure

**Review only. Not installed or authorized for live execution.** This is proof of
the retained candidate, not another provisioning attempt or service admission.
Do not run the existing `create`, `recover`, `rotate`, or `admit` command for it.

## Exact scope

- Production Supabase project `mdiianhfrojmxqpwrflh` and the existing native
  database/system/CA/transport pins; no connection-mode change.
- OAuth role `square_production_oauth`, OID **34220**.
- `projects/711446392261/secrets/square-production-oauth-db/versions/1`, created
  `2026-09-27T23:21:17.971560Z`, ENABLED. Never `latest` or a replacement version.
- Retired prior intent `prod_oauth_20260927_224909_v1`; its existing uncertain
  journal entries must remain byte-for-byte intact.
- No password assignment/generation, role creation, secret-version creation,
  disable/destroy operation, migration, provider call, application admission,
  or Square gate change. Broker and other profiles cannot invoke this mode.

The existing `recover` path is deliberately unchanged: it makes a fresh
credential. The new `reconcile` path returns before constructing that coordinator
or its mutating secret store. The native C database worker's proof operations add
only finite failure receipts; database authorization, mutation and fencing are
unchanged.

## Before a live verification decision

1. Review the exact code, focused tests and packaged source manifest. An updated
   OAuth launcher and module installation is required; the currently installed
   provisioner does not support this mode. Do not install peer profiles or modify
   the retained journal. Verify a new complete installation manifest rather than
   reusing the old 97-entry manifest. Installation itself needs separate approval.
2. Reconcile the exact role/OID, NOLOGIN/NOINHERIT, membership attributes and zero
   sessions; closed application authority; 105-entry ledger; stopped VM; closed
   cloud access; and exact version-1 metadata. Do not access its payload here.
3. Preserve the known provenance: OAuth container was empty before the retired
   operation; one journaled run created the candidate at the pinned timestamp.
   No other role/secret writer or version may be adopted by this procedure.
4. Obtain a separate exact-plan/live verification authorization. Scope secret
   access to get/access of this existing candidate; do not request add, disable,
   destroy or peer authority for reconciliation. If the existing window machinery
   cannot express that scope, present the exact required plan change before use;
   do not silently reuse its provisioning grant. No such plan is prepared here.

## Private handoff (only after separately approved opening)

Use the existing VM identity, independently verified host-key pin, strict SSH,
private administrator entry and automatic 60-minute STOP. Start a new intent and
approval for **reconciliation**, not reuse of the retired operation. Request
private entry by VM+20 minutes, operator cutoff VM+30, native deadline VM+40,
explicit cleanup/shutdown by VM+50. No database password in chat, arguments,
files, shell history or logs.

Immediately before the launcher, create root-owned private
`recovery-clearance.json`, expiring in at most ten minutes and binding:

| Field | Required value |
| --- | --- |
| `schema` | `oauth_existing_candidate_reconciliation_v1` |
| `priorIntent` | `prod_oauth_20260927_224909_v1` |
| `nextIntent`, `approvalId` | New, separately approved reconciliation identifiers |
| `projectReference`, `targetRole` | Exact Production project and OAuth role above |
| `roleOid` | `34220` |
| `versionName`, `createTime` | Exact version and timestamp above |
| `journalSha256` | SHA-256 of the complete retained journal immediately before launch |
| `roleFenced`, `sessions` | `true`, `0`, supported by live reconciliation |
| `candidateState` | `ENABLED` |
| `expiresAt` | Integer epoch milliseconds, now < expiry <= now+600000 |

This clearance truthfully admits an **unresolved** candidate for verification;
it does not set `unresolvedSecretVersions=false` or declare the old commit known.
The last journal record must remain the exact uncertain `assign_and_commit`
result, with one start and one finish for the retired intent. Any new journal
record or reused intent blocks replay. Existing exclusive locking is preserved.

The retained September 28 proof appended reconciliation records. Its journal
therefore no longer meets this original last-record admission rule. Fixed-label
diagnostics do **not** authorize or enable another proof: preserve those records
and obtain a separately reviewed admission decision before any new live plan.

The reviewed command shape (not a current runnable handoff) is:

```text
maintenance-launcher reconcile 34220 NEW_RECONCILIATION_INTENT NEW_APPROVAL_ID NATIVE_DEADLINE_MS
```

The launcher verifies metadata before asking for the existing Production
PostgreSQL administrator password through the unchanged no-echo prompt. Its
post-entry deadline/clearance check still applies. No Square credential entry is
needed. No live command, operation ID or clearance has been generated here.

## Executed sequence and interpretation

1. Append a distinct reconciliation-start record. Inspect the exact native
   authority, acquire the existing fence and verify NOLOGIN and drained sessions.
2. Verify version-1 name, state and creation time. Temporarily use the existing
   native LOGIN/INHERIT authentication transition; Square application gates stay
   closed. This is a database-role mutation and is not a read-only live test.
3. Read only version 1 once into memory, validate its CRC32C and fixed DSN envelope,
   and pass the candidate through the existing private pipe to native SCRAM/TLS
   authentication. Verify session user, role OID and full database target. Never
   read `pg_authid.rolpassword`, print a secret/hash, or compare password verifiers.
4. On success, failure, cancellation, SSH loss or receipt failure: drain native
   work (ten-second acknowledgement watchdog), then attempt the independent thirty-second fence
   even if the drain acknowledgement is missing. The native adapter rejects a
   fence while a worker remains active; a late drain retains the same reaping
   promise before the sole fence attempt. The watchdog marks the outcome
   uncertain; it does not abandon a worker and consume the fence prematurely.
   An unreapable OS process cannot be reported closed or given a guaranteed
   completion time; preserve the existing shutdown/reconciliation procedure.
   Both reconciliation deadline timers cancel work without terminating cleanup
   or wiping its administrator input early. Restore NOLOGIN/NOINHERIT and
   terminate sessions. No authentication, assignment or provisioning retry.
5. Append distinct stage/final evidence, leaving the old journal intact. A final
   receipt write failure cannot suppress fencing or produce a success label.
   Owned buffers are wiped; the existing REST transport still necessarily makes
   transient HTTP/JSON copies, so this is not a claim of perfect memory erasure.

Only `native_existing_candidate_verified_closed` means both exact-candidate
authentication and final fencing were acknowledged. It proves the credential
currently matches, **not** that the lost historical COMMIT acknowledgement was
recovered. The result retains `originalDatabaseCommit=uncertain` and
`credentialPublished=false`. It is deliberately not accepted as a service
admission receipt by the unchanged admission path.

`native_existing_candidate_reconciliation_uncertain`, any generic maintenance
failure, missing acknowledgement or disconnected Terminal means stop and
reconcile read-only. Keep role 34220 and version 1; do not rotate, assign, disable
or create version 2. A failed authentication is not proof of password mismatch
without its own conclusive classification. Completing a demonstrated mismatch
with that same credential would require separately reviewed native functionality
and explicit authorization; it is not implemented here.

### Fixed failure evidence

On failure, the journal and Terminal may additionally report one finite
`failureStage`/`failureCategory` pair. Stages distinguish activation, secret
metadata/payload access, authentication and final recovery. Categories are
`secret_access`, `database_connection`, `database_authentication_unconfirmed`,
`database_identity`, `timeout`, `cancelled`, or `unclassified`. Only the first
observed failure is retained; late parallel errors cannot replace it. No raw
provider/native error, URL, connection string, credential or query is recorded.

`database_authentication_unconfirmed` means libpq observed a password exchange
but did not establish the connection. It does **not** establish a bad password;
transport failure during that exchange is also possible. `database_identity`
covers the candidate-session identity check, not every administrator/catalog
preflight. `timeout` requires an owned deadline; unknown failures remain
`unclassified`. The old `authentication_started` record preceded activation and
cannot retrospectively distinguish any of these failure categories.

## Mandatory final readback

Confirm exact role/OID, NOLOGIN/NOINHERIT, reviewed membership attributes, zero
sessions, unchanged version-1 identity/state, no version 2, closed generations and
gates, and unchanged ledger. Remove only this operation's clearance/access/public
key registration and temporary reviewer grant, stop the VM, and verify Terraform
zero drift. Preserve journal and candidate on all outcomes. Sandbox/QBO stay
untouched. No automatic retry or replacement window.
