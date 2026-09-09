# Pre-token native transport canary

This closes one missing **test-tooling** gap: an actual libpq TLS/password-failure
exercise before PAT creation. It does not select Temporary Access for Production,
qualify hosted diagnostics, or enable the credential-bearing runner. The current
user authorization includes this isolated pre-token preparation. No provider-facing
canary or credential-bearing execution occurred; Ubuntu loopback tests are
reported separately below.

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
2. Only after the expected first observation, a deliberate name-negative TLS
   attempt to the **same resolved IP and port**. The verification name is
   `vaeroex-jit-tls-negative.invalid`; it is never resolved or used to select a
   different network endpoint. This attempt must fail before password use.

The normal attempt must observe TLS in use, a password challenge/use, failure,
and the expected formatted 28P01 hint. Unexpected successful authentication,
wrong SQLSTATE, TLS refusal, unsupported authentication, disconnection, timeout,
or other ambiguous failure never establishes successful qualification.

The current VM's firewall may not permit port 5432. A blocked connection is not
authentication rejection. Complete the separately reviewed network/admission
gate before execution; this artifact changes no firewall, role, feature or grant.
Keep the role NOLOGIN during the canary; do not activate it or create a grant/PAT
to force this check to pass. A provider refusal before the password challenge is
an inconclusive result to report.

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
marker echoes and issues no SQL. All 20 cases also passed on the isolated Ubuntu
host with actual libpq16.15 on 2026-09-09. This is loopback TLS evidence only;
the provider-facing canary was not run. See [QUALIFICATION.md](QUALIFICATION.md).

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
