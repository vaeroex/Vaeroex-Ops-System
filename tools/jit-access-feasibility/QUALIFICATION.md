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
| Fixed administrative helper |98 counted checks passed normal/UBSan locally and normal/UBSan/ASan+UBSan in exact-head Linux CI34391866527; repeated profiles/cases are not distinct behaviors |Real invitation acceptance, grant update/removal or complete provider response contract |
| Native synthetic fixture |164 assertions passed independently in each of psql and separately rendered Dashboard modes against private local PostgreSQL17.6, including the corrected activation boundary |Hosted JIT identity, application authority, provider revocation/session behavior |

Independent reviews covered the client, fixture and canary when prepared, and
the new helper separately. A concrete helper finding was fixed: unsuccessful
or foreign authority readback permanently closes further grant creation, even
if a later response appears valid. Focused regressions exercise this latch.
Actual GCC testing then found compact statement indentation and an ignored
signal-handler `write()` result. Independently reviewed narrow corrections
preserved control flow and strict `-Werror`; actual Linux suites subsequently
passed. macOS ASan aborted inside sanitizer initialization before helper main;
that failed attempt is not counted as a pass or used to waive Linux testing.

The first remote code review identified a separate concrete fixture-activation
gap. Independent local counterfactuals using the original activation guard
reproduced LOGIN plus two-workspace visibility after disabling RLS, changing
the policy to `USING (true)`, or adding a permissive policy. Removing FORCE alone
also passed the original guard but still returned one row for this nonowner
role: that case is contract drift, not a separately reproduced row leak.
All records and identities in these reproductions were synthetic; no hosted
activation or credential existed. The narrow correction checks both RLS flags
and the exact native-identity/workspace policy, rejecting drift before LOGIN;
verified READ COMMITTED isolation and transaction-held relation locks protect
that check through commit against the relevant policy/RLS DDL. An already-open
incompatible snapshot transaction rejects. Eleven drift variants preserve
NOLOGIN; independent reruns also cover lock contention and rollback. It never
repairs or broadens a hosted policy.

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

## First historical hosted run outcome

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

## Latest bounded hosted observation

The later2026-09-09 window at18:30:15–18:43:36.912UTC reached private administrative
entry/readiness and the authenticated empty-list baseline. One invitation could
not confirm mutation scope. Subsequent helper and independent Dashboard readback
showed no access entry, but the original HTTP/transport outcome was not retained.
No external PAT, LOGIN activation or PostgreSQL authentication occurred. The
operator revoked the adminPAT; roleNOLOGIN/zero sessions, Temporary Access and
UIpreviewOFF, removed temporary egress, stopped exactVM and closed public ingress
were confirmed. This is not a successful external authentication qualification.
Fixed non-payload diagnostics now separate the request failure categories.

## Finite remaining hosted gates

1. Refresh exact isolated resource/role/feature identity, private operator and
   recovery access, no-recording host/launch controls, budget admission and the
   hard cleanup deadline. Reuse successful immutable-source synthetic evidence;
   do not reset process, attempt or window budgets to fit unfinished tests.
2. Reuse the completed corrected **public invalid** native canary evidence when
   its dependencies and required freshness conditions are unchanged. If a concrete
   changed dependency or failed check requires a rerun, keep the role NOLOGIN
   and before any PAT exists. Correlate available authentication/pooler/host
   diagnostics using only its public marker, role and time window. A known
   sensitive recording path blocks real credentials; an inaccessible surface
   remains unknown, not an approved privacy exception. Dashboard log-search SQL
   enters its URL: never search using a PAT or credential-derived value.
3. Privately issue at most one new target-only administrative JIT Read-write PAT,
   all other capabilities None, only after every pre-token gate passes. No existing Owner token or
   ordinary membership substitution. The administrative helper cannot query
   PostgreSQL or grant database access to its Owner. Its actual provider scope
   includes both JIT Read and Write; it is not falsely described as Write-only.
4. After private administrative readiness and an empty access-list baseline,
   run the unchanged physical/database/OID/locked-FORCE-RLS `activate.sql`
   **before** the single invitation; read back LOGIN and zero sessions. Current
   Dashboard role eligibility excludes NOLOGIN. Preserve exclusive administrative
   control and the exact new-role/no-password setup provenance; unknown credential
   assignment or concurrent changes block this gate. Never adopt/reset a role or
   broaden privileges. The helper rechecks the pristine list before invitation.
   Require matching invitation acknowledgement, exact readback and private
   recipient acceptance before issuing external PAT A or native authentication.
   At most two sequential external-identity target-only JIT Read PATs (A then B
   at its replacement phase) may be issued, all other permissions None.
   Any invitation/acceptance failure immediately requires committed exact-role
   NOLOGIN, bounded drain/zero-session readback and the cleanup in step5; no blind
   retry or widened authority. This sequencing satisfies the known prerequisite,
   not proof of the previous hosted failure's cause.
   Then complete the actual session_user/RLS/denial/reconnect matrix, grant expiry, renewal,
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
