# Workspace session refresh persistence

Workspace GET/HEAD middleware persists refresh cookies before Server Components.
The local conflict-handling correction below additionally denies a known refresh
conflict without persisting the installed SDK's session deletion. It is not a fix
for the underlying provider conflict, protected citation retrieval, or generated
date-alignment claims.

## Request boundary

Next.js 15 uses `middleware.ts`. A new Supabase SSR client is created per request,
and `getUser()` runs before rendering. SDK cookie batches update both the request
seen by Server Components and the response delivered to the browser. Earlier
batches and chunk deletions are retained with the SDK's original cookie options.
No cookie-domain, lifetime, SameSite, HttpOnly or Secure policy is changed.

This is refresh transport, not an authorization shortcut. Existing page, action,
membership, subscription, session, revocation, RLS and evidence checks remain in
place. No user identity or authorization result is passed in a trusted header.
Matched responses are private/no-store; Next's existing Vary is not replaced.
Unexpected exceptions return a generic 503 with pending SDK cookies, without raw
errors or request headers. Ordinary invalid-session outcomes still reach the
existing authentication guards.

## Refresh conflict boundary

The installed Auth SDK treats HTTP `409` / `conflict` as non-retryable and removes
its session. The SSR adapter translates that removal into cookie deletions. A
provider conflict does not establish that the session was revoked.

Only when this request's actual fetch observes a POST to the configured Auth
origin and exact `/auth/v1/token` path, with a single `grant_type=refresh_token`
and HTTP 409, **and** `getUser()` returns the SDK's `AuthApiError` with status 409
and code `conflict`, middleware returns a new generic 503 response. It is private
and no-store, has no `Set-Cookie` or internal middleware forwarding headers, and
does not render the page. No unverified identity is accepted. No body, token or
raw error is inspected or logged by the transport observation.

The error response sends neither deletion cookies nor copies of the incoming
cookies. Reissuing the old cookies could overwrite a concurrent successful
refresh. A browser keeps whatever cookie state it currently has; a subsequent
independently initiated request must verify through Auth again. There is no
automatic refresh retry, backoff loop, global lock, shared client or token cache.
This avoids adding more concurrent refresh traffic without evidence that an
automatic retry policy would be safe. Persistent conflict remains unavailable.

Wrong status/code, a non-refresh request and genuine invalid, expired or revoked
session errors retain existing SDK cleanup and guard denial. Preserving a cookie
on a conflict never makes that cookie authoritative or revives a revoked session.
Provider rotation/reuse decisions remain authoritative on every later request.

The matcher is `/app/:path*`. POST Server Actions retain their writable cookie
handling, including sign-out. APIs, OAuth callbacks and other SSR pages are outside
this repair. Two intentional pre-authentication paths are excluded: the payment
return query-scrubbing route and the separate Square connection subtree, whose
availability/host gates run before authentication. Their existing behavior stays
unchanged. This is not a global SSR session fix.

## Qualification

`pnpm test:session-refresh` runs synthetic-only tests using the installed SDK and
Next primitives, plus an isolated loopback Next HTTP fixture that copies the actual
middleware/server helper/auth guard. It checks consecutive requests, request and
response cookie propagation, redirects, invalid/revoked sessions, concurrency,
chunk cleanup, cache controls and cross-user isolation. It has no production
configuration, real credentials, model calls or provider network access.

The original propagation release passed 29 actual-SDK cases and five real Next
HTTP cases in Linux CI. The conflict correction expands these suites to cover
the valid-access-then-refresh-conflict sequence, no-cookie 503 denial, independent
recovery, nonmatching errors, and mixed concurrent responses applied to one
browser cookie jar in both response orders. Earlier passing receipts do not
qualify the changed tree.

The expanded actual-SDK suite passed all 53 cases locally (29 retained, 24 added),
with zero external calls. TypeScript, focused lint, the security checker and
adversarial/high/medium/CAPTCHA regressions also passed. These validate local
mechanics, not hosted conflict recovery or successful browser cookie delivery.

The HTTP fixture and full build require a working installed native Next compiler.
The changed HTTP fixture remains blocked locally by the bundled macOS Node process
rejecting the installed SWC library's signing identity. No changed HTTP cases ran
on that attempt. Signing controls were not changed and no compiler was installed.
Fresh Linux CI must pass the changed HTTP suite and production build before release.

Concurrent requests for the same session remain subject to Supabase's refresh
rotation/reuse rules. There is no global refresh lock, token cache or shared client.
Tests simulate both permitted reuse and provider rejection; they do not prove a
particular hosted refresh policy, request correlation or resource-conflict cause.

This adds an Auth verification to matched GET/HEAD navigation, including RSC and
prefetch requests, before the existing guards verify again. It can add latency;
it deliberately does not replace those guards or cache a trusted identity. A
returned Auth error outside the exact refresh-conflict condition still follows
the existing guard's denial behavior.

Safe hosted metadata showed an Auth refresh `409 conflict` at 18:23:24 UTC on
2026-10-26, during the failed Settings navigation, and Settings middleware log
records in that window. This supports the reproduced SDK deletion mechanism but
does not establish the exact owner/request pairing or cause of the conflict.
The prior valid access-token check did not validate the refresh token. Neither
pre-existing token invalidity nor a successful-cookie delivery defect was proved.

## Next release boundary

Publish only with an automatic-deployment hold, review the exact tree, and require
fresh Linux build/security/session checks before merge or deployment. Any release
should initially keep all three reasoning switches OFF. First verify a fresh owner
workspace session and persistence across a real refresh boundary with safe status
metadata only. A later explicitly approved citation inspection may temporarily
activate for at most 20 minutes with verified OFF restoration and zero model calls.
No new credentials, permissions, SQL, imports or saved-answer edits are needed.

References: [Supabase SSR setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework),
[Supabase session semantics](https://supabase.com/docs/guides/auth/sessions),
[Supabase Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes).
