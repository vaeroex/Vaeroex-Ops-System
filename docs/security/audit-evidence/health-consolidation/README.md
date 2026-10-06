# Health consolidation and authorized audit-stack integration

This evidence closes only the user-approved code integration and Health/Intelligence consolidation scope. Production release, provider activation/spending, Google qualification, larger capacity testing and meaningful CRM/Tasks retirement remain deferred. No historical data or migration was removed.

## Source identities

- Original complete audit stack: `2cde427c8b30cf34702baf43f7b3fc2d17f48b81`.
- Initial consolidation: `4604d8f6e8f11c25a2132dab3b58863e94ce730e`.
- Historical movement guard correction: `8a0c172577b7262603737546342d2b61d013fb1c`.
- Stack/hold synchronization: `9880cbe11ca6328a3efbd22d1fb5c8762b641fac`, with exactly the same tree as `8a0c1725`.
- Final application: `639c4670895c835a62de51f0999e5e48cd3d6434`, adding only explicit UTC date formatting to the application after `8a0c1725`. Test wiring/regressions are also committed.

The original movement assertion, CI relocation-contract failure, test-interaction failures and date-hydration failure remain evidence. A later successful result never replaces those original observations. CL-01 runtime patch bytes, thirteen audit migrations, tenant authorization, publication/import authority and integration behavior remain unchanged by this follow-up.

## Merge safeguards

`github-merge-safety.json`, `supabase-merge-safety.json` and `cloud-build-merge-safety.json` record read-only checks. Main and all held review branches disable Vercel Git deployment. No repository webhook or Supabase GitHub migration integration is configured. The matching Cloud Build trigger requires manual approval; this task does not approve it. Its image candidates are not runtime deployment artifacts. Current CI receipts preserve exact heads and tested trees.

## Focused deterministic verification

Use the repository-pinned Node and pnpm versions with existing installed dependencies. Do not let an ambient newer pnpm replace the patched dependency tree.

```sh
node scripts/workspace-health-loader-regression-tests.cjs
node scripts/intelligence-health-presentation-tests.cjs
node scripts/business-health-explanation-regression-tests.js
node scripts/saved-analysis-regression-tests.js
node --test scripts/workspace-executive-presentation-contract-tests.js
```

The extraction preserves24 old/new cases, eight durable exact baseline contracts and sixteen source-error cases. Presentation has21 assertions; the new movement correction adds25 assertions. The source relocation contract retains all six original frozen hashes and rejects altered/missing/duplicate approved hunks. Saved-analysis date regression runs the actual formatter in UTC, Los Angeles and Tokyo processes across15 cases. These are not substitutes for the authenticated browser evidence below.

## Authenticated browser qualification

`browser-final-639c4670.json` is the strict **88-check pass** for application commit `639c4670895c835a62de51f0999e5e48cd3d6434`, production build `Nn-YxH6DTf0HzOgt91urw`. Actual Chrome ran at 1440×1000 and 390×900, with the browser explicitly in `America/Los_Angeles` and the application in UTC. Owner, viewer, current, stale and empty cases ran twice at each width. The checks cover automatic Overview→Intelligence navigation, score/freshness, keyboard-operated factors and citations, all five history ranges and the V1/V2 boundary, the existing analysis drawer and focus handling, and Saved Analyses navigation. Authenticated foreign-report access, three PostgREST table reads, a forged workspace-selection cookie and subscription denial were checked at both widths.

The two fault cases intercepted exactly one authenticated, workspace-scoped `GET /rest/v1/assets` each, in the application process only. `browser-fault-events.json` records the actual 503 responses. Other Intelligence findings remained identical. After disabling the fault, keyboard activation of **Retry Health** restored the score and cleared pending state without manual navigation or reload. A distinct query nonce was used only to cause the initial faulting document request; retry used the actual control on that same URL. Browser errors, unexpected HTTP failures, nonlocal browser requests and provider requests were all zero in the final run.

