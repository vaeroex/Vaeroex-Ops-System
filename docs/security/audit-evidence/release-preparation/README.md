# CL-02 focused release-preparation evidence

Read-only production metadata/aggregate inspection and isolated build-context qualification on2026-10-05. This extends the same audit; no capacity run, production write, deployment, migration, connector activation or paid call was made. Customer records/credentials and the proposed administrator identity are excluded. The private proposal is retained separately under ignored `outputs/private-release-preparation/` with directory0700/files0600.

- `destination-readonly.json`: actual Vercel production artifact and120-version Supabase ledger; operational counts and precise403/reauthentication gaps. Aggregate queries are separate observations, **not** a transactionally consistent release-cutoff inventory. Empty active-connection results do not establish disabled feature flags.
- `gcp-readonly-status.json`: existing account requires interactive reauthentication; no proven IAM denial and no remote worker configuration obtained.
- `ci-4c28c134.json`: previously uncertain final documentation head actually passed all four jobs. Later exact-head status is recorded onPR#464; no future success inferred.
- `qbo-summary.json`, `qbo-docker-context-result-host.json`, `qbo-with-required-patch-result.json`: VXA-043 negative/paired proof at source4c28c134. Original dependency COPY set lacks required patch and fails254; adding only the existing tracked patch succeeds0 with471 cached packages, zero downloads. pnpm9.15.4, macOS/Node24.19.0, OS outbound denial, offline/frozen/no scripts. This is not a Linux container-image qualification. An initial nested-sandbox process-execution failure is preserved in the original private directory and its hash in the summary; it is not the missing-patch negative control.

Correction commit: `3764d62d45103d341f77f093a5fe7b83555f1e3b`. It changes only the QBO Docker dependency input and five lines in the existing architecture regression. Run:

```sh
node scripts/external-integrations-qbo-production-regression-tests.js
```

Observed248 assertions pass. The negative control evaluates the same script against an in-memory Dockerfile with only `COPY patches ./patches` removed and must throw `dependency install receives patches/next@15.5.24.patch`; no source file is modified. For the executed dependency-install proof, the JSONs retain the exact source hashes/command and copied inputs. Reproduction requires a separately owned temporary directory, matching cached dependencies and OS outbound denial; it must not install into or restart the capacity environment. Use `pnpm install --offline --frozen-lockfile --ignore-scripts`; do not substitute an online provider/image build and call it the same test.

The thirteen migration files/hashes, actual configuration keys, exact access prerequisites, future guarded CLI staging invocation, admission/drain inventory and coordinated recovery are in [the technical runbook](../../workspace-release-runbook.md). The [review proposal](../../workspace-release-proposal.md) includes new Executive Analysis and existing supported integrations. It remains onHOLD; it does not claim the missing nominal drain, real-provider billing or production maintenance qualification passed. Current migration rehearsal and small workload evidence remain unchanged in `../capacity-closeout/`.


Restored-access continuation:
- `restored-vercel-sanitized.json` and `restored-vercel-nonsecret-config.json`: successful CLI metadata/scoped nonsecret reads; write-only policy/admin values remain unknown. No secret decryption/export.
- `restored-gcloud-sanitized.json`, `restored-qbo-config-comparisons.json`, `restored-cloud-controls.json`: actual worker modes/images/limits, queue and schedules, caller/CA comparisons and bounded zero-task inventory. Raw environment/credential values were excluded. Comparison output retains only validated source/mode IDs, public CA hash and booleans.
- `restored-supabase-readonly-limits.json`: unchanged ledger, actual60 DB maximum and five four-connection login limits. Independent observations, not a cutoff or peak-capacity sample.
- `provider-access-readonly.json`: separate Google browser challenge and unattributed provider dashboard limitations. Zero displayed usage is not a claim about Vaeroex production usage.
- `actual-cli-rollout/`: unchanged selected18-file bundle plus hash manifest, actual CLI2.119.0 failure/interruption/recovery and prior fixture failures. Read its reconciliation before generalizing the443 assertions. Production and capacity environments were untouched; all auxiliary clusters stopped.

Automatic approval review rejected broad decrypted-env retrieval, unfiltered cloud metadata persistence and raw worker URL/settings output. None executed. Safer metadata-only, per-key nonsecret and comparison-only reads completed the independent checks. Write-only owner configuration/provider attribution and actual release execution remain outside those completed checks.

- `qualified-linux-image/`: full image build/six-mode smoke, exact CI head/merge/tree, image ID/input/base hashes, bounded resource/cleanup receipts and full step log. All four jobs passed; no registry/deployment artifact or provider/DB lifecycle claim.

- `supabase-release-controls-readonly.json`: existing dashboard snapshot availability, PITR-off/Storage exclusion and visible policy/API controls. No restore, backup download or setting mutation.
