# Isolated JIT administrative helper

This is a fixed-purpose, one-window administrative companion to the already
reviewed external-identity test runner. It is not a broker integration, an
administrative database connection, or evidence of hosted qualification. The
ordinary build exits with `jit_admin_hosted_execution_blocked`. No provider call,
token issuance, token entry or hosted execution occurred during its local tests.

## Fixed authority and current provider contract

The only target is project `oysjpoondtcrqpghhrbd`; the only recipient is
`isaac+vaeroex-jit-feasibility@vaeroex.com`; the only native role is
`vaeroex_jit_feasibility_20260908`. Every grant includes exactly
`8.229.223.109/32`, no IPv6 networks and `branches_only:false`. No other user,
role, endpoint, request body, SQL, hostname or project is accepted as input.

One **new**, project-scoped administrative PAT is entered by the authorized
Owner privately and held in this single process for at most the existing one-hour
window. The actual provider UI's **Database JIT Read-write** choice includes
both `database_jit_read` and `database_jit_write`, not Write-only. All other
capabilities must remain None, and only this isolated project may be selected.
This unavoidable bundle is stronger than JIT Write-only; it must not be described
otherwise. The helper never connects to PostgreSQL, invokes database/query,
creates a grant for the Owner, or substitutes this administrative PAT for the
external identity's JIT Read PATs. Do not read/reuse an existing Owner PAT.

