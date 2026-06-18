# Pre-Launch Checklist

Status: source-ready for a limited beta, pending live manual testing in a real Supabase, Vercel, OpenAI, and Squarespace environment.

## Launch Decision Summary

1. Ready for launch:
   - Core Vaeroex Ops System MVP source is ready for a controlled beta.
   - Customer workspace setup, dashboard modules, Vaeroex Hub, Squarespace subscription access, admin tools, and support request flow are present in source.
   - The main Vaeroex system prompt exists and is guarded against blank prompt usage.

2. Needs manual testing:
   - Production build and typecheck.
   - Supabase migrations on a real database.
   - Squarespace checkout and webhook payload behavior.
   - Full customer and internal admin flows in the deployed environment.
   - RLS and subscription gating using separate test users.

3. Known limitations:
   - See `docs/known-limitations.md`.

4. Recommended first beta customer type:
   - A small service, field operations, construction, automotive, fitness, or internal operations team with one owner/admin, 3-10 staff, non-regulated operational data, and a willingness to use manual activation during onboarding.

5. What not to build yet:
   - Stripe or internal checkout.
   - Full customer impersonation.
   - File uploads for support requests.
   - Advanced integrations.
   - Complex analytics beyond the current dashboard, reports, and Vaeroex usage views.

## Customer Flow

- [ ] Buy on Squarespace.
  - Expected: Customer completes purchase on `vaeroex.com` or Squarespace checkout.
  - Status: Needs live Squarespace testing.

- [ ] Create Vaeroex account.
  - Expected: Customer signs up with the same email used during Squarespace checkout.
  - Status: Needs live Supabase Auth testing.

- [ ] Request activation if needed.
  - Expected: Blocked customer sees `/billing-required`, uses “I already purchased” or “Request Manual Activation,” and creates a manual activation request.
  - Status: Source verified; needs live form test.

- [ ] Admin activates subscription.
  - Expected: Internal admin opens `/app/admin/subscriptions`, finds or creates the customer subscription, assigns plan/status, and unlocks workspace access when appropriate.
  - Status: Source verified; needs live admin test.

- [ ] Customer creates workspace.
  - Expected: Active/manual/demo customer can open `/app/setup` and create a workspace.
  - Status: Source verified; needs live test.

- [ ] Customer completes setup.
  - Expected: Setup wizard generates starter forms, checklists, SOPs, tasks, assets, people, report, and Vaeroex audit result.
  - Status: Source verified; needs live test.

- [ ] Customer uses dashboard.
  - Expected: `/app` displays workspace metrics, recent tasks/issues, latest report, and latest Vaeroex summary.
  - Status: Source verified; needs browser test.

- [ ] Customer creates form.
  - Expected: `/app/forms` creates a tenant-scoped form and enforces plan limits.
  - Status: Source verified; needs browser test.

- [ ] Customer creates checklist.
  - Expected: `/app/checklists` creates a tenant-scoped checklist and enforces plan limits.
  - Status: Source verified; needs browser test.

- [ ] Customer runs Vaeroex audit.
  - Expected: `/app/agents` uses `VAEROEX_SYSTEM_PROMPT`, stores the run in `ai_agent_runs`, and records usage in `ai_usage`.
  - Status: Source verified; needs OpenAI live test.

- [ ] Customer generates SOP.
  - Expected: Vaeroex SOP Generator returns a structured draft; customer confirms before saving to SOPs.
  - Status: Source verified; needs OpenAI/browser test.

- [ ] Customer generates weekly report.
  - Expected: Vaeroex Weekly Report returns a structured report; customer confirms before saving to Reports.
  - Status: Source verified; needs OpenAI/browser test.

## Admin Flow

- [ ] View customer.
  - Expected: `/app/admin/customers` searches by email and shows profile, subscription, workspace, and impersonation placeholder.
  - Status: Source verified; needs live admin test.

- [ ] Activate customer.
  - Expected: `/app/admin/subscriptions` creates or updates `customer_subscriptions`.
  - Status: Source verified; needs live admin test.

- [ ] Change plan.
  - Expected: Admin changes plan/status on subscription and linked workspace fields update.
  - Status: Source verified; needs live admin test.

