# Native PostgreSQL broker provisioning

Status: **managed SCRAM maintenance implementation; hosted qualification pending**.
The September 9 production-grade policy supersedes the historical absolute
nonrecording gate. Read [the current maintenance runbook](MANAGED-SCRAM.md).
Temporary Access/JIT is permanently parked and is not a dependency.

This is the
permanent native-role lifecycle, not a second database, administrative API-token
substitute, or a Sandbox credential shortcut. The ordinary executable exits
`policy_blocked` before connecting or reading credential input. There is no
runtime override. Local synthetic builds reject remote targets. The separately
compiled managed build pins exactly the approved isolated Sandbox target;
`maintenance.mjs` is an explicit operator tool, never an app/startup hook.

Read [the privacy decision and evidence](PRIVACY.md) before interpreting a green
test as permission to provision. Supabase ticket **SU-467250** is pending; its
response is not a prerequisite for code or local qualification. Known PANIC
statement capture is a restricted diagnostic risk under the revised policy, not
a claim of zero recording. Plaintext exposure remains a blocker. This change neither modifies the broker's runtime authority nor
enables Square.

## Fixed operation and target

The worker accepts exactly thirteen **nonsecret** arguments after its filename:

```text
OP HOST PORT DB ADMIN TARGET CAPABILITY SYSTEM_ID DB_OID ROOT_CERT INTENT EXPECTED_ROLE_OID APPROVAL_ID
```

This is a private supervisor protocol, not an end-user command builder. A future
reviewed deployment must supply its immutable approved target from trusted
configuration, not from HTTP requests or tenant input. An intent or approval ID
is correlation metadata, not evidence of authorization. Operations are only
`inspect`, `prepare`, `fence`, `assign`, `activate`, and `authenticate`.
`CAPABILITY` is exactly `square_account_broker_authority`. Targets use a
restrictive ASCII identifier grammar, never the administrator/capability role,
and cannot contain `qbo` or `password`. The latter exclusion also preserves
pgAudit's target metadata during canonical password redaction.

The tool does not accept SQL, URI/DSN expansion, functions, catalog writes,
service files, `.pgpass`, environment credentials, arbitrary grants, or an
application token. It pins the physical system identifier, database OID,
database name, authenticated administrator, role OID, library/server version,
transport and effective controls. Missing-role inspection uses OID `0`; creation
returns the actual OID for subsequent exact-target operations. A dropped and
recreated same-name role is not the same target.

The original synthetic version profile is PostgreSQL/libpq 17.6, pgAudit 17.1,
pg_stat_statements 1.11 and the pinned Supautils source in `tests/README.md`.
This matches the relevant evidence, **not a recommendation to run an old minor
release in Production**. A server/library/hook upgrade requires qualification
of that version before the profile can change. A version label alone does not
attest a provider's binary or loaded hooks.

The positive non-superuser fixture explicitly gives its synthetic operator
CREATEROLE, management rights for the capability, binding-table access, settings
visibility and backend-signalling rights. These are **not** grants to the broker,
not remote configuration, and not evidence that the hosted operator already has
them. Hosted review must establish a supported minimum permission set for the
fixed operation; a missing right causes denial, not a privileged wrapper fallback.

## Lifecycle and isolation

1. Verify closed authority, target identity and controls; persist a sanitized
   intent/outcome audit through the supervisor's injected audit interface.
2. For creation only, create a nonsecret **NOLOGIN** role and grant only the
   existing broker capability. Never auto-create the capability or grant a
   privileged monitoring/admin role. Rotation uses the pinned existing OID.
3. Fence: commit NOLOGIN, terminate existing sessions for that exact role, then
   reacquire the authority and role locks and verify no sessions remain. A
   password change by itself does not revoke existing sessions.
4. Assignment requires an already committed NOLOGIN role. Hold the three Square
   binding tables in SHARE mode, verify every binding for this broker is disabled
   and the role is not used for another capability, serialize this target, and
   acquire its tuple using a **nonsecret** ALTER before generating a credential.
5. Generate 512 random bits in the native process. Call supported libpq
   `PQchangePassword`, which hashes client-side with SCRAM and sends the fixed
   verifier-bearing ALTER. Privately stage and verify the candidate, receive a
   bounded acknowledgement, then attempt COMMIT. No audit record proves commit.
6. After a confirmed assignment and store acknowledgement, separately enable
   LOGIN only for candidate authentication while application authority remains
   closed. Authenticate using SCRAM on the pinned endpoint and verify actual
   `session_user`, role and database identity. This does not call a broker
   function, modify a binding, enroll a seller, or activate a route.
7. The coordinator returns only staged readiness. A deployment must independently
   review and authorize consumer cutover; this implementation does not perform
   it. Failure/cancellation compensates with a fresh fence, not stale success.

Existing `session_user` authority, transactional tenant/session/membership and
revocation checks, immutable versions, leases/CAS, private cursors, and pending-only
economics are reused unchanged. None of the existing migrations, application
sources, QBO bindings or feature gates is changed.

## Private transport and bounded process

