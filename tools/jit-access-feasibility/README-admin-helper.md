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
or pending invitation. The provider Dashboard's current role selector requires
LOGIN eligibility. After the helper reaches its private ready state and before
`i`, the coordinator must run the **existing, unchanged** reviewed `activate.sql`
through the isolated administrative path. It verifies physical/database identity,
the exact newly created role OID/flags/memberships and locked FORCE-RLS/privilege
boundaries before changing only LOGIN. Require fresh LOGIN/zero-session readback.
Retain the exclusive test-role setup evidence: `setup.sql` created NOLOGIN with
no PASSWORD, and no password-assignment path has run. Do not adopt an existing
role or claim that the masked `pg_roles.rolpassword` proves password absence.
Unknown credential assignment or concurrent administration blocks activation;
do not reset passwords, read verifiers or broaden access to satisfy this gate.

This moves the already-authorized activation immediately before invitation,
not before the initial nonsecret NOLOGIN or public-canary checks. LOGIN alone
does not create a JIT mapping or external token. The helper independently
rechecks its empty-list precondition before its one invitation. Do not create
an external PAT or attempt database authentication until the invitation's
matching response, exact readback and private recipient acceptance are confirmed.
If invitation/acceptance fails or is uncertain, immediately commit the unchanged
exact-role NOLOGIN fence, run its bounded drain, verify zero sessions and finish
the existing credential/grant/feature/network/VM cleanup. Do not widen permissions
or repeat invitation in that window. After the private prompt and this activation
gate, enter only these nonsecret cues:

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

## Bounded failure diagnostics

On a failed request the helper prints only a fixed operation (`list`, `invite`,
`update`, `revoke`), a local failure-category label, and a range-checked HTTP
status (100–599) or `unknown`. It never prints response bodies, header values,
curl error strings, request URLs, tokens, payloads or byte counts. Status can be
observed even when the transfer later fails; that is not a complete response or
proof of mutation success. TLS/connection/send/receive/timeout failures remain
distinct from a completed non-200 HTTP response. Unknown transport failures stay
unclassified rather than being interpreted as a provider rejection. A deadline,
request budget, setup failure, forbidden pagination or response-size limit has
its own fixed category. The existing five-second requests, request budgets,
strict HTTP200 requirement and independent authority readback are unchanged.

HTTP200 with a rejected response contract is labeled separately for list,
invitation and update. An empty mutation readback is distinguished from a
nonempty mismatched scope. Neither clears the uncertainty latch, authorizes a
retry or establishes why the provider did not leave the expected mapping.
Cleanup absence is a current readback observation, not acknowledgement evidence.

The isolated 2026-09-09 attempt reached the private ready state, but its single
invitation produced `jit_admin_mutation_scope_unconfirmed_stop`; cleanup found
absence while retaining acknowledgement uncertainty. The old binary did not
retain/report its HTTP/transport category, so that cause cannot be reconstructed
from these labels. No external credential or PostgreSQL session was created;
the operator revoked the administrative PAT and the isolated host/access path
was closed. Synthetic cases reproduce that formerly indistinguishable sequence
for HTTP400/403/409/429/500, unexpected201, timeout-before-commit and missing
readback, without asserting which happened on the provider.

Current Dashboard [role eligibility](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Settings/Database/JitDatabaseAccess/JitDbAccess.utils.ts)
also excludes NOLOGIN roles via `isAssignableJitRole`. The prior attempt kept the
test role NOLOGIN. That is a concrete Dashboard prerequisite discrepancy, not
proof of this hosted API failure's cause. The preparation sequence above moves
the existing checked LOGIN activation before invitation; no role has been
activated by this code-only correction, and no SQL, privilege, PAT permission,
native request scope or automatic grant ordering is changed. The prior HTTP
outcome remains unknown. The next admitted attempt tests this supported
prerequisite with finite diagnostics; do not rerun the NOLOGIN sequence or use
wider authority merely to obtain a pass. A completed non-200 response requires
status-specific contract/permission analysis; a transport failure requires that
transport diagnosis; a rejected response contract requires exact nonsecret
contract evidence. None authorizes a blind retry or broader grant.

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
range-checked HTTP status, the already nonsecret bound user UUID and grant expiry timestamp. Parser state is
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
98 counted checks cover three grants, invitation acceptance, exact private ID binding,
both removal paths, hostile/oversized/embedded-NUL responses, pagination/unknown
schema rejection, TLS/HTTP/timeout/cancellation failures, lost acknowledgements,
foreign-then-restored fail-stop sequences, bounds, input and environment rejection.
The additional24 counted executions assert operation/status/category diagnostics
and formerly indistinguishable invitation outcomes; some repeat existing failure
fixtures with more precise assertions, not24 wholly new independent behaviors.
Sanitizers instrument only this new suite; existing settled runner/canary tests
are not repeated. The macOS AddressSanitizer attempt aborted in its own malloc
initialization (`sanitizer_malloc_mac.inc:189`) before helper `main`; it is not a
passing sanitizer result. The isolated Ubuntu/GCC run on 2026-09-09 subsequently
passed the then-current74 checks. Exact-head CI34391866527 on the diagnostic
correction subsequently passed all98 checks in normal, UBSan and ASan/UBSan
profiles. These repeat the same suite under three profiles, not294 distinct
behaviors. They establish
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
