# Manual Security Test Plan

Use this when full Supabase-auth integration tests are not available locally.

## Test Accounts

- User A: member of Workspace A only.
- User B: member of Workspace B only.
- Admin: email in `VAEROEX_ADMIN_EMAILS` or `app_metadata.vaeroex_admin = true`.

## Workspace Isolation

1. Log in as User A and create CRM, KPI, task, issue, SOP, report, file, people, notification, and checklist records.
2. Log in as User B.
3. Confirm none of User A's records appear in Workspace B.
4. Try direct detail URLs where available; expect not found or no data.
5. Repeat in reverse from User B to User A.

## Admin Isolation

1. Log in as User A.
2. Visit `/app/admin`, `/app/admin/customers`, `/app/admin/workspaces`, `/app/admin/subscriptions`, `/app/admin/ai-usage`, `/app/admin/support-requests`, and `/app/admin/audit-logs`.
3. Expected: no admin screen renders.
4. Log in as Admin.
5. Expected: admin screens render.

## Demo Isolation

1. As Admin, create or reset the demo workspace.
2. Confirm the demo banner appears.
3. Confirm demo counts exist for KPIs, CRM, reports, files, tasks, issues, SOPs, and Vaeroex insights.
4. Switch back to the real workspace.
5. Confirm no demo records appear.

## Files

1. Upload a CSV/XLSX/PDF/DOCX in Workspace A.
2. Switch to Workspace B.
3. Confirm the file is not listed.
4. Attempt analyze/import/report actions only on files listed in the active workspace.

## Secrets

1. Open browser devtools.
2. Search page source and network responses for `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and `CRON_SECRET`.
3. Expected: no matches.

## Regression Command

Run before publishing:

```bash
pnpm typecheck
pnpm build
pnpm security:check
git diff --check
```
