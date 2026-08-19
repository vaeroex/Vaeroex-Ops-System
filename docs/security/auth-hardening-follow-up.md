# Authentication Hardening Follow-up

## Current source posture

- Customer signup, invite acceptance, password reset, and password change require at least eight characters in both the UI and server actions.
- Authentication failures are returned with generic customer-facing messages; provider and database error text is not exposed.
- The OAuth callback accepts only normalized same-origin paths and falls back to `/app` for malformed or external destinations.
- Admin routes resolve the verified Supabase Auth user with `getUser()` and then require the server-side Vaeroex admin allowlist or `app_metadata.vaeroex_admin` flag. User-editable metadata is not used.
- There is no separate public administrator login route.

## Production configuration review

These are remote Supabase Auth settings and are not changed by this branch:

1. In the Production project Auth settings, enable leaked-password protection. Supabase checks proposed passwords against the Have I Been Pwned password corpus; this requires a Pro plan or higher.
2. Keep a minimum password length of at least eight characters. Review a move to ten or twelve characters separately with customer-support and recovery UX before changing it globally.
3. Enable the strongest practical character requirement for newly created or changed passwords only after confirming existing-customer messaging. Existing accounts must not be silently locked out.
4. Enable current-password or recent-reauthentication checks for password changes only after the settings flow supplies the required current password or nonce.
5. Record the Production JWT lifetime, time-box, inactivity timeout, and single-session setting. Supabase refresh tokens are single-use; session time-box and inactivity controls are enforced on refresh rather than by immediate revocation.

## Vaeroex administrator MFA

TOTP MFA with an `aal2` requirement is the recommended administrator posture. Enabling it safely requires all of the following as one reviewed feature:

- enrollment, recovery, challenge, and lost-device UX;
- a server-side `aal2` check before rendering or mutating `/app/admin`;
- restrictive database policies or equivalent checks for any admin operation reachable without the application server;
- a break-glass procedure with audited access;
- validation that existing administrators can enroll before enforcement.

The repository does not yet provide that complete flow, so this branch does not add a partial AAL check that could lock out administrators or create an alternate bypass. Ordinary customer MFA remains optional unless a separate product decision changes that policy.
