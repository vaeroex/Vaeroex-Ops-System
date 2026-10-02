# Google Sheets erasure release plan

Review draft, October 2, 2026. Product: **Vaeroex Ops System**; assistant: **Vaeroex**.
Accountable internal owner: **isaac@vaeroex.com**. Public request channel:
**support@vaeroex.com**; delivery and monitoring confirmation are outstanding.
Documentation/audit reference: [PR #457](https://github.com/vaeroex/Vaeroex-Ops-System/pull/457).
PR #457 is the docs/audit PR, not the erasure implementation. This separate
implementation candidate is on `codex/google-sheets-erasure`.

## Release decision and evidence boundary

**INCOMPLETE; do not merge, apply, deploy, or operate this candidate yet.** Keep
deletion-completion claims, Limited Use attestation, and Google submission blocked.
An implementation PR or an owner signature alone does not establish a working
deletion service. No customer data has been erased and no Production restore or
schema change has been performed.

Durable audit inputs at the exact documentation head:
[retention review](https://github.com/vaeroex/Vaeroex-Ops-System/blob/39a096d2a379db38f2c75e9087cea880f9f1e595/docs/google-sheets-retention-technical-review.md)
and [verification packet](https://github.com/vaeroex/Vaeroex-Ops-System/blob/39a096d2a379db38f2c75e9087cea880f9f1e595/docs/google-sheets-google-verification-packet.md).
They describe application source `f564108517cc165b858b0c14a48ca4942a53de05`, also
this implementation's base. Their live observations are inherited evidence, not
fresh Production checks in this implementation.

### Implemented and tested boundary

- Forward-only candidate migration:
  `20261002225025_google_sheets_support_erasure.sql`. It creates a forced-RLS
  private approval-request relation and read/confirm RPCs. Authority is verified
  through the existing live signed-session and active workspace-owner contract.
  Ordinary application and service roles cannot prepare a request or change its
  scope. No destructive executor, history-trigger exception, support login,
  revocation change, retention expiry, or worker configuration is installed.
- An owner can review a prepared request at
  `/app/settings/integrations/google-sheets/erasure/[requestId]` and explicitly
  approve the exact mixed-artifact list. GET does not mutate anything. Confirmation
  is same-origin POST using the end user's authenticated client, not service role.
  Approval alone does not disconnect or erase data. No operational request can
  currently be prepared through this candidate.
- The offline signed-journal library contains only strict ID/count manifests,
  not imported values, payloads, credentials or requester email. It is not a
  deletion executor or an activation gate, and signing a manifest grants no SQL
  authority. No operational key or external journal has been provisioned.
- The exact-row deletion capability is a **synthetic test fixture only**, using
  two minimal protected tables in ephemeral PGlite. It is not installed by the
  migration. Its queued replay test is not real multi-session deletion concurrency.

### Remaining implementation blockers

1. The first destructive draft and broader inventory draft were rejected by the
   safety review and were not saved or applied. Do not recreate their broad
   workspace/table predicates or bypass the decision. An exact-row alternative
   needs reviewed table/row/old-content-hash authorization before integration;
   ordinary-role immutability must remain intact.
2. Exact Google-derived inventory and dependency-ordered erasure are not finished.
   Include source versions, mappings, fact links, retired KPIs, archived/deleted
   analyses, reports, memory, and attributable copies. Absent UUID provenance is
   not evidence that a narrative is unrelated. Mixed narratives require specific
   artifact approval; never scan/delete every workspace row merely because its
   table could contain Google data. Unknown/manual copies must be surfaced for
   review, not silently counted as erased.
3. Sheets' existing workspace lock does not fence downstream analysis writers.
   A request can read a KPI before erasure and persist an analysis afterward.
   Provider timeout values are not a verified process-drain bound. A demonstrable
   maintenance/drain barrier or complete read/write fencing is required before
   destructive execution. An operator checkbox or arbitrary waiting period is
   insufficient. This must also cover restored applications before customer access.
4. Canonical disconnect/revocation integration, cross-store crash recovery,
   completion receipts, residual-copy checks, and externally anchored restore
   replay are not integrated. Pending journals must survive uncertain commits;
   retries must reconcile instead of silently starting a new erasure.
5. Synthetic end-to-end erasure, unrelated Square/QBO and cross-workspace
   preservation, concurrent writer rejection, restart/retry, and restore replay
   qualification remain required. Approval concurrency and journal integrity alone
   do not satisfy these tests. Retention expiry remains a separate unimplemented
   requirement, not something an owner attestation can waive. Signed record
   integrity also cannot detect removal of every file for a request; restore must
   reconcile against an independently retained authoritative request inventory.

### Focused checks and reproduction

No live provider/model calls are made by these synthetic checks. These are not a
full canonical bootstrap or evidence that the complete erasure workflow works.

| Check | Result / scope |
| --- | --- |
| `node scripts/google-sheets-erasure-data-tests.cjs` | 82 existing connector checks plus 25 approval/database checks passed before the crash. Actual candidate migration; no destructive executor. |
| `node scripts/google-sheets-erasure-capability-tests.cjs` | 57 isolated proof checks passed after resume, including 42 expected denials. Two fixture rows deleted, with rollback/replay. Minimal invented tables, not deployed schema. |
| `node --test scripts/google-sheets-erasure-journal-tests.cjs` | 25 tests passed after resume. Synthetic keys/storage only; does not execute SQL or restore a database. |
| `GOOGLE_SHEETS_ERASURE_BROWSER=1 node --test scripts/google-sheets-erasure-approval-tests.cjs` | 14 passed, zero failed/skipped: 13 page/route checks and one hydrated desktop/mobile check. No browser errors or horizontal overflow. Synthetic authentication/RPC fixtures only. |
| `GOOGLE_SHEETS_TEST_PG_BIN=/absolute/path/to/local/postgresql/bin node scripts/google-sheets-erasure-concurrency-tests.cjs` | Native PostgreSQL 17.6 before crash: one authoritative approval mutation and one concurrent idempotent loser; 3 assertions. Private disposable Unix-socket database, no remote connection. **Not destructive erasure concurrency.** |
| TypeScript | `tsc --noEmit --incremental false` passed after resume using the exact frozen-lockfile dependencies. |
| Focused ESLint | All new TS/TSX/CJS implementation and test files passed with zero warnings after resume. |

Desktop/mobile screenshots are retained in the ignored local directory
`outputs/google-sheets-erasure-approval/`, outside temporary storage. Review of
the approval-only SQL found no actionable security issue within that limited
boundary. Its stored scope hash still depends on an as-yet-unimplemented trusted
preparation contract; it is not proof of inventory completeness. React review
confirmed server-side owner verification, no service credential in the client,
explicit submission, duplicate-submit guard, disabled pre-hydration submission,
and focused status/error feedback.

The package scripts `test:google-sheets-erasure`,
`test:google-sheets-erasure-browser`, and `test:google-sheets-erasure-concurrency`
reproduce these focused checks. The standard hosted workflow registers the
embedded database, approval, journal and synthetic browser checks. Native
concurrency requires an explicit local PostgreSQL binary directory and never a
Production database URL. Its test harness creates no TCP listener.

### Deployment sequence after blockers are resolved

1. Review the completed exact candidate and synthetic evidence; keep Google
   submission and public deletion promises blocked until then.
2. Review the one forward-only migration's final contents/hash and normal dry run.
   No historical migration rewrite, disabled triggers, or application-role erasure
   grants are permitted. Obtain separate Production application approval.
3. Provision the restricted support identity and protected external journal/key
   with independently pinned verification metadata through private tooling. Rehearse
   the maintenance/drain and isolated-restore barriers using synthetic data first.
4. Deploy the completed owner approval/support flow after schema verification.
   Preserve the existing OAuth client, callback, credentials and scopes. No live
   erasure, backup restore, Google attestation or policy publication is authorized
   by this implementation PR.
5. Publish only statements supported by deployed behavior and approved retention
   and processor decisions; then prepare the final synthetic verification video.

### One bounded production metadata attempt

On October 2, one supported, read-only Vercel `get_project` request targeted
`prj_J810bZ9ECoN4CyLKujUoEEH8N6ja` in
`team_uORtrMvad77Qz6HikOgD4cnp`, identified in existing repository documentation as
the production project. The connector returned `isError: true`; no usable project
or provisioning metadata was obtained. This does not establish whether a private
provisioning record exists. No retry, authentication flow, environment fetch,
decryption, key inspection, or model request followed.

| Evidence | What can be concluded |
| --- | --- |
| Prior Vercel metadata: Production `OPENAI_API_KEY` and `NVIDIA_API_KEY` are Sensitive; policy selectors are Sensitive | Entries exist. Plaintext was intentionally unavailable. Presence does not prove enabled execution paths, account identity, or actual processing. |
| Prior browser observation: `org-CGjqrsh1lZbtcfKfvfrGqoLe`, project `proj_fK5VqmVCKiL0uV6BNBzfv3jo` | Feedback, evaluation/fine-tuning, and API input/output sharing were Disabled; project showed Standard Retention and per-call logging. **Binding to the production key remains unproven.** |
| Read-only source inspection: `lib/ai/providers/workflow-provider-policy.ts` and `openai-provider.ts` | Supported briefing policy uses OpenAI and passes `store: false` to Responses. Other policies include NVIDIA routes. Source capability does not establish production selectors or Google-data reachability. |
| This attempt | Production OpenAI organization/project, effective retention controls, and complete enabled-provider list remain **unverified**. No OpenAI-only or zero-retention claim is supported. |

### Controlled known-project replacement: review only

If the owner cannot supply an existing non-secret provisioning chain, prepare a
separate, approved credential change with these acceptance conditions. Nothing in
this draft authorizes its execution.

1. Select an owner-controlled OpenAI organization/project intended for production.
   Record its IDs, accountable owner, effective project retention setting and any
   inheritance/override, all three sharing settings, relevant terms, and dated
   evidence. Do not assume the previously inspected Default project is suitable.
2. Before issuing a replacement, approve an explicit workflow/provider matrix for
   every route that can receive Google-derived context, including fallback,
   embeddings and user-copied derivatives where applicable. Bind it to the release
   SHA and non-secret configuration record. Any NVIDIA route requires its own
   account, recipient, training, human-access and retention review, or a separately
   implemented and verified exclusion of Google-derived input. An OpenAI key
   replacement does not establish or disable NVIDIA routing.
3. Under that separate change, provision a dedicated, least-privilege service
   credential in the known project and place it into the exact Vercel Production
   binding through the supported secret channel. Record OpenAI key-record ID,
   organization/project IDs, Vercel environment-record ID/target, change ticket,
   timestamp, operator and deployment ID. Never put key values in tickets, logs,
   this document, screenshots or chat. A matching name, usage pattern, or key
   prefix is not sufficient binding evidence.
4. Review rollout and rollback before execution. Use a later authorized synthetic
   check without Google/customer data to qualify the deployed binding and effective
   routes. Account for deployments/workers still holding the old credential; retire
   it only after checking other consumers. Rollback must not silently restore an
   unverified processor route. Keep the submission gate closed if evidence fails.

## Current official requirements

Official pages below were opened on October 2, 2026. These are policy requirements
and provider documentation, not evidence of Vaeroex's account configuration.

- [Google Workspace user data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
  (page updated September 3, 2026) requires honoring deletion requests and providing
  deletion help. Limited Use applies to derivatives from Sensitive as well as
  Restricted scopes. Transfers require a permitted purpose and applicable consent;
  human access is separately limited. Generalized model training is prohibited.
  Its permanent-copy/database and cache-header warning means immutable provenance
  is not an exemption. A finite duration alone does not establish permission for
  the proposed normalized reporting history; resolve ambiguity with Google before
  attesting.
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
  requires accurate, accessible disclosure of collection, use, storage and sharing,
  with notice and consent for changed uses. Limited Use includes aggregated,
  anonymized and derived data. Review recipient contracts and staff access against
  those limits, not merely the choice of OAuth scope.
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
  state that API content is not used for training by default, absent opt-in.
  Standard abuse-monitoring logs can include content and last up to 30 days, with
  longer legal or harm-prevention exceptions. Application-state retention is
  separate: Responses are stored by default or with `store: true`; `store: false`
  is not Zero Data Retention. ZDR/Modified Abuse Monitoring require approval and
  effective organization/project controls; endpoint and feature exceptions remain.
  Check the actual models, caching and tools before promising a duration. Current
  docs describe prompt-cache state up to 24 hours. No production entitlement was
  proven here.

## Proposed short retention schedule

These are **owner decisions for review, not current enforcement or Google-approved
safe harbors**. Adopt only after purpose/terms review and implemented expiry across
all identified copies. A deletion request can shorten these periods. Existing
history needs an explicit transition decision and notice where required; do not
silently delete it by approving this document.

| Data | Proposed limit and clock | Reason / enforcement condition |
| --- | --- | --- |
| Raw Sheets responses and preview cache | Request/session only; no durable response copy. Respect any shorter cache restriction. | Setup and validation do not require an archive of raw payloads. Confirm logs, traces and error capture omit them. |
| Connection configuration and current approved mapping | While an authorized connection needs them; remove unnecessary disconnected configuration within 7 days. | Needed for sync. Retain only minimal referenced approval/provenance within the observation limit below; disconnect is still not full erasure. |
| OAuth credentials | Active access only; delete upon successful revocation. Escalate failed revocation within 2 business days, with reads fenced. | Retry state must have an owner and case-specific resolution, not indefinite silent retention. No fixed successful-revocation time is promised. |
| Superseded source values and obsolete mappings | 7 days after supersession, or earlier erasure. | One weekly correction cycle. Remove/redact dependent old-value copies or expire the affected artifact too; an FK or immutable trigger cannot extend this limit. |
| Normalized reporting observations and necessary provenance | 90 days from first import of the observation. Refresh, copying and re-import must not reset its expiry. | Short operational comparisons; longer annual history needs a separate justified decision. Old observations cannot be kept indefinitely by repeated sync. |
| Unsaved generated analyses | 7 days from generation, or earlier source expiry/erasure. | Brief review window. Removing display access or a run flag alone is insufficient. |
| Explicitly saved analyses | 90 days from saving, capped by the earliest expiry of included Google-derived content. | Deliberate short-term reporting. Mixed-source content needs identified redaction or authorized artifact removal, not deletion of unrelated source records. |
| Sync/security diagnostics | 14 days from event; no cell values, payloads, credentials or unnecessary source identifiers. | Two weekly troubleshooting cycles. Exceptions require a documented specific incident/purpose, restricted access and end date. |
| Erasure support receipt | 30 days after case closure; random case ID, action timestamps, counts and outcome only. | Short dispute/reconciliation window. Remove requester/contact and source detail when no longer necessary; hashes and linked IDs are not automatically anonymous. |
| Restore replay manifest | Until every affected restore point and controlled export has expired or been sanitized; review weekly. | Minimal protected selectors needed to prevent resurrection, held outside restorable application backups. Remove when replay is no longer needed. |

No blanket legal hold is proposed. The owner must identify a specific obligation,
affected fields, access restriction, review/end date and requester explanation for
any exception. Expiry must cover derived JSON/text, archived/soft-deleted records,
caches, explicitly identified re-uploads, and controlled exports. Do not infer
that every memory/search record is derived from Sheets.

## Backups and restore controls

The prior review observed Pro daily physical backups for Production
`mdiianhfrojmxqpwrflh`, with entries September 25 through October 2 and no PITR
enabled. These settings were not re-inspected here.
[Supabase's current backup documentation](https://supabase.com/docs/guides/platform/backups)
describes **seven-day availability** of Pro daily backups. It does not establish a
hard seven-day per-request erasure SLA or internal-media destruction deadline.
Database backups exclude Storage object content; independently retained files,
exports and log drains require their own inventory. The changelog index was
eventually read during the audit; no Production platform change was performed.

For each request, record active-store completion separately from remaining
backup/processor status. Track the last affected restore point and observed expiry.
Implement an isolated restore procedure that fences customers, workers, schedules,
and outbound integrations; applies the externally retained erasure manifests;
verifies targeted content and credentials cannot return; then permits activation.
Qualify it with a disposable, synthetic restore. Do not restore production or
delete shared backups to fulfill an individual request. Missing export inventory
or replay evidence remains a release blocker.

## Conditional public wording

**Unpublished draft.** Use the following only after the owner adopts the schedule,
the parent verifies enforcement and complete erasure, mailbox and restore controls
pass, and every reachable processor is qualified. Replace the processor sentence
with an exact verified list and applicable retention notice before publication;
do not publish a placeholder or imply NVIDIA is absent. Reconcile with the prior
packet's fuller access/use notice and existing legal-version acceptance process.

> Vaeroex Ops System reads the Google spreadsheet you configure, its worksheet
> details and headings, and the metric columns you approve. Imported business
> metrics support Performance and requested analysis. Vercel hosts the application
> and Supabase stores workspace data. [Insert the verified model-processor names,
> affected analysis features and linked retention terms here.] Disconnect stops
> future sync and requests access revocation; stored credentials are deleted when
> revocation completes. Disconnect does not by itself erase imported history.
>
> We keep imported reporting observations for up to 90 days from first import,
> superseded source values for up to 7 days, and operational diagnostics for up to
> 14 days. Unsaved analyses last up to 7 days; saved analyses last up to 90 days
> and expire sooner when their Google-derived source content expires. Repeated
> synchronization does not extend these limits. Necessary connection settings
> remain while the connection is active. Our retention notice explains related
> configuration, deletion receipts and any specific retention exception.
>
> To request deletion, contact support@vaeroex.com from your account address with
> the workspace and connection name and whether you want disconnection, erasure,
> or both. Do not send sheet contents or credentials. We verify your authority and
> the scope, then remove affected imports, mappings, provenance and identified
> derived copies from active storage. We explain any mixed-source artifact that
> needs removal or redaction and any remaining restriction. Hiding or archiving
> a record is not erasure.
>
> Restricted backup copies may remain until their restore points expire. Completed
> erasures are reapplied before restored data becomes available. Processor
> retention is separate; we report remaining backup and processor status with
> your request. We do not promise that all copies disappear within seven days.

After qualification, the Limited Use statement can read: "Vaeroex Ops System's
use and transfer of information received from Google APIs complies with the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including its Limited Use requirements, and the applicable
[Google Workspace user data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).
We do not use Google-derived information for advertising, sale, credit decisions,
or generalized model training." This statement is not adopted or attested here.

The existing Connect/Reconnect disclosure must explain retained history, actual
recipients and deletion before consent. Preserve deliberate mapping approval.
Vaeroex outputs remain drafts/recommendations requiring confirmation before record
changes. Do not collect patient data, PHI/ePHI, SSNs, medical record numbers,
insurance IDs or regulated healthcare data.

## Exact remaining owner actions

All actions below remain outstanding. **isaac@vaeroex.com** is the proposed
internal owner; engineering acceptance is separate from owner policy decisions.

1. **Confirm request handling.** Record a dated owner-operated delivery/reply check
   for `support@vaeroex.com`, who monitors it each business day, a named backup
   reviewer and escalation coverage. Suggested internal targets: acknowledge
   within 2 business days; complete active-store erasure within 7 calendar days
   after identity and scope confirmation. These are proposals, not public SLAs;
   record receipt immediately and track any earlier applicable deadline rather
   than restarting its clock. This sidecar sent no email and tested no mailbox.
2. **Approve or revise the schedule.** Sign off each purpose, duration and clock,
   old-data transition, mixed-source treatment, receipt/manifest storage and any
   specific exception. Resolve Google's permanent-copy/reporting-history question
   before attestation; this document supplies no exception or legal conclusion.
3. **Close processor identity and routing.** Supply the non-secret original
   provisioning chain, or separately approve the controlled replacement above.
   Record effective production org/project controls, recipient contracts and a
   complete enabled-route/fallback matrix. Approve actual recipient wording only
   after that evidence; preserve the unknown status until then.
4. **Review complete implementation evidence, when available.** Require exact release
   SHA, migration status and focused results proving authorized workspace-scoped
   inventory/erasure, revocation retry and worker fencing, idempotency/rollback,
   removal of downstream copies, mixed-source handling, unchanged unrelated
   workspaces/providers, and ordinary-role immutable-history/RLS protections.
   Require expiry enforcement as well as request-driven erasure. The focused
   partial results above do not satisfy this gate; docs/audit PR #457 does not
   implement it either.
5. **Qualify recovery and remaining copies.** Assign the protected external replay
   manifest, export/log inventory and expiry follow-up to an owner. Obtain the
   disposable restore evidence, including credential non-resurrection and the
   activation fence. Keep active-store, backup and processor completion distinct.
6. **Approve operational readiness.** Have the parent/operator rehearse a synthetic
   request from receipt through authority verification, reviewed manifest,
   explicit confirmation, supported erasure, residual inventory and customer
   status. Document how shared-workspace disputes and unresolved restrictions
   prevent a false completion notice. No real customer erasure is authorized here.
7. **Review and later publish exact disclosures.** After gates 1-6 pass, approve
   final Privacy/Data Retention and Connect/Reconnect text with the verified
   recipients and implemented durations. Verify live links and desktop/mobile
   consent visibility after the separately authorized publication. Keep the
   existing OAuth client, callback and scope unless a separate change is approved.
8. **Complete Google verification later.** Use the prior packet's synthetic English
   consent-to-import video procedure, review the recording and unlisted playback,
   reconcile registered branding with the live product, and review the exact
   submission. The owner must separately authorize any audience change and final
   attestation/submission. Record actual Google status; this draft is not approval.

## Live-state boundary

No secrets were rotated or exposed. No environment, Production database, OAuth
client, callback, enabled connector, Square/QuickBooks state, public policy,
attestation or Google submission was changed. The migration was exercised only
against synthetic local databases. No live erasure, provider/model request,
mailbox test or Production restore was run. The one Production model-binding
metadata attempt failed and was not repeated.
