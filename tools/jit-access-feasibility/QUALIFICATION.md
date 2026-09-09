# Isolated Temporary Access feasibility tooling

Status as of 2026-09-09 UTC: **synthetic client/fixture evidence, not completed
hosted authentication qualification and not a selected Production mechanism**.
Ordinary native binaries fail closed before input or network. Explicitly named
Sandbox profiles are fixed-target qualification tools, not deployed application
features. No application import, migration, deployment hook, Square capability
or QBO permission is added by this directory.

## Evidence and corrections

| Boundary | Observed evidence | Not established |
| --- | --- | --- |
| External PAT client |69 fake-library cases passed locally and on the isolated Ubuntu host with GCC/libpq16.15 headers |Actual PAT authentication, provider API denials or expiry |
| Public invalid canary |20 cases passed against actual libpq17.6 locally and libpq16.15 on Ubuntu, loopback TLS only |Hosted pooler TLS/password handling or diagnostic nonrecording |
| Fixed administrative helper |74 cases passed normally and under UBSan locally; the same 74 passed normal/UBSan/ASan+UBSan on Ubuntu |Real invitation acceptance, grant update/removal or provider response contract |
| Native synthetic fixture |84 assertions passed in each of psql and separately rendered Dashboard modes against private local PostgreSQL17.6: 74 existing plus 10 delivery portability checks |Hosted JIT identity, application authority, provider revocation/session behavior |

Independent reviews covered the client, fixture and canary when prepared, and
the new helper separately. A concrete helper finding was fixed: unsuccessful
or foreign authority readback permanently closes further grant creation, even
if a later response appears valid. Focused regressions exercise this latch.
Actual GCC testing then found compact statement indentation and an ignored
signal-handler `write()` result. Independently reviewed narrow corrections
preserved control flow and strict `-Werror`; actual Linux suites subsequently
passed. macOS ASan aborted inside sanitizer initialization before helper main;
that failed attempt is not counted as a pass or used to waive Linux testing.

The initial Linux Python test failure activated Ubuntu's site-installed Apport
exception hook, which attempted a crash-report write. Existing permissions
denied it; a subsequent filename-only check found no corresponding test report.
No real credential existed. Standard-library-only harness commands now use
`python3 -S`, which excludes automatic `site` initialization and that observed
hook. Real credential entry must be **direct native C in the operator's private
TTY**, never these Python/PTY harnesses. This excludes the specific Python path;
it does not attest native/client-library/provider diagnostics or prove zero
recording. No audit, logging setting or retention policy was weakened.
See [Python's documented `-S` behavior](https://docs.python.org/3/using/cmdline.html#cmdoption-S).

The isolated host's nonsecret preflight verified no swap, disabled native core
and crash-memory persistence, inactive callback/capture services, preserved
SSH/OS Login/authentication logging and recovery, trusted packages, and no
application listener. Approved-profile binaries compiled and linked only the
inspected distribution libraries, with no RPATH/RUNPATH; root-owned inert
installation hashes matched. No credential-bearing binary was executed.
Those observations apply to that boot only and must be refreshed before use.

## Actual hosted run outcome

The one-hour admission started 03:25:11 UTC. The 15-minute credential-admission
cutoff was missed during Linux portability corrections. No PAT, external JIT
grant/invitation, LOGIN activation, provider-facing canary, hosted native
authentication, or Square call occurred. Offline Linux work finished, temporary
database egress was removed, and the VM was confirmed stopped at 03:48:07 UTC.
Public HTTP/HTTPS ingress stayed closed. The exact synthetic role remained
NOLOGIN with zero sessions; no test credential existed to revoke. The database
feature was not enabled during this window and SSL enforcement remained on.
This is an **incomplete run**, not a provider failure or successful qualification.

Only the approved compiler/client distribution packages and inert nonsecret
test files were installed. No cloud key/secret/IAM grant, billable resource,
remote migration, logging workaround or application deployment was added.
The approximately 23-minute interval models about USD0.004 compute, not a final
provider charge. Existing stopped disk/IP costs remain; alerts are not a hard
spending cap. Production, QBO and the password-provisioning release gate were
not changed.

## Finite remaining hosted gates

1. Refresh exact isolated resource/role/feature identity, private operator and
   recovery access, no-recording host/launch controls, budget admission and the
   hard cleanup deadline. Reuse successful immutable-source synthetic evidence;
   do not reset process, attempt or window budgets to fit unfinished tests.
2. Run the fixed **public invalid** native canary while the role stays NOLOGIN
   and before any PAT exists. Correlate available authentication/pooler/host
   diagnostics using only its public marker, role and time window. A known
   sensitive recording path blocks real credentials; an inaccessible surface
   remains unknown, not an approved privacy exception. Dashboard log-search SQL
   enters its URL: never search using a PAT or credential-derived value.
3. Privately issue at most one new target-only administrative JIT Read-write PAT
   and two external-identity target-only JIT Read PATs, all other capabilities
   None, only after every pre-token gate passes. No existing Owner token or
   ordinary membership substitution. The administrative helper cannot query
   PostgreSQL or grant database access to its Owner. Its actual provider scope
   includes both JIT Read and Write; it is not falsely described as Write-only.
4. Complete the fixed bounded grant/recipient acceptance, exact-OID activation,
   actual session_user/RLS/denial/reconnect matrix, grant expiry, renewal,
   revocation, PAT replacement and independent NOLOGIN/session drain. Treat
   failed acknowledgements or generic failed connections as inconclusive until
   reconciled. Observe held-session behavior separately from new connections.
5. Remove only test-created grants/invitations, privately revoke all issued
   PATs, confirm exact-role NOLOGIN and zero sessions, restore test feature state,
   remove exact temporary database egress and stop the VM. Preserve unrelated
   records, useful audit and existing callback permissions. Unknown cleanup is
   reported, never inferred from a request being sent.

The inspected 24-hour preset PAT expiry does not fit this test window:
manual replacement/revocation is testable, natural PAT expiry remains a separate
qualification gap. A one-hour grant-expiry test cannot establish PAT expiry.
Manual credential maintenance may be operationally practical, but requires a
named primary/recovery owner, expiry monitoring and repeatable replacement and
outage procedures. Feature Preview/public-alpha maturity, unattended operation,
approved persistent credential storage and privacy qualification remain explicit
Production decisions. A successful later Sandbox test will not decide them.

## Delivery boundary

Version only the 19 source/fixture/README files, this sanitized summary and
the existing CI workflow's synthetic-only registration. Account handoff,
authorization history, machine-local authentication paths, execution receipts,
resource plans, Terraform state, diagnostic exports and credentials are excluded.
Fixture SQL remains under `tools/`, not application migrations. CI may compile
approved profiles but must execute only blocked, fake-library or private-local
profiles; it must never obtain or use a provider token.
