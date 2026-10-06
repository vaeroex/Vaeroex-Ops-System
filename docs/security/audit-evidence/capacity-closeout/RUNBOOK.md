# Owned-local capacity runbook — CL-07/09

**Current execution scope, updated 2026-10-05:** the user prioritizes a limited first-customer rollout. The corrected small baseline is complete at its unchanged thresholds with independent persisted reconciliation; stop capacity experiments. The larger `run`/`soak` and 100/250/500 commands below remain reproducible deferred procedures; they are not authorization to execute them now. Future execution requires a new scope decision. See the [finite release list](../../workspace-release-proposal.md#limited-customer-closeout--current-finite-release-list).

This runbook implements the existing bounded plan using the actual CLI interfaces in this checkout. It is an operator procedure for the owned synthetic environment, not evidence that a workload passed. The historical baseline completed on 2026-10-05 at application `0a15ddcd3b564086280fec21b79b6976b3a3cc44`, build `ReUcdHr1ALEejCvoUeFTc`, with twelve audit/capacity migrations. The owned database subsequently received migration 13 at 20:36:06 UTC; all thirteen are listed in the [release proposal](../../workspace-release-proposal.md). Parent-qualified later builds and harness commits must use their own runtime manifest; they are not assigned to the original measurement. The completed 20-minute small baseline has independently verified persisted integrity but **fails read p95: 2,185.184 ms versus 1,500 ms**. Its [retained result](baseline-small-summary.json) and [independent integrity result](baseline-small-integrity.json) do not qualify primary faults/bursts or later targets; the [persistent audit](../../workspace-audit.md) records the measured limit and next gates.

The later [corrected baseline](baseline-keyset-summary.json), application`396ec2f7`/build`Auls728kWl18cXUO1oXpO`, completes20minutes with aggregate latency/error thresholds and its [independent inventory](baseline-keyset-integrity.json) passed. [Nominal drain remains NOT_QUALIFIED](baseline-keyset-drain-gap.json); the full scheduled/fault/fairness workload remains unexecuted. No complete capacity pass is inferred.

The separate [thirteen-migration SQL rehearsal](rollout-thirteen-final.json) now passes104 assertions in a fresh stopped native fixture. It models an atomic ledger and simulated lost acknowledgement after actual COMMIT; it is not a production CLI/migration-method qualification.

The [component evidence](README.md) retains earlier failures and corrections. Preserve deployment HOLD, all historical fixtures and migration history. Do not run the commands against the currently measured instance while its workload is active, alter its source/configuration, restart its services, or run other database qualification alongside it. The commands below are for a fresh cohort and evidence paths after the shared environment is available. No production configuration, customer connection, live provider, purchase or infrastructure upgrade is needed or permitted.

## Workload, thresholds and platform

| Active users | Registered users | Workspaces | User actions/second |
|---:|---:|---:|---:|
| 10, initial complete-workload step | 20 | 2 | 1 |
| 100, target | 200 | 20 | 10 |
| 250, target | 500 | 50 | 25 |
| 500, target | 1,000 | 100 | 50 |

Each workspace has five active users among ten registered users, 200 stored original files, 10,000 KPI observations, 20 confirmed metric definitions and 730 days of history. Six actions/minute is the cohort average; owner-only syncs change the individual actor distribution. The mix remains navigation/search/filter/upload/create/repeat/AI/manual sync = 30/20/20/8/8/4/5/5%. A repeat is one user action but two HTTP requests. Scheduled jobs and preflight add requests independently. HTTP workload traffic does not render every browser asset or reproduce browser CPU; real browser control qualification is a separate prerequisite.

The explicitly approved `supported_rows_v1` profile keeps the original 80/15/5% file mix and exact 40,960/419,430/2,202,009-byte sizes, with at most 1,000 rows and nonmetric text padding. The actual generator calls that column `Marker`. Original `agreed_large_rows_v1` uses exactly 1,000/10,000/50,000 rows; the last two exceed the preserved application limit and remain successful-import targets **unsupported/unproven**. Above-limit truthfully denied preparation is a separate negative test, not a successful capacity sample. Never silently change between these profiles.

| Acceptance / stop | Retained limit |
|---|---|
| Read latency | p95 ≤1,500 ms; p99 ≤3,000 ms |
| Mutation acknowledgement | p95 ≤2,000 ms; independent persisted outcome still required |
| Unplanned failure rate | ≤1%; planned fault exclusions require actual matching injection evidence |
| Queue / drain / recovery | Queue p95 ≤30,000 ms; nominal drain ≤120,000 ms; fault recovery ≤300,000 ms |
| Quiet-workspace fairness | Each of the five page routes needs ≥30 samples per quiet workspace in both runs; p95 ≤2× its same-route baseline |
| Worker restart | Actual SIGKILL to successful `/login` readiness ≤3,000 ms; spawning a process is not readiness |
| Integrity | Zero lost/duplicated accepted effects or cross-workspace reads; every accepted claim terminal or explicitly unresolved |
| Generator | p99 scheduling lag ≤100 ms; zero dropped actions; offered steady load within existing 1%/minimum-two-action tolerance |
| Resources | Sustained >80% app/worker/aggregate RSS, allocated CPU or actual DB connections for 60 seconds stops issuance |
| Other stops | 60-second window >5% unplanned failures after ≥20 requests, or oldest queue age >120 seconds, sustained 60 seconds; any integrity/egress/stale-telemetry/provenance failure stops immediately |
| Hard bounds | ≤100,000 client requests/run; ≤8 GiB stored bytes since provisioning; ≤500 in-flight generator tasks |

The declared envelope is **4 GiB total and four CPU cores**, including native services, app, worker, provider, supervisor, fault controller, collector and generator; app allocation is 2 GiB and worker allocation 1 GiB. The measured host has shared 8 GiB/eight logical CPUs. These are measurement limits, not reservations, cgroup enforcement or purchased production resources. DB usage is divided by the actual queried `max_connections`, not a guessed ceiling. The collector includes its own overhead; short-lived processes entirely between snapshots remain a limitation.

This implementation requires macOS ARM64, `/usr/bin/sandbox-exec` Seatbelt, `/usr/bin/clang`, `/usr/bin/openssl`, native `libproc` and the installed Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. The private compiled process reader uses actual same-UID RSS/CPU/start times because privileged `ps` fails inside this sandbox. It is not a portable Linux production deployment. Node 22+ and the repository's locked dependencies must already be installed.

The supervisor serves loopback HTTPS through a locally generated CA and routes Sheets endpoints to a separately killable worker. Node trusts only that additional CA; do not use `NODE_TLS_REJECT_UNAUTHORIZED=0`. The existing Playwright capture context bypasses certificate validation only inside its origin-constrained browser context; it therefore does not qualify production certificate handling. The local Next wrapper sets `skipMiddlewareUrlNormalize:true` and `__NEXT_NO_MIDDLEWARE_URL_NORMALIZE=1`, with original config/loader hashes retained. This is a recorded runtime difference from production, not a proved framework diagnosis.

OS policy denies external outbound traffic for the native services and supervisor descendants, while permitting owned loopback/Unix services. The preload maps only enumerated Google/AI hosts into local simulated providers; it is not a production endpoint change. Nominal configured latency is 30 ms/Sheets request and 100 ms/model response. Synthetic Sheets use 100 rows; model output and token usage are simulations, not real quality, throttling, billing or provider latency. Record actual values if future explicitly labeled experiments vary them.

## 1. Select the owned stack and create a fresh cohort

Use the existing verified assembly when available. These example variables contain paths and source identities only; private file contents must never be printed or committed.

```sh
CAPACITY_REPO=/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex
CAPACITY_NODE=/Users/isaacvizcarra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
CAPACITY_CONFIG=/tmp/vaeroex-closeout-assembly-final/private-e2e-config.json
CAPACITY_OUT=/tmp/vaeroex-capacity-reproduction-01
CAPACITY_HTTP="$CAPACITY_REPO/docs/security/audit-evidence/stage-3/http"
cd "$CAPACITY_REPO"
umask 077
mkdir -m 700 "$CAPACITY_OUT"
CAPACITY_PLAN="$CAPACITY_OUT/plan.private.json"
CAPACITY_RUNTIME="$CAPACITY_OUT/runtime.private.json"
"$CAPACITY_NODE" scripts/workspace-capacity-state.cjs plan 10 "$CAPACITY_PLAN"
"$CAPACITY_NODE" scripts/workspace-capacity-state.cjs seed "$CAPACITY_CONFIG" "$CAPACITY_PLAN" "$CAPACITY_OUT"
"$CAPACITY_NODE" scripts/workspace-capacity-environment.cjs prepare "$CAPACITY_CONFIG" "$CAPACITY_PLAN" "$CAPACITY_OUT"
```

The seed command directly creates synthetic fixture data, legal setup and SSR Auth sessions; this is **setup**, not proof of the application's upload/import path. It preserves partial progress and refuses unsafe identity/output reuse. Do not rerun it over another cohort or delete records to clear a failed attempt. `plan 100`, `plan 250` and `plan 500` select later targets only after prior workload acceptance and stop-condition review. Use a fresh directory/cohort for each scale; do not shrink the corpus to fit resources.

If the owned assembly is absent, the existing assembler supports a reviewed dry run followed by `--execute` on a fresh `/tmp/vaeroex-closeout-assembly-*` directory:

```sh
CAPACITY_CLI=/absolute/path/to/already-inspected/supabase
CAPACITY_STACK=/tmp/vaeroex-closeout-assembly-reproduction-01
CAPACITY_CLI_SHA=460ed2c417614cc9dfb21f11049b887316349cbc46159bc0469b24ed50613f62
"$CAPACITY_NODE" scripts/workspace-closeout-local-stack.cjs \
  --cli "$CAPACITY_CLI" --cli-sha256 "$CAPACITY_CLI_SHA" \
  --source "$CAPACITY_REPO" --output "$CAPACITY_STACK"
# Only after reviewing that exact local assembly plan:
"$CAPACITY_NODE" scripts/workspace-closeout-local-stack.cjs \
  --cli "$CAPACITY_CLI" --cli-sha256 "$CAPACITY_CLI_SHA" \
  --source "$CAPACITY_REPO" --output "$CAPACITY_STACK" --execute
```

This checks the pinned native CLI 2.119.0/checksum, disables automatic migration/seed, verifies owned DB data directory and explicitly applies the canonical local ledger. It excludes Realtime/functions/Studio/mail/analytics/pooler, so capacity cannot establish those services. Set `CAPACITY_CONFIG` to its private output before creating the cohort. A fresh canonical stack is not the production migration shape: the seven QBO production-layout files absent from canonical are already included in the separately captured 120-version production baseline. The local assembly neither applies production files nor activates a provider; current live activation/environment state remains unverified. A reused stack must already have the exact approved thirteen-file tail; stop for isolated schema reconciliation if its ledger differs. Never use a generic production `db push` here.

## 2. Configure the named profiles, confine services and launch

The following edits only the newly generated private harness configuration, not application settings or customer data. The immediate worker-restart profile is deliberately named and remains subject to its unchanged three-second qualification.

```sh
"$CAPACITY_NODE" - "$CAPACITY_RUNTIME" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2], cfg = JSON.parse(fs.readFileSync(file));
cfg.uploadProfile = 'supported_rows_v1';
cfg.workerRestartProfile = 'immediate_supervisor_recovery_v1';
cfg.scenario = 'nominal';
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
NODE
"$CAPACITY_NODE" scripts/workspace-capacity-confine-stack.cjs "$CAPACITY_CONFIG" "$CAPACITY_RUNTIME"
# Owned-stack restart: run only while no other measurement needs that stack.
"$CAPACITY_NODE" scripts/workspace-capacity-confine-stack.cjs "$CAPACITY_CONFIG" "$CAPACITY_RUNTIME" --execute

capacity_local() {
  /usr/bin/sandbox-exec -f "$CAPACITY_OUT/network.sb" /usr/bin/env \
    NODE_EXTRA_CA_CERTS="$CAPACITY_OUT/tls.public.pem" "$CAPACITY_NODE" "$@"
}
capacity_start() {
  CAPACITY_LOG=$1
  shift
  /usr/bin/sandbox-exec -f "$CAPACITY_OUT/network.sb" /usr/bin/env \
    NODE_EXTRA_CA_CERTS="$CAPACITY_OUT/tls.public.pem" "$CAPACITY_NODE" "$@" \
    > "$CAPACITY_LOG" 2>&1 &
  CAPACITY_LAST_PID=$!
}
capacity_local scripts/workspace-capacity-network-tests.cjs "$CAPACITY_RUNTIME" --bootstrap-pg-net
capacity_local scripts/workspace-capacity-sheets-fixtures.cjs "$CAPACITY_RUNTIME"
CAPACITY_ARTIFACT=$(git rev-parse HEAD)
capacity_start "$CAPACITY_OUT/supervisor.private.log" \
  scripts/workspace-capacity-environment.cjs serve "$CAPACITY_RUNTIME" true "$CAPACITY_ARTIFACT"
CAPACITY_SUPERVISOR_PID=$CAPACITY_LAST_PID
```

Confinement verifies CLI/stack/database ownership and retains before/after persistent fingerprints. The network probe must demonstrate kernel `EPERM` for an external reserved-address socket, an inherited child socket and native PostgreSQL `pg_net`; timeout alone is failure. The explicit `--bootstrap-pg-net` permits that extension only in the owned test DB. Provider fixtures use real owner Auth sessions and the real mapping-approval RPC, with synthetic encrypted credentials and a declared simulated OAuth outcome. No Google consent/customer token is used.

Wait for the supervisor's `runtimeReady` and actual process manifest, without printing private log/config contents. `serve ... true ...` builds the selected checkout and records its real build ID. `false` only reuses a previously verified matching build; supplying an arbitrary old commit to a new build is not provenance. The historical `0a15...`/`ReUcd...` observation cannot be recreated by changing a label. Any later rebuild, source change or runtime restart requires matching adapter qualification and new evidence.

## 3. Capture and qualify real actions, then verify the upload profile

```sh
capacity_local scripts/workspace-capacity-measure.cjs "$CAPACITY_RUNTIME" refresh 2400
capacity_local scripts/workspace-capacity-adapters.cjs "$CAPACITY_RUNTIME" capture
capacity_local scripts/workspace-capacity-qualify.cjs "$CAPACITY_RUNTIME"
capacity_local scripts/workspace-capacity-upload-boundaries.cjs "$CAPACITY_RUNTIME" "$CAPACITY_ARTIFACT" --supported-profile
```

Capture intercepts and aborts the actual browser POST before dispatch; its bound multipart metadata stays in `adapters.private.json`. Qualification then dispatches real actions, checks issue replay, real Storage bytes/staged rows, persisted AI usage and actual simulated-provider traffic, manual sync, scheduled sync and readback inventory. It writes `qualification-result.json`, qualified private adapters, `baseline-jobs.json` and `readback-catalog.json`. No `ready` flag is filled manually. Every selected actor needs a matching captured form.

The boundary utility additionally requires fully rendered destination, cleared pending and Storage readback for the mobile large supported upload. Its separate default `all` mode retains 1,001/10,000/50,000-row denial checks; run it in its own component phase if that boundary changed, not repeatedly during measurements. Component bounds do not replace workload thresholds.

At 500 active users there are 100 workspaces. Migration 13 and the paired dispatcher now retain tenant order across pages and admit at most 100 attempts per tick, with four concurrent/one-per-workspace claims unchanged. The reduced-schema native proof serves 100 distinct workspaces; the actual cohort qualification and workload must still measure queue delay and completion. At assumed five-second service, the virtual model still fails the 30-second queue target (115-second p95). Likewise the growth corpus has no qualified new state-helper path; these commands seed the normal 200-file corpus only.

## 4. Smoke, before/after inventory and the 20-minute quiet baseline

Perform the following phase procedure first with `CAPACITY_PHASE=smoke`, then with `CAPACITY_PHASE=baseline` only after the smoke and its independent inventory are reviewed. The variable changes evidence paths, not workload duration or thresholds. Never run phases concurrently. Every rerun needs a new output name/cohort procedure; existing output files are deliberately refused.

Refresh sessions before each finite run. Refresh does not extend the Auth server's configured JWT lifetime; the runner independently refuses a session that expires before the complete run plus 120 seconds. A 65-minute soak therefore needs an explicitly qualified isolated Auth lifetime/configuration; simply passing `refresh 4200` does not prove it was obtained.

For each phase the commands choose a **fresh** accepted-run baseline and before/after inventory. This prevents setup/smoke jobs being mislabeled baseline or primary work. Stop the preceding collector/controller before reconfiguring, then start new ones. The example begins with smoke:

```sh
CAPACITY_PHASE=smoke
# Repeat this entire phase procedure later with CAPACITY_PHASE=baseline.
"$CAPACITY_NODE" - "$CAPACITY_RUNTIME" "$CAPACITY_PHASE" <<'NODE'
const fs = require('node:fs'), path = require('node:path');
const file = process.argv[2], phase = process.argv[3];
if (!['smoke', 'baseline'].includes(phase)) throw Error('phase_invalid');
const cfg = JSON.parse(fs.readFileSync(file));
cfg.scenario = 'nominal';
delete cfg.faults; delete cfg.faultStartFile;
cfg.baselineRunIdsFile = path.join(cfg.out, `baseline-runs-before-${phase}.private.json`);
cfg.baselineInventoryFile = path.join(cfg.out, `inventory-before-${phase}.json`);
cfg.quietTenantBaselineFile = path.join(cfg.out, 'baseline', 'summary.json');
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
NODE
capacity_local scripts/workspace-capacity-measure.cjs "$CAPACITY_RUNTIME" refresh 1500
capacity_local scripts/workspace-capacity-measure.cjs "$CAPACITY_RUNTIME" inventory "$CAPACITY_OUT/inventory-before-$CAPACITY_PHASE.json"
capacity_start "$CAPACITY_OUT/$CAPACITY_PHASE-recovery.private.log" \
  scripts/workspace-capacity-faults.cjs recover "$CAPACITY_RUNTIME" "$CAPACITY_OUT/$CAPACITY_PHASE-recovery" 1800
CAPACITY_RECOVERY_PID=$CAPACITY_LAST_PID
capacity_start "$CAPACITY_OUT/collector-$CAPACITY_PHASE.private.log" \
  scripts/workspace-capacity-measure.cjs "$CAPACITY_RUNTIME" telemetry "$CAPACITY_OUT/environment.json" "$CAPACITY_OUT/generator.private.json"
CAPACITY_COLLECTOR_PID=$CAPACITY_LAST_PID
```

Require fresh `environment.json` with `ready:true`, complete provider/corpus/readback qualification and at least two actual CPU samples before the runner. The collector atomically samples every second, independently queries all cohort records, incrementally downloads new/changed Storage objects, checks real process ancestry and fingerprints schema every 60 seconds. First CPU sample is unknown; never substitute zero. The recovery-only controller polls the real recovery endpoint at most every 15 seconds and accepts no new provider work itself.

```sh
capacity_local "$CAPACITY_HTTP/run.mjs" "$CAPACITY_PHASE" "$CAPACITY_PLAN" "$CAPACITY_OUT/environment.json" \
  "$CAPACITY_OUT/sessions.private.json" "$CAPACITY_OUT/adapters.private.json" "$CAPACITY_OUT/$CAPACITY_PHASE"
```

Smoke lasts 60 seconds with up to five selected owners; it is not the complete active-user target. Baseline lasts 1,200 seconds with the quiet-workspace subset, the same per-actor arrival rate/mix and no synthetic scheduled bursts. At the 10-user scale both workspaces are quiet baseline workspaces. Its output must include ≥30 accepted samples for each page route/workspace before fairness comparisons. `status:observed` is not a pass.

After arrivals stop, independently observe queue depth and in-flight work both zero. Keep telemetry/recovery running until completion or a truthful bounded failure record; cancelling HTTP does not cancel accepted server work. Then stop only the named measurement processes, preserving the supervisor/native instance and data:

```sh
kill -TERM "$CAPACITY_COLLECTOR_PID" "$CAPACITY_RECOVERY_PID"
wait "$CAPACITY_COLLECTOR_PID"
wait "$CAPACITY_RECOVERY_PID"
capacity_local scripts/workspace-capacity-measure.cjs "$CAPACITY_RUNTIME" inventory "$CAPACITY_OUT/inventory-after-$CAPACITY_PHASE.json" \
  "$CAPACITY_OUT/$CAPACITY_PHASE/actions.jsonl" "$CAPACITY_OUT/$CAPACITY_PHASE/requests-reconciled.jsonl"
capacity_local "$CAPACITY_HTTP/verify-inventory.mjs" "$CAPACITY_PLAN" \
  "$CAPACITY_OUT/inventory-before-$CAPACITY_PHASE.json" "$CAPACITY_OUT/inventory-after-$CAPACITY_PHASE.json" \
  "$CAPACITY_OUT/$CAPACITY_PHASE/actions.jsonl" "$CAPACITY_OUT/$CAPACITY_PHASE/requests-reconciled.jsonl" "$CAPACITY_OUT/$CAPACITY_PHASE-inventory-result.json"
```

A startup failure may produce `blocked.json` without complete journals; retain it and do not fabricate the missing inputs. The baseline has no burst scheduling, so `scheduledCoverage.complete:false` is an honest limitation of that baseline, not permission to remove the primary coverage requirement. Read the verifier result with its phase: missing records/readbacks/relationships are blockers; the intentionally absent scheduled-burst coverage prevents a baseline alone becoming a capacity pass. The before/after exports and logs must belong to the exact same phase. Once smoke passes its component requirements, repeat this procedure with `CAPACITY_PHASE=baseline` before continuing below.

## 5. Qualify faults and run the primary workload

Before primary load, each fault needs actual isolated qualification and a nonempty canonical baseline. Run one controller at a time; its lock prevents overlap. These are separate component checks, not added user actions in the measured run:

```sh
capacity_local scripts/workspace-capacity-faults.cjs qualify "$CAPACITY_RUNTIME" "$CAPACITY_OUT/fault-throttle" provider_throttle
capacity_local scripts/workspace-capacity-faults.cjs qualify "$CAPACITY_RUNTIME" "$CAPACITY_OUT/fault-expired" expired_authorization
capacity_local scripts/workspace-capacity-faults.cjs qualify "$CAPACITY_RUNTIME" "$CAPACITY_OUT/fault-partial" partial_read
capacity_local scripts/workspace-capacity-faults.cjs qualify "$CAPACITY_RUNTIME" "$CAPACITY_OUT/fault-ack" commit_ack_loss
capacity_local scripts/workspace-capacity-faults.cjs qualify "$CAPACITY_RUNTIME" "$CAPACITY_OUT/fault-slow" slow_workspace
capacity_local scripts/workspace-capacity-faults.cjs qualify "$CAPACITY_RUNTIME" "$CAPACITY_OUT/fault-worker" worker_interruption
capacity_local scripts/workspace-capacity-faults.cjs plan "$CAPACITY_RUNTIME" "$CAPACITY_OUT/primary-faults"
```

Component qualification uses the actual quarter-hour scheduled endpoint when wall-clock due work arises; it never retimes accepted eligibility. Primary keeps only its original scheduled ticks at elapsed 0/900 seconds. Its fault plan aligns to the unchanged selector's existing manual-sync arrivals, with zero extra user actions. The controller must prove actual injection; a configured fault window alone cannot exclude a failed request from the failure rate.

Set the primary paths only after component work is terminal, using a new accepted-work baseline:

```sh
"$CAPACITY_NODE" - "$CAPACITY_RUNTIME" <<'NODE'
const fs = require('node:fs'), path = require('node:path');
const file = process.argv[2], cfg = JSON.parse(fs.readFileSync(file));
const faults = JSON.parse(fs.readFileSync(path.join(cfg.out, 'primary-faults', 'plan.json')));
if (faults.runId !== cfg.runId) throw Error('fault_run_mismatch');
cfg.scenario = 'chaos'; cfg.faults = faults.faults;
cfg.faultStartFile = path.join(cfg.out, 'primary-start.private.json');
cfg.baselineRunIdsFile = path.join(cfg.out, 'baseline-runs-before-primary.private.json');
cfg.baselineInventoryFile = path.join(cfg.out, 'inventory-before-primary.json');
cfg.quietTenantBaselineFile = path.join(cfg.out, 'baseline', 'summary.json');
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
NODE
capacity_local scripts/workspace-capacity-measure.cjs "$CAPACITY_RUNTIME" refresh 1800
capacity_local scripts/workspace-capacity-measure.cjs "$CAPACITY_RUNTIME" inventory "$CAPACITY_OUT/inventory-before-primary.json"
capacity_start "$CAPACITY_OUT/controller-primary.private.log" \
  scripts/workspace-capacity-faults.cjs serve "$CAPACITY_RUNTIME" "$CAPACITY_OUT/primary-faults" "$CAPACITY_OUT/primary-start.private.json"
CAPACITY_FAULT_PID=$CAPACITY_LAST_PID
# Start the controller first so a stale old fault-status file cannot qualify.
capacity_start "$CAPACITY_OUT/collector-primary.private.log" \
  scripts/workspace-capacity-measure.cjs "$CAPACITY_RUNTIME" telemetry "$CAPACITY_OUT/environment.json" "$CAPACITY_OUT/generator.private.json"
CAPACITY_COLLECTOR_PID=$CAPACITY_LAST_PID
# Require fresh ready telemetry with two real CPU samples before this command.
capacity_local "$CAPACITY_HTTP/run.mjs" run "$CAPACITY_PLAN" "$CAPACITY_OUT/environment.json" \
  "$CAPACITY_OUT/sessions.private.json" "$CAPACITY_OUT/adapters.private.json" "$CAPACITY_OUT/primary"
```

Primary is 120-second ramp, 1,200-second plateau and 180-second drain. Require actual offered load, every actor represented, every quiet route sampled, all selected workspaces covered by accepted scheduled jobs, declared faults actually observed, original queue ages and terminal accepted work. The fault controller waits at most 600 seconds for the runner's actual epoch and records missed schedules as failures. Retain failures rather than changing the epoch, adding hidden extra syncs or repeating until a convenient pass.

After the bounded drain/independent reconciliation, stop named collector/controller, preserve data, and export/verify with primary logs:

```sh
kill -TERM "$CAPACITY_COLLECTOR_PID" "$CAPACITY_FAULT_PID"
wait "$CAPACITY_COLLECTOR_PID"
wait "$CAPACITY_FAULT_PID"
capacity_local scripts/workspace-capacity-measure.cjs "$CAPACITY_RUNTIME" inventory "$CAPACITY_OUT/inventory-after-primary.json" \
  "$CAPACITY_OUT/primary/actions.jsonl" "$CAPACITY_OUT/primary/requests-reconciled.jsonl"
capacity_local "$CAPACITY_HTTP/verify-inventory.mjs" "$CAPACITY_PLAN" \
  "$CAPACITY_OUT/inventory-before-primary.json" "$CAPACITY_OUT/inventory-after-primary.json" \
  "$CAPACITY_OUT/primary/actions.jsonl" "$CAPACITY_OUT/primary/requests-reconciled.jsonl" "$CAPACITY_OUT/primary-inventory-result.json"
```

The exporter links primary records by real logical markers and accepted syncs by actual RPC receipts, verifies current actor visibility through Auth/PostgREST, hashes downloaded Storage bytes and checks tenant-parent relationships/duplicates. `/app` and empty reports may provide workspace-context readback only; that does not verify every derived aggregate. The verifier's bounded child uses 768 MiB heap, 120-second timeout, 256 MiB combined input cap and 1,280 MiB post-parse RSS ceiling. A cap or incomplete export is BLOCKED, never an empty-data pass; larger targets may need a separately qualified streaming/sharded exporter.

Only after all required primary thresholds and inventory predicates pass can a later scale run. `soak` has the same CLI arguments, 120-second ramp/3,600-second plateau/180-second drain, and requires its own environment/session/fault-duration qualification; the current primary fault `serve` controller is finite at 1,500 seconds and is **not** automatically a 3,900-second soak controller. The 500-user soak exceeds the fixed request bound and is refused. Do not silently shorten it or reuse a finished fault controller as live telemetry.

## Failed and pending profiles, evidence and shutdown

| Profile / artifact | Recorded outcome and limit |
|---|---|
| Original `forced_three_second_outage_v1` | A deliberate 3,000 ms pre-spawn pause consumed the restart budget; actual kill→ready was **4,134 ms**, exceeding 3,000 ms. Earlier 3,008 ms described manifest/spawn only. Accepted work later truthfully failed at 284,954 ms and a subsequent sync returned 100 facts, but an independently due quiet-workspace queue also remained in that component case. Overall recovery remains failed; the real scheduler later cleared it without retiming. |
| New `immediate_supervisor_recovery_v1` | [Actual component pass](worker-immediate-qualification.json): zero artificial pause; kill→ready 1,031 ms ≤3,000 ms; terminal accepted work, successful 100-fact post-fault sync and empty queues at 284,420 ms from fault-end (285,451 ms from kill), ≤300,000 ms. Approximately 15-second independent recovery polling; full workload and production cadence remain separate. |
| QBO old 300-second lease | Retained real kill result is **300,047.717625 ms** to retry-ready, a threshold failure; it does not establish provider completion. |
| QBO 270/240/255 seconds | [New actual native drill](qbo-kill-270-native.json): 269,944.450 ms SIGKILL→retry-ready passes 300,000 ms; no early reclaim, stale worker denied, 48 tasks/47 unrelated rows preserved. Provider completion and nonzero source-data recovery are absent; production five-minute cadence remains unqualified. Release compatible lease/work/cleanup code together; old leases retain their deadlines and old failure evidence remains. |

For any stop, preserve `summary.json` or `blocked.json`, actions, original and reconciled request journals, response-linked readbacks, telemetry/completion records, actual fault evidence, before/after inventories, exact source/build/schema/runtime fingerprints and local migration receipts. Retain loaded-source hashes: reading a changed file's hash at the end does not identify what a running controller loaded. The earlier component provenance sidecars explain this difference and must remain with its failure.

Publish only selected sanitized result metadata and hashes. Private runtime/assembly configuration, sessions, provider credentials, TLS private key, captured action metadata, raw bodies and private logs stay outside the repository. A correct HTTP response/build does not substitute for durable inventory; no aggregate monthly cost is claimed from simulated-token totals.

When all inspection/export work is complete, stop only the owned supervisor via its recorded PID or its private `runtimeControl` stop flag. Native stack shutdown uses the exact owned assembly stop command/environment from its private manifest; do not print its control document, kill arbitrary processes, reset the DB or remove the cohort. Preserve the reviewable evidence and leave production holds intact. This runbook prepares execution; the main audit must separately state the highest workload actually demonstrated, the first limiting factor and all unexecuted targets.
