# Restricted Sheets erasure operator

Implementation candidate. No live erasure, support login, cloud bucket, signing
key, IAM change, backup restore, or automatic activation is provisioned by these
files. Production execution needs the reviewed release and separate final approval.
The application connector continues to request only Sheets read-only OAuth access.
The operator's Cloud Storage identity is separate from customer OAuth and from all
application credentials.

## Execution boundary

`operator-cli.cjs` calls only fixed private support functions. It refuses database
superusers, BYPASSRLS/admin capabilities, application-role members, borrowed
`SET ROLE` sessions and mismatched endpoint pins. The separately provisioned
support login has membership only in `google_sheets_erasure_support`; it has no
restore capability and cannot
approve the user's request. The owner confirms the stored scope in the normal
application using a live signed session.

Preparation discovers the exact connection-owned rows and explicitly reviewed
artifacts. Execution retrieves the approved v2 manifest, writes a signed local
pending record durably, then creates and reads back the identical independent
Cloud Storage pending record. Only then does SQL receive request ID, scope hash
and intent digest. SQL authorizes exact table/row/full-old-content-hash targets.
The tool reads authoritative completion back before writing completion receipts.

If an acknowledgement is lost, retain every pending record and retry the same
request and scope hash. Never start a replacement request to conceal an uncertain
commit. A local interrupted file write retains its lock/staging evidence and needs
explicit file recovery; the tool does not break locks automatically. Active-store
completion is reported separately from backup and processor follow-up.

## Recovering an expired request or changed scope

An unapproved request expires after seven days. A changed old-row hash also blocks
execution. Neither condition authorizes changing the approved targets or clearing
a workspace barrier manually. Reconcile using the existing restricted support CLI:

```text
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json inventory
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json withdraw REQUEST_UUID SCOPE_HASH approval_expired INVENTORY_DIGEST
```

Use `scope_changed` for a changed target or `owner_withdrawn` for a documented owner
withdrawal. The support case must establish that reason. The operator first checks
the complete independent inventory and authoritative request state. A completed
request is reconciled as completed and cannot be withdrawn. For an unexecuted
request, SQL records an immutable terminal withdrawal under the same request and
workspace locks while keeping the workspace paused. The original inventory stays
intact. The operator then durably writes a signed withdrawal receipt locally and
independently, binding the original exact scope and expected intent digest. Only
confirmed receipt persistence permits the matching workspace barrier to reopen.

If preparation acknowledgement is lost, inspect the same request with
`status REQUEST_UUID` to recover its scope hash and state; this is a fixed read-only
lookup and does not expose imported values or object paths. Do not create a second
request to work around the uncertainty. A lost acknowledgement or witness failure
keeps recovery held. Retry the same
request/reason after reading the current inventory digest. Never delete a pending
record, replace its bytes, clear database flags manually, or reuse the old approval.
After successful withdrawal, prepare a **new request and case ID**, review the new
exact row hashes, and obtain fresh owner approval. Prior read tickets remain stale.
The independent inventory retains both the original intent (when one was uploaded)
and withdrawal receipt. A late identical intent upload is resolved by that receipt;
a completion/withdrawal conflict blocks recovery and restore for investigation.

## Independently retained inventory

Use a private Cloud Storage bucket in the existing owner-approved Google Cloud
project, outside the application database backup and local journal recovery.
Provisioning is held for separate approval. No bucket creation, deletion, IAM
change, lifecycle change, retention locking, or automatic key generation occurs in the operator CLI.

The operator verifies at runtime:

- Uniform bucket-level access and enforced public-access prevention.
- Object versioning enabled; no lifecycle rules.
- Effective `storage.buckets.get` and `storage.objects.create/get/list` permissions.
- No effective object deletion, update, restore, move, retention override through
  `setRetention`, or bucket mutation/deletion/IAM permissions checked by the tool.
- A provisioned canonical `genesis.json` matching an independently retained digest,
  dataset UUID, original primary endpoint hash, dedicated service-account identity
  and Ed25519 public-key fingerprint.
