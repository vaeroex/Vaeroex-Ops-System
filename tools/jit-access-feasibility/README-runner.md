# Isolated JIT feasibility client

This is a bounded qualification client, not a Production integration. The user's
2026-09-08 approval expressly includes completing this isolated hosted client
and its two fixed bearer-token API-denial probes. No privacy exception is granted.
All operator, host, diagnostic and independent-review gates must pass before real
token issuance. The ordinary executable still exits
`hosted_execution_blocked` before inspecting arguments, input, environment,
credentials or networks. There is no runtime target/SQL/credential override.
`JIT_LOCAL_MOCK` requires both fake library files and never performs network,
SQL, DNS or HTTP operations. Its link-only symbol is absent from real libpq.
`JIT_APPROVED_SANDBOX_20260908` selects only the approved, pinned Linux profile;
compiling it does not establish that execution gates passed. Neither profile
accepts arbitrary targets, and they cannot be combined.
No existing native-provisioning release gate is changed.

The approved profile pins:
`aws-0-us-west-2.pooler.supabase.com:5432`, database `postgres`, username
`vaeroex_jit_feasibility_20260908.oysjpoondtcrqpghhrbd`, `sslmode=verify-full`
with the scoped public Supabase CA at `/etc/vaeroex-jit/supabase-root-2021.crt`,
and startup `options=-c jit=true`. The authenticated
`session_user` must be `vaeroex_jit_feasibility_20260908`, not that transport
username suffix. It also checks database OID `5`, exact supplied role OID,
nonprivileged attributes, no capability memberships and connection limit two.
Physical system identity remains a separate administrative setup check, not an
inference from this client. The reviewed libpq profiles are **16.15** (the current
official Ubuntu Noble package) and the existing **17.6** local reference; other
version numbers fail closed pending review. The earlier claim that
`sslcertmode=disable` requires 17 was incorrect. libcurl >=7.85 with TLS remains
required. Do not substitute unreviewed packages.

Before DNS or token entry, `PQconninfoParse` parses a fixed nonsecret option string
and verifies exact readback of hostname-verifying TLS, certificate/GSS encryption
disable, required auth methods, explicit trust/passfile and hostaddr support. It
does **not** use `PQconndefaults`: no default values, environment/service expansion,
client-key lookup or connection is performed by this capability check. Parsing
proves recognized options, not successful TLS/authentication or package provenance.
Those still require the exact approved Linux package and hosted synthetic gates.

Official `REL_16_15` source registers and validates `sslcertmode=disable`; its
OpenSSL implementation takes the disable branch before client-certificate stat/
load and leaves `have_cert=false`, which also skips file/engine private-key
loading. All native APIs used here exist in the 16.15 public header. The supported
`require_auth=password,scram-sha-256` option now prevents Kerberos/SSPI/MD5/no-auth
fallback; `gssencmode=disable` alone only disables GSS encryption, not GSS
authentication. An unsupported provider authentication method fails closed—never
remove this constraint to use another cached credential.

