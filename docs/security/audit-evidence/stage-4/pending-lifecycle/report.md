# Internal form pending-state follow-up

The hosted workflow fixture timeout was not solely a 200 ms response-timer race. An explicit held response reproduced the real PendingSubmitButton becoming enabled while its request remained unresolved, including single-click controls. The same result occurred using the Next App Router compiled React client runtime. In the saved parity trace, both native form fiber states remained pending while the child button read false. The observed trace is consistent with the form-context bailout/child-render behavior in the installed React implementation; it does not prove a deployed backend failure.

Evidence: `before/next-runtime-failure.json`, `before/request-timeline-failure.json`, and `before/single-click-failure.json`. Application source stayed unchanged until the root authorized the scoped correction.

## Correction

InternalFormSubmissionForm now obtains pending state from useActionState tied to the submitted action promise. A thin `use server` adapter delegates the exact FormData to the original authenticated createFormSubmissionAction, awaits it, and forwards errors/redirects without a catch. The server reference preserves progressive-posting structure; an authenticated no-JavaScript post was not executed. PrimaryButton/PendingSubmitButton accept an optional authoritative pending value. Undefined preserves existing callers, native validation, and the immediate capture lock.

The browser fixture uses Next's compiled client React aliases and explicitly gates each response. It asserts pending/disabled after two render frames, blocks same-turn and later duplicate attempts, verifies one request and completion/unlock, and releases responses explicitly. Thirty-second gate deadlines are failure/cleanup bounds, not successful response timing. A synthetic 503 is caught by a fixture-only error boundary: no automatic retry occurs, and an explicit reset/remount followed by a new intentional submission succeeds. This does not qualify real Next redirects or backend-error input retention.

## Verification

- Two final actual Chrome runs each passed all 36 existing scenario groups (light/pulsar at desktop/mobile), with zero unexpected browser errors. Each run made six fixture POSTs: the four normal successes, one intentional synthetic failure, and one explicit recovery submission.
- Nine interaction-feedback tests passed, including authoritative pending surviving false host context and untouched undefined behavior for existing callers.
- Thirty-six workflow contracts passed, including the two new actual server-adapter delegation/await/error/redirect checks.
- Targeted lint and full typecheck passed.

Logs and source hashes are recorded in `verification.json`. Browser evidence is in `browser/run-{1,2}` and `logs/browser-run-{1,2}.log`.

## Remaining limits

This is a partial VXA-028 correction for the changed internal-form flow and supports VXA-008. Other generic forms keep their previous pending behavior. Server-side idempotency, real authenticated end-to-end persistence, and backend-error input retention remain unqualified/open. No production data, provider service, merge, or deployment was involved. The original authenticated server action and its policy were not edited.