The current official [Management API OpenAPI specification](https://github.com/supabase/supabase/blob/master/apps/docs/spec/api_v1_openapi.json)
defines these five operations with `database_jit_write` permission:

| Operation | Fixed path below `/v1/projects/oysjpoondtcrqpghhrbd/database/jit` | Request / required readback |
| --- | --- | --- |
| Invite | `POST /invite` | Exact email plus `roles` array; response email, invite UUID, `user_roles` |
| List | `GET /list` | Complete `items` array; no pagination parameter documented |
| Grant/update | `PUT` at the base path | Server-bound user UUID plus `roles`; require matching response UUID and `user_roles` |
| Revoke accepted access | `DELETE /{user_id}` | UUID learned from verified exact recipient mapping; independent absent readback |
| Revoke pending invitation | `DELETE /invite/{invite_id}` | UUID learned from this invocation's invitation/readback; independent absent readback |

Pending list entries have `user_id:null`, `invite_id:<UUID>`, string
`expires_at`, exact `primary_email`, and `user_roles`. Accepted entries have
`user_id:<UUID>`, `invite_id:null`, `expires_at:null`, exact `primary_email`, and
`user_roles`. A null/missing email does not prove recipient identity. Acceptance
occurs on the provider-controlled recipient screen, not through this helper.
The helper requires the accepted response UUID even though the update OpenAPI
marks it optional; omission stops qualification rather than guessing identity.

Role `expires_at` is integer **Unix seconds**. Current
[Dashboard serialization](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Settings/Database/JitDatabaseAccess/JitDbAccess.utils.ts)
uses `dayjs(...).unix()` and multiplies readback by 1,000 for display. The current
OpenAPI request key is `roles`; older guide examples using `user_roles` requests
and millisecond role expirations are not the implemented contract. Unknown,
duplicate, escaped/non-ASCII or extra fields, foreign list entries, multiple
roles, wider networks, unexpected booleans/types or pagination headers reject.
This intentional strictness may require a fresh supported-contract review if the
provider changes representation; it never normalizes unknown authority.

The current scoped-PAT
[permission serializer](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Account/AccessTokens/AccessToken.permissions.ts)
concatenates Read and Write scopes for Read-write. Current
[custom-expiry UI](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Account/AccessTokens/Scoped/Form/TokenDetails.tsx)
uses the selected date's end-of-day, not a minute-level expiry input. A 24-hour
administrative PAT must therefore be explicitly revoked after this window; it
does not authorize 24 hours of helper use. The separate external PAT-expiry test
must not infer a minutes-long PAT lifetime from this date picker.

## Private execution prerequisites and lifecycle

Use only the existing reviewed dedicated Linux host, trusted OS packages, clock
synchronization and a private **operator-controlled**, non-recorded terminal.
Do not enter any real PAT through a Codex-captured PTY, chat, an argv value,
environment variable, file, shell read/export, terminal transcript or any
clipboard/history/synchronization mechanism. For this run the operator manually
transcribes the new credential directly into the native no-echo TTY only after
the full hosted pre-token privacy gates pass; copying and pasting is not allowed.

Follow [the private-entry handoff](PRIVATE-ENTRY.md). Entry permits at most
300 seconds, capped by the original process deadline, with no per-character
extension. `jit_admin_private_input_timed_out` distinguishes expiry from
`jit_admin_private_input_rejected`; neither reports received bytes or their
length. Both exit before the first authenticated API request and wipe owned
input memory. A rejected/expired attempt cannot prove that no bytes arrived.

Require no swap, no core/crash-memory persistence, no request/header capture,
no TLS key logging, no process tracing/recording, and trusted host/launch access.
Environment injection can run before `main`: an environment check is not a
defense against an already-compromised loader or host. Launch with the documented
clean trusted executable environment, not an inherited shell environment.
The helper permits only `PATH=/usr/bin:/bin`, `LANG=C`, and `LC_ALL=C`.

Before prompting it verifies core limits are zero, Linux nondumpability readback,
successful `mlock` of its bounded owned private buffer, libcurl >= 7.85 with TLS,
and resolution of the fixed public API hostname. Each request pins that resolved
IPv4 address while retaining hostname verification. HTTPS only, certificate and
hostname verification, fixed system CA paths, disabled proxy/netrc/redirects,
no verbose/debug callbacks, fresh connections and five-second request deadlines
are enforced. DNS resolution occurs before credential acquisition and may block;
the external absolute-window supervisor still bounds the whole invocation.

The sole nonsecret argument is the approved window's absolute end timestamp in
10-digit Unix seconds, no more than 3,600 seconds and more than 600 seconds ahead.
Do not restart the deadline to create another window. After admission a monotonic
deadline prevents wall-clock rollback extending the process. Grant timestamps
still require the synchronized wall clock. The helper admits no grant expiring
after `window_end - 600`, reserving at least ten minutes for cleanup. Keep the
independent native NOLOGIN/session-fence path available throughout the window.

The initial complete project list must be empty. Never adopt an existing grant
or pending invitation. After the private prompt, enter only these nonsecret cues:

1. `i`: send one eight-minute invitation; require mutation response **and** exact
   independent list readback. The recipient accepts privately.
2. `r`: inspect sanitized state, bind the server-returned user UUID only to the
   exact approved recipient/role/network/expiry, and coordinate external runner A.
3. After the eight-minute grant expires and the external runner's expiry checks
   finish, `t`: replace the same bound recipient's grant for ten minutes. This is
   allowed only once and only after the initial expiry timestamp.
4. `x`: revoke that exact current grant, then require absence on independent
   readback. Coordinate reconnection and existing-session fencing checks.
5. `f`: one final regrant to the already bound recipient, ending at
   `window_end - 600`, for the remaining sequential external PAT B tests. It is
   allowed only after the ten-minute grant's confirmed removal.
6. `x`, then `q`: remove and read back absence; wipe process-owned credential
   memory. Independently revoke the administrative PAT and finish all existing
   native role/session, external test PAT, feature/network and stopped-VM cleanup.

`x` also removes a still-pending owned invitation. `q` attempts verified removal
before exiting. There is no automatic grant retry. At most 40 ordinary HTTP
attempts plus 20 reserved cleanup attempts are allowed. Cancellation/timeouts
restore the TTY and wipe owned buffers; they cannot guarantee remote cleanup.
The helper never revokes its own administrative PAT: that is a mandatory private
provider-controlled operator action, separate from its five allowed endpoints.

## Uncertain acknowledgements, scope changes and recovery

An HTTP success alone is insufficient: every mutation needs matching structured
response and separate state readback. Lost/malformed acknowledgements or any
failed/malformed/foreign authority readback permanently close further grant
creation/renewal for that invocation. Later clean reads cannot clear the latch.
Bounded readback and exact-scope deletion remain available; output distinguishes
observed absence from an uncertain earlier acknowledgement. Do not claim a
completed qualification from an inconclusive run.

The API currently has no documented conditional-write/CAS/ETag guarantee.
Deleting a user's JIT access removes **all** their mappings. Therefore the window
requires exclusive JIT administrative writer control and the pristine dedicated
identity: no concurrent dashboard/API grant changes by any other administrator.
The helper checks the exact sole mapping immediately before deletion but cannot
make that read/delete atomic. Any known concurrent administrative activity stops
the run; it must not be hidden by a successful later readback. If exclusive
control cannot be established, do not acquire the administrative credential.

After process loss/restart the helper refuses to adopt remaining server records.
The independent authorized Owner must inspect the exact recipient, role and
network on provider-controlled screens or an independently reviewed fixed
recovery path; do not broaden a delete or restart with invented IDs. Fence the
exact PostgreSQL role and drain its sessions immediately through the existing
nonsecret reviewed SQL path, revoke the new administrative/external PATs, and
disable test access. Unconfirmed control-plane removal stays a reported cleanup
gap; native session fencing is not falsely reported as provider-side grant
deletion. No unrelated mappings, records or logs may be deleted.

## Memory, diagnostics and local evidence

The helper has a 4,097-byte token buffer, bounded owned Authorization header and
16-KiB body buffer, all in one locked region. Each libcurl slist header copy is
locked and wiped before freeing; the owned token/header/body are wiped at exit.
Bodies and headers are never printed; output is a finite set of sanitized labels,
the already nonsecret bound user UUID and grant expiry timestamp. Parser state is
bounded to 128 nodes/depth eight and holds offsets, not copied string values.
The format prefix check only rejects obvious wrong input; it is not token
validation and invents no undocumented minimum PAT length.

**This is not library-wide zeroization.** libcurl/TLS can make internal copies,
and slist allocation precedes its `mlock`. No-swap/no-dump trusted-host controls
are prerequisites for those intervals and copies. Provider authentication,
proxy and diagnostic nonrecording remain hosted qualification obligations under
the unchanged privacy policy. No PANIC or unknown diagnostic-retention exception
is created by this helper.

Logs Explorer serializes its search query into the browser URL. Never search for
a real PAT, token substring, secret or credential hash. Diagnostic inspection
uses only the public invalid canary, nonsecret test role and approved time window;
do not create a secondary credential record while checking for recording.

Run only its new offline suite:

```sh
python3 -S tools/jit-access-feasibility/validate-admin-helper.py
python3 -S tools/jit-access-feasibility/validate-admin-helper.py --ubsan
python3 -S tools/jit-access-feasibility/validate-admin-helper.py --sanitize
python3 -S tools/jit-access-feasibility/validate-private-entry.py --include /usr/include/postgresql
```

The suite links a fake libcurl, so no network library or socket path exists. It
exercises the real private TTY/memory/parser/lifecycle code using synthetic strings:
74 checks cover three grants, invitation acceptance, exact private ID binding,
both removal paths, hostile/oversized/embedded-NUL responses, pagination/unknown
schema rejection, TLS/HTTP/timeout/cancellation failures, lost acknowledgements,
foreign-then-restored fail-stop sequences, bounds, input and environment rejection.
Sanitizers instrument only this new suite; existing settled runner/canary tests
are not repeated. The macOS AddressSanitizer attempt aborted in its own malloc
initialization (`sanitizer_malloc_mac.inc:189`) before helper `main`; it is not a
passing sanitizer result. The isolated Ubuntu/GCC run on 2026-09-09 subsequently
passed all 74 cases in normal, UBSan and ASan/UBSan profiles. These are the same
74 behaviors under three profiles, not 222 distinct behaviors. They establish
neither real Management API behavior nor provider privacy. See
[QUALIFICATION.md](QUALIFICATION.md) for hosted gaps and the site-hook precaution.

Approved-host build, **not executed by these preparation tests**:

```sh
cc -std=c11 -O2 -Wall -Wextra -Werror \
  -DJIT_ADMIN_APPROVED_SANDBOX_20260909 \
  tools/jit-access-feasibility/admin-helper.c -lcurl -o /tmp/jit-admin-helper
```

Require independent review of exact source hashes, the new suite on the actual
Linux host, fixed trusted-launch/library verification, no-secret native/TLS
preflight and all existing privacy/audit/cleanup gates before any PAT issuance or
entry. No extra infrastructure or paid resource is introduced by these files.
Square, the credential broker, Production and QBO remain unchanged and dormant.
