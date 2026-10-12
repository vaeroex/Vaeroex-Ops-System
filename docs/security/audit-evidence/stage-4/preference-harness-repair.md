# Reduced preference/timezone scaffold compatibility repair

Changed only `scripts/integration-summary-preferences-database-tests.cjs` in the implementation worktree. Its one reduced `public.workspaces` scaffold executes both canonical preference and timezone SQL fixtures. Their now-explicit bounded trial seeds require subscription columns that this scaffold previously omitted.

Added `subscription_status text not null default 'manual_review'`, `trial_ends_at timestamptz`, and the exact allowed-status check from `202606170003_phase_6_squarespace_subscriptions.sql`. No app code, migration, canonical SQL fixture, privilege, or assertion changed. Scoped `git diff --check` passed.

Ran every command in `test:current-integrations` sequentially using Node v24.19.0 at `/Users/isaacvizcarra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`:

- `node --test scripts/current-integrations-tests.cjs scripts/integration-summary-preferences-route-tests.cjs scripts/workspace-reporting-timezone-tests.cjs`: 35/35 pass, 1.37 seconds.
- `node scripts/integration-summary-preferences-database-tests.cjs`: 45/45 preference and 33/33 timezone SQL assertions; one Node test passes, 1.03 seconds.
- `node scripts/square-payment-browse-identity-tests.cjs`: 2/2 pass, 3.39 seconds.
- `node scripts/current-integrations-browser-tests.cjs`: pass, eight states at four widths; hydrated hide/restore persistence, ten-check bound, manual refresh, and error state.
- `node scripts/workspace-reporting-timezone-browser-tests.cjs`: pass, pending/success/failure/transport/clear/workspace-switch cases at four widths.

Both browser runs used existing `QBO_TEST_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'` with the scripts' loopback-only synthetic fixtures. Initial current-integrations browser attempt without this override could not find Playwright's bundled Chromium; no assertions ran in that attempt. No browser installation was performed.

Browser artifacts:

- `/var/folders/dg/6nzrmjqn3bd1mrmqvx_80frr0000gn/T/current-integrations-browser-Cb5FnN`
- `/var/folders/dg/6nzrmjqn3bd1mrmqvx_80frr0000gn/T/workspace-reporting-timezone-browser-CKCX17`

This qualifies the local reduced harness and dashboard CI command. It does not constitute a fresh full migration replay or hosted test result.
