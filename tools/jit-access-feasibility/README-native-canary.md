# Pre-token native transport canary

This closes one missing **test-tooling** gap: an actual libpq TLS/password-failure
exercise before PAT creation. It does not select Temporary Access for Production,
qualify hosted diagnostics, or enable the credential-bearing runner. The
previous binary produced an undifferentiated inconclusive result in two
public-invalid hosted attempts, including one with project Temporary Access
enabled. No PAT or grant was created; cleanup was verified. This correction
adds finite observations, not a diagnosis of those attempts or a privacy waiver.

## Fixed scope and execution gates

The ordinary build prints `native_canary_hosted_execution_blocked` and exits 78
without inspecting arguments, environment, input or networks.
`JIT_CANARY_APPROVED_SANDBOX_20260908` is the explicit Linux-only test build.
Neither executable accepts an argument, input value, DSN, token or target override.
There is no credential prompt, credential generation, arbitrary SQL or HTTP.

The approved profile uses only:

- Host `aws-0-us-west-2.pooler.supabase.com`, port 5432, database `postgres`.
- Transport user `vaeroex_jit_feasibility_20260908.oysjpoondtcrqpghhrbd`.
- Public never-issued marker `sbp_fcPUBLIC_INVALID_CANARY_20260908_NEVER_ISSUED`.
  This is source text, not a generated, provisioned, valid or secretly stored PAT.
- Fixed `jit=true` and `search_path=pg_catalog` startup options. No query follows,
  even if the server unexpectedly authenticates the marker.

At most **two sequential connection attempts**, one open connection at a time:

1. Normal `verify-full` with the real pinned hostname, then the public invalid
   marker only if libpq negotiates an allowed password authentication method.
2. After a terminal failed primary connection with TLS observed, a deliberate name-negative TLS
   attempt to the **same resolved IP and port**. The verification name is
   `vaeroex-jit-tls-negative.invalid`; it is never resolved or used to select a
   different network endpoint. This attempt must fail before password use.

The independent name-negative diagnostic can run even if the primary rejection
has another hint or precedes password use. It does not turn that primary failure
into an authentication pass. Timeout, cancellation, unobserved TLS or unexpected
authentication skips the second attempt. The unchanged positive transport label
still requires TLS, password use, terminal failed polling and the formatted
28P01 hint. Other failures are classified separately and remain inconclusive.

The current VM's firewall may not permit port 5432. A blocked connection is not
authentication rejection. Complete the separately reviewed network/admission
gate before execution; this artifact changes no firewall, role, feature or grant.
Keep the role NOLOGIN during the canary; do not activate it or create a grant/PAT
to force this check to pass. A provider refusal before the password challenge is
an inconclusive result to report.

## Finite diagnostic contract

Each completed attempt emits these `native_canary_primary_` or
`native_canary_hostname_negative_` fields. Values come only from fixed source
literals, never raw errors, arbitrary SQLSTATEs, protocol data, endpoints or
credentials:

| Field | Values / meaning |
|---|---|
| `completion` | `connect_failed`, `authenticated`, `timeout`, `cancelled`, `io_failed`, `socket_unavailable`, `allocation_failed`, `unknown` |
| `polling` | Last libpq poll result: `not_polled`, `reading`, `writing`, `active`, `failed`, `ok`, `unknown` |
| `timeout` | `yes` when the attempt deadline wins; `no` when completion is observed before it; `unknown` on cancellation or absent observation |
| `tls_observed` | `yes` if libpq reported TLS in use during polling; otherwise `unknown`, not a claim that TLS never existed or certificate checks completed |
| `password_used` | `yes`/`no` from the supported libpq status API, or `unknown` without a connection observation |
| `rejection_hint` | Bounded formatted `28P01`, `28000`, `XX000`, `unclassified` or `unknown`; not structured error provenance |
| `expected_rejection_hint` | Whether the bounded `28P01` hint matched (`yes`/`no`/`unknown`); not a verdict on whether other rejection is legitimate |
| `hostname_mismatch_hint` | Whether the fixed libpq hostname-mismatch phrase was observed (`yes`/`no`/`unknown`) |

`native_canary_hostname_negative_ran=yes/no` distinguishes attempted from
skipped testing. Default-disabled and other early precondition exits retain
their existing fixed labels without performing either connection. An absolute
process alarm emits `native_canary_window_exhausted`, marks the interrupted
attempt's observations `unknown`, reports whether negative testing started and
exits75 using async-signal-safe writes. It does not invent observations from
partially processed connection state. Previously completed records remain valid.

### Expected rejection for no grant and NOLOGIN

