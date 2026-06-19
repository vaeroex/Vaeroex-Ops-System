# Supabase RLS Audit

Status labels: SAFE means RLS and policies exist in migrations. NEEDS REVIEW means production Supabase should be checked after applying migrations. CRITICAL means launch-blocking exposure.

| Table | Has workspace_id? | RLS enabled? | Select policy safe? | Insert policy safe? | Update policy safe? | Delete policy safe? | Notes | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `profiles` | No | Yes | Own profile/member profile visibility | Own profile only | Own profile only | No normal delete policy | User-owned profile table | SAFE |
| `workspaces` | No | Yes | Workspace members only | Authenticated creator | Owner/admin update | Owner delete | Tenant root table | SAFE |
| `workspace_members` | Yes | Yes | Members of workspace | Creator owner or owner/admin invite | Owner/admin | Owner/admin | App roles live here | SAFE |
| `business_intakes` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Setup intake | SAFE |
| `workflow_maps` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Workflow map records | SAFE |
| `forms` | Yes | Yes | Workspace members; public read only when form is public | Workspace managers | Workspace managers | Workspace managers | Public policy is limited to public forms | SAFE |
| `form_submissions` | Yes | Yes | Workspace members | Members/public public-form submit | Managers | Managers | Public insert is scoped through public form lookup | SAFE |
| `checklists` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Checklist templates | SAFE |
| `checklist_runs` | Yes | Yes | Workspace members | Managers | Managers/assigned users | Managers | Run completion is scoped to assigned users | SAFE |
| `tasks` | Yes | Yes | Workspace members | Managers | Managers/assigned users | Managers | Task assignment updates remain workspace-scoped | SAFE |
| `issues` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Issue log | SAFE |
| `assets` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Asset register | SAFE |
| `asset_checks` | Yes | Yes | Workspace members | Members | Managers | Managers | Asset check history | SAFE |
| `people` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | People records include operational roles only | SAFE |
| `sops` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | SOP records | SAFE |
| `reports` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Reports are workspace-scoped | SAFE |
| `ai_agent_runs` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Vaeroex run history | SAFE |
| `notifications` | Yes | Yes | Workspace members | Managers | Members/managers | Managers | Notification history remains workspace-scoped | SAFE |
| `audit_logs` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Customer-visible audit logs; global admin uses service role | SAFE |
| `file_uploads` | Yes | Yes | Workspace members | Workspace members | Workspace members | Workspace managers | Metadata tied to private storage path | SAFE |
| `file_imports` | Yes | Yes | Workspace members | Workspace members | Workspace members | Workspace managers | Import sessions | SAFE |
| `file_import_rows` | Yes | Yes | Workspace members | Workspace members | Workspace members | Workspace managers | Import row history | SAFE |
| `crm_leads` | Yes | Yes | Workspace members | Workspace members | Workspace members | Workspace managers | CRM data | SAFE |
| `crm_lead_history` | Yes | Yes | Workspace members | Workspace members | Workspace members | Workspace managers | CRM history | SAFE |
| `operational_metrics` | Yes | Yes | Workspace members | Workspace members | Workspace members | Workspace managers | Historical business memory | SAFE |
| `record_folders` | Yes | Yes | Workspace members | Workspace members | Workspace members | Workspace admins | Folder management | SAFE |
| `record_shares` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | In-app sharing records | SAFE |
| `operational_assignments` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Accountability tasks | SAFE |
| `kpi_alert_rules` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | KPI alert configuration | SAFE |
| `kpi_alert_events` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | KPI alert events | SAFE |
| `report_subscription_preferences` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Report preferences; email delivery remains opt-in | SAFE |
| `scheduled_report_runs` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | No normal delete policy | Scheduled run history | SAFE |
| `support_requests` | Nullable | Yes | Own support requests | Anyone can create | No normal update policy | No normal delete policy | Admin updates are server-side only; workspace_id is now membership-validated | SAFE |
| `manual_activation_requests` | Nullable | Yes | Own activation requests | Own request | No normal update policy | No normal delete policy | Admin review uses service role | SAFE |
| `customer_subscriptions` | Nullable | Yes | Own/workspace subscriptions | Workspace managers | Workspace managers | No normal delete policy | Admin updates use service role | SAFE |
| `subscription_events` | Nullable | Yes | Workspace managers | Server/admin only | Server/admin only | Server/admin only | Webhook/admin event log | SAFE |
| `ai_usage` | Yes | Yes | Workspace members | Workspace members | No normal update policy | No normal delete policy | Usage records | SAFE |
| `business_decisions` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Prestige operations decisions | SAFE |
| `vaeroex_recommendation_outcomes` | Yes | Yes | Workspace members | Workspace managers | Workspace managers | Workspace managers | Recommendation outcome tracking | SAFE |

Production verification still required:

1. Run all migrations in Supabase.
2. In Supabase SQL Editor, verify `pg_tables.rowsecurity = true` for public tables.
3. Confirm `workspace-files` exists and is private.
4. Confirm no newly added table is missing from this document or `scripts/security-check.ts`.