Evidence: [16.15 TLS implementation](https://github.com/postgres/postgres/blob/REL_16_15/src/interfaces/libpq/fe-secure-openssl.c),
[16.15 option/auth validation](https://github.com/postgres/postgres/blob/REL_16_15/src/interfaces/libpq/fe-connect.c),
[PG16 connection and parse contracts](https://www.postgresql.org/docs/16/libpq-connect.html),
[official Noble 16.15 package](https://packages.ubuntu.com/noble-updates/libpq5).

The two exact DNS names are resolved to IPv4 **before token entry**. Subsequent
libpq uses hostaddr and libcurl uses RESOLVE while preserving original hostname
TLS verification. No DNS lookup occurs inside libpq's token-bearing I/O.
PostgreSQL uses the scoped Supabase root; Management API HTTPS retains its
explicit distribution bundle/directory. Neither has a fallback or verification
bypass. Before token entry verify the public CA hash/ownership and corrected
normal-host and wrong-host tests; follow the
[scoped trust installation](README-native-canary.md#scoped-postgresql-trust-installation).

## Prepared client boundary

- Fixed `probe EXPECTED_ROLE_OID` or `observe EXPECTED_ROLE_OID`; no arbitrary
  host, database, role, SQL, URI, DSN or credential arguments. Exact role OID
  comes from separately reviewed nonsecret setup; role recreation is not an
  equivalent target.
- The native process requires stdin/stdout/stderr to be terminals and reads
  directly from its private `/dev/tty` only after echo is disabled. Credential
  files, pipes, credential environment variables, `LD_`/`DYLD_` loader variables
  and proxy variables (case-insensitive) are rejected, along with `SSL*`,
  `OPENSSL_*`, `CURL_*`, `GNUTLS_*` and `NSS_*` (including keylog/trust/config).
  A loader or TLS initializer can execute before
  `main`: this rejection is **not** protection against an already-compromised
  loader; the approved private launch environment and host must independently
  exclude injection and unauthorized inspection. Never enter a
  real PAT into the mock build. The authorized private operator must use an
  independently controlled nonrecording terminal, **not an assistant-captured
  tool terminal**. These checks cannot detect an external terminal recorder.
- Input is bounded to at most 4096 ASCII letters/digits/underscore/hyphen with
  `sbp_fc` prefix and a nonempty suffix; there is no invented minimum PAT length.
  This is format sanity only, **not a claim about
  every future Supabase token format**. The actual privately issued token must
  fit; otherwise stop and revise the contract without displaying it.
- Owned token/header buffers are locked and volatile-wiped after library cleanup.
  The slist-owned Authorization header copy is additionally locked, kept alive
  through libcurl cleanup, then wiped/unlocked before free. Core limits are
  disabled and read back; Linux dumpability is disabled and read back before
  entry. This does not claim complete library/TLS/kernel-memory
  zeroization. Real execution additionally requires reviewed no-swap, no-dump,
  no-recording host controls. macOS local tests do not qualify Linux controls.
- Malformed/oversized input is drained to its newline without retaining excess
  input before terminal echo is restored. Cancellation, EOF and the 300-second
  entry deadline restore terminal state and wipe owned secret memory. Operators
  must stop entry when cancellation is requested; this is not protection against
  an external recorder or subsequent input typed into a restored terminal.
  The entry allowance is capped by the original process deadline and never
  renewed per character. `private_input_timed_out` distinguishes expiry from
  `private_input_rejected`; neither establishes how many bytes arrived. Both
  exit before credential-bearing DB/API work. Follow the
  [private-entry handoff](PRIVATE-ENTRY.md), including its disposable outer shell.
- libpq parameters are fixed, with expansion disabled, `/dev/null` passfile,
  `verify-full`, client-certificate use disabled and finite connection/query
  deadlines. Notices and server error payloads are never printed. Only fixed
  labels and the operator-supplied nonsecret OID participate in assertions;
  the token is never interpolated into SQL.
- At most two connections exist concurrently. `probe` checks native identity,
  role flags, exact one-workspace row visibility, denied SET ROLE, denied access
  to the isolated denied table, denied INSERT/UPDATE and
  reconnection. Write checks use rollback and `SET TRANSACTION READ WRITE` so
  permission denial is not confused with the role's default read-only setting.
- `observe` retains the original connection for at most 30 minutes. Nonsecret
  cues `r`, `s`, `q` independently report new-session acceptance and old-session
  usability. They do **not** relabel token/grant expiry as session termination;
  the external operator must record each named phase and perform the separately
  authorized exact-role fence/drain. The runner closes its own connections;
  closure is not proof that all server sessions were terminated.
- `n` establishes and fully checks a new connection before replacing the held
  connection. Use this after grant renewal/activation so later revocation tests
  observe a newly established session, not an already-fenced/dead connection.
  No transaction is held while awaiting cues. `new_session_rejected` means a
  generic failed connection attempt, not an authentication-specific diagnosis:
  corroborate it with contemporaneous control-plane grant/token confirmation,
  positive control connectivity, timing, and explicit administrative fencing.
- A process permits at most 60 combined connection attempts and existing-session
  probes, including its initial two connections. The 61st request exits with
  `attempt_budget_exhausted`, not a misleading authentication/fencing result.
  At most 58 observation probes remain after a successful baseline. Deadlines
  use monotonic time; do not restart a process to reset its approved budget.

## Protected fixed HTTP-denial probes

After initial native identity/fixture checks, the same in-memory PAT performs
exactly two requests once per process:

1. GET `https://api.supabase.com/v1/projects/oysjpoondtcrqpghhrbd`.
2. POST `https://api.supabase.com/v1/projects/oysjpoondtcrqpghhrbd/database/query`
   with constant nonsecret body `{"query":"SELECT 1"}`.

Both must return **403**. Success, 401, 404, redirects, server failure, TLS error,
timeout and cancellation are not scope passes. There are no retries, redirects,
proxies, cookies, netrc, verbose/debug callbacks, raw-error buffers, alternate
targets or administrative fallback. Response callbacks discard bodies and
headers, including hostile token echoes, without application copies. Total
headers/body are bounded to 16/64 KiB. Connect/total request limits are three/five
seconds with cancellation callbacks. No raw status text, header or body is logged.

The earlier preparation-only patch was rejected and **not applied or bypassed**.
The present small implementation was added only after the user's explicit new
approval and successful approval-control evaluation. No credential-export helper,
shell token variable or curl command was introduced.

## Local evidence and limits

Run `python3 -S tools/jit-access-feasibility/validate.py`. It uses the existing
libpq headers at `/private/tmp/vaeroex-square-pg176.ArIWfz/install/include`, `cc`,
Python's standard library, temporary binaries and fake libpq/libcurl. It does not
load real network libraries. It also compiles—but does not execute—the approved
profile against real headers. On Linux, `--include` accepts the observed nonsecret
libpq include directory. A managed sandbox may require access to its own
`/dev/tty`; no token or network permission is required.

The **69 local cases** cover the ordinary release gate; invalid arguments/DSN,
credential/loader/proxy environment and pipe inputs; prefix-only rejection,
nonempty-suffix/maximum/malformed/oversized token input;
no-echo entry; notice and hostile HTTP body/header suppression; TLS-keylog/config
environment rejection; wrong role/database/membership/row/excess-privilege
results; mocked TLS rejection/absence; connection and reconnection failure;
cancellation with partial input and HTTP in progress; HTTP error/redirect/TLS/
timeout/oversize cases; both fixed API403 assertions versus other responses;
exact connection/probe budget boundaries and held-session replacement; exact
16.15/17.6 version acceptance, unsupported-version rejection, missing/mismatched
capability rejection before input and simulated unsupported-auth rejection;
and separately observed new-session
revocation versus existing-session fencing. Mock teardown asserts owned input
buffers are zero. These are **native-client logic and credential-boundary tests**,
not proof of real PAT validity, JIT permissions, PostgreSQL RLS, SSL negotiation,
pooler behavior, provider diagnostic nonrecording or hosted expiry/revocation.
Server-error text is never requested by the client; SQLSTATE-only denial is
tested. No successful native password-assignment qualification is repeated.

The same 69 cases passed on the isolated Ubuntu host with GCC and libpq16.15
headers on 2026-09-09. See [QUALIFICATION.md](QUALIFICATION.md) for the precise
evidence boundary and Python site-hook precaution. Real PAT authentication,
provider diagnostics and expiry/revocation remain unqualified.

## Approved Linux build, after pre-token gates

Inspect distribution package versions and run the synthetic suite on that exact
Linux host first. Using its verified public headers/libraries, compile:

```sh
cc -std=c11 -Wall -Wextra -Werror -O2 \
  -DJIT_APPROVED_SANDBOX_20260908 -I/usr/include/postgresql \
  tools/jit-access-feasibility/runner.c -lpq -lcurl -o jit-feasibility-approved
```

The include directory must match the approved package transaction. Do not add
repositories or bypass version requirements. Stage only nonsecret artifacts and
record source/binary hashes. The execution owner must establish a clean,
nonrecording private launch, no-swap/no-dump controls, Linux synthetic pass and
independent review before the operator creates or enters any PAT. This code's
local validation itself accessed no token, remote database/API, Production/QBO
state or VM and repeated no native password-assignment qualification.

Primary references: [libpq polling and parameters](https://www.postgresql.org/docs/17/libpq-connect.html),
[libcurl header ownership](https://curl.se/libcurl/c/CURLOPT_HTTPHEADER.html),
[libcurl cancellation](https://curl.se/libcurl/c/CURLOPT_XFERINFOFUNCTION.html).
