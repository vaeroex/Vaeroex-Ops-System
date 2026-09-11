# Fixed mapped-role maintenance

Requires merged PR #381's additive mapped-runtime schema (109) for provisioning.
Hosted mapped activation must additionally await reviewed migration 110's
inherited-runtime/enroller RPC fencing correction. Maintenance remains closed
and safe with 109 alone. This is code and local qualification only; no hosted
role, secret version, grant or activation is made.

The default callback installation and its existing credential version 1 are
unchanged. Two separate fixed installations add no arbitrary-role interface:

| Build profile | Exact role | Sole inherited capability | Secret container | Installation |
| --- | --- | --- | --- | --- |
| `enroller` | `square_sandbox_enroller` | `square_verified_enrollment_authority` | `square-sandbox-enroller-db` | `/opt/vaeroex-native-enroller` |
| `runtime` | `square_sandbox_runtime` | `square_ingestion_runtime_authority` | `square-sandbox-runtime-db` | `/opt/vaeroex-native-runtime` |

Build explicitly on Linux with `node build-managed.mjs /absolute/output enroller`
or `runtime`. Omitted profile keeps the existing callback build.
CI preserves only these two public fixed binaries, their static launchers,
individual raw digest files, SHA-256 manifest and public build provenance for seven days in the
`square-mapped-maintenance-<run-id>-<attempt>` artifact. It never executes those
hosted binaries or uploads synthetic database state. Verify the exact reviewed
commit, successful job, hashes and host ABI/package compatibility before using
that artifact; expiry requires another reviewed build, not an unverified binary.

Install the corresponding immutable native binary, static launcher, digest and
reviewed modules in that profile's root-owned directory.
The profile's `native-managed-<profile>.sha256` is installed as
`native-managed.sha256` alongside its binary renamed `native-managed`; its entire
content is one raw 64-character digest plus newline, as required by maintenance.
The multi-entry `mapped-maintenance.sha256` is only an artifact verification
manifest and must not be used as that installed raw digest.

Each has a separate root-private state directory (`/var/lib/vaeroex-native-enroller` or
`/var/lib/vaeroex-native-runtime`), lock, append-only sanitized journal and recovery
clearance. Never substitute a binary, secret parent or clearance across profiles.

Both reuse the original approved provisioning host (instance
`9094944541973315575`, `us-west1-a`, project `vaeroex-square-sandbox`) and the
separate `vx-square-sandbox-provisioner` identity. The replacement callback VM
is not admitted as a maintenance host. If the original host cannot start within
the bounded budget/window, stop; no alternate-host fallback is installed.

## Remaining hosted steps

1. Verify reviewed schema installation, target physical identity and all gates
   closed. New profiles require the mapped table and FORCE RLS visibility. Table
   locks hold the closed account/callback/mapped gates through assignment. All
   isolated account enrollment/retention gates and the synthetic qualification
   gate must also be closed, independently of runtime fencing and before mapped
   bindings exist.
2. Prepare only the two dedicated empty secret containers and short-lived
   resource-scoped provisioner permissions. Runtime/callback identities receive
   no provisioning authority. Confirm cost within the standing total budget.
3. Install reviewed fixed artifacts and prepare both public launch commands,
   operator access, deadline, automatic shutdown and cleanup before private entry.
4. When available, the operator enters the isolated native `postgres` password
   into each existing protected launcher prompt. This change deliberately keeps
   the proven single-target lifecycle: two sequential protected entries in one
   consolidated handoff, not a new password cache or cross-invocation transfer.
   No password, token or DSN goes into chat, argv, shell history or files.
5. Each run creates one NOLOGIN role with only its exact capability, generates a
   unique credential, privately stages/verifies it, checks native authentication
   briefly under closed authority, then commits NOLOGIN and drains its sessions
   before reporting staged readiness. A failed final fence is not readiness.
6. Independently read back role OID, memberships, NOLOGIN, zero sessions and the
   immutable staged version metadata. Only then pin the two version references
   in the checked mapped binding. Do not infer commit success from the journal.
7. Remove temporary maintenance IAM/firewall access and stop the original VM.
   Subsequent bounded mapped-runtime activation is a separate checked operation;
   provisioning does not enable any service, Square read, enrollment or ingestion.

Cancellation, lost acknowledgement and recovery retain the existing exact-role
reconciliation requirements. A clearance for callback/enroller/runtime cannot
authorize another profile. Existing generation 4, consent, broker password and
callback database secret version 1 are not read, rotated or replaced here.

Local mapped qualification uses actual libpq and disposable loopback PostgreSQL
with pinned pgAudit/pg_stat_statements/Supautils dependencies, synthetic passwords,
both new compiled profiles and the existing coordinator. Hosted permissions,
private entry and real Secret Manager delivery remain untested until that window.
