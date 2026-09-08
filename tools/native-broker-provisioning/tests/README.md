# Native broker qualification fixtures

This suite is synthetic and local only. It starts a fresh private PostgreSQL
cluster, uses Unix sockets and loopback-only verified TLS, and stops the cluster
on completion. It accepts no DSN, remote host, actual password, auth profile, or
cloud credential. The worker release build must return `policy_blocked` before
reading its private input or opening a database connection. Passing this suite
is not hosted qualification or permission to provision a real broker.

The inspected developer fixtures are PostgreSQL/libpq **17.6**, pgAudit **17.1**
at `538f89a93d8fd0d8913f3d740cacaea7b7eb66d9`, and Supautils at
`e35f8affc4467202ff0d98f8dd14cb955bc13c75` (source version 3.4.3). The harness
checks source commits, PostgreSQL version, and exact local binary SHA-256 values.
These are public-source builds, not an attestation of a hosted provider binary.

## Rebuild the public dependencies

Use a disposable CI/local build directory, a C compiler, make, GNU grep, Git,
OpenSSL development headers, and Node 24 with the repository's frozen `pg`
dependency. Do not run as the PostgreSQL root user. Public download/build steps
are separate from the offline qualification runner; no provider account or
credential is involved.

On a prepared nonroot Ubuntu CI runner, the executable build-and-test entry is:

```sh
node tools/native-broker-provisioning/tests/bootstrap.cjs --qualify
```

Without `--qualify`, bootstrap builds dependencies and prints a nonsecret local
`manifestPath`. Reuse that reviewed private build with
`VAEROEX_NATIVE_TEST_DEPENDENCIES=/absolute/local/dependencies.json node tools/native-broker-provisioning/tests/qualify.cjs`.
The manifest contains only local dependency paths and binary digests, never a DB
target or credential. Qualification validates its exact field set, paths, source
revisions, PostgreSQL version and recorded digests before initializing a database.
The dependency downloader is Linux-only; local macOS qualification uses the
already inspected fixtures. A Linux build is not claimed to have passed merely
because the macOS fixture tests pass. Do not upload raw test directories/artifacts.

1. Download `https://ftp.postgresql.org/pub/source/v17.6/postgresql-17.6.tar.bz2`
   into the private build directory. Verify SHA-256 exactly
   `e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0`
   before extraction. This is the publisher's
   [checksum](https://ftp.postgresql.org/pub/source/v17.6/postgresql-17.6.tar.bz2.sha256).
2. Configure PostgreSQL with an absolute private install prefix,
   `--with-ssl=openssl --without-icu --without-readline`; build and install there.
   Build/install `contrib/pg_stat_statements` and `contrib/auto_explain` from that
   same source tree. Do not use or replace a system/hosted database installation.
3. Clone the public [pgAudit repository](https://github.com/pgaudit/pgaudit),
   detach at the exact commit above, and verify `git rev-parse HEAD` and
   `pgaudit.control` version `17.1`. Build using
   `make PG_CONFIG=/absolute/private/install/bin/pg_config`.
4. Clone [Supautils](https://github.com/supabase/supautils), detach and verify the
   exact commit above, then build with that same `PG_CONFIG`. The Makefile uses
   GNU grep (`GREP=/path/to/ggrep` on macOS when needed). It does not need to be
   installed system-wide: the fixture preloads the absolute built library.
5. Record actual local binary digests. Linux `.so` and macOS `.dylib` products
   have different bytes; never copy the macOS reference hashes into a Linux
   evidence report or claim a source pin attests an arbitrary built binary.

The harness compiles `../native.c` twice into its own mode-0700 temporary root:
one `-DVAEROEX_SYNTHETIC_ONLY` executable and one ordinary blocked release
executable. It adds no fallback or test switch to the release protocol.

## Evidence and scope

`qualify.cjs` tests actual native role preparation, assignment, independent LOGIN
activation, SCRAM/TLS login, fencing and session termination, permission and
missing-role denial, locking timeout, cancellation, secret-store acknowledgement
timeout, an actual committed transaction with its database acknowledgement
dropped through an end-to-end TLS loopback relay, and explicit rotation/recovery.
The relay never decrypts or records database protocol payloads.

Positive controls deliberately record a **synthetic** password/verifier in a
separate disposable cluster's log/statistics files. That cluster is stopped and
the saved-file detector checked before creating a pristine protected cluster.
No statistics reset or deletion is used to make a payload-absence check pass.
Raw text/CSV logs, live query statistics, on-disk query texts and the saved
post-shutdown statistics file are checked without printing their contents.
Role/action/redaction audit presence is checked separately; silence is not
mistaken for a working privacy detector.

Only fixed outcome names, assertion identifiers, source/dependency digests and
stopped/local-only flags are emitted. No passwords, verifiers, raw SQL error
objects or private worker frames are printed. The report and stopped synthetic
cluster remain in the run-owned mode-0700 temporary directory for bounded local
review; they must never be bulk-staged or uploaded. No cleanup acts on a shared
database, user profile, old experiment, or cloud resource.
