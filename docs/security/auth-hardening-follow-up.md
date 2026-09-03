# Authentication Hardening Follow-up

## Current source posture

- Customer signup, invite acceptance, password reset, and password change require at least eight characters in both the UI and server actions.
- Authentication failures are returned with generic customer-facing messages; provider and database error text is not exposed.
- The OAuth callback accepts only normalized same-origin paths and falls back to `/app` for malformed or external destinations.
- Admin routes resolve the verified Supabase Auth user with `getUser()` and then require the server-side Vaeroex admin allowlist or `app_metadata.vaeroex_admin` flag. User-editable metadata is not used.
- There is no separate public administrator login route.
- Supabase SSR clients are created inside each request, use the PKCE cookie flow, and verify authorization identities with `getUser()` rather than trusting an unverified cookie payload.

## Session-security classification

Remote Production values were not inspected or changed during this source-only review.

| Control | Customers | Vaeroex administrators | Source assessment |
| --- | --- | --- | --- |
| Verified identity on protected requests | GOOD AS-IS | GOOD AS-IS | Protected routes use `getUser()` and authorization remains server-side. |
| Refresh-token rotation and reuse detection | GOOD AS-IS | GOOD AS-IS | Keep Supabase rotation and its recommended reuse interval enabled. Do not weaken replay detection. |
| Access-token lifetime | GOOD AS-IS if at most one hour | SHOULD HARDEN if longer than one hour | Confirm the remote value; Supabase recommends one hour for most applications and discourages less than five minutes. |
| Inactivity timeout | OPTIONAL | SHOULD HARDEN | Preserve customer usability; define a reviewed administrator inactivity window only after MFA and recovery UX exist. |
| Absolute session lifetime | OPTIONAL | SHOULD HARDEN | A time-box is useful for privileged sessions but is enforced on refresh, so allow for the JWT lifetime. |
| Single-session mode | OPTIONAL | OPTIONAL | It limits concurrent devices but can disrupt legitimate multi-device work. Treat it as a separate policy decision. |
| Sign-out scope | GOOD AS-IS | GOOD AS-IS | The current no-argument `signOut()` uses Supabase's global scope and revokes refresh tokens for all sessions. Existing access tokens remain valid until expiry. |
| Password-change invalidation | SHOULD HARDEN | SHOULD HARDEN | Verify the remote Auth behavior and test existing-device invalidation before promising immediate revocation. |
| MFA session downgrade | NOT APPLICABLE until MFA ships | SHOULD HARDEN | Refresh immediately after factor removal and require a fresh `aal2` session for privileged routes. |

## Production configuration review

These are remote Supabase Auth settings and are not changed by this branch:

1. In the Production project Auth settings, enable leaked-password protection. Supabase checks proposed passwords against the Have I Been Pwned password corpus; this requires a Pro plan or higher.
2. Keep a minimum password length of at least eight characters. Review a move to ten or twelve characters separately with customer-support and recovery UX before changing it globally.
3. Enable the strongest practical character requirement for newly created or changed passwords only after confirming existing-customer messaging. Existing accounts must not be silently locked out.
4. Enable current-password or recent-reauthentication checks for password changes only after the settings flow supplies the required current password or nonce.
5. Record the Production JWT lifetime, time-box, inactivity timeout, single-session setting, and refresh-token reuse interval. Session time-box and inactivity controls are enforced on refresh rather than by immediate revocation.

## Stale refresh-token warning

The previously observed `refresh_token_not_found` event is consistent with a browser presenting an old cookie after its single-use refresh token was rotated, revoked, or replaced by another tab. The application creates one SSR client per request and protected routes call `getUser()`, so an invalid token fails closed and cannot become an authenticated identity. Login remains the recovery path; genuine Auth errors are not suppressed.

The installed `@supabase/ssr` 0.7.0 still predates the package's lazy-initialization refresh-race correction. Moving to the current release is not a narrow patch: current releases require a much newer `@supabase/supabase-js` contract and add response-cache-header handling. Upgrade both packages together in a dedicated Preview-tested auth dependency change, including concurrent-tab, callback, recovery, sign-out, and CDN `Set-Cookie` cache tests.

## Vaeroex administrator MFA

TOTP MFA with an `aal2` requirement is the recommended administrator posture. Enabling it safely requires all of the following as one reviewed feature:

- enrollment, recovery, challenge, and lost-device UX;
- a server-side `aal2` check before rendering or mutating `/app/admin`;
- restrictive database policies or equivalent checks for any admin operation reachable without the application server;
- a break-glass procedure with audited access;
- validation that existing administrators can enroll before enforcement.

The repository does not yet provide that complete flow, so this branch does not add a partial AAL check that could lock out administrators or create an alternate bypass. Ordinary customer MFA remains optional unless a separate product decision changes that policy.

Safe rollout order:

1. Add TOTP enrollment, factor management, challenge, recovery-code or audited support recovery, and lost-device UX.
2. Enroll every current Vaeroex administrator and verify at least one tested break-glass identity.
3. Require `aal2` in the shared server-side admin guard and privileged Server Actions; do not rely only on a client redirect.
4. Add matching database or API enforcement anywhere an administrative mutation is reachable without that guard.
5. Verify factor removal downgrades the session immediately after refresh, then enable the remote MFA policy.
