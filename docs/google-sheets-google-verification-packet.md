# Google Sheets verification submission packet

Prepared October 2, 2026 against merged `main` `f564108517cc165b858b0c14a48ca4942a53de05`. This is a review packet, **not a published privacy policy, submitted Google application, or compliance certification**. Preserve the deployed connector and its existing credentials, client, callback, and one-scope contract.

## Current status and submission prerequisites

| Item | Verified state / next action |
| --- | --- |
| Branding | Vaeroex Executive Intelligence. Public homepage, privacy, and terms links are saved. No logo was uploaded; an optional logo is not a reason to replace the existing brand. |
| Domain | `vaeroex.com` verified in Search Console by the existing project Owner. No ownership/DNS work is outstanding. |
| Support | OAuth support and developer contact remain the existing owner address. Public support/privacy requests use `support@vaeroex.com` in the deployed policy. Addresses and links are verified; mailbox delivery/monitoring was not tested. |
| Audience | External / Testing, existing designated test user. No public-audience change or additional test user. |
| Data Access | Exactly `https://www.googleapis.com/auth/spreadsheets.readonly`, Sensitive. No restricted or non-sensitive scopes. This registration reconciles review metadata to existing runtime use. |
| Callback | `https://www.vaeroex.com/api/integrations/google-sheets/callback`; existing Web application client unchanged. |
| Public disclosures | Owner review and publication required; see draft below. The current privacy page is generic and does not yet cover the Google-specific lifecycle and Limited Use commitment. |
| Demonstration | Script and existing synthetic CSV ready; an actual English consent-to-import video has not been recorded/uploaded. Previous screenshots are internal evidence, not a substitute. |
| Google status | No review submitted. Verification Center still reports Testing. Obtain owner confirmation before switching the public audience and before accepting any final compliance attestation. |

Google's [sensitive-scope verification guide](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) requires accurate branding, verified domain ownership, scope justification, and an unlisted YouTube demonstration. Follow the current Verification Center sequence; published branding is a prerequisite to the sensitive-data-access review. A deployed connector or a successful test consent is not verification approval.

## Scope justification: ready for review

Vaeroex Executive Intelligence lets a workspace owner import business metrics from an existing Google spreadsheet that they explicitly select by pasting its URL. The owner chooses a worksheet, header row, stable record-key and date columns, optional location column, and up to 12 numeric metric columns. Vaeroex previews the selected values, requires explicit approval of the mapping, and then validates and imports the approved observations into Performance and deterministic Executive Intelligence results. The owner can request a manual sync or enable periodic refresh, targeted every 15 minutes. Vaeroex never edits the source spreadsheet.

The requested `spreadsheets.readonly` scope permits the Sheets API metadata, header, and selected-column reads required for this workflow. The application does not enumerate Drive files, download arbitrary Drive content, request profile/email access, or call spreadsheet write APIs. It reads the configured spreadsheet's metadata and header row for selection/validation, then the approved data columns. The OAuth grant itself can access all spreadsheets available to the consenting account; the selected-file and selected-column restrictions are application controls, not a narrower Google grant.

### Why not a narrower scope?

