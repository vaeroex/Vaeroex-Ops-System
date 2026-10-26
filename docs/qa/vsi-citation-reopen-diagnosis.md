# Protected citation reopening: diagnostic boundary

## Supported finding

The initial zero-model-call hosted inspection reached `Source unavailable` for both a Xero citation and a Google Sheets citation. Neither displayed protected source content. The generic response is rendered only after target validation and active-owner/workspace checks, inside the catch around `reopenSharedCitation`. That response did not preserve a content-free failure category, and the available runtime logs were empty. Its precise cause cannot be recovered retrospectively.

The approved diagnostics inspection on 2026-10-26 reproduced both unavailable pages. Both emitted `stage: rpc_read`, `category: timeout`, `reason: read_deadline_exceeded`, `elapsedMs: 10001`, with null SQL code and HTTP status. No protected source section rendered. This establishes that the application deadline fired before the client returned a completed RPC result; it does not establish that the request reached PostgreSQL, that authorization failed, or that a database lock caused the wait.

The inspected activation artifact was `8f75128419c0934f698a219b41cab912dd4d6d9c`. Production was independently verified restored to gates-off release `1e7afb66fce94f7a67d8228d77783fcf125db854` at 05:33:26.624 UTC, within the approved window. The saved answer reopened with its 16 paragraphs unchanged. No question was submitted and no model call occurred.

Both links name one saved VSI exchange and differ only in their fragment. The fragment is not sent to the server. `reopen_shared_evidence_target_v1` resolves the immutable target/revision and `reopen_shared_evidence_artifact_v1` revalidates every manifest source. The retained bundle had six originals (five Sheets and one Xero), while the answer cited three. A changed or unavailable uncited original can therefore deny the entire page. This dependency protection remains unchanged.

The local review found no mismatch in RPC names, named arguments, saved target IDs, response envelope, or exchange revision hashing. Reopening requires the current authenticated owner session and original VSI actor; it does not require reuse of the generation session. Source hashes include authority and import/coverage metadata, so matching displayed numbers alone would not establish an unchanged source. No retained evidence proves that refresh, revocation, or a changed hash caused this hosted failure.

## Local change

The protected page now logs one `[shared-citation]` event on reopen failure. The event has exactly six fields: `stage`, `category`, `reason`, `elapsedMs`, `sqlCode`, and `httpStatus`. Stages/reasons/codes/statuses are closed allowlists; elapsed time is a bounded integer. Module-issued diagnostics are held in a private WeakMap so replacing or forging an Error property cannot insert data into logs. Unknown exceptions become a fixed `unexpected_failure` event.

No request, actor/workspace/source ID, hash, token, URL, raw SQL error message/details/hint, source body, model answer, or raw exception is logged. Exact known SQL sentinels are mapped internally to fixed categories. Unknown SQLSTATE 40001 is not automatically called a stale binding. SQLSTATE 57014 is cancellation, not proof of a timeout. The branch combining artifact integrity and readability is labeled revalidation failure, not proof that eligibility changed.

Categories distinguish authorization, immutable target/source lookup, changed source binding, eligibility, local deadline, database cancellation, transport, RPC contract availability, database failure, reconstruction budget, response envelope, and projection validation. A local deadline is marked before abort so synchronous abort rejection or resolution cannot mislabel it as a transport failure. The existing ten-second limit and abort cleanup remain intact. The timer covers the protected client's RPC operation, including token acquisition before dispatch and response-body reading after headers, not the route's earlier authentication/layout work. The RPC abort signal does not cancel an auth-client token refresh.

The unavailable UI, exact revision/target checks, workspace validation, inherited-proof filtering, memory eligibility validation, private-field removal, current authorization/revocation checks, and absence of retries are unchanged. No SQL, source records, saved answers, gates, provider routes, or accounting behavior changes.

This is an observability correction, **not a proven functional retrieval fix**. No predicate was relaxed to turn an unknown rejection into success.

## Local qualification

- `shared-evidence-citation-diagnostics-tests.cjs`: 68 closed diagnostic boundary checks, including private-marker rejection, forged/replaced error properties, coercible non-string reasons, exact SQL-sentinel matching, malformed envelopes/projections, and synchronous abort races.
- `shared-evidence-citation-ssr-tests.cjs`: actual `Exchange` links → actual protected page/guards → actual cookie-backed Supabase SSR and PostgREST clients → intercepted synthetic HTTP responses. Six originals and three cited links; single/chunked cookies; refresh with read-only Server Component cookies; 22 rejected route invocations; four stalled invocations; successful timer cleanup. The two added counterexamples reproduce the observed deadline category with zero RPC dispatch during a token-refresh wait, and after receipt of HTTP 200 headers while the body remains incomplete. They demonstrate diagnostic ambiguity, not the hosted cause. One unavailable uncited original denies both provider anchors without a fragment-only fallback. Saved fixture data remains unchanged.
- Existing `shared-evidence-citation-page-tests.cjs`: owner/session/workspace/subscription/gate negatives, revoked/malformed inputs, both authorized provider sections and ten-second liveness.
- Existing `shared-evidence-citation-reopen-tests.cjs` and `vsi-citation-links-tests.cjs` pass.
- TypeScript passes. Focused ESLint has no errors and the two pre-existing `_eligibility`/`_roots` unused-variable warnings.

