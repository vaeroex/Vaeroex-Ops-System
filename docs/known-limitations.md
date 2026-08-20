# Known Limitations

This document records intentional MVP boundaries and launch risks. These are not all blockers, but they should be understood before the first beta customer uses Vaeroex Ops System.

## Launch Status

Vaeroex Ops System is ready for Customer #1 once the current branch is merged and the new pre-checkout legal-acceptance migration is applied. It is not ready for broad self-serve launch until support operations, production monitoring, broader security testing, and operational runbooks are hardened beyond the first-customer path.

## Technical Validation

- `pnpm typecheck` and `pnpm build` passed locally on August 20, 2026 after dependencies were installed.
- Existing production billing remediation migrations were deployed and verified before this branch. The new pre-checkout legal-acceptance migration must be applied after merge and verified outside Production first.
- Browser testing has not been run in this environment.
- Load testing has not been performed.
- Automated test coverage is not yet present.

## Billing Flow

- Stripe Checkout is now the new-customer subscription path for Executive Intelligence.
- Existing Squarespace and manual subscription records remain supported for legacy and admin workflows.
- Stripe products, prices, webhooks, portal settings, and live event handling have been production-verified for the Customer #1 billing remediation baseline.
- Live Squarespace webhook payloads still need to be verified against real Squarespace order/subscription events.
- Manual activation remains an admin fallback for support exceptions.
- Failed payment and cancellation behavior depends on webhook payload clarity or admin review.
- Customers must use the same email for checkout and Vaeroex account creation for automatic matching to work.

## Authentication And Account Management

- Supabase Auth is implemented, but hosted email templates, support email routing, and production auth settings still need live review.
- Email invites are not fully implemented.
- Rich member management UI is not complete.
- Role management exists in schema/RLS, but a full customer-facing role administration workflow is still limited.

## Admin And Support

- Internal admin access is controlled by `VAEROEX_ADMIN_EMAILS` and server-side service role access.
- Customer impersonation is a placeholder only and must not be enabled until there is a complete audit trail, approval step, and session boundary.
- Support request file/screenshot upload is a placeholder only.
- Support request notifications are not automated; admins must review `/app/admin/support-requests`.
- Audit logs exist in schema and admin review, but not every user action currently writes an audit log.

## Vaeroex AI

- Vaeroex uses the configured server-side AI provider and `VAEROEX_SYSTEM_PROMPT`; OpenAI remains the default and fallback provider.
- The prompt is non-empty in source and guarded before key workflows.
- Token usage, latency, provider/model metadata, and estimated cost are stored when returned by the model provider; exact NVIDIA cost requires the configured cost-rate environment values.
- Vaeroex output is stored and can be saved after confirmation, but rich edit-before-save workflows are limited.
- Streaming responses are not implemented.
- Model reliability, latency, and cost have not been measured under real customer usage.

## Operations Modules

- Core Version 1 surfaces include Executive Overview, Business Health, Intelligence, KPIs, Evidence, and Saved Analyses.
- Edit/delete flows are still limited.
- Filters and saved views are basic.
- Intake and workflow editing screens remain placeholder-level.
- Public form route experience is limited and should be manually tested before relying on it.
- Storage upload implementation is not complete.

## Security And Compliance

- RLS policies are present and source-reviewed, but should be tested with separate users in a live Supabase project.
- Workspace data separation should be tested with at least two independent customer accounts before launch.
- The compliance notice warns users not to enter regulated sensitive data unless proper requirements are in place.
- Vaeroex Ops System should not be marketed as HIPAA-ready, SOC 2-ready, or regulated-data-ready without legal, security, infrastructure, and agreement review.
- No formal penetration test has been performed.
- No production incident response process has been run in rehearsal.

## Deployment And Operations

- Vercel deployment instructions are documented, but a real production deployment has not been validated in this environment.
- Environment variable changes on Vercel require a redeploy to affect deployed builds/functions.
- Custom domain setup must be completed in Vercel and DNS, then reflected in Supabase Auth and Squarespace links.
- Production observability, log drains, alerting, uptime checks, and backup restore drills are not fully configured.
- Supabase backups, retention, and restore procedures should be confirmed before customer data is stored.

## What Not To Build Yet

- Do not add more billing complexity until the Stripe subscription flow has real beta feedback.
- Do not build full impersonation yet.
- Do not build broad integrations before the core workflow proves useful.
- Do not build heavy analytics before the first beta teams reveal which metrics matter.
- Do not build regulated-data workflows yet.
- Do not build complex automation rules until forms, checklists, tasks, SOPs, and reports are proven in real use.

## Recommended First Beta Customer

Best fit:
- Small service or operations-heavy business.
- One owner/admin champion.
- 3-10 active staff.
- Non-regulated operational data.
- Clear pain around missed follow-ups, unclear ownership, checklists, SOPs, or weekly manager reporting.
- Willing to be manually activated and provide direct feedback.

Avoid for first beta:
- Healthcare workflows involving PHI/ePHI.
- Enterprise procurement-heavy buyers.
- Customers requiring SSO, SCIM, full audit export, advanced permissions, or contractual security review.
- Customers requiring deep integrations before using the core product.
