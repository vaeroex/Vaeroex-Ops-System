# Phase 7 Admin And Support Acceptance Review

Phase 7 adds internal Vaeroex admin and customer support tools.

## Source-Verified Acceptance Criteria

- `/app/admin` exists as an internal admin overview.
- `/app/admin/customers` can search customers by email and shows profile, subscription, workspace, and impersonation-placeholder details.
- `/app/admin/workspaces` shows workspace status and can manually activate or deactivate workspace access.
- `/app/admin/subscriptions` uses the internal Vaeroex admin guard and can manually create/update subscription access.
- `/app/admin/ai-usage` shows Vaeroex usage, recent runs, and failed run errors.
- `/app/admin/support-requests` shows support requests and can update status/priority.
- `/app/admin/audit-logs` shows audit logs and recent Vaeroex/Squarespace errors.
- `/support` and `/app/support` create support requests.
- `support_requests` table exists with workspace, user, name, email, issue type, message, priority, status, created, and updated fields.
- Impersonation is a placeholder only and is not implemented.
- Internal admin access is controlled by `VAEROEX_ADMIN_EMAILS` and server-side Supabase service role access.

## Not Fully Tested In This Environment

- `pnpm typecheck` and `pnpm build` passed locally on June 17, 2026 after dependencies were installed. Browser testing was not run in this environment.
- Supabase migrations were source-reviewed but not applied to a live Supabase database here.
