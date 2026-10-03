# Native broker provisioning delivery record

Base: `bef41579bc86baa4c71bf43b5a22c5b2e857cb06` (fetched current main;
no intervening commits at implementation start).
Branch: `codex/native-broker-provisioning`.
Disposition: one non-draft PR. The user's subsequent standing authorization
permits a normal merge after independent review and all exact-head gates pass,
provided real provisioning remains blocked and application behavior dormant.
Automatic Vercel Preview and Production deployments are authorized; no Preview
deletion or branch exclusion was performed.

## Committed manifest

Exactly these 13 files belong to this delivery:

1. `.github/workflows/ci.yml`
2. `package.json`
3. `tools/native-broker-provisioning/DELIVERY.md`
4. `tools/native-broker-provisioning/PRIVACY.md`
5. `tools/native-broker-provisioning/README.md`
6. `tools/native-broker-provisioning/adapter.mjs`
7. `tools/native-broker-provisioning/lifecycle.mjs`
8. `tools/native-broker-provisioning/native.c`
9. `tools/native-broker-provisioning/tests/README.md`
10. `tools/native-broker-provisioning/tests/bootstrap.cjs`
11. `tools/native-broker-provisioning/tests/fixture.cjs`
12. `tools/native-broker-provisioning/tests/lifecycle.test.mjs`
13. `tools/native-broker-provisioning/tests/qualify.cjs`

No application, service, migration, QBO, production configuration, dependency
lockfile, Terraform state or credential artifact is changed. Original dirty
worktree changes are preserved; implementation uses a separate clean worktree.

## Review and corrections

An independent agent reviewed the native implementation, lifecycle, private
transport, source-supported privacy claims and tests. Concrete findings were
corrected locally before delivery:

- Reject direct ownership/ACL/policy authority and per-database role settings,
  rather than accepting a role merely because its inherited capability matches.
- Check **every** membership row so a second grantor cannot conceal an ADMIN
  grant behind a compliant grant of the same capability.
- Permit only PostgreSQL 17's inherent ADMIN-only membership for the exact
  non-superuser creating operator; reject inherited/SET/other incoming members.
  Qualify a real non-superuser/Supautils lane, not just a superuser lane.
- Pin the authenticated prepared role OID before fallible post-acknowledgement
  auditing/cancellation. Restoring the original ordering in a local in-memory
  module reproduced failed compensation; the corrected path fences the new OID
  and supports fresh replacement without recreating it.
- Preserve that same invocation's authenticated, committed prepare reply when
  cancellation wins before it is consumed: bounded drain, bounded reply
  reconciliation, then an exact-OID fresh fence. The subsequent GitHub finding
  was reproduced against the original coordinator with the actual native worker
  and a committed local NOLOGIN role. The correction supports same-coordinator
  recovery; a truly lost or post-finalization reply stays uncertain, with no
  name/audit-derived identity adoption and no credential generation.
- Retain overlapping page locks until owned credential buffers are wiped;
  generate entropy directly in the locked candidate buffer. Locks do not stack.
- Use compile-time-verified lock-free atomics for inter-thread cancellation.
- Treat unknown binding flags as denial instead of absence of an enabled row.
- Avoid libpq's direct stderr warning for a character-device password-file path;
  use a guaranteed non-file path and keep strict no-stderr qualification.

The final independent source review found no additional material implementation
defect. Reviewed core SHA-256 values (the reviewer did not claim to execute the
database tests):

```text
native.c    a0c9f35cc18965b0ed3a54a4eea67bc97124e3fadd079735b06b267e91700a98
lifecycle   bf3ce0b74221ef51324d94394175a4abaa44657d9055f2ee4f9ada2a0036125b
adapter     0d97b56b71097e772893fe4932d006842abb626c281d08f1c2811eb79c1f31dd
```

The known PANIC diagnostic path is **not fixed or waived**. It is reported as a
real-provisioning blocker, and both release entry points remain unconditionally
closed. [Exact proposed policy wording](PRIVACY.md#exact-proposed-refinement--requires-the-users-decision)
requires the user's decision; it is not permission conferred by this PR.

## Validation evidence

Final local results: **167 native assertions**, all three owned clusters stopped;
**60 lifecycle tests**. The native source hash equals the independently reviewed
hash above. Linux-only `/proc` locked-memory observation is registered in CI but
was not executed on the local Darwin host; static deferred-unlock ordering was
checked locally. No hosted result is implied.

The final native suite runs the actual C/libpq tool against disposable matching
local databases and emits a sanitized result with source/dependency hashes in
its private local report. It covers unsafe positive controls, protected ordinary
logs/statistics/audit, non-superuser effective controls, strict target/grants,
creation/rotation, actual TLS/SCRAM authentication, session fencing,
cancellation/timeouts, private delivery, and a real COMMIT whose database reply
is dropped. The latter separately establishes committed state while requiring
an **uncertain** tool result. No raw fixture evidence is committed or uploaded.

Lifecycle tests cover delivery/replay/target/authentication/audit failures,
cancellation and recovery. The native worker is integrated through the local
private-pipe adapter and the coordinator; tests are not solely mocked SQL.

Repository validation includes existing Square/QBO/architecture regression
suites, private synthetic browser qualification, guest-control regressions,
runtime builds, TypeScript, lint, application build and security checks. Initial
local browser/listener checks were blocked by filesystem-sandbox loopback
permissions; the authorized reruns passed: handoff 656 assertions, portal 735,
guest controls 129. Exact-head CI is the authoritative final gate for `verify`,
`security-database` and the new pinned-source `native-broker-qualification` job.
The new job uses no cloud credentials or remote DSN and uploads no raw artifacts.

The first exact-head CI run passed `verify` and `security-database` but exposed
a pgAudit bootstrap build failure. The narrow correction supplies `USE_PGXS=1`
for pgAudit's out-of-tree build and distinguishes fixed sanitized extension
failure stages. The old command reproduced the missing contrib-Makefile failure;
the corrected pinned source compiled locally, and 307 isolated mocked bootstrap
checks passed. These local controls are not Ubuntu execution evidence; all three
jobs must pass on the corrected head before merge.
The two-file bootstrap correction independently passed source review, preserving
the stripped environment, captured subprocess output and pinned dependencies.

## Remaining authority and qualification

This is not hosted qualification or a claim of unchanged-policy compliance for
real assignment. Follow the finite [hosted gates](README.md#finite-hosted-gates-not-authorized-by-this-change):
resolve the diagnostic policy boundary; attest the exact provider controls;
run hosted synthetic qualification; qualify the durable private-store/operator
and recovery adapters; then obtain explicit real-provisioning authorization.
SU-467250 remains pending but does not block this local code delivery.

The Sandbox VM remains stopped and ingress closed by the existing operational
hold. This work does not contact or mutate it, any remote database, cloud secret,
IAM, Square endpoint, OAuth setting or production gate. Only the normal
Git-triggered application deployments are permitted by the delivery workflow. QBO and
native transactional authority checks remain unchanged. No migration is added,
merged or remotely applied by this delivery.
