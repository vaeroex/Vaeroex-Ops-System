# Next 15.5.24: render wakeup and hydration replay backports

`next@15.5.24.patch` backports the retry-lane branch from [React PR #36134](https://github.com/react/react/pull/36134), “Fix useDeferredValue getting stuck”, to the four standard vendored client/profiling renderers. Next bundles React `19.2.0-canary-0bdb9206-20250818`; changing the top-level React package does not update these renderers.

A resource can resolve synchronously during a suspended render. Restarting the stack is prohibited inside render, but the old branch also discarded the retry lanes. An authenticated action could therefore persist, return its redirect and decode all Flight resources while the browser never committed the new page. This was reproduced on both the accepted pre-audit baseline and the proposed stack (VXA-039 / CL-01).

The backport records the retry lanes when a restart is not possible. It adds no timer, reload, action retry, authorization exception or application mutation. pnpm applies and hashes the version-pinned patch on installation; do not edit installed dependencies manually. Experimental renderers are not used or patched.

The same pinned patch also backports [React PR #35494](https://github.com/react/react/pull/35494), “Correctly handle replaying when hydrating” (merged 13 January 2026). A host element can claim its DOM node, suspend on a lazy Flight child, and resume before React fully unwinds it. The old replay starts with its cursor already inside that element, producing a false HTML mismatch and, sometimes, failed streamed segment insertions. The upstream helper restores the parent/cursor before replaying that host. Actual browser captures show the workspace main element replaying against its own first Suspense comment; this is independent of missing HTML or invalid nesting. It adds no parser delay or scheduling gate.

Verification:

```sh
pnpm test:workspace-audit:browser
# Expected failure: reverse only the backported branch in a disposable renderer copy.
node scripts/workspace-action-completion-runtime-tests.cjs --negative-control
node scripts/workspace-hydration-replay-tests.cjs --negative-control
# Real, isolated Auth/PostgREST/Storage, with the existing private local-stack manifest:
node scripts/workspace-action-completion-e2e.cjs /tmp/<owned-stack>/private-e2e-config.json /tmp/<fresh-output>
```

Set `CHROME_EXECUTABLE_PATH` when using a locally installed Chrome. The deterministic renderer test must complete without a reload or state nudge; the unpatched control must fail. The separate authenticated driver verifies automatic transitions, visible feedback, pending completion and saved data at desktop/mobile widths. It forbids manual navigation recovery and provider traffic.

Remove this patch when an approved Next version vendors both upstream fixes and both regressions pass without it. A future version change must explicitly review the patch rather than silently dropping it. Rolling back this patch reintroduces the observed pending defect, but changes no database contract; preserve the audit stack's separate coordinated migration/recovery rules and deployment holds.