The main matrix preserved all scoped fingerprints across workspaces, 24 Health snapshots, 3 completed historical artifacts, 3 historical saved reports, 18 KPI rows, settings, file metadata and SOPs. Three original Storage objects retained their download SHA256 values. Existing unrelated synthetic fixtures also retained their fingerprints. Same-day snapshots were seeded deliberately to verify that the existing first-review preservation behavior did not rewrite history. A new-day snapshot insertion was not part of this presentation qualification.

`save-browser-final-639c4670.json` is a separate **three-check pass after the preservation matrix**. The actual Save Analysis button copied an existing validated synthetic artifact into exactly one new canonical saved report, showed **Already saved** automatically and cleared pending state. Two repeated authenticated action POSTs returned `already_saved` with that same record. A fresh mobile context found the persisted state and followed **View saved analysis** to its citation. The original three reports and their copied artifacts/citations remained byte-identical. No generation was submitted; the new report increased the total from three to four intentionally. The legacy fixture envelopes had historical keys, so this was an explicit new canonical save rather than an invented already-saved result.

The original failures are retained in `browser-preserved-failure-summary.json`, the movement/date diagnostic files and private original receipts. They include the proved movement assertion defect, an exact citation-label test correction, an initially ineffective same-document fault navigation, and the proved cross-timezone Reports hydration defect. The final assertions were not relaxed to obtain the pass.

### Environment and limits

`browser-native-identity.json` verifies all 136 local canonical migration versions and the retained native schema fingerprint. No migration was applied for this qualification. This is the existing owned local Supabase Auth/PostgREST/Storage environment; its canonical migration ledger is distinct from the production ledger and proposed rollout. Fresh synthetic accounts, workspace IDs and evidence were used throughout. The runtime retained the qualified Next patches and explicit public TLS authority. Its existing test-only `skipMiddlewareUrlNormalize: true` configuration preserves the loopback authority; original configuration and loader hashes are recorded in the browser receipt.

The OS network profile denied external sockets (`EPERM` was verified). Provider transport remained directed at an idle local simulator with zero calls. No customer integration, AI generation, production request, load/capacity test or paid service was exercised. Cached historical AI artifacts were seeded as validated test records; their contents and citations were qualified for display and saving, not provider-generation quality. The idle app, worker, simulator and supervisor were stopped and their PIDs verified absent in `browser-shutdown.json`; the native Supabase stack and all synthetic data/files were preserved.

### Reproduce without production access

Run from the repository root with its existing patched dependencies and pinned Node. The native configuration must refer to the already assembled, owned, localhost-only disposable stack, have 0600 permissions, match its running Auth/database identity and have the exact repository migration ledger. These commands do not provision, upgrade, reset, migrate or restore Supabase. A missing native stack is a prerequisite to assemble separately using the retained closeout setup; do not substitute a linked or production project.

```sh
HEALTH_NODE=/Users/isaacvizcarra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
HEALTH_NATIVE=/tmp/vaeroex-closeout-assembly-final/private-e2e-config.json
HEALTH_OUT=/tmp/vaeroex-capacity-health-repro-01
HEALTH_COMMIT=639c4670895c835a62de51f0999e5e48cd3d6434

# The output directory must not already exist. The bootstrap profile contains no credentials.
"$HEALTH_NODE" -e 'require("node:fs").writeFileSync("/tmp/vaeroex-health-bootstrap.sb",require("./scripts/workspace-capacity-environment.cjs").profile,{mode:0o600,flag:"wx"})'
/usr/bin/sandbox-exec -f /tmp/vaeroex-health-bootstrap.sb "$HEALTH_NODE" scripts/intelligence-health-fixtures.cjs prepare "$HEALTH_NATIVE" "$HEALTH_OUT"
/usr/bin/sandbox-exec -f "$HEALTH_OUT/network.sb" "$HEALTH_NODE" scripts/intelligence-health-fixtures.cjs seed "$HEALTH_OUT/runtime.private.json"

# Keep this bounded idle supervisor in its own terminal until the browser checks finish.
/usr/bin/sandbox-exec -f "$HEALTH_OUT/network.sb" "$HEALTH_NODE" scripts/intelligence-health-runtime.cjs "$HEALTH_OUT/runtime.private.json" true "$HEALTH_COMMIT"
```

