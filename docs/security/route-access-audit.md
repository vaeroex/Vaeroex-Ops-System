# Route Access Audit

Status labels: SAFE means the route has server-side guard coverage or is intentionally public. NEEDS REVIEW means manual browser testing is still required before launch. CRITICAL means launch-blocking exposure.

| Route | Required auth | Required permission | Data access scope | Status |
| --- | --- | --- | --- | --- |
| `/` | None | Public marketing access | No private workspace data | SAFE |
| `/login` | None | Public auth access | No private workspace data | SAFE |
| `/signup` | None | Public auth access | No private workspace data | SAFE |
| `/forgot-password` | None | Public auth access | No private workspace data | SAFE |
| `/pricing` | None | Public pricing access | No private workspace data | SAFE |
| `/contact` | N/A | Route not implemented; use `/support` | No private workspace data | SAFE |
| `/support` | None | Public support request | No private workspace data; submitted workspace IDs are not trusted unless membership is verified | SAFE |
| Public form routes | N/A | Dedicated public form route is not currently implemented | No public private-data route exists | SAFE |
| `/app` | Authenticated | Active/manual/demo subscription access | Current workspace only via `requireWorkspacePage` | SAFE |
| `/app/files` | Authenticated | Active/manual/demo subscription access | Current workspace files and imports only | SAFE |
| `/app/reports` | Authenticated | Active/manual/demo subscription access | Current workspace reports and related data only | SAFE |
| `/app/sops` | Authenticated | Active/manual/demo subscription access | Current workspace SOPs only | SAFE |
| `/app/kpis` | Authenticated | Active/manual/demo subscription access | Current workspace KPIs only | SAFE |
| `/app/crm` | Authenticated | Active/manual/demo subscription access | Current workspace CRM only | SAFE |
| `/app/tasks` | Authenticated | Retired route | Permanently redirects to `/app/sources` | SAFE |
| `/app/checklists` | Authenticated | Active/manual/demo subscription access | Current workspace checklists and runs only | SAFE |
| `/app/issues` | Authenticated | Active/manual/demo subscription access | Current workspace issues only | SAFE |
| `/app/assets` | Authenticated | Active/manual/demo subscription access | Current workspace assets and checks only | SAFE |
| `/app/people` | Authenticated | Active/manual/demo subscription access | Current workspace people and accountability data only | SAFE |
| `/app/forms` | Authenticated | Active/manual/demo subscription access | Current workspace forms only | SAFE |
| `/app/form-submissions` | Authenticated | Active/manual/demo subscription access | Current workspace submissions only | SAFE |
| `/app/notifications` | Authenticated | Active/manual/demo subscription access | Current workspace notifications only | SAFE |
| `/app/agents` | Authenticated | Active/manual/demo subscription access | Current workspace Vaeroex runs only | SAFE |
| `/app/support` | Authenticated | App layout auth; support remains available even if billing help is needed | Active workspace is included only after membership verification | SAFE |
| `/app/account/subscription` | Authenticated | Workspace context | Active workspace subscription status only | SAFE |
| `/app/setup` | Authenticated | Account user creating or completing workspace setup | New/current workspace setup flow | SAFE |
| `/app/admin` | Authenticated | Vaeroex admin only | Global admin data through server-side service-role client | SAFE |
| `/app/admin/customers` | Authenticated | Vaeroex admin only | Global customer/admin data | SAFE |
| `/app/admin/workspaces` | Authenticated | Vaeroex admin only | Global workspace/admin data | SAFE |
| `/app/admin/subscriptions` | Authenticated | Vaeroex admin only | Global subscription/admin data | SAFE |
| `/app/admin/ai-usage` | Authenticated | Vaeroex admin only | Global Vaeroex run/admin usage data | SAFE |
| `/app/admin/support-requests` | Authenticated | Vaeroex admin only | Global support requests | SAFE |
| `/app/admin/audit-logs` | Authenticated | Vaeroex admin only | Global audit/error logs | SAFE |

Key controls:

- `/app/layout.tsx` requires an authenticated Supabase user before any protected app route renders.
- Customer module pages call `requireWorkspacePage`, which now delegates to reusable `lib/security` guards.
- `/app/admin/layout.tsx` now centrally calls `requireVaeroexAdmin`, so direct admin URLs are server-protected.
- Admin access is based on `VAEROEX_ADMIN_EMAILS` or `app_metadata.vaeroex_admin === true`, not operational roles.
- Workspace module queries include `workspace_id` filters, and RLS enforces membership at the database layer.
