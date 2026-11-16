# Vaeroex system catalog and account access

This follow-up is stacked on PR #573. Preview review and green CI are required before merge/release. Hosting, Supabase projects, sessions and billing remain in the same application; no migration or customer data change is required.

## Current architecture and preserved checks

Password login calls Supabase signInWithPassword. When configured, AuthTurnstile submits captcha_token; server actions require a bounded token and pass it as captchaToken to Supabase Auth, which validates it with Cloudflare. Do not replace that check with client success state. PKCE callback retains exchangeCodeForSession. Reset initiation and session-bound password update are unchanged. General signup creates an account; it does not purchase, assign a system or bypass workspace setup.

The safe-relative redirect validator retains all existing rejection rules. Its default is now /access. An explicit safe next, including product pages, checkout/legal, invited setup and recovery paths, is preserved. /access verifies identity with getUser and selects /app/intelligence for one accessible system or /systems for zero/multiple. /systems also verifies identity. Middleware refresh/no-store coverage includes both new routes; existing action/pre-auth exceptions and refresh-conflict behavior remain.

The system catalog sits outside /app's product layout so an account without a subscription or current product policy acceptance can see its own access state and options. This grants no product access. Every product destination still rechecks membership/subscription and its layout retains LegalAcceptanceGate. APIs/RPCs retain their own checks. The catalog's server-only resolver uses active RLS-scoped memberships and the exact existing getSubscriptionStatus implementation, including Stripe expiry/IDs and manual/trial rules. It does not trust workspace display labels or user_metadata.

Workspace context remains distinct. Multiple workspaces do not count as multiple systems. Existing vaeroex_workspace_id is retained. If the selected workspace is blocked while another is accessible, /systems offers explicit selection rather than silently changing context. Existing selectWorkspaceAction validates active membership and demo restrictions before setting its HTTP-only cookie; destination subscription/policy gates then run. An entitled account without a workspace sees the existing setup flow, never an automatic workspace or assignment.

Your Systems is reachable from authenticated public navigation and both desktop/mobile workspace navigation, including while policy review is displayed. Native account/system links retain any browser beforeunload protections. No new unsaved-work bypass is introduced. Only Executive Intelligence is currently launchable, so no live Switch system menu is shown. The shared switch control is exercised with isolated multiple-system fixtures; no fictional production system or access assignment is added.

## Registering a future system

1. Add its descriptive definition to lib/systems/catalog.ts. Development entries have no launch route or activation/purchase action. The public Intelligence Systems page reuses these research descriptions. Do not add it to public commerce until actually available.
2. When released, add an explicit server-only access resolver in lib/systems/access.ts, with the real destination and authoritative customer/workspace/role/entitlement evidence. Unknown systems get no decision and cannot become accessible by catalog edits alone. Update the catalog action rendering to match that system's actual access/setup flow; it currently intentionally handles only Executive Intelligence.
3. Assign customer access through the system's reviewed authoritative membership/entitlement administration. Executive Intelligence continues to use existing active workspace memberships and verified subscription/manual activation; do not insert catalog assignments, self-assign through signup, or infer rights from user metadata. Introduce new assignment storage only with a reviewed RLS/authorization design when needed.
4. Add zero/one/multiple and revocation tests for the resolver and destination. The generic accessibleSystemLinks/defaultSystemDestination functions count only available, authorized server decisions. The app layout loads switch decisions only when the catalog has multiple available systems; no extra entitlement queries are added to existing app requests today.
5. Within this app, destinations use the existing cookie session and independently recheck authorization. Preserve per-system workspace cookies if another system introduces its own context. Native links do not intercept unsaved-work controls.

## Future independent application authentication

An independently hosted application does not automatically share this session. Define an identity trust boundary and supported OAuth/OIDC Authorization Code flow with PKCE, exact callback allowlists, state/nonce checks and server-side token validation before integration. Map stable identities to destination-owned memberships/roles, recheck access there, and use secure host-scoped cookies. Never place session credentials in query strings, copy Supabase access/refresh tokens between URLs, or assume a shared company domain grants tenant access. Billing/callback URLs and rollback require their own reviewed integration plan. No cross-app SSO mechanism is introduced here.

## Verification boundaries

scripts/system-access-tests.cjs runs actual auth actions, PKCE callback, workspace context, subscription resolver, system resolver/routing and catalog rendering with synthetic SDK/database responses; it sends no network/email and changes no hosted records. Cases cover active/expired/invalid Stripe, manual flags vs authoritative activation, trials, foreign/inactive memberships, demo exclusion, database failure, preferred workspace handling, forged workspace selection and zero/one/multiple routing. Multiple-system examples exist only inside this test. The component fixtures also verify three matching cards and noninteractive development entries.

Live Preview public navigation, login branding, recovery links and unauthenticated catalog boundary are inspected separately. No claim of hosted signed-in login, actual Cloudflare completion, recovery email receipt, customer billing, or hosted multiple-system access follows from those mocked checks.
