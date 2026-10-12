# Google Sheets verification release — October 12, 2026

Status: **Production hold remains in effect.** Local implementation and qualification are in progress in PR #458. PR #457 carries the verification packet. No live erasure, restore, provider credential replacement, database apply, or deployment is authorized by a passing local test. The owner will review one exact release request after the remaining gates close.

## Baseline and scope

The resumed PR #458 worktree preserves the October 2 approval/journal work and merges current main `002c2536583ce455f2ce8ee1bc58b430c3da3b74`. The public `www.vaeroex.com` alias was independently verified against that same commit and deployment `dpl_CVRQMCWb4D51xEpung5sSeQNX9dR`. Newer billing work in a separate checkout is excluded from this candidate. Recheck main and the alias before promotion.

Keep project `vaeroex-integrations-prod`, callback `https://www.vaeroex.com/api/integrations/google-sheets/callback`, and the sole `https://www.googleapis.com/auth/spreadsheets.readonly` scope. No Drive access or OAuth client replacement.

The change extends exact erasure to the actual current consumers: source rows/versions/facts and KPI settings; Health snapshots; Health/finding/briefing runs; saved reports; Intelligence lifecycle current/event snapshots; VSI conversation/exchange/request-content records; approved Business Notes and memory; file-analysis fields and processing metadata; KPI semantic suggestions; optional conversational search; and connection summaries. All consumed sources are bound, including context not cited in the final answer.

## Approved retention and support decisions

Isaac (`isaac@vaeroex.com`) monitors `support@vaeroex.com` each business day. Acknowledge deletion requests within two business days; target active-system deletion within 30 calendar days of receipt after authority verification, and explain blockers promptly.

Reporting availability ends at first import +13 calendar months, shortened by disconnect +30 days. Refresh/copy/reconnect does not extend the original clock. The owner explicitly approved immediate unavailability at expiry followed by physical purge on the next business day. Identified derivatives inherit the earliest root deadline. Existing incomplete provenance needs exact review; it is not deemed unrelated. Preserve unrelated source records and original uploads when only derived analysis must be removed.

These periods are business choices, not Google requirements or approval. Google also restricts permanent copies and caching beyond permitted response headers. Finite owner-approved reporting history must be described explicitly in the verification application, including normalized source versions and derived records; a finite duration alone is not evidence that Google has accepted the use. Relevant [Google policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) requires appropriate disclosed use, consent, Limited Use, security and honored deletion requests. It does not prescribe the selected 13-month/30-day schedule. This is an engineering compatibility review, not a legal certification. Any unresolved manual-copy or processor constraint remains a release/submission gate.

## Restricted deletion and recovery

- Prepare under workspace/request locks; exact table, record ID and prior full-row content hash authorize each mutation.
- Verify owner/session and show the exact identified derivative scope before confirmation. A request is not authorized by a spreadsheet URL or email alone.
- Mint read authority before context reads; bind every consumed ID. Epoch change blocks old workers, even after the workspace reopens.
- Keep ordinary immutability guards. Unlisted cascade DELETE or SET NULL mutations abort the transaction.
- Independent signed pending witness must be durable before execute. Retry the same request after an uncertain acknowledgement.
- Preserve accounting, original files and unrelated workspaces/Square/QBO records. Fixed field redaction clears identified file analysis and VSI question hashes without deleting those unrelated records.
- Replay into a separate isolated restored database with a restore-only role. Production support cannot replay arbitrary manifests. Restore must reconcile the complete independent witness inventory even if all local journal files vanished.
- Keep restored application traffic, REST access, schedulers, workers and callbacks isolated until replay/finalization and an external activation approval. Never perform an in-place Production restore as a shortcut. A restorable database flag alone is insufficient.
- A conflict or expired approval needs signed reconciliation/withdrawal, followed by fresh exact preparation and owner approval. Do not silently clear barriers or delete a pending witness.

See `tools/google-sheets-erasure/README.md` for the concrete CLI/configuration, fixed capabilities, daily expiry routine, replay and reconciliation contracts. Full-file manual copies in Storage require separate provider deletion proof; metadata absence alone is not physical erasure.

## Provider replacement — one plan

