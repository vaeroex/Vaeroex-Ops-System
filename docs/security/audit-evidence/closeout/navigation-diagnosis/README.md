# Local server-action navigation qualification failure

Source under test: held production build from commit `d4e57b5652acfc8e2ce1ae6e47518eab06a81918`; Next build ID `g28qS3h7wAvqj6BaHP8vZ`, Next 15.5.24. Root owns the exact source manifest in `/tmp/vaeroex-closeout-e2e-4/source-manifest.json`. Worktree was not rebuilt or edited during this diagnosis.

The same failure was independently reproduced on an existing owned, disposable native Supabase 17.11 stack using synthetic accounts, real Auth/PostgREST, and an ephemeral local production Next server. Each intentional diagnostic form submission used a fresh server-generated request identity. No provider credentials, customer data, deployment, new Supabase stack, or application change was involved. Temporary browser/app/proxy processes were stopped after each bounded run.

## Verified behavior

- First internal-form submission persists exactly one matching synthetic response by approximately 1 second.
- POST returns 303 with the expected `x-action-redirect` saved-message URL and `text/x-component`, chunked transfer, and no HTTP Location header.
- Browser fetch-clone inspection receives the complete RSC stream and EOF. The Flight root exists with expected b/f/S keys and the matching build ID.
- The actual Next Flight decoder root fulfills; serverActionReducer and refreshInactiveParallelSegments settle. The action rejects with the normal NEXT_REDIRECT digest and Next's internal canonicalUrl advances to the expected saved-message URL.
- The browser URL and existing DOM remain unchanged, and the button stays disabled/aria-busy true for the bounded 20-second observation. No pageerror is reported.
- A direct asset-check server action, which does not use the new useActionState adapter, also persists and receives a complete redirect/RSC response while its UI remains Working. This rules out the new form adapter as the sole cause.
- Removing all Playwright route registrations did not fix the failure. That control used a local deny-all HTTP/CONNECT proxy, explicit loopback bypass, and blocked external name resolution.
- Removing the Node egress preload under a scrubbed environment, with no provider keys and only owned local API/database endpoints, did not fix the failure.
- All 19 observed local JavaScript/CSS responses in the no-preload control returned 200. The stylesheet was loaded; React had no pending stylesheet commit.
- The React root retained pending/suspended transition lanes while the internal router URL had advanced. Reachable lazy Flight values were fulfilled or resolved-but-not-yet-demanded by four seconds. Ten observed WeakMap ping-cache wakeables were fulfilled by six seconds.

## Limits and next diagnostic

This is a verified local runtime qualification failure, not a proven production symptom or a diagnosed framework defect. Flight root fulfillment does not imply every future child render is complete. The WeakMap probe misses React's direct thenable subscription in renderRootConcurrent suspended reason 2/9 (installed compiled ReactDOM source around lines 11115 and 11898); the current work-in-progress thrown thenable may therefore remain unresolved even though all tracked ping-cache entries fulfilled. A focused next diagnostic should capture that exact thrown value/status/reason or its direct then-subscription stack.

The earlier persisted-record checks followed by manual reload did not verify automatic redirect settlement. They remain valid persistence observations but must not be described as successful complete UI completion. No speculative application fix was made. Keep automatic authenticated workflow completion unqualified until the failure is understood and the exact real workflow passes without manual reload.

## Evidence

- navigation-review.json: initial independent reproduction and sanitized action response headers, pending timing, persisted count.
- navigation-no-interception-review.json: true zero-route-registration proxy control and complete response EOF.
- navigation-decoder-review.json: early browser-only Flight decoder instrumentation.
- navigation-reducer-review.json: reducer/refresh completion and normal action redirect rejection.
- navigation-lazy-no-preload-review.json: Node-preload control, lazy status snapshots, and JS/CSS HTTP statuses.
- navigation-root-state-review.json: internal canonical URL versus React pending/suspended state and stylesheet status.
- navigation-suspension-review.json: narrowly tracked ping-cache thenable states and stacks; see explicit missed-class limitation above.

The accompanying .cjs files are temporary diagnostic reproductions and refer to a private local config path. They do not contain credentials. They deliberately reset only the selected synthetic account's password; they must not be run against other environments. They are not proposed application or CI changes.

## Test-driver continuation option

The only worktree edit from the diagnosis follow-up is `scripts/workspace-closeout-e2e.cjs`. The normal invocation remains fail-fast. Supply the trailing `--continue-after-navigation-failure` flag only to continue independent persisted/UI checks after the known client-navigation failure. Each action captures its actual Next-Action POST response, waits 20 seconds for automatic navigation, and records a failed check, pending state, UI text, and screenshot before any recovery. Recovery requires the captured 303 response's redirect to be the same app origin, under `/app/`, and to match the expected success/denial outcome. It performs a page navigation only; it does not resubmit the mutation. Missing, external, credential-bearing, unexpected, or non-303 redirects fail closed.

Every navigation failure remains in results and forces exit status 1, top-level passed false, and closeout_complete passed false. Later independent successes are annotated with the preceding navigation-failure count; manual recovery has its own explicit record. The harness also waits for the actual import action outcome and verifies exact metric dates plus CSV source/worksheet/row/metric lineage.

Qualification: syntax and targeted lint passed; 16 extracted-helper selftests passed (including independent execution of the actual manager/admin loop to validate label scope). These are harness selftests with fake page responses; they are not a new browser/Auth/database qualification. No build or full E2E was run after this helper edit. Helper SHA256 at handoff: `2e7db496a6854ae50ef00b10ef92903218c94012b9b12a1f7090459bc979af20`.