- Any configured minimum bucket retention duration. There is no required
  irreversible retention lock; creating one needs explicit approval of its duration,
  cost and deletion consequences.

Uploads use `ifGenerationMatch=0`; conflicts are read back and must match exactly.
Inventories are bounded to 128 MiB; exceeding the bound holds replay for reviewed
capacity handling. Full paginated listings are read twice and every record is signature-verified.
Missing genesis, corruption, changing inventories, unexpected objects, pagination
errors, broad operator IAM or unavailable storage stop execution/replay. The bucket
is the authoritative inventory: deleting all local request files cannot remove the
request from restore replay. Custodian/admin powers are outside the restricted
operator identity; do not grant them to the operator or application. Removing
witness entries requires a separate, recorded review establishing that every
relevant backup, export and replica restore point has expired or been sanitized.
Keep genesis/key/configuration pins independently of both the bucket and app backups.
Unsupported older restores without complete inventory remain closed.

Official transport references checked October 12, 2026:
[conditional object creation](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert),
[paginated object listing](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/list),
[IAM permissions](https://docs.cloud.google.com/storage/docs/access-control/iam-roles),
[retention locking consequences](https://docs.cloud.google.com/storage/docs/bucket-lock),
[short-lived impersonation](https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation),
[token command](https://docs.cloud.google.com/sdk/gcloud/reference/auth/print-access-token),
[create-only CLI upload](https://docs.cloud.google.com/sdk/gcloud/reference/storage/cp),
[access-token permission](https://docs.cloud.google.com/iam/docs/service-account-permissions).
These document provider behavior; synthetic tests do not qualify a live bucket.

## Private configuration and commands

The configuration and preparation JSON files must be absolute paths to owner-only
0600 regular files. Local journal storage must be an existing owner-only 0700
non-temporary directory outside any repository, with safe ancestors. A signing
key is needed for execution; restore uses only the independently pinned public key.
Never put database passwords, cloud tokens, imported values or requester email in
manifests, tickets, standard output or configuration examples.

Configuration shape (all example IDs/pins must be replaced after review):

```json
{
  "version": 1,
  "purpose": "support",
  "databaseEndpointHash": "SHA256 of approved host/port/database identity",
  "primaryEndpointHash": "same approved primary endpoint hash",
  "journalDirectory": "/approved/private/erasure-journal",
  "publicKey": "pinned Ed25519 SPKI public PEM",
  "pinnedFingerprint": "SHA256 of public-key SPKI DER",
  "gcloudPath": "/approved/google-cloud-sdk/bin/gcloud",
  "witness": {
    "bucket": "approved-private-witness-bucket",
    "serviceAccount": "sheets-witness@approved-project.iam.gserviceaccount.com",
    "datasetId": "approved UUID",
    "genesisDigest": "SHA256 of canonical genesis bytes",
    "minimumRetentionSeconds": 0
  }
}
```

The private `GOOGLE_SHEETS_ERASURE_DATABASE_URL` supplies the separately provisioned
support connection; it is never printed. Remote TLS certificate verification is
mandatory and URL query configuration is rejected. The endpoint pin is SHA256 of
`JSON.stringify({host: lowerCaseHostname, port: explicitPortOr5432, database: decodedDatabaseName})`.
The approved operator login impersonates only the independently pinned dedicated
service account via `gcloud auth print-access-token --quiet
--impersonate-service-account=PINNED_SERVICE_ACCOUNT --lifetime=900`. The service
account has a custom bucket role containing only `storage.buckets.get` and
`storage.objects.create/get/list`; the app has no access. The operator may obtain
short-lived tokens for this account but cannot use its own broader identity for
witness requests. No service-account key is created or stored. Missing identity,
changed genesis or excessive effective bucket permissions are rejected. The CLI
does not log in, provision IAM or persist the access token. The required Service
Account Credentials API and operator impersonation permission are part of the
separately approved provisioning plan.

```text
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json inventory
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json prepare /private/reviewed-request.json
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json execute REQUEST_UUID APPROVED_SCOPE_HASH
```

Preparation JSON keys are exactly `requestId`, `workspaceId`, `connectionId`,
`caseId`, `artifacts`, `reviewComplete`. Artifact decisions carry exact table, UUID,
full old-content hash and `delete`/`keep_unrelated` action. `reviewComplete` records
review completion; it cannot authorize SQL rows outside the exact manifest or
substitute for owner approval. The existing revocation lifecycle must complete
before preparation; unresolved revocation stays held.

## Identified manual file copies

The connector does not create Storage originals. A user may nevertheless upload a
manual spreadsheet export or report copy. For an identified full original that the
owner authorizes for permanent removal, use the existing product flow **before
preparing an erasure request**:

1. Record the exact workspace, file ID and owner decision in the support case.
   The owner moves that file to Trash in Sources, then explicitly confirms permanent
   deletion in Settings → Usage & Storage. Historical protected Trash needs its
   separately authorized notice/recovery process; do not remove that protection.
2. Require the product purge response to report `ok: true, pending: false`.
   Its fixed server path calls Storage removal for the exact authorized
   `workspace-files` object and records protected purge timestamps only after
   provider success and metadata absence. The file metadata row remains available.
   A pending response is a hold, not completion; use the same product retry.
3. Include that exact retained `file_uploads` row/hash in the newly reviewed erasure
   scope. SQL requires the protected purge acknowledgement and present object
   metadata absence. Its `storageReceipts` bind file ID, exact bucket/object path,
   provider-acknowledged purge timestamp and full old-row hash into the approved
   scope and independently signed intent/completion. Original file bytes or cell
   values are never placed in this witness. Analysis-only removal continues to use
   `file_upload_analysis` and preserves the unrelated uploaded original.

This gives identified full copies a supported active-store removal process without
adding Storage credentials or arbitrary object deletion to the support CLI.
Database backups do not contain Storage object bytes. Separately copied/restored
objects still need their own current-provider check before activation; database
flags from a restored snapshot are not current proof of object absence.

If the witness inventory includes a full-file purge receipt, `restore` requires a
second argument naming a private 0600 Storage checkpoint JSON file. It must bind
`version: 1`, the exact `inventoryDigest`, `targetEndpointHash`, `checkedAt` (within
24 hours), `objectRestoreStatus: "not-restored"`, and `objects` equal to the exact
witnessed `storageReceipts`. It also contains an `evidence` array with at least:

- `{ "kind": "provider-object-absence", "path": "/private/retained/provider-proof", "sha256": "..." }`
- `{ "kind": "storage-restore-inventory", "path": "/private/retained/restore-proof", "sha256": "..." }`

Retain dated provider output/screenshots identifying the exact bucket/object absence,
and the restore inventory showing that Storage object backups were not restored.
The CLI reads the private evidence files, checks their digests, binds the checkpoint
to the exact object list and includes its digest in the final restore proof. It does
not infer absence from a checkbox or label its manual evidence as an API check.
The release owner must inspect those retained artifacts, verify no object restore
or write occurred after the check, and keep all workloads stopped until approval.
If an object was restored, remove it through a separately approved exact-object
product/provider operation, preserve that evidence and obtain a fresh checkpoint;
this CLI never grants itself Storage deletion authority. Missing, stale, mismatched
or unresolved object evidence keeps replay/activation closed.

## Daily retention processing

Isaac reviews the support queue each business day. Source and derivative reads are
hidden at the exact policy expiry; physical purge follows in the next business day
support run, as approved by the owner. Run the bounded routine and retain its
count-only result in the support case:

```text
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json daily-expiry
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json retention-due
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json prepare-retention /private/reviewed-expiry.json
```

The daily routine processes at most ten exact approved-policy requests per run. It
checks both first-import expiry and disconnected metadata expiry. It reports
completed, held and deferred counts, a bounded review queue and
`attentionRequired`; a full inventory page also signals possible backlog. Any held
request, failed witness write, legacy data without consent or deferred backlog
requires support follow-up that day. Continue reviewed batches until the queue is
clear; failures retain their request IDs for recovery. This is an operator-run
procedure, not an automatic production scheduler or a claim of completed purge.

For individually reviewed root selection, the preparation file has exactly `requestId`, `workspaceId`, `connectionId`, `caseId`,
and `rootIds` (one to 500 distinct UUIDs selected from the due inventory). SQL
requires each root to be due and explicitly authorized by the user's retention
policy; legacy/unattributed rows are held for review. The 13 calendar month limit
runs from the first import and does not reset on refresh, copying or reimport.
Disconnect adds a 30 day cap without extending the original 13 month expiry.
Execute the returned exact request/scope through the same `execute` command;
retention is never a wildcard table delete or an unjournaled alternate path.

## Isolated restore and external activation barrier

1. Restore to a distinct approved endpoint with application instances, workers,
   cron dispatch and outbound integrations **not started or routed**. Keep the old
   application's writers and support erasure execution quiesced during final
   inventory/replay/activation. An in-database active flag or arbitrary waiting
   period cannot establish this external barrier. Preserve actual deployment/drain
   evidence in the operational change; a checkbox is not evidence.
2. Provision a distinct restricted login **only on the isolated restore target**,
   with membership in `google_sheets_erasure_restore`. The production support role
   cannot call replay. Never grant this capability to the production support login.
   Use a separate reviewed config with `purpose: "isolated-restore"`, the exact
   restored endpoint hash and the independently retained original primary endpoint
   hash. The CLI refuses equality, preventing accidental replay against primary.
3. Read `inventory`; review its digest and request count. Run:

   ```text
   node tools/google-sheets-erasure/operator-cli.cjs /private/restore-config.json restore INVENTORY_DIGEST
   ```

4. Every witnessed pending intent, including uncertain commits, is replayed using
   exact targets and hashes. A matching signed terminal withdrawal cancels only its
   exact original intent; the restored withdrawal is reconciled without deleting
   those records. Unresolved or conflicting witness state cannot produce an
   activation checkpoint. Missing rows are idempotent; changed content or any
   remaining target blocks the checkpoint. The fixed `file_upload_analysis` target
   redacts only reviewed derived analysis fields while preserving the original file
   and Storage object. The fixed `vsi_request_content` target clears only the reviewed
   question hash and conversation link, retaining quota and cost accounting. No
   private signing key or local journal is needed. Full cloud
   inventory is re-read after replay. A restore-only finalization revalidates the
   exact manifests and lifts only their workspace barriers; old read tickets remain
   invalid. The independent inventory is checked once more before the checkpoint.
5. Retain the checkpoint with target endpoint hash, inventory digest, request count,
   all replayed scope/digest identities and zero remaining targets. It explicitly
   says `external-release-required`; the tool never starts workloads or routes
   traffic. Only after independent review of this proof, unchanged inventory and
   externally demonstrated old-writer drain may the release owner activate the
   restored deployment. If restore data predates an authorized hash, investigate
   the held rows and prepare separately reviewed exact authority; never bypass the
   hash fence or silently widen an old approval.

Exports, object storage and processor copies must be inventoried separately; SQL
replay cannot erase unknown external stores. The tool makes no full-deletion claim
while those remain unqualified.

## Synthetic qualification

```text
node --test scripts/google-sheets-erasure-journal-tests.cjs scripts/google-sheets-erasure-operator-tests.cjs
GOOGLE_SHEETS_TEST_PG_BIN=/absolute/native/postgres/bin node scripts/google-sheets-erasure-operator-native-tests.cjs
```

The native runner starts only its own disposable Unix-socket database, makes no
TCP listener or live provider calls, and exercises actual migration SQL with a
native backup/restore and concurrent writer sessions. The cloud adapter is injected
with an in-memory provider fixture; live Cloud Storage IAM, retention, account
binding and persistence still need the separately authorized provisioning check.

## Explicit private bootstrap and final provisioning scope

These steps are **pending final owner approval**, not work performed by this change.
Use one dedicated support workstation and login. The following proposed resource
names make the approval concrete; bucket availability and the selected storage
region must be checked before creation:

- Existing project: `vaeroex-integrations-prod`.
- Private bucket: `vaeroex-integrations-prod-sheets-erasure-witness`; Standard
  storage in `us-west1`, uniform access,
  public-access prevention enforced, versioning enabled, no lifecycle rules.
  No irreversible retention lock is proposed. Record current retention and soft
  delete metadata, cost ownership, and backup-expiry custody separately.
- Dedicated keyless identity:
  `sheets-erasure-witness@vaeroex-integrations-prod.iam.gserviceaccount.com`.
  A project custom role `SheetsErasureWitnessObjects` contains exactly
  `storage.buckets.get`, `storage.objects.create`, `storage.objects.get`,
  `storage.objects.list`, granted only on this bucket. No project-wide Storage role,
  application access, service-account key, object update/delete, or IAM permission.
- Isaac's approved operator identity receives only
  `iam.serviceAccounts.getAccessToken` on that exact service account through a
  custom impersonation role. The owner verified that IAM Service Account Credentials and Storage APIs are
  already enabled on project `711446392261`; no API enablement is proposed. The owner
  performs resource/IAM bootstrap separately; the restricted operator cannot.
- Production login `google_sheets_erasure_operator`: LOGIN, INHERIT,
  NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION,
  `CONNECTION LIMIT 1`; membership only in `google_sheets_erasure_support`, without
  ADMIN OPTION. Grant CONNECT to the intended database if required. No table,
  sequence, extra schema, or extra function grants. Supply a unique password through
  the approved private database credential channel; never paste it into SQL history,
  source, tickets, or command arguments. Store it only in the approved operator
  secret store and inject `GOOGLE_SHEETS_ERASURE_DATABASE_URL` for a session.
- At an actual isolated restore, create a different login on that target only,
  with the same negative capabilities and connection limit, but membership only
  in `google_sheets_erasure_restore`. No production restore login is needed now.

After local key initialization is approved, create persistent owner-only directories
outside the repository and temporary storage. With a private shell umask, run:

```text
node tools/google-sheets-erasure/bootstrap-cli.cjs key /approved/private/journal
node tools/google-sheets-erasure/bootstrap-cli.cjs package /approved/private/bootstrap-input.json
```

`key` is the only explicit key-generation command. It writes the private key solely
inside the journal and returns only public key/fingerprint. Save those public pins
privately. It refuses an existing key or nonempty journal; never rerun it as a key
rotation shortcut. `package` reads a 0600 file with exactly these fields:
`version: 1`, `bucket`, `datasetId` (fresh UUID), `serviceAccount`, `gcloudPath`,
`journalDirectory`, `outputDirectory` (existing 0700), `primaryEndpointHash`,
`publicKey`, `pinnedFingerprint`. Use the exact reviewed database identity hash and
public key from the preceding command. It writes three 0600 files in that directory:
`genesis.json`, `support-config.json`, `independent-pins.json`. The package is
idempotent only when all bytes agree. It does not connect to cloud or database.

Independently retain the public key, dataset, primary endpoint and genesis digest
outside this bucket and application/local-journal backup. Before any live genesis
upload or operation relying on this key, Isaac must store the encrypted recovery
image in his existing password manager, download/decrypt that stored copy, verify
its private key against the independently retained public fingerprint/dataset/genesis,
and detach the recovery mount. Local archive creation alone is insufficient.
Retain the completed nonsecret recovery receipt. After this gate and approved
bucket/IAM provisioning, upload **only** that exact genesis file, with a create-only generation
precondition, using the restricted impersonated identity:

```text
gcloud storage cp /approved/private/bootstrap/genesis.json gs://APPROVED_BUCKET/google-sheets-erasure/DATASET_UUID/genesis.json --if-generation-match=0 --impersonate-service-account=APPROVED_SERVICE_ACCOUNT
node tools/google-sheets-erasure/operator-cli.cjs /approved/private/bootstrap/support-config.json inventory
```

An existing genesis is read back and compared byte-for-byte; never overwrite it.
`inventory` must verify the exact pins, effective restricted IAM, current bucket
metadata and complete genesis-only inventory before any prepare/expiry run. Retain
that sanitized live receipt and verify the restricted database login separately.
After approved deployment, run one authorized synthetic-owner request through
normal confirmation, exact execute/retry and isolated restore; passing local tests
alone is not this live qualification. No real customer purge is a bootstrap test.

## Interrupted local journal recovery

Every new journal lock records and fsyncs its host/PID owner before a record write.
Do not kill a live operator merely to recover a lock, and do not remove `.journal-lock`
or `.stage-*`. Stop operator dispatch and retain the original directory. Recovery
requires the recorded writer to be dead on the same host; a missing/foreign owner
or reused/live PID is a hold for custody investigation. The dedicated DB login must
have no other session. Current witness inventory must be readable and stable.

```text
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json journal-inspect
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json journal-recover /private/recovery-plan.json
```

The private recovery plan contains exactly `snapshotDigest`, `inventoryDigest`
from inspection and `destination`, an existing empty 0700 persistent directory.
Recovery verifies all named signatures, exact conflicts, the original pinned key,
and independent receipts. It rebuilds only exact verified records in that **new**
directory. Incomplete staging bytes and the original lock remain untouched as
custody evidence. A verified receipt can recreate only its exact deterministic
pending record; it cannot widen targets or create approval. Source snapshot and
witness inventory are checked again. No destructive SQL or witness mutation runs.

The result is `config-cutover-required`, not resumed execution. Review the retained
inspection/rebuild evidence, stop all old operator invocations, then update only
`journalDirectory` in the private config. Reconcile each known pending request with
`status` and retry the same request or the signed withdrawal process. The due queue
includes `activeRequest` IDs/scopes, allowing discovery when a daily process died
after preparation but before printing its result. An unknown lock owner or lost
signing key remains held; preserve the directory and arrange separately reviewed
key/custody recovery rather than deleting evidence or generating a replacement key.

## Expiry continuation and recovery queue

Each `daily-expiry` invocation reads at most ten 100-row pages for each due source,
using the stable expiry/UUID cursor, and executes at most ten requests. Held rows
are still reported; they do not hide the next page. A result with `continuation`
contains the exact `{roots, disconnected}` object to save as a 0600 private file:

```text
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json daily-expiry /private/continuation.json
```

When eligible work is deferred, the cursor intentionally stays at the same starting
point until those rows complete; completed rows leave the due inventory. When a
bounded scan contains only held rows, the next cursor moves beyond them and their
recovery IDs stay in the retained review queue. Keep all held pages in the support
case and work their same-request recovery separately. Start each new business day's
sweep from the beginning so newly due earlier records are not skipped. Run until
`continuation` is null and deferred work is zero, then resolve any held/backlog alert.

## Exact manual artifact hash preview

After the owner identifies a specific manual/legacy artifact through the normal
product and the source is disconnected/revoked, retrieve its exact current hash:

```text
node tools/google-sheets-erasure/operator-cli.cjs /private/config.json artifact-preview WORKSPACE_UUID CONNECTION_UUID TABLE RECORD_UUID
```

The fixed support RPC validates that workspace/connection and a single allowlisted
artifact ID. It returns only `{table,id,hash}`; no row contents or general table
access. It neither classifies the artifact as Google-derived nor approves deletion.
Record the owner's exact `delete` or `keep_unrelated` decision separately and use
that hash in preparation. Changes after preview fail the hash check; preview again
and obtain a fresh review. A full-file original still requires the normal owner
Storage purge before preparation. An exact preview never bypasses that requirement.