The documented requirements are enabled project Temporary Access, enforced SSL
and the IPv4 pooler option. Documentation does **not** guarantee a SQLSTATE for
an arbitrary never-issued token. At public Supavisor commit
`a16d27155d894c1ff0977cd9eebd999f51aede08`, JIT is selected only after tenant and
connection checks; it challenges for a password over TLS and then requests JIT
authorization before upstream setup:

- JIT-provider401/403 or a different authorized role maps to28P01.
- An unexpected/malformed provider response or request failure maps toXX000.
  Tenant/configuration checks can also reject before a password challenge.
- PostgreSQL NOLOGIN rejection is28000 and follows authentication in the normal
  PostgreSQL startup order. NOLOGIN does not imply no password challenge.

Thus XX000 or28000 can represent legitimate fail-closed behavior, but neither
proves invalid-token denial, JIT routing or successful authentication. They are
**not** added to the transport-pass allowlist. Project PostgreSQL build17.6.1.166
does not identify the deployed Supavisor commit; the actual proxy build and JIT
provider response remain unverified. Keep the exact role/grant state unchanged.

Pinned primary source:
[JIT mapping](https://github.com/supabase/supavisor/blob/a16d27155d894c1ff0977cd9eebd999f51aede08/lib/supavisor/client_handler/auth_methods/jit.ex),
[28P01 override](https://github.com/supabase/supavisor/blob/a16d27155d894c1ff0977cd9eebd999f51aede08/lib/supavisor/errors/jit_unauthorized_error.ex),
[defaultXX000](https://github.com/supabase/supavisor/blob/a16d27155d894c1ff0977cd9eebd999f51aede08/lib/supavisor/error.ex),
[connection ordering](https://github.com/supabase/supavisor/blob/a16d27155d894c1ff0977cd9eebd999f51aede08/lib/supavisor/client_handler.ex),
[PostgreSQL17.6 authentication ordering](https://github.com/postgres/postgres/blob/7885b94dd81b98bbab9ed878680d156df7bf857f/src/backend/utils/init/postinit.c#L926),
[NOLOGIN check](https://github.com/postgres/postgres/blob/7885b94dd81b98bbab9ed878680d156df7bf857f/src/backend/utils/init/miscinit.c#L850).

## Evidence boundaries

`PQconnectionUsedPassword` is documented for both failed and successful connects.
`PQsslInUse` supplies the TLS observation. The reviewed source preserves connection
state through failed polling until `PQfinish`.

libpq has **no public structured connection-error SQLSTATE accessor**. This
canary requests `PQERRORS_SQLSTATE`, examines only a bounded suffix internally,
and prints a finite `_28P01_hint` label, never raw error/notice text. The formatter
normally drops the primary message when SQLSTATE is present; when a malformed
server response omits SQLSTATE, it falls back to terse primary text. A primary
message consisting of `28P01` can therefore look identical. The synthetic test
explicitly reproduces this ambiguity; no private libpq struct or unsupported
parser shortcut is used.

Consequently, exit 0 and `native_canary_transport_observed_diagnostics_pending`
mean **observed native transport behavior only**, not proven hosted auth denial,
nonrecording, JIT permissions, or permission to issue a PAT. The independent
Owner must correlate the public canary's exact time/role/application-name window
with available provider authentication/pooler diagnostics and inspect for the
public marker. A known marker-bearing diagnostic path blocks the real credential
phase pending resolution. Missing/inaccessible diagnostics are unverified, never
a privacy pass. Do not export raw records or silently waive the unchanged policy.

## Transport and process controls

Only reviewed libpq 16.15/17.6 are accepted, with exact fixed-option capability
readback before DNS. `verify-full`, explicit distribution CA trust,
`sslcertmode=disable`, `gssencmode=disable`,
`require_auth=password,scram-sha-256`, `/dev/null` passfile and disabled DSN
expansion preserve the existing runner's boundaries. The public marker is always
explicit; no default password, service, certificate, GSS or credential lookup is
requested. libpq's supported certificate-disable behavior and required-auth
restriction remain package/source prerequisites, not guesses from version names.

The process accepts only `PATH=/usr/bin:/bin`, `LANG=C` and `LC_ALL=C` environment
entries; all other keys reject before libpq initialization. This does not undo
an injected loader executing before main. Use trusted binaries/libraries and
the independently reviewed clean launch/host boundary. Core limits and Linux
dumpability are disabled/read back. The marker is public so locking or claiming
secret zeroization for its static source storage would be misleading. There is
no actual credential in this process.

Each hosted attempt has a seven-second monotonic I/O deadline. A 20-second
process alarm includes DNS and exits with a fixed label. Normal cancellation
closes the connection; the absolute alarm is a fail-stop for blocked resolution.
There are no retries or hidden follow-up queries. The one-hour VM deadline and
cleanup reserve remain separate operational controls.

## Focused local validation

`validate-native-canary.py` binds **only 127.0.0.1** and compiles the separate
`JIT_CANARY_LOCAL_PROTOCOL` profile with a fixed ephemeral loopback port/public
CA at compile time. No runtime endpoint override exists. The two profiles cannot
be combined. The harness generates an ephemeral synthetic TLS key/certificate
solely for that listener, in its private temporary directory; those fixtures
are unrelated to provider credentials. It links the actual reviewed libpq,
not fake libpq. The server implements only SSL negotiation, startup, allowed or
unsupported authentication challenges, synthetic errors and termination. It
asserts the exact role/database/options/marker, one password use across the two
attempts, at most two connections and no query messages.

Run only this new focused suite; it does not repeat the settled PAT-runner tests:

```sh
python3 -S tools/jit-access-feasibility/validate-native-canary.py
```

Default libpq prefix:
`/private/tmp/vaeroex-square-pg176.ArIWfz/install`.
On the approved Linux host after package/provenance inspection:

```sh
python3 -S tools/jit-access-feasibility/validate-native-canary.py --pg-prefix /usr
```

The host's libpq headers must be exposed at that prefix's `include/libpq-fe.h`;
if the distribution uses `include/postgresql`, the harness accepts that observed
layout automatically. No repository change or unreviewed library substitute is
authorized by a missing path. On Debian/Ubuntu the linker uses the normal trusted
multiarch search path in addition to the given prefix.

The suite covers disabled ordinary/compile-only approved profiles; real TLS
and password rejection; name mismatch before any second password; wrong and
missing error states (including an explicitly indistinguishable malformed
lookalike); unexpected authentication; disconnect; TLS refusal; forbidden GSS/
no-auth; timeout/cancellation; unaccepted arguments; credential, loader,
proxy and TLS-keylog/config environment rejection. It suppresses hostile public
marker echoes and issues no SQL. The earlier 20-case suite passed on the isolated
Ubuntu host with actual libpq16.15 on 2026-09-09; that historical result applies
to the earlier binary, not this diagnostic correction. Its later provider-facing
attempts were inconclusive. The corrected binary has not yet been run against
the provider. Loopback TLS validation is not hosted authentication or diagnostic
nonrecording evidence. See [QUALIFICATION.md](QUALIFICATION.md).

The changed suite checks complete finite records for pre/post-password
rejections, disconnects, deadlines and cancellation, plus the negative phase
and absolute alarm. It does not claim wire fixtures can force libpq allocation
failure or every operating-system polling failure. Those paths have explicit
unknown-preserving results and remain source-reviewed, not fault-injection
evidence.

The separate `jit-canary-linux-qualification` CI job runs the focused suite
normally, with `--ubsan`, and with `--sanitize` (ASan plus UBSan), on Ubuntu24.04
with the isolated host's exact libpq16.15 package. It fails closed if that package
is unavailable. It also builds, but never executes, the approved hosted profile.
Its seven-day artifact contains only that public binary and nonsecret provenance
(exact checkout/tree, dependency/source/binary hashes and run identity), not
fixture keys, diagnostics or test credentials. Require successful exact-head
qualification, independent review and artifact/host compatibility verification
before scheduling another VM window. A CI binary is not hosted qualification.

## Approved Linux build, not an execution instruction

After independent review and the host/package/network/operator gates:

```sh
cc -std=c11 -Wall -Wextra -Werror -O2 \
  -DJIT_CANARY_APPROVED_SANDBOX_20260908 -I/usr/include/postgresql \
  tools/jit-access-feasibility/native-canary.c -lpq -o jit-native-canary-approved
```

Install only the reviewed nonsecret artifact root-owned; record its source and
binary hashes. The separately authorized future command is a clean-environment
execution with no arguments and no input. No real PAT should exist yet. Client
output is finite metadata and does not substitute for the required private
diagnostic correlation. Keep the callback daemon/Square calls disabled and
preserve Production, QBO and the native password-provisioning release gate.

Primary evidence:
[libpq connection/status contracts](https://www.postgresql.org/docs/16/libpq-status.html),
[connection options and polling](https://www.postgresql.org/docs/16/libpq-connect.html),
[SQLSTATE formatter source, 16.15](https://github.com/postgres/postgres/blob/REL_16_15/src/interfaces/libpq/fe-protocol3.c),
[failed connection polling source, 16.15](https://github.com/postgres/postgres/blob/REL_16_15/src/interfaces/libpq/fe-connect.c),
[Supabase Temporary Access](https://supabase.com/docs/guides/platform/temporary-access).
