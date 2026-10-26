# Protected citation reopening: diagnostic boundary

## Supported finding

The zero-model-call hosted inspection reached `Source unavailable` for both a Xero citation and a Google Sheets citation. Neither displayed protected source content. The generic response is rendered only after target validation and active-owner/workspace checks, inside the catch around `reopenSharedCitation`. The prior response did not preserve a content-free failure category, and the available runtime logs were empty. It is not possible to identify a timeout, SQL rejection, or returned-data validation error retrospectively.

Both links name one saved VSI exchange and differ only in their fragment. The fragment is not sent to the server. `reopen_shared_evidence_target_v1` resolves the immutable target/revision and `reopen_shared_evidence_artifact_v1` revalidates every manifest source. The retained bundle had six originals (five Sheets and one Xero), while the answer cited three. A changed or unavailable uncited original can therefore deny the entire page. This dependency protection remains unchanged.

The local review found no mismatch in RPC names, named arguments, saved target IDs, response envelope, or exchange revision hashing. Reopening requires the current authenticated owner session and original VSI actor; it does not require reuse of the generation session. Source hashes include authority and import/coverage metadata, so matching displayed numbers alone would not establish an unchanged source. No retained evidence proves that refresh, revocation, or a changed hash caused this hosted failure.

## Local change

The protected page now logs one `[shared-citation]` event on reopen failure. The event has exactly six fields: `stage`, `category`, `reason`, `elapsedMs`, `sqlCode`, and `httpStatus`. Stages/reasons/codes/statuses are closed allowlists; elapsed time is a bounded integer. Module-issued diagnostics are held in a private WeakMap so replacing or forging an Error property cannot insert data into logs. Unknown exceptions become a fixed `unexpected_failure` event.

No request, actor/workspace/source ID, hash, token, URL, raw SQL error message/details/hint, source body, model answer, or raw exception is logged. Exact known SQL sentinels are mapped internally to fixed categories. Unknown SQLSTATE 40001 is not automatically called a stale binding. SQLSTATE 57014 is cancellation, not proof of a timeout. The branch combining artifact integrity and readability is labeled revalidation failure, not proof that eligibility changed.

Categories distinguish authorization, immutable target/source lookup, changed source binding, eligibility, local deadline, database cancellation, transport, RPC contract availability, database failure, reconstruction budget, response envelope, and projection validation. A local deadline is marked before abort so synchronous abort rejection or resolution cannot mislabel it as a transport failure. The existing ten-second limit and abort cleanup remain intact. The timer covers the protected RPC, not the route's earlier authentication/layout work.

The unavailable UI, exact revision/target checks, workspace validation, inherited-proof filtering, memory eligibility validation, private-field removal, current authorization/revocation checks, and absence of retries are unchanged. No SQL, source records, saved answers, gates, provider routes, or accounting behavior changes.

This is an observability correction, **not a proven functional retrieval fix**. No predicate was relaxed to turn an unknown rejection into success.

## Local qualification

- `shared-evidence-citation-diagnostics-tests.cjs`: 68 closed diagnostic boundary checks, including private-marker rejection, forged/replaced error properties, coercible non-string reasons, exact SQL-sentinel matching, malformed envelopes/projections, and synchronous abort races.
- `shared-evidence-citation-ssr-tests.cjs`: actual `Exchange` links → actual protected page/guards → actual cookie-backed Supabase SSR and PostgREST clients → intercepted synthetic HTTP responses. Six originals and three cited links; single/chunked cookies; refresh with read-only Server Component cookies; 22 rejected route invocations; two stalled invocations; successful timer cleanup. One unavailable uncited original denies both provider anchors without a fragment-only fallback. Saved fixture data remains unchanged.
- Existing `shared-evidence-citation-page-tests.cjs`: owner/session/workspace/subscription/gate negatives, revoked/malformed inputs, both authorized provider sections and ten-second liveness.
- Existing `shared-evidence-citation-reopen-tests.cjs` and `vsi-citation-links-tests.cjs` pass.
- TypeScript passes. Focused ESLint has no errors and the two pre-existing `_eligibility`/`_roots` unused-variable warnings.

The SSR regression uses only synthetic cookies/tokens and intercepted HTTP. It executes no SQL, launches no browser, contacts no external service, and makes no model calls. Its synthetic revalidation response contract is not proof of live SQL enforcement, source eligibility, or the precise hosted rejection. Local successes cannot replace the failed hosted content acceptance.

## Remaining acceptance boundary

The exact hosted failure remains unknown until a separately approved deployment and zero-model-call citation read can observe the new closed diagnostic category. Any resulting fix must preserve the full saved dependency set and current authorization. Do not issue another model question to diagnose this read path. Date-alignment quality is a separate unresolved issue; this change neither regenerates nor edits the retained answer.
