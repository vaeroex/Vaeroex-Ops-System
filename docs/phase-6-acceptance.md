# Phase 6 Acceptance Review

Phase 6 originally added Squarespace subscription access for Vaeroex Ops System. The later Stripe billing migration supersedes Squarespace for new customer checkout while preserving Squarespace and manual records for legacy/admin support. The Vaeroex app controls account access, workspace creation, usage limits, and manual activation.

## Source-Verified Acceptance Criteria

- App has subscription tables: `subscription_plans`, `customer_subscriptions`, `subscription_events`, `ai_usage`, and `manual_activation_requests`.
- App has workspace subscription fields: `subscription_status`, `plan_slug`, `subscription_required`, `trial_ends_at`, and `manually_unlocked`.
- App seeds and migrates to the single Vaeroex plan.
- App can manually activate a customer through `/app/admin/subscriptions`.
- App can block users without active subscriptions through `requireActiveSubscription` and setup/action gates.
- App can allow demo workspaces, manually unlocked workspaces, active workspaces, and valid trials.
- App has `/billing-required` with the required subscription message and purchase/manual activation actions.
- App has `/app/account/subscription` with subscription status, plan, access state, and usage.
- App has `/app/admin/subscriptions` with search, manual activation, status changes, Vaeroex plan assignment, notes, activation request review, event review, and raw payload display.
- App has `/api/squarespace/webhook` for Squarespace order events.
- App stores Squarespace events in `subscription_events`.
- App maps Squarespace product names, product IDs, and SKUs to the single internal `vaeroex` plan.
- App has usage limits for workspaces, users, and monthly Vaeroex runs.
- App has Squarespace setup documentation in `docs/squarespace-subscription-setup.md`.
- App has Squarespace thank-you page copy in `docs/squarespace-thank-you-page-copy.md`.
- App pricing buttons now start Stripe Checkout through `/api/stripe/checkout`; legacy Squarespace checkout URLs are retained only for older workflows.
- README explains the Squarespace sales flow.

## Notes

- Stripe checkout was added after this phase and is the new-customer checkout path.
- Webhook verification supports a configured `SQUARESPACE_WEBHOOK_SECRET`; the route still stores events when credentials are absent.
- Early launch can use manual activation after confirming a customer purchase in Squarespace.
- Customers should sign up with the same email address used during Squarespace checkout.

## Not Fully Tested In This Environment

- `pnpm typecheck` and `pnpm build` passed locally on June 17, 2026 after dependencies were installed. Browser testing was not run in this environment.
- Live Squarespace webhook payloads were not available, so webhook field extraction should be verified against actual Squarespace order events before launch.
- Supabase migrations were source-reviewed, but not applied to a live Supabase database in this environment.