The SSR regression uses only synthetic cookies/tokens and intercepted HTTP. It executes no SQL, launches no browser, contacts no external service, and makes no model calls. Its synthetic revalidation response contract is not proof of live SQL enforcement, source eligibility, or the precise hosted rejection. Local successes cannot replace the failed hosted content acceptance.

## Remaining acceptance boundary

The application timeout category is now known; the waiting layer remains unknown. The next useful evidence is narrowly scoped, read-only request metadata for the two recorded requests: whether the authenticated RPC reached the database service, its duration and returned status. Do not retrieve headers, tokens, SQL bodies, source contents or model text. If retained metadata cannot establish this boundary, report that limit before proposing additional instrumentation or hosted inspection.

Local SQL review found a possible wait in the existing owner helper's `FOR SHARE` locks, but no retained evidence links that mechanism to these requests. Full-manifest reconstruction also remains intentional. Neither the locks nor dependency checks should be bypassed, and increasing the deadline would not diagnose the failure.

The first follow-up (`3c4e04c0`) contained only the two offline counterexamples and this documentation. The bounded Supabase edge-log check then returned zero matching `reopen_shared_evidence_*` entries in 05:32:15–05:33:18 UTC. It established neither complete log coverage nor whether a later completion was recorded outside that window. No status/duration was available for the citation RPCs. No database fix follows from that absence.

## Local transport-stage candidate

The next local diagnostic observes only the existing citation client's call path. An optional request-local trace passes through the unchanged owner/workspace guards into that client's construction; all other callers retain their default client. The trace arms at protected reopen entry, after the route guards. The separate workspace-lookup client and earlier guard authentication remain outside its measurements.

The supported SDK `global.fetch` hook records invocation, receipt of response headers, and the SDK's existing `text()` or `json()` read beginning/settling. It never clones, tees, eagerly reads or parses a body. Bound Response methods preserve their native receiver. A wrapper on the public `auth.getSession` method calls the original once and returns its original promise; settlement observers do not inspect its result or error. This distinguishes an observed pending session call from a fetch wait, without asserting token validity or a reason for session waiting. No authentication call is added.

One terminal `[shared-citation-transport]` record contains only `outcome`, last observed `phase`, bounded `elapsedMs`, a fixed set of milestone durations, and HTTP status classes for RPC/refresh responses. No request URL/query, headers, token, session object, source/actor/workspace identifier, body, error text or model text enters this record. Private per-instance state and frozen final snapshots prevent late responses or abort callbacks from rewriting the deadline evidence. The original six-field `[shared-citation]` failure record is unchanged.

Interpretation must remain literal:

| Last milestone at deadline | What it establishes |
| --- | --- |
| `session_call_pending` | The observed public session call has not settled; no reason for that wait is established. |
| `refresh_fetch_invoked` | The configured fetch function was invoked for refresh; not proof of socket dispatch or server receipt. |
| `rpc_fetch_invoked` | The configured fetch function was invoked for the RPC; response headers have not returned through it. |
| `rpc_body_read` | Response headers arrived and the SDK began reading the body; that read has not settled. |
| `rpc_body_complete` | The existing body read settled; this does not imply JSON validity, authorization or successful projection validation. |
| `client_complete` | The SDK returned a result; the separate diagnostic still determines whether it was rejected. |

Local verification preserves the 68 existing diagnostic boundary checks and adds 16 trace boundaries for passthrough identity, unchanged promise/result/error, no eager body reads, unobserved guard operations, unmatched endpoints, private-marker exclusion and concurrent-request isolation. The actual SSR suite covers 22 rejected reads, four stalled reads, 32 transport-trace assertions and four frozen deadline assertions. It exercises the real session refresh path with synthetic cookies crossing the installed SDK's expiry margin, without an external service. No fixture result establishes the hosted root cause or functioning hosted retrieval.

The observer is specific to the pinned SDK path: its `getSession`, `text()` and `json()` boundaries must be requalified on dependency changes. It does not measure earlier route/layout/auth guards, socket internals, PostgreSQL execution, or reads made through an unobserved cloned response. No limit, permission, saved dependency, retry policy or user-visible unavailable behavior is relaxed.

## Next bounded inspection proposal

Publish this diagnostics-only candidate with automatic deployment held, obtain fresh required Linux/CI checks and exact-tree review, then deploy gates off only after success. Qualify a separate temporary three-gate activation artifact and verify the current gates-off restoration target before activation. With the correct existing owner session, open the existing saved answer's Xero and Sheets citations once each, observing actual protected content or both closed diagnostic records. No new question or model request is needed.

Use the same maximum 20-minute global activation window, with an early restoration backstop; restore all three gates off even on success or an inconclusive result. Preserve the saved answer and current isolation/revocation checks. No new secrets, permissions, SQL, imports or generation are part of this proposal. Publication, deployment and the next hosted activation require separate approval; this local work has performed none.

Any functional fix must preserve the full saved dependency set and current authorization. Date-alignment quality remains a separate unresolved issue; this work neither regenerates nor edits the retained answer.
