# Workspace session refresh persistence

This local candidate repairs cookie propagation for workspace GET/HEAD requests.
It is not proof of the cause of the observed hosted sign-in redirect, a citation
retrieval fix, or a correction to generated date-alignment claims.

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

The 29 actual-SDK cases passed locally, alongside the existing security suite,
citation SSR/page/diagnostic and workspace guard regressions, TypeScript and
focused lint. Independent review found no remaining blocking code issue.

The HTTP fixture and full build require a working installed native Next compiler.
They were blocked locally by the bundled macOS Node process rejecting the installed
SWC library's signing identity. Signing controls were not changed and no compiler
was installed. Fresh Linux CI must pass both before a release is considered.

Concurrent requests for the same session remain subject to Supabase's refresh
rotation/reuse rules. There is no global refresh lock, token cache or shared client.
Tests simulate both permitted reuse and provider rejection; they do not prove the
hosted provider's policy or the discarded Auth error.

This adds an Auth verification to matched GET/HEAD navigation, including RSC and
prefetch requests, before the existing guards verify again. It can add latency;
it deliberately does not replace those guards or cache a trusted identity. A
transient returned Auth error still follows the existing guard's denial behavior.

## Next release boundary

Publish only with an automatic-deployment hold, review the exact tree, and require
fresh Linux build/security/session checks before merge or deployment. Any release
should initially keep all three reasoning switches OFF. First verify a fresh owner
workspace session and persistence across a real refresh boundary with safe status
metadata only. A later explicitly approved citation inspection may temporarily
activate for at most 20 minutes with verified OFF restoration and zero model calls.
No new credentials, permissions, SQL, imports or saved-answer edits are needed.

References: [Supabase SSR setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework),
[Supabase session semantics](https://supabase.com/docs/guides/auth/sessions).
