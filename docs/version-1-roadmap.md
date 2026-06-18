# Version 1 Roadmap

This roadmap keeps Version 1 focused on reliability, activation, and the smallest set of improvements needed to learn from early customers. It intentionally avoids major new product bets until the beta flow is proven.

## Version 1 Goal

Help small operations-heavy teams turn forms, checklists, tasks, issues, SOPs, reports, and Vaeroex recommendations into a usable weekly operating rhythm.

## Launch Readiness

Current status:
- Core MVP source is in place.
- Pre-launch manual testing is still required.
- First launch should be a controlled beta, not open self-serve.

Release gate:
- `pnpm typecheck` passes.
- `pnpm build` passes.
- Supabase migrations apply cleanly.
- Customer flow passes from Squarespace purchase through Vaeroex report generation.
- Admin flow passes from customer lookup through activation, support review, and AI usage review.
- RLS separation is tested with at least two customer accounts.

## Milestone 1: Controlled Beta

Focus:
- Get 1-3 beta customers activated manually.
- Watch them complete setup and run their first Vaeroex audit.
- Validate whether starter forms/checklists/SOPs match real workflows.

Must-have work:
- Complete manual test script in `docs/manual-testing-script.md`.
- Confirm Squarespace purchase and manual activation process.
- Confirm support request flow and internal admin review.
- Confirm OpenAI latency, cost, and output quality.
- Confirm no blank Vaeroex prompt and no exposed server keys.
- Verify custom domain, Supabase Auth callback, and Squarespace thank-you links.

Do not add:
- Stripe checkout.
- Full impersonation.
- Large integrations.
- Advanced dashboards.

## Milestone 2: Beta Stabilization

Focus:
- Reduce support friction.
- Fix bugs found in the first beta.
- Improve the workflows customers actually use.

Likely work:
- Add automated tests around workspace creation, subscription gating, and Vaeroex save confirmation.
- Add better validation messages for setup and core operations forms.
- Add support request notifications to internal admin email or a lightweight support inbox.
- Add richer error logging for Vaeroex failures and Squarespace webhook processing.
- Add real token usage/cost capture from Vaeroex model responses.
- Improve public form submission experience.
- Add edit flows for the highest-use modules.

Success signals:
- Customer can complete setup without live assistance.
- Customer runs at least one Vaeroex audit and saves one SOP/report.
- Admin can resolve subscription/support issues without database edits.

## Milestone 3: Version 1 Hardening

Focus:
- Make the product safer and easier to operate before more customers are invited.

Likely work:
- Add automated end-to-end tests for customer and admin flows.
- Add audit log writes for important server actions.
- Improve role management UI.
- Add backup/restore runbook.
- Add production monitoring and alerting.
- Add rate limiting for public and AI-heavy routes.
- Improve RLS test coverage.
- Add clear account/subscription status copy for blocked customers.
- Add customer-facing release notes or changelog.

Success signals:
- No cross-tenant data leakage in manual RLS tests.
- Support activation time is under one business day.
- Vaeroex run failures are visible and actionable.
- Admin can confidently diagnose subscription and support problems.

## Milestone 4: Version 1 Expansion

Focus:
- Expand only where beta usage proves demand.

Possible work:
- Saved views and filters.
- Better checklist run workflows.
- SOP approval workflow.
- Task assignment notifications.
- Public form share pages.
- File uploads for support and operational records.
- Basic integrations chosen from beta feedback.
- Optional annual plan mapping for Squarespace products.

Decision rule:
- Build expansion items only when at least two beta customers ask for the same workflow or support data shows a recurring blocker.

## What Not To Build Yet

- Internal checkout or Stripe billing.
- Full customer impersonation.
- Healthcare/regulated-data workflows.
- Enterprise SSO/SCIM.
- Deep CRM/accounting/project-management integrations.
- Complex automation builder.
- Heavy analytics suite.
- Native mobile app.

## Recommended First Beta Customer Type

Prioritize:
- Small service company, field team, construction company, automotive shop, fitness studio, or internal admin operations team.
- One owner/admin champion who can make process decisions.
- 3-10 staff.
- Existing pain with missed follow-ups, unclear ownership, incomplete checklists, SOP drift, or weekly reporting.
- Low compliance risk and no regulated sensitive data.

Avoid first:
- Customers requiring procurement/security review.
- Customers that need PHI/ePHI handling.
- Customers whose first requirement is integrations.
- Customers expecting fully automated billing and self-service subscription management.

## Version 1 Exit Criteria

- At least 3 beta customers activated.
- At least 2 customers complete setup without direct database intervention.
- At least 2 customers run Vaeroex and save an SOP or report.
- No confirmed tenant data separation issue.
- Admin support queue has clear ownership and response process.
- Known limitations are reviewed and accepted before inviting more customers.
