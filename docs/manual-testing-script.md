# Manual Testing Script

Use this script on a real deployed preview or production-like environment. Run it once with seed/demo data and once with a clean customer account.

## Prerequisites

- Dependencies installed and build passing:
  - `pnpm install`
  - `pnpm typecheck`
  - `pnpm build`
- Supabase migrations applied:
  - `supabase db push`
- Environment variables set in Vercel:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `NEXT_PUBLIC_APP_URL`
  - `VAEROEX_ADMIN_EMAILS`
  - Squarespace product/checkout/webhook variables as available
- Supabase Auth callback configured:
  - `https://vaeroex.com/auth/callback`
- At least one internal admin account email listed in `VAEROEX_ADMIN_EMAILS`.
- At least one test customer email that is not the admin email.
- Squarespace test product or low-risk live purchase path ready.

## Customer Flow

### 1. Buy on Squarespace

1. Open the Squarespace pricing/product page.
2. Buy or simulate a purchase for Starter, Growth, or Pro.
3. Use the planned customer test email.
4. Confirm the checkout success page sends the customer to Vaeroex signup.

Expected result:
- Purchase completes.
- Customer sees instructions to create Vaeroex account using the same email.
- If webhook is configured, a `subscription_events` row is created.

Result:
- Pass/fail:
- Notes:

### 2. Create Vaeroex Account

1. Open `/signup`.
2. Sign up with the same email used at checkout.
3. Complete email verification or auth callback if enabled.
4. Sign in.

Expected result:
- Customer is authenticated.
- Customer lands in the protected app or setup flow.

Result:
- Pass/fail:
- Notes:

### 3. Request Activation If Needed

1. If the customer is blocked, confirm `/billing-required` appears.
2. Select “I already purchased” or “Request Manual Activation.”
3. Submit name, checkout email, company, plan, order number, and message.

Expected result:
- `manual_activation_requests` row is created.
- Customer sees confirmation message.

Result:
- Pass/fail:
- Notes:

### 4. Admin Activates Subscription

1. Sign in as an internal admin.
2. Open `/app/admin/subscriptions`.
3. Search customer email.
4. Create or update subscription:
   - Customer email
   - Customer name
   - Plan
   - Status `active`
   - Squarespace order ID if available
   - Notes
5. If the customer already has a workspace, include or preserve workspace ID.

Expected result:
- `customer_subscriptions` row is active.
- Linked workspace fields update when a workspace is linked.
- Customer is allowed through subscription gating.

Result:
- Pass/fail:
- Notes:

### 5. Customer Creates Workspace

1. Sign back in as the customer.
2. Open `/app/setup`.
3. Confirm access is allowed.
4. Fill all setup wizard fields.
5. Choose an industry template.
6. Confirm workspace generation.

Expected result:
- Workspace is created.
- Customer is owner.
- Starter operations records are generated.

Result:
- Pass/fail:
- Notes:

### 6. Customer Completes Setup

1. Verify setup redirects to the app dashboard.
2. Open the workspace switcher.
3. Confirm the new workspace is active.

Expected result:
- Workspace appears in the app shell.
- Dashboard loads without errors.

Result:
- Pass/fail:
- Notes:

### 7. Customer Uses Dashboard

1. Open `/app`.
2. Review metrics, suggested next actions, recent tasks, recent issues, latest Vaeroex summary, and latest report.

Expected result:
- Dashboard data is scoped to the active workspace.
- Empty states appear cleanly when no data exists.

Result:
- Pass/fail:
- Notes:

### 8. Customer Creates Form

1. Open `/app/forms`.
2. Create a form with name, type, description, and fields.
3. Optionally mark public.

Expected result:
- Form appears in the forms list.
- Plan limit error appears if form limit is exceeded.

Result:
- Pass/fail:
- Notes:

### 9. Customer Creates Checklist

1. Open `/app/checklists`.
2. Create a checklist with name, category, frequency, owner role, and items.

Expected result:
- Checklist appears in the checklist list.
- Plan limit error appears if checklist limit is exceeded.

Result:
- Pass/fail:
- Notes:

### 10. Customer Runs Vaeroex Audit

1. Open `/app/agents`.
2. Select Operations Audit Agent.
3. Enter operational context.
4. Run Vaeroex.

Expected result:
- Vaeroex response appears.
- Run is saved in `ai_agent_runs`.
- Usage is recorded in `ai_usage`.
- Monthly AI run limit blocks when exceeded.

Result:
- Pass/fail:
- Notes:

### 11. Customer Generates SOP

1. Open `/app/agents`.
2. Select SOP Generator Agent.
3. Enter process context.
4. Run Vaeroex.
5. Review output.
6. Confirm save to SOPs.

Expected result:
- SOP is not saved until confirmation.
- Confirmed SOP appears in `/app/sops`.

Result:
- Pass/fail:
- Notes:

### 12. Customer Generates Weekly Report

1. Open `/app/agents`.
2. Select Weekly Report Agent.
3. Enter reporting context or date range.
4. Run Vaeroex.
5. Review output.
6. Confirm save to Reports.

