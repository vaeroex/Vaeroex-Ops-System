# Pre-Launch Checklist

Status: source-ready for a controlled beta, pending manual testing in a real Supabase, Vercel, OpenAI, and Squarespace environment.

Use this checklist with `docs/manual-testing-script.md`, `docs/known-limitations.md`, and `docs/version-1-roadmap.md`.

## Customer Flow

- [ ] Buy on Squarespace.
  - Expected: Customer completes checkout through Squarespace for Starter, Growth, or Pro.
  - Verify: Checkout success page points customers to Vaeroex signup and tells them to use the same email.
  - Status: Needs live Squarespace testing.

- [ ] Create Vaeroex account.
  - Expected: Customer signs up for Vaeroex using the same email used at checkout.
  - Verify: Supabase Auth signup, callback, and login work on the production domain.
  - Status: Needs live Supabase Auth testing.

- [ ] Request activation if needed.
  - Expected: If access is not active, customer sees `/billing-required` and can submit the manual activation form.
  - Verify: `manual_activation_requests` receives name, checkout email, company, plan, order number, and message.
  - Status: Source verified; needs live form test.

- [ ] Admin activates subscription.
  - Expected: Vaeroex admin opens `/app/admin/subscriptions`, creates or updates customer subscription, assigns plan, and sets status to `active`.
  - Verify: `customer_subscriptions` and linked workspace subscription fields are updated.
  - Status: Source verified; needs live admin test.

- [ ] Customer creates workspace.
  - Expected: Active, manual, or demo customer can access `/app/setup`.
  - Verify: Missing, canceled, expired, or past-due customer is blocked unless manually unlocked.
  - Status: Source verified; needs live subscription-gating test.

- [ ] Customer completes setup.
  - Expected: Setup wizard creates a workspace and starter records.
  - Verify: Forms, checklists, tasks, issues, assets, people, SOPs, reports, and Vaeroex result are generated.
  - Status: Source verified; needs browser test.

- [ ] Customer uses dashboard.
  - Expected: `/app` loads metrics, recent tasks, recent issues, latest report, and latest Vaeroex summary for the active workspace.
  - Verify: Dashboard only shows data for the active workspace.
  - Status: Source verified; needs browser/RLS test.

- [ ] Customer creates form.
  - Expected: `/app/forms` creates a tenant-scoped form.
  - Verify: Plan limits are enforced and public/private settings behave correctly.
  - Status: Source verified; needs browser test.

- [ ] Customer creates checklist.
  - Expected: `/app/checklists` creates a tenant-scoped checklist.
  - Verify: Plan limits are enforced and the checklist appears only in the active workspace.
  - Status: Source verified; needs browser test.

- [ ] Customer runs Vaeroex audit.
  - Expected: `/app/agents` runs Operations Audit Agent using `VAEROEX_SYSTEM_PROMPT`.
  - Verify: Run is stored in `ai_agent_runs` and usage is recorded in `ai_usage`.
  - Status: Source verified; needs OpenAI live test.

- [ ] Customer generates SOP.
  - Expected: SOP Generator Agent returns a draft and requires confirmation before saving.
  - Verify: Confirmed SOP appears in `/app/sops`.
  - Status: Source verified; needs OpenAI/browser test.

- [ ] Customer generates weekly report.
  - Expected: Weekly Report Agent returns a report and requires confirmation before saving.
  - Verify: Confirmed report appears in `/app/reports`.
  - Status: Source verified; needs OpenAI/browser test.

## Admin Flow

- [ ] View customer.
  - Expected: `/app/admin/customers` searches by email and shows profile, subscription, workspace, and impersonation placeholder.
  - Verify: Admin access is limited to emails listed in `VAEROEX_ADMIN_EMAILS`.
  - Status: Source verified; needs live admin test.

- [ ] Activate customer.
  - Expected: `/app/admin/subscriptions` creates or updates a customer subscription.
  - Verify: Customer can access setup/app after activation.
  - Status: Source verified; needs live admin test.

- [ ] Change plan.
  - Expected: Admin can change customer plan between Starter, Growth, and Pro.
  - Verify: Customer usage limits reflect the updated plan.
  - Status: Source verified; needs live admin test.

- [ ] View subscription status.
  - Expected: Admin can view subscription records, workspace subscription state, manual activation requests, and Squarespace event payloads.
  - Verify: Active/manual/demo access is allowed; blocked statuses are blocked unless manually unlocked.
  - Status: Source verified; needs live admin test.

- [ ] View support request.
  - Expected: `/app/admin/support-requests` displays requests submitted from `/support` and `/app/support`.
  - Verify: Admin can update request status and priority.
  - Status: Source verified; needs live support test.

- [ ] View AI usage.
  - Expected: `/app/admin/ai-usage` displays monthly usage, recent runs, and failed run errors.
  - Verify: Vaeroex runs appear after customer workflows are run.
  - Status: Source verified; needs OpenAI live data.

## Security Checks

- [ ] Workspace data separation.
  - Expected: Tenant-scoped records are filtered by `workspace_id`; protected pages require workspace context.
  - Verify: Two separate customer accounts cannot read or mutate each other's workspace data.
  - Status: Source verified; needs live two-user RLS test.

