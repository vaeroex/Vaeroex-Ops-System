# Targeted source workflow closeout driver

Prepared only; no browser, app server, build, or fixture mutation was executed during preparation. The driver starts an existing Next production build on the explicitly pinned loopback app origin used by that build. It never builds. It requires the owned disposable native Supabase private configuration and refuses non-loopback targets, linked checkouts, unexpected database data directories, or mismatched source/build/fixture identities.

This tail reuses the latest synthetic owner/workspace from E2E5, resets only that synthetic owner password, and does not repeat form, asset, membership, or Storage isolation tests already recorded in E2E5. The fixture manifest contains three attempts; its last execution matches `/tmp/vaeroex-closeout-e2e-5/result.json`: `45708faa-1f61-428a-badf-e92e7ea24277`. It requires that exact execution ID explicitly. Keys/passwords are held privately and sanitized from artifacts.

## Scope

- Real mobile source upload via the native `#workspace-file-upload > summary` disclosure and original server action; read back Storage object and source record.
- Real CSV preparation, user-approved `wide_time_series` mapping, two persisted KPI dates/values, worksheet/source lineage, reconciliation and replay readback.
- Separate deliberately incomplete authenticated import attempt: persisted pending worksheet chunk remains excluded from vector retrieval while a confirmed synthetic basis-vector positive control is returned; prior completed rows/chunks remain. No provider calls or semantic-ranking qualification.
- Separate source with one older prepared import and 301 newer synthetic failed-history headers, all seeded BEFORE the actual authenticated old-import claim. Mobile detail must show Import held, recovery form must target the old import ID, approval/reprepare controls must be absent, and historical newest300 rows plus displayed newest4 remain unchanged. The history headers do not claim successful worker execution.

## Run after the final exact build is ready

Execute from the managed worktree. Set these values to the reviewed build identity rather than inferring deployment state. `VXT_EXPECTED_SOURCE_SHA256` is the SHA256 of `app/app/sources/SourcesPage.tsx` used by that build. Use a fresh output directory.

```sh
VXT_EXECUTE=yes \
VXT_EXPECTED_COMMIT='<full reviewed commit>' \
VXT_EXPECTED_BUILD_ID='<reviewed .next/BUILD_ID>' \
VXT_EXPECTED_APP_ORIGIN='http://127.0.0.1:<reviewed nonzero port>' \
VXT_EXPECTED_SOURCE_SHA256='<reviewed SourcesPage.tsx SHA256>' \
VXT_EXPECTED_FIXTURE_EXECUTION='45708faa-1f61-428a-badf-e92e7ea24277' \
CHROME_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
/Users/isaacvizcarra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /tmp/vaeroex-closeout-source-tail.cjs \
  /tmp/vaeroex-closeout-assembly-final/private-e2e-config.json \
  /tmp/vaeroex-closeout-source-tail-result \
  --continue-after-navigation-failure
```

The continuation flag is optional; default behavior is fail-fast. An actual action response with a validated same-origin workspace redirect may be recovered with an explicit page navigation after20s solely to finish independent readbacks. The original navigation failure stays failed, top-level result stays false, and process exit is1. No mutation is resubmitted. No automatic-navigation fix is claimed.

## Preparation evidence

- Driver `node --check` passes.
- Driver ESLint stdin uses the same `scripts/workspace-closeout-e2e.cjs` repository rules; log `/tmp/vaeroex-closeout-source-tail-lint.log`.
- Canonical helper regression `/tmp/vaeroex-closeout-navigation-helper-selftest.cjs`:16 offline fake-page checks, not real browser/Auth evidence.
- The canonical E2E change for this tail is only the Upload file summary selector.
- The focused runtime proof remains unexecuted until the command above runs; no source build or browser result is inferred from these checks.
