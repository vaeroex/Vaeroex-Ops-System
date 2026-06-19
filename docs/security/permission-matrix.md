# Permission Matrix

Operational roles are for accountability, routing, assignments, briefings, and reporting. They do not grant Vaeroex app-admin access.

## App Permissions

| Capability | Logged-out user | Workspace viewer | Workspace member | Workspace manager | Workspace admin | Workspace owner | Vaeroex admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| View public pages | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| View dashboard | No | Yes | Yes | Yes | Yes | Yes | Yes, when member/admin context allows |
| Create tasks | No | No | Limited by RLS | Yes | Yes | Yes | Yes, in customer context only when permitted |
| Edit tasks | No | No | Assigned updates only | Yes | Yes | Yes | Yes, in customer context only when permitted |
| Delete tasks | No | No | No | Yes | Yes | Yes | Yes, in customer context only when permitted |
| View reports | No | Yes | Yes | Yes | Yes | Yes | Yes, in workspace or admin tools |
| Share reports | No | No | No | Yes | Yes | Yes | Yes, in workspace or admin tools |
| Manage KPIs | No | No | Limited by RLS | Yes | Yes | Yes | Yes, in workspace or admin tools |
| Upload files | No | No | Yes | Yes | Yes | Yes | Yes, in workspace context |
| Analyze files | No | No | Yes, subject to plan/usage | Yes | Yes | Yes | Yes, in workspace context |
| Access admin dashboard | No | No | No | No | No | No | Yes |
| Activate customers | No | No | No | No | No | No | Yes |
| View all workspaces | No | No | No | No | No | No | Yes |
| Manage subscription status | No | No | No | No | Workspace-level status only where allowed | Workspace-level status only where allowed | Yes |

## Operational Roles

| Operational role | Purpose | Grants Vaeroex admin? |
| --- | --- | --- |
| Owner | Business accountability and executive reporting | No |
| Executive | Leadership briefings, approvals, priorities | No |
| Director | Department-level oversight | No |
| Manager | Team execution and follow-up | No |
| Supervisor | Shift/team accountability | No |
| Coordinator | Coordination and scheduling | No |
| Staff | Assigned operational work | No |
| Viewer | Read-only operational visibility | No |

Operational roles affect:

- Sharing and routing.
- Assignments.
- KPI alerts and report audiences.
- Briefings and accountability maps.

Operational roles never grant:

- `/app/admin` access.
- Customer activation/deactivation.
- Global workspace/customer visibility.
- Service-role operations.
