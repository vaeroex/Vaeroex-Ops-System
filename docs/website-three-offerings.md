# Vaeroex public website: three offerings

This change expands the existing public site to Intelligence Systems, Custom Business Systems, and Website Development & Enhancement. The authenticated product, subscription logic, checkout/legal acceptance flow, and entitlements are unchanged.

## Routes and content

- `/`: company overview, three offerings, actual Executive Intelligence preview and authoritative subscription price, service summaries, project process, existing veteran ownership and NVIDIA Inception membership, project inquiry CTA.
- `/intelligence-systems`: Executive Intelligence is available; Biological Intelligence and Drug Discovery Intelligence are secondary, Planned entries with no capabilities, release dates, or purchase links. Their existing retired detail routes remain unchanged.
- `/custom-business-systems` and `/website-development`: informational service pages with scoped capabilities and category-prefilled contact links. These pages accept no project payments and inquiries create no service contracts. Scope, fees, payment schedule, maintenance, ownership or licensing, delivery, cancellation, and handover are defined in an individual written project agreement before work begins. The same notice appears with custom-project pricing and project inquiry fields.
- `/executive-intelligence`: actual workspace previews follow the introduction; conceptual animation is removed from this route. Supported integrations and limitations, fictional-data labels, product capabilities, and signup remain intact.
- `/pricing`, `/about`, navigation, footer, metadata, organization description, and sitemap reflect all three offerings.

## Inquiry data path

The public form calls `createContactRequestAction` in `app/support/actions.ts`, which uses the same internal submission function as the existing `createSupportRequestAction`. The existing support action retains its redirect contract.

Both paths retain bounded strict Zod validation, strict rate limiting, verified workspace association, insertion into `public.support_requests`, and the existing security audit event. No email transport, new destination, table, migration, or new credential is introduced. Existing admin support tooling reads this queue.

The seven contact categories are Executive Intelligence, Custom Business Systems, Website Development / Enhancement, General Inquiry, Support Request, Billing or Subscription, and Strategic Partnership. Legacy category values remain accepted by the shared support schema.

Only project inquiries append tools/website, budget, and timeline to the stored message. Expected users is included only for custom business systems. These fields and business name are optional. Budget options are intake ranges, not advertised service prices. Query parameters select a category from an allowlist; they cannot display a success message. Success requires a returned inserted request ID.

The form preserves entered fields and category after errors, announces/focuses feedback, associates field errors with inputs, and disables duplicate submissions while pending. Unconfirmed network outcomes tell visitors to check via direct email before retrying.

## Configuration and verification limits

This isolated checkout does not load `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY`. A real local submission therefore returns an unavailable message and the existing direct email links. This is a local verification limitation, not evidence that production is misconfigured.

Deployment must retain the site's existing Supabase configuration and support/rate-limit/audit schema. The URL and server-only service-role key are required for saving requests; the public anon key enables the existing signed-in context. Never expose the service-role key to the client.

Successful inserts and all failure branches were verified with isolated mocks of the existing destination. Browser submissions used synthetic data against the credential-free localhost server only. No production rows or test emails were created.

## Policy language requiring owner review

The existing legal documents in `lib/legal/content.ts` were preserved. Before selling commissioned services, review these scope mismatches rather than assuming subscription rules define project terms:

- Terms of Service, Description of Service: describes intelligence systems and Executive Intelligence, without commissioned systems or website development.
- Terms of Service, Incorporated Policies: incorporates subscription policies; an existing written-agreement clause does not itself establish project-specific terms.
- Terms of Service and Refund Policy, Final and Non-Refundable Payments: the wording “All purchases and subscription payments” is broader than the surrounding subscription context. Its intended application to development deposits and project payments needs an explicit business decision.
- Subscription pricing, renewal, cancellation, and price-protection language concerns the product subscription. The new marketing copy distinguishes custom development and monthly maintenance proposals, but does not decide their contractual cancellation or refund rules.
- Privacy Policy, Information We Collect and related sections: describes platform and support data. Review coverage of project intake details (business, tools/URL, expected users, budget, timeline) and commissioned-project data handling.

No deposit percentages, project prices, response-time guarantees, unlimited support, ownership/licensing terms, or new contractual policies were invented.

### Informational release boundary and proposed minimal policy clarification

For this release, the new service pages collect inquiries only. They have no project-payment or contract-acceptance flow. Executive Intelligence checkout and its subscription policies are unchanged.

The phrase “All purchases and subscription payments” in Terms, Refund Policy, and Subscription and Billing Terms is still broader than its subscription context. There is no project payment in this release to which a refund rule could attach, but the text should not be relied on to establish future commissioned-project terms.

Proposed clarification for owner review, not applied to versioned legal documents: “These subscription payment and cancellation provisions apply to Executive Intelligence. Project inquiries do not create a purchase or service contract. Scope, fees, payment schedule, maintenance, ownership or licensing, delivery, cancellation, and handover for commissioned work are defined in an individual written project agreement before work begins.” Preserve the separately applicable Workspace Capacity Terms. Review the exact placement and policy-version/acceptance impact before publication; do not rewrite the existing product refund, price-protection, or cancellation commitments.

Remaining policy issue: the existing blanket wording has not been narrowed in the legal documents. Approve the scope clarification or explicitly defer it for this inquiry-only release before lifting the release hold. Any later project-payment or contracting flow requires its agreed terms first.

## Validation

- TypeScript and production Next.js build.
- Changed-source and changed-test ESLint checks with zero warnings.
- Full public regression suite: inquiry routing, server-rendered pages, canonical metadata, subscription policy/capabilities, image provenance and integrity, retained animation modules.
- Eleven existing admin support tests and adversarial regression tests.
- HTTP 200 on all eight updated routes; 34 unique internal link targets resolve; new routes appear in the sitemap.
- Browser layout checks at 320, 390, 768, and 1440 pixels: one H1 per route and no horizontal overflow.
- Desktop/mobile navigation, Escape dismissal, service-to-inquiry prefill, conditional fields, pending state, failure feedback, and retained input after failure.

Repository-wide ESLint has existing warnings in unrelated files, which cause its zero-warning command to fail. The modified files pass their targeted checks. See the task's verification report for the final result and deployment status.