Read-only inspection confirmed the accessible OpenAI organization `org-CGjqrsh1lZbtcfKfvfrGqoLe`, Default project `proj_fK5VqmVCKiL0uV6BNBzfv3jo`, Standard Retention, and disabled feedback, evaluation/fine-tuning and API input/output sharing. The existing intentionally unreadable Vercel key cannot be bound to that project by metadata. No further attempts to recover its plaintext are planned.

At final approval: the owner creates a replacement key in that verified project and privately replaces **Production only** `OPENAI_API_KEY` in Vercel. Leave Preview untouched. Record key ID/name/issuing project and activation timestamp without key value. Set `GOOGLE_SHEETS_OPENAI_ORGANIZATION_ID` and `GOOGLE_SHEETS_OPENAI_PROJECT_ID` to the verified IDs only after that provenance is established. A synthetic request must succeed with these project headers and `store:false` before Google-derived analysis is enabled.

All Google-derived model/embedding requests revalidate server-created source authority; incomplete legacy provenance blocks transfer. Google data cannot fall back to NVIDIA. Responses force `store:false`; model choices remain the existing approved choices. [OpenAI standard retention](https://developers.openai.com/api/docs/guides/your-data) still allows abuse-monitoring logs generally up to30 days with legal/safety exceptions and prompt caching up to24 hours. This is not ZDR. Do not revoke an old key still used by Preview or another unknown consumer without a separately verified usage inventory.

## Migration and deployment scope

Exactly two forward migrations are proposed:

1. `20261002225025_google_sheets_support_erasure.sql` (existing PR approval foundation).
2. `20261012191836_google_sheets_restricted_erasure_retention.sql` (restricted execution, lineage, retention and replay).

Use the production migration catalog/staging procedure. Compare final file hashes, live144-migration ledger, and normal CLI dry run. No sandbox-history migrations, historical rewrites, broad push, or unrelated pending work. The final receipt must include reviewed commit, migration hashes, dry-run output and full-canonical proof.

Provision a restricted support database login (fixed support RPCs only), separate restore-only identity for isolated restoration, a private versioned GCS witness bucket with no deletion lifecycle, and a keyless dedicated witness service account with only bucket metadata read and object create/get/list. Do not grant update/delete/IAM administration to that identity. Independently pin the journal public key/genesis; keep signing and database secrets in private operator configuration, outside the repository and Vercel app. No irreversible retention lock is proposed.

Keep writes/workers controlled during schema→app transition: old code does not carry read tickets. Stage the schema and application release together in a bounded maintenance window. Keep Sheets disabled until policy consent, provider binding, restricted operator transport and normal flows are verified. Re-enable only the reviewed existing scope, with Google Testing/test-user restrictions until the separate Google publishing step.

Public policy versions become `2026-10-12.sheets1`; the existing legal acceptance mechanism requires review of the changed privacy policy. The mapping checkbox separately records affirmative retention consent; legacy approvals cannot continue silent imports.

## Rollback and failure handling

Before live activation, preserve the prior deploy ID and configuration metadata; do not export secret values into logs. If the release fails, keep Sheets and affected writes disabled, retain the schema and all signed intents, and repair forward or deploy a reviewed application compatible with the ticket schema. Do not blindly roll back to a writer that bypasses the new guards, undo deletion by restoring an older database, drop immutability/retention triggers, or erase witness records. A paused/incomplete request is not a completed deletion. Any backup recovery uses the isolated replay procedure before reopening access.

## Evidence and still-required gates

Passing local evidence so far: full TypeScript; shared provider regression; focused policy tests; actual components at desktop/mobile; source/retention route denial; current application authority races; actual native writer contention, uncertain-commit retry and separate-cluster pg_dump/pg_restore; full canonical144+2 migration rehearsal. Final counts/hashes must be refreshed after the last recovery/metadata changes. Synthetic cloud tests do not qualify live IAM.

Remaining before release approval: final native and full-schema rehearsal; complete physical-copy/recovery boundaries; final build/CI; exact migration dry run; exact reviewed release receipt. Then perform approved live provisioning, owner private key entry, migrations/deployment, live smoke checks and accurate disclosure verification. Only then record and upload the authentic demonstration, verify signed-out playback, finish Google branding/publishing requirements and submit the sensitive-scope application.

No video URL, submission timestamp or Google approval exists at this checkpoint. Google console is **External / Testing**; Verification Center says verification is not required while Testing. Logo saved October12; homepage/privacy/terms/domain and the sole read-only scope are present. Do not describe this as submitted or verified.