Then, from a second terminal using the same task-specific variables:

```sh
/usr/bin/sandbox-exec -f "$HEALTH_OUT/network.sb" /usr/bin/env NODE_EXTRA_CA_CERTS="$HEALTH_OUT/tls.public.pem" "$HEALTH_NODE" scripts/intelligence-health-browser.cjs "$HEALTH_OUT/runtime.private.json" "$HEALTH_COMMIT"

# Use the successful matrix receipt printed above. This separate check adds one
# canonical saved report and refuses to repeat that first-save setup on the same fixture.
HEALTH_MATRIX="$HEALTH_OUT/health-browser-<printed-run-id>/result.json"
/usr/bin/sandbox-exec -f "$HEALTH_OUT/network.sb" /usr/bin/env NODE_EXTRA_CA_CERTS="$HEALTH_OUT/tls.public.pem" "$HEALTH_NODE" scripts/intelligence-health-save-browser.cjs "$HEALTH_OUT/runtime.private.json" "$HEALTH_COMMIT" "$HEALTH_MATRIX"
```

Stop only that supervisor with Ctrl+C afterward; it stops its app, idle worker and simulator while preserving Supabase and the fixtures. The runtime launcher writes the private one-request fault injector from source and records its hash. It refuses non-synthetic configuration. `false` can replace `true` only when the prior process manifest identifies the same compiled commit and build ID; the final evidence used this verified build reuse to switch from the original private wrapper to the reproducible launcher.

`browser-evidence-manifest.json` records the exact four harness hashes and all selected result/screenshot hashes. Private Auth sessions, credentials, native CLI output and runtime configuration are intentionally excluded. The final default desktop preview is [the 1440×1000 viewport](screenshots/current-1440-default-viewport.png); [the 390px full page](screenshots/current-390-default.png) shows the corresponding mobile layout. Expanded history/evidence, unavailable/recovered Health and saved-state screenshots are retained alongside them.


## Worker-only build correction after browser qualification

The first final CI head5d838cb7 exposed a new type-resolution failure because `workspace-health.ts` imported a chart type through `components/`, which the worker image correctly excludes. See the preserved CI/image failure receipts. The correction imports the existing `StoredBusinessHealthTrendPoint` library type directly; the chart's alias remains unchanged. `worker-type-emitted-equivalence.json` proves identical TypeScript and NextSWC runtime JavaScript, preserving applicability of the639c authenticated browser result. `worker-type-resolution.json` proves the original import fails and the correction passes actualncc in a disposable worker-only source context on macOS. The new loader regression rejects UI dependencies early. The actual corrected-head Linux image/six-mode smoke result is recorded on PR#465 after CI completes; no future CI success is assumed here.


## Final security-contract location correction

On PR head `7090198137261c850a3bcca8248813f5deed923c`, run `37400860319` passed the actual Linux amd64 worker image and all six network-isolated smoke modes, as well as types, lint and the production build. [The image receipt](ci-465-linux-image-70901981.json) distinguishes the PR head from its tested merge commit/tree. The run then failed the security check's obsolete Overview source-location assumption; [the original failure](ci-465-preserved-security-location-failure.json) is preserved.

The test now checks the actual shared loader's AST: exactly one awaited snapshot writer must use the scoped client/workspace inside the source-success **AND** sufficient-evidence gate. Eight negative mutations fail. The full Health view is exercised for all sixteen core-source failures and never writes a snapshot; the existing empty-evidence contract also writes none. [Local validation](security-location-correction-regression.json) passes the complete eleven-command security chain, loader regression, full type check and scoped lint. This correction changes no application bytes. The final corrected-head CI remains required; neither the earlier failed run nor a future run is described as passed. [Selected evidence hashes](security-location-evidence-manifest.json).
