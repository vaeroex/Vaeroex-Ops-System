# Customer Data Safety

Vaeroex is an operations support platform. Workspace records are intended for business operations, tasks, SOPs, checklists, files, reports, KPIs, CRM, and internal follow-up workflows.

## Workspace Isolation

- Customer records must include `workspace_id` when they belong to a workspace.
- App pages and server actions must use the active workspace context.
- Supabase RLS must stay enabled for tenant-owned tables.
- Files must stay in the private `workspace-files` bucket and use workspace-prefixed paths.

## Sensitive Data Notice

Do not enter:

- Patient data.
- PHI or ePHI.
- Social Security numbers.
- Medical record numbers.
- Insurance IDs.
- Regulated healthcare data.
- Other regulated sensitive data unless Vaeroex has a proper legal, security, and compliance setup for that use case.

## Vaeroex Output

- Vaeroex output is a draft or recommendation.
- A human should review AI-generated reports, SOPs, tasks, and recommendations before using them.
- Vaeroex is not legal, medical, financial, tax, or compliance advice.

## Customer-Facing Tone

Customer-facing safety notices should be clear and professional. They should help users understand what belongs in Vaeroex without making normal business users feel blocked or alarmed.