- [ ] View subscription status.
  - Expected: `/app/admin/subscriptions` and `/app/admin/workspaces` show status, plan, source, notes, and event data.
  - Status: Source verified; needs live admin test.

- [ ] View support request.
  - Expected: `/app/admin/support-requests` shows requests from `/support` and `/app/support`, with status/priority update controls.
  - Status: Source verified; needs live admin test.

- [ ] View AI usage.
  - Expected: `/app/admin/ai-usage` shows monthly usage, recent Vaeroex runs, and failed run errors.
  - Status: Source verified; needs live Vaeroex usage data.

## Security Checks

- [ ] Workspace data separation.
  - Expected: Every operational module reads data by `workspace_id`; page context requires active workspace membership and active subscription.
  - Status: Source verified; needs two-user RLS test.

- [ ] Role permissions.
  - Expected: RLS helpers enforce owner/admin/manager/staff/viewer behavior; write actions are guarded by workspace membership and role-aware policies.
  - Status: Source verified; needs role matrix test.

- [ ] Public form access.
  - Expected: Public form submissions only insert when the target form is public and workspace IDs match.
  - Status: Source verified; needs public form test.

- [ ] Subscription gating.
  - Expected: Missing, canceled, expired, and past-due access is blocked from full modules; active, trialing, demo, and manual unlock access is allowed.
  - Status: Source verified; needs live account test.

- [ ] API key safety.
  - Expected: `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, Squarespace secrets, and admin allowlist stay server-side; public checkout URLs use `NEXT_PUBLIC_`.
  - Status: Source verified; needs Vercel env audit.

- [ ] RLS policies.
  - Expected: Tenant tables have RLS enabled and policies use workspace membership helpers.
  - Status: Source verified; needs Supabase migration test.

- [ ] No blank Vaeroex prompt.
  - Expected: `VAEROEX_SYSTEM_PROMPT` is non-empty and Vaeroex actions fail safely if blank.
  - Status: Source verified.

## Deployment Checks

- [x] Production build passes.
  - Command: `pnpm install && pnpm typecheck && pnpm build`
  - Status: Passed locally on June 17, 2026 after installing dependencies.

- [ ] Environment variables documented.
  - Expected: `.env.example` and README include Supabase, OpenAI, admin, Squarespace, and public checkout variables.
  - Status: Source verified.

- [ ] Supabase migrations documented.
  - Expected: Run `supabase db push` against the production project and confirm all four migrations apply.
  - Status: Source documented; needs live Supabase test.

- [ ] Seed data works.
  - Expected: `supabase db reset` loads demo workspaces, demo subscriptions, module records, Vaeroex results, and support requests in a disposable database.
  - Status: Source verified; needs live Supabase test.

- [ ] Vercel deployment instructions work.
  - Expected: Vercel project uses `pnpm install` and `pnpm build`; environment variables are configured for Production and Preview; redeploy after env changes.
  - Notes: Vercel documents that environment variable changes apply to new deployments only.
  - Reference: https://vercel.com/docs/environment-variables

- [ ] Custom domain instructions included.
  - Expected: Add `app.vaeroex.com` or launch domain to the Vercel project, configure DNS, wait for SSL, and update app/Supabase/Squarespace URLs.
  - Notes: Vercel documents apex domains with A records and subdomains with CNAME records; inspect the domain in Vercel to confirm exact records.
  - Reference: https://vercel.com/docs/domains/working-with-domains/add-a-domain

## Custom Domain Steps

1. Add the production app domain in Vercel project settings, such as `app.vaeroex.com`.
2. If using an apex domain, configure the A record Vercel recommends.
3. If using a subdomain, configure the CNAME record Vercel recommends.
4. Add both apex and `www` only if needed; configure one canonical redirect to avoid duplicate content.
5. Wait for Vercel domain verification and SSL certificate provisioning.
6. Update `NEXT_PUBLIC_APP_URL` to the final app URL and redeploy.
7. Add the final app URL callback in Supabase Auth, such as `https://app.vaeroex.com/auth/callback`.
8. Update Squarespace thank-you/onboarding links to the final signup URL.
9. Re-run the customer and admin manual testing script after DNS is live.
