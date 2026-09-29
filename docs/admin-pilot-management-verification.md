# Admin pilot-management follow-up

## Read-only deployment comparison

Observed September 29, 2026:

- Production `dpl_C3UcjPd21NSx7TYnN39eQHZKD3xj`: merge `0a7a97de6cf757e10f8e8ea77162b75cd912cda9`.
- PR #445 preview `dpl_7tuRiBSLhiZQRioGDH2DNBZDtXBp`: `5a989f8c376e6cabae514ee718ea974c3452f865`.
- Both have tree `4998762ce03a6b242fc0efb3fddf65d999f0142d`: no application-code difference.
- Live was the Demo Workspace's Subscription records tab. Preview was a different test workspace's Overview tab. The live workspace ID returned not-found on preview; its own test workspace was available. Both sessions could view Admin. No evidence of a permission-driven layout difference.
- The viewports also differed (1440 × 1000 versus 581 × 784). Earlier screenshot comparisons used synthetic records, not the live customer state.

This follow-up is not deployed. Same-data comparisons use the same synthetic owner, contact, workspace, expired manual record, selected tab, and viewport; only the component checkout differs. The local preview blocks external connections and substitutes actions with in-memory responses. It does not qualify hosted authorization or database writes.

## Demonstrated fixes

- Mobile Admin links had widths smaller than their text (e.g. Dashboard 55 px versus 132 px of content). Nonshrinking links remain horizontally scrollable without overlapping.
- Business overview separates the actual loaded owner membership, workspace access settings, and billing record. Primary contact is retained in details rather than presented as the owner.
- Archive is present on Overview; active/pending accounts show a disabled action and reason. Existing confirmation and server-side lifecycle guards are unchanged.
- Pending activation decisions are no longer buried with previous requests. Resolved requests remain history, not a second access-revocation control.
- Review correction: pending/needs-information requests are queried separately before the 12-row limit, so newer resolved requests cannot hide an older decision. A regression executes the page with twelve newer resolved requests and two older unresolved requests.
- Review correction: blocked Archive explains the actual workspace/subscription `manual_review` state; it does not assume an activation request exists.
- Manual saving previously selected the newest subscription by email alone. Selection now also requires the exact workspace (or an explicitly unlinked record), manual provider, and manual activation. It cannot retarget another workspace's record or convert a Stripe record.
- Both subscription actions check the workspace write result, including missing returned rows. Partial success is an error with explicit retained-record information, not a claim that access was granted. There is no automatic retry or compensating mutation. The two writes are still not atomic.
- Manual creation explicitly requires a subscription for its selected workspace. An inactive manual record and disabled unlock do not silently leave subscription-free access enabled.
- Pilot wording does not require a purchase or claim that a request grants access. Manual pilot records have no automatic expiry. End the manual record and verify workspace settings; another eligible Stripe subscription or trial can still allow access.

## Verification boundaries

- Local typecheck, changed-file lint, security checks, manual-activation and Admin regressions are required.
- The exact three user-approved pilot paths remain the only new scope allowances; the architecture count is 242 and neighboring files remain rejected. Sixteen action/page regressions and 547 architecture assertions pass locally after the review corrections.
- Real exported Server Actions and entitlement evaluation run with disposable in-memory rows, ordinary non-admin customer identity, and a separate administrator. Covers workspace targeting, active/expired manual entitlement, Stripe/other-workspace preservation, read failures, rejected second write, and no blind retry.
- Existing PostgreSQL activation qualification now includes first-time unlinked manual eligibility and preservation of the other workspace. It runs as its own CI step after successful isolated setup even if an earlier unrelated suite fails. It does not waive that suite's failure.
- Browser synthetic checks cover layout, navigation, pending submission, readable failure, blocked Archive, and retained history. They do not create real logins or change real customer records.
- **Not yet a complete ordinary-account end-to-end signup result:** this Mac has no usable local Supabase/Docker test runtime. Existing hosted previews contain real retained account records and have not been treated as disposable. Email confirmation, actual Auth signup, the signed-agreement/PDF setup path, and final browser entry to a newly created workspace need a disposable Auth/API test environment. SQL and mocked actions must not be represented as that result.
- Request approval retains the existing email-based RPC routing. It may select an existing manual entitlement/owner workspace or leave a first-time entitlement unlinked for setup; it is not an explicit administrator workspace selector. Do not imply that a request shown under a contact email is bound to the open workspace. A future explicit-target approval would require a narrow transactional RPC change and database approval, not a client-side label alone.

## Unsupported controls — not implemented or displayed as working

- **Disable/re-enable login:** would need a separately authorized, audited server-only identity action, session-revocation behavior, and protection for the final administrator. It affects that person across all workspaces, not only this business. It must not silently cancel subscriptions, delete saved data, or claim provider credentials were revoked.
- **Remove one workspace membership:** would need a workspace-scoped audited action and last-owner protection. The login and other memberships remain; billing/data/connectors need explicit treatment rather than implied deletion.
- **Permanent deletion:** needs an explicit retention/ownership impact check, separate treatment of other workspace memberships, billing and connected services, and an irreversible confirmation. Archive is only reversible Admin-list visibility, not a substitute.

## Separate unfinished work

Real upload/import, real-record Saved Analyses details, the unavailable Saved Analyses count, and cross-page browser-Back reset are not qualified by this release. No migration, provider call, credential change, deployment, or Production account mutation is included.
