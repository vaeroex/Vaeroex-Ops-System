# Admin Access Audit

Admin access is separate from operational roles.

Valid admin grants:

1. Email listed in `VAEROEX_ADMIN_EMAILS`.
2. Supabase Auth `app_metadata.vaeroex_admin === true`.

Invalid admin grants:

- Workspace owner role.
- Workspace admin role.
- Operational role such as Owner, Executive, Director, Manager, Supervisor, Coordinator, Staff, or Viewer.

| Area | Control | Status |
| --- | --- | --- |
| Admin sidebar visibility | `AppShell` adds admin navigation only for Vaeroex admin email | SAFE |
| Direct `/app/admin` access | `app/app/admin/layout.tsx` calls `requireVaeroexAdmin` | SAFE |
| Admin server actions | Subscription, support request, and workspace admin actions call `requireVaeroexAdmin` | SAFE |
| Customer/workspace global views | Admin pages use server-side admin access only after admin guard | SAFE |
| Subscription activation | Admin server action requires `requireVaeroexAdmin` | SAFE |
| Global support tickets | Admin support routes are inside guarded admin layout | SAFE |
| Global AI usage | Admin usage route is inside guarded admin layout | SAFE |
| OpenAI health endpoint | Requires authenticated Vaeroex admin | SAFE |
| Demo fresh/reset controls | Require Vaeroex admin user | SAFE |

Manual direct URL test:

1. Log in as a non-admin workspace owner.
2. Open `/app/admin`.
3. Expected: redirected away with an admin-required message.
4. Open `/app/admin/customers`.
5. Expected: same redirect; no customer data renders.
