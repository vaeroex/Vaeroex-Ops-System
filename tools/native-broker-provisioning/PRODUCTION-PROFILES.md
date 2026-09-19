# Production native database profiles

This package defines six fixed Square Production database logins. Each login is
paired with exactly one `square_production_*_authority` role and that authority's
single checked RPC for the currently installed source phase. Preparation creates
the login as `NOLOGIN NOINHERIT`; a bounded authentication step temporarily
changes it to `LOGIN INHERIT`, proves native `session_user`, and every success or
failure path fences it back to `NOLOGIN NOINHERIT` and drains sessions.

The membership edge is part of that state machine. A staged or fenced login has
`INHERIT FALSE` on its one capability membership; activation changes that exact
edge to `INHERIT TRUE` in the same transaction as `LOGIN INHERIT`. Fencing
changes it back to `INHERIT FALSE` in the same transaction as `NOLOGIN
NOINHERIT`, before the commit that precedes session termination. This prevents
an already-authenticated PostgreSQL 16+ session from retaining inherited RPC
authority while it is waiting to be drained. Each of the six profiles is
verified independently as absent, exactly closed, or exactly active, so fencing
one profile does not disable another legitimately active least-privilege role.

The required B source contract is the exact 102-migration foundation ending at
`20260902191323` plus overlay `20260902191324`. Both file hashes and the 102/103
ledger fingerprints are immutable test inputs. A B source tree with no
`20260902191325` file builds a baseline-only binary and accepts only the exact
103-row overlay ledger. It has no dependency on the separate runtime workstream.

Optional future support is fail-closed. If a combined source tree later contains
version `20260902191325`, it must contain exactly the single reviewed
`20260902191325_square_production_internal_pilot_runtime.sql` file with SHA-256
`1da1eaf92a2879ac4309978a242d4a6e357c91615b1da2935f3e1a95b616d716`.
Only then does the offline builder compile that source identity into the broker,
which may accept either the exact 103-row overlay ledger or exact 104-row runtime
ledger. A baseline-source binary always rejects ledger 104.

At ledger 103 all six authority roles receive only their baseline
`check_square_production_*_authority_v1(text,text,text,bigint,text)` RPC. At
ledger 104 OAuth, broker, runtime and evidence receive only their corresponding
`square_production_internal_*_v1(text,jsonb)` RPC and their old wrappers are
owner-only; scheduler and webhook retain only their baseline check RPC. The
native operation derives this map from the locked ledger phase; callers cannot
select it.

For both phases the native operation rechecks the exact foundation/overlay
schema hashes, function ABI and source pins, all six role memberships and mapped
RPCs, effective
relation/column/sequence/FDW/server/tablespace and other routine access,
database/schema creation, database/default ACLs, closed platform and provider
flags, and each target's current provider-capability binding. The same contract
is rerun after the final role transition and immediately before commit while
the authority tables and migration ledger remain locked. Ledger 104 additionally
locks and pins all eight internal-runtime relations, their canonical schema,
all twelve function ABIs/stored sources and the exact replaced/retained ACL map.
This is a point-in-time proof. Every later migration must rerun the profile and
database permission tests; this design makes no future-ACL-safety claim.

Three tests deliberately cover different evidence boundaries. The existing
`run-square-production-overlay-qualification.js` starts from the exact 102-entry
source-shaped database, applies only the reviewed overlay, creates the six
staged profiles inside one transaction, proves their exact authority/ACL shape,
and rolls them all back. `production-catalog-qualify.cjs` starts a separate
private local PostgreSQL 17 cluster, executes the real native catalog predicates
against the exact foundation/overlay ledger, and rejects same-count trigger
substitution. If the exact pinned `20260902191325` source is present (or supplied
by the separate runtime workstream through its local-only test path), it also
applies and qualifies ledger 104; absent source does not create a B dependency.
`production-native-qualify.cjs` uses a local synthetic
PostgreSQL fixture only to exercise the fixed native transport, private staging,
failure fence, rotation/recovery semantics and no-log assertions. It does not
claim that its synthetic tables are the Production schema; the source-shaped
qualification is the separate, required proof.

The Production build, six fixed install paths, launcher, private maintenance
composition, Secret Manager staging and lifecycle/fence path are implemented.
They deliberately refuse to build or start today. The verified direct database
host is identity evidence, not the reviewed IPv4/session-pooler endpoint. The
Production pooler host, root CA file, provisioner instance and service account
remain null in `productionDeploymentBinding`; all must be reviewed and pinned
before `build-production.mjs` emits an executable. Sandbox VM, identity,
endpoint, CA and install profiles are never reused.

Rollback is fencing, not password rollback: on cancellation, timeout, failed
secret staging, failed authentication or lost acknowledgement, the supervisor
drains the native child, commits `NOLOGIN NOINHERIT`, terminates sessions and
marks the outcome uncertain when commit acknowledgement is unavailable. Secret
deletion or an audit record is never accepted as database commit proof.