Google lists `drive.file` as the recommended non-sensitive per-file alternative. It can support a differently designed Picker/open-with or app-created-file workflow and also permits file writes. It is **not** a drop-in replacement for the existing pasted-URL workflow: a pasted ID alone does not establish a per-file grant to the app. There is no Sheets scope limited to a tab, range, or read-only per-file selection in the published scope list. This application uses the read-only Sheets scope rather than all-Drive or write-enabled scopes and constrains reads in code. Do not claim that a narrower architecture is impossible; Google may still request a per-file workflow change during review. Do not add `drive.file` or redesign selection as part of this verification task. [Official Sheets scope reference](https://developers.google.com/workspace/sheets/api/scopes).

## Audited data flow and claim boundaries

| Stage | Actual implementation and stored data |
| --- | --- |
| Consent and tokens | `lib/integrations/google-sheets/server.ts`: fixed Google authorize/token destinations, read-only scope, offline consent, single-use owner/session/workspace binding. Access/refresh tokens and expiry are encrypted using AES-256-GCM with workspace/connection/generation/version context. The server-only encryption key is separate from persisted ciphertext. |
| Read access | `sheetsMetadata`, `sheetsHeaders`, and `sheetsMappedColumns` use bounded HTTPS GETs to Sheets. Metadata contains spreadsheet/tab titles and IDs and grid size. Header selection reads up to 100 column headings, including headings not ultimately mapped. Approved row reads request mapped columns only; complete snapshots are checked for consistency. No whole-Drive listing or spreadsheet writes. |
| Normalization | `ingestion.ts` deterministically validates dates/numbers/labels. Stored normalized projections contain hashed row keys, dates, optional location labels, approved metric names/categories/units/targets/values, and validation classes. Arbitrary raw row-key text is hashed; full raw provider response bodies are not the persisted source format. |
| Persistence | `20261002040024_google_sheets_complete.sql`: connection/spreadsheet/tab/header/mapping metadata, approvals, sync runs, immutable normalized source versions, source fingerprints, provenance links, and approved KPI observations. Source history is not equivalent to a transient browser preview. |
| User-facing results | Approval, structural validation, source-authority overlap checks, and workspace isolation precede KPI admission. `lib/kpis/load-workspace-kpis.ts` applies the Sheets conflict contract. Performance and deterministic findings can use approved observations without a model call. |
| Optional model processing | `lib/ai/intelligence-briefing/workspace-context.ts` loads eligible workspace KPIs. `lib/intelligence/snapshot/v1/briefing-projection.ts` derives bounded measured signals; `lib/ai/intelligence-briefing/service.ts` sends the requested briefing payload to OpenAI. Thus Google-derived metric values/labels/dates and derived findings can leave Vaeroex for this user-facing feature. They are not universally excluded merely because the connector itself is deterministic. |
| Model request controls | The reviewed briefing policy in `lib/ai/providers/workflow-provider-policy.ts` uses OpenAI with `store: false`. `openai-provider.ts` forwards that option. This is **not** proof of zero vendor retention or of organization-level data-sharing settings. Other model workflows have their own routing; do not make a blanket no-sharing/no-training attestation from this one request flag. |
| Disconnect | `20261002040031_google_sheets_lifecycle.sql` plus the disconnect route stop local sync and request Google revocation. Encrypted credentials are deleted after completed revocation; a failed revocation may retain them for a retry while reads remain fenced. Prior imports, approvals, source versions, and audit history are retained, and current KPI projections are retired. |
| Retention/deletion | No fixed Google-data purge period or complete self-service erasure workflow was established in this audit. Immutable source/approval triggers deliberately prevent ordinary update/delete. Do not promise erasure on disconnect, an unimplemented deletion SLA, or a verified full-workspace purge. A documented, workable support-request retention/deletion procedure is an owner review gate. |

The runtime is hosted on Vercel and uses the existing Supabase database; these processors receive the information needed for hosting/storage. The optional briefing uses OpenAI. This audit does not verify every processor contract, backup retention period, human-access procedure, or account-level model training/data-sharing setting. [OpenAI's data controls](https://developers.openai.com/api/docs/guides/your-data) distinguish API training opt-in, response storage, and abuse-monitoring retention. Do not describe `store: false` as Zero Data Retention.

## Proposed public wording: owner review required

Do not publish or submit this draft until the owner confirms the operational commitments in the next section. The current live policy remains unchanged.

### Google Sheets access and use

When a workspace owner connects Google Sheets, Vaeroex requests read-only access to spreadsheets that the owner's Google account can access. In Vaeroex, the owner supplies a spreadsheet URL, selects a worksheet and columns, previews the proposed metric mapping, and approves it before import. Vaeroex reads spreadsheet and worksheet metadata and column headings to support setup and validation, then reads the mapped business-data columns for synchronization. Vaeroex does not edit the spreadsheet or browse the owner's Google Drive files.

Vaeroex uses the approved data to provide workspace business metrics, Performance views, deterministic findings, and requested Intelligence features. Manual imports and periodic refresh are deterministic and do not require an AI model. When a user requests a supported Intelligence briefing or other model-assisted analysis, relevant approved metrics and derived findings may be sent to the configured AI processing provider to produce that requested result. The current briefing provider is OpenAI. Google credentials are not part of that analysis payload.

### Storage, sharing, and connection controls

Vaeroex stores connection settings, spreadsheet and worksheet identifiers and labels, approved column mappings, normalized metric observations, provenance, sync outcomes, and historical source versions in its workspace-scoped database. OAuth credentials are encrypted on the server. Hosting and database providers process information needed to operate the service; model-processing providers receive relevant context only for supported user-facing analysis workflows. Do not connect regulated healthcare data, Social Security numbers, or insurance identifiers.

Disconnecting Google Sheets stops further synchronization and requests revocation of Vaeroex's Google access. When revocation completes, Vaeroex deletes the stored connection credentials. If revocation needs another attempt, the integration page explains that state. Disconnecting does not delete historical imports, approved mappings, source provenance, or saved analyses. Users can also review/remove access in their Google Account's third-party connections settings. Requests about retained Google-derived data can be sent to `support@vaeroex.com`; the owner must approve the actual retention and deletion procedure before this wording is published as a complete policy.

### Limited Use commitment: approve operationally before publication

Vaeroex's use and transfer of information received from Google APIs will comply with the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including its Limited Use requirements, and the applicable [Google Workspace API User Data and Developer Policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy). Google user data and derived data will not be sold, used for advertising or credit/lending decisions, or used to train or improve generalized machine-learning models. Transfers and human access will be limited to the permitted user-facing, security, legal, and other policy exceptions, with the required consent.

This paragraph is a proposed commitment, not a claim that account/contractual settings have already been audited. Before adopting it, confirm the AI provider's production organization does not opt Google-derived data into general training/sharing, identify any other enabled processors that can receive those metrics, and confirm staff/contractor handling and retention/deletion procedures. Google's Workspace policy also restricts permanent copies/caching; review retained derived source history against the applicable terms rather than assuming an immutable audit requirement overrides them.

### Proposed adjacent pre-consent notice

Add to the existing Sheets connection explanation, without changing Intelligence/Overview/Performance or provider eligibility:

> Google grants read-only access to spreadsheets your account can access. Vaeroex reads the spreadsheet you configure, its worksheet details and headings, and the data columns you approve. Approved metrics are stored in your workspace for Performance and Intelligence. If you request a supported model-assisted analysis, relevant metrics and findings may be sent to our AI processing provider; see our Privacy Policy. Disconnect stops future sync but retains import history. Use business data only.

This is review-only text. The current connection page explains broad read permission, application selection, and prohibited data, but does not prominently describe model-provider sharing or retained history beside consent. Google's [disclosure requirements](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) should be checked against the final normal-use/consent flow, not satisfied by hiding new claims only in a policy.

The public homepage identifies Vaeroex and Executive Intelligence and already links Privacy/Terms/Contact. Consider a short, accurate connector description on the existing public Executive Intelligence page or homepage before review: "Import approved business metrics from a Google spreadsheet you select. Preview and approve columns, synchronize read-only, and view validated results in Performance and Executive Intelligence." This is copy for review, not authorization to redesign the public site.

## Synthetic video: exact recording and upload procedure

Use the existing [four-row synthetic fixture](fixtures/google-sheets-smoke.csv), not customer data or a real customer company. It has stable Record ID, Date, Orders shipped, On-time rate, and Location columns. The previous test connection is now disconnected; reconnecting for a fresh video requires the owner's actual Google consent. Do not reactivate it silently, reuse a stale callback, or represent earlier screenshots as a new recording.

1. Use English browser/Google screens and the designated test account. Close unrelated tabs, hide bookmarks/notifications, and do not display password managers, environment settings, terminal output, Developer Tools, or client secrets. Use a synthetic-only workspace/view; previous screenshots include surrounding workspace content and are not safe to upload as-is.
2. On macOS press Shift-Command-5, choose Record Selected Portion, frame only the demonstration browser, and select a private local save folder. Start recording after sign-in/MFA. Native continuous video recording and authenticated YouTube upload were not performed by this task's browser tooling; the owner must operate this capture/upload step. Pause/trim or mask credential-entry and callback URL frames. Never record an authorization code, state nonce, token, secret, or unrelated business record.
3. Show the public homepage and Privacy link. Briefly show the existing **Clients list**, with the intended Web application client ID visible, not the client's secret panel. The OAuth client ID is public metadata, not a client secret. Then open Vaeroex Integrations > Google Sheets and show the read-only explanation.
4. Select the existing synthetic business entity and a clearly named verification connection. Use Connect/Reconnect through the normal app UI. Show the authentic English Google consent screen, app/brand/domain, and only the requested Sheets read permission. The owner completes consent. If Google still displays only the domain before branding approval, label that truthfully and update the demonstration after branding is published if Google requests it; do not edit the video to fabricate an approved brand.
5. After the safe callback redirect has completed, show Connected. Paste the synthetic sheet URL, select its grid tab and header row 1, and preview columns. Map Record ID as the stable key, Date as ISO date, Location as the optional grouping, Orders shipped as count, and On-time rate as percentage fraction. Approve only these mappings, with clearly identified test metric names. Explain that manual sync is available and automatic refresh is periodic, targeted every 15 minutes, not real-time.
6. Click Sync now. Show four accepted rows/eight observations and the completed run with its successful-refresh timestamp. Show imported metrics in Performance with their period, source, and unit. Use the normal metric-direction controls if a synthetic target comparison needs them; do not invent an interpretation automatically.
7. Show the corresponding deterministic Intelligence result and source evidence. Do not generate a model-assisted briefing merely for the video. Keep unrelated workspace information out of frame. Explain that optional requested briefings have the separately disclosed processing behavior.
8. Stop recording. Review the entire recording for secrets, URL callback parameters, private account details beyond the designated test account, and unrelated data. Keep the original local; upload only the reviewed version to YouTube Studio > Create > Upload videos. Select **Unlisted**, not Private or Public, and an accurate non-children audience classification. Title suggestion: "Vaeroex Executive Intelligence - Google Sheets OAuth verification". Do not use a placeholder URL or an inaccessible private video.
9. Verify that the unlisted watch link plays without signing in. Supply that link in the sensitive-scope application. After the demonstration, use the normal disconnect control if the owner wants the synthetic connection stopped; do not delete history or silently alter refresh preferences.

Suggested narration: "Vaeroex imports only the business spreadsheet and metric columns I configure. The Google permission is read-only and applies to spreadsheets my account can access; Vaeroex does not write to them. I approve the mapping before importing. These are synthetic metrics. The successful sync produces validated observations with provenance in Performance and deterministic Intelligence. Automatic refresh polls periodically; it is not real-time. Disconnect stops future synchronization while historical records remain subject to the published retention policy."

## Final submission checklist

1. Owner reviews the draft and confirms monitored support, model-provider data-sharing/training controls, retention/deletion handling, and Limited Use commitments. Resolve any actual policy/code discrepancy explicitly; do not attest around it.
2. Publish the reviewed public policy and any required narrow pre-consent/public explanation; verify the live links and text. No connector rebuild, additional scope, credential rotation, or broad deployment is authorized by this packet alone.
3. Record and upload the genuine synthetic demonstration, including owner-operated consent; verify the unlisted link.
4. Obtain owner confirmation at the publishing action before changing Audience from Testing to In production. This changes who may authorize the app; it is not Google approval. Preserve the existing client, redirect, secrets, and scope.
5. Complete/publish brand verification through the current Console flow, then submit the scope justification and video through Verification Center. Obtain action-time owner confirmation for any legally binding policy attestation. Record the actual submission timestamp/status and any Google follow-up; do not assume a review ETA or success.

No verification application, video, new consent, reconnection, provider import, model call, migration, or deployment was submitted/executed in preparing this packet.