- [ ] Role permissions.
  - Expected: Owner/admin/manager/staff/viewer behavior follows RLS helper functions.
  - Verify: Owners/admins manage workspace, managers edit operations, viewers are read-only.
  - Status: Source verified; needs role matrix test.

- [ ] Public form access.
  - Expected: Public submissions only work for public forms and matching workspace/form IDs.
  - Verify: Non-public form submissions are blocked.
  - Status: Source verified; needs live public form test.

- [ ] Subscription gating.
  - Expected: Missing, canceled, expired, and past-due subscriptions are blocked from full modules.
  - Verify: Active, trialing, demo, and manually unlocked access is allowed.
  - Status: Source verified; needs live account test.

- [ ] API key safety.
  - Expected: Server secrets remain server-side.
  - Verify: Browser source/network does not expose `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `SQUARESPACE_API_KEY`, or `SQUARESPACE_WEBHOOK_SECRET`.
  - Status: Source verified; needs Vercel/browser audit.

- [ ] RLS policies.
  - Expected: Tenant tables have RLS and policy coverage.
  - Verify: Apply migrations to Supabase and test reads/writes as multiple users.
  - Status: Source verified; needs live Supabase test.

- [ ] No blank Vaeroex prompt.
  - Expected: `VAEROEX_SYSTEM_PROMPT` is non-empty and Vaeroex actions guard against blank prompt use.
  - Verify: Run Vaeroex workflow successfully; confirm guard fails safely in a non-production prompt-blank test.
  - Status: Source verified.

## Deployment Checks

- [x] Production build passes.
  - Command: `pnpm install && pnpm typecheck && pnpm build`
  - Status: Passed locally on June 17, 2026 after installing dependencies.

- [ ] Environment variables documented.
  - Expected: `.env.example` and README document Supabase, OpenAI, Vaeroex admin, Squarespace, and public checkout variables.
  - Status: Source verified.

- [ ] Supabase migrations documented.
  - Expected: Run `supabase db push` against production project.
  - Verify: All migrations apply:
    - `202606170001_phase_1_schema_rls.sql`
    - `202606170002_phase_2_invites.sql`
    - `202606170003_phase_6_squarespace_subscriptions.sql`
    - `202606170004_admin_support_tools.sql`
  - Status: Source documented; needs live Supabase test.

- [ ] Seed data works.
  - Expected: `supabase db reset` loads demo workspaces, subscriptions, operations records, Vaeroex runs, and support requests in a disposable database.
  - Status: Source verified; needs live Supabase test.

- [ ] Vercel deployment instructions work.
  - Expected: Vercel uses `pnpm install` and `pnpm build`, with environment variables configured for Production and Preview.
  - Verify: Redeploy after any environment variable change.
  - Status: Documented; needs live Vercel deployment test.

- [ ] Custom domain instructions included.
  - Expected: Add app domain to Vercel, configure DNS, wait for SSL, update Supabase Auth callback, update `NEXT_PUBLIC_APP_URL`, and update Squarespace links.
  - Verify: App, auth callback, and Squarespace thank-you flow work on the final domain.
  - Status: Documented; needs live DNS/domain test.

## Custom Domain Steps

1. Add the production app domain to the Vercel project, such as `app.vaeroex.com`.
2. Configure DNS using Vercel's recommended record.
3. Use an A record for an apex domain or a CNAME record for a subdomain.
4. Wait for Vercel verification and SSL certificate provisioning.
5. Set `NEXT_PUBLIC_APP_URL` to the final app URL.
6. Redeploy after environment changes.
7. Add `https://APP_DOMAIN/auth/callback` to Supabase Auth redirect URLs.
8. Update Squarespace success/thank-you links to the final signup URL.
9. Re-run `docs/manual-testing-script.md` on the final domain.

## Final Launch Summary

1. Ready for launch:
   - Ready for a controlled beta after live manual testing passes.
   - Source includes customer setup, operations modules, Vaeroex Hub, Squarespace access, internal admin, support request flow, and launch docs.

2. Needs manual testing:
   - Vercel production deployment build.
   - Supabase migrations and seed data.
   - Squarespace purchase, activation, and webhook behavior.
   - OpenAI Vaeroex workflows.
   - Browser customer/admin flows.
   - Two-user workspace separation and role permission checks.

3. Known limitations:
   - See `docs/known-limitations.md`.
   - Main current limitations: manual activation recommended, no Stripe/internal checkout, no full impersonation, no support file upload, limited edit/delete flows, no automated tests yet, and live webhook payloads still need verification.

4. Recommended first beta customer type:
   - Small non-regulated service or operations-heavy business with one owner/admin champion, 3-10 staff, and real pain around missed follow-ups, checklists, SOPs, task ownership, or weekly reporting.

5. What not to build yet:
   - Stripe/internal checkout.
   - Full customer impersonation.
   - Broad integrations.
   - Regulated-data workflows.
   - Heavy analytics.
   - Complex automation builder.
   - Native mobile app.
