# Demo Workspace Isolation Audit

| Requirement | Current control | Status |
| --- | --- | --- |
| Demo workspace clearly labeled | Workspace `subscription_status = demo` and dashboard demo banner/counts | SAFE |
| Demo data isolated | Demo generation writes every record with the demo workspace ID | SAFE |
| Demo reset isolated | Reset deletes the demo workspace shell by ID and rebuilds it | SAFE |
| Demo does not modify real workspace | Workspace switcher sets active workspace cookie; module queries filter by active workspace ID | SAFE |
| Real data does not appear in demo dashboard | Dashboard queries are scoped to active workspace ID | SAFE |
| Demo files remain isolated | File metadata and storage paths include demo workspace ID | SAFE |
| Demo notifications are workspace-scoped | Notifications include workspace ID and are only read by workspace queries | SAFE |
| Demo emails are not sent | Real outbound email is not implemented; report subscriptions remain in-app/generated records | SAFE |
| Admin demo reset/fresh controls | Fresh/reset actions require `isVaeroexAdminUser` | SAFE |

Manual test:

1. Open a real workspace and record counts for KPIs, CRM, reports, files, tasks, issues, SOPs, and notifications.
2. Switch to the demo workspace.
3. Confirm the dashboard banner says demo workspace and counts differ.
4. Create or reset demo data.
5. Switch back to the real workspace.
6. Confirm real workspace counts did not change.