Expected result:
- Report is not saved until confirmation.
- Confirmed report appears in `/app/reports`.

Result:
- Pass/fail:
- Notes:

## Admin Flow

### 1. View Customer

1. Sign in as an email listed in `VAEROEX_ADMIN_EMAILS`.
2. Open `/app/admin/customers`.
3. Search the test customer email.

Expected result:
- Admin can view profile, subscription, workspace status, and impersonation placeholder.
- Impersonation is disabled.

Result:
- Pass/fail:
- Notes:

### 2. Activate Customer

1. Open `/app/admin/subscriptions`.
2. Create or update the customer subscription.
3. Set status to `active`.

Expected result:
- Customer access is active.
- Status shows correctly in `/app/account/subscription`.

Result:
- Pass/fail:
- Notes:

### 3. Change Plan

1. Open `/app/admin/subscriptions`.
2. Change customer plan from Starter to Growth or Pro.
3. Save.

Expected result:
- Subscription plan updates.
- Customer usage limits reflect the new plan.

Result:
- Pass/fail:
- Notes:

### 4. View Subscription Status

1. Open `/app/admin/subscriptions`.
2. Open `/app/admin/workspaces`.
3. Confirm subscription and workspace statuses match expected access state.

Expected result:
- Active/manual/demo access is allowed.
- Canceled/expired/past_due access is blocked unless manually unlocked.

Result:
- Pass/fail:
- Notes:

### 5. View Support Request

1. Submit `/support` as a public visitor.
2. Submit `/app/support` as the customer.
3. Open `/app/admin/support-requests`.
4. Update status and priority.

Expected result:
- Both requests appear.
- Admin can update status and priority.

Result:
- Pass/fail:
- Notes:

### 6. View AI Usage

1. Run at least one Vaeroex workflow.
2. Open `/app/admin/ai-usage`.

Expected result:
- Monthly usage and recent run appear.
- Failed runs appear in recent errors if any fail.

Result:
- Pass/fail:
- Notes:

## Security Testing

### Workspace Data Separation

1. Create two customer users.
2. Create one workspace per customer.
3. Add data to each workspace.
4. Try to access the other customer workspace by route and direct ID where possible.

Expected result:
- Other workspace data does not load.
- RLS blocks cross-tenant access.

Result:
- Pass/fail:
- Notes:

### Role Permissions

1. Create or seed owner, admin, manager, staff, and viewer memberships.
2. Test reads and writes for each role.

Expected result:
- Owners/admins can manage workspace records.
- Managers can create/edit operations records.
- Staff can complete assigned operational work where supported.
- Viewers are read-only.

Result:
- Pass/fail:
- Notes:

### Public Form Access

1. Create a public form.
2. Submit against its public slug.
3. Attempt submission against a non-public form.

Expected result:
- Public form submission succeeds.
- Non-public submission is blocked.

Result:
- Pass/fail:
- Notes:

### Subscription Gating

1. Set subscription to `active`; confirm app access.
2. Set subscription to `past_due`; confirm blocked access.
3. Set subscription to `canceled`; confirm blocked access.
4. Set workspace to `demo`; confirm demo access.
5. Set manual unlock; confirm access.

Expected result:
- Gating matches access rules exactly.

Result:
- Pass/fail:
- Notes:

### API Key Safety

1. Inspect browser source and network responses.
2. Confirm server-only keys do not appear:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `SQUARESPACE_API_KEY`
   - `SQUARESPACE_WEBHOOK_SECRET`
3. Confirm only `NEXT_PUBLIC_` values are exposed client-side.

Expected result:
- Server secrets are not exposed to the browser.

Result:
- Pass/fail:
- Notes:

### No Blank Vaeroex Prompt

1. Confirm `lib/ai/prompts/vaeroex-system-prompt.ts` exports non-empty `VAEROEX_SYSTEM_PROMPT`.
2. Run Vaeroex workflow.
3. Temporarily blank the prompt in a local/non-production branch and confirm guard fails safely.

Expected result:
- Production prompt is non-empty.
- Vaeroex interactions use the base prompt.

Result:
- Pass/fail:
- Notes:

## Deployment Testing

1. Run production build:
   - `pnpm install`
   - `pnpm typecheck`
   - `pnpm build`
2. Deploy to Vercel Preview.
3. Add all environment variables to Preview and Production.
4. Redeploy after any environment variable changes.
5. Apply Supabase migrations.
6. Optionally seed a disposable demo database.
7. Add custom domain in Vercel.
8. Configure DNS record recommended by Vercel.
9. Confirm SSL certificate provisions.
10. Update `NEXT_PUBLIC_APP_URL`, Supabase Auth redirect URLs, and Squarespace thank-you links.
11. Re-run customer and admin flows on the custom domain.

Expected result:
- Preview and Production deployments work.
- Custom domain routes correctly.
- Auth callbacks and Squarespace links use the final domain.

Result:
- Pass/fail:
- Notes:
