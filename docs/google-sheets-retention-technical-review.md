# Google Sheets retention and processor review

Read-only Production audit and synthetic deletion qualification, October 2, 2026.
Reviewed application source: `f564108517cc165b858b0c14a48ca4942a53de05`.
This is not a compliance attestation, authorization to erase records, or a published policy.

## Decision

**Submission remains blocked by an implementation gap, not just an owner signature.**
There is no supported complete erasure operation for retained Google-derived source
history and its downstream copies. Normal disconnect, archival, deletion flags, or
Google access removal do not implement that operation. Do not promise that they do.

The existing OAuth client, callback, scopes, encrypted credentials, connector gate,
other integrations, and live records were unchanged by this review. No import,
model generation, restore, migration, or deployment was performed.

## Production processor settings

| Check | Observation | Boundary |
| --- | --- | --- |
| Vercel Production | `vaeroex-ops-system`, deployment `dpl_CK86HF8QjuDevWkVxVnDA2TigCVX`, READY at the reviewed source | Read-only metadata; no deployment |
| Production OpenAI key | Exactly one `OPENAI_API_KEY` entry for Production; type Sensitive | The supported read-only environment API did not return its plaintext. No key was printed, persisted, copied into a browser, or sent in a model request. |
| Accessible OpenAI organization | Personal, `org-CGjqrsh1lZbtcfKfvfrGqoLe` | Its relationship to the Production key is **not proven**. An authenticated browser alone is not binding evidence. |
| Feedback sharing | Disabled | Observed organization only |
| Evaluation/fine-tuning data sharing | Disabled | Observed organization only |
| API input/output sharing | Disabled | Observed organization only |
| Accessible project retention | Default project, `proj_fK5VqmVCKiL0uV6BNBzfv3jo`: Standard Retention | No Zero Data Retention or Modified Abuse Monitoring entitlement was established for Production. |
| API call logging | Enabled per call | The UI distinguishes per-call storage from organization sharing; do not label it zero retention. |
| Other model routing | Production has a Sensitive `NVIDIA_API_KEY`; model-policy selectors are also Sensitive and were not readable | Key presence is not proof of execution. The code has NVIDIA fallback routes, so an OpenAI-only statement for every analysis is not verified. |

### Exact remaining account-binding check

In the Vercel team's `vaeroex-ops-system` project, go to **Settings > Environment
Variables > Production > OPENAI_API_KEY**. Use the existing private provisioning
record to identify its OpenAI organization/project/key record. Do not reveal or
send its value. In [OpenAI Projects](https://platform.openai.com/settings/organization/projects),
select that organization and project; compare non-secret key-record metadata in
the project's API keys page. A matching project name or recent usage alone is not
proof. If the original binding is unavailable, record that gap rather than guessing
or extracting a key from a deployed function. A separately reviewed credential
rotation could establish a known binding, but is not part of this preparation.

For the proven organization inspect [Data controls](https://platform.openai.com/settings/organization/data-controls):
**Sharing** (feedback, evaluation/fine-tuning, API inputs/outputs), then **Data
retention**. Also inspect the project's **Data retention** in the Projects table;
an organization-level entitlement does not prove the project's effective override.
No settings were changed in this audit.

`lib/ai/providers/workflow-provider-policy.ts` gives the supported Intelligence
briefing an OpenAI-only policy with `store: false`; `openai-provider.ts` forwards
that option. Other workflows can choose a different policy. Production policy
selectors/provisioning records must identify which of those routes are enabled
before a final processor list is published. Any reachable NVIDIA processing of
Google-derived context needs its own applicable data-use/retention review; this
review does not certify it.

[OpenAI's data controls](https://developers.openai.com/api/docs/guides/your-data)
state that API data is not used for training by default, absent an opt-in. They
separately describe abuse-monitoring retention, generally up to 30 days with
exceptions, and application-state retention. `store: false` is not Zero Data
Retention. No model call was made to inspect account identity.

## Actual retention graph

| Layer | Retained content / relationship | Existing removal behavior |
| --- | --- | --- |
| Connection and OAuth | Spreadsheet/tab IDs and titles, headers, mapping settings, creator/session references, encrypted tokens | Disconnect stops reads and requests revocation. Successful `complete_disconnect` physically deletes the credential row after generation/version checks. Failed revocation retains the fenced credential for retry. |
| Mapping approval | Approved mapping, header context, approval lineage | Immutable trigger rejects UPDATE and DELETE. |
| Sync and source history | Run outcome/review classes, source fingerprints, normalized metric/date/location projections, prior/current-version references | Disconnect retires current projections; versions and approvals remain. Cyclic current/prior references and NO ACTION FKs prevent a naive parent cascade. |
| Provenance and observations | `google_sheets_fact_links` links approvals/source versions to `kpis`; KPI values and `raw_data_json` are separate copies | Retirement archives KPIs and marks links retired. A linked KPI cannot simply be deleted while its fact link exists. |
| Generated analyses | `ai_agent_runs.output_json` can hold metric values, dated signals, fact text, citations and derived narrative | Hiding a run is not erasure. There is no complete Sheets erasure traversal from connection to all JSON artifacts. |
| Saved analyses | `reports.source_data_json` copies the artifact and source-artifact ID; `body_markdown` is another rendered copy | The customer delete operation sets `deleted_at`; both content columns remain. |
| Other dependent records | KPI alerts, scheduled-report references, decisions, recommendation outcomes, and any explicit copied/re-imported content | SET NULL FKs are not content deletion. Inspect exact lineage before treating these as copies; table existence alone does not establish that Google data is present. |
| Memory/search | The audited evidence index writes uploaded-file/workbook and business-note chunks; the Sheets sync path does not directly call those indexers | Do not claim every memory chunk derives from Sheets. Explicitly re-uploaded or user-copied derivatives may need case-specific identification; no automatic full reachability proof exists. |
| Backups / exports / processors | Prior database snapshots and any independently retained exports or processor data | Live-row deletion cannot alter a physical snapshot. Exports/log drains and processor retention require separate inventory; no claim that all such copies have been inspected. |

Source references:

- `supabase/migrations/20261002040024_google_sheets_complete.sql`: tables, NO ACTION FKs, immutable trigger and retirement.
- `supabase/migrations/20261002040031_google_sheets_lifecycle.sql`: disconnect, completion, credential deletion, reconnect.
- `lib/integrations/google-sheets/ingestion.ts`: minimized source shape and fingerprints.
- `lib/ai/intelligence-briefing/workspace-context.ts`, `lib/intelligence/snapshot/v1/briefing-projection.ts`, `lib/ai/intelligence-briefing/storage.ts`: values and citations in downstream artifacts.
- `app/app/intelligence/briefings/actions.ts`: persisted generated artifact.
- `app/app/reports/saved-analysis-actions.ts`: copied artifact, rendered body, soft-delete RPC.
- `supabase/migrations/20260817185529_intelligence_briefing_storage_contract.sql`: exact soft-delete implementation.
- `lib/ai/evidence-index.ts`: file/workbook indexing and embedding paths, not an automatic Sheets index.

### Operations qualified with synthetic data

Run `node scripts/google-sheets-retention-audit.cjs` without Production variables.
It creates an in-memory PGlite database, invokes the existing 82-check connector
qualification against actual migrations, then makes 10 focused retention checks.
Every probe uses synthetic rows; failed-delete probes roll back.
Focused ESLint passed with zero warnings. `git diff --check`, a local documentation
link check (seven links), and a scoped secret-pattern scan also passed. No broad
build, regression run or provider test was launched for this documentation/audit
change.

| Operation | Result |
| --- | --- |
| Canonical disconnect completion | Existing qualification proves credentials remain pending revocation, stale completion is denied, and correct completion removes the credential row. This is a synthetic acknowledgement, not a live Google revocation test. |
| Source-version DELETE as service_role and database owner | Both denied, SQLSTATE 42501 |
| Mapping-approval DELETE as service_role and database owner | Both denied, SQLSTATE 42501 |
| Connection DELETE with imported history | Denied, SQLSTATE 23503 |
| Linked KPI DELETE | Denied, SQLSTATE 23503 |
| Creator-profile DELETE with retained history | Denied, SQLSTATE 23503 |
| Failed deletion probes | All retained import counts unchanged |
| Existing disconnect retirement | Source values/history remain; current links/projections are retired |
| Customer saved-analysis deletion | Succeeds as a soft delete, but exact JSON and rendered body remain |

The live catalog independently confirms the unconditional
`private.google_sheets_immutable_v1` trigger, enabled approval/version DELETE
triggers, the relevant foreign keys, and soft-delete function. No live DELETE was
attempted. The synthetic fixture is **not** a full canonical bootstrap and does
not prove that deleting an entire workspace/account is a supported erasure path.

## Backup findings

Read-only inspection of Production `mdiianhfrojmxqpwrflh` shows the Pro plan and
daily **Physical** backups, with eight dated entries from September 25 through
October 2, 2026. The PITR page says the add-on must be enabled, so PITR is not
currently enabled. No backup was downloaded, restored, deleted, or changed.

[Supabase's backup documentation](https://supabase.com/docs/guides/platform/backups)
describes seven-day availability for Pro daily backups. The observed list includes
both boundary dates; it is not proof of a strict seven-day maximum erasure deadline
or of the provider's internal-media destruction time. Database backups do not
include Storage object content. This Sheets connector does not persist raw
spreadsheet files to Storage in the audited path.

There is no verified restore-time erasure replay procedure. A pre-erasure backup
could restore deleted Google data and credentials. Before claiming deletion is
complete, record the last snapshot containing the data, its actual expiry, and a
procedure that reapplies completed erasures in an isolated restore **before**
customers, workers or schedulers can access it. Do not restore Production to test
this or delete shared backups/project data to resolve one user's request.

## Request handling that is safe now

1. Receive the request at the monitored support address. Verify the requester and
   their authority over the affected Google grant, workspace and data. Shared
   workspace ownership disputes require an explicit decision; never erase another
   member's or another provider's data based on an email address alone.
2. Record a bounded case identifier, requested scope and timestamps. Do not ask for
   OAuth tokens, spreadsheet payloads, API keys or passwords. Requester identity
   and exact connection references stay in the restricted support process.
3. If the requester authorizes stopping access, use the existing disconnect path;
   reconcile Google revocation and credential removal. Warn that Google grant
   revocation may affect other connections using that grant. No disconnect was
   performed for this audit.
4. Build a **read-only**, workspace-scoped inventory of that connection's metadata,
   approvals, runs, source rows/versions, fact links, observations, exact derived
   run/report copies, and backup/export retention. Include archived and soft-deleted
   rows. Never infer ownership from names, timing or fingerprint similarity alone.
5. **Stop at the erasure gap.** The current product cannot complete this inventory's
   erasure using its supported operations. Do not report the request as fulfilled,
   offer a false completion date, disable triggers, change replication mode,
   TRUNCATE tables, or delete a whole shared workspace as a shortcut.

This procedure can safely receive and contain a request; it is **not yet a workable
end-to-end deletion service**. The remaining engineering is a submission blocker.

## Smallest complete remediation, not implemented here

Use a separately reviewed, explicitly scoped support-erasure operation, not a
generic history editor. It must identify one authorized erasure scope, fence sync
and outstanding workers, reconcile revocation, and support idempotent completion.
Normal application roles must retain immutable-history protections. Avoid a
caller-set session flag that can bypass an immutable trigger.

The operation needs an exact dry-run manifest, dependency-ordered removal of
Google-derived values and identifiers, and proof of zero remaining targeted copies
in live tables. It must address connection/source current-version cycles, remove
fact links before their targets, remove or redact the exact derived JSON and text
copies, and invalidate affected cached/derived views without new model calls.
Preserve unrelated providers, workspaces and independently sourced business data.
If a historical mixed-source analysis cannot be safely separated, identify that
artifact for a specific authorized disposition; do not silently erase unrelated
content or claim a partial deletion is complete.

Keep only an explicitly justified minimal, content-free completion receipt. Define
how any retained receipt identifiers are protected and expired; a hash is not
automatically anonymous. Retain an erasure manifest outside restorable application
backups until all affected restore points expire, and exercise its replay against
a disposable restore before documenting the process as operational.

Acceptance must cover active and disconnected connections, multiple workspaces and
connections, immutable history under ordinary roles, saved/soft-deleted artifacts,
mixed-source artifacts, failed revocation, in-flight sync fencing, repeat requests,
rollback/partial failure, backup replay and no changes to Square/QuickBooks data.
No erasure SQL or migration is included in this verification-only change.

## Policy/design reconciliation

Google's [Workspace user data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
requires deletion requests to be honored and user help explaining deletion. Its
Limited Use rules apply to derivatives too, and it calls out permanent copies and
overlong caching. These requirements are not displaced by Vaeroex's audit-history
design. A support email or owner attestation does not cure the missing operation.

Propose a finite, purpose-specific retention schedule for source versions,
superseded mappings, operational logs and derived artifacts. Distinguish actively
requested reporting history from provider-response caching and unnecessary old
copies. Before submission, obtain Google clarification if the intended long-lived
normalized reporting history is not clearly permitted under the applicable terms;
do not claim that immutable business provenance itself is an exception.

Owner decisions still needed: necessary reporting-history duration, justified legal
exceptions, support ownership/response target, treatment of mixed-source saved
analyses, and processor list/contractual controls. Each resulting promise needs
implemented and tested enforcement before publication. No retention period or
legal hold is silently selected by this audit.

The complete proposed text and short recording checklist are in the
[submission packet](google-sheets-google-verification-packet.md). They remain
review-only until the technical blockers above are closed.
