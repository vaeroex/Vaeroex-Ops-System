# QuickBooks customer connection repair

## Observed incident

The live owner Settings page showed four unconsented QuickBooks attempts as
`Syncing`. A controlled fifth submission reproduced the lack of navigation.
Production request metadata recorded five `/api/integrations/qbo/connect` responses
with HTTP 303. The browser remained on Settings.

The deployed enforced Content Security Policy allows form submissions only to
the application and Stripe. The old native POST redirected that form to Intuit,
which is not a permitted form-action destination. A focused Chromium regression
using the actual `next.config.mjs` policy reproduces the blocked redirect and
observes the form-action violation. No Intuit request leaves that test.

The previous release's offline 303 assertion did not exercise browser CSP. Its
claim of readiness did not establish a working live OAuth handoff.

## Scoped correction

- Keep CSP unchanged. Hydrated Connect/Reconnect controls POST same-origin JSON
  requests, accept only the exact canonical Intuit authorization URL shape, and
  explicitly navigate the current browser tab. Show immediate loading and bounded
  errors. Reject native OAuth form submissions before any intent mutation.
- Create the pending connection and hashed OAuth state in one transaction.
  Serialize repeated attempts for the same workspace, entity, Production QBO
  provider, normalized connection name and accounting scope. Return a pending
  conflict without generating another persisted state. Distinct named connections
  and entities remain independent; cancellation allows a fresh attempt.
- Add owner-only, CAS-fenced cancellation for provably never-consented attempts.
  Expire outstanding state and preserve connection and immutable audit history.
  Deny cancellation after consumption, exchange, credentials, mapping or effects.
- Label pending authorization truthfully. Move provider cards to workspace
  Integrations and put QuickBooks connection details on its management page.

## Read-only Production evidence before remediation

The four user attempts and the one diagnostic attempt all had:

- `pending_authorization`, generation 1, no authorization timestamp or realm claim;
- zero credentials, mappings, tasks and provider source records;
- one pending OAuth state and one pending session-binding row each;
- zero consumed states and no exchanging/stored/completed authorization outcome.

No consent, token exchange, QBO accounting read or model call was performed.
Raw state, authorization URL, realm values and credentials are excluded from this
record. Production cancellation must recheck these predicates at mutation time.

## Release boundary

Focused candidate qualification passed: 79 OAuth completion assertions, 246
Production static assertions, 326 candidate-runner assertions, 28 native database
scenarios across both migration layouts, 9 pending-attempt helper/route tests,
12 Integrations UI regressions, TypeScript, targeted ESLint and whitespace checks.
Browser fixtures exercised the actual hydrated OAuth form with the deployed CSP
on desktop/mobile and the Integrations layout at 1440/390/320px. These are synthetic
checks, not evidence of a repaired deployed browser flow. Native cancellation and
duplicate-start concurrency are also registered in hosted `security-database`.

Independent review identified an unfinished error-attempt cancellation gap. The
UI now offers cancellation for pending attempts and error attempts without granted
scopes; the database independently proves lack of consent/effects before mutation.
React review retained server-side tenant reads, minimal client forms, cleaned-up
event listeners, synchronous submission locks, accessible status/error messages,
and hydration-safe disabled OAuth submission.

This record describes a candidate, not a completed deployment. Before release:
require focused regressions, real PostgreSQL concurrency/cancellation qualification,
normal exact-head hosted checks, migration dry-run/application and protected merge.
Then verify the actual signed-in desktop/mobile flow reaches legitimate Intuit
sign-in, stop before company selection/consent, and cancel only confirmed unfinished
attempts through the reviewed owner operation. Real-company import, refresh and
accounting-to-Intelligence verification remain pending an authorized company.