Descriptor 3 is a bounded private administrator-input pipe (empty only in the
synthetic local trust fixture). Descriptor 4 delivers exactly 128 lowercase hex
characters and a newline to the private store; descriptor 5 accepts only
`STORED\n`. Descriptor 6 supplies the same-format candidate for actual SCRAM
authentication. Regular files, stdout/stderr and terminals are rejected for
these channels. The local JavaScript adapter never accepts real administrator
credentials or a remote secret provider.

Worker stdout contains only finite phase/outcome metadata and the numeric role
OID. It never prints server messages, error objects, credentials or verifiers.
Server notices are not forwarded. Core dumps are disabled; Linux dumpability is
disabled; owned secret buffers are locked and wiped. This does **not** claim
libpq, JavaScript, TLS or server memory is fully zeroized. Hosted operation needs
reviewed no-swap/no-core/no-heap-dump/no-debugging and private-delivery controls.

The process deadline is 15 seconds, database statement timeout 4 seconds, lock
timeout 1.5 seconds, transaction-idle timeout 8 seconds and private-store wait 5
seconds. Cancellation interrupts transport; closing/reaping a client is **not**
proof that a previously sent COMMIT rolled back. A fresh fence must reconcile
server completion before another credential is generated.

## Rotation, revocation and recovery runbook

- Serialize by exact role/OID, keep application bindings closed and reserve a
  new non-active secret version. Record actor, target, operation, intent, time,
  phase and finite outcome only. Never attach SQL, exception objects or a secret
  digest to auditing.
- Rotate by fencing the old login and existing sessions first. This deliberately
  permits a bounded maintenance interruption rather than unsafe dual authority.
  Stage a fresh unique replacement; don't overwrite or promote an unverified
  candidate. Consumer pools must close old sessions; server termination remains
  the authoritative fence.
- A missing database or store acknowledgement is **uncertain**. Stop; keep
  authority closed. Neither an audit event, an attempted COMMIT, a staged secret,
  an expired client process nor a log line establishes success.
- A bounded abort drain may preserve a valid authenticated late `prepare` reply
  so compensation can fence the exact created OID. If that identity reply is
  truly lost, do not infer it from a same-name role or an audit event. Keep the
  operation uncertain and require trusted nonsecret target/OID reconciliation
  and a newly approved exact-target coordinator before replacement. No password
  has been generated at this stage; do not blindly retry creation or adopt a
  concurrently replaced role.
- Recovery acquires a fresh target fence (waiting for prior transaction locks),
  verifies committed NOLOGIN and drained sessions, reconciles pending store
  versions, then assigns a **new** credential under a new intent. It does not
  read `pg_authid.rolpassword`, compare verifiers or blindly replay an uncertain
  assignment. Explicit provider-side reconciliation of secret version state is
  needed before hosted recovery can retire an orphan.
- Revocation closes application authority, commits NOLOGIN and drains sessions,
  disables refresh/task/credential consumers through their existing authority
  checks, then disables retired secret versions according to the separately
  approved retention policy. The tool neither chooses retention values nor
  revokes Square seller grants.
- If an unexpected diagnostic might contain a verifier: keep the broker fenced,
  preserve necessary sanitized incident evidence and audit, involve the provider
  through a private incident process, and issue a fresh replacement only after
  the exposure path is resolved. Do not erase logs/statistics to claim a pass.

## Local validation and delivery

`pnpm test:native-broker-provisioning` runs lifecycle and transport regressions.
`pnpm test:native-broker-provisioning-db` runs the actual native worker against a
fresh private matching database; see `tests/README.md` for dependency pins and
the CI build. The harness rejects remote targets and emits only sanitized
assertion results. Deliberate unsafe positive controls contain synthetic values
only and are isolated from the protected run. Raw fixture logs, statistics,
temporary secrets, binaries and dependency manifests are never PR artifacts.

## Finite hosted gates (not authorized by this change)

1. Resolve the known diagnostic-policy conflict by supported before-persistence
   protection or explicit approval of the exact proposed refinement in
   `PRIVACY.md`; independently review the resulting hosted entry point.
2. Attest the exact hosted version/build, hooks, dedicated session behavior,
   permitted SET controls and readback, TLS trust, role/config/table ACLs and
   logging/statistics/diagnostic surfaces. Supautils native ACL checks alone are
   insufficient. A denied setting stops before generating a credential.
3. Qualify the same fixed native operations with **synthetic values only** on the
   approved isolated host/database, including storage/transport loss, activity
   capture, deadlocks, role auditing, provider log exports and recovery. No
   broad audit disablement or payload-erasing workaround is acceptable.
4. Review and qualify the real private-store adapter and unattended operator
   authentication (not an administrative platform-token substitute), immutable
   target approval source, scoped credentials/IAM, no-dump runtime, rotation,
   durable sanitized audit, orphan reconciliation and break-glass recovery.
   No such credentials, resources or external configuration are created here.
5. Obtain explicit real-provisioning authorization for the pinned broker/OID,
   secret destination, retention/revocation procedure and maintenance window.
   Provision and privately verify under closed application authority; consumer
   enablement remains a separate action. No Square OAuth/live API authorization
   follows merely from database credential readiness.

Keep the Sandbox VM stopped, ingress closed and real broker provisioning
blocked throughout this PR. No cost-bearing resources or remote configuration
are needed for this code-only delivery.
