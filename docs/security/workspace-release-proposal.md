# Executive Intelligence pilot — CL-02 release proposal

**Scope update, 2026-10-06 UTC:** the user authorized code integration only; PRs #462–464 are merged at main`f4ad5eb8`. Health/Intelligence consolidation is approved in focused, unmerged follow-up #465. Production rollout and the remaining gates in this proposal are explicitly deferred; they do not block the completed audit-stack merge or consolidation review. All proposed budgets, roster, cohort and maintenance decisions remain unapproved. Main and held review branches disable Git deployments; pending Cloud Build candidates must not be approved.

**Recommendation: HOLD pending the specific gates below.** Proposed pilot: two named customer workspaces, up to20 registered accounts and a planned peak of ten active people/about one aggregate action per second. These are operating boundaries, not a production SLA. New analyses and supported connectors are included. No spending, configuration change, connector activation, merge, migration or deployment is authorized by this proposal.

## What customers would receive

| Experience | Included capability and boundary |
|---|---|
| Executive Intelligence | Overview, Intelligence, Performance/KPIs, Business Health, source evidence and saved analyses. The approved consolidation makes Intelligence the primary Health-review destination in #465; meaningful CRM/Tasks retirement remains deferred. |
| New Vaeroex analyses | New Executive Analysis conversations/follow-ups, Health analysis, Explain Finding, weekly/monthly briefings and file analysis, with saved results and available citations. Draft recommendations require confirmation before changing records. The absent conversational-policy setting must be deliberately configured at release; other write-only policies need owner confirmation. |
| Imports and Business Memory | Reviewed CSV/worksheets, approvals, confirmed Business Memory, internal forms/issues and truthful held-import reconciliation. Reviewed imports retain the existing1,000-row limit; no automatic partial-import resume or10,000/50,000-row promise. |
| Google Sheets | Owner consent, approved tab/column/entity mapping, manual sync and optional15-minute refresh with provenance. Existing10,000-row/15,000-observation sync limits remain; their maxima are not capacity-qualified. Consent eligibility and recovery cadence require the checks below. |
| QuickBooks Online | Existing owner connect/reconnect/disconnect, accounting records/reports, background reads and approved accounting authority for supported insights. Raw imports do not automatically become authoritative economic facts. Compatible workers and sandbox lifecycle remain prerequisites. |
| Square | Existing direct owner consent/location selection, bounded read-only Payments/history, refresh/renewal and disconnect/recovery. No full POS/inventory/order/accounting promise or dormant infrastructure activation. |
| Onboarding | Guided legitimate account/workspace, agreement and subscription/approved activation, with a named support/held-import owner. Customer onboarding does not require administrator exemptions. Existing email/payment qualification limits remain. |

**One authoritative source per metric/entity/unit/period remains mandatory (VXA-013 / DEC-004).** Multiple connectors may supply different data. Overlapping CSV, Sheets and accounting observations cannot be combined with an automatic deduplication promise. The onboarding owner maps authority before approval; customers requiring overlap consolidation cannot use that workflow yet. Preserve original records and citations.

## Destination, artifacts and completed preparation

Production remains Vercel`vaeroex-ops-system` (`prj_J810bZ9ECoN4CyLKujUoEEH8N6ja`), canonical`https://www.vaeroex.com`, deployment`dpl_A9tgEHvj54MkLCxCyac7FGokaM1t` at`d91be079`, Node24.x/iad1. Supabase`mdiianhfrojmxqpwrflh` remains at120 migrations ending20261002182746. The proposed stack is not deployed.

The coordinated stack **#462 → #463 → #464** is merged, with all four checks passing on final heads98d14c12/729eb0a9/f46db3be. Main and all held review branches retain explicit deployment holds until separate release authorization. Application behavior remains measured`396ec2f7` plus the QBO Docker packaging fix`3764d62d`. All four CI jobs pass at`cea1a1f2` in [run37388239534](https://github.com/vaeroex/Vaeroex-Ops-System/actions/runs/37388239534), including the actual Linux/amd64 image build and six network-isolated smoke modes. VXA-043’s artifact defect is resolved; provider/database lifecycle is not inferred. Current descendant status is on [PR#464](https://github.com/vaeroex/Vaeroex-Ops-System/pull/464). No image was pushed; an immutable destination-configured release artifact is still required.

The actual pinned Supabase CLI2.119.0 now passes exact120→133 selection, lock-failure rollback, real process interruption after migration8, remaining-five forward recovery and repeated no-op, preserving historical mismatches. Its443 assertions include hashes/selection. The earlier104-check SQL rehearsal and failed fixture evidence remain. Production timing/TLS/pooler behavior, exact post-COMMIT acknowledgement-packet loss and operator maintenance controls are not claimed. [Evidence and technical runbook](workspace-release-runbook.md).

## Configuration and money — proposals stay proposals

**Customer limits remain unchanged.** Existing source defaults are60 requests/user and240/workspace per600 seconds,2,000,000 monthly workspace tokens and120,000 estimated tokens/request. The restored project listing has no matching overrides; this is not a running-artifact environment dump. The earlier10/20 rates and500,000-token budget were **new recommendations**, never applied, and are withdrawn. Preserve existing retry/fallback behavior. Do not lower limits to fit$25. Post-hoc usage and token preflight are not an atomic dollar cap.

**Proposed$5 synthetic qualification:** ten logical requests covering Executive Analysis/follow-up, Health, explanations, briefings and two small files; serial, at most20 generation attempts/eight embedding calls, with failed/fallback attempts counted. Verify models/current rates and a qualification-specific attempt/usage inventory first. Stop on missing usage, uncertain persistence or budget exhaustion. No paid request has occurred.

**Proposed first30-day pilot allowance:$25 aggregate**, review at$10/hold new generation at$20, preserving$5 for delayed charges. Adequacy against unchanged customer limits is unverified. Require attributable provider billing and a named stop owner; a dashboard budget may only alert. Without verified enforcement, overshoot remains possible and needs explicit acceptance. No purchase or new provider project is proposed as an automatic action.

## Remaining release gates

| Gate | Verified state and required completion |
|---|---|
| Configuration and owner records | Local Vercel/gcloud access works. Sheets/QBO are enabled and callbacks match. `VAEROEX_CONVERSATIONAL_POLICY` is absent: configure`premium_conversational_v1` only in the approved full-feature release. `AI_PROVIDER`, four workflow policies, Square enablement and`VAEROEX_ADMIN_EMAILS` are write-only Secrets; reconcile original protected configuration, not more read permissions or secret replacement. |
| Provider and connector qualification | Google Auth Platform’s existing browser account needs owner re-verification before consent/audience/scopes can be read. OpenAI’s visible Personal/Default project is not attributed to production and Limits did not load; NVIDIA is signed out. Need actual billing/model/usage/cap views or protected exports and the approved finite paid qualification. Qualify existing connectors with sandbox/synthetic accounts, preserving customer connections. |
| Recovery and resource envelope | Five live QBO modes use old source94baa9dd/image4c4bfbcf…. Their instance settings imply160 possible client slots, but five existing four-connection DB login caps restrict those intended roles to20 admitted connections. Preserve those caps; qualify pooler/contention/headroom. All three live schedules run every5minutes; no independent≤15s Sheets recovery tick is verified. These do not prove the unchanged300-second recovery objective. |
| Coordinated admission, inventory and recovery | Vercel has no observed active firewall gate; Data API/Storage policy controls are visible but no universal write-only hold is qualified. Database snapshots exist (newest Oct5 13:52UTC); PITR is off and snapshots exclude Storage. No restore test was performed. Demonstrate admission/recovery boundaries, protect Storage/history, and inventory every accepted operation after cutoff. Backup-only rollback cannot preserve intervening accepted writes. |

## Release procedure and preserved limitations

Freeze exact application/image/configuration identities and the [ordered thirteen-migration manifest](workspace-release-runbook.md#release-artifact-and-migration-manifest). Recheck the120-version destination; stage only that reviewed prefix plus13 files, ending133. Stop new admissions across all surfaces while identified accepted completion/recovery remains reachable. Obtain fresh post-cutoff inventories; resolve each accepted operation as terminal with evidence or explicitly held/fenced under an owner. Then stop remaining writers, apply the ordered files, configure only approved exemption UUIDs as owner, and install compatible application/workers. Reopen through authorized canaries and preserve the hold on failure. Reconcile catalog **and** ledger; prefer forward correction, never a pre-audit binary/history rollback.

The small run demonstrated ten active users/two synthetic workspaces:1,199 actions/20minutes, read p95/p99 1,262.713/1,593.922ms, mutation p95 845.019ms,60/60 accepted manual syncs complete and zero lost/duplicated effects. Providers were simulated. **Arrival-free drain remains unqualified** (`nominalDrain:false`, `drainMs:null`); no replacement measurement was run. Full scheduling/fault/fairness and100/250/500 targets remain deferred. Preserve held imports, legacy37 queued bookkeeping rows, the review-pending extraction, old leases, historical mismatches, saved analyses/citations and migration history.

## Three business decisions

1. **Pilot and window:** choose the two customers, onboarding/incident owner and acceptable maintenance window; accept guided one-authoritative-source mapping and the stated limits.
2. **Private exemption:** approve the optional internal A1 operator or a reconciled empty roster. This bypasses subscription and stored file/run quotas only in legitimate memberships; it grants no customer access, higher role or free provider use. The exact identity is in the private local review file. Assign a revocation owner.
3. **Spend:** approve or revise the$5 qualification and$25 allowance/stop policy, including whether an enforceable cap is required. Both remain unapproved.

Technical qualification remains our work; these choices do not waive it. RetainHOLD until the gates pass and release is separately authorized. [Persistent audit](workspace-audit.md) · [Evidence](audit-evidence/release-preparation/README.md) · [Access guide](workspace-release-access.md).
